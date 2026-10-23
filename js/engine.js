// Stockfish 17.1 (lite NNUE, single thread) running in Web Workers.
const ENGINE_URL = new URL('../engine/stockfish-17.1-lite-single-03e3232.js', import.meta.url).href;

function parseInfo(line) {
  if (!line.startsWith('info') || line.indexOf(' score ') < 0 || / (lower|upper)bound/.test(line)) return null;
  const mpv = line.match(/ multipv (\d+)/), sc = line.match(/ score (cp|mate) (-?\d+)/), dp = line.match(/ depth (\d+)/);
  if (!sc) return null;
  const pv = (line.split(' pv ')[1] || '').trim().split(/\s+/).filter(Boolean);
  const o = { k: mpv ? +mpv[1] : 1, depth: dp ? +dp[1] : 0, pv };
  o[sc[1]] = +sc[2];
  return o;
}

export class Engine {
  constructor() {
    this.w = new Worker(ENGINE_URL);
    this.cb = null; this.lines = []; this.multipv = 1; this.dead = false; this.listeners = new Set();
    this.ready = new Promise((res, rej) => {
      this._ready = res;
      this._t = setTimeout(() => rej(new Error('Il motore non risponde')), 45000);
      this.w.onerror = (e) => { rej(new Error(e.message || 'Errore del motore')); if (this.cb) { this.cb.rej(new Error('engine')); this.cb = null; } };
    });
    this.w.onmessage = (e) => this.line(String(e.data));
    this.send('uci');
    this.send('setoption name Hash value 32');
    this.send('isready');
  }
  send(c) { this.w.postMessage(c); }
  line(s) {
    if (s === 'readyok' && this._ready) { clearTimeout(this._t); this._ready(); this._ready = null; return; }
    const info = parseInfo(s);
    if (info) {
      this.lines[info.k - 1] = info;
      this.listeners.forEach((fn) => fn(this.lines.slice(0, this.multipv), info.depth));
    }
    if (s.startsWith('bestmove')) {
      const cb = this.cb; this.cb = null;
      if (cb) {
        const lines = this.lines.slice(0, this.multipv).filter(Boolean);
        if (!lines.length) lines.push({ cp: 0, pv: [s.split(' ')[1]].filter((m) => m && m !== '(none)') });
        const bm = s.split(' ')[1];
        cb.res({ lines, best: bm && bm !== '(none)' ? bm : (lines[0] && lines[0].pv[0]) || '' });
      }
    }
  }
  setMultiPV(n) { if (n !== this.multipv) { this.multipv = n; this.send('setoption name MultiPV value ' + n); } }
  newGame() { this.send('ucinewgame'); }
  // Strength for playing: elo (1320-3190) via UCI_LimitStrength, or skill 0-20; null = full strength.
  setStrength({ elo = null, skill = 20 } = {}) {
    const key = elo + '/' + skill;
    if (key === this._str) return;
    this._str = key;
    this.send('setoption name UCI_LimitStrength value ' + (elo ? 'true' : 'false'));
    if (elo) this.send('setoption name UCI_Elo value ' + elo);
    this.send('setoption name Skill Level value ' + skill);
  }
  async analyze(fen, { depth = 16, movetime = 3000, multipv = 2 } = {}) {
    await this.ready;
    if (this.dead) throw new Error('stopped');
    this.setMultiPV(multipv);
    return new Promise((res, rej) => {
      this.cb = { res, rej }; this.lines = [];
      this.send('position fen ' + fen);
      this.send('go depth ' + depth + (movetime ? ' movetime ' + movetime : ''));
    });
  }
  // Streaming analysis for the explorer; returns a stop function
  async think(fen, onUpdate, { multipv = 3, depth = 22 } = {}) {
    await this.ready;
    this.stop();
    await new Promise((r) => setTimeout(r, 30));
    this.setMultiPV(multipv);
    this.lines = [];
    const fn = (lines, d) => onUpdate(lines, d);
    this.listeners.clear(); this.listeners.add(fn);
    this.cb = { res: () => {}, rej: () => {} };
    this.send('position fen ' + fen);
    this.send('go depth ' + depth);
  }
  stop() { this.listeners.clear(); if (this.cb) this.send('stop'); }
  kill() {
    this.dead = true;
    try { this.w.terminate(); } catch (e) { /* ignore */ }
    if (this.cb) { this.cb.rej(new Error('stopped')); this.cb = null; }
  }
}

export const DEPTHS = {
  fast: { depth: 14, movetime: 1500, label: 'Veloce' },
  normal: { depth: 16, movetime: 3000, label: 'Standard' },
  deep: { depth: 20, movetime: 8000, label: 'Profonda' }
};

export function poolSize() {
  const c = navigator.hardwareConcurrency || 2;
  const mem = navigator.deviceMemory || 4;
  return Math.max(1, Math.min(c - 1, mem >= 4 ? 4 : 2, 4));
}

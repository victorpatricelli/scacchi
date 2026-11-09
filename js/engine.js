// Stockfish 19 (single thread) running in Web Workers.
// "lite": small NNUE (~2 MB), the default. "full": the complete NNUE (~100 MB), stronger and more precise.
const FILES = { lite: 'stockfish-19-lite-single.js', full: 'stockfish-19-single.js' };
const url = (f) => new URL('../engine/' + f, import.meta.url).href;
// The full network (~100 MB) is too big for GitHub Pages, so it comes from the npm CDNs that publish
// Stockfish.js (the loader in engine/ is told where to find it through the URL hash).
export const FULL_SOURCES = [
  'https://unpkg.com/stockfish@19.0.1/bin/stockfish-19-single.wasm',
  'https://cdn.jsdelivr.net/npm/stockfish@19.0.1/bin/stockfish-19-single.wasm'
];
export const FULL_BYTES = 99169054;
let fullSrc = FULL_SOURCES[0];
export function setFullSource(u) { if (u) fullSrc = u; }
let MODE = 'lite';
export function setEngineMode(m) { MODE = m === 'full' ? 'full' : 'lite'; }
export function engineMode() { return MODE; }
export function engineLabel(m = MODE) { return m === 'full' ? 'Stockfish 19 completo' : 'Stockfish 19'; }
// Reuse an engine only if it matches the current mode; otherwise replace it.
export function ensureEngine(e) {
  if (e && !e.dead && e.mode === MODE) return e;
  if (e) e.kill();
  return new Engine();
}
// Download the full engine once (the service worker keeps it for offline use), reporting progress 0..1.
// Returns the source that worked.
export async function prefetchFull(onProgress, sources = FULL_SOURCES) {
  let err = null;
  for (const src of sources) {
    try {
      const res = await fetch(src, { mode: 'cors' });
      if (!res.ok) throw new Error('download non riuscito (' + res.status + ')');
      let got = 0;
      if (res.body && res.body.getReader) {
        const rd = res.body.getReader();
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          got += value.length; onProgress(Math.min(0.99, got / FULL_BYTES));
        }
      } else got = (await res.arrayBuffer()).byteLength;
      if (got < FULL_BYTES * 0.9) throw new Error('file incompleto');
      onProgress(1); fullSrc = src;
      return src;
    } catch (e) { err = e; }
  }
  throw err || new Error('download non riuscito');
}

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
  constructor(mode) {
    this.mode = mode || MODE;
    this.w = new Worker(url(FILES[this.mode]) + (this.mode === 'full' ? '#' + encodeURIComponent(fullSrc) : ''));
    this.cb = null; this.lines = []; this.multipv = 1; this.dead = false; this.listeners = new Set();
    this.searching = false; this._idle = []; this._lock = Promise.resolve();
    this.ready = new Promise((res, rej) => {
      this._ready = res;
      this._t = setTimeout(() => rej(new Error('Il motore non risponde')), this.mode === 'full' ? 300000 : 45000);
      this.w.onerror = (e) => { rej(new Error(e.message || 'Errore del motore')); if (this.cb) { this.cb.rej(new Error('engine')); this.cb = null; } };
    });
    this.w.onmessage = (e) => { if (typeof e.data === 'string') this.line(e.data); }; // ignore download-progress objects
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
      this.searching = false;
      const idle = this._idle; this._idle = [];
      const cb = this.cb; this.cb = null;
      idle.forEach((r) => r());
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
  // Serialise commands: a new search starts only after the previous one has really ended,
  // so a late "bestmove" can never be mistaken for the answer to a newer request.
  _exclusive(fn) {
    const run = this._lock.then(fn, fn);
    this._lock = run.then(() => {}, () => {});
    return run;
  }
  _halt() {
    this.listeners.clear();
    if (!this.searching) return Promise.resolve();
    this.send('stop');
    return new Promise((r) => this._idle.push(r));
  }
  analyze(fen, { depth = 16, movetime = 3000, multipv = 2 } = {}) {
    let result;
    return this._exclusive(async () => {
      await this.ready;
      if (this.dead) throw new Error('stopped');
      await this._halt();
      this.setMultiPV(multipv);
      result = new Promise((res, rej) => {
        this.cb = { res, rej }; this.lines = []; this.searching = true;
        this.send('position fen ' + fen);
        this.send('go depth ' + depth + (movetime ? ' movetime ' + movetime : ''));
      });
      return result; // keep the lock until this search is over
    });
  }
  // Streaming analysis (explorer, live mode): onUpdate(lines, depth) while it thinks
  // depth null = no limit (until stop); onDone(result) when the search ends
  think(fen, onUpdate, { multipv = 3, depth = 22, onDone = null } = {}) {
    return this._exclusive(async () => {
      await this.ready;
      if (this.dead) throw new Error('stopped');
      await this._halt();
      this.setMultiPV(multipv);
      this.lines = [];
      this.listeners.add((lines, d) => onUpdate(lines, d));
      this.cb = { res: (r) => { if (onDone) onDone(r); }, rej: () => {} };
      this.searching = true;
      this.send('position fen ' + fen);
      this.send(depth ? 'go depth ' + depth : 'go infinite');
    });
  }
  stop() { this.listeners.clear(); if (this.searching) this.send('stop'); }
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
  if (MODE === 'full') return 1; // the complete network needs a lot of memory: one process at a time
  const c = navigator.hardwareConcurrency || 2;
  const mem = navigator.deviceMemory || 4;
  return Math.max(1, Math.min(c - 1, mem >= 4 ? 4 : 2, 4));
}

// "Gioca": play against Stockfish at adjustable strength.
import { Board } from './board.js';
import { Engine } from './engine.js';

export const LEVELS = [
  { n: 1, elo: '≈ 400', name: 'Principiante', random: 0.45, skill: 0, depth: 1, movetime: 60 },
  { n: 2, elo: '≈ 700', name: 'Novizio', random: 0.2, skill: 0, depth: 2, movetime: 100 },
  { n: 3, elo: '≈ 1000', name: 'Amatore', random: 0.06, skill: 2, depth: 5, movetime: 200 },
  { n: 4, elo: '≈ 1200', name: 'Club', random: 0, skill: 5, depth: 8, movetime: 300 },
  { n: 5, elo: '1400', name: 'Intermedio', uciElo: 1400, movetime: 400 },
  { n: 6, elo: '1700', name: 'Esperto', uciElo: 1700, movetime: 500 },
  { n: 7, elo: '2000', name: 'Candidato maestro', uciElo: 2000, movetime: 600 },
  { n: 8, elo: '2400', name: 'Maestro', uciElo: 2400, movetime: 800 },
  { n: 9, elo: '3000+', name: 'Stockfish al massimo', skill: 20, depth: 30, movetime: 1500 }
];
export const CLOCKS = [
  { k: 'none', label: 'Senza tempo', base: 0, inc: 0 },
  { k: '10', label: '10 min', base: 600, inc: 0 },
  { k: '5+3', label: '5 | 3', base: 300, inc: 3 },
  { k: '3+2', label: '3 | 2', base: 180, inc: 2 },
  { k: '15+10', label: '15 | 10', base: 900, inc: 10 }
];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtClock(s) { s = Math.max(0, s); const m = Math.floor(s / 60), x = s % 60; return m + ':' + (x < 10 ? '0' : '') + (s < 20 ? x.toFixed(1) : Math.floor(x)); }

export function createPlay(ctx) { // ctx: {root, store, sound, toast, user(), onAnalyze(pgn), profile()}
  const P = { setup: { level: 4, color: 'w', clock: 'none' }, g: null, engine: null, board: null, timer: null, thinking: false };

  function engine() { if (!P.engine) P.engine = new Engine(); return P.engine; }
  function lvl() { return LEVELS.find((l) => l.n === (P.g ? P.g.level : P.setup.level)) || LEVELS[3]; }
  function save() { ctx.store.set('play', { setup: P.setup, g: P.g }).catch(() => {}); }

  async function load() {
    try { const d = await ctx.store.get('play'); if (d) { Object.assign(P.setup, d.setup || {}); P.g = d.g || null; } } catch (e) { /* ignore */ }
  }

  /* ---------- game state ---------- */
  function chess() { const c = new Chess(); P.g.moves.forEach((u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined })); return c; }
  function start() {
    const ck = CLOCKS.find((c) => c.k === P.setup.clock) || CLOCKS[0];
    let color = P.setup.color;
    if (color === 'r') color = Math.random() < 0.5 ? 'w' : 'b';
    P.g = { level: P.setup.level, color, clock: ck.k, base: ck.base, inc: ck.inc, time: { w: ck.base, b: ck.base }, moves: [], clocks: [], started: Date.now(), result: null, reason: '', saved: false, takebacks: 0, hints: 0 };
    engine().newGame();
    save(); render();
    if (color === 'b') botMove();
  }
  function over(c) {
    if (P.g.result) return true;
    let res = null, why = '';
    if (c.in_checkmate()) { res = c.turn() === 'w' ? '0-1' : '1-0'; why = 'scacco matto'; }
    else if (c.in_stalemate()) { res = '1/2-1/2'; why = 'stallo'; }
    else if (c.in_threefold_repetition()) { res = '1/2-1/2'; why = 'tripla ripetizione'; }
    else if (c.insufficient_material()) { res = '1/2-1/2'; why = 'materiale insufficiente'; }
    else if (c.in_draw()) { res = '1/2-1/2'; why = 'regola delle 50 mosse'; }
    if (res) { finish(res, why); return true; }
    return false;
  }
  function finish(res, why) {
    P.g.result = res; P.g.reason = why; stopTimer(); save();
    ctx.sound(res === '1/2-1/2' ? 'move' : 'ok');
    render();
  }
  function applyMove(u) {
    const c = chess(), side = c.turn();
    const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' });
    if (!m) return null;
    if (P.g.base) { tick(); P.g.time[side] += P.g.inc; }
    P.g.moves.push(m.from + m.to + (m.promotion || ''));
    P.g.clocks.push(P.g.base ? P.g.time[side] : null);
    P.g.lastTick = Date.now();
    ctx.sound(m.captured ? 'capture' : 'move');
    save();
    return { c, m };
  }

  /* ---------- clock ---------- */
  function tick() {
    if (!P.g || !P.g.base || P.g.result || !P.g.moves.length) return;
    const now = Date.now(), side = chess().turn();
    P.g.time[side] -= (now - (P.g.lastTick || now)) / 1000;
    P.g.lastTick = now;
    if (P.g.time[side] <= 0) { P.g.time[side] = 0; finish(side === 'w' ? '0-1' : '1-0', 'tempo scaduto'); }
  }
  function startTimer() {
    stopTimer();
    if (!P.g || !P.g.base || P.g.result) return;
    P.g.lastTick = Date.now();
    P.timer = setInterval(() => { tick(); paintClocks(); }, 200);
  }
  function stopTimer() { if (P.timer) clearInterval(P.timer); P.timer = null; }
  function paintClocks() {
    if (!P.g || !P.g.base) return;
    const turn = chess().turn();
    ['w', 'b'].forEach((c) => {
      const el = ctx.root.querySelector('[data-clk="' + c + '"]');
      if (el) { el.textContent = fmtClock(P.g.time[c]); el.style.opacity = turn === c && !P.g.result ? '1' : '.55'; el.classList.toggle('low', P.g.time[c] < 20); }
    });
  }

  /* ---------- bot ---------- */
  async function botMove() {
    const c = chess();
    if (P.g.result || c.turn() === P.g.color || P.thinking) return;
    P.thinking = true; paintStatus();
    const L = lvl(), game = P.g, t0 = Date.now();
    let u = null;
    try {
      const legal = c.moves({ verbose: true });
      if (L.random && Math.random() < L.random) {
        // weak levels: sometimes a random move, preferring captures and checks a beginner would see
        const nice = legal.filter((m) => m.captured || /\+/.test(m.san));
        const pool = nice.length && Math.random() < 0.5 ? nice : legal;
        const m = pool[Math.floor(Math.random() * pool.length)];
        u = m.from + m.to + (m.promotion || '');
      } else {
        const e = engine();
        e.setStrength(L.uciElo ? { elo: L.uciElo } : { skill: L.skill == null ? 20 : L.skill });
        const r = await e.analyze(c.fen(), { depth: L.depth || 40, movetime: L.movetime, multipv: 1 });
        u = r.best;
      }
    } catch (e) { ctx.toast('Il computer non risponde, riprova'); }
    // a little human-like pause
    const wait = Math.max(0, 350 + Math.random() * 400 - (Date.now() - t0));
    await new Promise((r) => setTimeout(r, wait));
    P.thinking = false;
    if (P.g !== game || game.result || !u) { paintStatus(); return; }
    const res = applyMove(u);
    if (!res) { paintStatus(); return; }
    drawBoard(true); over(res.c); render(false);
  }

  function userMove(from, to, promo) {
    if (!P.g || P.g.result || P.thinking) return;
    const c = chess();
    if (c.turn() !== P.g.color) return;
    const piece = c.get(from);
    if (!promo && piece && piece.type === 'p' && (to[1] === '8' || to[1] === '1')) { askPromotion(from, to); return; }
    const res = applyMove(from + to + (promo || ''));
    if (!res) return;
    drawBoard(true);
    if (!over(res.c)) { render(false); startTimer(); botMove(); }
  }
  function askPromotion(from, to) {
    const box = ctx.root.querySelector('#promo'); if (!box) return;
    const col = P.g.color;
    box.innerHTML = ['q', 'r', 'b', 'n'].map((p) => '<button data-p="' + p + '" aria-label="' + p + '"><img src="img/pieces/' + col + p.toUpperCase() + '.svg" alt=""></button>').join('') + '<button data-p="" class="x" aria-label="Annulla">✕</button>';
    box.hidden = false;
    box.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; box.hidden = true; if (b.dataset.p) userMove(from, to, b.dataset.p); else drawBoard(false); };
  }

  /* ---------- actions ---------- */
  function takeback() {
    if (!P.g || P.thinking || P.g.result) return;
    let n = chess().turn() === P.g.color ? 2 : 1;
    n = Math.min(n, P.g.moves.length - (P.g.color === 'b' ? 1 : 0));
    if (n <= 0) return;
    P.g.moves.splice(-n); P.g.clocks.splice(-n); P.g.takebacks++;
    save(); drawBoard(true); render(false);
  }
  async function hint() {
    if (!P.g || P.thinking || P.g.result) return;
    const c = chess(); if (c.turn() !== P.g.color) return;
    const btn = ctx.root.querySelector('#plHint'); if (btn) btn.disabled = true;
    try {
      const e = new Engine(); // full strength, separate from the bot
      const r = await e.analyze(c.fen(), { depth: 18, movetime: 1500, multipv: 1 });
      e.kill();
      P.g.hints++; save();
      if (r.best) { P.board.state.arrows = [{ from: r.best.slice(0, 2), to: r.best.slice(2, 4), color: '#81b64ce6' }]; P.board.paint(); }
    } catch (err) { ctx.toast('Suggerimento non disponibile'); }
    if (btn) btn.disabled = false;
  }
  function resign() {
    if (!P.g || P.g.result) return;
    const box = ctx.root.querySelector('#plConfirm');
    box.hidden = false;
    box.innerHTML = '<span class="grow">Vuoi abbandonare la partita?</span><button class="btn sm" id="plNo">No</button><button class="btn sm primary" id="plYes" style="background:var(--loss);box-shadow:0 3px 0 #8f2620">Abbandona</button>';
    box.querySelector('#plNo').onclick = () => { box.hidden = true; };
    box.querySelector('#plYes').onclick = () => { box.hidden = true; finish(P.g.color === 'w' ? '0-1' : '1-0', 'abbandono'); };
  }
  function pgn() {
    const g = P.g, L = lvl(), c = new Chess(), d = new Date(g.started);
    const ds = d.getUTCFullYear() + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + String(d.getUTCDate()).padStart(2, '0');
    const ts = d.toISOString().slice(11, 19), user = ctx.user(), bot = 'Stockfish livello ' + L.n;
    const term = g.reason === 'abbandono' ? (g.result === '1/2-1/2' ? '' : (g.result === '1-0' ? 'White' : 'Black') + ' won by resignation')
      : g.reason === 'tempo scaduto' ? (g.result === '1-0' ? 'White' : 'Black') + ' won on time'
        : g.reason === 'scacco matto' ? (g.result === '1-0' ? 'White' : 'Black') + ' won by checkmate' : 'Game drawn by ' + g.reason;
    const tags = { Event: 'Partita contro il computer', Site: 'Scacchiera di Vik', Date: ds, White: g.color === 'w' ? user : bot, Black: g.color === 'w' ? bot : user,
      Result: g.result || '*', WhiteElo: g.color === 'w' ? '?' : String(parseInt(L.elo.replace(/\D/g, ''), 10) || ''), BlackElo: g.color === 'b' ? '?' : String(parseInt(L.elo.replace(/\D/g, ''), 10) || ''),
      TimeControl: g.base ? g.base + (g.inc ? '+' + g.inc : '') : '-', UTCDate: ds, UTCTime: ts, StartTime: ts, Termination: term, Link: 'bot:' + g.started };
    let body = '';
    g.moves.forEach((u, i) => {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
      if (!m) return;
      if (i % 2 === 0) body += (i / 2 + 1) + '. ';
      body += m.san + (g.clocks[i] != null ? ' {[%clk ' + new Date(Math.max(0, g.clocks[i]) * 1000).toISOString().slice(11, 21).replace(/^0/, '') + ']}' : '') + ' ';
    });
    Object.keys(tags).forEach((k) => { if (tags[k] === '?' || tags[k] === '') delete tags[k]; });
    return Object.entries(tags).map(([k, v]) => '[' + k + ' "' + String(v).replace(/"/g, '') + '"]').join('\n') + '\n\n' + body + (g.result || '*');
  }

  /* ---------- rendering ---------- */
  function bar(color) {
    const g = P.g, L = lvl(), isBot = color !== g.color;
    const p = ctx.profile(), av = !isBot && p && p.avatar ? p.avatar : '';
    const name = isBot ? 'Stockfish' : ctx.user();
    const sub = isBot ? 'liv. ' + L.n + ' · ' + L.elo : '';
    return '<div class="av" style="' + (isBot ? 'background:#1d1c1a;color:var(--green)' : av ? 'background-image:url(' + esc(av) + ')' : '') + '">' + (isBot ? '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M9 2h6v2h-2v2h4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h4V4H9zM8.5 11a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM9 16v1.5h6V16z"/></svg>' : av ? '' : esc((name[0] || '?').toUpperCase())) + '</div>' +
      '<span class="nm">' + esc(name) + (sub ? ' <span class="el">' + esc(sub) + '</span>' : '') + '</span>' +
      (g.base ? '<span class="clk num' + (color === 'w' ? ' white' : '') + '" data-clk="' + color + '">' + fmtClock(g.time[color]) + '</span>' : '');
  }
  function drawBoard(animate) {
    const c = chess(), last = P.g.moves[P.g.moves.length - 1];
    let check = null;
    if (c.in_check()) { const b = Core.board(c.fen()); for (const s in b) if (b[s].t === 'k' && b[s].c === c.turn()) check = s; }
    P.board.setOrientation(P.g.color);
    P.board.set(c.fen(), { lastMove: last ? [last.slice(0, 2), last.slice(2, 4)] : null, check, animate });
    const d = {};
    if (!P.g.result && c.turn() === P.g.color && !P.thinking) c.moves({ verbose: true }).forEach((m) => { (d[m.from] = d[m.from] || []).push(m.to); });
    P.board.setMovable(Object.keys(d).length ? d : null);
  }
  function paintStatus() {
    const el = ctx.root.querySelector('#plStatus'); if (!el || !P.g) return;
    const c = chess(), mine = c.turn() === P.g.color;
    if (P.g.result) { el.textContent = ''; return; }
    el.innerHTML = P.thinking ? '<span class="spin" style="width:14px;height:14px;border-width:2px"></span> Il computer sta pensando…' : (mine ? (c.in_check() ? 'Sei sotto scacco!' : 'Tocca a te') : '');
    if (!P.thinking) drawBoard(false);
  }
  function setupHtml() {
    const s = P.setup;
    return '<h1>Gioca contro il computer</h1><div class="card stack" style="gap:16px">' +
      '<div class="stack" style="gap:8px"><span class="lbl">Livello</span><div class="lvls" id="plLvl">' +
      LEVELS.map((l) => '<button aria-pressed="' + (s.level === l.n) + '" data-v="' + l.n + '"><b>' + l.n + '</b><span>' + l.elo + '</span></button>').join('') + '</div>' +
      '<div class="muted small" id="plLvlName">' + esc(LEVELS.find((l) => l.n === s.level).name) + ' · forza stimata ' + esc(LEVELS.find((l) => l.n === s.level).elo) + ' Elo</div></div>' +
      '<div class="stack" style="gap:8px"><span class="lbl">Colore</span><div class="seg" id="plCol">' +
      [['w', 'Bianco'], ['r', 'A caso'], ['b', 'Nero']].map(([k, l]) => '<button aria-pressed="' + (s.color === k) + '" data-v="' + k + '"><i class="sqc ' + (k === 'r' ? 'r' : k) + '"></i>' + l + '</button>').join('') + '</div></div>' +
      '<div class="stack" style="gap:8px"><span class="lbl">Tempo</span><div class="chips" id="plClk">' +
      CLOCKS.map((c) => '<button aria-pressed="' + (s.clock === c.k) + '" data-v="' + c.k + '">' + c.label + '</button>').join('') + '</div></div>' +
      '<button class="btn primary big" id="plStart">Gioca</button></div>';
  }
  function render(full = true) {
    const root = ctx.root;
    if (!P.g) {
      root.innerHTML = setupHtml();
      const pick = (id, key, num) => root.querySelector(id).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; P.setup[key] = num ? +b.dataset.v : b.dataset.v; save(); render(); };
      pick('#plLvl', 'level', true); pick('#plCol', 'color'); pick('#plClk', 'clock');
      root.querySelector('#plStart').onclick = start;
      return;
    }
    if (full || !root.querySelector('#plBoard')) {
      root.innerHTML = '<div class="rv"><div class="stack" style="gap:8px">' +
        '<div class="playerbar" id="plTop"></div><div class="pboard"><div id="plBoard"></div><div class="promo" id="promo" hidden></div></div><div class="playerbar" id="plBot"></div>' +
        '<div class="small muted" id="plStatus" style="min-height:22px;display:flex;align-items:center;gap:8px"></div></div>' +
        '<div class="rv-side stack" id="plSide"></div></div>';
      P.board = new Board(root.querySelector('#plBoard'), { onMove: (f, t) => userMove(f, t) });
    }
    const g = P.g, top = g.color === 'w' ? 'b' : 'w';
    root.querySelector('#plTop').innerHTML = bar(top);
    root.querySelector('#plBot').innerHTML = bar(g.color);
    if (full) drawBoard(false);
    // side panel
    const c = chess(), hist = c.history();
    let h = '';
    if (g.result) {
      const win = (g.result === '1-0' && g.color === 'w') || (g.result === '0-1' && g.color === 'b');
      const draw = g.result === '1/2-1/2';
      h += '<div class="pz-status ' + (draw ? '' : win ? 'ok' : 'ko') + '"><div><b style="font-size:18px">' + (draw ? 'Patta' : win ? 'Hai vinto!' : 'Hai perso') + '</b><div class="small">' + esc(g.reason) + ' · ' + g.result + '</div></div></div>' +
        '<button class="btn primary big" id="plAnalyze">' + (g.saved ? 'Apri la revisione' : 'Analizza la partita') + '</button>' +
        '<div class="row"><button class="btn grow" id="plAgain">Rivincita</button><button class="btn grow" id="plNew">Nuova partita</button></div>';
    } else {
      h += '<div class="card small"><div class="row"><span class="grow"><b>Livello ' + lvl().n + '</b> · ' + esc(lvl().name) + '</span><span class="dim">' + (g.base ? esc((CLOCKS.find((x) => x.k === g.clock) || {}).label || '') : 'senza tempo') + '</span></div></div>' +
        '<div class="ctrls" style="grid-template-columns:repeat(3,1fr)">' +
        '<button class="btn" id="plBack"' + (g.moves.length ? '' : ' disabled') + '>Annulla</button>' +
        '<button class="btn" id="plHint">Aiuto</button>' +
        '<button class="btn" id="plResign">Abbandona</button></div>' +
        '<div class="row card flat" id="plConfirm" hidden></div>';
    }
    let ml = '';
    for (let i = 0; i < hist.length; i += 2) ml += '<span class="n">' + (i / 2 + 1) + '.</span><span class="mv">' + esc(hist[i]) + '</span><span class="mv">' + esc(hist[i + 1] || '') + '</span>';
    h += '<div class="moves" id="plMoves" style="max-height:260px">' + (ml || '<span class="n" style="grid-column:1/-1">Le mosse appariranno qui.</span>') + '</div>';
    if (g.takebacks || g.hints) h += '<p class="dim small" style="margin:0">Mosse annullate: ' + g.takebacks + ' · aiuti usati: ' + g.hints + '</p>';
    const side = root.querySelector('#plSide'); side.innerHTML = h;
    const mv = side.querySelector('#plMoves'); mv.scrollTop = mv.scrollHeight;
    const on = (id, fn) => { const e = side.querySelector(id); if (e) e.onclick = fn; };
    on('#plBack', takeback); on('#plHint', hint); on('#plResign', resign);
    on('#plAnalyze', () => { const text = pgn(); P.g.saved = true; save(); ctx.onAnalyze(text); });
    on('#plAgain', () => { P.setup.level = g.level; P.setup.color = g.color === 'w' ? 'b' : 'w'; P.setup.clock = g.clock; start(); });
    on('#plNew', () => { P.g = null; save(); render(); });
    paintClocks(); paintStatus();
  }

  return {
    async show() {
      if (!P.loaded) { await load(); P.loaded = true; }
      render();
      if (P.g && !P.g.result) { startTimer(); botMove(); }
    },
    hide() { stopTimer(); if (P.g && P.g.base && !P.g.result) { tick(); save(); } }
  };
}

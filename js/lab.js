// "Analisi": free board. Set up any position (editor, FEN or PGN), move both sides and let
// Stockfish analyse at the depth you choose. Brilliant and only-moves are always flagged:
// in the candidate lines, deeper inside the best line, and on the moves you play.
import { Board } from './board.js';
import { Engine, ensureEngine, engineLabel } from './engine.js';
import { LEVELS } from './play.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const DEPTH_OPTS = [10, 14, 18, 22, 26, 30, 0]; // 0 = no limit
const BRILL = '#1fb8a8e6', GREAT = '#5c8bb0e6', BEST = '#81b64ce6', ALT = '#f3a536';
const FILES = 'abcdefgh';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ci = (cls) => '<span class="ci sm c-' + cls + '" title="' + esc(Core.CLASS_NAME[cls]) + '">' + Core.CLASS_SYM[cls] + '</span>';
const turnOf = (fen) => fen.split(' ')[1];
const evOf = (l, fen) => { const s = turnOf(fen) === 'w' ? 1 : -1; return l.mate != null ? { mate: l.mate * s } : { cp: l.cp * s }; };
const moverWp = (l, fen) => { const wp = Core.winPct(evOf(l, fen)); return turnOf(fen) === 'w' ? wp : 100 - wp; };
const mateFor = (l) => l && l.mate != null && l.mate > 0;

/* ---------- brilliant / only-move detection ---------- */
// For each candidate line: is its first move brilliant (a real sacrifice that keeps the
// evaluation) or the only good move? And which later moves of the line are brilliant sacrifices?
function scanLines(fen, lines) {
  const out = [];
  const L0 = lines[0]; if (!L0 || !L0.pv || !L0.pv.length) return out;
  const best = moverWp(L0, fen);
  lines.forEach((l, k) => {
    if (!l || !l.pv || !l.pv.length) return;
    const wp = moverWp(l, fen), loss = Math.max(0, best - wp), mate = mateFor(l);
    let cls = null;
    if (loss < 2 && wp >= 45 && (best < 97 || mate) && Core.isSacrifice(fen, l.pv[0])) cls = 'brilliant';
    else if (k === 0 && lines[1] && lines[1].pv && lines[1].pv.length && best - moverWp(lines[1], fen) >= 15 && wp >= 35 && best < 97) cls = 'great';
    const deep = [];
    if (loss < 5) {
      let f = fen;
      for (let i = 0; i < l.pv.length && i < 14; i++) {
        const u = l.pv[i];
        if (i > 0) {
          const side = i % 2 === 0 ? wp : 100 - wp, sideMate = i % 2 === 0 ? mate : false;
          if (side >= 45 && (side < 97 || sideMate) && Core.isSacrifice(f, u)) deep.push(i);
        }
        const r = Core.applyUci(f, u); if (!r) break;
        f = r.fen;
      }
    }
    out[k] = { cls, loss, wp, deep };
  });
  return out;
}

export function createLab(ctx) { // ctx: {root, store, sound, toast, visible()}
  const L = {
    fen0: START, moves: [], sans: [], fens: [START], ply: 0, flip: false,
    depth: 22, multipv: 3, on: true,
    lines: [], depthNow: 0, done: false, t0: 0,
    mode: 'analyze', edit: null,
    game: null, gsetup: { level: 5, color: 'turn' }, setupOpen: false
  };
  const cache = new Map(); // fen -> {lines, depth, full}
  let engine = null, board = null, tok = 0, paintT = 0, clockT = 0, built = false;
  let botEngine = null, gtok = 0;

  function eng() { engine = ensureEngine(engine); return engine; }
  function save() { ctx.store.set('lab', { fen0: L.fen0, moves: L.moves, ply: L.ply, flip: L.flip, depth: L.depth, multipv: L.multipv, on: L.on, game: L.game ? Object.assign({}, L.game, { thinking: false }) : null, gsetup: L.gsetup }).catch(() => {}); }
  async function load() {
    try {
      const d = await ctx.store.get('lab');
      if (d) {
        Object.assign(L, { depth: d.depth != null ? d.depth : 22, multipv: d.multipv || 3, on: d.on !== false, flip: !!d.flip });
        setLine(d.fen0 || START, d.moves || [], d.ply);
        if (d.gsetup) L.gsetup = d.gsetup;
        if (d.game && d.game.startPly <= L.moves.length) { L.game = d.game; L.ply = L.moves.length; }
      }
    } catch (e) { /* ignore */ }
  }
  // replace the whole line (start position + moves)
  function setLine(fen0, moves, ply) {
    const c = new Chess(fen0);
    L.fen0 = fen0; L.moves = []; L.sans = []; L.fens = [c.fen()];
    for (const u of moves) {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
      if (!m) break;
      L.moves.push(m.from + m.to + (m.promotion || '')); L.sans.push(m.san); L.fens.push(c.fen());
    }
    L.ply = Math.max(0, Math.min(ply == null ? L.moves.length : ply, L.moves.length));
  }
  const curFen = () => L.fens[L.ply];

  /* ---------- engine ---------- */
  function stopEngine() { tok++; clearInterval(clockT); if (engine) engine.stop(); }
  function analyze() {
    stopEngine();
    const my = tok, fen = curFen(), have = cache.get(fen);
    L.lines = have ? have.lines : []; L.depthNow = have ? have.depth : 0; L.done = false; L.t0 = Date.now();
    if (L.mode !== 'analyze') return;
    if (L.game || L.setupOpen) { L.lines = []; drawBoard(false); paintEval(); paintMoves(); paintCtrls(); return; } // playing: no engine help
    const ch = new Chess(fen);
    if (ch.game_over()) { L.lines = []; L.done = true; paint(); return; }
    if (have && have.full && L.depth && have.depth >= L.depth) { L.done = true; paint(); return; }
    if (!L.on) { paint(); return; }
    const need = Math.max(3, L.multipv), target = L.depth || 0;
    clockT = setInterval(() => { if (my === tok) paintEngineHead(); }, 1000);
    eng().think(fen, (lines, d) => {
      if (my !== tok || d < 4) return;
      const prev = cache.get(fen);
      if (prev && prev.depth > d) return; // a deeper result from before is still better
      const copy = lines.filter(Boolean).map((l) => Object.assign({}, l, { pv: l.pv.slice() }));
      if (!copy.length) return;
      cache.set(fen, { lines: copy, depth: d, full: false });
      L.lines = copy; L.depthNow = d;
      const now = Date.now(); if (now - paintT < 250) return; paintT = now;
      paint();
    }, {
      multipv: need, depth: target || null,
      onDone: () => {
        if (my !== tok) return;
        clearInterval(clockT);
        L.done = true;
        const c = cache.get(fen); if (c) c.full = true;
        paint();
      }
    }).catch(() => ctx.toast('Il motore non si è avviato'));
    paint();
  }

  /* ---------- judging the moves played on the board ---------- */
  function judge(i) {
    const fa = L.fens[i], fb = L.fens[i + 1], u = L.moves[i];
    const A = cache.get(fa);
    if (!A || A.depth < 10 || !A.lines[0] || !A.lines[0].pv.length) return null;
    const best = moverWp(A.lines[0], fa);
    const isBest = A.lines[0].pv[0].slice(0, 4) === u.slice(0, 4);
    const inLine = A.lines.find((l) => l && l.pv && l.pv[0] && l.pv[0].slice(0, 4) === u.slice(0, 4));
    const B = cache.get(fb), cb = new Chess(fb);
    let after;
    if (cb.in_checkmate()) after = 100;
    else if (cb.game_over()) after = 50;
    else if (B && B.depth >= 10 && B.lines[0]) after = 100 - moverWp(B.lines[0], fb);
    else if (inLine) after = moverWp(inLine, fa);
    else return null;
    const loss = isBest ? 0 : Math.max(0, best - after);
    let cls = loss < 1 ? 'best' : loss < 2 ? 'excellent' : loss < 5 ? 'good' : loss < 10 ? 'inaccuracy' : loss < 20 ? 'mistake' : 'blunder';
    const hadMate = mateFor(A.lines[0]);
    if (hadMate && cls !== 'best' && !(B && B.lines[0] && B.lines[0].mate != null && B.lines[0].mate < 0) && after < 100 && loss < 20) cls = 'miss';
    if (cls === 'best' || cls === 'excellent') {
      const second = A.lines[1] && A.lines[1].pv && A.lines[1].pv.length ? moverWp(A.lines[1], fa) : null;
      if (Core.isSacrifice(fa, u) && after >= 45 && (best < 97 || hadMate)) cls = 'brilliant';
      else if (isBest && second != null && best - second >= 15 && after >= 35 && best < 97) cls = 'great';
    }
    // was there a brilliant move the player did not choose?
    let missed = null;
    if (cls !== 'brilliant') {
      const sc = scanLines(fa, A.lines);
      const k = sc.findIndex((s) => s && s.cls === 'brilliant');
      if (k >= 0 && A.lines[k].pv[0].slice(0, 4) !== u.slice(0, 4)) missed = A.lines[k].pv[0];
    }
    return { cls, loss, best: A.lines[0].pv[0], missed };
  }

  /* ---------- moves ---------- */
  function play(uci, quiet) {
    if (L.mode !== 'analyze') return false;
    const fen = curFen(), c = new Chess(fen);
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
    if (!m) return false;
    const u = m.from + m.to + (m.promotion || '');
    if (L.moves[L.ply] === u) L.ply++;
    else {
      L.moves.splice(L.ply); L.sans.splice(L.ply); L.fens.splice(L.ply + 1);
      L.moves.push(u); L.sans.push(m.san); L.fens.push(c.fen()); L.ply++;
    }
    if (!quiet) ctx.sound(m.captured ? 'capture' : 'move');
    save();
    return true;
  }
  function userMove(from, to, promo) {
    const G = L.game;
    if (G && (G.result || G.thinking || turnOf(curFen()) !== G.color)) return;
    const c = new Chess(curFen()), p = c.get(from);
    if (!promo && p && p.type === 'p' && (to[1] === '8' || to[1] === '1')) { askPromotion(from, to, p.color); return; }
    if (!play(from + to + (promo || ''))) return;
    if (G) { if (!gameOver()) { save(); drawAll(true); botMove(); } return; }
    drawAll(true); analyze();
  }
  function askPromotion(from, to, col) {
    const box = ctx.root.querySelector('#lbPromo');
    box.innerHTML = ['q', 'r', 'b', 'n'].map((p) => '<button data-p="' + p + '" aria-label="' + p + '"><img src="img/pieces/' + col + p.toUpperCase() + '.svg" alt=""></button>').join('') + '<button data-p="" class="x" aria-label="Annulla">✕</button>';
    box.hidden = false;
    box.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; box.hidden = true; if (b.dataset.p) userMove(from, to, b.dataset.p); else drawBoard(false); };
  }
  function goTo(p) {
    if (L.game) return;
    p = Math.max(0, Math.min(L.moves.length, p));
    if (p === L.ply) return;
    const fwd = p === L.ply + 1, near = Math.abs(p - L.ply) === 1;
    L.ply = p; save();
    if (fwd) ctx.sound(/x/.test(L.sans[p - 1]) ? 'capture' : 'move');
    drawAll(near); analyze();
  }
  function playLine(k, upto) { // play the candidate line k up to move index upto
    const l = L.lines[k]; if (!l || !l.pv) return;
    for (let i = 0; i <= upto && i < l.pv.length; i++) if (!play(l.pv[i], i < upto)) break;
    ctx.sound('move');
    drawAll(true); analyze();
  }

  /* ---------- playing against the computer from any position ---------- */
  function bot() { if (!botEngine) botEngine = new Engine('lite'); return botEngine; } // strength-limited bot: the light engine is plenty
  function chessAt(ply) { // with history, so threefold repetition is detected
    const c = new Chess(L.fen0);
    for (let i = 0; i < ply; i++) { const u = L.moves[i]; c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); }
    return c;
  }
  function startGame() {
    stopEngine(); gtok++;
    const fen = curFen(), S = L.gsetup;
    if (new Chess(fen).game_over()) { ctx.toast('Da questa posizione la partita è già finita'); return; }
    const color = S.color === 'turn' ? turnOf(fen) : S.color;
    L.moves.splice(L.ply); L.sans.splice(L.ply); L.fens.splice(L.ply + 1);
    L.game = { color, level: S.level, startPly: L.ply, startFen: fen, result: null, reason: '', thinking: false, takebacks: 0 };
    L.setupOpen = false; L.flip = color === 'b';
    bot().newGame();
    save(); build();
    botMove();
  }
  function gameOver() {
    const G = L.game; if (!G || G.result) return !!(G && G.result);
    const c = chessAt(L.ply);
    let res = null, why = '';
    if (c.in_checkmate()) { res = c.turn() === 'w' ? '0-1' : '1-0'; why = 'scacco matto'; }
    else if (c.in_stalemate()) { res = '1/2-1/2'; why = 'stallo'; }
    else if (c.in_threefold_repetition()) { res = '1/2-1/2'; why = 'tripla ripetizione'; }
    else if (c.insufficient_material()) { res = '1/2-1/2'; why = 'materiale insufficiente'; }
    else if (c.in_draw()) { res = '1/2-1/2'; why = 'regola delle 50 mosse'; }
    if (!res) return false;
    endGame(res, why);
    return true;
  }
  function endGame(res, why) {
    const G = L.game; gtok++;
    G.result = res; G.reason = why; G.thinking = false;
    ctx.sound(res === '1/2-1/2' ? 'move' : 'ok');
    save(); drawAll(false);
  }
  async function botMove() {
    const G = L.game;
    if (!G || G.result || G.thinking || !ctx.visible()) return;
    const fen = curFen(); if (turnOf(fen) === G.color) return;
    const my = ++gtok, t0 = Date.now();
    G.thinking = true; drawAll(false);
    const Lv = LEVELS.find((l) => l.n === G.level) || LEVELS[4], c = new Chess(fen);
    let u = null;
    try {
      const legal = c.moves({ verbose: true });
      if (Lv.random && Math.random() < Lv.random) {
        const nice = legal.filter((m) => m.captured || /\+/.test(m.san));
        const pool = nice.length && Math.random() < 0.5 ? nice : legal;
        const m = pool[Math.floor(Math.random() * pool.length)];
        u = m.from + m.to + (m.promotion || '');
      } else {
        const e = bot();
        e.setStrength(Lv.uciElo ? { elo: Lv.uciElo } : { skill: Lv.skill == null ? 20 : Lv.skill });
        const r = await e.analyze(fen, { depth: Lv.depth || 40, movetime: Lv.movetime, multipv: 1 });
        u = r.best;
      }
    } catch (e) { if (my === gtok) ctx.toast('Il computer non risponde, riprova'); }
    const wait = Math.max(0, 350 + Math.random() * 400 - (Date.now() - t0));
    await new Promise((r) => setTimeout(r, wait));
    if (my !== gtok || L.game !== G) return;
    G.thinking = false;
    if (!u || !play(u)) { drawAll(false); return; }
    if (!gameOver()) { save(); drawAll(true); }
  }
  function takeback() {
    const G = L.game; if (!G || G.result) return;
    gtok++; G.thinking = false;
    let n = turnOf(curFen()) === G.color ? 2 : 1;
    n = Math.min(n, L.ply - G.startPly);
    if (n <= 0) { drawAll(false); botMove(); return; }
    L.ply -= n; L.moves.splice(L.ply); L.sans.splice(L.ply); L.fens.splice(L.ply + 1);
    G.takebacks++; save(); drawAll(true);
    botMove(); // if the computer had the move at the start
  }
  function resign() {
    const G = L.game; if (!G || G.result) return;
    endGame(G.color === 'w' ? '0-1' : '1-0', 'abbandono');
  }
  function rematch() {
    const G = L.game; if (!G) return;
    L.ply = G.startPly; L.gsetup = { level: G.level, color: G.color };
    L.game = null; startGame();
  }
  function leaveGame(review) {
    const G = L.game; gtok++;
    L.game = null; save(); build();
    if (review && G) reviewGame(G);
    analyze();
  }
  // after the game: quick pass over its positions so every move gets its judgement (and missed brilliants)
  async function reviewGame(G) {
    const my = gtok, e = bot();
    e.setStrength({ skill: 20 });
    ctx.toast('Sto giudicando le mosse della partita…');
    for (let i = G.startPly; i < L.fens.length; i++) {
      if (my !== gtok || L.game) return;
      const fen = L.fens[i], have = cache.get(fen);
      if ((have && have.depth >= 14) || new Chess(fen).game_over()) continue;
      try {
        const r = await e.analyze(fen, { depth: 14, movetime: 1500, multipv: 3 });
        if (my !== gtok) return;
        const now = cache.get(fen);
        if (!now || now.depth < 14) cache.set(fen, { lines: r.lines.map((l) => Object.assign({}, l, { pv: l.pv.slice() })), depth: 14, full: false });
        if (ctx.visible() && L.mode === 'analyze' && !L.game) { paintMoves(); if (i === L.ply || i === L.ply - 1) { drawBoard(false); paintBrill(scanLines(curFen(), L.lines)); } }
      } catch (err) { return; }
    }
  }
  function gameHtml() {
    const G = L.game, Lv = LEVELS.find((l) => l.n === G.level) || LEVELS[4];
    const you = G.color === 'w' ? 'il bianco' : 'il nero';
    let h = '<div class="card stack lab-game" style="gap:10px"><div class="row" style="gap:8px"><span class="grow"><b>Contro Stockfish</b> · livello ' + Lv.n + ' <span class="dim">(' + esc(Lv.elo) + ')</span></span><span class="dim small">giochi ' + you + '</span></div>';
    if (G.result) {
      const win = (G.result === '1-0' && G.color === 'w') || (G.result === '0-1' && G.color === 'b'), draw = G.result === '1/2-1/2';
      h += '<div class="pz-status ' + (draw ? '' : win ? 'ok' : 'ko') + '"><div><b style="font-size:18px">' + (draw ? 'Patta' : win ? 'Hai vinto!' : 'Hai perso') + '</b><div class="small">' + esc(G.reason) + ' · ' + G.result + '</div></div></div>' +
        '<button class="btn primary big" id="lbGReview">Analizza la partita</button>' +
        '<div class="row" style="gap:6px"><button class="btn grow" id="lbGAgain">Rivincita da qui</button><button class="btn grow" id="lbGExit">Chiudi</button></div>';
    } else {
      const mine = turnOf(curFen()) === G.color, inCheck = new Chess(curFen()).in_check();
      h += '<div class="small muted" id="lbGStatus" style="min-height:22px;display:flex;align-items:center;gap:8px">' +
        (G.thinking ? '<span class="spin" style="width:14px;height:14px;border-width:2px"></span> Il computer sta pensando…' : mine ? (inCheck ? 'Sei sotto scacco!' : 'Tocca a te') : '') + '</div>' +
        '<div class="ctrls" style="grid-template-columns:repeat(3,1fr)"><button class="btn" id="lbGBack"' + (L.ply > G.startPly ? '' : ' disabled') + '>Annulla</button><button class="btn" id="lbGFlip">Gira</button><button class="btn" id="lbGResign">Abbandona</button></div>' +
        '<p class="dim small" style="margin:0">Il motore è spento finché giochi: niente frecce, valutazioni o suggerimenti.' + (G.takebacks ? ' Mosse annullate: ' + G.takebacks + '.' : '') + '</p>';
    }
    return h + '</div>';
  }
  function setupHtml() {
    const S = L.gsetup;
    return '<div class="card stack" id="lbSetup" style="gap:14px"><div class="row"><b class="grow">Gioca contro il computer da qui</b><button class="btn sm ghost" id="lbSetupX" aria-label="Chiudi">✕</button></div>' +
      '<div class="stack" style="gap:8px"><span class="lbl">Livello</span><div class="lvls" id="lbLvl">' +
      LEVELS.map((l) => '<button aria-pressed="' + (S.level === l.n) + '" data-v="' + l.n + '"><b>' + l.n + '</b><span>' + l.elo + '</span></button>').join('') + '</div>' +
      '<div class="muted small">' + esc((LEVELS.find((l) => l.n === S.level) || LEVELS[4]).name) + '</div></div>' +
      '<div class="stack" style="gap:8px"><span class="lbl">Tu giochi</span><div class="seg" id="lbGCol">' +
      [['turn', 'Di turno'], ['w', 'Bianco'], ['b', 'Nero']].map(([k, l]) => '<button aria-pressed="' + (S.color === k) + '" data-v="' + k + '"><i class="sqc ' + (k === 'turn' ? turnOf(curFen()) : k) + '"></i>' + l + '</button>').join('') + '</div></div>' +
      '<button class="btn primary big" id="lbGStart">Inizia la partita</button></div>';
  }
  function bindGame() {
    const r = ctx.root, on = (id, fn) => { const e = r.querySelector(id); if (e) e.onclick = fn; };
    on('#lbGBack', takeback); on('#lbGResign', resign);
    on('#lbGFlip', () => { L.flip = !L.flip; save(); drawBoard(false); paintEval(); });
    on('#lbGReview', () => leaveGame(true)); on('#lbGExit', () => leaveGame(false)); on('#lbGAgain', rematch);
    on('#lbSetupX', () => { L.setupOpen = false; build(); analyze(); });
    on('#lbGStart', startGame);
    const pick = (id, key, num) => on(id, (e) => { const b = e.target.closest('button'); if (!b) return; L.gsetup[key] = num ? +b.dataset.v : b.dataset.v; save(); const box = r.querySelector('#lbSetup'); box.outerHTML = setupHtml(); bindGame(); });
    pick('#lbLvl', 'level', true); pick('#lbGCol', 'color');
  }
  function paintGame() {
    const box = ctx.root.querySelector('.lab-game'); if (!box || !L.game) return;
    box.outerHTML = gameHtml(); bindGame();
  }

  /* ---------- editor ---------- */
  function startEdit() {
    stopEngine();
    const b = Core.board(curFen()), pos = {};
    for (const s in b) pos[s] = b[s].c + b[s].t.toUpperCase();
    L.mode = 'edit';
    L.edit = { pos, turn: turnOf(curFen()), tool: 'wP', err: '' };
    build();
  }
  function editFen() {
    const E = L.edit; let rows = [];
    for (let r = 8; r >= 1; r--) {
      let row = '', gap = 0;
      for (let f = 0; f < 8; f++) {
        const p = E.pos[FILES[f] + r];
        if (!p) { gap++; continue; }
        if (gap) { row += gap; gap = 0; }
        row += p[0] === 'w' ? p[1] : p[1].toLowerCase();
      }
      rows.push(row + (gap || ''));
    }
    const at = (s, p) => E.pos[s] === p;
    let cas = '';
    if (at('e1', 'wK') && at('h1', 'wR')) cas += 'K';
    if (at('e1', 'wK') && at('a1', 'wR')) cas += 'Q';
    if (at('e8', 'bK') && at('h8', 'bR')) cas += 'k';
    if (at('e8', 'bK') && at('a8', 'bR')) cas += 'q';
    return rows.join('/') + ' ' + E.turn + ' ' + (cas || '-') + ' - 0 1';
  }
  function checkFen(fen) {
    const v = new Chess().validate_fen(fen);
    if (v && !v.valid) return 'FEN non valido: ' + v.error;
    const place = fen.split(' ')[0];
    const nK = (place.match(/K/g) || []).length, nk = (place.match(/k/g) || []).length;
    if (nK !== 1 || nk !== 1) return 'Serve esattamente un re per colore.';
    const rows = place.split('/');
    if (/[pP]/.test(rows[0]) || /[pP]/.test(rows[7])) return 'Non possono esserci pedoni in prima o in ottava traversa.';
    const parts = fen.split(' '); parts[1] = parts[1] === 'w' ? 'b' : 'w'; parts[3] = '-';
    const other = new Chess(); if (other.load(parts.join(' ')) && other.in_check()) return 'Il re di chi non ha il tratto è sotto scacco: cambia il colore che muove.';
    return '';
  }
  function editTap(sq) {
    const E = L.edit, t = E.tool;
    if (t === 'x') delete E.pos[sq];
    else if (E.pos[sq] === t) delete E.pos[sq];
    else {
      if (t[1] === 'K') for (const s in E.pos) if (E.pos[s] === t) delete E.pos[s]; // one king per side
      E.pos[sq] = t;
    }
    E.err = '';
    drawBoard(false); paintEditor();
  }
  function finishEdit() {
    const fen = editFen(), err = checkFen(fen);
    if (err) { L.edit.err = err; paintEditor(); return; }
    L.mode = 'analyze'; L.edit = null;
    setLine(fen, [], 0); save();
    build(); analyze();
  }
  function loadText(txt) {
    txt = String(txt || '').trim(); if (!txt) return;
    if (/^([rnbqkpRNBQKP1-8]+\/){7}[rnbqkpRNBQKP1-8]+(\s|$)/.test(txt)) {
      let fen = txt.split(/\s+/).slice(0, 6).join(' ');
      const n = fen.split(' ').length;
      if (n < 6) fen += [' w', ' -', ' -', ' 0', ' 1'].slice(n - 1).join('');
      const err = checkFen(fen);
      if (err) { ctx.toast(err); return; }
      setLine(fen, [], 0);
    } else {
      const c = new Chess();
      if (!c.load_pgn(txt, { sloppy: true })) { ctx.toast('Non riconosco né un FEN né un PGN'); return; }
      const h = c.header(), hist = c.history({ verbose: true });
      setLine(h.FEN || START, hist.map((m) => m.from + m.to + (m.promotion || '')), 0);
    }
    L.mode = 'analyze'; L.edit = null; save(); build(); analyze();
    ctx.toast('Posizione caricata');
  }
  // public: open a position coming from the review
  function openFen(fen, label) {
    stopEngine();
    setLine(fen, [], 0);
    L.flip = turnOf(fen) === 'b';
    L.mode = 'analyze'; L.edit = null; L.game = null; L.setupOpen = false; gtok++; save();
    if (built) build();
    if (label) ctx.toast(label);
  }

  /* ---------- rendering ---------- */
  function drawBoard(animate) {
    if (!board) return;
    board.setOrientation(L.flip ? 'b' : 'w');
    if (L.mode === 'edit') {
      board.set(editFen(), { animate: false });
      board.setMovable(null);
      return;
    }
    const fen = curFen(), ch = new Chess(fen), G = L.game;
    let lastMove = null, mark = null, check = null;
    const arrows = [];
    if (G || L.setupOpen) {
      if (L.ply > 0) { const u = L.moves[L.ply - 1]; lastMove = [u.slice(0, 2), u.slice(2, 4)]; }
      if (ch.in_check()) { const b = Core.board(fen); for (const s in b) if (b[s].t === 'k' && b[s].c === turnOf(fen)) check = s; }
      board.setOrientation(L.flip ? 'b' : 'w');
      board.set(fen, { lastMove, check, animate });
      const d = {};
      if (!G || (!G.result && !G.thinking && turnOf(fen) === G.color)) ch.moves({ verbose: true }).forEach((m) => { (d[m.from] = d[m.from] || []).push(m.to); });
      board.setMovable(Object.keys(d).length ? d : null);
      return;
    }
    if (L.ply > 0) {
      const u = L.moves[L.ply - 1]; lastMove = [u.slice(0, 2), u.slice(2, 4)];
      const j = judge(L.ply - 1); if (j) mark = { sq: u.slice(2, 4), cls: j.cls };
    }
    if (ch.in_check()) { const b = Core.board(fen); for (const s in b) if (b[s].t === 'k' && b[s].c === turnOf(fen)) check = s; }
    const sc = scanLines(fen, L.lines);
    L.lines.slice(0, L.multipv).forEach((l, k) => {
      if (!l || !l.pv || !l.pv[0]) return;
      const u = l.pv[0], s = sc[k] || {};
      if (s.cls === 'brilliant') arrows.push({ from: u.slice(0, 2), to: u.slice(2, 4), color: BRILL, width: 2.6 });
      else if (k === 0) arrows.push({ from: u.slice(0, 2), to: u.slice(2, 4), color: s.cls === 'great' ? GREAT : BEST });
      else arrows.push({ from: u.slice(0, 2), to: u.slice(2, 4), color: ALT, width: 1.7, opacity: 0.55 });
    });
    // a brilliant move hidden beyond the chosen number of lines is still shown
    L.lines.slice(L.multipv).forEach((l, i) => {
      const s = sc[L.multipv + i]; if (s && s.cls === 'brilliant') arrows.push({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), color: BRILL, width: 2.6 });
    });
    board.set(fen, { lastMove, mark, arrows: arrows.reverse(), check, animate });
    const d = {};
    ch.moves({ verbose: true }).forEach((m) => { (d[m.from] = d[m.from] || []).push(m.to); });
    board.setMovable(Object.keys(d).length ? d : null);
  }
  function paintEval() {
    const bar = ctx.root.querySelector('#lbEval'); if (!bar) return;
    const fen = curFen(), l = L.mode === 'analyze' && !L.game && !L.setupOpen && L.lines[0];
    let ev = l ? evOf(l, fen) : null;
    const ch = new Chess(fen);
    if (L.mode === 'analyze' && !L.game && !L.setupOpen && ch.in_checkmate()) ev = { mate: turnOf(fen) === 'w' ? -0.001 : 0.001 };
    const wp = ev ? Core.winPct(ev) : 50;
    bar.classList.toggle('flip', L.flip);
    bar.querySelector('.f').style.height = wp.toFixed(1) + '%';
    const t = bar.querySelector('.t'); t.textContent = ev ? Core.evalText(ev).replace('+', '') : '';
    const ws = wp >= 50; t.style.bottom = ws ? '4px' : 'auto'; t.style.top = ws ? 'auto' : '4px'; t.style.color = ws ? '#1b1a19' : '#f4f1ea';
  }
  function engineHeadHtml() {
    const fen = curFen(), ch = new Chess(fen);
    if (ch.game_over()) return '<span class="dotl done"></span>' + (ch.in_checkmate() ? 'Scacco matto' : 'Partita finita: patta');
    if (!L.on && !L.done) return '<span class="dotl done"></span>Motore in pausa' + (L.depthNow ? ' · profondità ' + L.depthNow : '');
    const secs = Math.round((Date.now() - L.t0) / 1000);
    const tgt = L.depth ? '/' + L.depth : '';
    return '<span class="dotl' + (L.done ? ' done' : '') + '"></span>' + engineLabel() + ' · ' +
      (L.depthNow ? 'profondità <b class="num">' + L.depthNow + tgt + '</b>' : 'sto pensando…') +
      (L.done ? ' <span class="ok">✓ completa</span>' : (secs >= 2 ? ' <span class="dim num">· ' + secs + ' s</span>' : '')) +
      (!L.depth && !L.done ? ' <span class="dim">· senza limite</span>' : '');
  }
  function paintEngineHead() {
    const h = ctx.root.querySelector('#lbHead'); if (h) h.innerHTML = engineHeadHtml();
    const p = ctx.root.querySelector('#lbProg i');
    if (p) p.style.width = (L.done ? 100 : L.depth ? Math.min(100, 100 * L.depthNow / L.depth) : 0).toFixed(0) + '%';
  }
  function pvHtml(fen, l, k, deep) {
    const ch = new Chess(fen), no = startNo(fen), off = turnOf(fen) === 'b' ? 1 : 0;
    let h = '';
    for (let i = 0; i < l.pv.length && i < 12; i++) {
      const u = l.pv[i], m = ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' });
      if (!m) break;
      const n = no + Math.floor((i + off) / 2);
      const num = m.color === 'w' ? n + '. ' : (i === 0 ? n + '… ' : '');
      h += '<span class="pvm' + (deep.includes(i) ? ' brl' : '') + '" data-k="' + k + '" data-i="' + i + '">' + esc(num) + esc(m.san) + (deep.includes(i) ? '!!' : '') + '</span> ';
    }
    return h;
  }
  const startNo = (fen) => +fen.split(' ')[5] || 1;
  function paintLines() {
    const box = ctx.root.querySelector('#lbLines'); if (!box) return;
    const fen = curFen(), sc = scanLines(fen, L.lines);
    let h = '';
    if (new Chess(fen).game_over()) { box.innerHTML = ''; paintBrill(sc); return; }
    for (let k = 0; k < L.multipv; k++) {
      const l = L.lines[k];
      if (!l || !l.pv || !l.pv.length) { h += '<div class="line" style="opacity:.35"><span class="e num">…</span><span class="p"></span></div>'; continue; }
      const e = evOf(l, fen), s = sc[k] || { deep: [] };
      h += '<div class="line lab-line' + (s.cls === 'brilliant' ? ' is-brill' : '') + '" data-k="' + k + '"><span class="e num' + (Core.winPct(e) >= 50 ? ' w' : '') + '">' + Core.evalText(e) + '</span>' +
        (s.cls ? ci(s.cls) : '') + '<span class="p">' + pvHtml(fen, l, k, s.deep || []) + '</span></div>';
    }
    box.innerHTML = h;
    paintBrill(sc);
  }
  function paintBrill(sc) {
    const box = ctx.root.querySelector('#lbBrill'); if (!box) return;
    const fen = curFen(); let h = '';
    const k = sc.findIndex((s) => s && s.cls === 'brilliant');
    if (k >= 0) {
      const l = L.lines[k], san = Core.sanOf(fen, l.pv[0]);
      h += '<div class="brill-box"><div class="bt">' + ci('brilliant') + 'Qui c\'è una mossa brillante: <b class="num">' + esc(san) + '!!</b></div>' +
        '<div class="ln">' + (k === 0 ? 'È anche la mossa migliore. ' : 'Vale quasi quanto la migliore. ') + 'Sacrifica materiale e tiene la valutazione (' + Core.evalText(evOf(l, fen)) + ').' +
        (k >= L.multipv ? ' <span class="dim">(fuori dalle linee che mostri)</span>' : '') + '</div>' +
        '<div class="acts"><button class="btn sm" data-play="' + k + '">Gioca ' + esc(san) + '</button></div></div>';
    } else {
      // a sacrifice later in the best line(s)
      const kd = sc.findIndex((s, i) => s && s.deep && s.deep.length && i < Math.max(L.multipv, 1));
      if (kd >= 0) {
        const l = L.lines[kd], i = sc[kd].deep[0], line = Core.pvSan(fen, l.pv, i + 1);
        const who = i % 2 === 0 ? 'chi ha il tratto ora' : 'l\'altro colore';
        h += '<div class="brill-box"><div class="bt">' + ci('brilliant') + 'Sacrificio brillante più avanti nella linea' + (kd ? ' ' + (kd + 1) : ' migliore') + ': <b class="num">' + esc(line[i]) + '!!</b></div>' +
          '<div class="ln">Lo gioca ' + who + ' alla ' + (i + 1) + 'ª semimossa: <span class="num">' + esc(line.join(' ')) + '</span></div>' +
          '<div class="acts"><button class="btn sm" data-line="' + kd + '" data-upto="' + i + '">Vai al sacrificio</button></div></div>';
      } else if (sc[0] && sc[0].cls === 'great' && L.lines[0]) {
        h += '<div class="brill-box" style="--c-brilliant:var(--c-great)"><div class="bt">' + ci('great') + 'Mossa unica: <b class="num">' + esc(Core.sanOf(fen, L.lines[0].pv[0])) + '!</b></div><div class="ln">Le alternative perdono molto terreno.</div></div>';
      }
    }
    // judgement of the move just played
    if (L.ply > 0) {
      const j = judge(L.ply - 1);
      if (j) {
        const pf = L.fens[L.ply - 1], san = L.sans[L.ply - 1];
        let t = ci(j.cls) + ' <b class="num">' + esc(san) + '</b> ' + esc(phrase(j.cls));
        if (!['best', 'great', 'brilliant'].includes(j.cls) && j.best) t += ' · migliore era <b class="num">' + esc(Core.sanOf(pf, j.best)) + '</b>';
        if (j.missed) t += '<br><span class="ct c-brilliant">C\'era una mossa brillante: <b class="num">' + esc(Core.sanOf(pf, j.missed)) + '!!</b></span>';
        h = '<div class="lab-judge">' + t + '</div>' + h;
      }
    }
    box.innerHTML = h;
  }
  function phrase(cls) {
    return { brilliant: 'è brillante!', great: 'è l\'unica mossa buona!', best: 'è la mossa migliore', excellent: 'è eccellente', good: 'è una buona mossa', inaccuracy: 'è un\'imprecisione', mistake: 'è un errore', miss: 'è un\'occasione mancata', blunder: 'è un blunder' }[cls] || '';
  }
  function paintMoves() {
    const box = ctx.root.querySelector('#lbMoves'); if (!box) return;
    const no = startNo(L.fen0), blackFirst = turnOf(L.fen0) === 'b';
    let h = '', i = 0;
    const cell = (j) => {
      const jd = L.game ? null : judge(j), mk = jd && ['brilliant', 'great', 'mistake', 'blunder', 'miss', 'inaccuracy'].includes(jd.cls) ? ci(jd.cls) : '';
      return '<button data-ply="' + (j + 1) + '"' + (L.ply === j + 1 ? ' class="on"' : '') + '>' + mk + esc(L.sans[j]) + '</button>';
    };
    if (blackFirst && L.sans.length) { h += '<span class="n">' + no + '.</span><span class="mv">…</span>' + cell(0); i = 1; }
    for (; i < L.sans.length; i += 2) {
      const n = no + Math.floor((i + (blackFirst ? 1 : 0)) / 2);
      h += '<span class="n">' + n + '.</span>' + cell(i) + (i + 1 < L.sans.length ? cell(i + 1) : '<span></span>');
    }
    box.innerHTML = h || '<span class="n" style="grid-column:1/-1;padding:8px 10px">' + (L.game ? 'Le mosse della partita appariranno qui.' : 'Muovi i pezzi sulla scacchiera: puoi giocare per entrambi i colori.') + '</span>';
    const on = box.querySelector('button.on');
    if (on) { const top = on.offsetTop - box.offsetTop; if (top < box.scrollTop + 10 || top > box.scrollTop + box.clientHeight - 40) box.scrollTop = Math.max(0, top - box.clientHeight / 2); }
    const fenEl = ctx.root.querySelector('#lbFen'); if (fenEl) fenEl.value = curFen();
  }
  function paintCtrls() {
    const r = ctx.root, q = (id) => r.querySelector(id);
    if (!q('#lbOn')) return;
    q('#lbOn').classList.toggle('live-on', L.on);
    q('#lbOn').setAttribute('aria-pressed', String(L.on));
    q('#lbFirst').disabled = q('#lbPrev').disabled = L.ply === 0;
    q('#lbNext').disabled = q('#lbLast').disabled = L.ply >= L.moves.length;
  }
  function paint() {
    if (!built || !ctx.visible()) return;
    if (L.mode === 'edit' || L.game) return;
    drawBoard(false); paintEval(); paintEngineHead(); paintLines(); paintMoves(); paintCtrls();
  }
  function drawAll(animate) { drawBoard(animate); paintEval(); paintEngineHead(); paintLines(); paintMoves(); paintCtrls(); paintGame(); }

  function paintEditor() {
    const box = ctx.root.querySelector('#lbEdit'); if (!box) return;
    const E = L.edit;
    const tools = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];
    box.innerHTML = '<div class="lab-pal">' + tools.map((t) => '<button data-t="' + t + '" aria-pressed="' + (E.tool === t) + '"><img src="img/pieces/' + t + '.svg" alt="' + t + '"></button>').join('') +
      '</div><div class="row" style="gap:6px"><button class="btn sm grow" data-t="x" aria-pressed="' + (E.tool === 'x') + '" id="lbEraser">Gomma</button><button class="btn sm grow" id="lbClear">Svuota</button><button class="btn sm grow" id="lbInit">Iniziale</button></div>' +
      '<div class="stack" style="gap:6px"><span class="lbl">Muove</span><div class="seg" style="grid-template-columns:1fr 1fr" id="lbTurn">' +
      [['w', 'Il bianco'], ['b', 'Il nero']].map(([k, l]) => '<button aria-pressed="' + (E.turn === k) + '" data-v="' + k + '"><i class="sqc ' + k + '"></i>' + l + '</button>').join('') + '</div></div>' +
      (E.err ? '<div class="lab-err">' + esc(E.err) + '</div>' : '<p class="dim small" style="margin:0">Tocca un pezzo qui sopra, poi le case della scacchiera. Tocca di nuovo un pezzo uguale per toglierlo. Gli arrocchi si deducono da re e torri nelle case iniziali.</p>') +
      '<div class="row" style="gap:8px"><button class="btn grow" id="lbCancel">Annulla</button><button class="btn primary grow" id="lbDone">Analizza</button></div>';
    box.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { E.tool = b.dataset.t; paintEditor(); }; });
    box.querySelector('#lbClear').onclick = () => { E.pos = { e1: 'wK', e8: 'bK' }; E.err = ''; drawBoard(false); paintEditor(); };
    box.querySelector('#lbInit').onclick = () => { const b = Core.board(START); E.pos = {}; for (const s in b) E.pos[s] = b[s].c + b[s].t.toUpperCase(); E.turn = 'w'; E.err = ''; drawBoard(false); paintEditor(); };
    box.querySelector('#lbTurn').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; E.turn = b.dataset.v; E.err = ''; paintEditor(); };
    box.querySelector('#lbCancel').onclick = () => { L.mode = 'analyze'; L.edit = null; build(); analyze(); };
    box.querySelector('#lbDone').onclick = finishEdit;
  }

  const IC = {
    first: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 4v16L5 12z"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 4v16l11-8z"/></svg>',
    last: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
    flip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/></svg>',
    on: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 10-13h-7z"/></svg>',
    bot: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9 2h6v2h-2v2h4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h4V4H9zM8.5 11a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM9 16v1.5h6V16z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>'
  };
  function build() {
    const r = ctx.root;
    const editing = L.mode === 'edit', G = L.game, setup = !editing && !G && L.setupOpen;
    const ctrls = '<div class="ctrls" style="grid-template-columns:repeat(7,1fr)">' +
      '<button class="icon-btn" id="lbFirst" aria-label="Inizio">' + IC.first + '</button>' +
      '<button class="icon-btn" id="lbPrev" aria-label="Indietro">' + IC.prev + '</button>' +
      '<button class="icon-btn" id="lbNext" aria-label="Avanti">' + IC.next + '</button>' +
      '<button class="icon-btn" id="lbLast" aria-label="Fine">' + IC.last + '</button>' +
      '<button class="icon-btn" id="lbFlip" aria-label="Gira la scacchiera">' + IC.flip + '</button>' +
      '<button class="icon-btn" id="lbOn" aria-label="Motore acceso o in pausa">' + IC.on + '</button>' +
      '<button class="icon-btn" id="lbEditBtn" aria-label="Modifica la posizione">' + IC.edit + '</button></div>';
    const engineCard = '<div class="card lab-engine"><div class="livebox" style="margin:0;padding:0;border:0"><div class="lh" id="lbHead"></div></div>' +
      '<div class="progress lab-prog" id="lbProg"><i></i></div><div id="lbBrill"></div><div class="lines" id="lbLines" style="margin-top:8px"></div></div>' +
      '<button class="btn lab-playbtn" id="lbPlayHere">' + IC.bot + 'Gioca contro il computer da qui</button>';
    const engineSettings = '<div class="card stack" style="gap:12px">' +
      '<div class="stack" style="gap:6px"><span class="lbl">Profondità di analisi</span><div class="chips sm" id="lbDepth">' +
      DEPTH_OPTS.map((d) => '<button aria-pressed="' + (L.depth === d) + '" data-v="' + d + '">' + (d || '∞') + '</button>').join('') + '</div>' +
      '<span class="dim small" id="lbDepthHint">' + depthHint() + '</span></div>' +
      '<div class="stack" style="gap:6px"><span class="lbl">Linee mostrate</span><div class="chips sm" id="lbMpv">' +
      [1, 2, 3, 4, 5].map((n) => '<button aria-pressed="' + (L.multipv === n) + '" data-v="' + n + '">' + n + '</button>').join('') + '</div></div></div>';
    const posCard = '<div class="card stack" style="gap:10px"><span class="lbl">Posizione</span>' +
      '<div class="row" style="gap:6px;flex-wrap:nowrap"><input type="text" id="lbFen" class="grow num" style="font-size:12.5px" spellcheck="false" autocomplete="off" aria-label="FEN della posizione"><button class="btn sm" id="lbCopy">Copia</button></div>' +
      (G ? '' : '<textarea id="lbPaste" placeholder="Incolla un FEN o un PGN…" spellcheck="false"></textarea>' +
      '<div class="row" style="gap:6px"><button class="btn sm grow" id="lbLoad">Carica</button>' +
      (editing ? '' : '<button class="btn sm grow" id="lbNew">Posizione iniziale</button><button class="btn sm grow" id="lbEdit2">Editor</button>') + '</div>') + '</div>';
    const moves = '<div class="moves" id="lbMoves" style="max-height:240px"></div>';
    let left = '', right = '';
    if (editing) { left = '<div class="card stack" id="lbEdit" style="gap:12px"></div>'; right = posCard; }
    else if (G) { left = gameHtml(); right = moves + posCard; }
    else if (setup) { left = ctrls + setupHtml(); right = moves + posCard; }
    else { left = ctrls + engineCard; right = engineSettings + moves + posCard; }
    r.innerHTML = '<h1 class="lab-h">' + (G ? 'Partita dalla tua posizione' : 'Analisi libera') + '</h1><div class="rv"><div class="stack" style="gap:8px">' +
      '<div class="boardwrap"><div class="evalbar" id="lbEval"><div class="f"></div><div class="t"></div></div><div class="pboard"><div id="lbBoard"></div><div class="promo" id="lbPromo" hidden></div></div></div>' +
      left + '</div><div class="rv-side stack">' + right + '</div></div>';
    board = new Board(r.querySelector('#lbBoard'), { onMove: userMove });
    // editor taps
    r.querySelector('#lbBoard').addEventListener('click', (ev) => {
      if (L.mode !== 'edit') return;
      const rc = board.el.getBoundingClientRect();
      const sq = board.sqAt(Math.floor((ev.clientX - rc.left) / rc.width * 8), Math.floor((ev.clientY - rc.top) / rc.height * 8));
      if (sq) editTap(sq);
    });
    const on = (id, fn) => { const e = r.querySelector(id); if (e) e.onclick = fn; };
    on('#lbFirst', () => goTo(0)); on('#lbLast', () => goTo(L.moves.length));
    hold(r.querySelector('#lbPrev'), () => goTo(L.ply - 1)); hold(r.querySelector('#lbNext'), () => goTo(L.ply + 1));
    on('#lbFlip', () => { L.flip = !L.flip; save(); drawBoard(false); paintEval(); });
    on('#lbOn', () => { L.on = !L.on; save(); if (L.on) analyze(); else { stopEngine(); paint(); } });
    on('#lbEditBtn', startEdit); on('#lbEdit2', startEdit);
    on('#lbPlayHere', () => { stopEngine(); L.setupOpen = true; build(); });
    bindGame();
    on('#lbNew', () => { stopEngine(); setLine(START, [], 0); save(); build(); analyze(); });
    on('#lbLoad', () => loadText(r.querySelector('#lbPaste').value));
    on('#lbCopy', async () => { const v = r.querySelector('#lbFen').value; try { await navigator.clipboard.writeText(v); ctx.toast('FEN copiato'); } catch (e) { r.querySelector('#lbFen').select(); } });
    const fenIn = r.querySelector('#lbFen');
    fenIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadText(fenIn.value); });
    on('#lbDepth', (e) => { const b = e.target.closest('button'); if (!b) return; L.depth = +b.dataset.v; save(); r.querySelectorAll('#lbDepth button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); r.querySelector('#lbDepthHint').textContent = depthHint(); const c = cache.get(curFen()); if (c) c.full = false; analyze(); });
    on('#lbMpv', (e) => { const b = e.target.closest('button'); if (!b) return; L.multipv = +b.dataset.v; save(); r.querySelectorAll('#lbMpv button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); if (L.multipv > 3) { const c = cache.get(curFen()); if (c) c.full = false; analyze(); } else paint(); });
    const lines = r.querySelector('#lbLines');
    if (lines) lines.onclick = (e) => {
      const m = e.target.closest('.pvm'); if (m) { playLine(+m.dataset.k, +m.dataset.i); return; }
      const ln = e.target.closest('.line[data-k]'); if (ln) playLine(+ln.dataset.k, 0);
    };
    const br = r.querySelector('#lbBrill');
    if (br) br.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.play != null) playLine(+b.dataset.play, 0);
      if (b.dataset.line != null) playLine(+b.dataset.line, +b.dataset.upto);
    };
    const mv = r.querySelector('#lbMoves');
    if (mv) mv.onclick = (e) => { const b = e.target.closest('button'); if (b) goTo(+b.dataset.ply); };
    built = true;
    if (editing) { drawBoard(false); paintEval(); paintEditor(); const f = r.querySelector('#lbFen'); f.value = curFen(); }
    else drawAll(false);
  }
  function depthHint() {
    if (!L.depth) return 'Senza limite: continua finché non cambi posizione o lo metti in pausa.';
    if (L.depth <= 14) return 'Rapida: pochi secondi, buona per le mosse ovvie.';
    if (L.depth <= 22) return 'Equilibrata: affidabile per quasi tutte le posizioni.';
    return 'Profonda: sul telefono può volerci anche qualche minuto.';
  }
  function hold(btn, fn) {
    if (!btn) return;
    let t1 = 0, t2 = 0, fired = false;
    const stop = () => { clearTimeout(t1); clearInterval(t2); };
    btn.addEventListener('pointerdown', (e) => { if (e.button) return; fired = false; stop(); t1 = setTimeout(() => { fired = true; fn(); t2 = setInterval(fn, 140); }, 380); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener('click', () => { if (!fired) fn(); fired = false; });
  }
  document.addEventListener('keydown', (e) => {
    if (!ctx.visible() || L.mode !== 'analyze' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowLeft') { goTo(L.ply - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { goTo(L.ply + 1); e.preventDefault(); }
  });

  let loaded = false;
  return {
    async show() {
      if (!loaded) { loaded = true; await load(); }
      build();
      if (L.game) { L.game.thinking = false; botMove(); } else if (L.mode === 'analyze' && !L.setupOpen) analyze();
    },
    hide() { stopEngine(); if (L.game && L.game.thinking) { gtok++; L.game.thinking = false; } },
    async open(fen, label) { if (!loaded) { loaded = true; await load(); } openFen(fen, label); }
  };
}

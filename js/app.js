import { Board } from './board.js';
import { Engine, DEPTHS, poolSize } from './engine.js';
import { store } from './store.js';
import * as CC from './chesscom.js';
import { createPlay } from './play.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PIECE = (code) => 'img/pieces/' + code + '.svg';
const CN = Core.CLASS_NAME, CSYM = Core.CLASS_SYM;
const PHRASE = {
  brilliant: 'è brillante', great: "è un'ottima mossa", best: 'è la mossa migliore', excellent: 'è eccellente', good: 'è una buona mossa',
  book: 'è teoria', inaccuracy: "è un'imprecisione", mistake: 'è un errore', miss: "è un'occasione mancata", blunder: 'è un blunder'
};
const TC_NAME = { all: 'Tutte', rapid: 'Rapid', blitz: 'Blitz', bullet: 'Bullet', daily: 'Giornaliera', altro: 'Altro' };
const PHASE_NAME = { opening: 'Apertura', middlegame: 'Mediogioco', endgame: 'Finale' };
const TC_ICON = {
  bullet: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 3 5 14h6l-1 7 9-11h-6z"/></svg>',
  blitz: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 10-13h-7z" opacity=".9"/></svg>',
  rapid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>',
  daily: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  altro: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4"/></svg>'
};
TC_ICON.all = TC_ICON.rapid;

const S = {
  settings: { user: 'Victor1186', depth: 'normal', auto: true, sound: true, range: '6', lastSync: 0, synced: false },
  profile: null, recs: new Map(), parsed: {}, reviews: {},
  view: 'games', tc: 'all', stats: { tc: 'all', color: 'all' },
  rv: { id: null, ply: 0, flip: false, tab: 'moves', explore: null },
  pz: { list: [], idx: 0, filter: 'todo', step: 0, state: 'idle', progress: {} },
  run: { on: false, engines: [], queue: [], override: {}, done: 0, total: 0, games: 0, gamesTotal: 0, t0: 0, label: '' },
  syncing: false, syncMsg: '', limit: 60
};
let rvBoard = null, pzBoard = null, liveEngine = null, play = null;

/* ---------------- utilities ---------------- */
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 3400); }
const pct = (x, d = 0) => (x == null || isNaN(x) ? '–' : x.toFixed(d) + '%');
const fmt1 = (x) => (x == null || isNaN(x) ? '–' : x.toFixed(1));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const per100 = (x, n) => (n ? 100 * x / n : 0);
const times = (n) => n + (n === 1 ? ' volta' : ' volte');
function fmtDate(ts, opt) { return ts ? new Date(ts).toLocaleDateString('it-IT', opt || { day: 'numeric', month: 'short' }) : ''; }
function fmtClock(s) { if (s == null) return ''; s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; const ss = (x < 10 ? '0' : '') + (s < 20 ? x.toFixed(1) : Math.floor(x)); return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss.padStart(2, '0') : m + ':' + ss; }
function fmtDur(s) { s = Math.round(s); if (s < 60) return s + ' s'; const m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; }
function ago(ts) { if (!ts) return 'mai'; const d = (Date.now() - ts) / 1000; if (d < 60) return 'adesso'; if (d < 3600) return Math.round(d / 60) + ' min fa'; if (d < 86400) return Math.round(d / 3600) + ' h fa'; return fmtDate(ts); }
function ci(cls, sm) { return '<span class="ci c-' + cls + (sm ? ' sm' : '') + '" title="' + esc(CN[cls]) + '">' + CSYM[cls] + '</span>'; }
function bar(v, max, color) { const w = max ? Math.max(0, Math.min(100, 100 * v / max)) : 0; return '<div class="bar"><i style="width:' + w.toFixed(1) + '%;background:' + color + '"></i></div>'; }
function saveSettings() { store.set('settings', S.settings).catch(() => {}); }

/* sounds: tiny synthesized clicks */
let actx = null;
function sound(kind) {
  if (!S.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime, len = kind === 'capture' ? 0.09 : 0.05;
    const buf = actx.createBuffer(1, Math.floor(actx.sampleRate * len), actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, kind === 'capture' ? 3 : 6);
    const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    f.type = 'bandpass'; f.frequency.value = kind === 'capture' ? 900 : kind === 'ok' ? 2200 : 1500; f.Q.value = 1.4;
    g.gain.value = kind === 'capture' ? 0.9 : 0.6;
    src.buffer = buf; src.connect(f); f.connect(g); g.connect(actx.destination); src.start(t);
  } catch (e) { /* audio not available */ }
}

/* ---------------- data ---------------- */
// Full parse (moves + positions): expensive, only for the game on screen or being analysed. Small LRU cache.
const LRU = [];
function game(id) {
  if (!S.parsed[id]) {
    const r = S.recs.get(id); if (!r) return null;
    const g = Core.parseGame(r.pgn, S.settings.user);
    if (!g) { r.bad = true; return null; }
    g.id = id; S.parsed[id] = g; LRU.push(id);
    if (r.meta && g.opening !== r.meta.opening) { r.meta.opening = g.opening; r.meta.openingFamily = g.openingFamily; r.meta.eco = g.eco; }
    while (LRU.length > 12) { const old = LRU.shift(); if (old !== S.rv.id) { delete S.parsed[old]; delete S.reviews[old]; } }
  }
  return S.parsed[id];
}
// Header metadata: cheap, used everywhere else.
function meta(id) {
  const r = S.recs.get(id); if (!r) return null;
  if (!r.meta || r.meta.user !== S.settings.user.toLowerCase()) {
    r.meta = Core.parseMeta(r.pgn, S.settings.user); r.meta.user = S.settings.user.toLowerCase(); r.meta.id = id;
  }
  return r.meta;
}
function reviewOf(id) { // full review of the open game
  const r = S.recs.get(id);
  if (!r || !r.an || r.an.v !== 2) return null;
  if (!S.reviews[id]) { const g = game(id); if (!g) return null; S.reviews[id] = Core.review(g, r.an); }
  return S.reviews[id];
}
function crev(id) { // compact stored review, for lists, stats and puzzles
  const r = S.recs.get(id);
  if (!r || !r.an || r.an.v !== 2) return null;
  if (!r.rv || r.rvUser !== S.settings.user.toLowerCase()) return null;
  return r.rv;
}
function buildCompact(id) {
  const r = S.recs.get(id), g = game(id), rv = reviewOf(id);
  if (!g || !rv) return null;
  r.rv = Core.compactReview(g, rv); r.rvUser = S.settings.user.toLowerCase();
  r.sum = Core.gameSummary(g, rv);
  return r.rv;
}
// Games analysed before compact reviews existed: convert in the background, a few at a time.
let migrating = false;
async function migrateCompact() {
  if (migrating) return; migrating = true;
  const todo = [...S.recs.keys()].filter((id) => { const r = S.recs.get(id); return r.an && r.an.v === 2 && !crev(id); });
  let batch = [];
  for (let i = 0; i < todo.length; i++) {
    if (buildCompact(todo[i])) batch.push(S.recs.get(todo[i]));
    if (todo[i] !== S.rv.id) { delete S.parsed[todo[i]]; delete S.reviews[todo[i]]; }
    if (batch.length >= 10 || i === todo.length - 1) { await store.putGames(batch).catch(() => {}); batch = []; await new Promise((ok) => setTimeout(ok, 30)); }
  }
  migrating = false;
  if (todo.length && (S.view === 'stats' || S.view === 'puzzle')) show(S.view);
}
function sortedIds(filterTc) {
  const ids = [...S.recs.keys()].filter((id) => !S.recs.get(id).bad && meta(id));
  ids.sort((a, b) => (meta(b).ts || 0) - (meta(a).ts || 0));
  return filterTc && filterTc !== 'all' ? ids.filter((id) => meta(id).timeClass === filterTc) : ids;
}
const opp = (g) => (g.userColor === 'b' ? g.white : g.black);
const oppElo = (g) => (g.userColor === 'b' ? g.whiteElo : g.blackElo);
const myElo = (g) => (g.userColor === 'b' ? g.blackElo : g.whiteElo);

function addPGNs(items, src) { // items: [{pgn, accuracies?}]
  const added = [];
  items.forEach((it) => {
    if (!/\d+\.\s*\S/.test(it.pgn.replace(/^\[.*\]\s*$/gm, ''))) return; // no moves
    const g = Core.parseMeta(it.pgn, S.settings.user);
    const old = S.recs.get(g.id);
    if (old) { if (it.accuracies && !old.ca) { old.ca = it.accuracies; added.push(old); } return; }
    g.user = S.settings.user.toLowerCase();
    const rec = { id: g.id, pgn: it.pgn, ts: g.ts, an: null, src, ca: it.accuracies || null, meta: g };
    S.recs.set(g.id, rec); added.push(rec);
  });
  if (added.length) store.putGames(added).catch(() => toast('Non riesco a salvare le partite su questo dispositivo'));
  return added.filter((r) => !r.an).length;
}

/* ---------------- Chess.com sync ---------------- */
function monthKey(d) { return d.getUTCFullYear() + '/' + String(d.getUTCMonth() + 1).padStart(2, '0'); }
async function sync(manual) {
  if (S.syncing) return;
  const user = S.settings.user.trim();
  if (!user) return;
  S.syncing = true; S.syncMsg = 'Mi collego a Chess.com…'; renderGames();
  let newCount = 0;
  try {
    CC.profile(user).then((p) => { S.profile = p; store.set('profile', p); if (S.view === 'games') renderGames(); }).catch(() => {});
    let arch = await CC.archives(user);
    const months = (await store.get('months:' + user.toLowerCase())) || {};
    const now = new Date(), recent = [monthKey(now), monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)))];
    if (S.settings.range !== 'all') arch = arch.slice(-(+S.settings.range || 6));
    arch = arch.reverse();
    for (let i = 0; i < arch.length; i++) {
      const url = arch[i], key = url.split('/games/')[1];
      const isRecent = recent.includes(key);
      if (months[key] && months[key].done && !isRecent) continue;
      const [y, m] = key.split('/');
      S.syncMsg = 'Scarico ' + new Date(+y, +m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) + '… (' + S.recs.size + ' partite)';
      const sm = $('syncMsg'); if (sm) sm.textContent = S.syncMsg; else if (S.view === 'games') renderGames();
      await new Promise((ok) => setTimeout(ok, 0));
      const list = await CC.month(url);
      newCount += addPGNs(list, 'chesscom');
      months[key] = { done: !isRecent, n: list.length, at: Date.now() };
      await store.set('months:' + user.toLowerCase(), months);
    }
    S.settings.lastSync = Date.now(); S.settings.synced = true; saveSettings();
    if (manual || newCount) toast(newCount ? newCount + (newCount === 1 ? ' partita nuova' : ' partite nuove') : 'Nessuna partita nuova');
  } catch (e) {
    toast(e.message || 'Chess.com non raggiungibile');
  }
  S.syncing = false; S.syncMsg = '';
  refresh();
  migrateCompact();
  if (newCount && S.settings.auto) {
    if (newCount <= 25) analyzeAll();
    else toast(newCount + ' partite da analizzare: premi «Analizza» quando vuoi');
  }
}

/* ---------------- analysis queue ---------------- */
let wake = null;
async function wakeOn() { try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch (e) { wake = null; } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.run.on) wakeOn(); });
function needsAnalysis(id) { const r = S.recs.get(id); return r && !r.bad && (!r.an || r.an.v !== 2); }
function analyzeAll() { enqueue(sortedIds().filter(needsAnalysis)); }
function enqueue(ids, front) {
  ids = ids.filter((id) => needsAnalysis(id) && !S.run.queue.includes(id));
  if (!ids.length) { if (!S.run.on) toast('Tutte le partite sono già analizzate'); return; }
  ids.forEach((id) => { S.run.total += meta(id).plies + 1; });
  S.run.gamesTotal += ids.length;
  S.run.queue = front ? ids.concat(S.run.queue) : S.run.queue.concat(ids);
  if (!S.run.on) startRun();
  else { renderRunBox(); progressTick(true); }
}
async function startRun() {
  const R = S.run;
  R.on = true; R.t0 = Date.now(); R.done = 0; R.games = 0; R.label = 'Avvio Stockfish 17…';
  wakeOn(); renderRunBox(); progressTick(true);
  const n = Math.max(1, Math.min(poolSize(), R.queue.length));
  try {
    R.engines = Array.from({ length: n }, () => new Engine());
    await Promise.all(R.engines.map((e) => e.ready));
    progressTick(true);
  } catch (e) {
    stopRun(); toast('Stockfish non si è avviato: ' + (e.message || 'errore')); return;
  }
  const worker = async (eng) => {
    while (R.on && R.queue.length) {
      const id = R.queue.shift(), g = needsAnalysis(id) ? game(id) : null;
      const opts = DEPTHS[R.override[id] || S.settings.depth] || DEPTHS.normal;
      delete R.override[id];
      if (!g || !needsAnalysis(id)) continue;
      let base = 0;
      eng.newGame();
      try {
        R.label = 'vs ' + opp(g);
        const an = await Core.analyzeGame(g, eng, { depth: opts.depth, movetime: opts.movetime, multipv: 2 }, (i) => {
          R.done += i - base; base = i; progressTick();
        });
        R.done += Math.max(0, meta(id).plies + 1 - base);
        const rec = S.recs.get(id); rec.an = an; delete S.reviews[id];
        buildCompact(id);
        await store.putGame(rec).catch(() => {});
        R.games++;
        updateRow(id);
        progressTick();
        if (S.rv.id === id && S.view === 'review') openReview(id, S.rv.ply);
      } catch (e) { if (!R.on) break; }
      if (S.rv.id !== id) { delete S.parsed[id]; delete S.reviews[id]; }
    }
  };
  await Promise.all(R.engines.map(worker));
  const stopped = !R.on, done = R.games;
  stopRun();
  toast(stopped ? 'Analisi fermata · ' + done + ' salvate' : 'Analisi completata · ' + done + (done === 1 ? ' partita' : ' partite'));
  if (S.view === 'games') renderRunBox(); else refresh();
}
function stopRun() {
  const R = S.run;
  R.on = false; R.queue = []; R.engines.forEach((e) => e.kill()); R.engines = [];
  R.total = 0; R.gamesTotal = 0; R.done = 0; R.games = 0;
  try { if (wake) wake.release(); } catch (e) { /* ignore */ }
  wake = null; progressTick(true);
}
let lastTick = 0;
function progressTick(force) {
  const R = S.run, now = Date.now();
  if (!force && now - lastTick < 400) return;
  lastTick = now;
  const mp = $('miniProg');
  if (R.on) { mp.hidden = false; mp.textContent = 'Analisi ' + Math.min(R.games + 1, R.gamesTotal) + '/' + R.gamesTotal; } else mp.hidden = true;
  const box = $('runBox');
  if (!box) { if (force && S.view === 'games') renderGames(); return; }
  if (force && (!R.on || !box.querySelector('[data-t]'))) { renderRunBox(); }
  const el = (now - R.t0) / 1000, rate = R.done / Math.max(el, 1);
  const bar = box.querySelector('.progress i'); if (bar) bar.style.width = (R.total ? 100 * R.done / R.total : 0).toFixed(1) + '%';
  const t = box.querySelector('[data-t]'); if (t) t.textContent = 'Partita ' + Math.min(R.games + 1, R.gamesTotal) + ' di ' + R.gamesTotal + ' · ' + R.label;
  const e = box.querySelector('[data-e]'); if (e) e.textContent = rate > 0 && R.done > 20 ? 'circa ' + fmtDur((R.total - R.done) / rate) : '';
}

/* ---------------- view: games ---------------- */
function renderGames() {
  const v = $('v-games'), ids = sortedIds(), s = S.settings;
  let h = '';
  if (!s.synced && !ids.length) {
    h += '<div class="card hero-cta stack" style="gap:14px;margin-top:6px">' +
      '<div class="board-art"><img src="icons/icon-192.png" alt="" style="width:100%;height:100%"></div>' +
      '<h1 style="margin:0">Le tue partite, analizzate da Stockfish 17</h1>' +
      '<p class="muted" style="margin:0">Scarico le partite dal tuo archivio pubblico di Chess.com, le analizzo una per una e ti mostro dove sbagli: pezzo per pezzo, per fase e per tipo di tattica.</p>' +
      '<div class="stack" style="max-width:380px;margin:0 auto;width:100%;text-align:left">' +
      '<label class="lbl" for="uIn">Utente Chess.com</label><input type="text" id="uIn" value="' + esc(s.user) + '" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<label class="lbl" for="rIn">Quante partite</label><select id="rIn">' + rangeOpts() + '</select>' +
      '<button class="btn primary big" id="goSync">' + (S.syncing ? '<span class="spin"></span> ' + esc(S.syncMsg) : 'Carica le partite') + '</button></div></div>';
    v.innerHTML = h + settingsHtml();
    $('goSync').onclick = () => { s.user = $('uIn').value.trim() || s.user; s.range = $('rIn').value; S.parsed = {}; S.reviews = {}; saveSettings(); sync(true); };
    bindSettings();
    return;
  }
  // profile
  const p = S.profile;
  h += '<div class="card profile" style="margin-top:4px"><div class="avatar" style="' + (p && p.avatar ? 'background-image:url(' + esc(p.avatar) + ')' : '') + '">' + (p && p.avatar ? '' : esc(s.user[0] || '?').toUpperCase()) + '</div>' +
    '<div class="grow"><div style="font-weight:700;font-size:17px">' + esc(p ? p.username : s.user) + '</div>' +
    '<div class="ratings">' + (p ? ['rapid', 'blitz', 'bullet', 'daily'].filter((k) => p.ratings[k]).map((k) => '<span class="rating">' + TC_ICON[k] + p.ratings[k] + '</span>').join('') : '') + '</div>' +
    '<div class="dim small" style="margin-top:4px" id="syncMsg">' + (S.syncing ? esc(S.syncMsg) : 'Aggiornato ' + ago(s.lastSync)) + '</div></div>' +
    '<button class="icon-btn" id="syncBtn" aria-label="Aggiorna da Chess.com"' + (S.syncing ? ' disabled' : '') + '>' + (S.syncing ? '<span class="spin"></span>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/></svg>') + '</button></div>';
  h += '<div class="card stack" id="runBox" style="margin-top:12px">' + runBoxHtml(ids) + '</div>';
  // filters + list
  const tcs = ['all', ...new Set(ids.map((id) => meta(id).timeClass))];
  h += '<div class="chips" style="margin-top:16px" id="tcChips">' + tcs.map((k) => '<button aria-pressed="' + (S.tc === k) + '" data-tc="' + k + '">' + TC_NAME[k] + '</button>').join('') + '</div>';
  const list = sortedIds(S.tc);
  if (!list.length) h += '<div class="empty" style="margin-top:12px">Nessuna partita qui. Tocca Aggiorna per scaricare le ultime.</div>';
  let curMonth = '', open = false;
  list.slice(0, S.limit).forEach((id) => {
    const g = meta(id), mk = fmtDate(g.ts, { month: 'long', year: 'numeric' });
    if (mk !== curMonth) { if (open) h += '</div>'; h += '<div class="month lbl">' + esc(mk) + '</div><div class="glist">'; open = true; curMonth = mk; }
    h += gameRow(id);
  });
  if (open) h += '</div>';
  if (list.length > S.limit) h += '<button class="btn" id="moreBtn" style="width:100%;margin-top:12px">Mostra altre (' + (list.length - S.limit) + ' rimanenti)</button>';
  v.innerHTML = h + settingsHtml();
  $('syncBtn').onclick = () => sync(true);
  bindRunBox();
  const mb = $('moreBtn'); if (mb) mb.onclick = () => { S.limit += 60; const y = window.scrollY; renderGames(); window.scrollTo(0, y); };
  $('tcChips').onclick = (e) => { const b = e.target.closest('button'); if (b) { S.tc = b.dataset.tc; S.limit = 60; renderGames(); } };
  bindSettings();
  progressTick();
}
function runBoxHtml(ids) {
  const todo = ids.filter(needsAnalysis).length, R = S.run, s = S.settings;
  if (R.on) {
    return '<div class="row"><span class="spin"></span><b class="grow">Analisi in corso</b><button class="btn sm" id="stopBtn">Ferma</button></div>' +
      '<div class="progress"><i style="width:' + (R.total ? 100 * R.done / R.total : 0) + '%"></i></div>' +
      '<div class="row small"><span class="muted grow" data-t>Partita ' + Math.min(R.games + 1, R.gamesTotal) + ' di ' + R.gamesTotal + ' · ' + esc(R.label) + '</span><span class="dim" data-e></span></div>' +
      '<div class="dim small">Stockfish 17.1 su ' + (R.engines.length || '…') + (R.engines.length === 1 ? ' processo' : ' processi') + '. Tieni l\'app aperta: lo schermo resta acceso.</div>';
  }
  if (todo) {
    const d = DEPTHS[s.depth] || DEPTHS.normal, est = todo * (d.movetime / 1000) * 60 / Math.max(1, poolSize()) / 3;
    return '<div class="row"><div class="grow"><b>' + todo + (todo === 1 ? ' partita da analizzare' : ' partite da analizzare') + '</b><div class="dim small">Stockfish 17.1 · profondità ' + d.depth + ' · circa ' + fmtDur(est) + '</div></div></div>' +
      (todo > 50 ? '<div class="row"><button class="btn primary grow" id="anSome">Le ultime 50</button><button class="btn grow" id="anAll">Tutte</button></div>' : '<button class="btn primary big" id="anAll">Analizza tutte</button>');
  }
  return '<div class="row"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--green)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17 19 7"/></svg><div class="grow"><b>Tutte le partite sono analizzate</b><div class="dim small">' + ids.length + ' partite · le nuove vengono analizzate ' + (s.auto ? 'da sole' : 'quando premi Analizza') + '</div></div></div>';
}
function bindRunBox() {
  const ab = $('anAll'); if (ab) ab.onclick = analyzeAll;
  const as = $('anSome'); if (as) as.onclick = () => enqueue(sortedIds().filter(needsAnalysis).slice(0, 50));
  const sb = $('stopBtn'); if (sb) sb.onclick = () => { S.run.on = false; S.run.engines.forEach((e) => e.kill()); };
}
function renderRunBox() {
  const box = $('runBox'); if (!box) return;
  box.innerHTML = runBoxHtml(sortedIds()); bindRunBox();
}
function updateRow(id) {
  const el = document.querySelector('.gi[data-id="' + id + '"]:not([data-ply])');
  if (el) el.outerHTML = gameRow(id);
}
function gameRow(id) {
  const g = meta(id), r = S.recs.get(id), oc = g.outcome || 'none';
  const letter = { win: '+', loss: '−', draw: '=', none: '?' }[oc];
  let acc = '';
  if (r.sum && r.an) acc = '<b class="num">' + fmt1(r.sum.userAcc) + '</b><div class="dim num">' + fmt1(r.sum.oppAcc) + '</div>';
  else if (r.an && r.an.v === 2) acc = '<span class="pill">analizzata</span>';
  else acc = '<span class="pill">' + (S.run.queue.includes(id) ? 'in coda' : 'nuova') + '</span>';
  const me = g.userColor || 'w', them = me === 'w' ? 'b' : 'w';
  return '<div class="gi" tabindex="0" role="button" data-id="' + esc(id) + '">' +
    '<span class="tc" title="' + esc(TC_NAME[g.timeClass]) + '">' + TC_ICON[g.timeClass] + '</span>' +
    '<div class="pl"><span class="me"><i class="sqc ' + me + '"></i>' + esc(S.settings.user) + ' <span class="dim num">' + (myElo(g) || '') + '</span></span>' +
    '<span class="muted"><i class="sqc ' + them + '"></i>' + esc(opp(g)) + ' <span class="dim num">' + (oppElo(g) || '') + '</span></span></div>' +
    '<div class="acc">' + acc + '</div><div class="res ' + oc + '">' + letter + '</div></div>';
}
function rangeOpts() {
  return [['3', 'Ultimi 3 mesi'], ['6', 'Ultimi 6 mesi'], ['12', 'Ultimo anno'], ['all', 'Tutte le partite']]
    .map(([v, l]) => '<option value="' + v + '"' + (S.settings.range === v ? ' selected' : '') + '>' + l + '</option>').join('');
}
function settingsHtml() {
  const s = S.settings;
  return '<details class="more card flat" style="margin-top:18px"><summary>Impostazioni e importazione</summary><div class="stack" style="margin-top:10px">' +
    '<div class="grid2"><div class="stack"><label class="lbl" for="sUser">Utente Chess.com</label><input type="text" id="sUser" value="' + esc(s.user) + '" autocapitalize="off" spellcheck="false"></div>' +
    '<div class="stack"><label class="lbl" for="sRange">Partite da scaricare</label><select id="sRange">' + rangeOpts() + '</select></div>' +
    '<div class="stack"><label class="lbl" for="sDepth">Profondità di analisi</label><select id="sDepth">' + Object.entries(DEPTHS).map(([k, d]) => '<option value="' + k + '"' + (s.depth === k ? ' selected' : '') + '>' + d.label + ' · profondità ' + d.depth + '</option>').join('') + '</select></div>' +
    '<div class="stack"><span class="lbl">Opzioni</span><label class="row small"><input type="checkbox" id="sAuto"' + (s.auto ? ' checked' : '') + '> Analizza da sola le partite nuove</label><label class="row small"><input type="checkbox" id="sSound"' + (s.sound ? ' checked' : '') + '> Suoni delle mosse</label></div></div>' +
    '<div class="stack"><label class="lbl" for="pgnIn">Importa PGN (incolla o scegli un file)</label><textarea id="pgnIn" placeholder="[Event &quot;Live Chess&quot;] …"></textarea>' +
    '<div class="row"><button class="btn sm" id="pgnBtn">Importa testo</button><label class="btn sm" for="pgnFile">Scegli file<input type="file" id="pgnFile" accept=".pgn,.txt,text/plain" multiple hidden></label></div></div>' +
    '<div class="row"><button class="btn sm" id="bkOut">Esporta backup</button><label class="btn sm" for="bkIn">Ripristina backup<input type="file" id="bkIn" accept=".json,application/json" hidden></label><button class="btn sm ghost" id="reAn">Rianalizza tutto</button></div>' +
    '<p class="dim small" style="margin:0">Le partite e le analisi restano su questo telefono. Il backup ti serve per spostarle su un altro dispositivo.</p>' +
    '</div></details>';
}
function bindSettings() {
  const s = S.settings, on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('sUser', 'change', (e) => { const v = e.target.value.trim(); if (!v || v === s.user) return; s.user = v; s.synced = false; s.lastSync = 0; S.profile = null; S.parsed = {}; S.reviews = {}; saveSettings(); sync(true); });
  on('sRange', 'change', (e) => { s.range = e.target.value; saveSettings(); sync(true); });
  on('sDepth', 'change', (e) => { s.depth = e.target.value; saveSettings(); });
  on('sAuto', 'change', (e) => { s.auto = e.target.checked; saveSettings(); });
  on('sSound', 'change', (e) => { s.sound = e.target.checked; saveSettings(); });
  on('pgnBtn', 'click', () => { const t = $('pgnIn').value; if (!t.trim()) return toast('Incolla prima un PGN'); importText(t); $('pgnIn').value = ''; });
  on('pgnFile', 'change', async (e) => { const fs = [...e.target.files]; const txt = (await Promise.all(fs.map((f) => f.text()))).join('\n\n'); importText(txt); e.target.value = ''; });
  on('bkOut', 'click', exportBackup);
  on('bkIn', 'change', async (e) => { const f = e.target.files[0]; if (f) importBackup(await f.text()); e.target.value = ''; });
  on('reAn', 'click', () => {
    if (!confirm('Rianalizzare tutte le partite con le impostazioni attuali?')) return;
    const list = [...S.recs.values()]; list.forEach((r) => { r.an = null; r.rv = null; r.sum = null; }); S.reviews = {};
    store.putGames(list).then(analyzeAll);
  });
}
function analyzeBotGame(text) {
  const g = Core.parseMeta(text, S.settings.user);
  if (!S.recs.has(g.id)) addPGNs([{ pgn: text }], 'bot');
  const rec = S.recs.get(g.id);
  if (rec && !rec.an) enqueue([g.id], true);
  show('review'); openReview(g.id, 0);
}
function importText(t) {
  const parts = Core.splitPGN(t).map((pgn) => ({ pgn }));
  const before = S.recs.size, n = addPGNs(parts, 'import');
  const added = S.recs.size - before;
  toast(added ? added + (added === 1 ? ' partita importata' : ' partite importate') : 'Nessuna partita nuova nel testo');
  refresh();
  if (n && S.settings.auto) analyzeAll();
}
function exportBackup() {
  const data = { app: 'scacchiera-vik', v: 1, at: Date.now(), settings: S.settings, games: [...S.recs.values()], puzzles: S.pz.progress };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'scacchiera-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function importBackup(txt) {
  try {
    const d = JSON.parse(txt);
    if (!d.games) throw new Error();
    let n = 0;
    d.games.forEach((r) => { const old = S.recs.get(r.id); if (!old || (!old.an && r.an)) { S.recs.set(r.id, r); delete S.parsed[r.id]; delete S.reviews[r.id]; n++; } });
    await store.putGames(d.games);
    if (d.puzzles) { Object.assign(S.pz.progress, d.puzzles); store.set('puzzles', S.pz.progress); }
    toast('Ripristinate ' + n + ' partite'); refresh();
  } catch (e) { toast('Questo file non è un backup valido'); }
}

/* ---------------- view: review ---------------- */
function openReview(id, ply) {
  const g = game(id); if (!g) return;
  if (S.rv.id !== id) { S.rv.flip = g.userColor === 'b'; S.rv.explore = null; stopLive(); }
  S.rv.id = id; S.rv.ply = Math.max(0, Math.min(ply == null ? 0 : ply, g.moves.length));
  if (!rvBoard) {
    rvBoard = new Board($('rvBoard'), { onMove: exploreMove });
  }
  rvBoard.setOrientation(S.rv.flip ? 'b' : 'w');
  renderMoves(); renderSummary(); drawReview(false);
}
function playerBar(el, color, g, ply) {
  const name = color === 'w' ? g.white : g.black, elo = color === 'w' ? g.whiteElo : g.blackElo;
  // clock after the last move by that colour up to ply
  let clk = null;
  for (let i = ply - 1; i >= 0; i--) if (g.moves[i].color === color) { clk = g.clocks[i]; break; }
  if (clk == null && g.baseTime) clk = g.baseTime;
  const isMe = g.userColor === color, av = isMe && S.profile && S.profile.avatar ? S.profile.avatar : '';
  const turn = g.fens[ply].split(' ')[1] === color;
  el.innerHTML = '<div class="av" style="' + (av ? 'background-image:url(' + esc(av) + ')' : '') + '">' + (av ? '' : esc(name[0] || '?').toUpperCase()) + '</div>' +
    '<span class="nm">' + esc(name) + (elo ? ' <span class="el num">(' + elo + ')</span>' : '') + '</span>' +
    (clk != null ? '<span class="clk num' + (color === 'w' ? ' white' : '') + '" style="' + (turn ? '' : 'opacity:.6') + '">' + fmtClock(clk) + '</span>' : '');
}
function curFen() {
  const ex = S.rv.explore;
  if (ex) return ex.fens[ex.fens.length - 1];
  return game(S.rv.id).fens[S.rv.ply];
}
function drawReview(animate = true) {
  const id = S.rv.id, g = game(id); if (!g) return;
  const rv = reviewOf(id), an = S.recs.get(id).an, ply = S.rv.ply, ex = S.rv.explore;
  const top = S.rv.flip ? 'w' : 'b', bot = S.rv.flip ? 'b' : 'w';
  playerBar($('pTop'), top, g, ply); playerBar($('pBot'), bot, g, ply);
  const fen = curFen(), ch = new Chess(fen);
  let lastMove = null, mark = null, arrows = [];
  if (ex && ex.moves.length) { const u = ex.moves[ex.moves.length - 1]; lastMove = [u.slice(0, 2), u.slice(2, 4)]; }
  else if (ply > 0) {
    const mv = g.moves[ply - 1]; lastMove = [mv.from, mv.to];
    const m = rv && rv[ply - 1];
    if (m) {
      mark = { sq: mv.to, cls: m.cls };
      if (m.best && !['best', 'great', 'brilliant', 'book'].includes(m.cls) && m.loss >= 2) arrows.push({ from: m.best.slice(0, 2), to: m.best.slice(2, 4), color: '#81b64ce6' });
    }
  }
  if (ex && ex.lines && ex.lines[0] && ex.lines[0].pv[0]) { const u = ex.lines[0].pv[0]; arrows = [{ from: u.slice(0, 2), to: u.slice(2, 4), color: '#81b64ce6' }]; }
  let check = null;
  if (ch.in_check()) { const b = Core.board(fen), turn = fen.split(' ')[1]; for (const s in b) if (b[s].t === 'k' && b[s].c === turn) check = s; }
  rvBoard.set(fen, { lastMove, mark, arrows, check, animate });
  if (ex) {
    const d = {}; ch.moves({ verbose: true }).forEach((m) => { (d[m.from] = d[m.from] || []).push(m.to); });
    rvBoard.setMovable(d);
  } else rvBoard.setMovable(null);
  // eval bar
  let ev = null;
  if (ex && ex.lines && ex.lines[0]) { const l = ex.lines[0], s = fen.split(' ')[1] === 'w' ? 1 : -1; ev = l.mate != null ? { mate: l.mate * s } : { cp: l.cp * s }; }
  else if (!ex && an && an.v === 2) ev = Core.unpackEv(an.ev[ply]);
  const wp = ev ? Core.winPct(ev) : 50;
  $('evalbar').classList.toggle('flip', S.rv.flip);
  $('evalF').style.height = wp.toFixed(1) + '%';
  const t = $('evalT'); t.textContent = ev ? Core.evalText(ev).replace('+', '') : '';
  const whiteSide = wp >= 50;
  t.style.bottom = whiteSide ? '4px' : 'auto'; t.style.top = whiteSide ? 'auto' : '4px'; t.style.color = whiteSide ? '#1b1a19' : '#f4f1ea';
  renderCoach(g, rv, an, ply, ev);
  // move list highlight
  const ml = $('moves');
  ml.querySelectorAll('button').forEach((b) => {
    const on = +b.dataset.ply === ply && !ex;
    b.classList.toggle('on', on);
    if (on) { const top = b.offsetTop - ml.offsetTop; if (top < ml.scrollTop + 10 || top > ml.scrollTop + ml.clientHeight - 40) ml.scrollTop = Math.max(0, top - ml.clientHeight / 2); }
  });
  drawGraph(g, an, rv, ply);
  $('cExplore').classList.toggle('on', !!ex);
}
function renderCoach(g, rv, an, ply, ev) {
  const box = $('coach'), ex = S.rv.explore;
  const evBadge = ev ? '<span class="ev num' + (Core.winPct(ev) >= 50 ? ' w' : '') + '">' + Core.evalText(ev) + '</span>' : '';
  if (ex) {
    const fen = curFen();
    let h = '<div class="bubble"><div class="head"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--green)" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg> <span class="hd">Esplora</span>' + evBadge + '</div>';
    if (ex.moves.length) h += '<p class="num">' + esc(ex.sans.join(' ')) + '</p>';
    h += '<p>Muovi i pezzi per provare varianti.' + (ex.depth ? ' Profondità ' + ex.depth + '.' : ' Il motore sta pensando…') + '</p><div class="lines" style="margin-top:8px">';
    (ex.lines || []).forEach((l) => {
      if (!l || !l.pv || !l.pv.length) return;
      const s = fen.split(' ')[1] === 'w' ? 1 : -1, e = l.mate != null ? { mate: l.mate * s } : { cp: l.cp * s };
      h += '<div class="line" data-u="' + esc(l.pv[0]) + '"><span class="e num' + (Core.winPct(e) >= 50 ? ' w' : '') + '">' + Core.evalText(e) + '</span><span class="p">' + esc(Core.pvSan(fen, l.pv, 8).join(' ')) + '</span></div>';
    });
    h += '</div><div class="row" style="margin-top:8px"><button class="btn sm" id="exBack"' + (ex.moves.length ? '' : ' disabled') + '>Annulla mossa</button><button class="btn sm ghost" id="exQuit">Torna alla partita</button></div></div>';
    box.innerHTML = h;
    box.querySelectorAll('.line').forEach((el) => { el.onclick = () => { const u = el.dataset.u; exploreMove(u.slice(0, 2), u.slice(2, 4), u[4]); }; });
    $('exBack').onclick = () => { ex.fens.pop(); ex.moves.pop(); ex.sans.pop(); drawReview(); think(); };
    $('exQuit').onclick = () => toggleExplore(false);
    return;
  }
  if (ply === 0) {
    box.innerHTML = '<div class="bubble"><div class="head"><span class="hd">' + esc(g.opening) + '</span>' + evBadge + '</div><p>' + esc(fmtDate(g.ts, { day: 'numeric', month: 'long', year: 'numeric' })) + ' · ' + esc(TC_NAME[g.timeClass]) + (g.timeControl ? ' ' + esc(tcLabel(g.timeControl)) : '') + ' · ' + esc(resultText(g)) + '</p>' +
      (rv ? '<p>Premi ▶ o scorri le mosse per vedere la revisione.</p>' : '<p>Questa partita non è ancora analizzata.</p><div class="row" style="margin-top:8px"><button class="btn primary sm" id="anOne">' + (S.run.queue.includes(g.id) ? 'In coda…' : 'Analizza ora') + '</button></div>') + '</div>';
    const b = $('anOne'); if (b) b.onclick = () => { enqueue([g.id], true); b.textContent = 'In coda…'; b.disabled = true; };
    return;
  }
  const mv = g.moves[ply - 1], num = Math.ceil(ply / 2) + (mv.color === 'w' ? '.' : '…');
  const m = rv && rv[ply - 1];
  if (!m) {
    box.innerHTML = '<div class="bubble"><div class="head num">' + num + ' ' + esc(mv.san) + '</div><p>Analizza la partita per vedere il giudizio su questa mossa.</p><div class="row" style="margin-top:8px"><button class="btn primary sm" id="anOne">' + (S.run.queue.includes(g.id) ? 'In coda…' : 'Analizza ora') + '</button></div></div>';
    const b = $('anOne'); if (b) b.onclick = () => { enqueue([g.id], true); b.textContent = 'In coda…'; b.disabled = true; };
    return;
  }
  const lines = [];
  const prevFen = g.fens[ply - 1];
  if (m.cls === 'book') lines.push('Mossa di teoria: ' + esc(g.opening) + '.');
  if (m.best && !['best', 'great', 'brilliant', 'book'].includes(m.cls)) {
    lines.push('La migliore era <b class="num">' + esc(Core.sanOf(prevFen, m.best)) + '</b>' + (m.missedTactic ? ', ' + esc(Core.TACTIC_NAME[m.missedTactic].toLowerCase()) : '') + '.');
  }
  if (m.cls === 'brilliant') lines.push('Sacrificio corretto: il motore lo conferma.');
  if (m.cls === 'great') lines.push("Era l'unica mossa che teneva la posizione.");
  if (m.missedMate) lines.push("C'era un matto forzato.");
  const mine = m.side === g.userColor;
  if (m.cls === 'miss' && !m.missedMate) lines.push(mine ? "L'avversario aveva appena sbagliato e potevi approfittarne." : "Avevi appena sbagliato e l'avversario poteva approfittarne.");
  if (m.allowedTactic && an.best[ply]) lines.push((mine ? 'Ora l\'avversario ha <b' : 'Ora avresti <b') + ' class="num">' + esc(Core.sanOf(g.fens[ply], an.best[ply])) + '</b> (' + esc(Core.TACTIC_NAME[m.allowedTactic].toLowerCase()) + ').');
  if (m.hungPiece) lines.push('Pezzo lasciato in presa: ' + Core.PIECE_NAME[m.hungPiece].toLowerCase() + '.');
  if (m.foundTactic) lines.push((mine ? 'Hai sfruttato l\'errore con ' : 'L\'avversario ha sfruttato il tuo errore con ') + esc(Core.TACTIC_NAME[m.foundTactic].toLowerCase()) + '.');
  if (m.loss >= 2 && m.cls !== 'book') lines.push('<span class="dim">Probabilità di vittoria: ' + m.before.toFixed(0) + '% → ' + m.after.toFixed(0) + '%' + (m.spent != null ? ' · pensata ' + m.spent.toFixed(1) + ' s' : '') + '</span>');
  else if (m.spent != null) lines.push('<span class="dim">Pensata ' + m.spent.toFixed(1) + ' s</span>');
  box.innerHTML = ci(m.cls) + '<div class="bubble"><div class="head"><span class="hd"><span class="num">' + num + ' ' + esc(mv.san) + '</span> <span class="ct c-' + m.cls + '">' + PHRASE[m.cls] + '</span></span>' + evBadge + '</div>' +
    (lines.length ? '<p>' + lines.join('<br>') + '</p>' : '') +
    (m.best && !['best', 'great', 'brilliant', 'book'].includes(m.cls) ? '<div class="row" style="margin-top:8px"><button class="btn sm" id="tryBest">Prova la migliore</button></div>' : '') + '</div>';
  const tb = $('tryBest');
  if (tb) tb.onclick = () => { S.rv.ply = ply - 1; toggleExplore(true); exploreMove(m.best.slice(0, 2), m.best.slice(2, 4), m.best[4]); };
}
function tcLabel(tc) { if (tc.includes('/')) return ''; const [b, i] = tc.split('+'); const m = +b / 60; return (m >= 1 ? (Number.isInteger(m) ? m : m.toFixed(1)) + ' min' : b + ' s') + (+i ? ' + ' + i : ''); }
function resultText(g) {
  if (!g.userColor) return g.result;
  const t = (g.termination || '').toLowerCase();
  const how = /checkmate|scacco matto/.test(t) ? 'per scacco matto' : /time|tempo/.test(t) ? 'per tempo' : /resign|abbandon/.test(t) ? 'per abbandono' : /abandon/.test(t) ? 'per abbandono' : /stalemate/.test(t) ? 'per stallo' : /repetition/.test(t) ? 'per ripetizione' : /agreement|accordo/.test(t) ? 'per accordo' : /insufficient/.test(t) ? 'per materiale insufficiente' : '';
  return ({ win: 'Hai vinto', loss: 'Hai perso', draw: 'Patta' }[g.outcome] || g.result) + (how ? ' ' + how : '');
}
function renderMoves() {
  const g = game(S.rv.id), rv = reviewOf(S.rv.id);
  let h = '';
  for (let i = 0; i < g.moves.length; i += 2) {
    h += '<span class="n">' + (i / 2 + 1) + '.</span>';
    for (let j = i; j < i + 2; j++) {
      if (j >= g.moves.length) { h += '<span></span>'; continue; }
      const c = rv ? rv[j].cls : null, show = c && !['good', 'excellent', 'best', 'book'].includes(c);
      h += '<button data-ply="' + (j + 1) + '">' + (show ? ci(c, true) : '') + esc(g.moves[j].san) + '</button>';
    }
  }
  $('moves').innerHTML = h;
}
function drawGraph(g, an, rv, ply) {
  const svg = $('graph'), W = 600, H = 96, n = g.fens.length;
  if (!an || an.v !== 2) { svg.innerHTML = '<rect width="600" height="96" fill="#22201e"/><text x="300" y="54" text-anchor="middle" font-size="15" fill="#8d877d" font-family="Rubik, sans-serif">Il grafico arriva dopo l\'analisi</text>'; return; }
  const x = (i) => (n > 1 ? i * W / (n - 1) : 0), y = (i) => H * (1 - Core.winPct(Core.unpackEv(an.ev[i])) / 100);
  const pts = []; for (let i = 0; i < n; i++) pts.push(x(i).toFixed(1) + ',' + y(i).toFixed(1));
  let s = '<rect width="' + W + '" height="' + H + '" fill="#403d39"/>';
  s += '<polygon points="0,' + H + ' ' + pts.join(' ') + ' ' + W + ',' + H + '" fill="#f4f1ea"/>';
  s += '<line x1="0" x2="' + W + '" y1="' + H / 2 + '" y2="' + H / 2 + '" stroke="#8d877d" stroke-width="1" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>';
  if (rv) rv.forEach((m) => { if (['mistake', 'blunder', 'miss', 'brilliant', 'great'].includes(m.cls)) s += '<circle cx="' + x(m.i + 1) + '" cy="' + y(m.i + 1) + '" r="4" style="fill:var(--c-' + m.cls + ')" stroke="#0008" vector-effect="non-scaling-stroke"/>'; });
  s += '<line x1="' + x(ply) + '" x2="' + x(ply) + '" y1="0" y2="' + H + '" style="stroke:var(--green)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>';
  svg.innerHTML = s;
}
function renderSummary() {
  const id = S.rv.id, g = game(id), rv = reviewOf(id), rec = S.recs.get(id), box = $('rvSum');
  if (!rv) { box.innerHTML = '<div class="card"><h3>Riepilogo</h3><p class="muted" style="margin:0">Arriva dopo l\'analisi della partita.</p></div>'; return; }
  const s = Core.gameSummary(g, rv);
  let h = '<div class="card"><div class="acc-hero"><div class="box w"><div class="who">' + esc(g.white) + '</div><b class="num">' + fmt1(s.accW) + '</b></div><div class="lbl">Precisione</div><div class="box b"><div class="who">' + esc(g.black) + '</div><b class="num">' + fmt1(s.accB) + '</b></div></div>';
  if (rec.ca && (rec.ca.w != null || rec.ca.b != null)) h += '<p class="dim small" style="text-align:center;margin:8px 0 0">Su Chess.com: ' + fmt1(rec.ca.w) + ' · ' + fmt1(rec.ca.b) + '</p>';
  h += '<table class="ctab">';
  Core.CLASS.forEach((c) => {
    const a = s.counts.w[c], b = s.counts.b[c];
    h += '<tr class="' + (a + b ? '' : 'z') + '"><td class="ct c-' + c + '">' + a + '</td><td class="mid">' + ci(c, true) + '<span>' + CN[c] + '</span></td><td class="ct c-' + c + '">' + b + '</td></tr>';
  });
  h += '</table></div>';
  h += '<div class="card small muted"><div><b style="color:var(--text)">' + esc(g.opening) + '</b>' + (g.eco ? ' · ' + esc(g.eco) : '') + '</div><div style="margin-top:4px">' + esc(resultText(g)) + ' · analisi a profondità ' + rec.an.depth + '</div>' +
    '<div class="row" style="margin-top:10px">' + (g.link ? '<a class="btn sm" href="' + esc(g.link) + '" target="_blank" rel="noopener">Apri su Chess.com</a>' : '') + '<button class="btn sm ghost" id="reOne">Rianalizza più a fondo</button></div></div>';
  box.innerHTML = h;
  $('reOne').onclick = () => { const r = S.recs.get(id); r.an = null; r.rv = null; r.sum = null; delete S.reviews[id]; S.run.override[id] = 'deep'; enqueue([id], true); renderSummary(); renderMoves(); drawReview(false); };
}
function go(delta, abs) {
  if (!S.rv.id) return;
  if (S.rv.explore) { if (delta < 0 && S.rv.explore.moves.length) { const ex = S.rv.explore; ex.fens.pop(); ex.moves.pop(); ex.sans.pop(); drawReview(); think(); } return; }
  const g = game(S.rv.id), p = Math.max(0, Math.min(g.moves.length, abs != null ? abs : S.rv.ply + delta));
  if (p === S.rv.ply) return;
  const forward = p === S.rv.ply + 1;
  S.rv.ply = p;
  if (forward) sound(g.moves[p - 1].captured ? 'capture' : 'move');
  drawReview(Math.abs(delta) === 1 || forward);
}
/* explorer */
function toggleExplore(on) {
  if (on == null) on = !S.rv.explore;
  if (on) {
    const fen = game(S.rv.id).fens[S.rv.ply];
    S.rv.explore = { fens: [fen], moves: [], sans: [], lines: [], depth: 0 };
    drawReview(false); think();
  } else { S.rv.explore = null; stopLive(); drawReview(false); }
}
function exploreMove(from, to, promo) {
  const ex = S.rv.explore; if (!ex) return;
  const fen = ex.fens[ex.fens.length - 1], ch = new Chess(fen);
  const m = ch.move({ from, to, promotion: promo || 'q' });
  if (!m) return;
  sound(m.captured ? 'capture' : 'move');
  ex.fens.push(ch.fen()); ex.moves.push(from + to + (m.promotion || '')); ex.sans.push(m.san); ex.lines = []; ex.depth = 0;
  drawReview(); think();
}
let thinkT = 0;
function think() {
  const ex = S.rv.explore; if (!ex) return;
  const fen = ex.fens[ex.fens.length - 1];
  if (new Chess(fen).game_over()) { ex.lines = []; return; }
  if (!liveEngine) liveEngine = new Engine();
  liveEngine.think(fen, (lines, depth) => {
    if (S.rv.explore !== ex || ex.fens[ex.fens.length - 1] !== fen) return;
    ex.lines = lines; ex.depth = depth;
    const now = Date.now(); if (now - thinkT < 250) return; thinkT = now;
    drawReview(false);
  }, { multipv: 3, depth: 24 }).catch(() => toast('Il motore non si è avviato'));
}
function stopLive() { if (liveEngine) liveEngine.stop(); }

/* ---------------- view: stats ---------------- */
function statsEntries() {
  return sortedIds().filter((id) => S.recs.get(id).src !== 'bot').map((id) => ({ game: meta(id), rv: crev(id) })).filter((e) => e.game.userColor &&
    (S.stats.tc === 'all' || e.game.timeClass === S.stats.tc) && (S.stats.color === 'all' || e.game.userColor === S.stats.color));
}
function renderStats() {
  const v = $('v-stats'), ids = sortedIds();
  if (!ids.length) { v.innerHTML = '<h1>Statistiche</h1><div class="empty">Carica le tue partite da Chess.com per vedere le statistiche.</div>'; return; }
  const tcs = ['all', ...new Set(ids.map((id) => meta(id).timeClass))];
  let h = '<h1>Statistiche</h1><div class="stack" style="gap:8px"><div class="chips" id="stTc">' + tcs.map((k) => '<button aria-pressed="' + (S.stats.tc === k) + '" data-v="' + k + '">' + TC_NAME[k] + '</button>').join('') + '</div>' +
    '<div class="chips" id="stCol">' + [['all', 'Tutti i colori'], ['w', 'Col bianco'], ['b', 'Col nero']].map(([k, l]) => '<button aria-pressed="' + (S.stats.color === k) + '" data-v="' + k + '">' + l + '</button>').join('') + '</div></div>';
  const A = Core.aggregate(statsEntries());
  if (migrating) h += '<p class="dim small">Sto preparando le statistiche delle partite già analizzate…</p>';
  if (!A.games) { v.innerHTML = h + '<div class="empty" style="margin-top:14px">Nessuna partita con questi filtri.</div>'; bindStats(); return; }
  const R = A.results, tot = R.win + R.draw + R.loss;
  let moves = 0; for (const c in A.cls) if (c !== 'book') moves += A.cls[c];
  const accs = A.accSeries.map((x) => x.acc), opps = A.accSeries.map((x) => x.opp).filter((x) => x != null);
  h += '<h2>Riepilogo</h2><div class="kpis">' +
    kpi('Partite', A.games, A.analyzed + ' analizzate') +
    kpi('Punteggio', tot ? pct(100 * (R.win + R.draw / 2) / tot) : '–', R.win + ' V · ' + R.draw + ' P · ' + R.loss + ' S') +
    kpi('Precisione media', accs.length ? fmt1(mean(accs)) : '–', opps.length ? 'avversari ' + fmt1(mean(opps)) : 'dopo l\'analisi') +
    kpi('Blunder / 100 mosse', moves ? per100(A.cls.blunder, moves).toFixed(1) : '–', moves ? per100(A.cls.mistake + A.cls.miss, moves).toFixed(1) + ' errori' : '') + '</div>';
  if (tot) h += '<div class="wdl"><i style="width:' + 100 * R.win / tot + '%;background:var(--win)"></i><i style="width:' + 100 * R.draw / tot + '%;background:var(--draw)"></i><i style="width:' + 100 * R.loss / tot + '%;background:var(--loss)"></i></div>';
  if (!A.analyzed) { v.innerHTML = h + '<div class="empty" style="margin-top:16px">Pezzi, fasi e tattiche compaiono dopo l\'analisi. Vai su Partite e premi «Analizza tutte».</div>' + openingsHtml(A); bindStats(); return; }
  h += '<h2>Cosa emerge</h2><div class="card">' + insights(A) + '</div>';
  h += '<h2>Andamento</h2><div class="grid2"><div class="card chart"><h3>Precisione per partita</h3>' + lineChart(accs, { min: 0, max: 100, rolling: 5 }) + '<div class="row dim small" style="margin-top:6px"><span><i class="sqc" style="display:inline-block;background:var(--text-3);border-radius:50%"></i> partita</span><span><i class="sqc" style="display:inline-block;background:var(--green);border-radius:50%"></i> media su 5</span></div></div>';
  const rk = S.stats.tc !== 'all' ? S.stats.tc : Object.keys(A.ratings).sort((a, b) => A.ratings[b].length - A.ratings[a].length)[0];
  if (rk && A.ratings[rk] && A.ratings[rk].length > 1) { const rr = A.ratings[rk]; h += '<div class="card chart"><h3>Elo ' + TC_NAME[rk] + '</h3>' + lineChart(rr.map((x) => x.elo), {}) + '<div class="dim small" style="margin-top:6px">da ' + rr[0].elo + ' a ' + rr[rr.length - 1].elo + ' in ' + rr.length + ' partite</div></div>'; }
  h += '</div>';
  // classification
  h += '<h2>Qualità delle mosse</h2><div class="card hbars">';
  const maxC = Math.max(...Core.CLASS.map((c) => A.cls[c]));
  let allM = 0; Core.CLASS.forEach((c) => { allM += A.cls[c]; });
  Core.CLASS.forEach((c) => { h += '<div class="hbar"><span>' + ci(c, true) + CN[c] + '</span>' + bar(A.cls[c], maxC, 'var(--c-' + c + ')') + '<span class="v">' + pct(per100(A.cls[c], allM), 1) + '</span></div>'; });
  h += '</div>';
  // pieces
  h += '<h2>Pezzo per pezzo</h2><div class="card"><div class="tbl"><table class="t"><thead><tr><th>Pezzo</th><th>Mosse</th><th>Precisione</th><th>Migliori</th><th>Impr.</th><th>Errori</th><th>Blunder</th><th>In presa</th></tr></thead><tbody>';
  const col = S.stats.color === 'b' ? 'b' : 'w';
  'pnbrqk'.split('').forEach((p) => {
    const P = A.pieces[p];
    h += '<tr><td><img class="pcimg" src="' + PIECE(col + p.toUpperCase()) + '" alt="">' + Core.PIECE_NAME[p] + '</td><td>' + P.n + '</td><td>' + (P.n ? fmt1(P.acc / P.n) : '–') + '</td><td>' + (P.n ? pct(per100(P.best, P.n)) : '–') + '</td><td>' + P.inacc + '</td><td>' + P.mist + '</td><td>' + P.blun + '</td><td>' + (A.hung[p] || 0) + '</td></tr>';
  });
  h += '</tbody></table></div><p class="dim small" style="margin:10px 0 0">Precisione sulle mosse fatte con quel pezzo (esclusa la teoria). «In presa»: volte in cui un tuo errore l\'ha lasciato catturabile gratis.</p></div>';
  // phases
  h += '<h2>Fasi della partita</h2><div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">';
  ['opening', 'middlegame', 'endgame'].forEach((p) => { const Ph = A.phases[p]; h += kpi(PHASE_NAME[p], Ph.n ? fmt1(Ph.acc / Ph.n) : '–', Ph.n ? per100(Ph.err, Ph.n).toFixed(1) + ' errori ogni 100' : 'nessuna mossa'); });
  h += '</div>';
  // tactics
  h += '<h2>Tattiche</h2><div class="grid2">' +
    tacticCard('Che ti sfuggono', 'Il motore aveva questa tattica e hai giocato altro.', A.tactics.missed, 'var(--c-miss)') +
    tacticCard('Che concedi', 'Dopo un tuo errore l\'avversario poteva colpire così.', A.tactics.allowed, 'var(--c-blunder)') +
    tacticCard('Che sfrutti', 'Hai punito un errore dell\'avversario con questo motivo.', A.tactics.found, 'var(--c-best)') +
    '<div class="card"><h3>Errori dell\'avversario puniti</h3><b class="num" style="font-size:30px;font-weight:800">' + (A.chances ? pct(100 * A.converted / A.chances) : '–') + '</b><p class="muted small" style="margin:4px 0 0">' + A.converted + ' su ' + A.chances + ' occasioni. ' + (A.missedMates ? 'Matti mancati: ' + A.missedMates + '.' : 'Nessun matto mancato.') + '</p><button class="btn sm primary" style="margin-top:10px" data-go="puzzle">Allenati sui tuoi errori</button></div></div>';
  // time
  const T = A.time;
  if (T.lowClockMoves + T.normMoves) {
    const lo = per100(T.lowClockErrors, T.lowClockMoves), no = per100(T.normErrors, T.normMoves), mx = Math.max(lo, no, 1);
    h += '<h2>Gestione del tempo</h2><div class="grid2"><div class="card"><h3>Errori gravi ogni 100 mosse</h3><div class="hbars">' +
      '<div class="hbar"><span>Più di 30 s</span>' + bar(no, mx, 'var(--green)') + '<span class="v">' + no.toFixed(1) + '</span></div>' +
      '<div class="hbar"><span>Sotto i 30 s</span>' + bar(lo, mx, 'var(--c-blunder)') + '<span class="v">' + (T.lowClockMoves ? lo.toFixed(1) : '–') + '</span></div></div><p class="dim small" style="margin:10px 0 0">' + T.lowClockMoves + ' mosse giocate con meno di 30 secondi.</p></div>';
    const tm = Math.max(...Core.CLASS.map((c) => (T.spentByCls[c].n ? T.spentByCls[c].t / T.spentByCls[c].n : 0)));
    h += '<div class="card"><h3>Tempo medio per tipo di mossa</h3><div class="hbars">' + Core.CLASS.filter((c) => T.spentByCls[c].n && c !== 'book').map((c) => { const x = T.spentByCls[c]; return '<div class="hbar"><span>' + ci(c, true) + CN[c] + '</span>' + bar(x.t / x.n, tm, 'var(--c-' + c + ')') + '<span class="v">' + (x.t / x.n).toFixed(1) + ' s</span></div>'; }).join('') + '</div></div></div>';
  }
  h += openingsHtml(A);
  if (A.worst.length) {
    h += '<h2>Blunder da rivedere</h2><div class="glist">';
    A.worst.forEach((w) => {
      const g = meta(w.id), mn = Math.floor(w.i / 2) + 1 + (w.i % 2 ? '…' : '.');
      h += '<div class="gi" tabindex="0" role="button" data-id="' + esc(w.id) + '" data-ply="' + (w.i + 1) + '"><span>' + ci('blunder') + '</span><div class="pl"><span class="me num">' + mn + ' ' + esc(w.san) + '</span><span class="muted">contro ' + esc(opp(g)) + ' · ' + esc(fmtDate(g.ts)) + '</span></div><div class="acc"><b class="num">−' + w.loss.toFixed(0) + '%</b><div class="dim">vittoria</div></div><span></span></div>';
    });
    h += '</div>';
  }
  v.innerHTML = h; bindStats();
}
function bindStats() {
  const v = $('v-stats');
  const tc = $('stTc'), cl = $('stCol');
  if (tc) tc.onclick = (e) => { const b = e.target.closest('button'); if (b) { S.stats.tc = b.dataset.v; renderStats(); } };
  if (cl) cl.onclick = (e) => { const b = e.target.closest('button'); if (b) { S.stats.color = b.dataset.v; renderStats(); } };
  v.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => show(b.dataset.go); });
}
function kpi(l, v, s) { return '<div class="kpi"><span class="lbl">' + l + '</span><b class="num">' + v + '</b><small>' + (s || '') + '</small></div>'; }
function tacticCard(title, sub, obj, color) {
  const keys = Object.keys(obj).sort((a, b) => obj[b] - obj[a]), max = keys.length ? obj[keys[0]] : 0;
  let h = '<div class="card"><h3>' + title + '</h3><p class="dim small" style="margin:-4px 0 10px">' + sub + '</p>';
  if (!keys.length) return h + '<p class="muted small" style="margin:0">Nessun caso trovato.</p></div>';
  return h + '<div class="hbars">' + keys.map((k) => '<div class="hbar"><span>' + esc(Core.TACTIC_NAME[k]) + '</span>' + bar(obj[k], max, color) + '<span class="v">' + obj[k] + '</span></div>').join('') + '</div></div>';
}
function openingsHtml(A) {
  const list = Object.values(A.openings).sort((a, b) => b.n - a.n);
  if (!list.length) return '';
  let h = '<h2>Aperture</h2><div class="card"><div class="tbl"><table class="t"><thead><tr><th>Apertura</th><th>Col.</th><th>Partite</th><th>V-P-S</th><th>Punti</th><th>Prec.</th></tr></thead><tbody>';
  list.slice(0, 15).forEach((o) => {
    const sc = o.n ? 100 * (o.win + o.draw / 2) / o.n : null, oa = mean(o.openAcc);
    h += '<tr><td style="white-space:normal;min-width:150px">' + esc(o.name) + '</td><td><i class="sqc ' + o.color + '" style="display:inline-block"></i></td><td>' + o.n + '</td><td>' + o.win + '-' + o.draw + '-' + o.loss + '</td><td style="color:' + (sc >= 55 ? 'var(--win)' : sc < 45 ? 'var(--loss)' : 'inherit') + ';font-weight:600">' + pct(sc) + '</td><td>' + fmt1(oa) + '</td></tr>';
  });
  return h + '</tbody></table></div><p class="dim small" style="margin:10px 0 0">«Prec.»: precisione media nelle prime 10 mosse.</p></div>';
}
function insights(A) {
  const out = [];
  const pcs = 'pnbrqk'.split('').filter((p) => A.pieces[p].n >= 15);
  if (pcs.length >= 2) {
    pcs.sort((a, b) => A.pieces[a].acc / A.pieces[a].n - A.pieces[b].acc / A.pieces[b].n);
    const w = pcs[0], b = pcs[pcs.length - 1];
    out.push('Il pezzo che muovi peggio è <b>' + Core.PIECE_NAME[w].toLowerCase() + '</b> (precisione ' + fmt1(A.pieces[w].acc / A.pieces[w].n) + '); il migliore è <b>' + Core.PIECE_NAME[b].toLowerCase() + '</b> (' + fmt1(A.pieces[b].acc / A.pieces[b].n) + ').');
  }
  const hk = Object.keys(A.hung).sort((a, b) => A.hung[b] - A.hung[a]);
  if (hk.length && A.hung[hk[0]] >= 2) out.push('Il pezzo che lasci più spesso in presa è <b>' + Core.PIECE_NAME[hk[0]].toLowerCase() + '</b>: ' + times(A.hung[hk[0]]) + '.');
  const ph = ['opening', 'middlegame', 'endgame'].filter((p) => A.phases[p].n >= 20);
  if (ph.length >= 2) { ph.sort((a, b) => A.phases[b].err / A.phases[b].n - A.phases[a].err / A.phases[a].n); out.push('Sbagli di più nel <b>' + PHASE_NAME[ph[0]].toLowerCase() + '</b>: ' + per100(A.phases[ph[0]].err, A.phases[ph[0]].n).toFixed(1) + ' errori gravi ogni 100 mosse.'); }
  const al = Object.keys(A.tactics.allowed).sort((a, b) => A.tactics.allowed[b] - A.tactics.allowed[a]);
  if (al.length) out.push('La tattica che concedi più spesso è <b>' + Core.TACTIC_NAME[al[0]].toLowerCase() + '</b> (' + times(A.tactics.allowed[al[0]]) + ').');
  const ms = Object.keys(A.tactics.missed).sort((a, b) => A.tactics.missed[b] - A.tactics.missed[a]);
  if (ms.length) out.push('Quella che ti sfugge più spesso è <b>' + Core.TACTIC_NAME[ms[0]].toLowerCase() + '</b> (' + times(A.tactics.missed[ms[0]]) + ').');
  if (A.chances >= 5) out.push('Punisci il <b>' + pct(100 * A.converted / A.chances) + '</b> degli errori gravi dell\'avversario.');
  const T = A.time;
  if (T.lowClockMoves >= 20 && T.normMoves) { const r1 = per100(T.lowClockErrors, T.lowClockMoves), r0 = per100(T.normErrors, T.normMoves); if (r1 > r0 * 1.5) out.push('Sotto i 30 secondi gli errori gravi passano da ' + r0.toFixed(1) + ' a <b>' + r1.toFixed(1) + '</b> ogni 100 mosse.'); }
  const cw = mean(A.byColor.w.acc), cb = mean(A.byColor.b.acc);
  if (A.byColor.w.acc.length >= 3 && A.byColor.b.acc.length >= 3) out.push('Precisione col bianco ' + fmt1(cw) + ', col nero ' + fmt1(cb) + '.');
  if (!out.length) return '<p class="muted" style="margin:0">Servono più partite analizzate per trovare tendenze affidabili.</p>';
  return out.map((s) => '<div class="insight"><span class="dot"></span><span>' + s + '</span></div>').join('');
}
function lineChart(vals, o) {
  if (!vals.length) return '<p class="muted">Nessun dato.</p>';
  const W = 600, H = 200, pl = 40, pr = 12, pt = 10, pb = 24;
  let mn = o.min != null ? o.min : Math.min(...vals), mx = o.max != null ? o.max : Math.max(...vals);
  if (o.min == null) { const pad = Math.max(10, (mx - mn) * 0.1); mn = Math.floor((mn - pad) / 10) * 10; mx = Math.ceil((mx + pad) / 10) * 10; }
  if (mx === mn) mx = mn + 1;
  const x = (i) => pl + (vals.length === 1 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (vals.length - 1));
  const y = (v) => pt + (H - pt - pb) * (1 - (v - mn) / (mx - mn));
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">';
  for (let k = 0; k <= 4; k++) { const v = mn + (mx - mn) * k / 4, yy = y(v); s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy + '" y2="' + yy + '" stroke="#4a4743"/><text x="' + (pl - 7) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="13" fill="#8d877d" font-family="Rubik,sans-serif">' + Math.round(v) + '</text>'; }
  s += '<text x="' + pl + '" y="' + (H - 4) + '" font-size="13" fill="#8d877d" font-family="Rubik,sans-serif">meno recente</text><text x="' + (W - pr) + '" y="' + (H - 4) + '" font-size="13" text-anchor="end" fill="#8d877d" font-family="Rubik,sans-serif">più recente</text>';
  if (o.rolling) {
    vals.forEach((v, i) => { s += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="3.2" fill="#8d877d" opacity=".6"/>'; });
    const pts = vals.map((v, i) => x(i) + ',' + y(mean(vals.slice(Math.max(0, i - o.rolling + 1), i + 1))));
    s += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#81b64c" stroke-width="3" stroke-linejoin="round"/>';
  } else {
    const p2 = vals.map((v, i) => x(i) + ',' + y(v));
    s += '<polygon points="' + pl + ',' + (H - pb) + ' ' + p2.join(' ') + ' ' + x(vals.length - 1) + ',' + (H - pb) + '" fill="#81b64c" opacity=".14"/><polyline points="' + p2.join(' ') + '" fill="none" stroke="#81b64c" stroke-width="3" stroke-linejoin="round"/><circle cx="' + x(vals.length - 1) + '" cy="' + y(vals[vals.length - 1]) + '" r="5" fill="#81b64c"/>';
  }
  return s + '</svg>';
}

/* ---------------- view: puzzle ---------------- */
function buildPuzzles() {
  const list = [];
  sortedIds().forEach((id) => { const rv = crev(id); if (rv) list.push(...Core.puzzlesFrom(meta(id), rv)); });
  S.pz.all = list;
}
function pzList() {
  const P = S.pz.progress, f = S.pz.filter;
  return S.pz.all.filter((p) => f === 'all' || (f === 'todo' && !(P[p.id] && P[p.id].solved)) || (f === 'tactic' && p.theme) || (f === 'blunder' && p.cls === 'blunder'));
}
function renderPuzzle() {
  const v = $('v-puzzle');
  buildPuzzles();
  const all = S.pz.all, P = S.pz.progress;
  const solved = all.filter((p) => P[p.id] && P[p.id].solved).length, first = all.filter((p) => P[p.id] && P[p.id].first).length;
  let h = '<h1>Puzzle dai tuoi errori</h1>';
  if (!all.length) { v.innerHTML = h + '<div class="empty">Qui trovi le posizioni in cui hai sbagliato, da risolvere. Compaiono dopo l\'analisi delle partite.</div>'; return; }
  h += '<div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">' + kpi('Posizioni', all.length, 'dai tuoi errori') + kpi('Risolte', solved, pct(per100(solved, all.length))) + kpi('Primo colpo', first, solved ? pct(per100(first, solved)) : '–') + '</div>';
  h += '<div class="chips" id="pzF" style="margin:14px 0 10px">' + [['todo', 'Da risolvere'], ['all', 'Tutti'], ['tactic', 'Tattiche'], ['blunder', 'Solo blunder']].map(([k, l]) => '<button aria-pressed="' + (S.pz.filter === k) + '" data-v="' + k + '">' + l + '</button>').join('') + '</div>';
  h += '<div class="rv"><div class="stack" style="gap:10px"><div id="pzBoard"></div></div><div class="stack" id="pzSide"></div></div>';
  v.innerHTML = h;
  $('pzF').onclick = (e) => { const b = e.target.closest('button'); if (b) { S.pz.filter = b.dataset.v; S.pz.idx = 0; renderPuzzle(); } };
  pzBoard = new Board($('pzBoard'), { onMove: pzMove });
  loadPuzzle();
}
function curPuzzle() { const l = pzList(); if (!l.length) return null; S.pz.idx = ((S.pz.idx % l.length) + l.length) % l.length; return l[S.pz.idx]; }
function loadPuzzle() {
  const p = curPuzzle(), side = $('pzSide');
  if (!p) { side.innerHTML = '<div class="empty">Hai risolto tutto in questa lista. Ottimo lavoro.</div>'; pzBoard.set(Core.START, { animate: false }); pzBoard.setMovable(null); return; }
  S.pz.step = 0; S.pz.state = 'play'; S.pz.fen = p.fen; S.pz.tries = 0;
  const turn = p.fen.split(' ')[1];
  pzBoard.setOrientation(turn);
  const pg = game(p.gameId), pm = p.ply > 0 ? pg.moves[p.ply - 1] : null;
  pzBoard.set(p.fen, { animate: false, lastMove: pm ? [pm.from, pm.to] : null });
  pzSetMovable();
  pzSide();
}
function pzSetMovable() {
  const d = {}; new Chess(S.pz.fen).moves({ verbose: true }).forEach((m) => { (d[m.from] = d[m.from] || []).push(m.to); });
  pzBoard.setMovable(S.pz.state === 'play' ? d : null);
}
function pzSide(msg) {
  const p = curPuzzle(), g = meta(p.gameId), turn = p.fen.split(' ')[1], st = S.pz.state;
  const l = pzList(), mvNo = Math.floor(p.ply / 2) + 1;
  let head = '';
  if (st === 'ok') head = '<div class="pz-status ok"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17 19 7"/></svg><div><b>Risolto!</b><div class="small">' + (msg || 'Era la mossa migliore.') + '</div></div></div>';
  else if (st === 'ko') head = '<div class="pz-status ko"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg><div><b>Non è la migliore</b><div class="small">' + (msg || 'Riprova.') + '</div></div></div>';
  else head = '<div class="pz-status"><span class="turn ' + turn + '"></span><div><b>Tocca al ' + (turn === 'w' ? 'Bianco' : 'Nero') + '</b><div class="small muted">' + (S.pz.step ? 'Continua: trova la mossa successiva.' : 'Trova la mossa migliore.') + '</div></div></div>';
  let h = head + '<div class="card small"><div class="row"><span class="lbl grow">Puzzle ' + (S.pz.idx + 1) + ' di ' + l.length + '</span>' + ci(p.cls, true) + '</div>' +
    '<p class="muted" style="margin:8px 0 0">Mossa ' + mvNo + ' contro ' + esc(opp(g)) + ', ' + esc(fmtDate(g.ts)) + '. Nella partita hai giocato <b style="color:var(--text)">' + esc(Core.sanOf(p.fen, p.played)) + '</b>' + (S.pz.hint && p.theme ? ' · tema: <b style="color:var(--text)">' + esc(Core.TACTIC_NAME[p.theme].toLowerCase()) + '</b>' : '') + '.</p></div>';
  h += '<div class="pz-actions">';
  if (st === 'ok') h += '<button class="btn primary" id="pzNext">Prossimo</button>';
  else h += '<button class="btn" id="pzHint">Suggerimento</button><button class="btn" id="pzSol">Soluzione</button><button class="btn ghost" id="pzSkip">Salta</button>';
  h += '<button class="btn ghost" id="pzGame">Vai alla partita</button></div>';
  $('pzSide').innerHTML = h;
  const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
  on('pzNext', () => { S.pz.idx++; S.pz.hint = false; loadPuzzle(); });
  on('pzSkip', () => { S.pz.idx++; S.pz.hint = false; loadPuzzle(); });
  on('pzHint', () => { S.pz.hint = true; const u = p.solution[S.pz.step]; pzBoard.state.lastMove = [u.slice(0, 2)]; pzBoard.paint(); S.pz.tries++; pzSide(); });
  on('pzSol', () => { S.pz.tries += 2; const u = p.solution[S.pz.step]; pzBoard.state.arrows = [{ from: u.slice(0, 2), to: u.slice(2, 4), color: '#81b64ce6' }]; pzBoard.paint(); });
  on('pzGame', () => { show('review'); openReview(p.gameId, p.ply); });
}
function pzMove(from, to) {
  const p = curPuzzle(); if (!p || S.pz.state !== 'play') return;
  const want = p.solution[S.pz.step], ch = new Chess(S.pz.fen);
  const m = ch.move({ from, to, promotion: 'q' }); if (!m) return;
  const correct = (from + to) === want.slice(0, 4) || ch.in_checkmate();
  pzBoard.set(ch.fen(), { lastMove: [from, to], animate: true });
  if (!correct) {
    sound('move'); S.pz.tries++; pzBoard.flash(to, 'ko'); S.pz.state = 'ko'; pzBoard.setMovable(null);
    pzSide('Questa mossa non regge. Riprova dalla stessa posizione.');
    setTimeout(() => { pzBoard.set(S.pz.fen, { animate: true }); S.pz.state = 'play'; pzSetMovable(); }, 1100);
    return;
  }
  sound(m.captured ? 'capture' : 'ok'); pzBoard.flash(to, 'ok');
  S.pz.fen = ch.fen(); S.pz.step++;
  if (S.pz.step >= p.solution.length || ch.game_over()) {
    S.pz.state = 'ok'; pzBoard.setMovable(null);
    const P = S.pz.progress; P[p.id] = { solved: true, first: S.pz.tries === 0 && !(P[p.id] && P[p.id].tried), at: Date.now() };
    store.set('puzzles', P);
    pzSide(S.pz.tries === 0 ? 'Al primo colpo.' : 'Ce l\'hai fatta.');
    return;
  }
  // opponent reply
  pzBoard.setMovable(null);
  const P = S.pz.progress; P[p.id] = Object.assign({}, P[p.id], { tried: true });
  setTimeout(() => {
    const r = p.solution[S.pz.step], c2 = new Chess(S.pz.fen), mm = c2.move({ from: r.slice(0, 2), to: r.slice(2, 4), promotion: r[4] || 'q' });
    if (!mm) { S.pz.state = 'ok'; pzSide(); return; }
    sound(mm.captured ? 'capture' : 'move');
    S.pz.fen = c2.fen(); S.pz.step++;
    pzBoard.set(S.pz.fen, { lastMove: [r.slice(0, 2), r.slice(2, 4)], animate: true });
    pzSetMovable(); pzSide();
  }, 450);
}

/* ---------------- navigation ---------------- */
function show(v) {
  S.view = v;
  ['games', 'review', 'play', 'stats', 'puzzle'].forEach((k) => { $('v-' + k).hidden = k !== v; });
  if (v !== 'play' && play) play.hide();
  if (v === 'play') {
    if (!play) play = createPlay({ root: $('v-play'), store, sound, toast, user: () => S.settings.user, profile: () => S.profile, onAnalyze: analyzeBotGame });
    play.show();
  }
  document.querySelectorAll('.nav button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  if (v !== 'review') stopLive();
  if (v === 'games') renderGames();
  if (v === 'stats') renderStats();
  if (v === 'puzzle') renderPuzzle();
  if (v === 'review') {
    if (!S.rv.id) { const f = sortedIds()[0]; if (f) openReview(f, 0); else $('v-review').querySelector('.rv').hidden = true; }
    else drawReview(false);
  }
  window.scrollTo(0, 0);
}
function refresh() {
  if (S.view === 'games') renderGames();
  if (S.view === 'stats') renderStats();
  progressTick(true);
}

/* ---------------- boot ---------------- */
async function boot() {
  try { Core.setBook(await (await fetch('data/openings.json')).json()); } catch (e) { /* no book: classification still works */ }
  try {
    const st = await store.get('settings'); if (st) Object.assign(S.settings, st);
    S.profile = (await store.get('profile')) || null;
    S.pz.progress = (await store.get('puzzles')) || {};
    (await store.allGames()).forEach((r) => S.recs.set(r.id, r));
  } catch (e) { toast('Archivio locale non disponibile: le partite non verranno salvate'); }
  store.persist();
  setTimeout(migrateCompact, 1500);
  document.querySelectorAll('.nav button').forEach((b) => { b.onclick = () => show(b.dataset.view); });
  document.addEventListener('click', (e) => {
    const gi = e.target.closest('.gi[data-id]');
    if (gi) { show('review'); openReview(gi.dataset.id, gi.dataset.ply ? +gi.dataset.ply : 0); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches && e.target.matches('.gi[data-id]')) e.target.click();
    if (S.view !== 'review' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { go(1); e.preventDefault(); }
  });
  $('cFirst').onclick = () => { if (S.rv.explore) toggleExplore(false); go(0, 0); };
  $('cPrev').onclick = () => go(-1);
  $('cNext').onclick = () => go(1);
  $('cLast').onclick = () => { if (S.rv.explore) toggleExplore(false); go(0, 9999); };
  $('cFlip').onclick = () => { S.rv.flip = !S.rv.flip; rvBoard.setOrientation(S.rv.flip ? 'b' : 'w'); drawReview(false); };
  $('cExplore').onclick = () => toggleExplore();
  $('moves').onclick = (e) => { const b = e.target.closest('button'); if (b) { if (S.rv.explore) { S.rv.explore = null; stopLive(); } go(0, +b.dataset.ply); drawReview(false); } };
  $('graph').onclick = (e) => { if (!S.rv.id) return; const r = e.currentTarget.getBoundingClientRect(), g = game(S.rv.id); if (S.rv.explore) { S.rv.explore = null; stopLive(); } go(0, Math.round((e.clientX - r.left) / r.width * g.moves.length)); drawReview(false); };
  $('tMoves').onclick = () => { S.rv.tab = 'moves'; $('tMoves').setAttribute('aria-selected', 'true'); $('tSum').setAttribute('aria-selected', 'false'); $('rvMoves').hidden = false; $('rvSum').hidden = true; };
  $('tSum').onclick = () => { S.rv.tab = 'sum'; $('tSum').setAttribute('aria-selected', 'true'); $('tMoves').setAttribute('aria-selected', 'false'); $('rvMoves').hidden = true; $('rvSum').hidden = false; };
  let sx = null;
  $('rvBoard').addEventListener('touchstart', (e) => { sx = S.rv.explore ? null : e.touches[0].clientX; }, { passive: true });
  $('rvBoard').addEventListener('touchend', (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 45) go(dx < 0 ? 1 : -1); sx = null; });

  // shared from the Chess.com app (Android share sheet) or link parameters
  const q = new URLSearchParams(location.search);
  const shared = [q.get('text'), q.get('url'), q.get('title')].filter(Boolean).join('\n');
  if (q.has('share') || shared) history.replaceState(null, '', location.pathname);
  show('games');
  if (shared && /\[Event /.test(shared)) importText(shared);
  else if (shared) {
    const m = shared.match(/chess\.com\/(?:game\/)?(?:live|daily)\/(?:game\/)?(\d+)/) || shared.match(/chess\.com\/game\/(\d+)/);
    if (m) { await sync(false); const id = 'g' + m[1]; if (S.recs.has(id)) { show('review'); openReview(id, 0); } else toast('Partita non trovata negli ultimi mesi'); return; }
  }
  if (S.settings.synced && Date.now() - S.settings.lastSync > 20 * 60 * 1000) sync(false);
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
boot();

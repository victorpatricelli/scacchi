/* Core: PGN parsing, engine analysis, move classification, tactics, statistics.
   Works in the browser (global Core) and in node (module.exports) for testing. */
var Core = (function () {
  'use strict';
  var VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  var PIECE_NAME = { p: 'Pedone', n: 'Cavallo', b: 'Alfiere', r: 'Torre', q: 'Donna', k: 'Re' };
  var CLASS = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];
  var CLASS_NAME = {
    brilliant: 'Brillante', great: 'Ottima mossa', best: 'Migliore', excellent: 'Eccellente', good: 'Buona',
    book: 'Teoria', inaccuracy: 'Imprecisione', mistake: 'Errore', miss: 'Occasione mancata', blunder: 'Blunder'
  };
  var CLASS_SYM = { brilliant: '!!', great: '!', best: '★', excellent: '✓', good: '✓', book: 'T', inaccuracy: '?!', mistake: '?', miss: '×', blunder: '??' };
  var TACTIC_NAME = {
    mate: 'Matto', fork: 'Forchetta', discovered: 'Attacco di scoperta', pin: 'Inchiodatura',
    skewer: 'Infilata', hanging: 'Pezzo in presa', trade_up: 'Cattura vantaggiosa',
    promotion: 'Promozione', positional: 'Mossa posizionale'
  };
  var START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  /* ---------- opening book (lichess chess-openings, hashed EPDs) ---------- */
  var BOOK = null, BOOKNAMES = {};
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function epdKey(fen) { return hashStr(fen.split(' ').slice(0, 4).join(' ')); }
  function setBook(data) {
    BOOK = {};
    (data.b || '').split(',').forEach(function (k) { BOOK[k] = 1; });
    BOOKNAMES = data.n || {};
  }

  /* ---------- PGN ---------- */
  function splitPGN(text) {
    text = String(text || '').replace(/\r/g, '').replace(/^﻿/, '');
    return text.split(/\n\s*\n(?=\[Event )/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function parseHeaders(pgn) {
    var h = {}, re = /^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm, m;
    while ((m = re.exec(pgn))) h[m[1]] = m[2];
    return h;
  }
  function extractClocks(pgn) {
    var body = pgn.replace(/^\[.*\]\s*$/gm, '');
    var out = [], re = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/g, m;
    while ((m = re.exec(body))) out.push(+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]));
    return out;
  }
  function gameId(h, pgn) {
    var link = h.Link || h.Site || '';
    var m = link.match(/\/game\/(?:live|daily)\/(\d+)/) || link.match(/\/game\/(\d+)/);
    if (m) return 'g' + m[1];
    var li = link.match(/lichess\.org\/([A-Za-z0-9]{8})/);
    if (li) return 'l' + li[1];
    return 'h' + hashStr(pgn.replace(/\s+/g, ' '));
  }
  function timeClass(tc) {
    if (!tc || tc === '-') return 'altro';
    if (tc.indexOf('/') >= 0) return 'daily';
    var p = tc.split('+'), est = (+p[0] || 0) + 40 * (+p[1] || 0);
    if (est < 180) return 'bullet';
    if (est < 600) return 'blitz';
    return 'rapid';
  }
  function ecoUrlName(h) {
    var slug = (h.ECOUrl || '').split('/openings/')[1];
    if (!slug) return null;
    var toks = decodeURIComponent(slug).split('?')[0].split('-'), words = [];
    for (var i = 0; i < toks.length; i++) { if (/^\d/.test(toks[i])) break; words.push(toks[i]); }
    return words.join(' ').trim() || null;
  }
  // Header-only metadata: fast, no move replay. Used for lists, sorting, stats.
  function parseMeta(pgn, username) {
    var h = parseHeaders(pgn);
    var u = String(username || '').toLowerCase();
    var white = h.White || '?', black = h.Black || '?';
    var us = u.split('|').filter(Boolean), userColor = us.indexOf(white.toLowerCase()) >= 0 ? 'w' : (us.indexOf(black.toLowerCase()) >= 0 ? 'b' : null);
    var res = h.Result || '*', outcome = null;
    if (userColor) {
      if (res === '1/2-1/2') outcome = 'draw';
      else if (res === '1-0') outcome = userColor === 'w' ? 'win' : 'loss';
      else if (res === '0-1') outcome = userColor === 'b' ? 'win' : 'loss';
    }
    var date = (h.UTCDate || h.Date || '').replace(/\./g, '-');
    var time = h.UTCTime || h.StartTime || '00:00:00';
    var tc = h.TimeControl || '';
    var body = pgn.replace(/^\[.*\]\s*$/gm, '').replace(/\{[^}]*\}/g, '');
    var nums = body.match(/\b\d+\.(?!\.)/g);
    var op = ecoUrlName(h) || h.Opening || (h.ECO ? 'ECO ' + h.ECO : 'Apertura sconosciuta');
    return {
      id: gameId(h, pgn), white: white, black: black, whiteElo: +h.WhiteElo || null, blackElo: +h.BlackElo || null,
      userColor: userColor, result: res, outcome: outcome, termination: h.Termination || '',
      ts: Date.parse(date + 'T' + time + 'Z') || 0, timeControl: tc, timeClass: timeClass(tc),
      opening: op, openingFamily: op.split(':')[0].split(',')[0].trim(), eco: h.ECO || '',
      plies: nums ? nums.length * 2 : 40, link: h.Link || (/^https?:/.test(h.Site || '') ? h.Site : '')
    };
  }
  // Small, storable version of a review (what stats and puzzles need).
  var KEEP = ['i', 'side', 'san', 'uci', 'piece', 'cls', 'acc', 'loss', 'before', 'phase', 'best', 'clock', 'spent',
    'missedTactic', 'allowedTactic', 'hungPiece', 'chance', 'converted', 'foundTactic', 'missedMate', 'pv'];
  function compactReview(game, rv) {
    return rv.map(function (m) {
      var o = {};
      KEEP.forEach(function (k) { if (m[k] != null && m[k] !== false) o[k] = typeof m[k] === 'number' && k !== 'i' ? Math.round(m[k] * 10) / 10 : m[k]; });
      if (m.side === game.userColor && (m.cls === 'blunder' || m.cls === 'mistake' || m.cls === 'miss')) o.fen = game.fens[m.i];
      return o;
    });
  }

  function parseGame(pgn, username) {
    var h = parseHeaders(pgn);
    var ch = new Chess();
    var clean = pgn.replace(/\{[^}]*\}/g, '').replace(/\$\d+/g, '');
    if (!ch.load_pgn(clean, { sloppy: true })) return null;
    var hist = ch.history({ verbose: true });
    if (!hist.length) return null;
    var replay = new Chess(h.FEN || START);
    var fens = [replay.fen()], moves = [];
    var bookName = null, bookEco = null, bookUntil = -1;
    for (var i = 0; i < hist.length; i++) {
      var mv = hist[i];
      moves.push({ san: mv.san, uci: mv.from + mv.to + (mv.promotion || ''), piece: mv.piece, color: mv.color, captured: mv.captured || null, from: mv.from, to: mv.to, flags: mv.flags });
      replay.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
      var f = replay.fen();
      fens.push(f);
      if (BOOK && !h.FEN && bookUntil === i - 1 && i < 40) {
        var k = epdKey(f);
        if (BOOK[k]) { bookUntil = i; if (BOOKNAMES[k]) { bookEco = BOOKNAMES[k][0]; bookName = BOOKNAMES[k][1]; } }
      }
    }
    var u = String(username || '').toLowerCase();
    var white = h.White || '?', black = h.Black || '?';
    var us = u.split('|').filter(Boolean), userColor = us.indexOf(white.toLowerCase()) >= 0 ? 'w' : (us.indexOf(black.toLowerCase()) >= 0 ? 'b' : null);
    var res = h.Result || '*', outcome = null;
    if (userColor) {
      if (res === '1/2-1/2') outcome = 'draw';
      else if (res === '1-0') outcome = userColor === 'w' ? 'win' : 'loss';
      else if (res === '0-1') outcome = userColor === 'b' ? 'win' : 'loss';
    }
    var date = (h.UTCDate || h.Date || '').replace(/\./g, '-');
    var time = h.UTCTime || h.StartTime || '00:00:00';
    var tc = h.TimeControl || '';
    var incr = 0, baseTime = null;
    if (tc.indexOf('+') > 0) incr = +tc.split('+')[1] || 0;
    if (tc && tc.indexOf('/') < 0 && +tc.split('+')[0]) baseTime = +tc.split('+')[0];
    var full = bookName || ecoUrlName(h) || h.Opening || (h.ECO ? 'ECO ' + h.ECO : 'Apertura sconosciuta');
    return {
      id: gameId(h, pgn), pgn: pgn, headers: h,
      white: white, black: black, whiteElo: +h.WhiteElo || null, blackElo: +h.BlackElo || null,
      userColor: userColor, result: res, outcome: outcome, termination: h.Termination || '',
      date: date, time: time, ts: Date.parse(date + 'T' + time + 'Z') || 0,
      timeControl: tc, timeClass: timeClass(tc), increment: incr, baseTime: baseTime,
      opening: full, openingFamily: full.split(':')[0].split(',')[0].trim(), eco: bookEco || h.ECO || '',
      bookUntil: bookUntil,
      link: h.Link || (/^https?:/.test(h.Site || '') ? h.Site : ''),
      fens: fens, moves: moves, clocks: extractClocks(pgn)
    };
  }

  /* ---------- evaluation helpers ---------- */
  function winPct(ev) { // ev {cp} | {mate}, white POV -> white win %
    if (ev == null) return 50;
    if (ev.mate != null) return ev.mate > 0 ? 100 : (ev.mate < 0 ? 0 : 50);
    var cp = Math.max(-1000, Math.min(1000, ev.cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  }
  function moveAccuracy(loss) { return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669)); }
  function evalText(ev) {
    if (!ev) return '';
    if (ev.mate != null) return (ev.mate > 0 ? 'M' : '-M') + Math.max(1, Math.round(Math.abs(ev.mate)));
    var v = ev.cp / 100;
    return (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) >= 10 ? 0 : 1);
  }
  function packEv(e) { // number: cp, or ±(100000 - mateDistance)
    if (e == null) return null;
    if (e.mate != null) { var m = Math.round(Math.abs(e.mate)); return (e.mate > 0 ? 1 : -1) * (100000 - m); }
    return Math.round(e.cp);
  }
  function unpackEv(x) {
    if (x == null) return null;
    if (Math.abs(x) >= 90000) { var m = 100000 - Math.abs(x); return { mate: (x > 0 ? 1 : -1) * Math.max(m, 0.001) }; }
    return { cp: x };
  }

  /* ---------- board geometry (tactics) ---------- */
  function board(fen) {
    var rows = fen.split(' ')[0].split('/'), b = {};
    for (var r = 0; r < 8; r++) {
      var f = 0, row = rows[r];
      for (var i = 0; i < row.length; i++) {
        var c = row[i];
        if (/\d/.test(c)) f += +c;
        else { b['abcdefgh'[f] + (8 - r)] = { t: c.toLowerCase(), c: c === c.toUpperCase() ? 'w' : 'b' }; f++; }
      }
    }
    return b;
  }
  function sq(f, r) { return (f < 0 || f > 7 || r < 0 || r > 7) ? null : 'abcdefgh'[f] + (r + 1); }
  function fr(s) { return [s.charCodeAt(0) - 97, +s[1] - 1]; }
  var DIRS = { b: [[1, 1], [1, -1], [-1, 1], [-1, -1]], r: [[1, 0], [-1, 0], [0, 1], [0, -1]] };
  DIRS.q = DIRS.b.concat(DIRS.r);
  var KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  var KG = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  function attacksFrom(b, s) {
    var p = b[s]; if (!p) return [];
    var a = fr(s), out = [], t;
    if (p.t === 'p') {
      var d = p.c === 'w' ? 1 : -1;
      [[1, d], [-1, d]].forEach(function (o) { t = sq(a[0] + o[0], a[1] + o[1]); if (t) out.push(t); });
    } else if (p.t === 'n' || p.t === 'k') {
      (p.t === 'n' ? KN : KG).forEach(function (o) { t = sq(a[0] + o[0], a[1] + o[1]); if (t) out.push(t); });
    } else {
      DIRS[p.t].forEach(function (o) {
        for (var i = 1; i < 8; i++) { t = sq(a[0] + o[0] * i, a[1] + o[1] * i); if (!t) break; out.push(t); if (b[t]) break; }
      });
    }
    return out;
  }
  function attackers(b, target, color) {
    var res = [];
    for (var s in b) if (b[s].c === color && attacksFrom(b, s).indexOf(target) >= 0) res.push(s);
    return res;
  }
  function applyUci(fen, uci) {
    var ch = new Chess(fen);
    var mv = ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
    if (!mv) return null;
    return { fen: ch.fen(), move: mv, mate: ch.in_checkmate(), check: ch.in_check() };
  }
  function sanOf(fen, uci) {
    if (!uci) return '';
    try { var r = applyUci(fen, uci); return r ? r.move.san : uci; } catch (e) { return uci; }
  }
  function pvSan(fen, pv, max) {
    var ch = new Chess(fen), out = [];
    for (var i = 0; i < pv.length && i < (max || 8); i++) {
      var u = pv[i], m = ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' });
      if (!m) break; out.push(m.san);
    }
    return out;
  }

  function tacticOf(fen, uci, mateForMover) {
    var r = applyUci(fen, uci);
    if (!r) return null;
    var me = r.move.color, op = me === 'w' ? 'b' : 'w';
    if (r.mate || mateForMover) return 'mate';
    var b0 = board(fen), b1 = board(r.fen), to = r.move.to, mover = b1[to];
    if (r.move.promotion) return 'promotion';
    var targets = attacksFrom(b1, to).filter(function (s) {
      var p = b1[s]; if (!p || p.c !== op) return false;
      if (p.t === 'k') return true;
      if (VAL[p.t] > VAL[mover.t]) return true;
      return attackers(b1, s, op).length === 0 && VAL[p.t] >= 3;
    });
    var safe = attackers(b1, to, op).length === 0;
    if (targets.length >= 2 && (safe || targets.some(function (s) { return b1[s].t === 'k'; }))) return 'fork';
    for (var s in b1) {
      if (s === to || b1[s].c !== me || 'bqr'.indexOf(b1[s].t) < 0) continue;
      var nowA = attacksFrom(b1, s), beforeA = b0[s] && b0[s].c === me ? attacksFrom(b0, s) : [];
      for (var i = 0; i < nowA.length; i++) {
        var p = b1[nowA[i]];
        if (p && p.c === op && (p.t === 'k' || p.t === 'q' || VAL[p.t] > VAL[b1[s].t]) && beforeA.indexOf(nowA[i]) < 0) return 'discovered';
      }
    }
    if ('bqr'.indexOf(mover.t) >= 0) {
      var a = fr(to), found = null;
      DIRS[mover.t].forEach(function (o) {
        if (found) return;
        var first = null;
        for (var k = 1; k < 8; k++) {
          var t = sq(a[0] + o[0] * k, a[1] + o[1] * k);
          if (!t) break;
          if (!b1[t]) continue;
          if (!first) { if (b1[t].c !== op) break; first = b1[t]; continue; }
          if (b1[t].c === op) {
            if (first.t === 'k' || (VAL[first.t] > VAL[b1[t].t] && VAL[first.t] > VAL[mover.t])) found = 'skewer';
            else if (b1[t].t === 'k' || VAL[b1[t].t] > VAL[first.t]) found = 'pin';
          }
          break;
        }
      });
      if (found) return found;
    }
    if (r.move.captured) {
      if (attackers(b1, to, op).length === 0) return 'hanging';
      if (VAL[r.move.captured] > VAL[mover.t]) return 'trade_up';
    }
    return 'positional';
  }
  // Is the move a real sacrifice? (moved piece left en prise, worth >= minor piece)
  function isSacrifice(fen, uci) {
    var r = applyUci(fen, uci);
    if (!r || r.move.promotion) return false;
    var me = r.move.color, op = me === 'w' ? 'b' : 'w';
    var b1 = board(r.fen), to = r.move.to, mv = b1[to];
    if (VAL[mv.t] < 3 || mv.t === 'k') return false;
    var att = attackers(b1, to, op);
    if (!att.length) return false;
    var gained = r.move.captured ? VAL[r.move.captured] : 0;
    var defended = attackers(b1, to, me).length > 0;
    var cheapest = Math.min.apply(null, att.map(function (s) { return VAL[b1[s].t]; }));
    var risk = defended ? VAL[mv.t] - cheapest : VAL[mv.t];
    return risk - gained >= 2;
  }

  /* ---------- engine analysis ---------- */
  // engine.analyze(fen, {depth, movetime, multipv}) -> Promise<{lines:[{cp|mate (side to move), pv:[uci]}]}>
  function analyzeGame(game, engine, opts, onProgress) {
    var n = game.fens.length, ev = new Array(n), ev2 = new Array(n), best = new Array(n), pvs = new Array(n), idx = 0;
    return new Promise(function (resolve, reject) {
      function done() {
        var an = { v: 2, depth: opts.depth, ev: ev.map(packEv), ev2: ev2.map(packEv), best: best, pv: {} };
        // keep the best line only where a puzzle could start (big swings)
        for (var i = 0; i < n - 1; i++) {
          var side = game.moves[i].color;
          var b = winPct(ev[i]), a = winPct(ev[i + 1]);
          var loss = side === 'w' ? b - a : a - b;
          if (loss >= 10 && pvs[i]) an.pv[i] = pvs[i].slice(0, 7).join(' ');
        }
        resolve(an);
      }
      function step() {
        if (idx >= n) return done();
        var fen = game.fens[idx], ch = new Chess(fen), turn = fen.split(' ')[1], s = turn === 'w' ? 1 : -1;
        if (ch.game_over()) {
          ev[idx] = ch.in_checkmate() ? { mate: turn === 'w' ? -0.001 : 0.001 } : { cp: 0 };
          ev2[idx] = null; best[idx] = ''; pvs[idx] = null;
          idx++; if (onProgress) onProgress(idx, n);
          return setTimeout(step, 0);
        }
        engine.analyze(fen, opts).then(function (r) {
          var l1 = r.lines[0] || { cp: 0, pv: [] }, l2 = r.lines[1];
          ev[idx] = l1.mate != null ? { mate: l1.mate * s } : { cp: l1.cp * s };
          ev2[idx] = l2 ? (l2.mate != null ? { mate: l2.mate * s } : { cp: l2.cp * s }) : null;
          best[idx] = (l1.pv && l1.pv[0]) || '';
          pvs[idx] = l1.pv || null;
          idx++; if (onProgress) onProgress(idx, n);
          step();
        }, reject);
      }
      step();
    });
  }

  function phaseOf(fen, ply) {
    var b = board(fen), heavy = 0, queens = 0;
    for (var s in b) { var t = b[s].t; if ('nbrq'.indexOf(t) >= 0) heavy++; if (t === 'q') queens++; }
    if (heavy <= 6 || (queens === 0 && heavy <= 8)) return 'endgame';
    if (ply < 20) return 'opening';
    return 'middlegame';
  }

  /* ---------- per-move review ---------- */
  function review(game, an) {
    var evs = an.ev.map(unpackEv), ev2 = (an.ev2 || []).map(unpackEv), out = [];
    var clocks = game.clocks || [];
    for (var i = 0; i < game.moves.length; i++) {
      var mv = game.moves[i], side = mv.color, sign = side === 'w' ? 1 : -1;
      var wpB = winPct(evs[i]), wpA = winPct(evs[i + 1]);
      var before = side === 'w' ? wpB : 100 - wpB, after = side === 'w' ? wpA : 100 - wpA;
      var isBest = !!an.best[i] && an.best[i].slice(0, 4) === mv.uci.slice(0, 4);
      var loss = isBest ? 0 : Math.max(0, before - after);
      var second = ev2[i] ? (side === 'w' ? winPct(ev2[i]) : 100 - winPct(ev2[i])) : null;
      var evB = evs[i], evA = evs[i + 1];
      var hadMate = evB.mate != null && evB.mate * sign > 0;
      var keepsMate = evA.mate != null && evA.mate * sign > 0;
      var prevLoss = i > 0 && out[i - 1] ? out[i - 1].loss : 0;
      var cls;
      if (i <= game.bookUntil) cls = 'book';
      else if (loss < 1) cls = 'best';
      else if (loss < 2) cls = 'excellent';
      else if (loss < 5) cls = 'good';
      else if (loss < 10) cls = 'inaccuracy';
      else if (loss < 20) cls = 'mistake';
      else cls = 'blunder';
      var chance = prevLoss >= 10 && i > game.bookUntil;
      if ((chance && loss >= 5 && loss < 20) || (hadMate && !keepsMate && loss < 20 && cls !== 'best')) cls = 'miss';
      if (cls === 'best' || cls === 'excellent') {
        if (isSacrifice(game.fens[i], mv.uci) && after >= 45 && before < 97 && !(evB.mate != null)) cls = 'brilliant';
        else if (isBest && second != null && before - second >= 15 && after >= 35 && before < 97) cls = 'great';
      }
      var spent = null;
      if (clocks.length === game.moves.length) {
        var prev = i >= 2 ? clocks[i - 2] : game.baseTime;
        if (prev != null) spent = Math.max(0, prev - clocks[i] + (game.increment || 0));
      }
      out.push({
        i: i, side: side, san: mv.san, uci: mv.uci, piece: mv.piece, captured: mv.captured,
        before: before, after: after, loss: loss, acc: cls === 'book' ? 100 : moveAccuracy(loss), cls: cls,
        best: an.best[i] || '', evBefore: evB, evAfter: evA, missedMate: hadMate && !keepsMate,
        chance: chance, phase: phaseOf(game.fens[i], i), clock: clocks[i] != null ? clocks[i] : null, spent: spent,
        pv: an.pv && an.pv[i] ? an.pv[i].split(' ') : null
      });
    }
    // tactic labels on both sides
    for (var j = 0; j < out.length; j++) {
      var m = out[j], s2 = m.side === 'w' ? 1 : -1;
      if (m.loss >= 10 && m.best) {
        var mm = m.evBefore.mate != null && m.evBefore.mate * s2 > 0 && m.evBefore.mate * s2 <= 4;
        var t = tacticOf(game.fens[j], m.best, mm);
        if (t && t !== 'positional') m.missedTactic = t;
      }
      if ((m.cls === 'mistake' || m.cls === 'blunder' || m.cls === 'miss') && an.best[j + 1]) {
        var om = m.evAfter.mate != null && -m.evAfter.mate * s2 > 0 && -m.evAfter.mate * s2 <= 4;
        var t2 = tacticOf(game.fens[j + 1], an.best[j + 1], om);
        if (t2 && t2 !== 'positional') m.allowedTactic = t2;
        var rr = applyUci(game.fens[j + 1], an.best[j + 1]);
        if (rr && rr.move.captured && attackers(board(rr.fen), rr.move.to, m.side).length === 0 && (rr.move.captured !== 'p' || !m.allowedTactic)) m.hungPiece = rr.move.captured;
      }
      if (m.chance) {
        m.converted = m.loss < 5;
        if (m.converted) { var t3 = tacticOf(game.fens[j], m.uci, false); if (t3 && t3 !== 'positional') m.foundTactic = t3; }
      }
    }
    return out;
  }

  function accuracyOf(list) {
    if (!list.length) return null;
    var ar = 0, hr = 0;
    list.forEach(function (a) { ar += a; hr += 1 / Math.max(a, 10); });
    return (ar / list.length + list.length / hr) / 2;
  }
  function gameSummary(game, rv) {
    var s = { counts: { w: {}, b: {} } }, acc = { w: [], b: [] };
    CLASS.forEach(function (c) { s.counts.w[c] = 0; s.counts.b[c] = 0; });
    rv.forEach(function (m) { acc[m.side].push(m.acc); s.counts[m.side][m.cls]++; });
    s.accW = accuracyOf(acc.w); s.accB = accuracyOf(acc.b);
    s.userAcc = game.userColor === 'w' ? s.accW : game.userColor === 'b' ? s.accB : null;
    s.oppAcc = game.userColor === 'w' ? s.accB : game.userColor === 'b' ? s.accW : null;
    return s;
  }

  /* ---------- aggregate ---------- */
  function aggregate(entries) {
    var A = {
      games: 0, analyzed: 0, results: { win: 0, draw: 0, loss: 0 },
      byColor: { w: { win: 0, draw: 0, loss: 0, acc: [], n: 0 }, b: { win: 0, draw: 0, loss: 0, acc: [], n: 0 } },
      byClass: {}, pieces: {}, phases: {}, tactics: { missed: {}, allowed: {}, found: {} },
      hung: {}, chances: 0, converted: 0, openings: {}, accSeries: [], ratings: {},
      time: { lowClockMoves: 0, lowClockErrors: 0, normMoves: 0, normErrors: 0, spentByCls: {} },
      cls: {}, missedMates: 0, worst: [], terminations: {}, costs: {}, lossTotal: 0, brilliants: 0, decisive: 0
    };
    'pnbrqk'.split('').forEach(function (p) { A.pieces[p] = { n: 0, acc: 0, best: 0, inacc: 0, mist: 0, blun: 0 }; });
    ['opening', 'middlegame', 'endgame'].forEach(function (p) { A.phases[p] = { n: 0, acc: 0, err: 0, blun: 0 }; });
    CLASS.forEach(function (c) { A.cls[c] = 0; A.time.spentByCls[c] = { n: 0, t: 0 }; });
    entries.forEach(function (e) {
      var g = e.game, uc = g.userColor;
      if (!uc) return;
      A.games++;
      if (g.outcome) { A.results[g.outcome]++; A.byColor[uc][g.outcome]++; if (g.outcome !== 'draw') A.decisive++; }
      A.byColor[uc].n++;
      var tcl = g.timeClass;
      if (!A.byClass[tcl]) A.byClass[tcl] = { win: 0, draw: 0, loss: 0, n: 0 };
      A.byClass[tcl].n++; if (g.outcome) A.byClass[tcl][g.outcome]++;
      var elo = uc === 'w' ? g.whiteElo : g.blackElo;
      if (elo) (A.ratings[tcl] = A.ratings[tcl] || []).push({ ts: g.ts, elo: elo });
      var okey = uc + '|' + g.openingFamily;
      if (!A.openings[okey]) A.openings[okey] = { name: g.openingFamily, color: uc, n: 0, win: 0, draw: 0, loss: 0, acc: [], openAcc: [] };
      var O = A.openings[okey]; O.n++; if (g.outcome) O[g.outcome]++;
      if (!e.rv) return;
      A.analyzed++;
      var sum = gameSummary(g, e.rv);
      if (sum.userAcc != null) { A.byColor[uc].acc.push(sum.userAcc); O.acc.push(sum.userAcc); A.accSeries.push({ ts: g.ts, acc: sum.userAcc, opp: sum.oppAcc, id: g.id }); }
      var oa = [];
      e.rv.forEach(function (m) {
        if (m.side !== uc) return;
        A.cls[m.cls]++;
        if (m.cls === 'book') return;
        var P = A.pieces[m.piece];
        P.n++; P.acc += m.acc;
        if (m.cls === 'best' || m.cls === 'great' || m.cls === 'brilliant') P.best++;
        if (m.cls === 'inaccuracy') P.inacc++;
        if (m.cls === 'mistake' || m.cls === 'miss') P.mist++;
        if (m.cls === 'blunder') P.blun++;
        var Ph = A.phases[m.phase]; Ph.n++; Ph.acc += m.acc;
        var err = m.cls === 'mistake' || m.cls === 'blunder' || m.cls === 'miss';
        if (err) Ph.err++;
        if (m.cls === 'blunder') Ph.blun++;
        if (m.phase === 'opening') oa.push(m.acc);
        if (m.missedTactic) A.tactics.missed[m.missedTactic] = (A.tactics.missed[m.missedTactic] || 0) + 1;
        if (m.allowedTactic) A.tactics.allowed[m.allowedTactic] = (A.tactics.allowed[m.allowedTactic] || 0) + 1;
        if (m.foundTactic) A.tactics.found[m.foundTactic] = (A.tactics.found[m.foundTactic] || 0) + 1;
        if (m.hungPiece) A.hung[m.hungPiece] = (A.hung[m.hungPiece] || 0) + 1;
        if (m.chance) { A.chances++; if (m.converted) A.converted++; }
        if (m.missedMate) A.missedMates++;
        if (m.clock != null && g.timeClass !== 'daily') {
          if (m.clock < 30) { A.time.lowClockMoves++; if (err) A.time.lowClockErrors++; }
          else { A.time.normMoves++; if (err) A.time.normErrors++; }
        }
        if (m.spent != null && g.timeClass !== 'daily') { A.time.spentByCls[m.cls].n++; A.time.spentByCls[m.cls].t += m.spent; }
        if (m.cls === 'brilliant' || m.cls === 'great') A.brilliants++;
        if (m.loss >= 10) {
          var ck = m.hungPiece ? 'hang:' + m.hungPiece : m.allowedTactic ? 'allow:' + m.allowedTactic : m.missedMate ? 'mate' : m.missedTactic ? 'miss:' + m.missedTactic
            : (m.clock != null && m.clock < 30 && g.timeClass !== 'daily') ? 'clock' : 'phase:' + m.phase;
          var C = A.costs[ck] || (A.costs[ck] = { loss: 0, n: 0, games: {}, ex: null });
          C.loss += m.loss; C.n++; C.games[g.id] = 1; A.lossTotal += m.loss;
          if (!C.ex || m.loss > C.ex.loss) C.ex = { id: g.id, i: m.i, san: m.san, loss: m.loss };
        }
        if (m.cls === 'blunder') A.worst.push({ id: g.id, i: m.i, loss: m.loss, san: m.san, ts: g.ts });
      });
      if (oa.length) O.openAcc.push(oa.reduce(function (a, b) { return a + b; }, 0) / oa.length);
    });
    A.worst.sort(function (a, b) { return b.loss - a.loss; });
    A.worst = A.worst.slice(0, 10);
    A.accSeries.sort(function (a, b) { return a.ts - b.ts; });
    for (var k in A.ratings) A.ratings[k].sort(function (a, b) { return a.ts - b.ts; });
    return A;
  }

  /* ---------- puzzles from the user's own errors ---------- */
  function puzzlesFrom(game, rv) {
    var out = [], uc = game.userColor;
    if (!uc) return out;
    rv.forEach(function (m) {
      if (m.side !== uc || !(m.cls === 'blunder' || m.cls === 'mistake' || m.cls === 'miss')) return;
      if (!m.best || m.before < 30) return; // skip lost positions
      var sol = m.pv && m.pv.length ? m.pv.slice(0, 5) : [m.best];
      if (sol.length % 2 === 0) sol = sol.slice(0, sol.length - 1);
      out.push({ id: game.id + ':' + m.i, gameId: game.id, ply: m.i, fen: m.fen || game.fens[m.i], solution: sol, played: m.uci, cls: m.cls, theme: m.missedTactic || null, loss: m.loss, ts: game.ts });
    });
    return out;
  }

  return {
    START: START, setBook: setBook, parseMeta: parseMeta, compactReview: compactReview, epdKey: epdKey, splitPGN: splitPGN, parseHeaders: parseHeaders, parseGame: parseGame,
    analyzeGame: analyzeGame, review: review, gameSummary: gameSummary, aggregate: aggregate, puzzlesFrom: puzzlesFrom,
    winPct: winPct, evalText: evalText, packEv: packEv, unpackEv: unpackEv, tacticOf: tacticOf, board: board,
    sanOf: sanOf, pvSan: pvSan, applyUci: applyUci,
    TACTIC_NAME: TACTIC_NAME, PIECE_NAME: PIECE_NAME, VAL: VAL, CLASS: CLASS, CLASS_NAME: CLASS_NAME, CLASS_SYM: CLASS_SYM
  };
})();
if (typeof module !== 'undefined') module.exports = Core;

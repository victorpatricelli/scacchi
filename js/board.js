// Lightweight chessboard: SVG pieces, animated moves, arrows, tap and drag to move.
const FILES = 'abcdefgh';
const PIECE_URL = (code) => new URL('../img/pieces/' + code + '.svg', import.meta.url).href;
const MARK_SYM = { brilliant: '!!', great: '!', best: '★', excellent: '✓', good: '✓', book: 'T', inaccuracy: '?!', mistake: '?', miss: '×', blunder: '??' };

function parseFen(fen) {
  const m = {}, rows = fen.split(' ')[0].split('/');
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const c of rows[r]) {
      if (/\d/.test(c)) f += +c;
      else { m[FILES[f] + (8 - r)] = (c === c.toUpperCase() ? 'w' : 'b') + c.toUpperCase(); f++; }
    }
  }
  return m;
}

export class Board {
  constructor(el, opts = {}) {
    this.el = el; this.orientation = opts.orientation || 'w';
    this.onMove = opts.onMove || null; this.dests = null; this.sel = null; this.pieces = {};
    this.coords = opts.coords !== false;
    el.classList.add('board');
    el.innerHTML = '<div class="bd-sq"></div><div class="bd-pcs"></div><svg class="bd-svg" viewBox="0 0 100 100" aria-hidden="true"></svg><div class="bd-marks"></div>';
    this.sqLayer = el.querySelector('.bd-sq'); this.pcLayer = el.querySelector('.bd-pcs');
    this.svg = el.querySelector('.bd-svg'); this.markLayer = el.querySelector('.bd-marks');
    this.drawSquares();
    this.bindPointer();
    this.state = { fen: null, lastMove: null, arrows: [], mark: null, check: null };
  }
  xy(sq) {
    const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1;
    return this.orientation === 'w' ? [f, 7 - r] : [7 - f, r];
  }
  sqAt(x, y) {
    const f = this.orientation === 'w' ? x : 7 - x, r = this.orientation === 'w' ? 7 - y : y;
    if (f < 0 || f > 7 || r < 0 || r > 7) return null;
    return FILES[f] + (r + 1);
  }
  drawSquares() {
    let h = '';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const sq = this.sqAt(x, y), light = (x + y) % 2 === 0;
      let c = '';
      if (this.coords && x === 0) c += '<span class="co co-r">' + sq[1] + '</span>';
      if (this.coords && y === 7) c += '<span class="co co-f">' + sq[0] + '</span>';
      h += '<div class="s ' + (light ? 'l' : 'd') + '" data-sq="' + sq + '">' + c + '</div>';
    }
    this.sqLayer.innerHTML = h;
    this.sqEls = {};
    this.sqLayer.querySelectorAll('.s').forEach((e) => { this.sqEls[e.dataset.sq] = e; });
  }
  setOrientation(o) {
    if (o === this.orientation) return;
    this.orientation = o; this.drawSquares();
    const st = this.state; this.state = { fen: null };
    this.pcLayer.innerHTML = ''; this.pieces = {};
    this.set(st.fen, { lastMove: st.lastMove, arrows: st.arrows, mark: st.mark, check: st.check, animate: false });
  }
  place(el, sq) { const [x, y] = this.xy(sq); el.style.transform = 'translate(' + x * 100 + '%,' + y * 100 + '%)'; }
  set(fen, o = {}) {
    if (!fen) return;
    const animate = o.animate !== false && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = parseFen(fen), old = this.pieces, keep = {}, fresh = [];
    const leftovers = {};
    for (const sq in old) {
      if (next[sq] === old[sq].dataset.p) keep[sq] = old[sq];
      else (leftovers[old[sq].dataset.p] = leftovers[old[sq].dataset.p] || []).push([sq, old[sq]]);
    }
    for (const sq in next) if (!keep[sq]) fresh.push(sq);
    const pieces = Object.assign({}, keep);
    fresh.forEach((sq) => {
      const code = next[sq], pool = leftovers[code];
      let el = null;
      if (pool && pool.length) {
        const [tx, ty] = this.xy(sq);
        pool.sort((a, b) => { const [ax, ay] = this.xy(a[0]), [bx, by] = this.xy(b[0]); return (Math.abs(ax - tx) + Math.abs(ay - ty)) - (Math.abs(bx - tx) + Math.abs(by - ty)); });
        el = pool.shift()[1];
        el.classList.toggle('anim', animate);
      } else {
        el = document.createElement('div');
        el.className = 'pc'; el.dataset.p = code;
        el.style.backgroundImage = 'url("' + PIECE_URL(code) + '")';
        this.pcLayer.appendChild(el);
        if (animate && this.state.fen) { el.classList.add('pop'); requestAnimationFrame(() => el.classList.remove('pop')); }
      }
      this.place(el, sq);
      pieces[sq] = el;
    });
    for (const code in leftovers) leftovers[code].forEach(([, el]) => {
      if (animate) { el.classList.add('gone'); setTimeout(() => el.remove(), 180); } else el.remove();
    });
    for (const sq in pieces) pieces[sq].dataset.sq = sq;
    this.pieces = pieces;
    this.state = { fen, lastMove: o.lastMove || null, arrows: o.arrows || [], mark: o.mark || null, check: o.check || null };
    this.sel = null;
    this.paint();
  }
  paint() {
    const st = this.state;
    for (const sq in this.sqEls) this.sqEls[sq].classList.remove('last', 'sel', 'dest', 'cap', 'chk');
    if (st.lastMove) st.lastMove.forEach((s) => this.sqEls[s] && this.sqEls[s].classList.add('last'));
    if (st.check && this.sqEls[st.check]) this.sqEls[st.check].classList.add('chk');
    if (this.sel) {
      this.sqEls[this.sel].classList.add('sel');
      (this.dests && this.dests[this.sel] || []).forEach((d) => this.sqEls[d].classList.add(this.pieces[d] ? 'cap' : 'dest'));
    }
    // arrows
    let s = '<defs>';
    const cols = {};
    (st.arrows || []).forEach((a) => { cols[a.color] = 1; });
    Object.keys(cols).forEach((c, i) => { s += '<marker id="ah' + i + '" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="' + c + '"/></marker>'; cols[c] = i; });
    s += '</defs>';
    (st.arrows || []).forEach((a) => {
      const [x1, y1] = this.xy(a.from), [x2, y2] = this.xy(a.to);
      const cx1 = x1 * 12.5 + 6.25, cy1 = y1 * 12.5 + 6.25, cx2 = x2 * 12.5 + 6.25, cy2 = y2 * 12.5 + 6.25;
      const dx = cx2 - cx1, dy = cy2 - cy1, L = Math.hypot(dx, dy) || 1;
      const ex = cx2 - dx / L * 4.4, ey = cy2 - dy / L * 4.4;
      s += '<line x1="' + cx1 + '" y1="' + cy1 + '" x2="' + ex + '" y2="' + ey + '" stroke="' + a.color + '" stroke-width="' + (a.width || 2.3) + '" stroke-linecap="round" opacity="' + (a.opacity || 0.85) + '" marker-end="url(#ah' + cols[a.color] + ')"/>';
    });
    this.svg.innerHTML = s;
    // classification badge
    this.markLayer.innerHTML = '';
    if (st.mark && st.mark.sq) {
      const [x, y] = this.xy(st.mark.sq), m = document.createElement('div');
      m.className = 'mk c-' + st.mark.cls;
      m.style.left = ((x + 1) * 12.5) + '%'; m.style.top = (y * 12.5) + '%';
      m.textContent = MARK_SYM[st.mark.cls] || '';
      this.markLayer.appendChild(m);
    }
  }
  setMovable(dests) { this.dests = dests; this.sel = null; this.el.classList.toggle('movable', !!dests); this.paint(); }
  flash(sq, kind) {
    const e = this.sqEls[sq]; if (!e) return;
    e.classList.remove('ok', 'ko'); void e.offsetWidth; e.classList.add(kind);
    setTimeout(() => e.classList.remove(kind), 900);
  }
  bindPointer() {
    let drag = null;
    const pos = (ev) => {
      const r = this.el.getBoundingClientRect();
      return { x: Math.floor((ev.clientX - r.left) / r.width * 8), y: Math.floor((ev.clientY - r.top) / r.height * 8), r, ev };
    };
    const tryMove = (from, to) => {
      if (from && to && from !== to && this.dests && (this.dests[from] || []).includes(to)) {
        this.sel = null; this.paint();
        if (this.onMove) this.onMove(from, to);
        return true;
      }
      return false;
    };
    this.el.addEventListener('pointerdown', (ev) => {
      if (!this.dests) return;
      const p = pos(ev), sq = this.sqAt(p.x, p.y);
      if (!sq) return;
      if (this.sel && tryMove(this.sel, sq)) return;
      if (this.dests[sq] && this.dests[sq].length) {
        this.sel = sq; this.paint();
        const el = this.pieces[sq];
        if (el) {
          drag = { from: sq, el, sx: ev.clientX, sy: ev.clientY, moved: false, r: p.r };
          this.el.setPointerCapture(ev.pointerId);
        }
        ev.preventDefault();
      } else { this.sel = null; this.paint(); }
    });
    this.el.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      const w = drag.r.width / 8, x = ev.clientX - drag.r.left - w / 2, y = ev.clientY - drag.r.top - w / 2;
      drag.el.classList.add('drag'); drag.el.classList.remove('anim');
      drag.el.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(1.12)';
    });
    const end = (ev) => {
      if (!drag) return;
      const d = drag; drag = null;
      d.el.classList.remove('drag');
      if (!d.moved) return;
      const p = pos(ev), to = this.sqAt(p.x, p.y);
      this.place(d.el, d.from);
      tryMove(d.from, to);
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }
}

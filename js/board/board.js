// Board component. Renders a Pos; never mutates it. Moves are reported via onMove and the
// caller decides what happens (training modes validate before applying).
import { Pos, BL, sqName, sqIdx, mFrom, mTo, mPromo, PCH } from '../chess/core.js';

const PIECE_SRC = 'assets/pieces/maestro/';
const FILES = 'abcdefgh';
const code = p => (p & BL ? 'b' : 'w') + PCH[p & 7].toUpperCase();

export class Board {
  constructor(host, opts = {}) {
    this.host = host; this.o = Object.assign({ orientation: 'w', movable: null, coords: true, animate: true, onMove: null, onSquare: null, label: 'Chess board' }, opts);
    this.pos = new Pos(); this.last = null; this.sel = -1; this.arrowsList = []; this.marks = {}; this.hidden = false; this.cursor = -1;
    host.innerHTML = `<div class="cb" tabindex="0" role="application" aria-label="${this.o.label}" aria-roledescription="chess board">
      <div class="cb-squares"></div><div class="cb-pieces"></div><svg class="cb-arrows" viewBox="0 0 8 8" aria-hidden="true"></svg><div class="cb-promo" hidden></div><div class="cb-live" aria-live="polite"></div></div>`;
    this.el = host.querySelector('.cb'); this.sqEl = this.el.querySelector('.cb-squares'); this.pcEl = this.el.querySelector('.cb-pieces');
    this.svg = this.el.querySelector('.cb-arrows'); this.promoEl = this.el.querySelector('.cb-promo'); this.live = this.el.querySelector('.cb-live');
    this.pieceEls = [];
    this.buildSquares();
    this.el.addEventListener('pointerdown', e => this.down(e));
    this.el.addEventListener('keydown', e => this.key(e));
    this.el.addEventListener('contextmenu', e => e.preventDefault());
    this.render(false);
  }
  destroy() { this.host.innerHTML = ''; }

  // ---- public API ----
  setPosition(pos, { last = null, animate = true } = {}) {
    this.pos = typeof pos === 'string' ? new Pos(pos) : pos; this.last = last; this.sel = -1; this.closePromo();
    this.render(animate && this.o.animate);
  }
  setOrientation(c) { if (c === this.o.orientation) return; this.o.orientation = c; this.buildSquares(); this.render(false); }
  setMovable(c) { this.o.movable = c; this.sel = -1; this.paint(); }
  setArrows(list) { this.arrowsList = list || []; this.drawArrows(); }
  setMarks(m) { this.marks = m || {}; this.paint(); }
  hidePieces(h) { this.hidden = !!h; this.el.classList.toggle('blind', this.hidden); }
  announce(t) { this.live.textContent = t; }

  // ---- geometry ----
  order() { const out = []; for (let r = 7; r >= 0; r--) for (let f = 0; f < 8; f++) out.push(r * 16 + f); return this.o.orientation === 'w' ? out : out.reverse(); }
  xy(s) { let f = s & 7, r = s >> 4; if (this.o.orientation === 'b') { f = 7 - f; r = 7 - r; } return [f, 7 - r]; }
  sqAt(x, y) { const b = this.el.getBoundingClientRect(); if (x < b.left || y < b.top || x >= b.right || y >= b.bottom) return -1; return this.order()[Math.floor((y - b.top) / b.height * 8) * 8 + Math.floor((x - b.left) / b.width * 8)]; }

  buildSquares() {
    let h = '';
    this.order().forEach((s, i) => {
      const f = s & 7, r = s >> 4, light = (f + r) % 2 === 1;
      let co = '';
      if (this.o.coords) { if (i % 8 === 0) co += `<span class="co rk">${r + 1}</span>`; if (i >= 56) co += `<span class="co fl">${FILES[f]}</span>`; }
      h += `<div class="sq ${light ? 'l' : 'd'}" data-sq="${s}" aria-label="${sqName(s)}">${co}</div>`;
    });
    this.sqEl.innerHTML = h; this.sqNodes = new Map([...this.sqEl.children].map(n => [+n.dataset.sq, n]));
  }

  render(animate) {
    // pieces: reuse elements with the same piece code (nearest first) so moves glide
    const want = []; const b = this.pos.b;
    for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } if (b[s]) want.push({ s, c: code(b[s]) }); }
    const old = this.pieceEls.slice(); const next = [];
    const take = (pred) => { const i = old.findIndex(pred); return i < 0 ? null : old.splice(i, 1)[0]; };
    const pending = [];
    for (const w of want) { const e = take(o => o.c === w.c && o.s === w.s); if (e) next.push(e); else pending.push(w); }
    for (const w of pending) {
      let best = -1, bd = 99; old.forEach((o, i) => { if (o.c !== w.c) return; const d = Math.abs((o.s & 7) - (w.s & 7)) + Math.abs((o.s >> 4) - (w.s >> 4)); if (d < bd) { bd = d; best = i; } });
      let e; if (best >= 0 && animate) { e = old.splice(best, 1)[0]; e.s = w.s; }
      else { const img = document.createElement('img'); img.className = 'pc'; img.draggable = false; img.alt = ''; img.src = PIECE_SRC + w.c + '.svg'; e = { c: w.c, s: w.s, el: img, fresh: true }; this.pcEl.appendChild(img); }
      next.push(e);
    }
    for (const o of old) o.el.remove();
    this.pcEl.classList.toggle('instant', !animate);
    for (const e of next) { const [x, y] = this.xy(e.s); e.el.style.transform = `translate(${x * 100}%, ${y * 100}%)`; e.el.dataset.sq = e.s; if (e.fresh) { e.fresh = false; if (animate) { e.el.style.opacity = '0'; requestAnimationFrame(() => { e.el.style.opacity = ''; }); } } }
    this.pieceEls = next;
    this.paint(); this.drawArrows();
  }

  paint() {
    const legal = this.sel >= 0 ? this.pos.legal().filter(m => mFrom(m) === this.sel) : [];
    const tg = new Set(legal.map(mTo));
    const chk = this.pos.inCheck() ? (this.pos.turn ? this.pos.kb : this.pos.kw) : -1;
    for (const [s, n] of this.sqNodes) {
      const cl = n.classList;
      cl.toggle('last', !!this.last && (this.last[0] === s || this.last[1] === s));
      cl.toggle('sel', s === this.sel); cl.toggle('tgt', tg.has(s)); cl.toggle('cap', tg.has(s) && !!this.pos.b[s]);
      cl.toggle('chk', s === chk && !this.hidden); cl.toggle('cur', s === this.cursor);
      const mk = this.marks[sqName(s)]; n.dataset.mark = mk || '';
    }
  }

  drawArrows() {
    const col = { you: 'var(--arrow-you)', model: 'var(--arrow-model)', engine: 'var(--arrow-engine)', hint: 'var(--accent)' };
    this.svg.innerHTML = this.arrowsList.map(a => {
      const from = typeof a.from === 'string' ? sqIdx(a.from) : a.from, to = typeof a.to === 'string' ? sqIdx(a.to) : a.to;
      const [x1, y1] = this.xy(from).map(v => v + .5), [x2, y2] = this.xy(to).map(v => v + .5);
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      const ex = x2 - ux * .28, ey = y2 - uy * .28; const w = a.kind === 'engine' ? .1 : .13;
      const c = col[a.kind] || col.hint; const dash = a.kind === 'engine' ? ' stroke-dasharray=".22 .14"' : '';
      const hx = x2 - ux * .02, hy = y2 - uy * .02, bx = x2 - ux * .36, by = y2 - uy * .36, px = -uy * .2, py = ux * .2;
      return `<g opacity="${a.kind === 'you' ? .95 : .9}"><line x1="${x1 + ux * .18}" y1="${y1 + uy * .18}" x2="${ex}" y2="${ey}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"${dash}/><path d="M${hx},${hy} L${bx + px},${by + py} L${bx - px},${by - py} Z" fill="${c}"/></g>`;
    }).join('');
  }

  // ---- interaction ----
  mine(s) { const p = this.pos.b[s]; const side = this.pos.turn ? 'b' : 'w'; return p && this.o.movable && (this.o.movable === 'both' || this.o.movable === side) && ((p & BL) ? 'b' : 'w') === side; }
  click(s) {
    if (this.o.onSquare) { this.o.onSquare(sqName(s), s); return; }
    if (!this.o.movable) return;
    if (this.sel >= 0 && s !== this.sel && !this.mine(s)) { if (!this.tryMove(this.sel, s)) { this.sel = -1; this.paint(); } return; }
    if (this.mine(s)) { this.sel = this.sel === s ? -1 : s; this.paint(); } else if (this.sel >= 0) { this.sel = -1; this.paint(); }
  }
  tryMove(from, to) {
    const ms = this.pos.legal().filter(m => mFrom(m) === from && mTo(m) === to); if (!ms.length) return false;
    if (ms.length > 1) { this.openPromo(ms, to); return true; }
    this.emit(ms[0]); return true;
  }
  emit(m) { this.sel = -1; const san = this.pos.san(m); this.paint(); this.o.onMove && this.o.onMove({ m, san, uci: this.pos.uci(m), from: sqName(mFrom(m)), to: sqName(mTo(m)) }); }
  openPromo(ms, to) {
    const white = this.pos.turn === 0; const [x] = this.xy(to);
    const order = [5, 4, 3, 2]; // Q R B N
    this.promoEl.innerHTML = order.map((pr, i) => { const m = ms.find(mm => mPromo(mm) === pr); return `<button type="button" data-i="${i}" style="left:${x * 12.5}%;top:${(this.xy(to)[1] === 0 ? i : 7 - i) * 12.5}%" aria-label="Promote to ${['', '', 'knight', 'bishop', 'rook', 'queen'][pr]}"><img src="${PIECE_SRC}${white ? 'w' : 'b'}${PCH[pr].toUpperCase()}.svg" alt=""></button>`; }).join('');
    this.promoEl.hidden = false; const opened = performance.now();
    // the click that completes the tap/click which opened the chooser must not pick a piece
    this.promoEl.onclick = e => { if (performance.now() - opened < 400 && e.detail !== 0) return; const b = e.target.closest('button'); if (!b) { this.closePromo(); return; } const pr = order[+b.dataset.i]; const m = ms.find(mm => mPromo(mm) === pr); this.closePromo(); this.emit(m); };
    const bt = this.promoEl.querySelector('button'); bt && bt.focus();
  }
  closePromo() { this.promoEl.hidden = true; this.promoEl.innerHTML = ''; }
  down(e) {
    if (e.button && e.button !== 0) return; if (!this.promoEl.hidden) return;
    const s = this.sqAt(e.clientX, e.clientY); if (s < 0) return;
    if (this.o.onSquare || !this.mine(s) || this.hidden) { this.click(s); return; }
    e.preventDefault();
    const pe = this.pieceEls.find(p => p.s === s); const wasSel = this.sel === s; this.sel = s; this.paint();
    const x0 = e.clientX, y0 = e.clientY; let moved = false; const rect = this.el.getBoundingClientRect(); const size = rect.width / 8;
    const mv = ev => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) { moved = true; pe && pe.el.classList.add('drag'); }
      if (moved && pe) { const r2 = this.el.getBoundingClientRect(); pe.el.style.transform = `translate(${ev.clientX - r2.left - size / 2}px, ${ev.clientY - r2.top - size / 2}px)`; }
    };
    const up = ev => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (pe) pe.el.classList.remove('drag');
      const t = this.sqAt(ev.clientX, ev.clientY);
      if (moved) { if (!(t >= 0 && t !== s && this.tryMove(s, t))) { this.render(false); } return; }
      if (wasSel) { this.sel = -1; this.paint(); }
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }
  key(e) {
    const k = e.key; if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape'].includes(k)) return;
    e.preventDefault();
    if (k === 'Escape') { this.sel = -1; this.cursor = -1; this.paint(); return; }
    const ord = this.order(); let i = this.cursor < 0 ? ord.indexOf(this.sel >= 0 ? this.sel : ord[52]) : ord.indexOf(this.cursor);
    if (k === 'ArrowLeft') i = i % 8 ? i - 1 : i; if (k === 'ArrowRight') i = i % 8 < 7 ? i + 1 : i;
    if (k === 'ArrowUp') i = i >= 8 ? i - 8 : i; if (k === 'ArrowDown') i = i < 56 ? i + 8 : i;
    this.cursor = ord[i];
    if (k === 'Enter' || k === ' ') this.click(this.cursor);
    this.paint(); const p = this.pos.b[this.cursor]; this.announce(sqName(this.cursor) + (p && !this.hidden ? ' ' + (p & BL ? 'black ' : 'white ') + ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'][p & 7] : ''));
  }
}

// Static, non-interactive thumbnail (HTML string). Cheap enough for dozens on one page.
export function miniBoard(fen, orientation = 'w', { arrow = null, size = '' } = {}) {
  const p = new Pos(fen); let sq = '', pcs = '';
  const ord = []; for (let r = 7; r >= 0; r--) for (let f = 0; f < 8; f++) ord.push(r * 16 + f);
  if (orientation === 'b') ord.reverse();
  ord.forEach((s, i) => {
    const light = ((s & 7) + (s >> 4)) % 2 === 1; const x = i % 8, y = Math.floor(i / 8);
    const hl = arrow && (arrow.from === s || arrow.to === s);
    sq += `<i class="${light ? 'l' : 'd'}${hl ? ' h' : ''}"></i>`;
    if (p.b[s]) pcs += `<img src="${PIECE_SRC}${code(p.b[s])}.svg" alt="" style="left:${x * 12.5}%;top:${y * 12.5}%">`;
  });
  return `<div class="mini"${size ? ` style="width:${size}"` : ''} role="img" aria-label="Position ${esc2(fen.split(' ')[0])}"><div class="mini-sq">${sq}</div>${pcs}</div>`;
}
const esc2 = s => String(s).replace(/[<>"&]/g, '');

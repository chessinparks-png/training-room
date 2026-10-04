// Small DOM + formatting helpers shared by all views.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const NIL = '<span class="nil">—</span>'; // quiet empty value inside big numbers
export const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
export const plural = (n, w, pl) => `${n} ${n === 1 ? w : (pl || w + 's')}`;
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function toast(msg, ms = 2600) {
  let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, ms);
}
export function fmtClock(sec) {
  sec = Math.max(0, sec); if (sec < 10) return sec.toFixed(1).padStart(4, '0').replace(/^0(\d)\./, '0:0$1.').replace(/^(\d)\./, '0:0$1.');
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${m}:${String(s).padStart(2, '0')}`;
}
export function moveNo(ply) { return Math.floor(ply / 2) + 1; }
// "14.Nf3" / "14…Nf6" for a move at 0-based ply index
export function sanAt(ply, san) { return ply % 2 === 0 ? `${moveNo(ply)}.${san}` : `${moveNo(ply)}…${san}`; }
export function line(moves, startPly = 0, { hl = -1 } = {}) {
  return moves.map((s, i) => { const p = startPly + i; const t = p % 2 === 0 ? `${moveNo(p)}.${esc(s)}` : (i === 0 ? `${moveNo(p)}…${esc(s)}` : esc(s)); return i === hl ? `<b>${t}</b>` : t; }).join(' ');
}
export function plyFromFen(fen) { const p = fen.split(' '); return ((+p[5] || 1) - 1) * 2 + (p[1] === 'b' ? 1 : 0); }
export function date(d) { if (!d) return ''; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }

// Deterministic-ish sampling helpers
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export function weighted(items, w) { const tot = items.reduce((s, x) => s + w(x), 0); let r = Math.random() * tot; for (const x of items) { r -= w(x); if (r <= 0) return x; } return items[items.length - 1]; }

// Keyboard shortcut scope for the active view
let keyHandler = null;
export function onKeys(fn) { keyHandler = fn; }
if (typeof document !== 'undefined') document.addEventListener('keydown', e => {
  if (/input|textarea|select/i.test(e.target.tagName)) return;
  // Enter / Space moves on from any answered training position
  if ((e.key === 'Enter' || e.key === ' ') && !e.defaultPrevented && !e.repeat) { const nx = document.querySelector('#main [data-a="next"]:not(:disabled)'); if (nx && !(e.target.closest && e.target.closest('button, a'))) { e.preventDefault(); nx.click(); return; } }
  if (keyHandler) keyHandler(e);
});

// A tiny timer display bound to an element
export function stopwatch(el) {
  const t0 = performance.now(); let raf = 0; let stopped = false;
  const tick = () => { if (stopped) return; const s = (performance.now() - t0) / 1000; el.textContent = s < 60 ? s.toFixed(1) : fmtClock(s); raf = requestAnimationFrame(tick); };
  tick();
  return { stop() { stopped = true; cancelAnimationFrame(raf); return (performance.now() - t0) / 1000; }, elapsed() { return (performance.now() - t0) / 1000; } };
}

// Edition (noir | ivory): root attribute, remembered for first paint, and the browser/status-bar colour.
export function applyTheme(v) {
  if (typeof document === 'undefined') return;
  if (v === 'ivory') document.documentElement.setAttribute('data-theme', 'ivory'); else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('tr.theme', v === 'ivory' ? 'ivory' : 'noir'); } catch (e) {}
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', v === 'ivory' ? '#f1ede4' : '#0c0c0b');
}

// TECHNIQUE — technical decisions from my own games (data/technique.json, built offline by
// tools/build-technique.mjs): SIMPLIFY (what should come off?), CONVERT and HOLD (play it out
// against the existing opponent). No evaluation is shown while deciding or playing.
import { technique } from '../data/catalog.js';
import { Pos, BL, mFrom, mTo } from '../chess/core.js';
import { stage, makeBoard, arrows, animateLine } from '../training/common.js';
import { playMove, analyseP } from '../analysis/engine.js';
import * as store from '../data/store.js';
import { esc, line } from '../ui.js';

const MODES = {
  simplify: { name: 'Simplify', prompt: 'What should come off?' },
  convert: { name: 'Convert', prompt: 'You’re better. Finish it.' },
  hold: { name: 'Hold', prompt: 'You’re worse. Stay in the game.' },
};
const MIX = [['convert', 0.55], ['simplify', 0.25], ['hold', 0.2]];
const OPP = { elo: 2150, movetime: 450 }; // the Blitz opponent at Match strength
const MAX_MOVES = 30; const KEY = 'technique.stats'; const RUN = 6;

export async function mount(el, params) {
  const D = await technique(); const mode = params[0]; let un = () => {};
  if (mode === 'mix' || MODES[mode]) un = await run(el, D, mode); else home(el, D);
  return () => un();
}

function home(el, D) {
  el.innerHTML = `<div class="tech-home"><div class="stack" style="--s:18px"><div class="kicker">Technique · from your games</div><h1 class="h1">Technique.</h1>
      <p class="lede">Technical decisions from your own 3+2 games: what to exchange, how to finish, how to stay in it.</p>
      <div class="row"><a class="btn primary big" href="#/technique/mix">Begin</a></div></div>
    <div class="group-list">${Object.entries(MODES).map(([k, m]) => `<a class="group-row" href="#/technique/${k}"><span class="t">${m.name}<small class="tech-q">${esc(m.prompt)}</small></span><span class="c muted small">${D[k].length} positions</span><span class="go">→</span></a>`).join('')}</div></div>`;
}

// ---- selection: quiet weighting, no visible scores ----
async function stats() { const s = await store.setting(KEY, null); return s && s.items ? s : { items: {}, tags: {} }; }
function weight(x, mode, S) {
  let w = 1;
  if (mode !== 'simplify') { if (/rook/.test(x.ending)) w *= 1.5; if (x.tags.includes('ROOK_ACTIVITY') || x.tags.includes('COUNTERPLAY')) w *= 1.4; }
  const it = S.items[x.id]; if (it) { if (Date.now() - it.last < 864e5) w *= 0.15; w *= it.lastOk === false ? 2.5 : 1 / (1 + it.ok); }
  for (const t of x.tags) { const g = S.tags[t]; if (g && g.n >= 2) w *= 1 + g.miss / g.n; }
  return w;
}
function draw(pool, w) { const tot = pool.reduce((s, x) => s + w(x), 0); let r = Math.random() * tot; for (const x of pool) { r -= w(x); if (r <= 0) return x; } return pool[pool.length - 1]; }
async function queue(D, mode) {
  const S = await stats(); const out = []; const taken = new Set();
  for (let i = 0; i < RUN; i++) {
    let m = mode; if (mode === 'mix') { let r = Math.random(); m = MIX.find(([, p]) => (r -= p) <= 0)?.[0] || 'convert'; }
    const pool = D[m].filter(x => !taken.has(x.id)); if (!pool.length) continue;
    const x = draw(pool, y => weight(y, m, S)); taken.add(x.id); out.push([m, x]);
  }
  return out;
}
async function record(x, ok, extraTag) {
  const S = await stats(); const it = S.items[x.id] || { n: 0, ok: 0 }; it.n++; if (ok) it.ok++; it.last = Date.now(); it.lastOk = ok; S.items[x.id] = it;
  for (const t of new Set([...x.tags, ...(extraTag ? [extraTag] : [])])) { const g = S.tags[t] || { n: 0, miss: 0 }; g.n++; if (!ok) g.miss++; S.tags[t] = g; }
  await store.setSetting(KEY, S);
}

async function run(el, D, mode) {
  const items = await queue(D, mode); let k = 0; let un = () => {};
  const title = mode === 'mix' ? 'Technique' : `Technique · ${MODES[mode].name}`;
  const frame = () => { el.innerHTML = `<div class="session-bar"><span class="label ink">${esc(title)} · ${Math.min(k + 1, items.length)} / ${items.length}</span><div class="meter"><i style="width:${(k / items.length) * 100}%"></i></div><a class="btn link" href="#/technique">End</a></div><div class="step-host"></div>`; window.scrollTo(0, 0); return el.querySelector('.step-host'); };
  const show = () => { un(); if (k >= items.length) return done(); const [m, x] = items[k]; const again = () => { un(); un = mountOne(frame(), m, x, { again, next }); }; un = mountOne(frame(), m, x, { again, next }); };
  const next = () => { k++; show(); };
  const done = () => { el.innerHTML = `<div class="stack" style="--s:22px;max-width:560px"><div class="kicker">Technique</div><h1 class="h1">Done.</h1><div class="row" style="gap:22px"><a class="btn primary" href="#/technique/${mode}" data-again>Again</a><a class="btn link" href="#/technique">Back</a></div></div>`;
    el.querySelector('[data-again]').onclick = e => { e.preventDefault(); k = 0; queue(D, mode).then(q => { items.splice(0, items.length, ...q); show(); }); }; };
  if (!items.length) { el.innerHTML = '<p class="empty">No positions yet.</p>'; return () => {}; }
  show(); return () => un();
}
const mountOne = (host, m, x, nav) => (m === 'simplify' ? simplify(host, x, nav) : playOut(host, m, x, nav));
const side = c => (c === 'w' ? 'White' : 'Black');
const source = x => (x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">your game vs ${esc(x.opp)}</a>` : 'your game');

// ---- SIMPLIFY ----
function simplify(host, x, { next }) {
  const S = stage(host, { label: 'TECHNIQUE · SIMPLIFY' });
  const board = makeBoard(S.boardHost, x.fen, { orientation: x.color });
  S.context.innerHTML = line(x.prev, x.prevPly);
  S.side.innerHTML = `<p class="prompt">${MODES.simplify.prompt}<small>${side(x.color)} to move.</small></p>
    <div class="options">${x.choices.map((c, i) => `<button type="button" data-c="${c.key}"><span>${esc(c.label)}</span><span class="key">${i + 1}</span></button>`).join('')}</div><div class="fb"></div>`;
  let done = false; let stopAnim = () => {};
  const onKey = e => { const n = +e.key; if (!done && n >= 1 && n <= x.choices.length) answer(x.choices[n - 1].key); };
  document.addEventListener('keydown', onKey);
  S.side.querySelector('.options').onclick = e => { const b = e.target.closest('[data-c]'); if (b) answer(b.dataset.c); };
  function answer(key) {
    if (done) return; done = true; const ok = x.accept.includes(key);
    S.side.querySelectorAll('[data-c]').forEach(b => { b.disabled = true; b.classList.toggle('chosen', b.dataset.c === key); b.classList.toggle('best', x.accept.includes(b.dataset.c)); b.classList.toggle('wrong', b.dataset.c === key && !ok); });
    const fb = S.side.querySelector('.fb');
    fb.innerHTML = `<p class="verdict${ok ? '' : ' bad'}">${ok ? 'Yes.' : 'Not this time.'}</p><p class="why">${esc(x.explain)}</p>
      <p class="footnote">In ${source(x)} you played ${esc(x.game.played)} — ${x.game.right ? 'the right decision.' : 'the other decision.'}</p>
      ${x.gain ? `<div class="gain"><p class="label">What are you trying to gain?</p><div class="choices">${x.gain.options.map(o => `<button data-g="${esc(o)}">${esc(o)}</button>`).join('')}</div><p class="small ink2 gain-fb"></p></div>` : ''}
      <div class="actions"><button class="btn primary" data-a="next">Next</button><span class="kbd">Enter</span><button class="btn link" data-a="line">Show line</button></div>`;
    fb.onclick = e => {
      const g = e.target.closest('[data-g]');
      if (g && !g.disabled) { fb.querySelectorAll('[data-g]').forEach(b => { b.disabled = true; b.setAttribute('aria-pressed', b === g); }); fb.querySelector('.gain-fb').textContent = g.dataset.g === x.gain.answer ? 'Yes.' : `Mainly: ${x.gain.answer.toLowerCase()}.`; }
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'line') { stopAnim(); board.setArrows([]); stopAnim = animateLine(board, x.fen, x.line); }
      if (a.dataset.a === 'next') { stopAnim(); next(); }
    };
    board.setArrows(arrows(x.fen, [[x.line[0], 'model']]));
    record(x, ok);
  }
  return () => { stopAnim(); document.removeEventListener('keydown', onKey); };
}

// ---- CONVERT / HOLD: play it out against the existing opponent ----
const TYPE = p => ' pnbrqk'[p & 7];
function passed(p, s) { const x = p.b[s]; const black = !!(x & BL); const f = s & 7, r = s >> 4;
  for (let t = 0; t < 128; t++) { if (t & 0x88) { t += 7; continue; } const y = p.b[t]; if (!y || TYPE(y) !== 'p' || !!(y & BL) === black) continue; if (Math.abs((t & 7) - f) <= 1 && (black ? (t >> 4) < r : (t >> 4) > r)) return false; } return true; }
function info(fen, uci) { const p = new Pos(fen); const m = uci && p.fromUci(uci); if (!m) return null; const from = mFrom(m), to = mTo(m); const t = TYPE(p.b[from]); const cap = p.b[to] ? TYPE(p.b[to]) : null;
  const pass = t === 'p' && passed(p, from); const white = p.turn === 0; p.make(m); const check = p.inCheck(); const re = cap && p.legal().some(x => mTo(x) === to);
  const even = re && ((t === cap && (t === 'q' || t === 'r')) || ('nb'.includes(t) && 'nb'.includes(cap)));
  return { t, cap, pass, check, even, retreat: t === 'r' && !check && (white ? (to >> 4) < (from >> 4) : (to >> 4) > (from >> 4)), active: t === 'r' && !cap && (check || (white ? (to >> 4) >= 4 : (to >> 4) <= 3)), to }; }
const LESSONS = {
  convert: { EXCHANGE: 'Trading there made the win harder.', SIMPLIFIED: 'The simplification was correct. The problem came afterward.', PASSIVE: 'Your rook became passive.', CHECKS: 'Keep the rook active.', KING: 'Improve the king before pushing.', ACTIVE: 'Keep the rook active.', PASSER: 'Push the passed pawn.', COUNTER: 'You allowed counterplay.' },
  hold: { EXCHANGE: 'Trading here made the defense much harder.', SIMPLIFIED: 'Trading here made the defense much harder.', PASSIVE: 'Keep the rook active.', CHECKS: 'Checks gave you the best practical chances.', KING: 'Your king had to become active.', ACTIVE: 'Keep the rook active.', PASSER: 'Your passed pawn was the counterplay.', COUNTER: 'You removed your counterplay.' },
};
const TAG = { EXCHANGE: 'EXCHANGE_DECISION', SIMPLIFIED: 'EXCHANGE_DECISION', PASSIVE: 'ROOK_ACTIVITY', CHECKS: 'ROOK_ACTIVITY', KING: 'KING_ACTIVITY', ACTIVE: 'ROOK_ACTIVITY', PASSER: 'PASSED_PAWN', COUNTER: 'COUNTERPLAY' };
// The single coaching point for the move that cost the most.
export function lessonFor(mode, w, earlier) {
  const P = info(w.fen, w.uci), B = info(w.fen, w.best), R = w.oppUci ? info(w.after, w.oppUci) : null; const queenless = !/q/i.test(w.fen.split(' ')[0]);
  const key = P && P.even ? 'EXCHANGE' : mode === 'convert' && earlier.some(h => h.even && h.drop < 50) ? 'SIMPLIFIED' : P && P.retreat ? 'PASSIVE'
    : B && B.t === 'r' && B.check ? 'CHECKS' : B && queenless && B.t === 'k' && (!P || P.t !== 'k') ? 'KING' : B && B.active ? 'ACTIVE' : B && B.pass && !B.cap ? 'PASSER'
      : R && (R.check || (R.cap && R.to !== (P && P.to)) || R.pass) ? 'COUNTER' : null;
  return key ? { text: LESSONS[mode][key], tag: TAG[key] } : { text: mode === 'convert' ? `The turning point was ${w.san}.` : `${w.san} made the defense harder.`, tag: null };
}

function playOut(host, mode, x, { again, next }) {
  const S = stage(host, { label: `TECHNIQUE · ${MODES[mode].name.toUpperCase()}` }); const me = x.color; const pos = new Pos(x.fen);
  const board = makeBoard(S.boardHost, x.fen, { orientation: me, movable: me, onMove: mv => mine(mv) });
  S.context.innerHTML = line(x.prev, x.prevPly);
  S.side.innerHTML = `<p class="prompt">${MODES[mode].prompt}<small>You have ${side(me)}. Play it out.</small></p><p class="small muted tech-status" aria-live="polite"></p>
    <div class="actions tech-stop"><button class="btn link" data-a="stop">Finish here</button></div><div class="fb"></div>`;
  const hist = []; let over = false, gone = false;
  const status = t => { const s = S.side.querySelector('.tech-status'); if (s) s.textContent = t; };
  const warm = f => { analyseP(f, { budget: 'fast', priority: 'low' }).catch(() => {}); }; // cached for the review; never shown
  S.side.querySelector('[data-a="stop"]').onclick = () => finish();
  function mine(mv) {
    if (over || pos.side() !== me) return;
    const fen = pos.fen(); pos.make(mv.m); hist.push({ fen, uci: mv.uci, san: mv.san, after: pos.fen() });
    board.setPosition(pos, { last: [mFrom(mv.m), mTo(mv.m)] }); board.setMovable(null); warm(fen);
    if (pos.status() || hist.length >= MAX_MOVES) return finish();
    reply();
  }
  async function reply() {
    status('Opponent to move'); const u = await playMove(pos.fen(), OPP).catch(() => null); if (over || gone) return;
    const m = u && pos.fromUci(u); if (!m) return finish();
    hist[hist.length - 1].oppUci = u; pos.make(m); board.setPosition(pos, { last: [mFrom(m), mTo(m)] }); status('');
    if (pos.status()) return finish(); board.setMovable(me);
  }
  async function finish() {
    if (over) return; over = true; board.setMovable(null); S.side.querySelector('.tech-stop')?.remove(); status('');
    const fb = S.side.querySelector('.fb'); fb.innerHTML = '<p class="label pulse">Looking at your moves…</p>';
    const v = await judge(mode, me, hist, pos).catch(() => ({ head: 'Finished.', text: '', ok: false })); if (gone) return;
    fb.innerHTML = `<p class="verdict${v.ok ? '' : ' bad'}">${esc(v.head)}</p>${v.text ? `<p class="why">${esc(v.text)}</p>` : ''}
      <p class="footnote">In ${source(x)} you played ${esc(x.game.played)}; ${esc(x.game.best)} was stronger.</p>
      <div class="actions"><button class="btn primary" data-a="next">Next position</button><span class="kbd">Enter</span><button class="btn link" data-a="again">Try again</button></div>`;
    fb.onclick = e => { const a = e.target.closest('[data-a]'); if (a && a.dataset.a === 'next') next(); if (a && a.dataset.a === 'again') again(); };
    if (hist.length) record(x, v.ok, v.tag);
  }
  return () => { gone = true; over = true; };
}

// Evaluation is used only here, after the exercise, and never displayed.
async function judge(mode, me, hist, pos) {
  if (!hist.length) return { head: 'Not played.', text: 'Try again when you are ready.', ok: false };
  const CLAMP = x => Math.max(-1500, Math.min(1500, x));
  const evMe = async fen => { const p = new Pos(fen); const st = p.status(); const stm = fen.split(' ')[1];
    if (st) return st.reason === 'checkmate' ? (stm === me ? -1500 : 1500) : 0;
    const r = await analyseP(fen, { budget: 'fast', priority: 'high' }); const s = r && r.lines[0] ? CLAMP(r.lines[0].score) : 0; return { s: stm === me ? s : -s, best: r && r.best }; };
  const val = v => (typeof v === 'number' ? v : v.s);
  const rows = [];
  for (const h of hist) { const b = await evMe(h.fen), a = await evMe(h.after); rows.push({ ...h, drop: val(b) - val(a), best: typeof b === 'number' ? null : b.best, even: (info(h.fen, h.uci) || {}).even }); }
  const st = pos.status(); const final = val(await evMe(pos.fen()));
  const won = st && st.reason === 'checkmate' && pos.fen().split(' ')[1] !== me; const drawn = st && st.result === '1/2-1/2';
  const worst = rows.reduce((a, r) => (r.drop > (a ? a.drop : -Infinity) ? r : a), null);
  const coach = () => lessonFor(mode, worst, rows.slice(0, rows.indexOf(worst)));
  if (mode === 'convert') {
    if (won || (final >= 150 && worst.drop < 100)) return { head: won ? 'Converted.' : 'Still clearly better.', text: won ? 'You converted cleanly.' : 'You kept the advantage under control.', ok: true };
    const c = coach(); return { head: drawn || final < 100 ? 'The advantage slipped.' : 'Still better, but harder.', text: c.text, tag: c.tag, ok: false };
  }
  if (drawn || final >= -80) return { head: 'Held.', text: 'You stayed in the game.', ok: true };
  if (final >= -250 && worst.drop < 150) return { head: 'Still defensible.', text: 'You kept your chances alive.', ok: true };
  const c = coach(); return { head: 'Hard to hold now.', text: c.text, tag: c.tag, ok: false };
}

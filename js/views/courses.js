// REPERTOIRE — three model-player courses (data/courses.json, built offline from blitz games by
// tools/build-repertoire.mjs). Each course: LEARN, TRAIN, REVIEW. Chessable-like, local only.
import { courses } from '../data/catalog.js';
import { Pos, mFrom, mTo } from '../chess/core.js';
import { stage, makeBoard, arrows } from '../training/common.js';
import * as store from '../data/store.js';
import { esc, line } from '../ui.js';

// ---- spaced repetition (pattern of the Canty trainer, with the course intervals) ----
const KEY = 'courses.srs'; const MIN = 6e4, HOUR = 36e5, DAY = 864e5;
const INTERVAL = [4 * HOUR, DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY]; // box 0 = learned today … box 5
export const KNOWN = 3;
async function srs() { return { ...(await store.setting(KEY, {})) }; }
export function schedule(r, ok, now = Date.now()) {
  r = { box: -1, due: 0, seen: 0, ok: 0, ...(r || {}) }; r.seen++;
  if (ok) { r.ok++; r.box = Math.min(INTERVAL.length - 1, r.box + 1); r.due = now + INTERVAL[r.box]; }
  else { r.box = 0; r.due = now + 10 * MIN; } // a miss starts the ladder again, soon
  r.last = now; return r;
}
async function grade(id, ok) { const S = await srs(); S[id] = schedule(S[id], ok); await store.setSetting(KEY, S); return S[id]; }
async function learned(id) { const S = await srs(); if (!S[id]) { S[id] = { box: 0, due: Date.now() + INTERVAL[0], seen: 0, ok: 0, last: Date.now() }; await store.setSetting(KEY, S); } }
const stateOf = r => (!r ? 'new' : r.box >= KNOWN ? 'known' : 'learning');

export async function mount(el, params) {
  const D = await courses(); const [cid, mode] = params; const C = D.courses.find(c => c.id === cid); let un = () => {};
  if (!C) await index(el, D); else if (!mode) await home(el, C); else un = await run(el, C, mode);
  return () => un();
}

async function counts(C) { const S = await srs(); const now = Date.now(); const c = { new: 0, learning: 0, known: 0, due: 0 }; for (const x of C.cards) { c[stateOf(S[x.id])]++; if (S[x.id] && S[x.id].due <= now) c.due++; } return c; }
async function index(el, D) {
  const rows = []; for (const C of D.courses) { const n = await counts(C); rows.push(`<a class="group-row" href="#/courses/${C.id}"><span class="t">${esc(C.title)}<small class="tech-q">${C.color === 'w' ? 'White' : 'Black'} · ${C.cards.length} positions</small></span><span class="c">${n.due ? `<span class="chip accent">${n.due} due</span> ` : ''}<span class="muted small">${n.new} new · ${n.learning} learning · ${n.known} known</span></span><span class="go">→</span></a>`); }
  el.innerHTML = `<div class="tech-home"><div class="stack" style="--s:18px"><div class="kicker">Repertoire</div><h1 class="h1">Three courses.</h1><p class="lede">Built from the players’ own blitz games. Learn the move, train it, review it when it is due.</p></div><div class="group-list">${rows.join('')}</div></div>`;
}
async function home(el, C) {
  const n = await counts(C);
  el.innerHTML = `<div class="tech-home"><div class="stack" style="--s:18px"><div class="kicker">${C.color === 'w' ? 'White' : 'Black'} · ${esc(C.player)}</div><h1 class="h1">${esc(C.title.split('—')[1].trim())}.</h1>
      <p class="lede">${C.cards.length} positions from ${C.games} blitz games.</p>
      <div class="canty-stats"><div><b class="num">${n.new}</b><span class="label">New</span></div><div><b class="num">${n.learning}</b><span class="label">Learning</span></div><div><b class="num">${n.known}</b><span class="label">Known</span></div><div><b class="num">${n.due}</b><span class="label">Due</span></div></div></div>
    <div class="group-list">
      <a class="group-row" href="#/courses/${C.id}/learn"><span class="t">Learn<small class="tech-q">See the repertoire move and play it.</small></span><span class="c muted small">${n.new} new</span><span class="go">→</span></a>
      <a class="group-row" href="#/courses/${C.id}/train"><span class="t">Train<small class="tech-q">What would you play?</small></span><span class="c muted small">${n.learning + n.known ? `${n.learning + n.known} learned` : 'learn first, or test yourself'}</span><span class="go">→</span></a>
      <a class="group-row" href="#/courses/${C.id}/review"><span class="t">Review<small class="tech-q">Positions that are due.</small></span><span class="c">${n.due ? `<span class="chip accent">${n.due} due</span>` : '<span class="muted small">nothing due</span>'}</span><span class="go">→</span></a>
      <p class="footnote"><a href="#/courses">All courses</a></p></div></div>`;
}

async function queue(C, mode) {
  const S = await srs(); const now = Date.now(); const byOrder = (a, b) => a.order - b.order;
  if (mode === 'learn') return C.cards.filter(x => !S[x.id]).sort(byOrder).slice(0, 6);
  if (mode === 'review') return C.cards.filter(x => S[x.id] && S[x.id].due <= now).sort((a, b) => S[a.id].due - S[b.id].due).slice(0, 12);
  const seen = C.cards.filter(x => S[x.id]).sort((a, b) => S[a.id].box - S[b.id].box || byOrder(a, b));
  return (seen.length ? seen : C.cards.slice().sort(byOrder)).slice(0, 10);
}
async function run(el, C, mode) {
  const items = await queue(C, mode); let k = 0; let un = () => {}; const res = [];
  const title = `${C.title.split('—')[1].trim()} · ${mode[0].toUpperCase() + mode.slice(1)}`;
  const frame = () => { el.innerHTML = `<div class="session-bar"><span class="label ink">${esc(title)} · ${k} / ${items.length}</span><div class="meter"><i style="width:${((k - 1) / items.length) * 100}%"></i></div><a class="btn link" href="#/courses/${C.id}">End</a></div><div class="step-host"></div>`; window.scrollTo(0, 0); return el.querySelector('.step-host'); };
  const next = r => { if (r) res.push(r); un(); if (k >= items.length) return done(); const x = items[k++]; un = (mode === 'learn' ? learn : drill)(frame(), C, x, next); };
  const done = async () => { const S = await srs(); const due = C.cards.map(x => S[x.id]).filter(Boolean).map(r => r.due).filter(d => d > Date.now()).sort((a, b) => a - b)[0];
    el.innerHTML = `<div class="stack" style="--s:22px;max-width:560px"><div class="kicker">${esc(title)}</div><h1 class="h1">${items.length ? 'Done.' : mode === 'review' ? 'Nothing due.' : 'Nothing new.'}</h1>
      ${mode !== 'learn' && res.length ? `<p class="lede">${res.filter(r => r.firstTry).length} of ${res.length} first try.</p>` : ''}${due ? `<p class="footnote">Next review ${new Date(due).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.</p>` : ''}
      <div class="row" style="gap:22px"><a class="btn primary" href="#/courses/${C.id}">Back to the course</a></div></div>`; };
  next(); return () => un();
}

// Shows the position before the opponent's move, then plays it.
function enter(board, x) {
  if (!x.oppMove) return; const p = new Pos(); const ln = x.line.slice(0, -1); if (!ln.every(s => p.play(s))) return; const m = p.parseSan(x.oppMove); if (!m) return;
  board.setPosition(new Pos(p.fen()), { animate: false }); setTimeout(() => board.setPosition(new Pos(x.fen), { last: [mFrom(m), mTo(m)] }), 350);
}
const context = (S, x) => { S.context.innerHTML = line(x.line.slice(-6), x.line.length - Math.min(6, x.line.length)); S.underRight.textContent = x.branch; };
const refHtml = x => (x.ref && x.ref.link ? `<a href="${esc(x.ref.link)}" target="_blank" rel="noopener">${esc(x.player.split(' ').pop())} vs ${esc(x.ref.opp)}</a>` : '');
const contHtml = x => (x.continuation.length > 1 ? `<p class="small ink2">Then: ${line(x.continuation, x.line.length)}</p>` : '');

// LEARN: the move, one sentence, and you play it.
function learn(host, C, x, next) {
  const S = stage(host, { label: `${C.title.toUpperCase()} · LEARN` });
  const board = makeBoard(S.boardHost, x.fen, { orientation: C.color, movable: C.color, onMove: mv => played(mv) });
  enter(board, x); context(S, x); setTimeout(() => board.setArrows(arrows(x.fen, [[x.move, 'model']])), 400);
  S.side.innerHTML = `<p class="prompt">${esc(x.move)}<small>${esc(x.explain)}</small></p>${contHtml(x)}<p class="footnote">${esc(x.stat)} ${refHtml(x)}</p><p class="small muted fb">Play ${esc(x.move)} on the board.</p>`;
  let done = false;
  function played(mv) {
    if (done) return; if (mv.san.replace(/[+#]/g, '') !== x.move.replace(/[+#]/g, '')) { S.side.querySelector('.fb').textContent = `Play ${x.move}.`; return; }
    done = true; const p = new Pos(x.fen); p.make(mv.m); board.setPosition(p, { last: [mFrom(mv.m), mTo(mv.m)] }); board.setMovable(null); board.setArrows([]);
    learned(x.id); setTimeout(() => next({ id: x.id }), 650);
  }
  return () => { done = true; };
}

// TRAIN / REVIEW: what would you play? Try again → hint → reveal and play it.
function drill(host, C, x, next) {
  const S = stage(host, { label: `${C.title.toUpperCase()}` });
  const board = makeBoard(S.boardHost, x.fen, { orientation: C.color, movable: C.color, onMove: mv => answer(mv) });
  enter(board, x); context(S, x);
  S.side.innerHTML = `<p class="prompt">What would you play?<small>${C.color === 'w' ? 'White' : 'Black'} to move.</small></p><div class="fb"></div>`;
  const fb = () => S.side.querySelector('.fb'); let misses = 0, revealed = false, done = false;
  const same = san => san.replace(/[+#]/g, '') === x.move.replace(/[+#]/g, '');
  function answer(mv) {
    if (done) return; const p = new Pos(x.fen);
    if (same(mv.san)) {
      done = true; p.make(mv.m); board.setPosition(p, { last: [mFrom(mv.m), mTo(mv.m)] }); board.setMovable(null); board.setArrows([]);
      const firstTry = misses === 0 && !revealed; grade(x.id, firstTry);
      fb().innerHTML = `<p class="verdict">${firstTry ? 'Correct.' : 'That’s it.'}</p><p class="why">${esc(x.explain)}</p>`;
      setTimeout(() => next({ id: x.id, firstTry }), firstTry ? 900 : 1400); return;
    }
    misses++; board.setPosition(new Pos(x.fen), { animate: true });
    if (misses === 1) fb().innerHTML = '<p class="verdict bad">Try again.</p>';
    else if (misses === 2) { const m = p.parseSan(x.move); if (m) { board.sel = mFrom(m); board.paint(); } fb().innerHTML = '<p class="verdict bad">Try again.</p><p class="small ink2">Hint: this piece.</p>'; }
    else { revealed = true; board.setArrows(arrows(x.fen, [[x.move, 'model']])); fb().innerHTML = `<p class="verdict bad">The repertoire move is ${esc(x.move)}.</p><p class="why">${esc(x.explain)}</p><p class="small muted">Play it to continue.</p>`; }
  }
  return () => { done = true; };
}

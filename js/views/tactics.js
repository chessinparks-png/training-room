// TACTICS — Personal Tactics V1: the tactical mistakes from my own 3+2 games (data/tactics.json, built offline by
// tools/build-tactics.mjs from the stored Stockfish lines). LEARN, TRAIN, REVIEW like the Repertoire courses,
// on the same spaced-repetition schedule (courses.js) under its own progress key.
import { tactics } from '../data/catalog.js';
import { schedule, KNOWN } from './courses.js';
import { Pos, mFrom, mTo } from '../chess/core.js';
import { stage, makeBoard, arrows, sameMove } from '../training/common.js';
import * as store from '../data/store.js';
import { esc, line } from '../ui.js';

export const KEY = 'tactics.srs';
export const MOTIF = { LOOSE_PIECE: 'Loose piece', MISCOUNTED_CAPTURE: 'Miscounted capture', FORK: 'Fork', KING_EXPOSURE: 'King exposure', PIN_OR_SKEWER: 'Pin or skewer', MISSED_FORCING_MOVE: 'Forcing move', REMOVAL_OF_DEFENDER: 'Removal of the defender' };
export const PROMPT = { FIND_THE_MOVE: 'What did you miss?', THREAT_CHECK: 'What is your opponent threatening?', FORCING_MOVE: 'What forcing move should you examine first?', DEFEND: 'How do you keep the position together?' };
async function srs() { return { ...(await store.setting(KEY, {})) }; }
async function grade(id, ok) { const S = await srs(); S[id] = schedule(S[id], ok); await store.setSetting(KEY, S); return S[id]; }
async function learned(id) { const S = await srs(); if (!S[id]) { S[id] = { ...schedule(null, true), seen: 0, ok: 0 }; await store.setSetting(KEY, S); } }
const stateOf = r => (!r ? 'new' : r.box >= KNOWN ? 'known' : 'learning');

// the board is always seen from my side; on a THREAT_CHECK card the opponent is to move and I play their threat
const toMove = x => x.fen.split(' ')[1];
const accepts = (x, san) => x.moves.some(m => sameMove(m, san));
const plyOf = x => { const f = x.fen.split(' '); return ((+f[5] || 1) - 1) * 2 + (x.side === 'b' ? 1 : 0); };
const context = (S, x) => { if (x.prev.length) S.context.innerHTML = line(x.prev, plyOf(x) - x.prev.length); S.underRight.textContent = MOTIF[x.motif]; };
const after = x => (x.cont.length > 1 ? `<p class="small ink2">Then: ${line(x.cont, plyOf(x) + (x.type === 'THREAT_CHECK' ? 1 : 0))}</p>` : '');
const source = x => (x.game ? `<p class="footnote"><a href="https://www.chess.com/game/live/${esc(x.game)}" target="_blank" rel="noopener">Your game</a></p>` : '');

export async function dueCards(n, now = Date.now()) {
  const D = await tactics(); const S = await srs();
  return D.cards.filter(x => S[x.id] && S[x.id].due <= now).sort((a, b) => S[a.id].due - S[b.id].due).slice(0, n);
}
async function counts(D) { const S = await srs(); const now = Date.now(); const c = { new: 0, learning: 0, known: 0, due: 0 }; for (const x of D.cards) { c[stateOf(S[x.id])]++; if (S[x.id] && S[x.id].due <= now) c.due++; } return c; }

export async function mount(el, params) {
  const D = await tactics(); const mode = params[0]; let un = () => {};
  if (['learn', 'train', 'review'].includes(mode)) un = await run(el, D, mode); else await home(el, D);
  return () => un();
}
async function home(el, D) {
  const n = await counts(D);
  el.innerHTML = `<div class="tech-home"><div class="stack" style="--s:18px"><div class="kicker">Tactics · your games</div><h1 class="h1">Personal tactics.</h1>
      <p class="lede">${D.cards.length} tactical mistakes from your own 3+2 games.</p>
      <div class="canty-stats"><div><b class="num">${n.new}</b><span class="label">New</span></div><div><b class="num">${n.learning}</b><span class="label">Learning</span></div><div><b class="num">${n.known}</b><span class="label">Known</span></div><div><b class="num">${n.due}</b><span class="label">Due</span></div></div></div>
    <div class="group-list">
      <a class="group-row" href="#/tactics/learn"><span class="t">Learn<small class="tech-q">See the idea and play the move.</small></span><span class="c muted small">${n.new} new</span><span class="go">→</span></a>
      <a class="group-row" href="#/tactics/train"><span class="t">Train<small class="tech-q">Find it yourself.</small></span><span class="c muted small">${n.learning + n.known ? `${n.learning + n.known} learned` : 'learn first, or test yourself'}</span><span class="go">→</span></a>
      <a class="group-row" href="#/tactics/review"><span class="t">Review<small class="tech-q">Positions that are due.</small></span><span class="c">${n.due ? `<span class="chip accent">${n.due} due</span>` : '<span class="muted small">nothing due</span>'}</span><span class="go">→</span></a></div></div>`;
}

export async function queue(D, mode, S = null, now = Date.now()) {
  S = S || await srs(); const byOrder = (a, b) => a.order - b.order;
  if (mode === 'learn') return D.cards.filter(x => !S[x.id]).sort(byOrder).slice(0, 6);
  if (mode === 'review') return D.cards.filter(x => S[x.id] && S[x.id].due <= now).sort((a, b) => S[a.id].due - S[b.id].due).slice(0, 12);
  const seen = D.cards.filter(x => S[x.id]).sort((a, b) => S[a.id].box - S[b.id].box || byOrder(a, b));
  return (seen.length ? seen : D.cards.slice().sort(byOrder)).slice(0, 10);
}
async function run(el, D, mode) {
  const items = await queue(D, mode); let k = 0; let un = () => {}; const res = [];
  const title = `Tactics · ${mode[0].toUpperCase() + mode.slice(1)}`;
  const frame = () => { el.innerHTML = `<div class="session-bar"><span class="label ink">${esc(title)} · ${k} / ${items.length}</span><div class="meter"><i style="width:${((k - 1) / items.length) * 100}%"></i></div><a class="btn link" href="#/tactics">End</a></div><div class="step-host"></div>`; window.scrollTo(0, 0); return el.querySelector('.step-host'); };
  const next = r => { if (r) res.push(r); un(); if (k >= items.length) return done(); const x = items[k++]; un = (mode === 'learn' ? learn : drill)(frame(), x, next); };
  const done = async () => { const S = await srs(); const due = D.cards.map(x => S[x.id]).filter(Boolean).map(r => r.due).filter(d => d > Date.now()).sort((a, b) => a - b)[0];
    el.innerHTML = `<div class="stack" style="--s:22px;max-width:560px"><div class="kicker">${esc(title)}</div><h1 class="h1">${items.length ? 'Done.' : mode === 'review' ? 'Nothing due.' : 'Nothing new.'}</h1>
      ${mode !== 'learn' && res.length ? `<p class="lede">${res.filter(r => r.firstTry).length} of ${res.length} first try.</p>` : ''}${due ? `<p class="footnote">Next review ${new Date(due).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.</p>` : ''}
      <div class="row" style="gap:22px"><a class="btn primary" href="#/tactics">Back to Tactics</a></div></div>`; };
  next(); return () => un();
}

// LEARN: position, motif, one sentence, the move — and you play it.
function learn(host, x, next) {
  const S = stage(host, { label: `TACTICS · LEARN · ${MOTIF[x.motif].toUpperCase()}` });
  const board = makeBoard(S.boardHost, x.fen, { orientation: x.side, movable: toMove(x), onMove: mv => played(mv) });
  context(S, x); setTimeout(() => board.setArrows(arrows(x.fen, [[x.moves[0], x.type === 'THREAT_CHECK' ? 'you' : 'model']])), 300);
  S.side.innerHTML = `<p class="prompt">${esc(x.moves[0])}<small>${esc(x.lesson)}</small></p>${after(x)}${source(x)}<p class="small muted fb">${x.type === 'THREAT_CHECK' ? `Play your opponent's threat, ${esc(x.moves[0])}, on the board.` : `Play ${esc(x.moves[0])} on the board.`}</p>`;
  let done = false;
  function played(mv) {
    if (done) return; if (!accepts(x, mv.san)) { board.setPosition(new Pos(x.fen), { animate: true }); S.side.querySelector('.fb').textContent = `Play ${x.moves[0]}.`; return; }
    done = true; const p = new Pos(x.fen); p.make(mv.m); board.setPosition(p, { last: [mFrom(mv.m), mTo(mv.m)] }); board.setMovable(null); board.setArrows([]);
    learned(x.id); setTimeout(() => next({ id: x.id }), 650);
  }
  return () => { done = true; };
}

// TRAIN / REVIEW (and Today's recognition): the prompt, no answer. Try again → hint → reveal, then play it.
export function drill(host, x, next, { label } = {}) {
  const S = stage(host, { label: label || `TACTICS · ${MOTIF[x.motif].toUpperCase()}` });
  const board = makeBoard(S.boardHost, x.fen, { orientation: x.side, movable: toMove(x), onMove: mv => answer(mv) });
  context(S, x); S.underRight.textContent = ''; const t0 = Date.now();
  const who = x.type === 'THREAT_CHECK' ? `Play your opponent's move. ${toMove(x) === 'w' ? 'White' : 'Black'} to move.` : `${x.side === 'w' ? 'White' : 'Black'} to move.`;
  S.side.innerHTML = `<p class="prompt">${esc(PROMPT[x.type])}<small>${esc(who)}</small></p><div class="fb"></div>`;
  const fb = () => S.side.querySelector('.fb'); let misses = 0, revealed = false, done = false;
  function answer(mv) {
    if (done) return; const p = new Pos(x.fen);
    if (accepts(x, mv.san)) {
      done = true; p.make(mv.m); board.setPosition(p, { last: [mFrom(mv.m), mTo(mv.m)] }); board.setMovable(null); board.setArrows([]);
      const firstTry = misses === 0 && !revealed; grade(x.id, firstTry);
      fb().innerHTML = `<p class="verdict">${firstTry ? 'Correct.' : 'That’s it.'} <span class="small muted">${esc(MOTIF[x.motif])}</span></p><p class="why">${esc(x.lesson)}</p>${after(x)}${source(x)}<div class="actions"><button class="btn primary" data-a="next">Next</button></div>`;
      fb().querySelector('[data-a=next]').onclick = () => next({ id: x.id, firstTry, ok: firstTry, sec: (Date.now() - t0) / 1000 }); return;
    }
    misses++; board.setPosition(new Pos(x.fen), { animate: true });
    if (misses === 1) fb().innerHTML = '<p class="verdict bad">Try again.</p>';
    else if (misses === 2) { const m = p.parseSan(x.moves[0]); if (m) { board.sel = mFrom(m); board.paint(); } fb().innerHTML = `<p class="verdict bad">Try again.</p><p class="small ink2">Hint: ${esc(x.hint)}</p>`; }
    else { revealed = true; board.setArrows(arrows(x.fen, [[x.moves[0], 'model']])); fb().innerHTML = `<p class="verdict bad">The move is ${esc(x.moves[0])}.</p><p class="why">${esc(x.lesson)}</p><p class="small muted">Play it to continue.</p>`; }
  }
  return () => { done = true; };
}

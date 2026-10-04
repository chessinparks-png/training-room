// Repair: runs due items of every kind, and introduces new SF-confirmed mistakes from my games
// gradually (the Drill Room's "fresh" queue), so the due count never becomes a wall.
import * as srs from './srs.js';
import * as store from '../data/store.js';
import { C } from '../data/catalog.js';
import { Pos, mFrom, mTo } from '../chess/core.js';
import { esc, line, plyFromFen, stopwatch, toast } from '../ui.js';
import { stage, makeBoard, animateLine, arrows, famName, sideName, sameMove } from './common.js';
import { evalAfter } from '../analysis/engine.js';
import { moveQuality, fmtEval, winPct } from '../analysis/quality.js';

export async function seedRepair() {
  // one-time: nothing is forced into the due queue; see nextRepair() for gradual introduction
  const v = await store.setting('repair.seeded', 0); if (v) return; await store.setSetting('repair.seeded', 1);
}
const TARGET = new Set(['jobava', 'kid', 'oldindian', 'pirc']);
export const TACTICAL = ['missed-win', 'allowed-tactic', 'allowed-mate'];
function freshDrills(existing, fam, types) {
  return C.training.drills.filter(d => d.verdict !== 'not-a-mistake' && !existing.has('move:' + d.id) && (!fam || d.fam === fam) && (!types || types.includes(d.type)))
    .sort((a, b) => (TARGET.has(b.fam) - TARGET.has(a.fam)) || (b.n * b.loss) - (a.n * a.loss));
}
// Returns repair items to work on: due first, then up to `fresh` newly introduced ones.
// skipDue: only introduce new positions (fast recognition); types: limit new ones to drill types.
export async function nextRepair(count = 4, { fam = null, fresh = 2, skipDue = false, types = null } = {}) {
  const all = await srs.items(); const existing = new Set(all.map(r => r.id)); const now = Date.now();
  const due = skipDue ? [] : all.filter(r => r.due <= now && (!fam || r.fam === fam)).sort((a, b) => a.box - b.box || a.due - b.due);
  const out = due.slice(0, count);
  if (out.length < count) for (const d of freshDrills(existing, fam, types).slice(0, Math.min(fresh, count - out.length))) {
    const it = srs.newItem({ id: 'move:' + d.id, kind: 'move', ref: d.id, fam: d.fam, reason: `A position from your games${d.n > 1 ? ` — you went wrong here ${d.n} times` : ' where you went wrong'}.`, source: 'my games' });
    await srs.add(it); out.push(it);
  }
  return out;
}

// ---- "Find the move" runner (legacy drills + positions created from blitz errors) ----
export function mountMoveRepair(el, item, { onDone, label } = {}) {
  const d = item.payload || C.drillById.get(item.ref);
  if (!d) { onDone && onDone({ skipped: true }); return () => {}; }
  const fen = d.fen; const col = d.col || fen.split(' ')[1];
  const S = stage(el, { label: label || `REPAIR / ${famName(d.fam).toUpperCase()}` });
  const pos = new Pos(fen);
  const board = makeBoard(S.boardHost, fen, { orientation: col, movable: col, onMove: mv => answer(mv) });
  if (d.path && d.path.length) S.context.innerHTML = line(d.path.slice(-6), d.path.length - Math.min(6, d.path.length));
  let tries = 0, hinted = false, done = false; let stopAnim = () => {};
  const timer = { t: null };
  S.side.innerHTML = `<p class="prompt">${sideName(col)} to move.<small>${esc(item.reason || 'A position from your games.')}${d.seen > 1 ? ` Reached ${d.seen} times.` : ''}</small></p>
    <div class="timer num" aria-live="off">0.0</div>
    <div class="actions"><button class="btn quiet" data-a="hint">Hint</button><button class="btn quiet" data-a="show">Show answer</button></div><div class="fb"></div>`;
  const sw = stopwatch(S.side.querySelector('.timer'));
  S.side.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; act(a.dataset.a); });
  let busy = false;
  async function answer(mv) {
    if (done || busy) return; tries++; busy = true;
    const p2 = new Pos(fen); p2.make(mv.m); board.setPosition(p2, { last: [mFrom(mv.m), mTo(mv.m)] });
    const good = (d.good || [d.sfBest || d.best]).some(g => sameMove(g, mv.san));
    let ok = good, cp = null;
    if (!ok && !sameMove(mv.san, d.played)) { cp = await evalAfter(fen, mv.uci, { budget: 'fast', priority: 'high' }); if (cp != null && d.cpBest != null && winPct(d.cpBest) - winPct(cp) <= 4) ok = true; }
    busy = false;
    if (!ok && tries < 2 && !sameMove(mv.san, d.played)) {
      S.side.querySelector('.fb').innerHTML = `<p class="verdict">${esc(mv.san)} is not it.</p><p class="ink2 small">${d.type === 'missed-win' ? 'There is more here — look for forcing moves.' : /allowed/.test(d.type || '') ? 'First ask what your opponent threatens.' : 'Look for the move that improves your worst piece or fights for the centre.'} One more try.</p>`;
      setTimeout(() => { if (!done) board.setPosition(new Pos(fen), { animate: true }); }, 650); return;
    }
    finish(mv.san, ok, cp);
  }
  async function finish(san, ok, cp) {
    done = true; const secs = sw.stop(); board.setMovable(null);
    const firstTry = ok && tries <= 1 && !hinted;
    const best = d.sfBest || d.best; const q = d.cpBest != null && cp != null ? moveQuality(d.cpBest, cp, false) : null;
    board.setPosition(new Pos(fen), { animate: false });
    board.setArrows(arrows(fen, [[d.played, 'you'], [best, 'engine']]));
    const r = await srs.grade(item.id, firstTry);
    await store.logAttempt({ mode: 'repair', kind: 'move', id: item.id, fam: d.fam, ok: firstTry, sec: secs });
    const playedIsGame = san && sameMove(san, d.played);
    const head = firstTry ? `Found. ${esc(san)}.` : ok ? `${esc(san)} works — not first try.` : san ? (playedIsGame ? `${esc(san)} — the move from your game, and the problem.` : `Not quite: ${esc(san)}.`) : 'The answer.';
    S.side.querySelector('.actions').remove(); S.side.querySelector('.timer').textContent = secs.toFixed(1) + 's';
    S.side.querySelector('.fb').innerHTML = `<p class="verdict${ok ? '' : ' bad'}">${head}</p>
      <div class="reveal two"><div class="you"><div class="label">In your game</div><div class="mv">${esc(d.played)}</div><div class="sub">${fmtEval(d.cpPlayed, col === 'w')}</div></div>
      <div class="engine"><div class="label">Stockfish</div><div class="mv">${esc(best)}</div><div class="sub">${fmtEval(d.cpBest, col === 'w')}${d.good && d.good.length > 1 ? ' · also ' + d.good.filter(g => !sameMove(g, best)).map(esc).join(', ') : ''}</div></div></div>
      <div class="explain">${d.pvRef && d.pvRef.length > 1 ? `<div><h4>Why ${esc(d.played)} fails</h4><p class="small">${line(d.pvRef, plyFromFen(fen))}</p></div>` : ''}
      <div><h4>The better line</h4><p class="small">${line(d.pvBest || [best], plyFromFen(fen))}</p></div>
      ${d.verdict === 'inaccuracy' ? `<div><p class="small muted">Stockfish rates your game move an inaccuracy (−${d.loss}% win chance), not a blunder.</p></div>` : ''}</div>
      <p class="footnote">${r ? `Next review ${r.box >= 4 ? 'in ' + [0, 1, 3, 7, 16, 35][r.box] + ' days · mastered' : r.box ? 'in ' + [0, 1, 3, 7, 16, 35][r.box] + ' day' + (r.box > 1 ? 's' : '') : 'soon — it comes back this session window'}.` : ''} ${d.games && d.games.length ? `Source: <a href="https://www.chess.com/game/live/${esc(d.games[0])}" target="_blank" rel="noopener">your game</a>${d.games.length > 1 ? ` + ${d.games.length - 1} more` : ''}.` : ''}</p>
      <div class="actions"><button class="btn primary" data-a="next">Next</button><button class="btn link" data-a="best">Better line</button>${d.pvRef ? `<button class="btn link" data-a="ref">Why it fails</button>` : ''}</div>`;
    finish.result = { ok: firstTry, sec: secs, kind: 'repair' };
  }
  function act(a) {
    if (a === 'hint' && !done) { const m = new Pos(fen).parseSan(d.sfBest || d.best); hinted = true; if (m) { board.sel = mFrom(m); board.paint(); } toast('Hint: this piece'); }
    if (a === 'show' && !done) { hinted = true; finish(null, false, null); }
    if (a === 'best') { stopAnim(); stopAnim = animateLine(board, fen, d.pvBest || [d.sfBest]); }
    if (a === 'ref') { stopAnim(); stopAnim = animateLine(board, fen, d.pvRef); }
    if (a === 'next') { stopAnim(); onDone && onDone(finish.result || { ok: false }); }
  }
  return () => { stopAnim(); sw.stop(); };
}

// Dispatch any repair item to its trainer.
export async function mountRepairItem(el, item, opts) {
  if (item.kind === 'move') return mountMoveRepair(el, item, opts);
  if (item.kind === 'calc') { const { mountCalc } = await import('./calc.js'); const c = item.payload || C.itemById.get(item.ref); return mountCalc(el, c, { ...opts, repairId: item.id }); }
  if (item.kind === 'model') { const { mountDecision } = await import('./decision.js'); return mountDecision(el, C.itemById.get(item.ref), { ...opts, repairId: item.id }); }
  if (item.kind === 'plan') { const { mountPlan } = await import('./plan.js'); return mountPlan(el, C.itemById.get(item.ref), { ...opts, repairId: item.id }); }
  opts.onDone && opts.onDone({ skipped: true }); return () => {};
}

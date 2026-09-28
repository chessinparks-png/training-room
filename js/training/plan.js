// "What's the plan?" — choose the plan, then watch how the model player executed it.
import { Pos } from '../chess/core.js';
import { esc, line, plyFromFen, stopwatch } from '../ui.js';
import { stage, makeBoard, animateLine, famName, modelName, sideName } from './common.js';
import { fmtEval } from '../analysis/quality.js';
import * as store from '../data/store.js';
import * as srs from './srs.js';

export function mountPlan(el, it, { onDone, repairId, label } = {}) {
  if (!it) { onDone && onDone({ skipped: true }); return () => {}; }
  const M = modelName(it.player); const fen = it.fen;
  const S = stage(el, { label: label || `WHAT'S THE PLAN / ${famName(it.fam).toUpperCase()}` });
  const board = makeBoard(S.boardHost, fen, { orientation: it.side });
  if (it.opp) S.underRight.textContent = `${M} vs ${it.opp}${it.date ? ' · ' + it.date.slice(0, 4) : ''}`;
  S.side.innerHTML = `<p class="prompt">What's the plan?<small>${sideName(it.side)} to move. Think about the next few moves, not just one.</small></p><div class="timer num">0.0</div>
    <div class="options">${it.options.map((o, i) => `<button type="button" data-o="${esc(o)}"><span>${esc(o)}</span><span class="key">${i + 1}</span></button>`).join('')}</div><div class="fb"></div>`;
  const sw = stopwatch(S.side.querySelector('.timer')); let done = false; let stopAnim = () => {};
  const opts = S.side.querySelector('.options');
  opts.addEventListener('click', e => { const b = e.target.closest('[data-o]'); if (b) answer(b.dataset.o); });
  const key = e => { const n = +e.key; if (n >= 1 && n <= it.options.length && !done) answer(it.options[n - 1]); };
  document.addEventListener('keydown', key);

  async function answer(o) {
    if (done) return; done = true; const secs = sw.stop();
    const ok = it.accept.includes(o);
    opts.querySelectorAll('button').forEach(b => { b.disabled = true; const v = b.dataset.o; if (it.accept.includes(v)) b.classList.add('right'); else if (v === o) b.classList.add('wrong'); if (v === o) b.classList.add('chosen'); });
    S.side.querySelector('.timer').textContent = secs.toFixed(1) + 's';
    const evMove = Math.floor((it.event.ply - 1) / 2) + 1;
    S.side.querySelector('.fb').innerHTML = `<p class="verdict${ok ? '' : ' bad'}">${ok ? 'Yes — that is the plan the game followed.' : `The game went another way: ${esc(it.answer.toLowerCase())}.`}</p>
      <div class="explain"><div><h4>How ${esc(M)} executed it</h4><p><span class="tag-doc">Documented</span>${esc(it.event.label)} on move ${evMove}${it.event.san ? ` (${esc(it.event.san)})` : ''}.</p><p class="small moves" style="margin-top:8px">${line(it.cont, plyFromFen(fen))}</p></div>
      <div><h4>How often</h4><p><span class="tag-rec">${esc(it.event.stat.freq)}</span>${it.event.stat.k} / ${it.event.stat.n} ${esc(famName(it.fam))} games</p></div>
      <div><h4>Stockfish</h4><p class="small">${fmtEval(it.sfCp, it.side === 'w')} · prefers ${line(it.sfBest.slice(0, 4), plyFromFen(fen))}. <span class="tag-inf">Context</span>The engine judges moves; the plan is what the player chose to do with them.</p></div></div>
      <div class="actions"><button class="btn link" data-a="watch">Watch it again</button>${ok ? '' : '<button class="btn link" data-a="repair">Repair</button>'}<button class="btn primary" data-a="next">Next</button></div>`;
    stopAnim = animateLine(board, fen, it.cont, { delay: 1000 });
    await store.logAttempt({ mode: 'plan', id: it.id, fam: it.fam, player: it.player, ok, sec: secs, chose: o, answer: it.answer });
    if (repairId) await srs.grade(repairId, ok);
    else if (!ok) await srs.add(srs.newItem({ id: 'plan:' + it.id, kind: 'plan', ref: it.id, fam: it.fam, reason: `You chose "${o}"; ${M} played ${it.answer.toLowerCase()}`, source: 'plan' }));
    S.side.querySelector('.fb').addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'watch') { stopAnim(); board.setPosition(new Pos(fen), { animate: false }); stopAnim = animateLine(board, fen, it.cont, { delay: 1000 }); }
      if (a.dataset.a === 'repair') { a.textContent = 'In repair'; a.disabled = true; }
      if (a.dataset.a === 'next') { stopAnim(); onDone && onDone({ ok, sec: secs }); } });
  }
  return () => { stopAnim(); sw.stop(); document.removeEventListener('keydown', key); };
}

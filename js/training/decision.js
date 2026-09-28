// "What would you play?" on real model-player positions (and positions we both reach).
// Three distinct answers: YOUR move, the MODEL's documented move, STOCKFISH's preference.
// Success = an objectively sound move; matching the model is tracked separately.
import { Pos, mFrom, mTo } from '../chess/core.js';
import { esc, line, plyFromFen, stopwatch } from '../ui.js';
import { stage, makeBoard, animateLine, arrows, famName, modelName, sideName, sameMove } from './common.js';
import { evalAfter } from '../analysis/engine.js';
import { moveQuality, isSound, fmtEval, MOVE_LABEL } from '../analysis/quality.js';
import * as store from '../data/store.js';
import * as srs from './srs.js';
import { C } from '../data/catalog.js';

const CONCEPT = {
  break: 'a pawn break — it opens lines at the moment the pieces are ready for them',
  storm: 'a pawn storm — gaining space and opening files towards the enemy king',
  route: 'a piece manoeuvre — improving a piece that is not yet doing its job',
  place: 'a piece placement on a square this player keeps choosing in this structure',
  trade: 'a deliberate exchange that changes the character of the position',
  sac: 'a material sacrifice for time, lines or the initiative',
  prophylaxis: 'prophylaxis — removing the opponent\'s counterplay before acting',
  castle: 'king safety before action',
};

export function mountDecision(el, it, { onDone, repairId, label } = {}) {
  if (!it) { onDone && onDone({ skipped: true }); return () => {}; }
  const fen = it.fen, col = it.side; const M = modelName(it.player);
  const S = stage(el, { label: label || `${it.both ? 'A POSITION YOU BOTH PLAY' : 'WHAT WOULD YOU PLAY'} / ${famName(it.fam).toUpperCase()}` });
  const board = makeBoard(S.boardHost, fen, { orientation: col, movable: col, onMove: mv => choose(mv) });
  if (it.prev && it.prev.length) S.context.innerHTML = line(it.prev, plyFromFen(fen) - it.prev.length);
  if (it.opp) S.underRight.textContent = `${M} vs ${it.opp}${it.date ? ' · ' + it.date.slice(0, 4) : ''}`;
  S.side.innerHTML = `<p class="prompt">What would you play?<small>${sideName(col)} to move${it.both ? ` — a position from your own games (${it.mineN}×) that ${M} also reached (${it.modelN}×).` : ` — from ${M}'s games.`}</small></p><div class="timer num">0.0</div><div class="fb"></div>`;
  const sw = stopwatch(S.side.querySelector('.timer')); let done = false; let stopAnim = () => {};

  async function choose(mv) {
    if (done) return; done = true; const secs = sw.stop(); board.setMovable(null);
    const p2 = new Pos(fen); p2.make(mv.m); board.setPosition(p2, { last: [mFrom(mv.m), mTo(mv.m)] });
    S.side.querySelector('.fb').innerHTML = `<p class="label pulse">Checking with Stockfish…</p>`;
    const sf = it.sf || []; const best = sf[0];
    let yourCp = (sf.find(l => sameMove(l.san, mv.san)) || {}).cp;
    if (yourCp == null) yourCp = await evalAfter(fen, mv.uci, { budget: 'fast', priority: 'high' });
    const q = best && yourCp != null ? moveQuality(best.cp, yourCp, sameMove(best.san, mv.san)) : { label: 'good', loss: 0 };
    const mq = best && it.modelCp != null ? moveQuality(best.cp, it.modelCp, sameMove(best.san, it.modelMove)) : null;
    const matched = sameMove(mv.san, it.modelMove); const sound = isSound(q.label);
    board.setPosition(new Pos(fen), { animate: false });
    board.setArrows(arrows(fen, [[mv.san, 'you'], [it.modelMove, 'model'], [best && best.san, 'engine']]));
    const pat = it.pattern ? (C.rep.families[it.fam].models[it.player].patterns.patterns.find(p => p.key === it.pattern) || null) : null;
    const type = it.pattern ? it.pattern.split(':')[0] : null;
    let verdict;
    if (matched) verdict = `The same move ${M} chose.`;
    else if (sound) verdict = `Sound — ${MOVE_LABEL[q.label].toLowerCase()} by Stockfish, though not ${M}'s choice.`;
    else verdict = `${MOVE_LABEL[q.label]} — ${esc(mv.san)} costs about ${Math.round(q.loss)}% win chance.`;
    const mineRow = it.both ? `<div><h4>Your games</h4><p class="small">${Object.entries(it.mineNext).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${esc(s)} ${n}×`).join(' · ')} <span class="muted">(${it.mineN} games)</span></p></div><div><h4>${esc(M)}'s games</h4><p class="small">${Object.entries(it.modelNext).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s, n]) => `${esc(s)} ${n}×`).join(' · ')} <span class="muted">(${it.modelN} games)</span></p></div>` : '';
    S.side.querySelector('.fb').innerHTML = `<p class="verdict${sound || matched ? '' : ' bad'}">${verdict}</p>
      <div class="reveal"><div class="you"><div class="label">You</div><div class="mv">${esc(mv.san)}</div><div class="sub">${yourCp != null ? fmtEval(yourCp, col === 'w') : ''} · ${secs.toFixed(1)}s</div></div>
        <div class="model"><div class="label">${esc(M)}</div><div class="mv">${esc(it.modelMove)}</div><div class="sub">${it.modelCp != null ? fmtEval(it.modelCp, col === 'w') : ''}${mq ? ' · ' + MOVE_LABEL[mq.label].toLowerCase() : ''}</div></div>
        <div class="engine"><div class="label">Stockfish</div><div class="mv">${esc(best ? best.san : '—')}</div><div class="sub">${best ? fmtEval(best.cp, col === 'w') + ' · d' + (best.d || '') : ''}</div></div></div>
      <div class="explain">
        ${pat ? `<div><h4>The idea</h4><p><span class="tag-doc">Documented</span>${esc(it.both ? `${M} most often played ${it.modelMove} here.` : `${M} played ${it.modelMove}: ${pat.label.toLowerCase()}.`)}</p><p class="small" style="margin-top:8px">${esc(CONCEPT[type] ? 'It is ' + CONCEPT[type] + '.' : '')}</p></div>
        <div><h4>Recurring model pattern</h4><p><span class="tag-rec">${esc(pat.freq)}</span>${pat.k} / ${pat.n} ${famName(it.fam)} games</p><p class="small" style="margin-top:6px">In the supplied games ${esc(M)} plays ${esc(pat.label.toLowerCase())} typically around move ${pat.medianMove}. ${pat.freq === 'occasional' ? 'Occasional — a real option, not a habit.' : ''}</p></div>` : mineRow}
        ${!pat && !it.both ? '' : ''}
        <div><h4>Your move</h4><p class="small">${sound ? `Objectively reasonable (${MOVE_LABEL[q.label].toLowerCase()}${q.loss ? ', −' + q.loss + '% win chance vs best' : ''}).` : `Stockfish's refutation line starts ${esc(best ? best.pv.slice(0, 4).join(' ') : '')}.`}${matched ? '' : ` ${esc(M)}'s game continued ${line(it.cont ? it.cont.slice(0, 6) : [it.modelMove], plyFromFen(fen))}.`}</p></div>
      </div>
      <p class="footnote">${it.link ? `Source: <a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(M)} vs ${esc(it.opp || '')}</a>, move ${Math.floor(it.ply / 2) + 1}.` : `Source: ${it.modelN} ${esc(M)} games reaching this exact position (transpositions included).`}</p>
      <div class="actions"><button class="btn link" data-a="line">Play model line</button><button class="btn link" data-a="sf">Stockfish line</button><button class="btn link" data-a="repair">Repair this position</button><button class="btn primary" data-a="next">Next</button></div>`;
    const ok = sound; const rec = { ok, matched, sec: secs, quality: q.label, loss: q.loss };
    await store.logAttempt({ mode: 'decision', id: it.id, fam: it.fam, player: it.player, ok, matched, sec: secs, quality: q.label, pattern: it.pattern || null, both: !!it.both });
    if (repairId) await srs.grade(repairId, ok);
    else if (!ok) await srs.add(srs.newItem({ id: 'model:' + it.id, kind: 'model', ref: it.id, fam: it.fam, reason: `You chose ${mv.san} (${MOVE_LABEL[q.label].toLowerCase()}) where ${M} played ${it.modelMove}`, source: 'model decision' }));
    S.side.querySelector('.fb').addEventListener('click', async e => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'line') { stopAnim(); stopAnim = animateLine(board, fen, it.cont || [it.modelMove]); }
      if (a.dataset.a === 'sf' && best) { stopAnim(); stopAnim = animateLine(board, fen, best.pv); }
      if (a.dataset.a === 'repair') { await srs.add(srs.newItem({ id: 'model:' + it.id, kind: 'model', ref: it.id, fam: it.fam, reason: 'Added by you', source: 'model decision' })); a.textContent = 'In repair'; a.disabled = true; }
      if (a.dataset.a === 'next') { stopAnim(); onDone && onDone(rec); }
    });
  }
  return () => { stopAnim(); sw.stop(); };
}

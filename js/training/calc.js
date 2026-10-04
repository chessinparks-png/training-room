// CALCULATE. Do not move the pieces. Then enter the line. The comparison finds the FIRST point
// where the calculation departs from reality, and treats sound alternatives as sound.
import { Pos, mFrom, mTo } from '../chess/core.js';
import { esc, line, plyFromFen, stopwatch, sanAt } from '../ui.js';
import { stage, makeBoard, animateLine, famName, modelName, sideName, sameMove } from './common.js';
import { analyseP, evalAfter } from '../analysis/engine.js';
import { fmtEval, winPct } from '../analysis/quality.js';
import * as store from '../data/store.js';
import * as srs from './srs.js';

export const LEVELS = { short: { plies: 3, label: 'Short', note: '2–3 ply' }, medium: { plies: 5, label: 'Medium', note: '4–6 ply' }, deep: { plies: 9, label: 'Deep', note: '6–10 ply' } };
export const KIND_LABEL = { tactical: 'Tactical', defensive: 'Defensive', quiet: 'Quiet move', exchanges: 'Exchanges', 'pawn break': 'Pawn break', conversion: 'Conversion', attack: 'Attack', positional: 'Positional' };

export function mountCalc(el, it, { onDone, repairId, level, label, blind = false } = {}) {
  if (!it) { onDone && onDone({ skipped: true }); return () => {}; }
  const fen = it.fen, col = it.side || fen.split(' ')[1];
  const lvl = level && LEVELS[level] ? level : (it.level || 'medium');
  const required = Math.min(LEVELS[lvl].plies, it.line.length);
  const src = it.src === 'mine' ? 'FROM YOUR GAMES' : it.player ? modelName(it.player).toUpperCase() : '';
  const S = stage(el, { label: label || `CALCULATION / ${it.fam ? famName(it.fam).toUpperCase() : 'YOUR GAMES'}` });
  const board = makeBoard(S.boardHost, fen, { orientation: col });
  S.underRight.textContent = src;
  S.side.innerHTML = `<p class="prompt">Calculate.<small>Do not move the pieces. ${sideName(col)} to move — see ${required} plies (${required === 1 ? 'your move' : 'your move and the replies'}).</small></p>
    <div class="timer num">0.0</div>
    <div class="entry-wrap"><button class="btn primary" data-a="enter">I'm ready</button></div><div class="fb"></div>`;
  if (blind) {
    S.side.querySelector('.prompt').innerHTML = `Study the board.<small>It disappears in <b class="bl-count">12</b> seconds. Then calculate ${required} plies blind — ${sideName(col)} to move.</small>`;
    let n = 12; const iv = setInterval(() => { n--; const c = S.side.querySelector('.bl-count'); if (c) c.textContent = n; if (n <= 0) { clearInterval(iv); board.hidePieces(true); S.side.querySelector('.prompt').innerHTML = `Calculate.<small>The board is gone. ${sideName(col)} to move — ${required} plies.</small>`; } }, 1000);
    blind = { iv };
  }
  const sw = stopwatch(S.side.querySelector('.timer')); let stopAnim = () => {}; let phase = 'think'; let thinkSec = 0; let userLine = [];
  const onKey = e => { if (e.key === 'Enter' && phase === 'think' && !/input|textarea/i.test(e.target.tagName)) { e.preventDefault(); openEntry(); } };
  document.addEventListener('keydown', onKey);
  S.side.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; act(a.dataset.a, a); });

  // After thinking, the board is only used to RECORD the calculated line: both sides' moves.
  let entryPos = null;
  function openEntry() {
    if (phase !== 'think') return; phase = 'enter'; thinkSec = sw.elapsed();
    if (blind) { clearInterval(blind.iv); board.hidePieces(false); }
    S.side.querySelector('.prompt').innerHTML = `Enter your line.<small>Make the moves you calculated on the board — yours and the replies. Tap a piece, then its square, or drag it.</small>`;
    S.side.querySelector('.entry-wrap').innerHTML = `<div class="line-entry"><div class="label">Your line</div><div class="chips" aria-live="polite"></div>
      <div class="actions"><button class="btn primary" data-a="submit" disabled>Submit line</button><button class="btn link" data-a="undo" disabled>Undo last move</button><button class="btn link" data-a="reset" disabled>Reset line</button></div></div>`;
    entryPos = new Pos(fen); userLine = [];
    // phones: the board sits above this panel, bring it back into view for entry
    if (window.matchMedia && matchMedia('(max-width: 980px)').matches) S.boardHost.scrollIntoView({ block: 'start', behavior: 'smooth' });
    board.setMovable('both');
    board.o.onMove = mv => { entryPos.make(mv.m); userLine.push(mv.san); board.setPosition(entryPos, { last: [mFrom(mv.m), mTo(mv.m)] }); drawLine(); };
    drawLine();
  }
  function drawLine() {
    const ply0 = plyFromFen(fen);
    S.side.querySelector('.chips').innerHTML = userLine.length ? userLine.map((m, i) => `<span>${esc(sanAt(ply0 + i, m))}</span>`).join('') : `<span class="muted" style="border:0;padding-left:0">${sideName(col)} to move — make the first move.</span>`;
    const none = !userLine.length; S.side.querySelectorAll('[data-a="submit"],[data-a="undo"],[data-a="reset"]').forEach(b => { b.disabled = none; });
    board.setMovable(entryPos.status() ? null : 'both');
  }
  function undo() { if (!userLine.length) return; entryPos.unmake(); userLine.pop(); const lm = entryPos.lastMove(); board.setPosition(entryPos, { last: lm ? [mFrom(lm), mTo(lm)] : null }); drawLine(); }
  function reset() { entryPos = new Pos(fen); userLine = []; board.setPosition(entryPos, { animate: false }); drawLine(); }
  function submit() { if (userLine.length) evaluate(); }
  async function evaluate() {
    phase = 'done'; const secs = sw.stop(); board.setMovable(null); if (blind) { clearInterval(blind.iv); board.hidePieces(false); } board.o.onMove = null; board.setPosition(new Pos(fen), { animate: false });
    S.side.querySelector('.prompt').innerHTML = `Your calculation.<small>${sideName(col)} to move · ${required} plies.</small>`; S.side.querySelector('.entry-wrap').innerHTML = ''; S.side.querySelector('.fb').innerHTML = `<p class="label pulse">Comparing with Stockfish…</p>`;
    const sfl = it.line.slice(0, Math.max(required, Math.min(it.line.length, userLine.length)));
    const p = new Pos(fen); let correct = 0; let failure = null; let altAccepted = false; let firstOk = false;
    for (let i = 0; i < Math.min(userLine.length, required); i++) {
      const u = userLine[i], s = sfl[i]; const own = i % 2 === 0;
      if (s && sameMove(u, s)) { correct++; if (i === 0) firstOk = true; p.play(u); continue; }
      // divergence: judge the alternative with the engine
      const here = p.fen(); const ref = await analyseP(here, { budget: 'fast', priority: 'high' });
      const bestCp = ref && ref.lines[0] ? ref.lines[0].score : null; const bestSan = ref && ref.best ? new Pos(here).uciToSan(ref.best) : s;
      const uCp = await evalAfter(here, u, { budget: 'fast', priority: 'high' });
      const loss = bestCp != null && uCp != null ? winPct(bestCp) - winPct(uCp) : 99;
      if (loss <= 4) { correct++; altAccepted = true; if (i === 0) firstOk = true; failure = { i, kind: 'alt', u, s: bestSan }; break; }
      failure = { i, own, u, s: bestSan || s, loss };
      break;
    }
    if (!failure && userLine.length < required) failure = { i: userLine.length, short: true, s: sfl[userLine.length] };
    const depth = correct; const acc = correct / required;
    // resulting evaluation of the user's line vs the engine line (root side's perspective)
    const endU = new Pos(fen); userLine.forEach(s => endU.play(s)); const endS = new Pos(fen); sfl.slice(0, required).forEach(s => endS.play(s));
    const [ru, rs] = await Promise.all([analyseP(endU.fen(), { budget: 'fast', priority: 'high' }), analyseP(endS.fen(), { budget: 'fast', priority: 'high' })]);
    const sign = (pp) => (pp.turn === new Pos(fen).turn ? 1 : -1);
    const evU = ru && ru.lines[0] ? ru.lines[0].score * sign(endU) : null; const evS = rs && rs.lines[0] ? rs.lines[0].score * sign(endS) : it.cp;
    const ply0 = plyFromFen(fen);
    let msg;
    if (!failure) msg = `Your calculation holds for all ${required} plies.`;
    else if (failure.kind === 'alt') msg = `${failure.i ? `You saw ${esc(userLine.slice(0, failure.i).join(' '))}, then` : 'You'} chose ${esc(failure.u)} instead of ${esc(failure.s)} — a sound alternative path, so the comparison stops there.`;
    else if (failure.short) msg = `Correct as far as you went — but the line needed ${required} plies; next is ${esc(sanAt(ply0 + failure.i, failure.s))}.`;
    else if (failure.i === 0) msg = `The first move is the problem: ${esc(failure.u)} instead of ${esc(failure.s)}.`;
    else if (!failure.own) msg = `You correctly saw ${esc(userLine.slice(0, failure.i).join(' '))}, but after ${esc(userLine[failure.i - 1])} you missed ${esc(sanAt(ply0 + failure.i, failure.s))}.`;
    else msg = `You correctly saw ${esc(userLine.slice(0, failure.i).join(' '))}, but then ${esc(failure.u)} instead of ${esc(failure.s)} — you lost track after ${failure.i} plies.`;
    const ok = firstOk && acc >= 0.6;
    S.side.querySelector('.fb').innerHTML = `<p class="verdict${ok ? '' : ' bad'}">${msg}</p>
      <div class="scoreline"><div><div class="label">First move</div><div class="v">${firstOk ? '✓' : '✗'}</div></div><div><div class="label">Accuracy</div><div class="v num">${Math.round(acc * 100)}%</div></div><div><div class="label">Depth</div><div class="v num">${depth}<span class="small muted"> / ${required}</span></div></div><div><div class="label">Time</div><div class="v num">${Math.round(secs)}s</div></div><div><div class="label">Result</div><div class="v num">${fmtEval(evU, col === 'w')}</div></div></div>
      <table class="cmp"><tr><td>Your line</td><td>${line(userLine, ply0)}</td></tr><tr><td>Stockfish</td><td>${line(sfl.slice(0, Math.max(required, 4)), ply0)} <span class="muted">${fmtEval(it.cp, col === 'w')}</span></td></tr>${it.modelLine ? `<tr><td>${esc(modelName(it.player))}</td><td>${line(it.modelLine.slice(0, 6), ply0)} <span class="muted">(game)</span></td></tr>` : ''}${it.played ? `<tr><td>In your game</td><td>${esc(it.played)}</td></tr>` : ''}</table>
      <p class="footnote">${esc(KIND_LABEL[it.kind] || '')} · ${LEVELS[lvl].label.toLowerCase()} · thinking ${Math.round(thinkSec)}s before entering.${evS != null ? ` Engine line ends ${fmtEval(evS, col === 'w')}.` : ''}</p>
      <div class="actions"><button class="btn primary" data-a="next">Next</button><button class="btn link" data-a="sfline">Show Stockfish line</button><button class="btn link" data-a="myline">Replay my line</button>${it.modelLine ? '<button class="btn link" data-a="model">Model continuation</button>' : ''}<button class="btn link" data-a="repair">Repair</button></div>`;
    const rec = { ok, firstOk, acc, depth, required, sec: secs, thinkSec, kind: it.kind, level: lvl };
    act.rec = rec;
    await store.logAttempt({ mode: 'calc', id: it.id, fam: it.fam, src: it.src, ...rec });
    if (repairId) await srs.grade(repairId, ok);
    else if (!ok) await srs.add(srs.newItem({ id: 'calc:' + it.id, kind: 'calc', ref: it.id, fam: it.fam, reason: failure && !failure.kind ? msg.replace(/<[^>]+>/g, '') : 'Calculation missed', source: 'calculation', payload: it.id.startsWith('calc:') ? null : it }));
  }
  function act(a, btn) {
    if (a === 'enter') openEntry();
    if (a === 'submit') submit();
    if (a === 'undo') undo();
    if (a === 'reset') reset();
    if (a === 'sfline') { stopAnim(); stopAnim = animateLine(board, fen, it.line.slice(0, Math.max(required, 6))); }
    if (a === 'myline') { stopAnim(); stopAnim = animateLine(board, fen, userLine); }
    if (a === 'model') { stopAnim(); stopAnim = animateLine(board, fen, it.modelLine); }
    if (a === 'repair') { srs.add(srs.newItem({ id: 'calc:' + it.id, kind: 'calc', ref: it.id, fam: it.fam, reason: 'Added by you', source: 'calculation', payload: it.id.startsWith('calc:') ? null : it })); btn.textContent = 'In repair'; btn.disabled = true; }
    if (a === 'next') { stopAnim(); onDone && onDone(act.rec || { ok: false }); }
  }
  return () => { stopAnim(); sw.stop(); if (blind) clearInterval(blind.iv); document.removeEventListener('keydown', onKey); };
}

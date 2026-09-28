// PLAY FORWARD from an important repertoire position. No interruptions while playing; after a
// meaningful sequence compare YOUR PLAN, the MODEL GAME(S) and STOCKFISH.
import { Pos, mFrom, mTo } from '../chess/core.js';
import { esc, line, plyFromFen, weighted, sleep } from '../ui.js';
import { stage, makeBoard, animateLine, famName, modelName, sideName } from './common.js';
import { analyseP, playMove, evalAfter, pvToSan } from '../analysis/engine.js';
import { moveQuality, isError, MOVE_LABEL } from '../analysis/quality.js';
import { book } from '../data/catalog.js';
import * as store from '../data/store.js';
import * as srs from './srs.js';

const OWN_MOVES = 8;

// Events from a line that starts mid-game: replay the prefix so squares/pieces are right.
function lineEvents(fen, sans, side) {
  const out = []; const p = new Pos(fen);
  // gameEvents works from the initial position, so emulate by scanning moves directly
  const evs = []; const me = side;
  for (let i = 0; i < sans.length; i++) {
    const mine = (p.turn ? 'b' : 'w') === me; const m = p.parseSan(sans[i]); if (!m) break;
    const pc = p.b[mFrom(m)] & 7; const cap = !!p.b[mTo(m)]; const san = p.san(m); p.make(m);
    if (!mine) continue;
    if (pc === 1 && !cap) { const to = san.replace(/[+#]/g, ''); const f = to[0]; evs.push({ i, kind: 'pawn', label: `${me === 'b' ? '…' : ''}${to}`, wing: 'ab'.includes(f) ? 'queenside' : 'gh'.includes(f) ? 'kingside' : 'centre' }); }
    else if (cap) evs.push({ i, kind: 'capture', label: san });
    else if (san.startsWith('O-O')) evs.push({ i, kind: 'castle', label: san });
    else evs.push({ i, kind: 'piece', label: san });
  }
  return evs;
}
function describe(evs) {
  const pawns = evs.filter(e => e.kind === 'pawn'); const caps = evs.filter(e => e.kind === 'capture');
  const parts = [];
  if (pawns.length) parts.push(`pawn moves ${pawns.map(e => e.label).join(', ')}`);
  if (caps.length) parts.push(`${caps.length} capture${caps.length > 1 ? 's' : ''}`);
  const pcs = evs.filter(e => e.kind === 'piece').length; if (pcs) parts.push(`${pcs} piece move${pcs > 1 ? 's' : ''}`);
  return parts.join(' · ') || '—';
}

export function mountPlayForward(el, start, { onDone, label } = {}) {
  const side = start.side; const fen0 = start.fen; const M = modelName(start.player);
  const S = stage(el, { label: label || `PLAY FORWARD / ${famName(start.fam).toUpperCase()}` });
  const pos = new Pos(fen0); const played = []; const mine = []; let bk = null; let over = false; let t0 = performance.now();
  const board = makeBoard(S.boardHost, fen0, { orientation: side, movable: side, onMove: mv => userMove(mv) });
  S.underRight.textContent = start.n ? `${M} reached this ${start.n}×` : '';
  S.side.innerHTML = `<p class="prompt">Play it forward.<small>${sideName(side)}. Play ${OWN_MOVES} moves the way you would in a game. No feedback until the end — the opponent answers from real games, then Stockfish.</small></p>
    <div class="moves"></div><div class="actions"><button class="btn link" data-a="compare">Compare now</button></div><div class="fb"></div>`;
  S.side.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (a && a.dataset.a === 'compare') compare(); if (a && a.dataset.a === 'next') { stopAnim(); onDone && onDone(result); } if (a && a.dataset.a === 'model') { stopAnim(); stopAnim = animateLine(board, fen0, start.games[0].cont); } if (a && a.dataset.a === 'mine') { stopAnim(); stopAnim = animateLine(board, fen0, played); } if (a && a.dataset.a === 'sf') { stopAnim(); stopAnim = animateLine(board, fen0, sfLine); } });
  let stopAnim = () => {}; let sfLine = []; let result = null;
  const drawMoves = () => { S.side.querySelector('.moves').innerHTML = line(played, plyFromFen(fen0)) || '<span class="muted">Your move.</span>'; };
  drawMoves();
  book().then(b => { bk = b; });
  if ((pos.turn ? 'b' : 'w') !== side) setTimeout(reply, 400);

  async function userMove(mv) {
    if (over) return; const sec = (performance.now() - t0) / 1000; const before = pos.fen();
    pos.make(mv.m); played.push(mv.san); mine.push({ fen: before, san: mv.san, uci: mv.uci, sec });
    board.setPosition(pos, { last: [mFrom(mv.m), mTo(mv.m)] }); board.setMovable(null); drawMoves();
    if (pos.status()) return compare();
    if (mine.length >= OWN_MOVES) return compare();
    reply();
  }
  async function reply() {
    await sleep(350 + Math.random() * 500); if (over) return;
    let san = null; const e = bk && bk[pos.hash()];
    if (e) { const opts = Object.entries(e[1]).filter(([, c]) => c[1] + c[3] > 0); if (opts.length) san = weighted(opts, ([, c]) => c[1] * 2 + c[3])[0]; }
    if (!san) { const u = await playMove(pos.fen(), { elo: 2350, movetime: 500 }); san = u ? pos.uciToSan(u) : null; }
    if (over) return;
    if (!san) return compare();
    const m = pos.parseSan(san); pos.make(m); played.push(pos.hist.length ? san : san);
    board.setPosition(pos, { last: [mFrom(m), mTo(m)] }); drawMoves(); t0 = performance.now();
    if (pos.status()) return compare();
    board.setMovable(side);
  }
  async function compare() {
    if (over) return;
    if (mine.length < 2 && !pos.status()) { const a = S.side.querySelector('[data-a="compare"]'); if (a) a.textContent = 'Play at least two moves first'; return; }
    over = true; board.setMovable(null);
    const fb = S.side.querySelector('.fb'); S.side.querySelector('.actions').remove();
    fb.innerHTML = `<p class="label pulse">Reviewing ${mine.length} moves with Stockfish…</p>`;
    const rows = [];
    for (const m of mine) {
      const r = await analyseP(m.fen, { budget: 'review', priority: 'high' }); const best = r && r.lines[0];
      const bestSan = best ? new Pos(m.fen).uciToSan(best.pv[0]) : null;
      const cp = bestSan === m.san ? best.score : await evalAfter(m.fen, m.uci, { budget: 'fast', priority: 'high' });
      const q = best && cp != null ? moveQuality(best.score, cp, bestSan === m.san) : { label: 'good', loss: 0 };
      rows.push({ ...m, bestSan, q, cp });
    }
    const r0 = await analyseP(fen0, { budget: 'review', priority: 'high' }); sfLine = r0 && r0.lines[0] ? pvToSan(fen0, r0.lines[0].pv, 10) : [];
    const myEv = lineEvents(fen0, played, side); const modelCont = start.games && start.games[0] ? start.games[0].cont : [];
    const moEv = lineEvents(fen0, modelCont, side);
    const diffs = [];
    const firstErr = rows.find(r => isError(r.q.label) || r.q.label === 'inaccuracy');
    if (firstErr) diffs.push(`Your first real slip: <b>${esc(firstErr.san)}</b> (${MOVE_LABEL[firstErr.q.label].toLowerCase()}, −${firstErr.q.loss}%) — Stockfish preferred ${esc(firstErr.bestSan || '')}.`);
    const span = e => e.i < Math.max(played.length, 2); const moPawn = moEv.filter(e => e.kind === 'pawn' && span(e)).map(e => e.label), myPawn = myEv.filter(e => e.kind === 'pawn').map(e => e.label);
    const missed = moPawn.filter(x => !myPawn.includes(x));
    if (missed.length && modelCont.length) diffs.push(`<span class="tag-doc">Documented</span>In the supplied game ${esc(M)} played ${esc(missed.join(', '))}; you did not.`);
    const moCaps = moEv.filter(e => e.kind === 'capture' && span(e)).length, myCaps = myEv.filter(e => e.kind === 'capture').length;
    if (myCaps >= moCaps + 2) diffs.push(`You exchanged more (${myCaps} captures vs ${moCaps} in the model game over the same span).`);
    if (!diffs.length) diffs.push('No important difference: your moves held their value and followed a comparable plan.');
    const avg = rows.length ? rows.reduce((s, r) => s + r.q.loss, 0) / rows.length : 0;
    result = { ok: !rows.some(r => isError(r.q.label)), moves: rows.length, avgLoss: avg };
    fb.innerHTML = `<div class="reveal"><div class="you"><div class="label">Your plan</div><div class="sub">${esc(describe(myEv))}</div></div><div class="model"><div class="label">${esc(M)} · game</div><div class="sub">${modelCont.length ? esc(describe(moEv.filter(e => e.i < played.length))) : 'No documented game from here'}</div></div><div class="engine"><div class="label">Stockfish</div><div class="sub">${line(sfLine.slice(0, 5), plyFromFen(fen0))}</div></div></div>
      <table class="cmp">${rows.map(r => `<tr><td class="mvcell">${esc(r.san)}</td><td class="${isError(r.q.label) ? 'miss' : 'ok'}">${MOVE_LABEL[r.q.label]}${r.q.loss > 1 ? ` · −${r.q.loss}%` : ''}${r.bestSan && r.bestSan !== r.san && r.q.label !== 'best' ? ` <span class="muted">(Stockfish: ${esc(r.bestSan)})</span>` : ''} <span class="muted">· ${r.sec.toFixed(1)}s</span></td></tr>`).join('')}</table>
      <div class="explain"><div><h4>Important differences</h4>${diffs.map(d => `<p class="small">${d}</p>`).join('')}</div>
      ${modelCont.length ? `<div><h4>The model game</h4><p class="small moves">${line(modelCont.slice(0, 12), plyFromFen(fen0))}</p><p class="footnote">${esc(M)} vs ${esc(start.games[0].opp || '')}${start.games[0].date ? ', ' + esc(start.games[0].date.slice(0, 4)) : ''} · ${start.n} supplied games reached this position.</p></div>` : ''}</div>
      <div class="actions"><button class="btn link" data-a="mine">Replay mine</button>${modelCont.length ? '<button class="btn link" data-a="model">Replay model game</button>' : ''}<button class="btn link" data-a="sf">Stockfish line</button><button class="btn primary" data-a="next">Next</button></div>`;
    await store.logAttempt({ mode: 'playforward', fam: start.fam, ok: result.ok, moves: rows.length, avgLoss: avg, sec: rows.reduce((s, r) => s + r.sec, 0) });
    for (const r of rows.filter(r => isError(r.q.label))) {
      await srs.add(srs.newItem({ id: 'move:pf:' + new Pos(r.fen).hash(), kind: 'move', fam: start.fam, reason: `Play-forward: ${r.san} was a ${MOVE_LABEL[r.q.label].toLowerCase()}`, source: 'play forward',
        payload: { fen: r.fen, col: side, fam: start.fam, played: r.san, sfBest: r.bestSan, good: [r.bestSan], cpBest: null, cpPlayed: r.cp, pvBest: [r.bestSan], loss: r.q.loss, verdict: 'mistake' } }));
    }
  }
  return () => { over = true; stopAnim(); };
}

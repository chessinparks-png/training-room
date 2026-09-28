// Post-game blitz diagnosis. Turns per-move engine data + clock data into a few named findings.
// Evaluations are never adjusted for time; time only affects DECISION quality.
import { Pos } from '../chess/core.js';
import { analyseP, pvToSan } from './engine.js';
import { moveQuality, decisionQuality, isError, isSound, THRESHOLDS, MOVE_LABEL } from './quality.js';
import { classifyGame } from '../repertoire/classifier.js';
import { book } from '../data/catalog.js';
import * as srs from '../training/srs.js';

// Analyse every position of the game (both sides) once; derive before/after for each move.
export async function analyseGame(game, onProgress) {
  const p = new Pos(); const fens = [p.fen()];
  for (const s of game.moves) { p.play(s); fens.push(p.fen()); }
  const res = [];
  for (let i = 0; i < fens.length; i++) {
    const pp = new Pos(fens[i]); const st = pp.status();
    if (st) { res.push({ score: st.reason === 'checkmate' ? -99990 : 0, best: null, pv: [], terminal: true }); continue; }
    const r = await analyseP(fens[i], { budget: 'review', priority: 'high' });
    const l = r && r.lines[0]; res.push({ score: l ? l.score : 0, best: r ? r.best : null, pv: l ? l.pv : [], d: r ? r.depth : 0 });
    onProgress && onProgress(i + 1, fens.length);
  }
  const bk = await book().catch(() => ({}));
  const fam = classifyGame(game.moves, game.color).family;
  const rows = [];
  for (let i = 0; i < game.moves.length; i++) {
    const mover = i % 2 === 0 ? 'w' : 'b'; const before = res[i].score; const after = -res[i + 1].score;
    const pos = new Pos(fens[i]); const bestSan = res[i].best ? pos.uciToSan(res[i].best) : null;
    const isBest = bestSan && bestSan === game.moves[i];
    const q = moveQuality(before, after, isBest);
    const rec = { ply: i, mover, san: game.moves[i], fen: fens[i], before, after, loss: q.loss, quality: q.label, bestSan, bestPv: pvToSan(fens[i], res[i].pv, 8), refPv: pvToSan(fens[i + 1], res[i + 1].pv, 6) };
    rows.push(rec);
  }
  // attach clock data to my moves
  const mine = rows.filter(r => r.mover === game.color);
  mine.forEach((r, k) => { const c = game.clock[k]; if (c) Object.assign(r, c); r.decision = decisionQuality(r.quality, r.think ?? 5, r.clockBefore ?? 180); });
  // book / model information for opening-phase moves
  for (const r of mine) {
    if (r.ply > 30) continue; const e = bk[new Pos(r.fen).hash()]; if (!e) continue;
    const nx = Object.entries(e[1]); const mineTop = nx.filter(x => x[1][0] > 0).sort((a, b) => b[1][0] - a[1][0])[0]; const modelTop = nx.filter(x => x[1][2] > 0).sort((a, b) => b[1][2] - a[1][2])[0];
    r.book = { inBook: nx.some(x => x[0] === r.san && (x[1][0] + x[1][2]) > 0), myUsual: mineTop ? [mineTop[0], mineTop[1][0]] : null, model: modelTop ? [modelTop[0], modelTop[1][2]] : null, total: nx.reduce((s, x) => s + x[1][2], 0) };
  }
  return { rows, mine, fam, fens, evals: res.map((x, i) => (i % 2 === 0 ? x.score : -x.score)) };
}

// Named findings. Each finding references plies so the UI can offer REDO / REPAIR / CALCULATE.
export async function diagnose(game, A) {
  const mine = A.mine; const F = {};
  const errors = mine.filter(r => isError(r.quality));
  F.firstError = mine.find(r => isError(r.quality)) || null;
  F.biggest = mine.slice().sort((a, b) => b.loss - a.loss)[0]; if (F.biggest && F.biggest.loss < THRESHOLDS.inaccuracy) F.biggest = null;
  F.impulsive = mine.filter(r => (isError(r.quality) || r.quality === 'inaccuracy') && r.think != null && r.think < THRESHOLDS.fastSec);
  F.overthinks = mine.filter(r => r.decision === 'slow' || (r.think != null && (r.think >= THRESHOLDS.overthinkSec || (r.clockBefore && r.think >= r.clockBefore * THRESHOLDS.overthinkShare && r.think >= 8))));
  const forcing = s => /x|\+|#/.test(s || '');
  F.tactical = errors.filter(r => forcing(r.bestSan) && r.before >= 120);
  F.defensive = errors.filter(r => forcing(r.refPv[0]) && !F.tactical.includes(r));
  F.repertoire = mine.filter(r => r.book && !r.book.inBook && r.loss >= THRESHOLDS.good && r.ply <= 30);
  F.modelChances = mine.filter(r => r.book && r.book.model && r.book.model[1] >= 3 && r.book.model[0] !== r.san && r.loss >= THRESHOLDS.strong);
  F.conversion = mine.filter(r => r.before >= 250 && r.loss >= THRESHOLDS.good);
  // recurring: position already in Repair, or same kind of error as recent games
  const rep = new Map((await srs.items()).map(x => [x.payload ? new Pos(x.payload.fen).hash() : null, x]));
  F.recurring = errors.filter(r => rep.has(new Pos(r.fen).hash()));
  const t = mine.filter(r => r.think != null);
  F.metrics = {
    moves: mine.length, errors: errors.length, blunders: mine.filter(r => r.quality === 'blunder').length,
    avgThink: avg(t.map(r => r.think)), thinkGood: avg(t.filter(r => isSound(r.quality)).map(r => r.think)), thinkErrors: avg(t.filter(r => isError(r.quality)).map(r => r.think)),
    clockEnd: game.clockEnd, decision: countBy(mine, r => r.decision), quality: countBy(mine, r => r.quality),
    impulsive: F.impulsive.length, overthinks: F.overthinks.length, accuracyPct: Math.round(mine.filter(r => isSound(r.quality)).length / Math.max(1, mine.length) * 100),
  };
  F.issue = mainIssue(F);
  return F;
}
const avg = xs => (xs.length ? +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1) : null);
const countBy = (xs, f) => xs.reduce((o, x) => { const k = f(x); o[k] = (o[k] || 0) + 1; return o; }, {});
function mainIssue(F) {
  if (F.impulsive.length >= 2) return `Moving too quickly: ${F.impulsive.length} errors made in under ${THRESHOLDS.fastSec} seconds.`;
  if (F.defensive.length >= 2) return `Missing the opponent's threats: ${F.defensive.length} errors allowed a forcing reply.`;
  if (F.tactical.length >= 1) return `A tactic went unseen: ${F.tactical.map(r => r.bestSan).join(', ')}.`;
  if (F.conversion.length) return `Winning positions slipped: ${F.conversion.length} move${F.conversion.length > 1 ? 's' : ''} gave back a winning advantage.`;
  if (F.overthinks.length >= 2) return `Clock: ${F.overthinks.length} long thinks — time that was later missing.`;
  if (F.repertoire.length) return `Left the repertoire early with ${F.repertoire[0].san}.`;
  if (F.firstError) return `One costly moment: ${F.firstError.san}.`;
  return 'A clean game — no serious errors.';
}

// Blitz errors become Repair items (position + Stockfish answer), never silently lost.
export async function toRepair(game, A, F) {
  const added = [];
  for (const r of A.mine.filter(x => isError(x.quality))) {
    const id = 'move:blitz:' + new Pos(r.fen).hash();
    const reason = F.impulsive.includes(r) ? `Blitz: ${r.san} in ${r.think.toFixed(1)}s — ${MOVE_LABEL[r.quality].toLowerCase()}` : `Blitz: ${r.san} was a ${MOVE_LABEL[r.quality].toLowerCase()}`;
    await srs.add(srs.newItem({ id, kind: 'move', fam: A.fam, reason, source: 'blitz', payload: { fen: r.fen, col: game.color, fam: A.fam, played: r.san, sfBest: r.bestSan, good: [r.bestSan], cpBest: r.before, cpPlayed: r.after, pvBest: r.bestPv, pvRef: [r.san, ...r.refPv], loss: r.loss, verdict: 'mistake' } }));
    added.push(id);
  }
  return added;
}

// Diagnostic conclusions for PROGRESS. Pure functions over stored history. Each rule has an
// explicit minimum sample; when the evidence is not there, nothing is said.
import { isSound, THRESHOLDS } from './quality.js';
import { FAMILY } from '../repertoire/families.js';

export const MIN = { blitzMoves: 30, calc: 8, family: 6, trend: 5 };
const pctOf = xs => (xs.length ? Math.round(xs.filter(Boolean).length / xs.length * 100) : null);
const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function blitzMoves(blitz) { return blitz.filter(g => g.analysis).flatMap(g => g.analysis.mine.map(r => ({ ...r, fam: g.analysis.fam, gid: g.id }))); }

export function reliableDepth(calc) {
  const out = [];
  for (let k = 1; k <= 9; k++) { const pool = calc.filter(a => (a.required || 0) >= k); if (pool.length < MIN.calc) continue; out.push({ k, n: pool.length, rate: pool.filter(a => (a.depth || 0) >= k).length / pool.length }); }
  let reliable = 0; for (const x of out) if (x.rate >= 0.7) reliable = x.k; else break;
  return { reliable, curve: out };
}

export function insights({ attempts, blitz }) {
  const out = []; const moves = blitzMoves(blitz);
  // 1. speed vs accuracy in blitz
  const timed = moves.filter(r => r.think != null);
  const fast = timed.filter(r => r.think < THRESHOLDS.fastSec), slow = timed.filter(r => r.think >= THRESHOLDS.fastSec);
  if (fast.length >= MIN.blitzMoves && slow.length >= MIN.blitzMoves) {
    const a = pctOf(fast.map(r => isSound(r.quality))), b = pctOf(slow.map(r => isSound(r.quality)));
    if (b - a >= 12) out.push({ text: `You are significantly less accurate when moving in under ${THRESHOLDS.fastSec} seconds.`, detail: `${a}% sound (${fast.length} moves) vs ${b}% (${slow.length} moves)`, weight: b - a });
    else if (a - b >= 12) out.push({ text: 'Your quick moves are your good moves — hesitation is where errors come from.', detail: `${a}% sound under ${THRESHOLDS.fastSec}s (${fast.length}) vs ${b}% (${slow.length})`, weight: a - b });
  }
  // 2. calculation depth
  const calc = attempts.filter(a => a.mode === 'calc');
  const rd = reliableDepth(calc);
  if (rd.reliable && rd.curve.length) {
    const beyond = rd.curve.find(x => x.k >= rd.reliable + 2);
    if (beyond && beyond.rate <= 0.45) out.push({ text: `Your calculation is reliable through ${rd.reliable} plies but declines sharply beyond ${rd.reliable + 1}.`, detail: `${Math.round(beyond.rate * 100)}% accurate at ${beyond.k} plies (${beyond.n} attempts)`, weight: 20 });
  }
  // 3. per family: plans vs calculation
  for (const f of Object.keys(FAMILY)) {
    const pl = attempts.filter(a => a.mode === 'plan' && a.fam === f), ca = calc.filter(a => a.fam === f);
    if (pl.length >= MIN.family && ca.length >= MIN.family) { const p = pctOf(pl.map(a => a.ok)), c = pctOf(ca.map(a => a.ok)); if (p - c >= 25) out.push({ text: `Your ${FAMILY[f].name} plan recognition is strong, but your calculation in these positions is weaker.`, detail: `plans ${p}% (${pl.length}) · calculation ${c}% (${ca.length})`, weight: p - c }); }
    // 4. blitz error types per family
    const fm = moves.filter(r => r.fam === f && (r.quality === 'mistake' || r.quality === 'blunder'));
    const def = fm.filter(r => /x|\+|#/.test((r.refPv || [])[0] || '')).length; const rep = moves.filter(r => r.fam === f && r.book && !r.book.inBook && r.loss >= THRESHOLDS.good).length;
    if (def >= 4 && def >= rep * 2) out.push({ text: `Your ${FAMILY[f].name} positions produce more defensive errors than opening-memory errors.`, detail: `${def} errors allowed a forcing reply · ${rep} repertoire exits`, weight: def });
  }
  // 5. repertoire exits after the same opponent move
  const exits = {};
  for (const g of blitz.filter(x => x.analysis)) for (const r of g.analysis.mine.filter(r => r.book && !r.book.inBook && r.loss >= THRESHOLDS.good)) { const prev = g.moves[r.ply - 1]; if (!prev) continue; const k = `${g.analysis.fam}|${prev}`; exits[k] = (exits[k] || 0) + 1; }
  for (const [k, n] of Object.entries(exits)) if (n >= 3) { const [f, mv] = k.split('|'); out.push({ text: `You repeatedly leave your ${FAMILY[f] ? FAMILY[f].name : ''} repertoire after …${mv}.`.replace('……', '…'), detail: `${n} blitz games`, weight: n * 5 }); }
  // 6. impulsive decisions in training
  const dec = attempts.filter(a => (a.mode === 'decision' || a.mode === 'plan' || a.mode === 'repair') && a.sec != null);
  const wrongFast = dec.filter(a => !a.ok && a.sec < 4), wrong = dec.filter(a => !a.ok);
  if (wrong.length >= 10 && wrongFast.length / wrong.length >= 0.5) out.push({ text: 'Half of your wrong answers in training come in under four seconds.', detail: `${wrongFast.length} of ${wrong.length} wrong answers`, weight: 15 });
  return out.sort((a, b) => b.weight - a.weight);
}

// Trend: value this 30-day window vs the previous one.
export function trend(rows, f, days = 30) {
  const now = Date.now(), d = days * 864e5; const cur = rows.filter(r => r.t >= now - d), prev = rows.filter(r => r.t < now - d && r.t >= now - 2 * d);
  const a = avg(cur.map(f).filter(x => x != null)), b = avg(prev.map(f).filter(x => x != null));
  return { cur: a, prev: b, n: cur.length, delta: a != null && b != null && prev.length >= MIN.trend && cur.length >= MIN.trend ? a - b : null };
}

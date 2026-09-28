// Move quality (objective, engine-based) and decision quality (practical, time-aware) are
// separate concepts. Time never changes an evaluation; it only changes the decision label.
// All thresholds live here so they can be tuned in one place.

export const THRESHOLDS = {
  // win-probability loss (percentage points) for MOVE QUALITY
  best: 1.0, strong: 3.5, good: 7, inaccuracy: 12, mistake: 22, // >= mistake band upper => blunder
  // DECISION QUALITY (3+2 context)
  fastSec: 3,           // "impulsive" if an error is made faster than this
  quickGoodSec: 8,      // a good move this fast is an excellent practical decision
  overthinkSec: 20,     // absolute think time that counts as an overthink…
  overthinkShare: 0.12, // …or this share of remaining clock
  lowClockSec: 20,      // below this remaining time, practical moves are judged leniently
  // analysis budgets (Stockfish)
  fast: { depth: 12, movetime: 350 },
  deep: { depth: 18, movetime: 2500 },
  review: { depth: 14, movetime: 900 },
};

export const MATE = 100000;
// Engine line score -> centipawns from the side to move's perspective (mate folded in).
export function lineCp(l) { if (!l) return 0; if (l.mate != null) return l.mate > 0 ? MATE - l.mate * 10 : -MATE - l.mate * 10; return l.cp; }
export function winPct(cp) { const c = Math.max(-2000, Math.min(2000, cp)); return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1); }
export function fmtEval(cp, stmIsWhite = true) {
  if (cp == null) return '—';
  const w = stmIsWhite ? cp : -cp;
  if (Math.abs(w) >= MATE - 1000) { const n = Math.round((MATE - Math.abs(w)) / 10); return (w > 0 ? '#' : '#-') + n; }
  return (w >= 0 ? '+' : '−') + (Math.abs(w) / 100).toFixed(1);
}

export const MOVE_LABEL = { best: 'Best', strong: 'Strong', good: 'Good', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder' };
// before/after are centipawns for the MOVER (before = best line eval, after = eval of the move played).
export function moveQuality(beforeCp, afterCp, isEngineBest) {
  const loss = Math.max(0, winPct(beforeCp) - winPct(afterCp));
  let label;
  if (isEngineBest || loss <= THRESHOLDS.best) label = 'best';
  else if (loss <= THRESHOLDS.strong) label = 'strong';
  else if (loss <= THRESHOLDS.good) label = 'good';
  else if (loss <= THRESHOLDS.inaccuracy) label = 'inaccuracy';
  else if (loss <= THRESHOLDS.mistake) label = 'mistake';
  else label = 'blunder';
  return { label, loss: +loss.toFixed(1) };
}
export const isError = q => q === 'mistake' || q === 'blunder';
export const isSound = q => q === 'best' || q === 'strong' || q === 'good';

// Decision quality in blitz context. thinkSec = time spent; clockBefore = seconds left before the move.
export const DECISION_LABEL = { excellent: 'Excellent decision', practical: 'Practical', slow: 'Overthought', rushed: 'Impulsive', costly: 'Costly', error: 'Error' };
export function decisionQuality(q, thinkSec, clockBefore) {
  const over = thinkSec >= THRESHOLDS.overthinkSec || (clockBefore > 0 && thinkSec >= clockBefore * THRESHOLDS.overthinkShare && thinkSec >= 8);
  if (isSound(q)) {
    if (over) return 'slow';
    if (thinkSec <= THRESHOLDS.quickGoodSec || q === 'best') return 'excellent';
    return 'practical';
  }
  if (q === 'inaccuracy') return clockBefore < THRESHOLDS.lowClockSec && thinkSec <= THRESHOLDS.fastSec ? 'practical' : over ? 'slow' : 'costly';
  if (thinkSec < THRESHOLDS.fastSec) return 'rushed';
  return 'error';
}

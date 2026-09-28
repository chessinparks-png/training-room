// Board features used by pattern discovery, structure matching and vision questions.
import { BL, P, K, sqName } from './core.js';

const FILES = 'abcdefgh';

// Pawn-only structure key (both colours) + side to move. Positions sharing it are
// "strategically comparable" even when pieces differ.
export function pawnKey(pos) {
  let s = ''; for (let r = 7; r >= 0; r--) for (let f = 0; f < 8; f++) { const p = pos.b[r * 16 + f]; s += (p & 7) === P ? (p & BL ? 'p' : 'P') : '.'; }
  return compressRuns(s) + (pos.turn ? 'b' : 'w');
}
function compressRuns(s) { return s.replace(/\.{2,}/g, m => m.length.toString(36)); }

export function pieces(pos, color) { // color 0 | BL
  const out = []; for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const p = pos.b[s]; if (p && (p & BL) === color) out.push({ sq: s, t: p & 7 }); }
  return out;
}
export function materialPts(pos, color) { const V = [0, 1, 3, 3, 5, 9, 0]; return pieces(pos, color).reduce((a, x) => a + V[x.t], 0); }
export function balance(pos, color) { return materialPts(pos, color) - materialPts(pos, color ^ BL); }

export function fileState(pos, f) {
  let w = 0, b = 0; for (let r = 0; r < 8; r++) { const p = pos.b[r * 16 + f]; if ((p & 7) === P) { if (p & BL) b++; else w++; } }
  return !w && !b ? 'open' : !w ? 'half-open (White)' : !b ? 'half-open (Black)' : 'closed';
}
export function openFiles(pos) { const o = []; for (let f = 0; f < 8; f++) if (fileState(pos, f) === 'open') o.push(FILES[f]); return o; }
export function isolatedPawns(pos, color) {
  const has = f => { for (let r = 0; r < 8; r++) { const p = pos.b[r * 16 + f]; if ((p & 7) === P && (p & BL) === color) return true; } return false; };
  const out = [];
  for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const p = pos.b[s]; if ((p & 7) !== P || (p & BL) !== color) continue; const f = s & 7; if (!(f > 0 && has(f - 1)) && !(f < 7 && has(f + 1))) out.push(sqName(s)); }
  return out;
}
export function attackedPieces(pos, color) { return pieces(pos, color).filter(x => x.t !== K && pos.attackers(x.sq, color ^ BL).length).map(x => ({ sq: sqName(x.sq), t: x.t })); }
// Squares attacked by a piece standing on `from` (0x88), given current occupancy.
export function attacksFrom(pos, from) { const out = []; for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } if (s !== from && pos.pieceAttacks(from, s)) out.push(s); } return out; }
export { FILES };

// My games vs model games: identical positions, comparable pawn structures, and tension.
// Only produces claims with sample sizes attached; weak evidence is labelled as such.
import { Pos, BL, P, mFrom, mTo, mFlag, F_CASTLE, F_EP } from '../chess/core.js';
import { pawnKey } from '../chess/features.js';
import { FREQ } from './families.js';

export function moveKind(pos, m) {
  const f = mFrom(m), t = mTo(m), p = pos.b[f], type = p & 7, me = p & BL; const cap = pos.b[t] || mFlag(m) === F_EP;
  if (mFlag(m) === F_CASTLE) return 'castle';
  if (type === P && cap) return (pos.b[t] & 7) === P || mFlag(m) === F_EP ? 'pawn exchange' : 'capture';
  if (cap) return 'capture';
  if (type === P) {
    const up = me ? -16 : 16, enemy = (me ^ BL) | P;
    for (const o of [-1, 1]) { const a = t + up + o; if (!(a & 0x88) && pos.b[a] === enemy) return 'pawn break'; }
    for (const o of [-1, 1]) { const a = t - up + o; if (!(a & 0x88) && pos.b[a] === enemy) return 'pawn break'; }
    return 'pawn move';
  }
  return 'piece move';
}
export function hasCentralTension(pos, me) {
  const up = me ? -16 : 16, enemy = (me ^ BL) | P, mine = me | P;
  for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } if (pos.b[s] !== mine) continue; const f = s & 7; if (f < 2 || f > 5) continue; for (const o of [-1, 1]) { const a = s + up + o; if (!(a & 0x88) && pos.b[a] === enemy) return true; } }
  return false;
}

// Walks games and indexes positions at the player's turn up to maxPly.
// Returns Map hash -> {fen, n, games:[id], next:{san:n}, kinds:{kind:n}, tension:bool}
export function indexPlayerPositions(games, { maxPly = 30, pawn = false } = {}) {
  const idx = new Map();
  for (const g of games) {
    const mv = Array.isArray(g.moves) ? g.moves : (g.moves ? g.moves.split(' ') : []);
    const pos = new Pos(); const me = g.pc === 'b' ? BL : 0;
    for (let i = 0; i < mv.length && i < maxPly; i++) {
      const m = pos.parseSan(mv[i]); if (!m) break;
      if (pos.turn === me && i >= 4) {
        const key = pawn ? pawnKey(pos) : pos.hash();
        let e = idx.get(key); if (!e) idx.set(key, e = { fen: pos.fen(false), n: 0, games: [], next: {}, kinds: {}, tension: hasCentralTension(pos, me), ply: i });
        e.n++; if (e.games.length < 12) e.games.push(g.id);
        const san = pos.san(m); e.next[san] = (e.next[san] || 0) + 1; const k = moveKind(pos, m); e.kinds[k] = (e.kinds[k] || 0) + 1;
      }
      pos.make(m);
    }
  }
  return idx;
}

const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]);
export function evidence(n) { return n >= 15 ? 'solid' : n >= 6 ? 'moderate' : 'weak'; }

// Shared exact positions (transpositions included, since keys are positions not move orders).
export function sharedPositions(mine, model, { minMine = 2, minModel = 3, limit = 40 } = {}) {
  const out = [];
  for (const [k, a] of mine) {
    const b = model.get(k); if (!b || a.n < minMine || b.n < minModel) continue;
    const [myTop, myTopN] = top(a.next)[0]; const [moTop, moTopN] = top(b.next)[0];
    out.push({ hash: k, fen: a.fen, ply: a.ply, mine: { n: a.n, top: myTop, topN: myTopN, next: a.next, games: a.games }, model: { n: b.n, top: moTop, topN: moTopN, next: b.next, games: b.games }, differ: myTop !== moTop });
  }
  out.sort((x, y) => (y.differ - x.differ) || (Math.min(y.mine.n, y.model.n) - Math.min(x.mine.n, x.model.n)));
  return out.slice(0, limit);
}

// Comparable structures: same pawn skeleton + side to move. Compares move kinds.
export function sharedStructures(mineP, modelP, { minMine = 3, minModel = 8, limit = 20 } = {}) {
  const out = [];
  for (const [k, a] of mineP) {
    const b = modelP.get(k); if (!b || a.n < minMine || b.n < minModel) continue;
    out.push({ key: k, fen: b.fen, mine: { n: a.n, kinds: a.kinds, games: a.games, next: a.next }, model: { n: b.n, kinds: b.kinds, games: b.games, next: b.next }, tension: a.tension || b.tension });
  }
  out.sort((x, y) => Math.min(y.mine.n, y.model.n / 3) - Math.min(x.mine.n, x.model.n / 3));
  return out.slice(0, limit);
}

// Turns structure comparisons into short, evidence-labelled statements. Nothing is claimed
// unless both samples reach the minimum and the difference is large.
export function structureClaims(structs, modelName) {
  const claims = [];
  let myT = { n: 0, ex: 0 }, moT = { n: 0, ex: 0 };
  for (const s of structs) {
    if (!s.tension) continue;
    myT.n += s.mine.n; myT.ex += s.mine.kinds['pawn exchange'] || 0;
    moT.n += s.model.n; moT.ex += s.model.kinds['pawn exchange'] || 0;
  }
  if (myT.n >= FREQ.MIN_CLAIM * 2 && moT.n >= 10) {
    const a = myT.ex / myT.n, b = moT.ex / moT.n;
    if (Math.abs(a - b) >= 0.2) claims.push({
      kind: 'tension', text: a > b ? `You release central pawn tension more often than ${modelName} in the same structures.` : `${modelName} releases central tension more often than you in the same structures.`,
      mine: `${myT.ex}/${myT.n} positions exchanged`, model: `${moT.ex}/${moT.n} positions exchanged`, evidence: evidence(Math.min(myT.n, moT.n)),
    });
  }
  return claims;
}

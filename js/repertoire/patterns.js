// Pattern discovery from real games. Every event carries (gameId, ply) so any claim built
// from it is traceable to the source game. Shared by the Node build and the import worker.
import { Pos, BL, P, N, R, K, sqName, mFrom, mTo, mFlag, F_CASTLE, F_EP } from '../chess/core.js';
import { balance, attacksFrom } from '../chess/features.js';
import { freqLabel, FREQ } from './families.js';

const PL = ' PNBRQK';
const TRADES = new Set(['trade:BxN', 'trade:NxB', 'trade:BxB', 'trade:NxN', 'trade:RxR', 'trade:QxQ']);
const FILES = 'abcdefgh';


// Plan vocabulary for "What's the plan?". Derived only from observed events.
export function planOf(ev, color) {
  const file = ev.to ? ev.to[0] : null;
  switch (ev.type) {
    case 'break':
      if ('de'.includes(file)) return 'Central break';
      if (file === 'c') return 'Queenside break (c-pawn)';
      if ('ab'.includes(file)) return 'Queenside expansion';
      if (file === 'f') return 'f-pawn break';
      return 'Kingside pawn storm';
    case 'storm': return 'ab'.includes(file) ? 'Queenside expansion' : 'Kingside pawn storm';
    case 'route': return 'Reroute a piece';
    case 'trade': return ev.key === 'trade:QxQ' ? 'Simplify (queen trade)' : 'Exchange a key piece';
    case 'castle': return ev.key === 'castle:O-O-O' ? 'Castle long' : 'Complete development / castle';
    case 'sac': return 'Sacrifice for the initiative';
    case 'prophylaxis': return 'Prophylaxis';
    default: return null;
  }
}
export const PLAN_OPTIONS = ['Central break', 'Queenside break (c-pawn)', 'Queenside expansion', 'f-pawn break', 'Kingside pawn storm',
  'Reroute a piece', 'Exchange a key piece', 'Simplify (queen trade)', 'Maintain tension', 'Prophylaxis', 'Complete development / castle', 'Castle long', 'Sacrifice for the initiative'];

function pawnContact(pos, s, color) {
  // does the pawn on s (of color) attack an enemy pawn, or is it attacked by one?
  const up = color ? -16 : 16, enemy = (color ^ BL) | P;
  for (const o of [-1, 1]) { const a = s + up + o; if (!(a & 0x88) && pos.b[a] === enemy) return true; const d = s - up + o; if (!(d & 0x88) && pos.b[d] === enemy) return true; }
  return false;
}

// Extracts events for the side `pc` ('w'|'b') from a SAN move list.
// Returns { events:[{ply,type,key,to,san}], tension:{moments,resolved}, plies }
export function gameEvents(moves, pc, { maxPly = 60 } = {}) {
  const pos = new Pos(); const me = pc === 'b' ? BL : 0; const events = []; const seen = new Set();
  const lastKnightMove = {}; // square -> {from, ownIdx}
  let ownIdx = 0; const tension = { moments: 0, resolved: 0 }; const counted = new Set();
  const matHist = []; const sanList = [];
  for (let i = 0; i < moves.length && i < maxPly + 8; i++) {
    const m = pos.parseSan(moves[i]); if (!m) break;
    matHist.push(balance(pos, me));
    const mine = (pos.turn === me);
    const f = mFrom(m), t = mTo(m), pc0 = pos.b[f], type = pc0 & 7; const cap = pos.b[t] || (mFlag(m) === F_EP ? (P | (me ^ BL)) : 0);
    const san = pos.san(m); sanList.push(san);
    const push = (typ, key, extra) => { if (i >= maxPly) return; if (seen.has(key)) return; seen.add(key); events.push({ ply: i + 1, type: typ, key, san, to: sqName(t), from: sqName(f), ...extra }); };
    if (mine) {
      // central pawn tension: new tension pairs present before my move
      if (i < maxPly) for (const k of tensionPairs(pos, me)) if (!counted.has(k)) { counted.add(k); tension.moments++; if (type === P && cap && k.startsWith(sqName(f))) tension.resolved++; }
    }
    pos.make(m);
    if (mine) {
      ownIdx++;
      if (mFlag(m) === F_CASTLE) push('castle', 'castle:' + ((t & 7) === 6 ? 'O-O' : 'O-O-O'), { late: i + 1 > 24 });
      else if (type === P && !cap) {
        const to = sqName(t);
        if (pawnContact(pos, t, me)) push('break', 'break:' + to);
        else if ('abgh'.includes(to[0]) && ((me === 0 && +to[1] >= 4) || (me === BL && +to[1] <= 5))) {
          const kWing = (me ? pos.kw : pos.kb) & 7; const oppKingThere = 'gh'.includes(to[0]) ? kWing >= 5 : kWing <= 2;
          if (oppKingThere) push('storm', 'storm:' + to);
          else if ('ah'.includes(to[0]) && (+to[1] === 3 || +to[1] === 6)) push('prophylaxis', 'luft:' + to);
        } else if ('ah'.includes(to[0]) && (+to[1] === 3 || +to[1] === 6)) push('prophylaxis', 'luft:' + to);
      } else if (type !== P && type !== K && !cap) {
        push('place', 'place:' + PL[type] + sqName(t));
        if (type === N) {
          const prev = lastKnightMove[sqName(f)];
          if (prev && ownIdx - prev.idx <= 2) push('route', `route:N${prev.from}-${sqName(f)}-${sqName(t)}`);
          lastKnightMove[sqName(t)] = { from: sqName(f), idx: ownIdx };
        }
      } else if (type === K && !cap && i + 1 <= 40) {
        const to = sqName(t); if (['h1', 'h8', 'b1', 'b8'].includes(to)) push('prophylaxis', 'king:' + to);
      }
      // trades: my capture of a piece recaptured immediately on the same square
      if (cap && (cap & 7) !== P && i + 1 < moves.length) {
        const key = 'trade:' + PL[type] + 'x' + PL[cap & 7];
        const nm = pos.parseSan(moves[i + 1]); if (nm && mTo(nm) === t && TRADES.has(key)) push('trade', key);
      }
      // knight fork: knight now attacks two+ valuable enemy pieces (or king + piece)
      if (type === N) {
        const tg = attacksFrom(pos, t).map(s => pos.b[s]).filter(p => p && (p & BL) !== me && (p & 7) >= R);
        const kingHit = tg.some(p => (p & 7) === K);
        if (tg.length >= 2 && (kingHit || tg.filter(p => (p & 7) >= R).length >= 2)) push('motif', 'motif:knight fork');
      }
    }
  }
  // sacrifices: material (my perspective) drops by >=2 after my move and stays down 4 plies later
  for (let i = 0; i < matHist.length - 5; i++) {
    if ((i % 2 === 0) !== (pc === 'w')) continue; if (i >= maxPly) break;
    const before = matHist[i], after = Math.min(matHist[i + 3], matHist[i + 5]);
    const drop = before - after;
    if (drop >= 2 && matHist[i + 5] <= before - 2) {
      const kind = drop >= 3 ? 'piece' : 'exchange';
      const key = 'sac:' + kind; if (!seen.has(key)) { seen.add(key); events.push({ ply: i + 1, type: 'sac', key, san: sanList[i], to: null, note: kind }); }
    }
  }
  events.sort((a, b) => a.ply - b.ply);
  return { events, tension, plies: Math.min(moves.length, maxPly) };
}
function tensionPairs(pos, me) {
  // my pawn on c/d/e/f file that attacks an enemy pawn which also attacks it (mutual capture possible)
  const out = new Set(); const up = me ? -16 : 16, enemy = (me ^ BL) | P, mine = me | P;
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; } if (pos.b[s] !== mine) continue; const f = s & 7; if (f < 2 || f > 5) continue;
    for (const o of [-1, 1]) { const a = s + up + o; if (!(a & 0x88) && pos.b[a] === enemy) out.add(sqName(s) + sqName(a)); }
  }
  return out;
}

export function eventLabel(ev, pc) {
  const dots = pc === 'b' ? '…' : '';
  switch (ev.type) {
    case 'break': return `${dots}${ev.key.slice(6)} break`;
    case 'storm': return `${dots}${ev.key.slice(6)} pawn storm`;
    case 'place': { const x = ev.key.slice(6); return `${dots}${x[0]}${x.slice(1)} placement`; }
    case 'route': { const r = ev.key.slice(7); return `Knight route ${r.replace(/-/g, '–')}`; }
    case 'castle': return ev.key === 'castle:O-O' ? 'Short castling' : 'Long castling';
    case 'trade': return { 'trade:BxN': 'Bishop for knight', 'trade:NxB': 'Knight for bishop', 'trade:QxQ': 'Queen trade', 'trade:BxB': 'Bishop trade', 'trade:NxN': 'Knight trade', 'trade:RxR': 'Rook trade' }[ev.key] || ev.key.slice(6);
    case 'sac': return ev.key === 'sac:piece' ? 'Piece sacrifice' : 'Exchange / material sacrifice';
    case 'motif': return 'Knight fork';
    case 'prophylaxis': return ev.key.startsWith('king:') ? `King to ${ev.key.slice(5)}` : `${dots}${ev.key.slice(5)} (luft/prophylaxis)`;
    default: return ev.key;
  }
}
const TYPE_CAT = { break: 'PAWN BREAKS', storm: 'ATTACKING PATTERNS', sac: 'ATTACKING PATTERNS', place: 'PIECE PLACEMENTS', route: 'PIECE MANOEUVRES', trade: 'EXCHANGES', castle: 'STRUCTURAL PLANS', prophylaxis: 'STRUCTURAL PLANS', motif: 'TACTICAL MOTIFS' };

// Aggregates events over a set of games into a pattern library.
// games: [{id, moves, pc}] ; returns [{key,type,cat,label,k,n,freq,medianMove,examples:[{id,ply}]}]
export function discoverPatterns(games, { maxPly = 60, minK = FREQ.MIN_CLAIM } = {}) {
  const agg = new Map(); let n = 0; const tension = { moments: 0, resolved: 0, games: 0 };
  for (const g of games) {
    const mv = Array.isArray(g.moves) ? g.moves : g.moves.split(' ');
    if (mv.length < 16) continue; n++;
    const { events, tension: t } = gameEvents(mv, g.pc, { maxPly });
    tension.moments += t.moments; tension.resolved += t.resolved; if (t.moments) tension.games++;
    for (const e of events) {
      let a = agg.get(e.key); if (!a) agg.set(e.key, a = { key: e.key, type: e.type, plies: [], examples: [], label: eventLabel(e, g.pc) });
      a.plies.push(e.ply); if (a.examples.length < 40) a.examples.push({ id: g.id, ply: e.ply });
    }
  }
  const out = [];
  for (const a of agg.values()) {
    const k = a.plies.length; if (k < minK) continue;
    a.plies.sort((x, y) => x - y); const med = a.plies[a.plies.length >> 1];
    const freq = freqLabel(k, n); if (freq === 'occasional' && k / n < 0.08 && a.type === 'place') continue; // skip noise placements
    out.push({ key: a.key, type: a.type, cat: TYPE_CAT[a.type], label: a.label, k, n, rate: +(k / n).toFixed(3), freq, medianMove: Math.ceil(med / 2), examples: pickSpread(a.examples, 8) });
  }
  out.sort((x, y) => y.k - x.k);
  return { n, patterns: out, tension };
}
function pickSpread(arr, k) { if (arr.length <= k) return arr; const out = []; for (let i = 0; i < k; i++) out.push(arr[Math.floor(i * arr.length / k)]); return out; }

// Per-family derived intelligence. Shared by the Node build (tools/build-data.mjs) and the in-browser
// import worker, so an imported PGN is processed exactly like the bundled data.
import { Pos } from '../chess/core.js';
import { FAMILIES, MODEL_PLAYERS } from './families.js';
import { discoverPatterns } from './patterns.js';
import { indexPlayerPositions, sharedPositions, sharedStructures, structureClaims } from './compare.js';

export const score = gs => { const r = gs.filter(g => g.res != null); return r.length ? Math.round(r.reduce((a, g) => a + g.res, 0) / r.length * 100) : null; };
export const countBy = (gs, f) => gs.reduce((o, g) => { const k = f(g); if (k) o[k] = (o[k] || 0) + 1; return o; }, {});
const split = g => (g.moves ? g.moves.split(' ') : []);

export function mainline(gs, depth = 14) {
  const out = []; let cur = gs.filter(g => g.moves);
  for (let i = 0; i < depth; i++) {
    const c = {}; for (const g of cur) { const m = split(g)[i]; if (m) c[m] = (c[m] || 0) + 1; }
    const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; if (!top || top[1] < 2) break;
    out.push([top[0], top[1], cur.length]); cur = cur.filter(g => split(g)[i] === top[0]);
  }
  return out;
}
export function mineBlock(my) {
  const myFull = my.filter(g => g.conf === 'full');
  return { n: my.length, full: myFull.length, partial: my.length - myFull.length, withMoves: my.filter(g => g.moves).length, score: score(my),
    wdl: [my.filter(g => g.res === 1).length, my.filter(g => g.res === 0.5).length, my.filter(g => g.res === 0).length], subs: countBy(my, g => g.sub),
    avgPly: Math.round(my.reduce((a, g) => a + split(g).length, 0) / Math.max(1, my.length)),
    // My opening-phase patterns (legacy data is mostly opening prefixes; the horizon is capped honestly)
    patterns: discoverPatterns(my.filter(g => g.moves).map(g => ({ id: g.id, pc: g.pc, moves: g.moves })), { maxPly: 24 }), mainline: mainline(my) };
}
function withBoards(patterns, gs) {
  const byId = new Map(gs.map(g => [g.id, g]));
  for (const pt of patterns) { const ex = pt.examples[0]; const g = byId.get(ex.id); if (!g) continue; const mv = split(g); const p = new Pos(); for (let i = 0; i < ex.ply - 1; i++) p.play(mv[i]); pt.fen = p.fen(); pt.san = mv[ex.ply - 1]; pt.ply = ex.ply - 1; }
}
// Play-forward starts: the model's most frequent positions after the opening (ply 12–18, model to
// move), each with documented continuations from real games.
function starts(gs, my) {
  const cnt = new Map();
  for (const g of gs) { const mv = split(g); const p = new Pos(); for (let i = 0; i < Math.min(18, mv.length - 12); i++) { if (i >= 12 && (p.turn ? 'b' : 'w') === g.pc) { const h = p.hash(); let e = cnt.get(h); if (!e) cnt.set(h, e = { fen: p.fen(), n: 0, ply: i, games: [] }); e.n++; if (e.games.length < 4) e.games.push({ id: g.id, cont: mv.slice(i, i + 14), opp: g.opp, date: g.date }); } p.play(mv[i]); } }
  const mineH = new Set(); for (const g of my) { const p = new Pos(); for (const s of split(g)) { mineH.add(p.hash()); if (!p.play(s)) break; } }
  return [...cnt.values()].filter(e => e.n >= 3).sort((a, b) => b.n - a.n).slice(0, 10).map(e => ({ ...e, mine: mineH.has(new Pos(e.fen).hash()) }));
}
export function modelBlock(mp, gs, my, myIdx, myPawn) {
  const pat = discoverPatterns(gs, { maxPly: 60 }); const patOpening = discoverPatterns(gs, { maxPly: 24 });
  withBoards([...pat.patterns, ...patOpening.patterns], gs);
  const moIdx = indexPlayerPositions(gs, { maxPly: 40 }); const moPawn = indexPlayerPositions(gs, { maxPly: 40, pawn: true });
  const structs = sharedStructures(myPawn, moPawn); const dates = gs.map(g => g.date).sort();
  return { n: gs.length, score: score(gs), avgElo: Math.round(gs.reduce((a, g) => a + (g.elo || 0), 0) / gs.length), avgOppElo: Math.round(gs.reduce((a, g) => a + (g.oppElo || 0), 0) / gs.length),
    subs: countBy(gs, g => g.sub), tags: countBy((gs.flatMap(g => (g.tags || []).map(t => ({ t })))), x => x.t), patterns: pat, openingPatterns: patOpening,
    shared: sharedPositions(myIdx, moIdx), structures: structs, claims: structureClaims(structs, mp.short), dateRange: [dates[0], dates[dates.length - 1]], mainline: mainline(gs), starts: starts(gs, my) };
}
function hero(gs) {
  const cnt = new Map();
  for (const g of gs) { const mv = split(g); if (mv.length < 10) continue; const p = new Pos(); for (let i = 0; i < 10; i++) p.play(mv[i]); const k = p.fen(false); cnt.set(k, (cnt.get(k) || 0) + 1); }
  const top = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]; return top ? { fen: top[0] + ' 0 6', n: top[1] } : null;
}
// mine: all my games; modelsByPlayer: {playerId: games[]}; onLog optional.
export function deriveFamily(famId, mine, modelsByPlayer, { onLog } = {}) {
  const my = mine.filter(g => g.fam === famId);
  const F = { id: famId, mine: mineBlock(my), models: {} };
  const myIdx = indexPlayerPositions(my, { maxPly: 40 }); const myPawn = indexPlayerPositions(my, { maxPly: 40, pawn: true });
  const famModel = [];
  for (const mp of MODEL_PLAYERS) {
    const gs = (modelsByPlayer[mp.id] || []).filter(g => g.fam === famId); if (!gs.length) continue; famModel.push(...gs);
    F.models[mp.id] = modelBlock(mp, gs, my, myIdx, myPawn);
    onLog && onLog(famId, mp.id, 'games', gs.length, 'patterns', F.models[mp.id].patterns.patterns.length, 'shared', F.models[mp.id].shared.length);
  }
  F.hero = hero([...my, ...famModel]);
  return F;
}
export const FAMILY_IDS = FAMILIES.map(f => f.id);

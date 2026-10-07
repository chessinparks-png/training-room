// Repertoire source analysis (REPORT ONLY — no trees, no UI yet).
// Reads the model players' PGNs in raw/models/, recognises the three course structures from the
// moves actually played (js/repertoire/classifier.js for Jobava/KID; a …c6 + …d6 rule for
// Firouzja), merges transpositions by position, and measures how consistently the model player
// chose the same move at each decision point. Stockfish is used only as a sanity check.
//   node tools/build-repertoire.mjs [--sanity]
import fs from 'fs'; import path from 'path';
import { splitGames, parseHeaders, movetextTokens, normalizeMoves, chesscomId } from '../js/data/pgn.js';
import { Pos } from '../js/chess/core.js';
import { classify, setupEvents } from '../js/repertoire/classifier.js';
import { discoverPatterns } from '../js/repertoire/patterns.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PLIES = 24; // the first 12 moves of each side are the repertoire zone
const fen4 = p => p.fen().split(' ').slice(0, 4).join(' ');
const base = tc => +(String(tc).split('+')[0]) || 0;

function load(file, handle, color) {
  const out = []; const seen = new Set(); let total = 0, asColor = 0;
  for (const raw of splitGames(fs.readFileSync(path.join(ROOT, 'raw/models', file), 'utf8'))) {
    total++; const h = parseHeaders(raw); const side = (h.White || '').toLowerCase() === handle ? 'w' : (h.Black || '').toLowerCase() === handle ? 'b' : null;
    if (side !== color) continue; asColor++;
    const id = chesscomId(h) || raw.slice(0, 200); if (seen.has(id)) continue; seen.add(id);
    const n = normalizeMoves(movetextTokens(raw).sans, null, 40); if (!n.moves.length) continue;
    const r = h.Result; const res = r === '1/2-1/2' ? 0.5 : (r === '1-0') === (color === 'w') ? 1 : 0;
    out.push({ id, pc: color, tc: h.TimeControl || '', blitz: base(h.TimeControl) >= 180, moves: n.moves, res, date: (h.UTCDate || '').replace(/\./g, '-'), link: h.Link || '', opp: color === 'w' ? h.Black : h.White, oppElo: +(color === 'w' ? h.BlackElo : h.WhiteElo) || 0 });
  }
  return { total, asColor, games: out };
}

// Firouzja rule: Black pushes …c7-c6 and …d7-d6 within his first six moves, in either order.
function c6d6(moves) {
  const p = new Pos(); let c6 = 0, d6 = 0;
  for (let i = 0; i < Math.min(12, moves.length); i++) { const san = moves[i]; if (i % 2 === 1) { if (san === 'c6') c6 = i + 1; if (san === 'd6') d6 = i + 1; } if (!p.play(san)) break; }
  return c6 && d6 ? { c6, d6 } : null;
}

// Position statistics with transpositions merged: model decisions (model to move) and opponent replies.
function tree(games, color) {
  const node = new Map(); // fen4 -> { n, model: {san:n}, opp: {san:n}, ply, orders:Set }
  for (const g of games) {
    const p = new Pos(); const path_ = [];
    for (let i = 0; i < Math.min(PLIES, g.moves.length); i++) {
      const k = fen4(p); let x = node.get(k); if (!x) node.set(k, x = { k, n: 0, model: {}, opp: {}, ply: i, orders: new Set() });
      x.n++; x.orders.add(path_.join(' ')); const san = g.moves[i]; const mine = (i % 2 === 0) === (color === 'w');
      (mine ? x.model : x.opp)[san] = ((mine ? x.model : x.opp)[san] || 0) + 1;
      path_.push(san); if (!p.play(san)) break;
    }
  }
  return node;
}
const top = (o, n = 4) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
const share = o => { const t = Object.values(o).reduce((a, b) => a + b, 0); const [m, c] = top(o, 1)[0] || [null, 0]; return { move: m, n: c, of: t, share: t ? c / t : 0 }; };
const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
const fmt = (o, tot, n = 5) => top(o, n).map(([m, c]) => `${m} ${pct(c, tot)}%`).join(', ');

// Decision points: model to move, reached in ≥ minN games; consistent if one move ≥ 60%.
function decisions(node, color, minN) {
  const out = [];
  for (const x of node.values()) { const mine = (x.ply % 2 === 0) === (color === 'w'); if (!mine || x.n < minN) continue; const s = share(x.model); out.push({ ...x, ...s, consistent: s.share >= 0.6 }); }
  return out.sort((a, b) => b.n - a.n);
}
function lineOf(games, k) { for (const g of games) { const p = new Pos(); for (let i = 0; i < PLIES && i < g.moves.length; i++) { if (fen4(p) === k) return g.moves.slice(0, i); p.play(g.moves[i]); } } return []; }
function san(moves) { return moves.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m}` : m)).join(' '); }

function course(title, games, color, { first, extra }) {
  const G = games; const N = G.length; const node = tree(G, color);
  console.log(`\n=== ${title}: ${N} qualifying games (blitz ${G.filter(g => g.blitz).length}, bullet ${G.filter(g => !g.blitz).length}) · score ${pct(G.reduce((a, g) => a + g.res, 0), N)}%`);
  first(G, node);
  for (const [label, minN] of [['≥ 20 games', 20], ['≥ 10 games', 10], ['≥ 5 games', 5]]) {
    const D = decisions(node, color, minN); const c = D.filter(d => d.consistent);
    console.log(`decision points reached in ${label}: ${D.length} · with one clear main move (≥60%): ${c.length} · median share ${D.length ? Math.round(D.map(d => d.share).sort((a, b) => a - b)[D.length >> 1] * 100) : 0}%`);
  }
  const D10 = decisions(node, color, 10);
  console.log('most-reached decision points (model to move):');
  for (const d of D10.slice(0, 14)) console.log(`  [${String(d.n).padStart(5)}] ${san(lineOf(G, d.k)).padEnd(46)} → ${fmt(d.model, d.of, 4)}${d.orders.size > 1 ? `   (${d.orders.size} move orders)` : ''}`);
  const tr = D10.filter(d => d.orders.size >= 2 && d.ply >= 4).map(d => ({ ...d, alt: d.orders.size })).sort((a, b) => b.n - a.n).slice(0, 6);
  console.log('transpositions (same position, several move orders):'); for (const d of tr) console.log(`  [${d.n}] ${san(lineOf(G, d.k))} — ${d.alt} orders`);
  const split = D10.filter(d => !d.consistent && d.n >= 20).slice(0, 6);
  console.log('split decisions (no move ≥ 60%):'); for (const d of split) console.log(`  [${d.n}] ${san(lineOf(G, d.k))} → ${fmt(d.model, d.of, 3)}`);
  const P = discoverPatterns(G.filter(g => g.blitz).map(g => ({ ...g, moves: g.moves })), { maxPly: 40 });
  const pick = (types, n) => P.patterns.filter(p => types.includes(p.type)).slice(0, n).map(p => `${p.label} ${Math.round(p.rate * 100)}% (~move ${p.medianMove})`).join(' · ');
  console.log('recurring plans (breaks/storms/routes):', pick(['break', 'storm', 'route'], 8));
  console.log('recurring placements:', pick(['place', 'castle'], 8));
  console.log('recurring trades/sacrifices:', pick(['trade', 'sac'], 6));
  extra && extra(G, node);
  return { node, D10 };
}

const firstMoves = (G, plies, label) => { const c = {}; for (const g of G) { const k = g.moves.slice(0, plies).join(' '); c[k] = (c[k] || 0) + 1; } console.log(`${label}: ${top(c, 8).map(([k, n]) => `${k} ${pct(n, G.length)}%`).join(' · ')}`); };
const evAll = (G, key, plies) => G.filter(g => { const e = setupEvents(g.moves, plies); return e[key] != null; }).length;
const sanWithin = (G, re, plyFrom, plyTo, color) => G.filter(g => g.moves.slice(plyFrom, plyTo).some((m, i) => ((plyFrom + i) % 2 === 1) === (color === 'b') && re.test(m))).length;


// ---------- V1 courses (blitz only) → data/courses.json ----------
const IDEA = {
  jobava: { d4: 'The Jobava starts as a queen’s pawn game.', Nc3: 'Nc3 before c4 or e4: the knight supports e4 and eyes b5.', Bf4: 'The second Jobava piece: the bishop aims at c7, with Nb5 ideas.',
    e3: 'Solid: e3 supports d4 and frees the f1-bishop.', Nf3: 'Develop and control e5; Ne5 often follows.', Nb5: 'Nb5 hits c7, the recurring Jobava target.', Qxd4: 'Recapture with the queen and keep the f3-knight.',
    Qd3: 'The queen steps back and keeps an eye on the d-file and h7.', dxc5: 'Take on c5: Black spends a tempo winning the pawn back.', a3: 'A useful waiting move that stops …Bb4 and …Nb4.', Bd3: 'Develop towards the kingside.',
    h4: 'Gain kingside space, with h5 in mind.', h5: 'Keep gaining space and push the bishop back.', 'O-O': 'Castle: finish development before the centre opens.', c3: 'Block the check and keep the centre solid.',
    a4: 'a4 prepares b4 against the a5-bishop.', b4: 'Chase the bishop.', e4: 'The central break that opens the position.', Bg5: 'Pin the knight.', Ne5: 'The knight jumps to e5, its best square in this structure.', cxd3: 'Recapture towards the centre.', Nxg4: 'Take the bishop pair.' },
  kid: { Nf6: 'Flexible: the King’s Indian starts here.', g6: 'Prepare the fianchetto.', Bg7: 'The King’s Indian bishop.', d6: 'The King’s Indian pawn chain, preparing …e5.', 'O-O': 'Castle first; the breaks come next.',
    Na6: '…Na6: the knight heads for c5 after …e5 and leaves the c8-bishop free.', e5: '…e5: the main King’s Indian break.', Qe7: 'Support e5 and keep the pieces connected.', dxe5: 'Recapture and keep a pawn on e5.',
    Ng4: 'The knight jumps to g4 and hits the e3-bishop.', exd4: 'Release the tension and open the long diagonal.', Nxd5: 'Take the knight on d5.', Bg4: 'Pin the f3-knight before White consolidates.', Nc5: 'The a6-knight reaches c5 and hits e4.',
    Nh5: 'Clear the way for …f5.', f5: 'The kingside break.', h5: 'Stop White’s h-pawn advance.', c6: 'Cover d5 and b5 before …Na6.', a6: 'Prepare …b5 or …c5 against the Sämisch.', c5: 'Strike at d4 straight away.',
    b5: 'Queenside counterplay.', axb5: 'Recapture and open the a-file.', Nc6: 'Develop and add pressure on d4.', Bf5: 'Develop the bishop actively.', Ne4: 'Challenge the knight and free the position.', Bxe4: 'Recapture with the bishop.', Qd8: 'Step the queen away from the d5-knight.', Bxe2: 'Trade the light-squared bishops.', d6: 'The King’s Indian pawn chain, preparing …e5.' },
  firouzja: { c6: 'First half of the set-up; …d6 follows.', d6: 'Completes the c6/d6 set-up.', Qc7: '…Qc7 supports …e5 and keeps queens on if White takes on e5.', e5: 'The central break the set-up is built for.',
    Nf6: 'Develop and hit e4.', Nd7: 'Support e5 against f4.', Be7: 'Develop and prepare to castle.', Bg4: 'Pin the knight that defends d4.', dxe5: 'Take back: the centre opens.', 'Qa5+': 'Check, and the e5-pawn falls next.',
    'Qxe5+': 'Win the pawn back with check.', 'O-O': 'Castle and keep the structure.', Ngf6: 'Develop the king’s knight; …Nd7 already supports e5.', Qa5: 'The queen joins from a5.' },
};
const COURSES = [
  { id: 'jobava', title: 'Naroditsky — Jobava London', player: 'Daniel Naroditsky', color: 'w', games: () => job, minN: 15, minReply: 0.08, maxModel: 7,
    allow: (line, m) => line.length > 1 || ['Nf6', 'd5'].includes(m), // 1…Nf6 / 1…d5 (others are thin)
    branch: line => { const i = line.indexOf('Bf4'); return i >= 0 && line[i + 1] ? `3…${line[i + 1]}` : 'Move order'; } },
  { id: 'kid', title: 'Naroditsky — King’s Indian', player: 'Daniel Naroditsky', color: 'b', games: () => kid, minN: 15, minReply: 0.08, maxModel: 10,
    minNFor: line => (line[2] === 'Nf3' && line[4] === 'Bf4' ? 8 : 15), // the London line runs a little deeper to reach …c5 / …Nc6
    // Classical / h3 / Sämisch vs c4+e4, and one London/Torre line; no fianchetto, Four Pawns or Averbakh
    allow: (line, m) => { const w = line.filter((_, i) => i % 2 === 0); const n = line.length;
      if (n === 0) return m === 'd4'; if (n === 2) return ['c4', 'Nf3'].includes(m);
      if (line[2] === 'c4') { if (n === 4) return m === 'Nc3'; if (n === 6) return m === 'e4'; if (n === 8) return ['Nf3', 'Be2', 'h3', 'f3'].includes(m); return !['g3', 'f4', 'Bg5'].includes(m); }
      if (line[2] === 'Nf3') { if (n === 4) return m === 'Bf4'; return !['c4', 'g3'].includes(m); } // one line: the London
      return false; },
    branch: line => { const w = line.filter((_, i) => i % 2 === 0); return w.includes('f3') ? 'Sämisch' : w.includes('h3') ? 'h3 line' : w.includes('Bf4') && !w.includes('c4') ? 'London' : w.includes('Bg5') && !w.includes('c4') ? 'Torre' : w.includes('Be2') || w.includes('Nf3') && w.includes('e4') ? 'Classical' : 'Move order'; } },
  { id: 'firouzja', title: 'Firouzja — c6/d6 Systems', player: 'Alireza Firouzja', color: 'b', games: () => fir, minN: 5, minReply: 0.1, maxModel: 8,
    allow: (line, m) => (line.length === 0 ? m === 'e4' : line.length === 2 ? ['d4', 'Nf3'].includes(m) : true),
    branch: line => (line[4] === 'e5' ? '3.e5' : line[2] === 'Nf3' ? '2.Nf3' : line[4] === 'Nc3' ? '3.Nc3' : line[4] === 'Nf3' ? '3.Nf3' : line.length >= 5 ? `3.${line[4]}` : 'Move order') },
];
async function buildCourses() {
  const out = { built: new Date().toISOString().slice(0, 10), note: 'Blitz games only (base time ≥ 3 minutes). Built by tools/build-repertoire.mjs build.', courses: [] };
  const stats = [];
  const { pool } = await import('./build-technique.mjs');
  for (const C of COURSES) {
    const G = C.games().filter(g => g.blitz); const node = tree(G, C.color); const cards = []; const seen = new Set(); const thin = [];
    (function go(p, line, depth) {
      const mn = C.minNFor ? C.minNFor(line) : C.minN;
      const k = fen4(p); if (seen.has(k)) return; seen.add(k); const x = node.get(k); if (!x || x.n < mn) return;
      const mine = (x.ply % 2 === 0) === (C.color === 'w');
      if (mine) { if (depth >= C.maxModel) return; const s = share(x.model); cards.push({ k, fen: p.fen(), line: line.slice(), n: x.n, move: s.move, share: s.share, alts: top(x.model, 3).filter(([m]) => m !== s.move).map(([m, c]) => ({ move: m, share: +(c / s.of).toFixed(2) })), orders: x.orders.size });
        const q = new Pos(p.fen()); q.play(s.move); go(q, [...line, s.move], depth + 1); return; }
      const tot = Object.values(x.opp).reduce((a, b) => a + b, 0);
      for (const [m, c] of top(x.opp, 8)) { if (c / tot < C.minReply || !C.allow(line, m)) continue; const q = new Pos(p.fen()); if (!q.play(m)) continue; const y = node.get(fen4(q));
        if (!y || y.n < (C.minNFor ? C.minNFor([...line, m]) : C.minN)) { if (c >= 3) thin.push(san([...line, m])); continue; } go(q, [...line, m], depth); }
    })(new Pos(), [], 0);
    // sanity: drop a model move only if Stockfish finds it clearly dubious (≥ 1.5 pawns worse)
    const checks = await pool(cards.map(x => async e => { const [b] = await e.go(x.fen, { depth: 16 }); const [m] = await e.go(x.fen, { depth: 16, moves: [new Pos(x.fen).sanToUci(x.move)] }); return { b, m }; }), 4);
    const CL = v => Math.max(-1500, Math.min(1500, v)); const dubious = [];
    cards.forEach((x, i) => { const { b, m } = checks[i]; x.sf = b && m ? CL(b.score) - CL(m.score) : 0; if (x.sf >= 150) dubious.push(`${san(x.line)} ${x.move} (−${(x.sf / 100).toFixed(1)})`); });
    const kept = cards.filter(x => x.sf < 150);
    const ref = (k, move) => { let best = null; for (const g of G) { const p = new Pos(); for (let i = 0; i < PLIES && i < g.moves.length; i++) { if (fen4(p) === k) { if (g.moves[i] === move && (!best || g.oppElo > best.oppElo)) best = g; break; } if (!p.play(g.moves[i])) break; } } return best ? { link: best.link, opp: best.opp, oppElo: best.oppElo, date: best.date } : null; };
    const cont = (fen, move) => { const p = new Pos(fen); const seq = [move]; p.play(move); for (let j = 0; j < 3; j++) { const x = node.get(fen4(p)); if (!x) break; const o = j % 2 === 0 ? x.opp : x.model; const [m] = top(o, 1)[0] || []; if (!m || x.n < 3) break; seq.push(m); p.play(m); } return seq; };
    const course = { id: C.id, title: C.title, player: C.player, color: C.color, games: G.length, cards: kept.map((x, i) => ({
      id: `${C.id}:${x.k.replace(/[^a-zA-Z0-9]/g, '').slice(0, 64)}`, course: C.id, branch: C.branch(x.line), order: i, fen: x.fen, line: x.line, oppMove: x.line.length ? x.line[x.line.length - 1] : null,
      move: x.move, explain: IDEA[C.id][x.move] || 'The repertoire move in this position.', stat: `${C.player.split(' ').pop()} played ${x.move} in ${Math.round(x.share * 100)}% of ${x.n} blitz games here.`,
      alts: x.alts, continuation: cont(x.fen, x.move), transposition: x.orders > 1, ref: ref(x.k, x.move), player: C.player })) };
    out.courses.push(course);
    stats.push(`${C.id}: ${kept.length} cards from ${G.length} blitz games · reached by >1 move order (merged): ${kept.filter(x => x.orders > 1).length} · thin replies omitted: ${thin.length} · Stockfish-dubious excluded: ${dubious.length ? dubious.join('; ') : 'none'} · no curated idea: ${kept.filter(x => !IDEA[C.id][x.move]).map(x => x.move).join(',') || 'none'}`);
  }
  fs.writeFileSync(path.join(ROOT, 'data/courses.json'), JSON.stringify(out));
  console.log(stats.join('\n'));
  for (const c of out.courses) { const b = {}; for (const x of c.cards) b[x.branch] = (b[x.branch] || 0) + 1; console.log(`  ${c.id} branches: ${JSON.stringify(b)}`); }
}

// ---------- run ----------
// Coherent repertoire: follow the model's main move at its decisions; branch on opponent replies that recur.
export function walk(G, color, { minN, minReply = 0.08, maxModelMoves = 12 }) {
  const node = tree(G, color); const out = []; const seen = new Set(); const gaps = [];
  (function go(p, line, depth) {
    const k = fen4(p); if (seen.has(k)) return; seen.add(k); const x = node.get(k); if (!x || x.n < minN) return;
    const mine = (x.ply % 2 === 0) === (color === 'w');
    if (mine) { if (depth >= maxModelMoves) return; const s = share(x.model); out.push({ k, fen: p.fen(), line: line.slice(), n: x.n, move: s.move, share: s.share, alts: top(x.model, 3) });
      if (s.share < 0.6) gaps.push(`split at ${san(line)} (${fmt(x.model, s.of, 3)})`);
      const q = new Pos(p.fen()); q.play(s.move); go(q, [...line, s.move], depth + 1); return; }
    const tot = Object.values(x.opp).reduce((a, b) => a + b, 0);
    for (const [m, c] of top(x.opp, 8)) { if (c / tot < minReply) continue; const q = new Pos(p.fen()); if (!q.play(m)) continue; const y = node.get(fen4(q));
      if (!y || y.n < minN) { if (c >= 3) gaps.push(`${san([...line, m])} — only ${c} games`); continue; } go(q, [...line, m], depth); }
  })(new Pos(), [], 0);
  return { positions: out, gaps };
}
function report(title, G, color, opts) {
  const W = walk(G, color, opts); const P = W.positions;
  console.log(`
--- ${title}: coherent repertoire (main move only, opponent replies ≥${Math.round(opts.minReply * 100)}%, ≥${opts.minN} games) → ${P.length} decision positions; clear main move in ${P.filter(x => x.share >= 0.6).length}`);
  for (const x of P.slice(0, 40)) console.log(`  [${String(x.n).padStart(4)}] ${san(x.line).padEnd(60)} → ${x.move} ${Math.round(x.share * 100)}%${x.share < 0.6 ? '  (split: ' + x.alts.map(([m, c]) => m).join('/') + ')' : ''}`);
  console.log(`  gaps: ${W.gaps.slice(0, 12).join(' | ') || 'none'}`);
  return P;
}
const NW = load('danielnaroditsky-white.pgn', 'danielnaroditsky', 'w');
const NB = load('danielnaroditsky-black.pgn', 'danielnaroditsky', 'b');
const FB = load('firouzja2003-black.pgn', 'firouzja2003', 'b');
const job = NW.games.map(g => ({ ...g, c: classify(g.moves, 'w') })).filter(g => g.c.family === 'jobava');
const kid = NB.games.map(g => ({ ...g, c: classify(g.moves, 'b') })).filter(g => g.c.family === 'kid');
const fir = FB.games.map(g => ({ ...g, cd: c6d6(g.moves) })).filter(g => g.cd);
if (process.argv[2] === 'build') { await buildCourses(); process.exit(0); }
console.log(`Naroditsky white file: ${NW.total} games, ${NW.asColor} as White, ${NW.games.length} unique parsed`);
console.log(`Naroditsky black file: ${NB.total} games, ${NB.asColor} as Black, ${NB.games.length} unique parsed`);
console.log(`Firouzja black file:   ${FB.total} games, ${FB.asColor} as Black, ${FB.games.length} unique parsed`);

if (process.argv[2] !== 'build') course('NARODITSKY JOBAVA (White)', job, 'w', {
  first: G => { const s = {}; for (const g of G) s[g.c.sub] = (s[g.c.sub] || 0) + 1; console.log('Black set-ups (classifier):', top(s).map(([k, n]) => `${k} ${pct(n, G.length)}%`).join(' · ')); firstMoves(G, 2, 'first moves'); firstMoves(G, 4, 'first two moves each'); },
  extra: G => { console.log(`Nb5 by move 10: ${pct(sanWithin(G, /^Nb5/, 0, 20, 'w'), G.length)}% · e3: ${pct(sanWithin(G, /^e3$/, 0, 20, 'w'), G.length)}% · f3: ${pct(sanWithin(G, /^f3$/, 0, 20, 'w'), G.length)}% · Qd2: ${pct(sanWithin(G, /^Qd2/, 0, 20, 'w'), G.length)}% · O-O-O: ${pct(sanWithin(G, /^O-O-O/, 0, 24, 'w'), G.length)}% · O-O: ${pct(sanWithin(G, /^O-O$/, 0, 24, 'w'), G.length)}% · h4: ${pct(sanWithin(G, /^h4$/, 0, 24, 'w'), G.length)}% · g4: ${pct(sanWithin(G, /^g4$/, 0, 24, 'w'), G.length)}% · Nf3: ${pct(sanWithin(G, /^Nf3$/, 0, 20, 'w'), G.length)}%`); },
});

if (process.argv[2] !== 'build') course("NARODITSKY KING'S INDIAN (Black)", kid, 'b', {
  first: G => { const s = {}; for (const g of G) s[g.c.sub] = (s[g.c.sub] || 0) + 1; console.log('White systems (classifier):', top(s, 6).map(([k, n]) => `${k} ${pct(n, G.length)}%`).join(' · ')); firstMoves(G, 1, "White's first move"); firstMoves(G, 4, 'first two moves each'); },
  extra: (G) => {
    const subs = [...new Set(G.map(g => g.c.sub))];
    for (const s of subs) { const H = G.filter(g => g.c.sub === s); if (H.length < 30) continue;
      const by = re => pct(sanWithin(H, re, 0, 24, 'b'), H.length);
      console.log(`  ${s} (${H.length}): …Na6 ${by(/^Na6$/)}% · …Nbd7 ${by(/^Nbd7$/)}% · …Nc6 ${by(/^Nc6$/)}% · …e5 ${by(/^e5$/)}% · …c5 ${by(/^c5$/)}% · …b5 ${by(/^b5$/)}% · …f5 ${by(/^f5$/)}% · …c6 ${by(/^c6$/)}% · …a5 ${by(/^a5$/)}% · …h6 ${by(/^h6$/)}% · …O-O ${by(/^O-O$/)}%`); }
  },
});

if (process.argv[2] !== 'build') course('FIROUZJA …c6/…d6 (Black)', fir, 'b', {
  first: G => { firstMoves(G, 1, "White's first move"); firstMoves(G, 4, 'first two moves each'); const o = { c6first: G.filter(g => g.cd.c6 < g.cd.d6).length }; console.log(`…c6 before …d6: ${pct(o.c6first, G.length)}%`); },
  extra: G => {
    for (const w of ['e4', 'd4', 'c4', 'Nf3', 'other']) { const H = G.filter(g => (w === 'other' ? !['e4', 'd4', 'c4', 'Nf3'].includes(g.moves[0]) : g.moves[0] === w)); if (!H.length) continue;
      const by = re => pct(sanWithin(H, re, 0, 24, 'b'), H.length);
      console.log(`  1.${w} (${H.length}, score ${pct(H.reduce((a, g) => a + g.res, 0), H.length)}%): …e5 ${by(/^e5$/)}% · …d5 ${by(/^d5$/)}% · …Nf6 ${by(/^Nf6$/)}% · …Nd7 ${by(/^N?d7$/)}% · …g6 ${by(/^g6$/)}% · …Bg7 ${by(/^Bg7$/)}% · …Bg4 ${by(/^Bg4$/)}% · …Bf5 ${by(/^Bf5$/)}% · …e6 ${by(/^e6$/)}% · …b5 ${by(/^b5$/)}% · …a6 ${by(/^a6$/)}% · …a5 ${by(/^a5$/)}% · …Qc7 ${by(/^Qc7$/)}% · …Qa5 ${by(/^Qa5/)}% · …h5 ${by(/^h5$/)}%`); }
  },
});

if (process.argv[2] !== 'build') {
const V1 = {
  jobava: report('JOBAVA V1', job, 'w', { minN: 10, minReply: 0.08, maxModelMoves: 8 }),
  kid: report('KID V1', kid, 'b', { minN: 15, minReply: 0.08, maxModelMoves: 9 }),
  firouzja: report('FIROUZJA V1', fir, 'b', { minN: 5, minReply: 0.1, maxModelMoves: 8 }),
};
// KID: White's set-up inside the c4+e4 structures, and Naroditsky's knight choice there
{ const C = kid.filter(g => g.c.sub.startsWith('Classical')); const sys = g => { const w = g.moves.filter((_, i) => i % 2 === 0).slice(0, 8);
    return w.includes('f3') ? 'Sämisch (f3)' : w.includes('f4') ? 'Four Pawns (f4)' : w.includes('Bg5') && w.includes('Be2') && !w.includes('Nf3') ? 'Averbakh (Be2+Bg5)' : w.includes('h3') ? 'h3 systems' : w.includes('Nge2') ? 'Nge2 systems' : w.includes('Nf3') && w.includes('Be2') ? 'Classical (Nf3+Be2)' : w.includes('Nf3') ? 'Nf3 other' : 'other'; };
  const by = {}; for (const g of C) (by[sys(g)] = by[sys(g)] || []).push(g);
  console.log('\nKID c4+e4 systems: ' + Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([k, H]) => { const r = re => pct(sanWithin(H, re, 0, 24, 'b'), H.length); return `${k} ${H.length} (…Na6 ${r(/^Na6$/)}%, …Nbd7 ${r(/^Nbd7$/)}%, …Nc6 ${r(/^Nc6$/)}%, …c5 ${r(/^c5$/)}%, …e5 ${r(/^e5$/)}%)`; }).join('\n  ')); }
if (process.argv.includes('--sanity')) {
  const { pool } = await import('./build-technique.mjs');
  for (const [k, P] of Object.entries(V1)) {
    const res = await pool(P.map(x => async e => { const [best] = await e.go(x.fen, { depth: 16 }); const u = new Pos(x.fen).sanToUci(x.move); const [mine] = await e.go(x.fen, { depth: 16, moves: [u] }); return { x, best, mine }; }), 4);
    const flag = res.filter(r => r.best && r.mine && Math.max(-1500, Math.min(1500, r.best.score)) - Math.max(-1500, Math.min(1500, r.mine.score)) >= 80);
    console.log(`\nSANITY ${k}: ${res.length} recommended moves checked at depth 16; ${flag.length} lose ≥0.8 vs Stockfish's choice`);
    for (const r of flag) console.log(`  ${san(r.x.line)} → ${r.x.move} (${r.mine.score}) vs ${new Pos(r.x.fen).uciToSan(r.best.move)} (${r.best.score}) · model share ${Math.round(r.x.share * 100)}% of ${r.x.n}`);
  }
}
}

// Tactics course source analysis (REPORT ONLY — no data file, no UI).
// Reuses what is already stored; no new engine analysis:
//   data/training.json  drills (Repair "find the move", Stockfish cpBest/cpPlayed/pvBest/pvRef) and calc (src 'mine')
//   data/technique.json repair (60 tactical failures) and calc (52) found by tools/build-technique.mjs
//   raw/games/*.pgn     my full games, only to see what I played next (did I enter the idea late?)
// Each position is classified from the stored Stockfish lines by static board checks on the key move:
// one primary category (+ optional secondary), a failure type, a card type and a quality verdict.
//   node tools/build-tactics.mjs           report
//   node tools/build-tactics.mjs --json F  also write the per-position classification to F
//   node tools/build-tactics.mjs build     also write the Personal Tactics V1 course to data/tactics.json (--lessons lists them)
import fs from 'fs'; import path from 'path';
import { Pos, BL, K, sqName, mFrom, mTo } from '../js/chess/core.js';
import { winPct } from '../js/analysis/quality.js';
import { splitGames, parseHeaders, movetextTokens, normalizeMoves, chesscomId } from '../js/data/pgn.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const readJson = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const T = readJson('data/training.json'), TECH = readJson('data/technique.json');
const fen4 = f => f.split(' ').slice(0, 4).join(' ');
const V = [0, 1, 3, 3, 5, 9, 40];
const ME = 'localchessexpert';

// ---------- my games: moves after each position (to see whether I played the idea a move late) ----------
const GAMES = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'raw/games')).filter(f => f.endsWith('.pgn')))
  for (const raw of splitGames(fs.readFileSync(path.join(ROOT, 'raw/games', f), 'utf8'))) {
    const h = parseHeaders(raw); const id = chesscomId(h); if (!id) continue;
    const n = normalizeMoves(movetextTokens(raw).sans); if (n.moves.length) GAMES.set(id, n.moves);
  }

// ---------- static helpers ----------
const at = (p, s) => p.b[s];
const colorOf = pc => pc & BL; const typeOf = pc => pc & 7;
function info(p, san) { // move facts before playing it
  const m = p.parseSan(san); if (!m) return null; const f = mFrom(m), t = mTo(m);
  const pc = at(p, f), cap = at(p, t); p.make(m); const check = p.inCheck(); const mate = check && !p.hasLegal(); p.unmake();
  return { m, f, t, pc, cap, check, mate, san };
}
const defended = (p, sq, by) => p.attackers(sq, by).length > 0;
// enemy pieces attacked by the piece now on sq that are worth winning (king, higher value, or undefended)
function targets(p, sq) {
  const pc = at(p, sq); const me = colorOf(pc), opp = me ^ BL; const out = [];
  for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const q = at(p, s); if (!q || colorOf(q) !== opp) continue;
    if (!p.pieceAttacks(sq, s)) continue; const tq = typeOf(q);
    if (tq === K || V[tq] > V[typeOf(pc)] || (!defended(p, s, opp) && tq !== 1)) out.push({ s, t: tq }); }
  return out;
}
const RAYS = { 3: [15, 17, -15, -17], 4: [1, -1, 16, -16], 5: [1, -1, 16, -16, 15, 17, -15, -17] };
// line piece on sq: a piece in front with a more valuable (or king) piece behind = pin / skewer; returns both squares
function pinSkewer(p, sq) {
  const pc = at(p, sq); const t = typeOf(pc); if (!RAYS[t]) return null; const opp = colorOf(pc) ^ BL;
  for (const d of RAYS[t]) { let s = sq + d, first = null;
    while (!(s & 0x88)) { const q = at(p, s); if (q) { if (colorOf(q) !== opp) break; if (!first) first = { s, t: typeOf(q) }; else { const bt = typeOf(q);
          if (first.t !== K && (bt === K || V[bt] > V[first.t])) return { kind: 'pin', front: first.s, back: s };
          if ((first.t === K || V[first.t] > V[bt]) && V[bt] >= 3) return { kind: 'skewer', front: first.s, back: s }; break; } } s += d; } }
  return null;
}
// material balance (side `me`) along a line; returns the swing reached inside n plies and when
function swing(fen, line, n = 8) {
  const p = new Pos(fen); const me = p.turn; const bal = () => { let w = 0; for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const q = at(p, s); if (q && typeOf(q) !== K) w += (colorOf(q) === me ? 1 : -1) * V[typeOf(q)]; } return w; };
  const b0 = bal(); let hi = 0, lo = 0, hiAt = -1, mate = false, checks = 0;
  for (let i = 0; i < Math.min(n, line.length); i++) { const m = p.play(line[i]); if (!m) break; if (p.inCheck()) { if (i % 2 === 0) checks++; if (!p.hasLegal()) { mate = true; if (i % 2 === 0) { hi = 99; hiAt = i; } else lo = -99; break; } }
    // only count settled balances (after the reply), so a capture-recapture is not a swing
    if (i % 2 === 1 || i === line.length - 1) { const d = bal() - b0; if (d > hi) { hi = d; hiAt = i; } if (d < lo) lo = d; } }
  return { hi, lo, hiAt, mate, checks };
}

// ---------- classify one tactic: `line` starts with the tactic's first move, played by the side to move ----------
// Every attacker move in the first 6 plies is checked on the board for the classic shapes; a shape only counts
// when the line then really wins material on the squares it created (or mates).
function motif(fen, line) {
  const att = new Pos(fen).turn, opp = att ^ BL; const sw = swing(fen, line, 10); const found = {}, detail = {}; const mark = (c, i, d = {}) => { if (!(c in found)) { found[c] = i; detail[c] = { i, ...d }; } };
  const moves = []; { const q = new Pos(fen); for (let i = 0; i < Math.min(10, line.length); i++) { const ii = info(q, line[i]); if (!ii) break; moves.push(ii); q.make(ii.m); } }
  if (!moves.length) return { cats: [], conf: 'low', sw };
  const capsAfter = i => moves.slice(i + 1).map((m, k) => ({ ...m, i: i + 1 + k })).filter(m => m.i % 2 === 0 && m.cap);
  const end = sw.mate ? moves.length : Math.min(6, sw.hiAt < 0 ? 6 : sw.hiAt + 1);
  const q = new Pos(fen);
  for (let i = 0; i < Math.min(end, moves.length); i++) {
    const m = moves[i];
    if (i % 2) { q.make(m.m); continue; }
    // loose: takes an undefended piece, or one worth more than the taker
    if (m.cap && typeOf(m.cap) !== 1 && (!defended(q, m.t, opp) || V[typeOf(m.cap)] > V[typeOf(m.pc)])) mark('LOOSE_PIECE', i, { sq: m.t, t: typeOf(m.cap), loose: !defended(q, m.t, opp), by: typeOf(m.pc) });
    // removal of the defender: captures a piece that guarded a square the line takes on later
    const guarded = []; if (m.cap) for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const x = at(q, s); if (x && colorOf(x) === opp && s !== m.t && typeOf(x) !== K && q.pieceAttacks(m.t, s)) guarded.push(s); }
    // overloaded: the recapturing piece leaves another piece it guarded
    if (m.cap && moves[i + 1] && moves[i + 1].t === m.t && moves[i + 2] && moves[i + 2].cap) { const r = moves[i + 1]; q.make(m.m); const g = []; for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const x = at(q, s); if (x && colorOf(x) === opp && s !== r.f && q.pieceAttacks(r.f, s)) g.push(s); } q.unmake(); if (g.includes(moves[i + 2].t)) mark('OVERLOADED_DEFENDER', i); }
    const before = new Map(); for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const x = at(q, s); if (x && colorOf(x) === att && RAYS[typeOf(x)] && s !== m.f) before.set(s, targets(q, s).map(t => t.s)); }
    q.make(m.m);
    const later = capsAfter(i);
    { const c = later.find(c => guarded.includes(c.t)); if (m.cap && c) mark('REMOVAL_OF_DEFENDER', i, { t: typeOf(m.cap), guarded: c.t }); }
    const tg = targets(q, m.t).filter(t => t.t === K || V[t.t] >= 3 || !defended(q, t.s, opp));
    if (tg.length >= 2 && later.some(c => tg.some(t => t.s === c.t) || c.f === m.t)) mark('FORK', i, { targets: tg.slice(0, 2).map(t => t.t) });
    const ps = pinSkewer(q, m.t); if (ps && later.some(c => c.t === ps.front || c.t === ps.back)) mark('PIN_OR_SKEWER', i, { kind: ps.kind, front: typeOf(at(q, ps.front)), back: typeOf(at(q, ps.back)) });
    for (const [s, prev] of before) { if (at(q, s) === 0 || colorOf(at(q, s)) !== att) continue; const now = targets(q, s).filter(t => !prev.includes(t.s) && (t.t === K || V[t.t] >= 3)); if (now.length && (m.check || later.some(c => now.some(t => t.s === c.t)))) mark('DISCOVERED_ATTACK', i); }
  }
  // the gain must be real
  if (!(sw.hi >= 2 || sw.mate)) return { cats: [], conf: 'low', sw, first: moves[0] };
  const ORDER = ['FORK', 'PIN_OR_SKEWER', 'DISCOVERED_ATTACK', 'OVERLOADED_DEFENDER', 'REMOVAL_OF_DEFENDER', 'LOOSE_PIECE'];
  let cats = ORDER.filter(c => c in found).sort((a, b) => found[a] - found[b] || ORDER.indexOf(a) - ORDER.indexOf(b));
  // the king: mate, or a run of checks that does the winning
  const king = sw.mate || (sw.checks >= 2 && moves[0].check);
  if (king && (sw.mate || !cats.length || !['FORK', 'PIN_OR_SKEWER', 'DISCOVERED_ATTACK'].includes(cats[0]))) cats.unshift('KING_EXPOSURE');
  else if (king) cats.push('KING_EXPOSURE');
  if (!cats.length && (moves[0].check || moves[0].cap)) cats.push('MISSED_FORCING_MOVE');
  // one extra category only (MISCOUNTED_CAPTURE); a discovered attack is taught as a forcing move
  cats = [...new Set(cats.map(c => c === 'DISCOVERED_ATTACK' ? 'MISSED_FORCING_MOVE' : c))];
  const conf = !cats.length ? 'low' : cats.length <= 2 ? 'high' : 'medium';
  // the most valuable piece the attacker takes before the gain settles
  let wins = 0; for (let i = 0; i <= Math.min(moves.length - 1, sw.hiAt < 0 ? 5 : sw.hiAt); i += 2) if (moves[i].cap) wins = Math.max(wins, typeOf(moves[i].cap));
  return { cats, conf, sw, first: moves[0], detail, wins, line: moves.map(m => m.san) };
}

// ---------- pool: every stored tactical position from MY games ----------
const TACTICAL = new Set(['missed-win', 'allowed-tactic', 'allowed-mate']);
const pool = []; const seen = new Map(); let inspected = 0; const dropped = {};
const drop = (why) => { dropped[why] = (dropped[why] || 0) + 1; };
const techRepair = new Set(TECH.repair.map(x => x.id)), techCalc = new Set(TECH.calc.map(x => x.id));
for (const d of [...T.drills, ...TECH.repair]) {
  inspected++; const src = techRepair.has(d.id) ? 'repair+60' : 'repair';
  if (seen.has(fen4(d.fen))) { drop('duplicate position'); seen.get(fen4(d.fen)).also.push(src); continue; }
  const x = { id: d.id, src, also: [], fen: d.fen, col: d.col, played: d.played, best: d.sfBest, good: d.good, cpBest: d.cpBest, cpPlayed: d.cpPlayed, pvBest: d.pvBest || [], pvRef: d.pvRef || [], type: d.type, verdict: d.verdict, n: d.n || 1, games: d.games || [], path: d.path || [], tags: d.tags || [] };
  seen.set(fen4(d.fen), x); pool.push(x);
}
for (const c of [...T.calc.filter(c => c.src === 'mine'), ...TECH.calc]) {
  inspected++; const src = techCalc.has(c.id) ? 'calc+52' : 'calc';
  if (seen.has(fen4(c.fen))) { drop('duplicate position'); seen.get(fen4(c.fen)).also.push(src); continue; }
  const x = { id: c.id, src, also: [], fen: c.fen, col: c.side, played: c.played, best: c.line[0], good: [c.line[0]], cpBest: c.cp, cpPlayed: null, pvBest: c.line, pvRef: [], type: null, kind: c.kind, level: c.level, n: 1, games: c.games || [], path: [], tags: [] };
  seen.set(fen4(c.fen), x); pool.push(x);
}

// ---------- classify ----------
const out = [];
for (const x of pool) {
  const r = { id: x.id, src: x.src, also: x.also, fen: x.fen, played: x.played, best: x.best, games: x.games, n: x.n };
  const p = new Pos(x.fen);
  // 1) strategic, not tactical
  if (x.verdict === 'not-a-mistake') { r.out = 'not a mistake'; out.push(r); continue; }
  if (x.type === 'positional' || (x.kind && !['tactical', 'defensive', 'attack', 'conversion', 'exchanges'].includes(x.kind))) { r.out = 'strategic'; out.push(r); continue; }
  // 2) hopeless or still winning comfortably (nothing to learn)
  if (x.cpBest != null && x.cpBest <= -300) { r.out = 'hopeless'; out.push(r); continue; }
  if (x.cpPlayed != null && x.cpPlayed >= 350) { r.out = 'still winning'; out.push(r); continue; }
  if (x.cpPlayed != null && winPct(x.cpBest) - winPct(x.cpPlayed) < 15) { r.out = 'small loss'; out.push(r); continue; }
  // 3) which side's tactic is the lesson
  const mine = motif(x.fen, x.pvBest);
  let theirs = null, threatBefore = false;
  if (x.pvRef.length >= 2) { const q = new Pos(x.fen); q.play(x.pvRef[0]); theirs = motif(q.fen(), x.pvRef.slice(1));
    // was the opponent's shot already there before my move? (null-move check: same first move legal and still wins material)
    const n = new Pos(x.fen.replace(/ ([wb]) /, (m, s) => ` ${s === 'w' ? 'b' : 'w'} `).replace(/ [a-h][36] /, ' - ')); try { if (!n.inCheck(n.turn ^ BL)) { const t0 = n.parseSan(x.pvRef[1].replace(/[+#]/g, '')); if (t0) { const sw0 = swing(n.fen(), x.pvRef.slice(1), 6); threatBefore = sw0.hi >= 2 || sw0.mate; } } } catch (e) {} }
  const playedI = info(new Pos(x.fen), x.played || '');
  const bestI = info(new Pos(x.fen), x.best || '');
  // what I played next in the game: did I find the shot a move late?
  let late = false; const g = GAMES.get(x.games[0]); if (g && x.path && x.path.length) { const ply = x.path.length; if (g[ply + 2] && x.best && g[ply + 2].replace(/[+#]/g, '') === x.best.replace(/[+#]/g, '')) late = true; }
  // previous own move started forcing play (I was mid-sequence)
  let midSeq = false; if (x.path.length >= 2) { const q = new Pos(); for (const s of x.path.slice(0, -2)) q.play(s); const mi = info(q, x.path[x.path.length - 2]); midSeq = !!(mi && (mi.cap || mi.check)); }
  let lesson = x.type === 'missed-win' || (!x.type && mine.cats.length && x.kind !== 'defensive') ? 'mine'
    : x.type === 'allowed-tactic' || x.type === 'allowed-mate' ? 'theirs' : x.kind === 'defensive' ? 'defend' : 'mine';
  // "best" simply takes the piece that executes their shot: the lesson is their threat, not my win
  if (lesson === 'mine' && theirs && theirs.cats.length && bestI && bestI.cap && x.pvRef[1]) { const q = new Pos(x.fen); q.play(x.pvRef[0]); const t1 = info(q, x.pvRef[1]); if (t1 && t1.f === bestI.t) lesson = 'theirs'; }
  // I chose between forcing moves (or was already in a forcing sequence) and picked the wrong one
  const forcing = mi => mi && (mi.cap || mi.check);
  let refHitsPlayed = false; if (playedI && x.pvRef[1]) { const q = new Pos(x.fen); q.play(x.pvRef[0]); const t1 = info(q, x.pvRef[1]); refHitsPlayed = !!(t1 && t1.t === playedI.t); }
  const calcFail = (forcing(playedI) && forcing(bestI)) || (forcing(playedI) && refHitsPlayed) || (midSeq && forcing(playedI));
  let cats, conf, failure, card;
  if (lesson === 'mine') {
    ({ cats, conf } = mine);
    failure = calcFail ? 'CALCULATION' : playedI && !forcing(playedI) ? 'RECOGNITION' : 'UNCLEAR';
    const deep = mine.sw.hiAt >= 5 || (x.pvBest.length >= 7 && mine.sw.hiAt < 0);
    card = deep ? 'CALCULATE' : forcing(bestI) && (cats[0] === 'MISSED_FORCING_MOVE' || cats[0] === 'KING_EXPOSURE') ? 'FORCING_MOVE' : 'FIND_THE_MOVE';
  } else if (lesson === 'theirs' && theirs) {
    // their shot was already on the board → "what is your opponent threatening?";
    // my move created it → "how do you keep the position together?"; an active save (check/capture) is a defensive resource
    if (threatBefore && forcing(bestI) && !(bestI.t === (() => { const q = new Pos(x.fen); q.play(x.pvRef[0]); const t1 = info(q, x.pvRef[1]); return t1 ? t1.f : -1; })())) { cats = ['DEFENSIVE_RESOURCE', ...theirs.cats.slice(0, 1)]; card = 'DEFEND'; }
    else { cats = theirs.cats.slice(0, 2); card = threatBefore ? 'THREAT_CHECK' : 'DEFEND'; }
    conf = theirs.conf; failure = calcFail ? 'CALCULATION' : 'DEFENSIVE';
  } else { // defensive calc item: the resource is the lesson
    cats = ['DEFENSIVE_RESOURCE', ...mine.cats.slice(0, 1)]; conf = mine.cats.length ? 'medium' : 'low'; failure = 'DEFENSIVE'; card = x.pvBest.length >= 7 ? 'CALCULATE' : 'DEFEND';
  }
  // extra category: I captured / sacrificed (or chose the wrong capture) and the count did not work,
  // with no fork, pin, discovery or king attack doing the damage
  const SHAPE = ['FORK', 'PIN_OR_SKEWER', 'KING_EXPOSURE', 'OVERLOADED_DEFENDER', 'REMOVAL_OF_DEFENDER'];
  if (calcFail && playedI && playedI.cap !== undefined && (playedI.cap || playedI.check) && cats && !SHAPE.includes(cats[0])) cats = ['MISCOUNTED_CAPTURE', ...cats.filter(c => c !== 'LOOSE_PIECE' && c !== 'MISSED_FORCING_MOVE')];
  cats = (cats || []).filter((c, i, a) => a.indexOf(c) === i).slice(0, 2);
  Object.assign(r, { x, mine, theirs, refHitsPlayed, lesson, cats, conf, failure, card, cpBest: x.cpBest, cpPlayed: x.cpPlayed, swing: (lesson === 'theirs' && theirs ? theirs.sw : mine.sw), late, midSeq, threatBefore });
  // 4) quality: a clear, short, tactical lesson
  const sw = r.swing; const reach = sw.mate ? 0 : sw.hiAt;
  if (!cats.length) r.out = 'unclear lesson';
  else if (conf === 'low') r.out = 'unclear lesson';
  else if (lesson === 'mine' && bestI && !bestI.cap && !bestI.check && (reach < 0 || reach >= 5)) r.out = 'engine-only';
  else if (lesson === 'theirs' && card === 'THREAT_CHECK' && playedI && playedI.cap === 0 && sw.hi < 2 && !sw.mate) r.out = 'unclear lesson';
  else r.out = null;
  out.push(r);
}
// same game, same tactic a move or two apart: keep one (the earliest)
const byGame = new Map(); for (const r of out.filter(r => !r.out)) { const k = r.games[0] + '|' + r.cats[0]; if (byGame.has(k)) { r.out = 'duplicate (same game, same idea)'; } else byGame.set(k, r); }
for (const r of out.filter(r => r.out)) drop(r.out);

// ---------- report ----------
const hq = out.filter(r => !r.out);
const pct = (a, b) => b ? Math.round(1000 * a / b) / 10 + '%' : '–';
const count = (arr, f) => { const m = {}; for (const x of arr) for (const k of [].concat(f(x))) if (k) m[k] = (m[k] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]); };
console.log(`games read: ${GAMES.size}`);
console.log(`tactical positions inspected: ${inspected} (repair ${T.drills.length} + technique repair ${TECH.repair.length} + my calc ${T.calc.filter(c => c.src === 'mine').length} + technique calc ${TECH.calc.length})`);
console.log(`unique positions: ${pool.length}`); console.log('dropped:', dropped);
console.log(`HIGH QUALITY: ${hq.length}`);
console.log('failure type:', count(hq, r => r.failure));
console.log('primary:'); for (const [k, n] of count(hq, r => r.cats[0])) console.log(`  ${k.padEnd(22)} ${String(n).padStart(3)}  ${pct(n, hq.length)}`);
console.log('secondary:', count(hq, r => r.cats[1]));
console.log('card:', count(hq, r => r.card));
console.log('lesson side:', count(hq, r => r.lesson), ' confidence:', count(hq, r => r.conf));
console.log('source:', count(hq, r => r.src), ' also in:', count(hq, r => r.also));
console.log('primary × failure:'); const pf = {}; for (const r of hq) { const k = r.cats[0]; pf[k] = pf[k] || {}; pf[k][r.failure] = (pf[k][r.failure] || 0) + 1; } console.log(pf);
console.log('repeated (n>1):', hq.filter(r => r.n > 1).length, ' found a move late:', hq.filter(r => r.late).length, ' threat already there:', hq.filter(r => r.threatBefore).length);
const i = process.argv.indexOf('--json'); if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(out.map(({ x, mine, theirs, ...r }) => r), null, 1));

// ---------- build data/tactics.json: the Personal Tactics V1 course ----------
// Only the strict V1 pool: high confidence, the gain shows inside 3 plies (or mate), not a Calculate card.
// Cards keep what the UI needs; the lesson and hint are written from the stored lines, no engine numbers.
const QUOTA = { LOOSE_PIECE: 18, MISCOUNTED_CAPTURE: 14, FORK: 8, KING_EXPOSURE: 8, PIN_OR_SKEWER: 5, MISSED_FORCING_MOVE: 4, REMOVAL_OF_DEFENDER: 3 };
const NAME = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const PROMPT = { FIND_THE_MOVE: 'What did you miss?', THREAT_CHECK: 'What is your opponent threatening?', FORCING_MOVE: 'What forcing move should you examine first?', DEFEND: 'How do you keep the position together?' };
const HINT = {
  LOOSE_PIECE: ['Something is undefended.', 'After your move, which of your pieces is undefended?'],
  MISCOUNTED_CAPTURE: ['Count attackers and defenders before you capture.', 'Count attackers and defenders before you capture.'],
  FORK: ['Look for one move that attacks two things.', 'Can one enemy move attack two of your pieces?'],
  KING_EXPOSURE: ['Look at the king.', 'Look at your king: which checks does your opponent get?'],
  PIN_OR_SKEWER: ['Look along the lines through the king and queen.', 'Which of your pieces stand on one line with your king or queen?'],
  MISSED_FORCING_MOVE: ['Checks and captures first.', 'Which checks and captures does your opponent have?'],
  REMOVAL_OF_DEFENDER: ['Which piece is doing the defending?', 'Which of your pieces is doing the defending?'],
};
// the null-move position: the same board with the opponent to move (their threat, played on the board)
const flip = fen => { const f = fen.split(' '); f[1] = f[1] === 'w' ? 'b' : 'w'; f[3] = '-'; return f.join(' '); };
const sq = s => sqName(s);
function lessonFor(r) {
  const x = r.x, theirs = r.lesson === 'theirs'; const M = theirs ? r.theirs : r.mine; const d = (M.detail || {})[r.cats[0]] || {}; const L = M.line; const your = theirs ? 'your ' : 'the ';
  const mv = i => (i ? `${L[0]}, then ${L[i]}` : L[0]); const after = r.card === 'DEFEND' ? `After ${x.played}, ` : '';
  const cap = s => (/^(after|your|the) /.test(s) ? s[0].toUpperCase() + s.slice(1) : s);
  const wins = M.wins ? `${your}${NAME[M.wins]}` : 'material';
  switch (r.cats[0]) {
    case 'MISCOUNTED_CAPTURE':
      if (!x.pvRef[1]) return null;
      if (r.lesson === 'mine') return `Take with ${x.best}, not ${x.played}: ${x.played} loses to ${x.pvRef[1]}.`;
      return r.refHitsPlayed ? `${x.played} fails: ${x.pvRef[1].replace(/[+#]/g, '').slice(-2)} is still defended (${x.pvRef[1]}).` : `${x.played} fails to ${x.pvRef[1]}, which wins ${wins}.`;
    case 'LOOSE_PIECE': { const l = d; if (!l.sq || l.i) return null;
      const what = `${your}${NAME[l.t]} on ${sq(l.sq)}`;
      return l.loose ? cap(`${after}${what} is loose: ${mv(l.i)} takes it.`) : cap(`${after}${mv(l.i)} wins ${what} for a ${NAME[l.by]}.`); }
    case 'FORK': if (!d.targets) return null; return cap(`${after}${mv(d.i)} forks ${d.targets[0] === d.targets[1] ? `both ${your.trim() === 'your' ? 'your ' : ''}${NAME[d.targets[0]]}s` : `${your}${NAME[d.targets[0]]} and ${NAME[d.targets[1]]}`}.`);
    case 'PIN_OR_SKEWER': if (!d.kind || d.front === 1) return null; return cap(`${after}${mv(d.i)} ${d.kind === 'pin' ? 'pins' : 'skewers'} ${your}${NAME[d.front]} ${d.kind === 'pin' ? 'to the' : 'and the'} ${NAME[d.back]}.`);
    case 'REMOVAL_OF_DEFENDER': if (!d.t) return null; return cap(`${after}${mv(d.i)} removes ${your}${NAME[d.t]}, the defender of ${sq(d.guarded)}.`);
    case 'KING_EXPOSURE': {
      if (M.sw.mate) { const k = L.findIndex((s, i) => i % 2 === 0 && s.endsWith('#')); const ln = L.slice(0, k + 1);
        return theirs ? cap(`${after}${ln.length <= 3 ? ln.join(' ') + ' is mate.' : mv(0) + ' starts a mating attack on your king.'}`) : `${mv(0)} starts a mating attack.`; }
      if (M.wins <= 1) return null; // a run of checks that only wins a pawn is not a clear lesson
      return cap(`${after}${mv(0)} opens ${theirs ? 'your' : 'the'} king, and the checks win ${wins}.`); }
    case 'MISSED_FORCING_MOVE': return theirs ? cap(`${after}${mv(0)} wins ${wins}.`) : `Look at ${mv(0)} first: it wins ${M.wins ? 'the ' + NAME[M.wins] : 'material'}.`;
  }
  return null;
}
function build(hq) {
  const pool = hq.filter(r => r.card !== 'CALCULATE' && r.conf === 'high' && (r.swing.mate || r.swing.hiAt <= 3) && QUOTA[r.cats[0]]);
  // the shot played on the board must be legal from the position shown
  const cards = []; const rejected = {};
  const rank = r => (r.card === 'DEFEND' || r.card === 'THREAT_CHECK' ? 0 : 1) + (r.cats.length > 1 ? 0.5 : 0) + (r.swing.mate ? 0 : r.swing.hiAt) * 0.1 - (r.n > 1 ? 1 : 0);
  for (const [motifName, n] of Object.entries(QUOTA)) {
    const list = pool.filter(r => r.cats[0] === motifName).sort((a, b) => rank(a) - rank(b));
    let k = 0;
    for (const r of list) {
      if (k >= n) break; const x = r.x;
      // MISCOUNTED_CAPTURE: only a short, clear refutation (it hits the capturing piece within 3 plies)
      if (motifName === 'MISCOUNTED_CAPTURE' && r.lesson === 'theirs' && !(r.refHitsPlayed && r.swing.hiAt <= 3)) { rejected['long refutation'] = (rejected['long refutation'] || 0) + 1; continue; }
      const lesson = lessonFor(r); if (!lesson) { rejected['no clear lesson'] = (rejected['no clear lesson'] || 0) + 1; continue; }
      const threat = r.card === 'THREAT_CHECK';
      const fen = threat ? flip(x.fen) : x.fen;
      const moves = threat ? [x.pvRef[1]] : [...new Set((x.good && x.good.length ? x.good : [x.best]))];
      const p = new Pos(fen); if (!moves.every(m => p.parseSan(m))) { rejected['illegal answer'] = (rejected['illegal answer'] || 0) + 1; continue; }
      const theirsSide = r.lesson === 'theirs';
      cards.push({
        id: 'tac:' + fen4(x.fen).replace(/[\s/]/g, ''), game: x.games[0] || null, own: fen4(x.fen), fen, side: x.col, type: r.card,
        motif: r.cats[0], motif2: r.cats[1] || null, moves, hint: HINT[motifName][theirsSide ? 1 : 0], lesson,
        prev: (x.path || []).slice(-4), cont: threat ? [] : (x.pvBest || []).slice(0, 4), // a threat card has no line: in the game my move came first
        order: cards.length,
      });
      k++;
    }
  }
  // Learn order: one motif after another, round robin, so a session is never six loose pieces in a row
  const lanes = Object.keys(QUOTA).map(k => cards.filter(c => c.motif === k)); let o = 0;
  for (let i = 0; lanes.some(l => l[i]); i++) for (const l of lanes) if (l[i]) l[i].order = o++;
  cards.sort((a, b) => a.order - b.order);
  const outFile = path.join(ROOT, 'data/tactics.json');
  fs.writeFileSync(outFile, JSON.stringify({ built: new Date().toISOString().slice(0, 10), source: 'tools/build-tactics.mjs build (stored Stockfish lines, no new analysis)', prompts: PROMPT, cards }));
  console.log(`\nTACTICS V1: ${cards.length} cards → data/tactics.json`, rejected);
  console.log('motif:', count(cards, c => c.motif)); console.log('card:', count(cards, c => c.type));
  if (process.argv.includes('--lessons')) for (const c of cards) console.log(`${c.type.padEnd(13)} ${c.motif.padEnd(20)} ${c.moves.join('/').padEnd(10)} ${c.lesson}`);
}
if (process.argv.includes('build')) build(hq);

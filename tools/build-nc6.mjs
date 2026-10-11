// My 1…Nc6 system as Black (Chessable-style course): 1.e4 Nc6 with …e5 and pawn chains, the Schliemann
// against 3.Bb5, …d6 instead of opening the centre with …exd4, and the Knight Tango against 1.d4 Nf6 2.c4.
// The tree is written by hand (moves, one-sentence reasons, plans); every Black move is checked with the
// bundled Stockfish and every position is counted in my own games (raw/games/*.pgn).
//   node tools/build-nc6.mjs          build data/nc6.json (engine check, depth 16)
import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process';
import { splitGames, parseHeaders, movetextTokens, normalizeMoves } from '../js/data/pgn.js';
import { Pos } from '../js/chess/core.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ME = 'localchessexpert';
const fen4 = p => p.fen().split(' ').slice(0, 4).join(' ');

// ---------- the repertoire ----------
// { w: White move, b: my reply, x: why (one sentence), plan: shown at the end of a line, branch, kids: [...] }
const PLAN = {
  closed: 'Locked centre: …Ng6 and …Nf6, …Be7 or …Bc5, …d6 and castle, then …Nh5 and …f5 (or …Nf4). Your play is on the kingside; leave the queenside to White.',
  recapture: 'White gave up the centre: develop fast with …Nf6, …Bc5 or …Bb4+, …d6 or …d5, castle short. Aim your bishop at the weakened a7–g1 diagonal and e3.',
  philidor: 'Hold e5 with the pawn on d6: …Nf6, …Be7, …O-O, …Re8. If White pushes d5, it is your locked-centre plan (…Ng6, …Nh5, …f5). Take on d4 only when it wins time.',
  steinitz: 'Old Steinitz: keep the e5 pawn, …Nf6, …Be7, …O-O, …Re8 and …Bf8. The pin is harmless once the bishop on d7 covers c6.',
  queenless: 'Queens off, but nothing is wrong: …f6 or …Bd6 holds e5, the king guards the centre from e7 or c7, and …Be6, …Nge7, …Rd8 finish development.',
  schliemann: 'Schliemann: the f-file is yours. …fxe4, …Nf6, …Bc5 or …Bd6, castle short and bring a rook to f8; White\'s e4 and f2 are the targets.',
  semiItalian: 'Quiet Italian: …Be7, …Nf6, …O-O with the pawn on d6. If Ng5 ever hits f7, …O-O covers it; later …Na5 trades White\'s best bishop.',
  fourKnights: 'Four Knights: keep the …d6 / …e5 chain; …Be7, …O-O, …Re8. Against Bb5, …Bd7 unpins; against d4, recapture to keep the centre closed where you can.',
  vienna: 'Against the Vienna: develop and hit e4 (…Nf6), trade White\'s light-squared bishop with …Na5 when it lands on b3 or c4, castle short and break with …d5.',
  gambit: 'After …exf4 you are a pawn up: develop (…Nf6, …d6, …Be7), keep the f4 pawn while it costs nothing, and castle short. White\'s king is the weak one.',
  tango: 'Knight Tango into a King\'s Indian centre: …e5, and if d5 then …Ne7, …Ng6, …d6, …O-O and …Nh5/…f5. If White exchanges on e5, your pieces get the e5 square.',
  tangoOpen: 'Here you take on d4 because it wins time: …Bb4 pins c3, …Ne5 hits c4, then …O-O and …Re8 against e4.',
};
const TREE = [
  { w: 'e4', b: 'Nc6', branch: '1.e4', x: 'Develop first and answer with …e5 next: you fight for e5 with a pawn chain instead of opening the centre.', kids: [
    { w: 'd4', b: 'e5', branch: '2.d4', x: 'Hit the centre at once. You want d5 (a locked centre) or dxe5; you do not take on d4 yourself.', kids: [
      { w: 'd5', b: 'Nce7', branch: '2.d4 e5 3.d5', x: 'Back toward g6. The centre is locked — your best structure.', plan: PLAN.closed, kids: [
        { w: 'c4', b: 'Ng6', x: 'Ng6 eyes f4 and h4 and clears e7 for the bishop.', plan: PLAN.closed, kids: [
          { w: 'Nc3', b: 'Bc5', x: 'Active bishop on the a7–g1 diagonal; …Nf6, …d6 and castle next.', plan: PLAN.closed },
          { w: 'Be3', b: 'Nf6', x: 'Develop and hit e4; …Bb4+ is ready if White plays f3.', plan: PLAN.closed } ] },
        { w: 'Nf3', b: 'Ng6', x: 'Same square: from g6 the knight watches f4 and supports …f5 later.', plan: PLAN.closed, kids: [
          { w: 'h4', b: 'h5', x: 'Stop h5 at once: the h-pawn is fixed and g4 is yours.', plan: PLAN.closed } ] },
        { w: 'Nc3', b: 'Nf6', x: 'Develop and hit e4 first; …Ng6 follows.', plan: PLAN.closed },
        { w: 'Bd3', b: 'Ng6', x: 'Ng6 again: the bishop on d3 blocks White\'s own d-pawn chain, and …Nf4 can hit it.', plan: PLAN.closed },
        { w: 'f4', b: 'Ng6', x: 'Attack f4 at once: …Nxf4 or …exf4 opens lines for your pieces.', plan: PLAN.closed } ] },
      { w: 'dxe5', b: 'Nxe5', branch: '2.d4 e5 3.dxe5', x: 'Recapture with the knight: it stands in the centre and you are not a pawn down.', plan: PLAN.recapture, kids: [
        { w: 'f4', b: 'Nc6', x: 'Back to c6: the knight is safe, and f4 has loosened the a7–g1 diagonal for …Bc5 or …Bb4+.', plan: PLAN.recapture, kids: [
          { w: 'Nf3', b: 'Bc5', x: 'Take the diagonal White weakened with f4: White cannot castle short comfortably now.', plan: PLAN.recapture } ] },
        { w: 'Nf3', b: 'd6', x: 'Support the knight with the pawn: if Nxe5, …dxe5 gives you a solid pawn on e5.', plan: PLAN.recapture },
        { w: 'Nc3', b: 'Bc5', x: 'Develop toward f2 and the a7–g1 diagonal; …d6 and …Nf6 follow.', plan: PLAN.recapture } ] },
      { w: 'Nf3', b: 'd6', branch: 'Scotch type: …d6', x: 'Do not take on d4: …d6 holds e5 and invites d5, which locks the centre the way you like (Stockfish prefers …exd4 by about half a pawn — this is the structural choice).', plan: PLAN.philidor },
    ] },
    { w: 'Nf3', b: 'e5', branch: '2.Nf3', x: 'Claim e5. White now chooses Bb5, Bc4, d4 or Nc3.', kids: [
      { w: 'Bb5', b: 'f5', branch: 'Schliemann', x: 'Hit e4 at once and take the f-file — your best line against the Spanish.', plan: PLAN.schliemann, kids: [
        { w: 'd3', b: 'fxe4', x: 'Take first: after dxe4 the f-file is half-open for your rook.', plan: PLAN.schliemann, kids: [
          { w: 'dxe4', b: 'Nf6', x: 'Develop and attack e4; …Bc5 and …O-O come next.', plan: PLAN.schliemann, kids: [
            { w: 'O-O', b: 'Bc5', x: 'Aim at f2 and castle next; the f-file rook joins the attack.', plan: PLAN.schliemann },
            { w: 'Nc3', b: 'Bb4', x: 'Pin the knight that defends e4 — e4 is your target.', plan: PLAN.schliemann } ] } ] },
        { w: 'Nc3', b: 'fxe4', x: 'Take the pawn; the knight will recapture but you have opened the f-file.', plan: PLAN.schliemann, kids: [
          { w: 'Nxe4', b: 'Nf6', x: 'The safe line: challenge the centralised knight and develop with tempo.', plan: PLAN.schliemann, kids: [
            { w: 'Nxf6+', b: 'Qxf6', x: 'Queen recaptures and eyes f2 and b2; …Be7 or …Bc5 and castle next.', plan: PLAN.schliemann } ] } ] },
        { w: 'Bxc6', b: 'dxc6', x: 'Recapture toward the centre: the d-file opens for your queen and both bishops are free.', plan: PLAN.schliemann, kids: [
          { w: 'Nxe5', b: 'Qd4', x: 'Trap: the queen hits the e5 knight and e4 at once — you win the pawn back with the better game.', plan: PLAN.schliemann },
          { w: 'Nc3', b: 'fxe4', x: 'Take on e4: after Nxe4, …Nf6 and …Bg4 develop with pressure.', plan: PLAN.schliemann } ] },
        { w: 'exf5', b: 'e4', x: 'Gain space with tempo: the f3 knight must move, and you regain f5 later.', plan: PLAN.schliemann, kids: [
          { w: 'Qe2', b: 'Qe7', x: 'Hold e4 and pin back along the e-file; …Nf6 and …Nxf5 come later.', plan: PLAN.schliemann },
          { w: 'Nd4', b: 'Nxd4', x: 'Trap: Nd4? just drops the knight — take it; the check on h5 leads nowhere.', plan: PLAN.schliemann } ] },
        { w: 'd4', b: 'fxe4', x: 'Take on e4: the knight on f3 has to move and your centre stays strong.', plan: PLAN.schliemann, kids: [
          { w: 'Nxe5', b: 'Nxe5', x: 'Trade the strong knight; after dxe5, …c6 kicks the bishop.', plan: PLAN.schliemann, kids: [
            { w: 'dxe5', b: 'c6', x: 'Kick the bishop, then …Qa5+ or …d5 takes over the centre.', plan: PLAN.schliemann } ] } ] } ] },
      { w: 'Bc4', b: 'd6', branch: '2.Nf3 e5 3.Bc4', x: 'A quiet, closed answer: hold e5 with the pawn, then …Be7 and …Nf6. No Fried Liver, no theory.', plan: PLAN.semiItalian, kids: [
        { w: 'd4', b: 'exd4', x: 'Here taking is right: after Nxd4, …Nf6 and …Be7 put pressure on e4 from a solid d6 base.', plan: PLAN.semiItalian, kids: [
          { w: 'Nxd4', b: 'Nf6', x: 'Hit e4 at once; …Be7 and …O-O follow, with …Re8 against e4.', plan: PLAN.semiItalian } ] },
        { w: 'c3', b: 'Be7', x: 'Same setup: …Be7, …Nf6 and castle; the pawn on d6 holds everything.', plan: PLAN.semiItalian },
        { w: 'O-O', b: 'Be7', x: 'Bishop first, so Ng5 never hits f7 before you castle.', plan: PLAN.semiItalian },
        { w: 'Nc3', b: 'Be7', x: 'Bishop first again; …Nf6 and …O-O next, and …Na5 can trade the c4 bishop.', plan: PLAN.semiItalian } ] },
      { w: 'd4', b: 'd6', branch: 'Scotch type: …d6', x: 'Do not take on d4: …d6 holds e5 and invites d5, which locks the centre the way you like (Stockfish prefers …exd4 by about half a pawn — this is the structural choice).', plan: PLAN.philidor, kids: [
        { w: 'd5', b: 'Nce7', x: 'Locked centre — your 3.d5 Nce7 structure with an extra …d6 already played.', plan: PLAN.closed },
        { w: 'Nc3', b: 'Nf6', x: 'Develop and keep the tension: against d5 play …Ne7, against dxe5 recapture.', plan: PLAN.philidor, kids: [
          { w: 'd5', b: 'Ne7', x: 'Closed again: the knight heads for g6 and you follow the locked-centre plan.', plan: PLAN.closed },
          { w: 'Bb5', b: 'exd4', x: 'Now take: with the c6 knight pinned, …exd4 and …Bd7 is the clean way to unpin.', plan: PLAN.steinitz } ] },
        { w: 'Bb5', b: 'Bd7', x: 'Unpin calmly: the c6 knight is covered and the e5 pawn stays.', plan: PLAN.steinitz, kids: [
          { w: 'Nc3', b: 'exd4', x: 'Take now that White has developed: …exd4, then …Nf6 and …Be7 against e4.', plan: PLAN.steinitz } ] },
        { w: 'dxe5', b: 'dxe5', x: 'Recapture with the pawn; a queen trade on d8 leaves you a safe, equal position.', plan: PLAN.queenless, kids: [
          { w: 'Qxd8+', b: 'Kxd8', x: 'Recapture with the king: it is safe in the centre with queens off, and …Bd6 holds e5.', plan: PLAN.queenless } ] } ] },
      { w: 'Nc3', b: 'Nf6', branch: 'Four Knights', x: 'Develop and hit e4; you keep the …d6 / …e5 setup in mind.', plan: PLAN.fourKnights },
    ] },
    { w: 'Nc3', b: 'e5', branch: '2.Nc3', x: 'Claim e5 against the Vienna move order too.', kids: [
      { w: 'Bc4', b: 'Nf6', x: 'Develop and hit e4; …Na5 can trade the c4 bishop later.', plan: PLAN.vienna, kids: [
        { w: 'd3', b: 'Na5', x: 'Trade White\'s best piece: the c4 bishop is the Vienna\'s attacking piece.', plan: PLAN.vienna } ] },
      { w: 'Nf3', b: 'Nf6', x: 'Four Knights by transposition: develop and hit e4.', plan: PLAN.fourKnights },
      { w: 'f4', b: 'exf4', x: 'Take the gambit pawn: White\'s king becomes the airy one.', plan: PLAN.gambit, kids: [
        { w: 'Nf3', b: 'Nf6', x: 'No …g5 theory: develop and hit e4 (Stockfish still rates you fine); meet e5 with …Ng4 or …Nh5, and d4 with …d5.', plan: PLAN.gambit } ] } ] },
  ] },
  { w: 'd4', b: 'Nf6', branch: '1.d4', x: 'Your Tango move order: …Nf6 first, …Nc6 against c4.', kids: [
    { w: 'c4', b: 'Nc6', branch: 'Knight Tango', x: 'Pressure d4 at once and keep …e5 (or …d6 and …e5) ready.', kids: [
      { w: 'Nc3', b: 'e5', x: 'Strike now: if d5, …Ne7 gives a closed King\'s-Indian-type centre.', plan: PLAN.tango, kids: [
        { w: 'd5', b: 'Ne7', x: 'Same idea as against 1.e4: the knight goes to g6 and you play on the kingside.', plan: PLAN.tango, kids: [
          { w: 'e4', b: 'Ng6', x: 'Ng6 eyes f4; meet h4 with …h5, then …Bc5 or …d6 and castle.', plan: PLAN.tango } ] },
        { w: 'Nf3', b: 'exd4', x: 'Take now: …Bb4 pins the c3 knight and …Ne5 hits c4.', plan: PLAN.tangoOpen, kids: [
          { w: 'Nxd4', b: 'Bb4', x: 'Pin the c3 knight: after Nxc6 Bxc3+ you damage White\'s pawns.', plan: PLAN.tangoOpen } ] } ] },
      { w: 'Nf3', b: 'd6', x: 'Your move order: …d6 then …e5, building the same pawn chain.', plan: PLAN.tango, kids: [
        { w: 'Nc3', b: 'e5', x: 'Now …e5: against d5 the knight goes to e7 and g6.', plan: PLAN.tango, kids: [
          { w: 'd5', b: 'Ne7', x: 'Locked centre: …g6 and …Bg7 or …Ng6, then …O-O and …Nh5 / …f5.', plan: PLAN.tango },
          { w: 'dxe5', b: 'dxe5', x: 'Recapture with the pawn; after Qxd8+ Kxd8 the endgame is equal and e5 is yours.', plan: PLAN.queenless } ] } ] },
      { w: 'd5', b: 'Ne5', x: 'Centralise: the knight is hard to dislodge without f4, and …e6 or …d6 follows.', plan: PLAN.tango, kids: [
        { w: 'e4', b: 'e6', x: 'Challenge d5 at once: …exd5 opens the e-file against White\'s centre.', plan: PLAN.tango },
        { w: 'Nc3', b: 'e6', x: 'Same break: …e6 hits d5, and …Bb4 can pin the knight.', plan: PLAN.tango } ] } ] },
  ] },
];

// ---------- my games: positions reached and what I played ----------
const games = [];
for (const f of fs.readdirSync(path.join(ROOT, 'raw/games')).filter(f => f.endsWith('.pgn')))
  for (const raw of splitGames(fs.readFileSync(path.join(ROOT, 'raw/games', f), 'utf8'))) {
    const h = parseHeaders(raw); if ((h.Black || '').toLowerCase() !== ME) continue;
    const n = normalizeMoves(movetextTokens(raw).sans, null, 30); const r = h.Result === '0-1' ? 1 : h.Result === '1/2-1/2' ? 0.5 : 0;
    games.push({ moves: n.moves, r });
  }
const seen = new Map(); // fen4 (Black to move) -> { n, moves: {san: [n, score]} }
for (const g of games) { const p = new Pos(); for (let i = 0; i < g.moves.length; i++) { if (i % 2 === 1) { const k = fen4(p); const s = seen.get(k) || { n: 0, moves: {} }; s.n++; const m = s.moves[g.moves[i]] || [0, 0]; m[0]++; m[1] += g.r; s.moves[g.moves[i]] = m; seen.set(k, s); } if (!p.play(g.moves[i])) break; } }
const san0 = s => s.replace(/[+#]/g, '');
function stat(k, move) {
  const s = seen.get(k); if (!s) return 'New for you: not reached in your games yet.';
  const mine = Object.entries(s.moves).find(([m]) => san0(m) === san0(move)); const top = Object.entries(s.moves).sort((a, b) => b[1][0] - a[1][0])[0];
  if (mine && mine[1][0] === s.n) return `Your games: reached ${s.n} time${s.n > 1 ? 's' : ''}, you played ${move} every time (${Math.round(100 * mine[1][1] / mine[1][0])}%).`;
  if (mine) return `Your games: reached ${s.n} times, ${move} in ${mine[1][0]} (${Math.round(100 * mine[1][1] / mine[1][0])}%); most often ${top[0]}.`;
  return `Your games: reached ${s.n} times; you played ${top[0]} ${top[1][0] === s.n ? 'every time' : `${top[1][0]} times`} (${Math.round(100 * top[1][1] / top[1][0])}%). The course move is new.`;
}

// ---------- engine ----------
const ENGINE = path.join(ROOT, 'engine/stockfish-19-lite-single.js');
class Uci {
  constructor() { this.p = spawn(process.execPath, [ENGINE], { cwd: path.dirname(ENGINE) }); this.buf = ''; this.wait = null; this.p.stdout.on('data', d => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); if (this.wait) this.wait(l); } }); this.send('uci'); this.send('setoption name Hash value 64'); }
  send(c) { this.p.stdin.write(c + '\n'); }
  go(fen, depth, multipv, searchmoves) { return new Promise(res => { const L = {}; this.wait = l => { if (l.startsWith('info') && l.includes(' pv ') && l.includes(' score ') && !/bound/.test(l)) { const mp = +(/ multipv (\d+)/.exec(l) || [0, 1])[1]; const sc = / score (cp|mate) (-?\d+)/.exec(l); L[mp] = { s: sc[1] === 'cp' ? +sc[2] : (+sc[2] > 0 ? 10000 : -10000), pv: l.slice(l.indexOf(' pv ') + 4).split(' ') }; } else if (l.startsWith('bestmove')) { this.wait = null; res(Object.values(L)); } }; this.send(`setoption name MultiPV value ${multipv}`); this.send('position fen ' + fen); this.send(`go depth ${depth}${searchmoves ? ' searchmoves ' + searchmoves : ''}`); }); }
  quit() { this.p.kill(); }
}

// ---------- walk the tree into cards ----------
const cards = []; const byKey = new Map(); const problems = [];
function walk(nodes, line, branch, parentPlan) {
  for (const nd of nodes) {
    const p = new Pos(); for (const s of line) if (!p.play(s)) throw new Error('illegal line ' + line.join(' '));
    if (!p.play(nd.w)) throw new Error(`illegal White move ${nd.w} after ${line.join(' ')}`);
    const k = fen4(p); const fen = p.fen(); const lineTo = [...line, nd.w];
    if (!p.parseSan(nd.b)) throw new Error(`illegal Black move ${nd.b} after ${lineTo.join(' ')}`);
    const br = nd.branch || branch;
    if (!byKey.has(k)) {
      const card = { id: 'nc6:' + k.replace(/[\s/]/g, ''), course: 'nc6', branch: br, order: cards.length, fen, line: lineTo, oppMove: nd.w, move: nd.b, explain: nd.x, plan: nd.plan || parentPlan || null, leaf: !nd.kids, stat: stat(k, nd.b), alts: [], continuation: [nd.b], transposition: false, ref: null, player: 'Your system' };
      cards.push(card); byKey.set(k, card);
    } else if (san0(byKey.get(k).move) !== san0(nd.b)) problems.push(`transposition with a different move at ${lineTo.join(' ')}`);
    if (nd.kids) walk(nd.kids, [...lineTo, nd.b], br, nd.plan || parentPlan);
  }
}
walk(TREE, [], '', null);
// continuation: the main line below each card (first child), else the engine line
for (const c of cards) { const p = new Pos(c.fen); p.play(c.move); let cur = c; const cont = [c.move];
  for (let d = 0; d < 2; d++) { const next = cards.find(x => x.line.length === cur.line.length + 2 && x.line.slice(0, -1).join(' ') === [...cur.line, cur.move].join(' ')); if (!next) break; cont.push(next.oppMove, next.move); cur = next; }
  c.continuation = cont; }

// ---------- Stockfish check of every move I recommend ----------
const N = Math.max(1, Math.min(4, (await import('os')).cpus().length));
const es = Array.from({ length: N }, () => new Uci()); let next = 0;
await Promise.all(es.map(async e => { while (next < cards.length) { const c = cards[next++];
  const r = await e.go(c.fen, 16, 4); const best = r[0]; const p = new Pos(c.fen); const bestSan = p.uciToSan(best.pv[0]);
  const uci = new Pos(c.fen).sanToUci(c.move); let mine = r.find(x => x.pv[0] === uci);
  if (!mine) { const m = await e.go(c.fen, 16, 1, uci); mine = m[0]; }
  c.sf = { best: bestSan, gap: best.s - mine.s, cp: -mine.s };
  // engine line after my move fills short continuations
  if (c.continuation.length < 3) { const q = new Pos(c.fen); const pv = mine.pv.slice(0, 5).map(u => { const s = q.uciToSan(u); if (s) q.play(s); return s; }).filter(Boolean); if (pv.length > c.continuation.length) c.continuation = pv; }
} }));
es.forEach(e => e.quit());

console.log(`${cards.length} cards`);
for (const c of cards) console.log(`${(c.sf.gap > 60 ? '!! ' : '   ')}${c.line.join(' ').padEnd(36)} ${c.move.padEnd(6)} gap ${String(c.sf.gap).padStart(4)}  SF ${c.sf.best.padEnd(6)} | ${c.continuation.join(' ')}`);
if (problems.length) console.log('PROBLEMS', problems);
const NAMES = { closed: 'Locked centre (d5)', recapture: '2.d4 e5 3.dxe5 Nxe5', philidor: 'Scotch type: …d6', steinitz: '…d6 against Bb5 (Old Steinitz)', queenless: 'Queens off after dxe5', schliemann: 'Schliemann (3.Bb5 f5)', semiItalian: 'Quiet Italian (3.Bc4 d6)', fourKnights: 'Four Knights', vienna: 'Vienna (2.Nc3 e5 3.Bc4)', gambit: 'Vienna Gambit (3.f4 exf4)', tango: 'Knight Tango', tangoOpen: 'Tango: 4.Nf3 exd4' };
const used = new Set(cards.map(c => c.plan)); const plans = Object.entries(PLAN).filter(([, t]) => used.has(t)).map(([k, t]) => ({ branch: NAMES[k], text: t }));
const out = { built: new Date().toISOString().slice(0, 10), note: 'My 1…Nc6 system. Moves checked with Stockfish 19 lite (depth 16) and counted in my own games. Built by tools/build-nc6.mjs.',
  courses: [{ id: 'nc6', title: 'My system — 1…Nc6 as Black', player: 'Your system', color: 'b', games: games.length, plans, cards: cards.map(({ sf, ...c }) => ({ ...c, explain: c.explain })) }] };
fs.writeFileSync(path.join(ROOT, 'data/nc6.json'), JSON.stringify(out));
console.log('wrote data/nc6.json', JSON.stringify(out).length, 'bytes;', plans.length, 'plans');

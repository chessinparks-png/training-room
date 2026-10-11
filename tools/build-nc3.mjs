// My 1.Nc3 system as White (Chessable-style course, data/nc3.json).
//   1…d5 / 1…e6 / 1…c6 / 1…Nc6 → 2.d4 and the Jobava (Bortnyk: 4.e4 against …c5)
//   1…e5 → 2.e4 Vienna: 3.f4 only against …Nf6; otherwise Bc4 / d3 first and f4 later (no King's Gambit)
//   1…Nf6 → 2.e4 (Aborigen100500): …e5 3.f4, …d6 → 150 Attack, …d5 3.exd5
//   1…c5 → 2.e4 and the Grand Prix (f4) · 1…g6 / 1…d6 → 2.e4 and the 150 Attack (Be3, Qd2, Bh6, O-O-O, h4)
// White's moves: a forced system move, else the branch's model player's main blitz move, checked with the bundled
// Stockfish (a model move ≥1 pawn worse than the engine's choice is replaced). Black's replies: the ones that recur
// in the model games and my own games. Explanations and plans are written per system.
//   node tools/build-nc3.mjs        build data/nc3.json
import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process';
import { splitGames, parseHeaders, movetextTokens, normalizeMoves } from '../js/data/pgn.js';
import { Pos, mFrom, mTo } from '../js/chess/core.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fen4 = p => p.fen().split(' ').slice(0, 4).join(' ');
const PLIES = 22;

// ---------- sources ----------
const MODELS = { bortnyk: ['bortnyk-white.pgn', 'oleksandr_bortnyk', 'Bortnyk'], aborigen: ['aborigen-white.pgn', 'aborigen100500', 'Aborigen100500'],
  ginger: ['gingergm-white.pgn', 'ginger_gm', 'Ginger GM'], wgraif: ['wgraif-white.pgn', 'wgraif', 'wgraif'], tahbaz: ['tahbaz-white.pgn', 'arash-tahbaz', 'Arash Tahbaz'] };
const node = new Map(); // fen4 -> { w: {model: {san: n}}, b: {san: n}, ref: {model+san: {link, oppElo}} }
const get = k => { let x = node.get(k); if (!x) node.set(k, x = { w: {}, b: {}, ref: {} }); return x; };
function add(moves, src, white, meta) {
  const p = new Pos();
  for (let i = 0; i < Math.min(PLIES, moves.length); i++) {
    const x = get(fen4(p)); const san = moves[i];
    if (i % 2 === 0) { if (white) { const o = x.w[src] = x.w[src] || {}; o[san] = (o[san] || 0) + 1; const r = x.ref[src + san]; if (meta.link && (!r || meta.oppElo > r.oppElo)) x.ref[src + san] = meta; } }
    else x.b[san] = (x.b[san] || 0) + 1;
    if (!p.play(san)) break;
  }
}
for (const [id, [file, handle]] of Object.entries(MODELS)) {
  let n = 0;
  for (const raw of splitGames(fs.readFileSync(path.join(ROOT, 'raw/models', file), 'utf8'))) {
    const h = parseHeaders(raw); if ((h.White || '').toLowerCase() !== handle) continue;
    const mv = normalizeMoves(movetextTokens(raw).sans, null, PLIES).moves; if (mv.length < 6) continue; n++;
    add(mv, id, true, { link: h.Link || '', opp: h.Black, oppElo: +h.BlackElo || 0, date: (h.UTCDate || h.Date || '').replace(/\./g, '-') });
  }
  MODELS[id].push(n);
}
// my own White games: Black's replies only (what my opponents actually play)
let mine = 0;
for (const f of fs.readdirSync(path.join(ROOT, 'raw/games')).filter(f => f.endsWith('.pgn')))
  for (const raw of splitGames(fs.readFileSync(path.join(ROOT, 'raw/games', f), 'utf8'))) { const h = parseHeaders(raw); if ((h.White || '').toLowerCase() !== 'localchessexpert') continue; mine++; add(normalizeMoves(movetextTokens(raw).sans, null, PLIES).moves, 'me', false, {}); }

// ---------- the system ----------
const FORCE = {
  '': 'Nc3',
  'Nc3 d5': 'd4', 'Nc3 e6': 'd4', 'Nc3 c6': 'd4', 'Nc3 Nc6': 'd4', 'Nc3 Nf6': 'e4', 'Nc3 e5': 'e4', 'Nc3 c5': 'e4', 'Nc3 g6': 'e4', 'Nc3 d6': 'e4',
  // Jobava move order
  'Nc3 d5 d4 Nf6': 'Bf4', 'Nc3 Nf6 e4 d5': 'exd5', 'Nc3 e6 d4 d5': 'e4',
  // Vienna: f4 only against …Nf6; d3/Bc4 first otherwise
  'Nc3 e5 e4 Nf6': 'f4', 'Nc3 e5 e4 Nc6': 'Bc4', 'Nc3 e5 e4 Bc5': 'Bc4', 'Nc3 e5 e4 Bb4': 'Nf3', 'Nc3 Nf6 e4 e5': 'f4',
  // Grand Prix
  'Nc3 c5 e4 Nc6': 'f4', 'Nc3 c5 e4 d6': 'f4', 'Nc3 c5 e4 e6': 'f4', 'Nc3 c5 e4 g6': 'f4', 'Nc3 c5 e4 a6': 'f4',
  // 150 Attack
  'Nc3 g6 e4 Bg7': 'd4', 'Nc3 g6 e4 Bg7 d4 d6': 'Be3', 'Nc3 g6 e4 Bg7 d4 c6': 'Be3', 'Nc3 d6 e4 Nf6': 'd4', 'Nc3 d6 e4 Nf6 d4 g6': 'Be3', 'Nc3 Nf6 e4 d6': 'd4', 'Nc3 Nf6 e4 d6 d4 g6': 'Be3',
  'Nc3 d6 e4 g6': 'd4', 'Nc3 g6 e4 d6': 'd4',
};
// Black replies to cover even when they are rare in the model games (my own weak lines, the Vienna)
const EXTRA = { 'Nc3 d5 d4': ['Bf5'], 'Nc3 d5 d4 Nf6 Bf4': ['Bf5'], 'Nc3 e5 e4': ['Nc6', 'Bc5', 'Nf6'], 'Nc3 e5 e4 Nc6 Bc4': ['Nf6', 'Bc5'], 'Nc3 e5 e4 Bc5': ['Nf6', 'Nc6'] };
FORCE['Nc3 e5 e4 Nc6 Bc4 Nf6'] = 'd3'; FORCE['Nc3 e5 e4 Nc6 Bc4 Bc5'] = 'd3'; FORCE['Nc3 e5 e4 Bc5 Bc4 Nf6'] = 'd3'; FORCE['Nc3 e5 e4 Bc5 Bc4 Nc6'] = 'd3';
const branchOf = line => {
  const s = line.join(' ');
  if (/^Nc3 (e6 d4 d5 e4|d5 d4 e6 e4|Nc6 d4 d5 e4 e6)/.test(s)) return 'French';
  if (/^Nc3 (d5 d4|e6 d4|c6 d4|Nc6 d4)/.test(s)) return 'Jobava';
  if (/^Nc3 (e5 e4|Nf6 e4 e5)/.test(s)) return 'Vienna';
  if (/^Nc3 c5 e4/.test(s)) return 'Grand Prix';
  if (/^Nc3 (g6 e4|d6 e4)/.test(s) || /^Nc3 Nf6 e4 d6/.test(s)) return '150 Attack';
  if (/^Nc3 Nf6 e4/.test(s)) return '1…Nf6 2.e4';
  return '1.Nc3';
};
const MODEL_ORDER = { Jobava: ['bortnyk', 'aborigen', 'ginger'], French: ['aborigen', 'bortnyk'], Vienna: ['aborigen', 'tahbaz', 'wgraif'], 'Grand Prix': ['wgraif', 'tahbaz', 'aborigen'], '150 Attack': ['aborigen', 'ginger', 'wgraif'], '1…Nf6 2.e4': ['aborigen', 'wgraif'], '1.Nc3': ['aborigen'] };
const MAXW = { Jobava: 7, French: 6, Vienna: 6, 'Grand Prix': 6, '150 Attack': 6, '1…Nf6 2.e4': 6, '1.Nc3': 2 };

const PLAN = {
  Jobava: 'Jobava: Bf4, e3, Bd3, Qf3 or Qd2 and castle long; Nb5 hits c7 whenever …a6 is missing. If Black castles short, g4–h4–h5 with the rooks on the g- and h-files.',
  JobavaC5: 'Against …c5, Bortnyk plays e4 at once: the centre opens on his terms before …cxd4 and …a6 can happen. Develop quickly (Bb5+, Nf3, O-O-O or O-O) and use the lead.',
  JobavaBf5: 'Against …Bf5: f3, g4 and h4 hunt the bishop and gain kingside space; e3, Qd2 and O-O-O follow.',
  French: 'French by transposition: e4–e5 closes the centre; then f4, Nf3, and a kingside attack with Qg4 or the f-pawn.',
  ViennaGambit: 'Vienna Gambit: after fxe5 the e5-pawn cramps Black; Nf3, d3 or Qe2 to challenge the e4-knight, then castle and use the f-file.',
  Vienna: 'Vienna without King\'s Gambit: Bc4, d3, Nf3 or Nge2, castle, and only then f4 — after …exf4, Bxf4 is a free developing move. Attack on the f-file.',
  GrandPrix: 'Grand Prix: f4, Nf3, Bb5 or Bc4, O-O, d3, then Qe1–h4 and f5. All White\'s pieces go to the kingside.',
  Attack150: '150 Attack: Be3, Qd2, f3, Bh6 to trade the g7-bishop, O-O-O and h4–h5. Open the h-file against the castled king.',
  Nf6e4: 'After 1…Nf6 2.e4: take space and develop (Nf3, Bc4 or d4), castle and aim the pieces at the kingside.',
};
const planOf = line => { const b = branchOf(line); const s = line.join(' ');
  if (b === 'Jobava') return /c5 e4/.test(s) ? PLAN.JobavaC5 : /Bf5/.test(s) && / f3/.test(s) ? PLAN.JobavaBf5 : PLAN.Jobava;
  if (b === 'Vienna') return / f4/.test(s.split(' ').slice(0, 6).join(' ')) && /(Nf6|e5) f4/.test(s) ? PLAN.ViennaGambit : PLAN.Vienna;
  return { French: PLAN.French, 'Grand Prix': PLAN.GrandPrix, '150 Attack': PLAN.Attack150, '1…Nf6 2.e4': PLAN.Nf6e4 }[b] || PLAN.Jobava; };

// one-sentence reasons: by system, then by move, then a generic description
const IDEA = {
  all: { 'O-O-O': 'Castle long: the king is safe and the rooks join a kingside attack.', 'O-O': 'Castle and finish development before the centre opens.' },
  Jobava: { d4: 'Take the centre: with the knight already on c3 this is a Jobava London.', Bf4: 'The second Jobava piece: the bishop eyes c7, with Nb5 ideas.', e3: 'Support d4 and free the f1-bishop.', Bd3: 'Develop toward the kingside; the bishop aims at h7.',
    Nf3: 'Develop and control e5; Ne5 often follows.', Nb5: 'Nb5 hits c7, the recurring Jobava target.', e4: 'Break with e4: open the centre while Black is undeveloped.', Qd2: 'Prepare long castling.', Qf3: 'The queen eyes d5 and f7 and makes room for long castling.',
    h3: 'Keep …Bg4 and …Ng4 out.', Nge2: 'Develop and keep the f-pawn free for f3.', f3: 'Prepare g4 and take e4 from Black\'s pieces.', g4: 'Gain space and hit the bishop: the kingside pawns start the attack.', h4: 'Gain kingside space, with h5 in mind.',
    a3: 'Stop …Bb4 and …Nb4.', Qb3: 'Hit b7 and d5 at once.', Bg5: 'Pin the knight and add pressure on d5.', b4: 'Gain queenside space and chase the bishop.', a4: 'Gain queenside space; b4 or a5 can follow.', Na4: 'Head for c5, where the knight presses on Black\'s queenside.', Bb5: 'Pin the c6-knight.', Bxc6: 'Trade the defender of d4 and e5.', Be2: 'Develop quietly and get ready to castle.', Bxf6: 'Take the knight: Black recaptures and loses central control or the pawn structure.', Qg4: 'Hit g7: the queen joins the kingside attack.', Ne2: 'Reroute the knight toward f4 or g3.', d5: 'Gain space and push the knight away.', Bc4: 'Develop toward f7.', Bd2: 'Unpin quietly.', Bxa6: 'Take the knight: Black\'s queenside pawns are damaged.', dxc5: 'Take on c5: Black spends a tempo winning the pawn back.', Qxd4: 'Recapture with the queen, keeping the pieces active.', exd5: 'Open the e-file and the diagonals while you are ahead in development.', c3: 'Solid: support d4.', Bxd6: 'Take the defender and damage the pawns.', Ne5: 'The knight jumps to e5, its best square in this structure.' },
  French: { Bg5: 'Pin the knight: e5 next will gain space with tempo.', Qg4: 'Hit g7: the queen joins the kingside attack.', h4: 'Gain kingside space: the h-pawn supports the attack.', Bd3: 'Develop toward h7.', Nxe4: 'Recapture in the centre.', e4: 'Take the full centre: this is a French with Nc3.', e5: 'Close the centre and gain space on the kingside.', Nf3: 'Develop and support e5.', f4: 'Back up e5 with the f-pawn: the kingside attack comes next.' },
  Vienna: { e4: 'Claim the centre: a Vienna Game.', f4: 'Against …Nf6 the early f4 is safe: …exf4 is met by e5 and the knight has to move.', fxe5: 'Take and gain space: the e5-pawn cramps Black\'s knight.', Nf3: 'Develop and support the centre.', Bc4: 'Develop toward f7 before pushing f4.', d3: 'Support e4 so f4 can come later without a gambit.', Qe2: 'Challenge the e4-knight and pin along the e-file.', Nxe4: 'Recapture in the centre.', Qf3: 'Hit the e4-knight and f7.', Qg3: 'Keep the queen active and eye g7.', Bb5: 'Pin the c6-knight against the e8 king.' },
  'Grand Prix': { e4: 'Claim the centre; f4 comes next.', f4: 'The Grand Prix push: kingside space, and f5 later opens lines toward the king.', Nf3: 'Develop and control d4 and e5.', Bb5: 'Pin or trade the c6-knight to fight for d4 and e5.', Bc4: 'Aim at f7 and e6.', 'O-O': 'Castle short: the rook backs up the f-pawn.', d3: 'Solid support for e4.', Qe1: 'The Grand Prix queen lift: Qe1–h4.', Qh4: 'The queen joins the kingside attack.', f5: 'Open lines toward the king.', Bxc6: 'Trade the knight that defends d4 and e5.' },
  '150 Attack': { e4: 'Take the centre.', d4: 'Two centre pawns: the 150 Attack set-up comes next.', Be3: 'The 150 Attack bishop: it heads for h6 to trade Black\'s best piece.', Qd2: 'Queen and bishop on one diagonal: Bh6 next.', f3: 'Support e4 and prepare g4.', Bh6: 'Trade the g7-bishop: the dark squares around Black\'s king become weak.', h4: 'Open the h-file: the h-pawn leads the attack.', h5: 'Pry open the h-file.', Nf3: 'Develop and control e5.', Bd3: 'Develop and aim at the king.', Nd5: 'Centralise with tempo.', Bc4: 'Develop with an eye on f7.', a4: 'Stop …b5 before you castle long.' },
  '1…Nf6 2.e4': { e4: 'Take the centre: Black must show a plan.', exd5: 'Take on d5: the centre opens while you develop faster.', Nf3: 'Develop and keep d4 in reserve.', Bc4: 'Develop with an eye on f7.', d4: 'Take the full centre.', e5: 'Gain space and chase the knight.', Bb3: 'Keep the bishop on the a2–g8 diagonal, safe from …Na5 and …Nb6.', Qf3: 'Hit f7 and the d5-knight; the queen also prepares long castling.', Nge2: 'Develop and keep the f-pawn free to advance.' },
};
function explain(line, san, fen) {
  if (!line.length) return 'The Van Geet: develop first and choose d4 or e4 after Black shows a plan.';
  const b = branchOf([...line, san]); const d = (IDEA[b] && IDEA[b][san]) || IDEA.all[san]; if (d) return d;
  const p = new Pos(fen); const m = p.parseSan(san); const last = line.length ? line[line.length - 1] : '';
  const piece = { N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' }[san[0]] || 'pawn'; const to = san.replace(/[+#]/g, '').slice(-2);
  if (san.includes('x')) return last.replace(/[+#]/g, '').slice(-2) === to ? `Recapture with the ${piece}.` : `Take on ${to} with the ${piece}.`;
  if (san.includes('+')) return `Check with the ${piece}, gaining time.`;
  if (piece === 'king') return `Step the king to ${to}: it is safe there for now.`;
  if (/^[gh][45]$/.test(san)) return 'Kingside pawn storm: gain space toward the king.';
  if (piece === 'pawn') return `${san}: gain space and support the centre.`;
  const fr = m ? mFrom(m) >> 4 : 0, tr = m ? mTo(m) >> 4 : 0;
  if (tr < fr) return `Bring the ${piece} back to ${to}: it is safer there and still useful.`;
  if (fr === 0) return `Develop the ${piece} to ${to}.`;
  return `Improve the ${piece}: it goes to ${to}.`;
}

// ---------- engine ----------
const ENGINE = path.join(ROOT, 'engine/stockfish-19-lite-single.js');
class Uci {
  constructor() { this.p = spawn(process.execPath, [ENGINE], { cwd: path.dirname(ENGINE) }); this.buf = ''; this.wait = null; this.p.stdout.on('data', d => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); if (this.wait) this.wait(l); } }); this.send('uci'); this.send('setoption name Hash value 64'); }
  send(c) { this.p.stdin.write(c + '\n'); }
  go(fen, depth, multipv = 1, searchmoves) { return new Promise(res => { const L = {}; this.wait = l => { if (l.startsWith('info') && l.includes(' pv ') && l.includes(' score ') && !/bound/.test(l)) { const mp = +(/ multipv (\d+)/.exec(l) || [0, 1])[1]; const sc = / score (cp|mate) (-?\d+)/.exec(l); L[mp] = { s: sc[1] === 'cp' ? +sc[2] : (+sc[2] > 0 ? 10000 : -10000), pv: l.slice(l.indexOf(' pv ') + 4).split(' ') }; } else if (l.startsWith('bestmove')) { this.wait = null; res(Object.values(L)); } }; this.send(`setoption name MultiPV value ${multipv}`); this.send('position fen ' + fen); this.send(`go depth ${depth}${searchmoves ? ' searchmoves ' + searchmoves : ''}`); }); }
  quit() { this.p.kill(); }
}
const E = new Uci(); const DEPTH = 14; const cache = new Map();
const evalBest = async fen => { if (!cache.has(fen)) cache.set(fen, await E.go(fen, DEPTH, 2)); return cache.get(fen); };

// ---------- walk ----------
const cards = []; const seen = new Set(); const log = [];
const top = o => Object.entries(o || {}).sort((a, b) => b[1] - a[1]);
async function white(p, line, wCount, engineRun) {
  const k = fen4(p); if (seen.has(k)) return; seen.add(k);
  const b = branchOf(line); if (wCount >= (MAXW[b] || 6)) return;
  const x = node.get(k) || { w: {}, b: {}, ref: {} }; const key = line.join(' ');
  let move = FORCE[key] || null, source = move ? 'system' : null, share = null, n = 0, model = null;
  if (!move) for (const m of MODEL_ORDER[b] || []) { const o = x.w[m]; const tot = Object.values(o || {}).reduce((a, c) => a + c, 0); if (tot >= 5) { [move] = top(o)[0]; share = top(o)[0][1] / tot; n = tot; model = m; source = 'model'; break; } }
  const fen = p.fen(); const ev = await evalBest(fen); const bestSan = new Pos(fen).uciToSan(ev[0].pv[0]);
  if (!move) { if (engineRun >= 2) return; move = bestSan; source = 'engine'; }
  // check the move with the engine
  const u = new Pos(fen).sanToUci(move); let mineEv = ev.find(e => e.pv[0] === u); if (!mineEv) mineEv = (await E.go(fen, DEPTH, 1, u))[0];
  const gap = ev[0].s - mineEv.s;
  if (gap >= 80 && source !== 'system') { log.push(`replaced ${key} ${move} (−${(gap / 100).toFixed(1)}) by ${bestSan}`); move = bestSan; source = 'engine'; }
  if (gap >= 100 && source === 'system') log.push(`SYSTEM MOVE ${key} ${move} is −${(gap / 100).toFixed(1)} vs ${bestSan}`);
  const ref = model && x.ref[model + move]; const mp = MODELS[model];
  const stat = source === 'model' ? `${mp[2]} played ${move} in ${Math.round(share * 100)}% of ${n} blitz games here.` : source === 'system' ? 'System move: this is how the 1.Nc3 repertoire is built.' : 'Stockfish\'s choice (no model games reach this position).';
  const card = { k, fen, line: line.slice(), move, source, gap, branch: branchOf([...line, move]), stat, ref: ref ? { link: ref.link, opp: ref.opp, oppElo: ref.oppElo, date: ref.date } : null, player: model ? mp[2] : 'Your system' };
  cards.push(card);
  const q = new Pos(fen); q.play(move); await black(q, [...line, move], wCount + 1, source === 'engine' ? engineRun + 1 : 0);
}
async function black(p, line, wCount, engineRun) {
  const k = fen4(p); const x = node.get(k); const reps = top(x && x.b); const tot = reps.reduce((a, [, c]) => a + c, 0);
  const first = line.length === 1; // after 1.Nc3: every first move that the system answers
  // early in a line, cover more of Black's options (e.g. 2.d4 Bf5); later, only the main replies
  const early = line.length <= 5; const minC = tot >= 50 ? 5 : 2;
  let pick = reps.filter(([m, c]) => c >= minC && (first ? FORCE['Nc3 ' + m] : c / tot >= (early ? 0.06 : 0.12))).slice(0, first ? 9 : early ? 5 : 3).map(([m]) => m);
  for (const m of EXTRA[line.join(' ')] || []) if (!pick.includes(m)) pick.push(m);
  if (!pick.length && engineRun < 2) { const ev = await evalBest(p.fen()); pick = [new Pos(p.fen()).uciToSan(ev[0].pv[0])]; engineRun++; }
  for (const m of pick) { const q = new Pos(p.fen()); if (!q.play(m)) continue; await white(q, [...line, m], wCount, engineRun); }
}
await white(new Pos(), [], 0, 0);
E.quit();

// ---------- cards ----------
const byLine = new Map(cards.map(c => [c.line.join(' '), c]));
const out = cards.map((c, i) => {
  const kids = cards.filter(d => d.line.length === c.line.length + 2 && d.line.slice(0, c.line.length + 1).join(' ') === [...c.line, c.move].join(' '));
  const cont = [c.move]; let cur = c; for (let j = 0; j < 2; j++) { const nx = cards.find(d => d.line.length === cur.line.length + 2 && d.line.slice(0, cur.line.length + 1).join(' ') === [...cur.line, cur.move].join(' ')); if (!nx) break; cont.push(nx.line[nx.line.length - 1], nx.move); cur = nx; }
  return { id: 'nc3:' + c.k.replace(/[\s/]/g, ''), course: 'nc3', branch: c.branch, order: i, fen: c.fen, line: c.line, oppMove: c.line.length ? c.line[c.line.length - 1] : null, move: c.move,
    explain: explain(c.line, c.move, c.fen), plan: planOf([...c.line, c.move]), leaf: !kids.length, stat: c.stat, alts: [], continuation: cont, transposition: false, ref: c.ref, player: c.player, source: c.source };
});
const used = new Set(out.map(c => c.plan)); const NAMES = { Jobava: 'Jobava', JobavaC5: 'Jobava: 4.e4 against …c5', JobavaBf5: 'Jobava: f3–g4 against …Bf5', French: 'French with e5', ViennaGambit: 'Vienna Gambit (…Nf6 3.f4)', Vienna: 'Vienna: f4 later', GrandPrix: 'Grand Prix', Attack150: '150 Attack', Nf6e4: '1…Nf6 2.e4' };
const plans = Object.entries(PLAN).filter(([, t]) => used.has(t)).map(([k, t]) => ({ branch: NAMES[k], text: t }));
const by = {}; for (const c of out) by[c.branch] = (by[c.branch] || 0) + 1;
const src = {}; for (const c of out) src[c.source] = (src[c.source] || 0) + 1;
console.log(`models: ${Object.entries(MODELS).map(([k, v]) => `${k} ${v[3]}`).join(', ')} · my White games ${mine}`);
console.log(`${out.length} cards · ${out.filter(c => c.leaf).length} line ends · by branch ${JSON.stringify(by)} · by source ${JSON.stringify(src)}`);
log.forEach(l => console.log('  ' + l));
if (process.argv.includes('--list')) for (const c of out) console.log(`${c.branch.padEnd(12)} ${c.line.join(' ').padEnd(44)} ${c.move.padEnd(6)} [${c.source}${cards[c.order].gap > 40 ? ' gap ' + cards[c.order].gap : ''}] ${c.explain}`);
const data = { built: new Date().toISOString().slice(0, 10), note: 'My 1.Nc3 system. White moves from model players\' blitz games (Bortnyk, Aborigen100500, Ginger GM, wgraif, Arash Tahbaz) or system choices, each checked with Stockfish 19 lite (depth 14). Built by tools/build-nc3.mjs.',
  courses: [{ id: 'nc3', title: 'My system — 1.Nc3 as White', player: 'Your system', color: 'w', games: Object.values(MODELS).reduce((a, v) => a + v[3], 0), plans, cards: out.map(({ source, ...c }) => c) }] };
fs.writeFileSync(path.join(ROOT, 'data/nc3.json'), JSON.stringify(data));
console.log('wrote data/nc3.json', JSON.stringify(data).length, 'bytes');

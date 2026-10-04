// Builds data/canty.json from data/source/canty-white.pgn: Canty's recurring decision points in
// 1.d4 / 2.Nc3 systems (repertoire trainer) and a small set of 3+2 clock-decision positions.
// Positions are curated by (game, White move number) and checked against the actual game move.
// Usage: node tools/build-canty.mjs
import fs from 'fs';
import { splitGames, parseHeaders, movetextTokens } from '../js/data/pgn.js';
import { Pos } from '../js/chess/core.js';

const ROOT = new URL('..', import.meta.url).pathname;
const games = [...splitGames(fs.readFileSync(ROOT + 'data/source/canty-white.pgn', 'utf8'))].map(raw => {
  const h = parseHeaders(raw); return { h, sans: movetextTokens(raw).sans };
});

export const GROUPS = [
  { id: 'd5', name: '1…d5', full: '1…d5 · Jobava main line' },
  { id: 'e5', name: '1…e5', full: '1…e5 · Englund-style gambits' },
  { id: 'b6', name: '1…b6', full: '1…b6 · English Defence' },
  { id: 'other', name: 'Others', full: '1…e6 · 1…d6 · 1…Nc6 · 1…g6' },
];

// [game (1-based, file order), White move number, Canty's move, group, theme, why]
const POINTS = [
  [1, 3, 'Bf4', 'd5', 'Set-up', 'Bf4 before e3: the Jobava set-up. c7 is already a target for Nb5.'],
  [1, 4, 'e3', 'd5', 'Set-up', 'Calm e3: supports d4 and frees the f1-bishop. No need to push d5.'],
  [1, 5, 'dxc5', 'd5', 'Structure', '…a6 stopped Nb5, so take on c5. Black spends a tempo getting it back.'],
  [1, 7, 'Bd3', 'd5', 'Set-up', 'Bd3, O-O, then Ne2–d4: every piece points at Black\'s king.'],
  [9, 5, 'Nb5', 'd5', 'c7 target', '…b6 left c7 weak. Nb5 hits c7 with the Bf4 behind it.'],
  [9, 6, 'Bxe5', 'd5', 'Tactic', 'Free pawn: Bf4 and d4 both hit e5.'],
  [10, 6, 'Nc7+', 'd5', 'c7 target', 'Nc7+ forks king and rook. Only the queen guarded c7.'],

  [5, 3, 'dxe5', 'e5', 'Centre', 'Take the pawn. Black\'s lead in development is too small to fear.'],
  [5, 4, 'exd6', 'e5', 'Centre', 'Simple: exd6, then e4 turns the extra tempo into a centre.'],
  [5, 5, 'e4', 'e5', 'Centre', 'Grab the centre now. e4 opens the c1-bishop and the queen.'],
  [5, 6, 'Bd3', 'e5', 'Set-up', 'Bd3 + Nge2: guards e4 without walking into a …Bg4 pin.'],
  [11, 6, 'Bd3', 'e5', 'Set-up', 'Same set-up vs …Be6: Bd3, Nge2, Be3. No Nf3.'],
  [5, 7, 'Nge2', 'e5', 'Set-up', 'Nge2, not Nf3: no …Bg4 pin and the f-pawn stays free.'],
  [7, 8, 'Be3', 'e5', 'Set-up', 'Be3: the bishop eyes a7 if Black castles long.'],
  [7, 9, 'Nb5', 'e5', 'c7 target', 'Black castled long: Nb5 hits a7 and the d6-bishop.'],
  [5, 9, 'Nd5', 'e5', 'c7 target', 'Nd5 hits the queen and eyes c7. Knights love d5/b5 vs …O-O-O.'],
  [7, 10, 'Nxa7+', 'e5', 'Tactic', 'Nxa7+! Bxa7 follows and the bishops swarm b8/b7.'],
  [7, 12, 'Ba6#', 'e5', 'Tactic', 'Ba6 mate: the a7-bishop covers b8, the a6-bishop b7.'],

  [2, 3, 'Bf4', 'b6', 'Set-up', 'Bf4 anyway: Jobava set-up first, the centre comes next.'],
  [2, 4, 'e4', 'b6', 'Centre', 'Nc3 already supports e4. Take the square Bb7 is aiming at.'],
  [2, 5, 'e5', 'b6', 'Centre', 'e5 with tempo: the knight must go to d5 or e4.'],
  [3, 4, 'e3', 'b6', 'Set-up', 'Against the double fianchetto: e3 + Nf3, with Ng5 and Bc4 ideas.'],
  [3, 6, 'Ng5', 'b6', 'f7 target', 'Ng5 + Bc4 hits f7. Black\'s king is still in the centre.'],
  [3, 7, 'Bc4', 'b6', 'f7 target', 'Bc4: the second attacker on f7 and e6.'],
  [3, 8, 'Bxe6', 'b6', 'Tactic', 'Bxe6! If …fxe6, Nxe6 forks the queen and g7.'],

  [19, 4, 'd5', 'other', 'c7 target', 'd5! Push past c5. If …exd5 Nxd5, c7 is hit again.'],
  [19, 5, 'Nxd5', 'other', 'c7 target', 'Recapture with the knight: from d5 it eyes c7.'],
  [19, 6, 'Nc7+', 'other', 'c7 target', 'Nc7+: the same fork, knight + Bf4 on c7.'],
  [8, 3, 'Bf4', 'other', 'Set-up', 'Bf4 vs …d6 too: it makes …e5 harder to achieve.'],
  [8, 4, 'e4', 'other', 'Centre', '…Nbd7 doesn\'t fight for e4. Take the full centre.'],
  [8, 7, 'Qd2', 'other', 'Storm', 'Qd2 and O-O-O: opposite castling, then the pawns go.'],
  [8, 9, 'h4', 'other', 'Storm', '…h6 is a hook. h4 and g4–g5 open lines on the king.'],
  [8, 11, 'g4', 'other', 'Storm', 'g4–g5: your storm is faster than his queenside pawns.'],
  [4, 8, 'g4', 'other', 'Storm', 'Black castled short, your king is central: g4–g5 kicks the f6-knight.'],
  [12, 4, 'e3', 'other', 'Set-up', 'e3 vs …c5: support d4 and meet …cxd4 with exd4.'],
  [12, 6, 'Qd2', 'other', 'Storm', 'Qd2 + O-O-O, with Bh6 ideas against the fianchetto.'],
];

// Clock decisions: [game, move, Canty's move, also-accepted, cat, my secs, opp secs, why]
const CLOCK = [
  [2, 7, 'bxc3', [], 'routine', 158, 151, 'Forced recapture. Play it instantly.'],
  [4, 6, 'bxc3', [], 'routine', 165, 160, 'Check, one sensible reply. No time needed.'],
  [1, 14, 'exd4', ['Nxd4'], 'routine', 121, 104, 'Recapture. Both recaptures are fine. Save the clock.'],
  [1, 17, 'dxe5', ['Rxe5'], 'routine', 109, 88, 'Recapture the bishop. Nothing else to consider.'],
  [7, 11, 'Bxa7', [], 'routine', 138, 129, 'Take back. The follow-up comes next move.'],
  [10, 7, 'Bxc7', [], 'routine', 157, 140, 'Win the queen back. Obvious recapture.'],
  [1, 18, 'Bxd8', [], 'think', 104, 81, 'The queen is loose. A short check that nothing is hanging back.'],
  [9, 6, 'Bxe5', [], 'think', 162, 150, 'A free pawn. Check …Bb4 / …Qa5+ tricks, then take.'],
  [2, 5, 'e5', [], 'think', 166, 158, 'Several good moves. Pick a plan and go.'],
  [7, 9, 'Nb5', ['Nd5'], 'think', 145, 131, 'Black just castled long. Find the target (a7/c7), then move.'],
  [8, 14, 'Bxh6', [], 'think', 128, 117, 'Lines are opening. Count the h-file before taking.'],
  [10, 6, 'Nc7+', [], 'critical', 163, 148, 'A fork wins material. This is the moment to spend time.'],
  [10, 15, 'Bxh7+', [], 'critical', 121, 99, 'Bxh7+ first, then hxg3+ opens the h-file. Calculate it.'],
  [7, 10, 'Nxa7+', [], 'critical', 141, 126, 'Sacrifice into the king. Worth checking …Kb8 and …Nxa7.'],
  [3, 8, 'Bxe6', [], 'critical', 160, 152, 'A piece sacrifice on e6. Check …fxe6 Nxe6 before committing.'],
  [3, 9, 'Bxf7+', [], 'critical', 154, 147, 'Bxf7+ and Ne6+ wins the queen. Spend the seconds.'],
];

function posBefore(g, moveNo) {
  const G = games[g - 1]; if (!G) throw new Error('No game ' + g);
  const p = new Pos(); const ply = (moveNo - 1) * 2; const prev = [];
  for (let i = 0; i < ply; i++) { const m = p.parseSan(G.sans[i]); if (!m) throw new Error(`Game ${g}: bad move ${G.sans[i]}`); prev.push(p.san(m)); p.make(m); }
  return { p, prev, played: G.sans[ply], G };
}
const meta = G => ({ opp: G.h.Black, link: G.h.Link || '', date: (G.h.UTCDate || G.h.Date || '').replace(/\./g, '-') });
const key = fen => fen.split(' ').slice(0, 4).join(' ');

const byKey = new Map();
for (const [g, mn, san, group, theme, why] of POINTS) {
  const { p, prev, played, G } = posBefore(g, mn);
  if (played.replace(/[+#]/g, '') !== san.replace(/[+#]/g, '')) throw new Error(`Game ${g} move ${mn}: Canty played ${played}, not ${san}`);
  const k = key(p.fen());
  if (byKey.has(k)) throw new Error('Duplicate position ' + k);
  byKey.set(k, { id: 'c' + g + '-' + mn, group, theme, why, fen: p.fen(), prev, move: san, also: [], games: [], order: 0 });
}
// Every game reaching a curated position counts, and every move Canty chose there is accepted.
games.forEach((G, gi) => {
  if (G.sans[0] !== 'd4' || G.sans[2] !== 'Nc3') return; // 1.d4 + 2.Nc3 systems only
  const p = new Pos();
  for (let i = 0; i < G.sans.length; i++) {
    if (i % 2 === 0) {
      const it = byKey.get(key(p.fen()));
      if (it) { it.games.push({ n: gi + 1, ...meta(G), move: G.sans[i] }); if (!it.also.includes(G.sans[i]) && G.sans[i] !== it.move) it.also.push(G.sans[i]); }
    }
    if (!p.play(G.sans[i])) break;
  }
});
const positions = [...byKey.values()].map((x, i) => ({ ...x, order: i }));

const clock = CLOCK.map(([g, mn, san, also, cat, me, opp, why]) => {
  const { p, prev, played, G } = posBefore(g, mn);
  if (played.replace(/[+#]/g, '') !== san.replace(/[+#]/g, '')) throw new Error(`Clock: game ${g} move ${mn}: Canty played ${played}, not ${san}`);
  for (const a of also) if (!p.clone().parseSan(a)) throw new Error('Illegal alt ' + a);
  const { opp: vs, link, date } = meta(G);
  return { id: 'k' + g + '-' + mn, fen: p.fen(), prev, move: san, also, cat, me, opp, why, vs, link, date };
});

const out = { built: new Date().toISOString().slice(0, 10), source: 'GMCanty (White) — chess.com, supplied PGN', groups: GROUPS, positions, clock };
fs.writeFileSync(ROOT + 'data/canty.json', JSON.stringify(out));
console.log(`canty.json: ${positions.length} positions (${GROUPS.map(g => g.name + ' ' + positions.filter(p => p.group === g.id).length).join(', ')}), ${clock.length} clock positions`);
for (const p of positions) if (p.games.length > 1 || p.also.length) console.log(' ', p.id, p.move, 'games', p.games.length, 'also', p.also.join(','));

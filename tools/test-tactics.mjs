// Essential checks for Personal Tactics V1.   node tools/test-tactics.mjs
import fs from 'fs';
import { Pos } from '../js/chess/core.js';
import { KEY, queue, MOTIF, PROMPT } from '../js/views/tactics.js';

const read = f => JSON.parse(fs.readFileSync(new URL('../' + f, import.meta.url)));
const D = read('data/tactics.json'), T = read('data/training.json'), TECH = read('data/technique.json');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const f4 = f => f.split(' ').slice(0, 4).join(' ');
const ids = new Set(), own = new Set();
for (const x of D.cards) {
  ok(!ids.has(x.id), `${x.id}: duplicate id`); ids.add(x.id);
  ok(!own.has(x.own), `${x.id}: duplicate position`); own.add(x.own);
  let p; try { p = new Pos(x.fen); } catch (e) { ok(false, `${x.id}: bad FEN`); continue; }
  ok(p.legal().length > 0 && !p.inCheck(p.turn ^ 8), `${x.id}: not a legal position`);
  ok(x.side === 'w' || x.side === 'b', `${x.id}: no orientation`);
  // I am to move, except on THREAT_CHECK where the opponent's threat is played (same board, opponent to move)
  ok(p.side() === (x.type === 'THREAT_CHECK' ? (x.side === 'w' ? 'b' : 'w') : x.side), `${x.id}: wrong side to move for ${x.type}`);
  if (x.type === 'THREAT_CHECK') ok(f4(x.fen).split(' ')[0] === x.own.split(' ')[0], `${x.id}: threat board differs from the game position`);
  else ok(f4(x.fen) === x.own, `${x.id}: board is not the game position`);
  ok(x.moves.length && x.moves.every(m => new Pos(x.fen).parseSan(m)), `${x.id}: accepted move illegal`);
  ok(PROMPT[x.type] && MOTIF[x.motif], `${x.id}: unknown card type or motif`);
  for (const k of ['lesson', 'hint', 'game']) ok(x[k], `${x.id}: missing ${k}`);
  ok(!/\d{2,}|cp|eval/i.test(x.lesson.replace(/[a-h][1-8]/g, '')), `${x.id}: engine numbers in the lesson`);
  const q = new Pos(x.fen); ok(x.cont.every(s => q.play(s)), `${x.id}: continuation illegal`);
}
ok(D.cards.length >= 50 && D.cards.length <= 65, 'about 60 cards: ' + D.cards.length);
ok(D.cards.some(x => x.type === 'THREAT_CHECK'), 'THREAT_CHECK cards present');

// progress is separate from the Repertoire courses; Review holds only due cards
ok(KEY === 'tactics.srs', 'own progress key');
const now = 1e12; const S = {}; D.cards.forEach((x, i) => { if (i < 10) S[x.id] = { box: 1, due: i % 2 ? now - 1 : now + 1e6 }; });
const rv = await queue(D, 'review', S, now); ok(rv.length === 5 && rv.every(x => S[x.id].due <= now), 'review = due cards only: ' + rv.length);
const ln = await queue(D, 'learn', S, now); ok(ln.length && ln.every(x => !S[x.id]), 'learn = new cards only');

// ownership: the same merge and filter as js/data/catalog.js
const drills = [...T.drills], calc = [...T.calc]; const have = new Set([...drills, ...calc].map(x => f4(x.fen)));
for (const [list, extra] of [[drills, TECH.repair], [calc, TECH.calc]]) for (const x of extra) if (!have.has(f4(x.fen))) { have.add(f4(x.fen)); list.push(x); }
const keepD = drills.filter(x => !own.has(f4(x.fen))), keepC = calc.filter(x => !own.has(f4(x.fen)));
ok(!keepD.some(x => own.has(f4(x.fen))) && !keepC.some(x => own.has(f4(x.fen))), 'no Tactics card left in Repair / Calculate');
ok(keepD.some(x => x.type === 'positional'), 'Repair keeps positional mistakes');
const deeper = keepC.filter(x => x.src === 'mine');
ok(deeper.length >= 100, 'deeper Calculate positions from my games retained: ' + deeper.length);
const cnt = f => D.cards.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
console.log(fails ? `${fails} FAILED` : `tactics: all checks pass — ${D.cards.length} cards`, JSON.stringify(cnt(x => x.motif)), JSON.stringify(cnt(x => x.type)));
console.log(`removed from Repair: ${drills.length - keepD.length} · removed from Calculate: ${calc.length - keepC.length} · Calculate positions from my games kept: ${deeper.length}`);
process.exit(fails ? 1 : 0);

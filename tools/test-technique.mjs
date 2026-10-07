// Essential checks for Technique data and the coaching-point classifier.   node tools/test-technique.mjs
import fs from 'fs';
import { Pos } from '../js/chess/core.js';
import { lessonFor } from '../js/views/technique.js';

const D = JSON.parse(fs.readFileSync(new URL('../data/technique.json', import.meta.url)));
const T = JSON.parse(fs.readFileSync(new URL('../data/training.json', import.meta.url)));
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const f4 = f => f.split(' ').slice(0, 4).join(' ');

// every position is legal, has moves, and it is my move
for (const k of ['simplify', 'convert', 'hold']) for (const x of D[k]) {
  const p = new Pos(x.fen); ok(p.legal().length > 0, `${x.id}: no legal moves`); ok(p.side() === x.color, `${x.id}: not my move`);
  ok(Array.isArray(x.tags) && x.tags.length, `${x.id}: no tags`); ok(x.game && x.game.played, `${x.id}: no game move`);
}
// simplify: 2–4 real choices, a reachable answer, an explanation, a playable line
for (const x of D.simplify) {
  ok(x.choices.length >= 2 && x.choices.length <= 4, `${x.id}: ${x.choices.length} choices`);
  ok(x.accept.length && x.accept.every(a => x.choices.some(c => c.key === a)), `${x.id}: answer not among choices`);
  ok(x.explain && x.explain.length < 120, `${x.id}: explanation missing or long`);
  ok(new Pos(x.fen).parseSan(x.line[0]), `${x.id}: line does not start legally`);
  ok(x.choices.filter(c => c.key !== 'keep' && c.key !== 'improve').length >= 1, `${x.id}: no trade on offer`);
}
// no position appears twice, inside Technique or between Technique and Repair/Calculate
const tech = [...D.simplify, ...D.convert, ...D.hold].map(x => f4(x.fen)); ok(new Set(tech).size === tech.length, 'duplicate Technique positions');
const extra = [...D.repair, ...D.calc].map(x => f4(x.fen)); ok(new Set(extra).size === extra.length, 'duplicate Repair/Calculate additions');
const existing = new Set([...T.drills, ...T.calc].map(x => f4(x.fen)));
ok(extra.every(k => !existing.has(k)), 'addition duplicates an existing Repair/Calculate position'); ok(extra.every(k => !tech.includes(k)), 'tactical failure also in Technique');
for (const d of D.repair) ok(new Pos(d.fen).parseSan(d.sfBest) && new Pos(d.fen).parseSan(d.played), `${d.id}: repair moves illegal`);
for (const c of D.calc) { const p = new Pos(c.fen); ok(c.line.every(s => p.play(s)), `${c.id}: calc line illegal`); }

// classifier: a rook retreat, an even trade, an allowed check
const r1 = lessonFor('convert', { fen: '6k1/R7/8/8/8/8/5PPP/6K1 w - - 0 40', uci: 'a7a1', san: 'Ra1', after: '6k1/8/8/8/8/8/5PPP/R5K1 b - - 1 40', best: 'a7a5', oppUci: null }, []);
ok(r1.text === 'Your rook became passive.', 'rook retreat → ' + r1.text);
const r2 = lessonFor('hold', { fen: '3rk3/8/8/8/8/8/5PPP/3R2K1 w - - 0 40', uci: 'd1d8', san: 'Rxd8+', after: '3Rk3/8/8/8/8/8/5PPP/6K1 b - - 0 40', best: 'g1f1', oppUci: null }, []);
ok(r2.text === 'Trading here made the defense much harder.', 'even trade → ' + r2.text);

console.log(fails ? `${fails} FAILED` : `technique: all checks pass (simplify ${D.simplify.length}, convert ${D.convert.length}, hold ${D.hold.length}, repair +${D.repair.length}, calculate +${D.calc.length})`);
process.exit(fails ? 1 : 0);

// Essential checks for my 1…Nc6 course.   node tools/test-nc6.mjs
import fs from 'fs';
import { Pos } from '../js/chess/core.js';
const D = JSON.parse(fs.readFileSync(new URL('../data/nc6.json', import.meta.url)));
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const f4 = f => f.split(' ').slice(0, 4).join(' ');
ok(D.courses.length === 1 && D.courses[0].id === 'nc6' && D.courses[0].color === 'b', 'one Black course');
const C = D.courses[0]; const ids = new Set(), keys = new Set();
for (const x of C.cards) {
  ok(!ids.has(x.id), `${x.id}: duplicate id`); ids.add(x.id);
  ok(!keys.has(f4(x.fen)), `${x.id}: duplicate position`); keys.add(f4(x.fen));
  const p = new Pos(); ok(x.line.every(s => p.play(s)) && f4(p.fen()) === f4(x.fen), `${x.id}: line does not reach the position`);
  ok(p.side() === 'b', `${x.id}: not Black to move`);
  ok(new Pos(x.fen).parseSan(x.move), `${x.id}: move illegal`);
  ok(x.oppMove === x.line[x.line.length - 1], `${x.id}: opponent move mismatch`);
  for (const k of ['branch', 'explain', 'stat', 'player']) ok(x[k], `${x.id}: missing ${k}`);
  const q = new Pos(x.fen); ok(x.continuation[0] === x.move && x.continuation.every(s => q.play(s)), `${x.id}: continuation illegal`);
  if (x.leaf) ok(x.plan && C.plans.some(p => p.text === x.plan), `${x.id}: line ends without a plan`);
}
ok(C.cards.length >= 50, 'enough positions: ' + C.cards.length);
ok(C.plans.length >= 8 && C.plans.every(p => p.branch && p.text), 'named plans: ' + C.plans.length);
console.log(fails ? `${fails} FAILED` : `nc6: all checks pass (${C.cards.length} positions, ${C.cards.filter(x => x.leaf).length} line ends, ${C.plans.length} plans)`);
process.exit(fails ? 1 : 0);

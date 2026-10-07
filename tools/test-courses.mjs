// Essential checks for the repertoire courses.   node tools/test-courses.mjs
import fs from 'fs';
import { Pos } from '../js/chess/core.js';
import { schedule } from '../js/views/courses.js';

const D = JSON.parse(fs.readFileSync(new URL('../data/courses.json', import.meta.url)));
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const f4 = f => f.split(' ').slice(0, 4).join(' ');
ok(D.courses.map(c => c.id).join() === 'jobava,kid,firouzja', 'exactly the three courses');
const ids = new Set();
for (const C of D.courses) {
  const keys = new Set();
  for (const x of C.cards) {
    ok(!ids.has(x.id), `${x.id}: duplicate id`); ids.add(x.id);
    ok(!keys.has(f4(x.fen)), `${x.id}: duplicate position (transposition not merged)`); keys.add(f4(x.fen));
    const p = new Pos(); ok(x.line.every(s => p.play(s)) && f4(p.fen()) === f4(x.fen), `${x.id}: line does not reach the position`);
    ok(p.side() === C.color, `${x.id}: not the course side to move`);
    ok(new Pos(x.fen).parseSan(x.move), `${x.id}: repertoire move illegal`);
    ok(x.oppMove === (x.line.length ? x.line[x.line.length - 1] : null), `${x.id}: opponent move mismatch`);
    for (const k of ['course', 'branch', 'explain', 'player']) ok(x[k], `${x.id}: missing ${k}`);
    const q = new Pos(x.fen); ok(x.continuation[0] === x.move && x.continuation.every(s => q.play(s)), `${x.id}: continuation illegal`);
  }
}
// intervals: new → later today, then 1, 3, 7, 14, 30 days; a miss resets
const H = 36e5, Dd = 864e5; let r = schedule(null, true, 0); const steps = [r.due];
for (let i = 0; i < 5; i++) { r = schedule(r, true, 0); steps.push(r.due); }
ok(JSON.stringify(steps) === JSON.stringify([4 * H, Dd, 3 * Dd, 7 * Dd, 14 * Dd, 30 * Dd]), 'interval ladder ' + steps.map(s => s / Dd).join(','));
r = schedule(r, false, 0); ok(r.box === 0 && r.due === 10 * 6e4, 'a miss resets to the start');
console.log(fails ? `${fails} FAILED` : `courses: all checks pass (${D.courses.map(c => `${c.id} ${c.cards.length}`).join(', ')})`);
process.exit(fails ? 1 : 0);

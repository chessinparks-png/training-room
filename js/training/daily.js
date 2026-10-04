// TRAIN TODAY — a ~10 minute session for 3+2: recognition, repertoire, clock, calculation, review.
import * as store from '../data/store.js';
import * as srs from './srs.js';
import { C, calcItems, famData } from '../data/catalog.js';
import { FAMILIES } from '../repertoire/families.js';
import { shuffle } from '../ui.js';

const DAY = 864e5;
const acc = xs => (xs.length ? xs.filter(x => x.ok).length / xs.length : null);

export async function signals() {
  const at = await store.attempts(); const since = Date.now() - 21 * DAY; const recent = at.filter(a => a.t >= since);
  const by = m => recent.filter(a => a.mode === m);
  const blitz = (await store.all('blitz')).filter(g => g.metrics).sort((a, b) => b.t - a.t).slice(0, 8);
  const rs = await srs.stats();
  const fam = {};
  for (const f of FAMILIES) {
    const dec = recent.filter(a => (a.mode === 'decision' || a.mode === 'plan') && a.fam === f.id);
    const F = famData(f.id); const conf = C.training.drills.filter(d => d.fam === f.id && d.verdict === 'mistake').length;
    const lastT = Math.max(0, ...at.filter(a => a.fam === f.id).map(a => a.t));
    const score = F.mine.score ?? 50;
    // weight: weak results + many confirmed mistakes + poor recent decisions + not trained lately
    fam[f.id] = { w: (60 - Math.min(60, score)) / 10 + Math.min(4, conf / 20) + (dec.length >= 4 ? (1 - acc(dec)) * 4 : 1.5) + Math.min(3, (Date.now() - lastT) / DAY / 2), dec: dec.length, decAcc: acc(dec) };
  }
  const calc = by('calc'); const calcKinds = {}; for (const a of calc) { const k = calcKinds[a.kind] || (calcKinds[a.kind] = { n: 0, ok: 0 }); k.n++; if (a.ok) k.ok++; }
  return {
    repair: rs, calc: { n: calc.length, acc: acc(calc), depth: calc.length ? calc.reduce((s, a) => s + (a.depth || 0), 0) / calc.length : null, kinds: calcKinds },
    vision: { n: by('vision').length, acc: acc(by('vision')), squares: acc(by('vision').filter(a => a.area === 'squares')), board: acc(by('vision').filter(a => a.area !== 'squares')) },
    decisions: { n: by('decision').length + by('plan').length, acc: acc([...by('decision'), ...by('plan')]) },
    blitz: { n: blitz.length, lastT: blitz[0]?.t || 0, impulsive: blitz.length ? blitz.reduce((s, g) => s + g.metrics.impulsive, 0) / blitz.length : 0, errors: blitz.length ? blitz.reduce((s, g) => s + g.metrics.errors, 0) / blitz.length : 0, issue: blitz[0]?.issue || null },
    fam,
  };
}

// Session plan: [{kind, label, detail, minutes}]. Short and fixed in shape — built for 3+2:
// fast recognition → Canty repertoire → clock decisions → calculation → review (when due).
export async function buildSession() {
  const S = await signals();
  const steps = [
    { kind: 'recog', n: 4, label: 'Recognition', detail: '4 positions from your games · find it fast', minutes: 2 },
    { kind: 'canty', n: 4, label: 'Repertoire', detail: "4 × Canty's move · 1.d4 2.Nc3", minutes: 2 },
    { kind: 'clock', n: 3, label: 'Clock decisions', detail: '3 positions · 3, 10 or 25 seconds?', minutes: 2 },
    { kind: 'calc', n: 2, level: 'medium', label: 'Calculation', detail: '2 positions · 4–6 ply', minutes: 3 },
  ];
  if (S.repair.due) { const n = Math.min(4, S.repair.due); steps.push({ kind: 'review', n, label: 'Review', detail: `${n} due position${n > 1 ? 's' : ''}`, minutes: 2 }); }
  const total = steps.reduce((s, x) => s + x.minutes, 0);
  return { id: 's' + Date.now().toString(36), created: Date.now(), steps, total, signals: S };
}

// Items for a calculation step (fresh each time so a resumed session still makes sense)
export function stepItems(step) {
  if (step.kind === 'calc') {
    const pool = calcItems({}).filter(c => c.line.length >= 4); const mine = pool.filter(c => c.src === 'mine');
    const pickN = shuffle([...shuffle(mine).slice(0, 1), ...shuffle(pool).slice(0, step.n)]);
    return [...new Map(pickN.map(c => [c.id, c])).values()].slice(0, step.n);
  }
  return [];
}

// Summary: one tally per step and one specific line about the session.
export function summarise(session, results) {
  const flat = k => results.filter(r => r.step === k).flatMap(r => r.items || []);
  const tally = xs => (xs.length ? [xs.filter(x => x.ok).length, xs.length] : null);
  const clock = flat('clock'); const calc = flat('calc'); const recog = flat('recog');
  const out = { recog: tally(recog), canty: tally(flat('canty')), clock: tally(clock), calc: tally(calc), review: tally(flat('review')) };
  const rushed = clock.filter(x => x.cat === 'critical' && x.pick !== 'critical').length;
  const slow = clock.filter(x => x.cat === 'routine' && x.pick !== 'routine').length;
  const fastWrong = recog.filter(x => !x.ok && x.sec != null && x.sec < 4).length;
  out.issue = rushed ? 'You under-rated a critical moment. Those are the ones that decide blitz games.'
    : slow ? 'You budgeted time for a routine move. Bank those seconds.'
    : fastWrong >= 2 ? `Moving too quickly: ${fastWrong} wrong answers in under 4 seconds.`
    : calc.length && calc.every(x => !x.ok) ? 'Calculation broke down early. Count the replies, not just your moves.'
    : 'No clear weakness today.';
  return out;
}

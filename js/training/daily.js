// TRAIN TODAY — builds a ~12–18 minute personalised session from recent evidence, and rotates
// composition so sessions are not identical. Order follows SEE → CALCULATE → DECIDE → PLAY → REPAIR.
import * as store from '../data/store.js';
import * as srs from './srs.js';
import { C, decisions, plans, calcItems, famData } from '../data/catalog.js';
import { FAMILIES, FAMILY } from '../repertoire/families.js';
import { shuffle, pick } from '../ui.js';

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

// Session plan: [{kind, label, detail, minutes, params}]
export async function buildSession() {
  const S = await signals(); const last = await store.setting('session.last', null);
  const steps = [];
  // 1. SEE — rotate vision area; favour the weaker of squares / board memory
  const vAreas = ['squares', 'board', 'blind'];
  let vArea = last && last.vision ? vAreas[(vAreas.indexOf(last.vision) + 1) % 3] : 'board';
  if (S.vision.squares != null && S.vision.squares < 0.85 && last?.vision !== 'squares') vArea = 'squares';
  const blindLevel = S.vision.board != null && S.vision.board >= 0.75 ? 3 : 2;
  steps.push(vArea === 'squares' ? { kind: 'vision', area: 'squares', mode: pick(['find', 'name', 'color']), label: 'Vision', detail: 'Squares · 20 prompts', minutes: 2 }
    : vArea === 'board' ? { kind: 'vision', area: 'board', rounds: 3, label: 'Vision', detail: 'Board memory · 3 positions', minutes: 2 }
      : { kind: 'vision', area: 'blind', level: blindLevel, rounds: 2, label: 'Vision', detail: `Blindfold · level ${blindLevel}`, minutes: 3 });
  // 2. CALCULATE — more when accuracy is low; bias toward the weakest calculation type
  const weakKind = Object.entries(S.calc.kinds).filter(([, k]) => k.n >= 3).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n)[0];
  const blitzDue = Date.now() - S.blitz.lastT > 0.6 * DAY || S.repair.due < 4;
  const calcN = (S.calc.acc != null && S.calc.acc < 0.5 ? 5 : 4) - (blitzDue ? 1 : 0);
  const level = S.calc.depth != null && S.calc.depth >= 4 ? 'deep' : 'medium';
  steps.push({ kind: 'calc', n: calcN, level, focusKind: weakKind ? weakKind[0] : null, label: 'Calculation', detail: `${calcN} positions${weakKind ? ' · focus: ' + weakKind[0] : ''}`, minutes: calcN });
  // 3. DECIDE — the family that most needs work (not the same as last time if close)
  const fams = Object.entries(S.fam).sort((a, b) => b[1].w - a[1].w);
  let famId = fams[0][0]; if (last && last.fam === famId && fams[1] && fams[1][1].w > fams[0][1].w * 0.8) famId = fams[1][0];
  const repMode = last && last.repMode === 'decide' ? 'plan' : 'decide';
  const hasBoth = decisions(famId).some(d => d.both);
  steps.push(repMode === 'decide' ? { kind: 'decide', fam: famId, n: 3, both: hasBoth, label: FAMILY[famId].name, detail: `3 decisions${hasBoth ? ' · incl. a position you both play' : ''}`, minutes: 3 }
    : { kind: 'plan', fam: famId, n: 2, label: FAMILY[famId].name, detail: "2 × What's the plan?", minutes: 3 });
  // 4. PLAY — blitz unless played very recently and there is lots of repair
  if (blitzDue) steps.push({ kind: 'blitz', label: 'Blitz', detail: '1 × 3+2 · review', minutes: 7 });
  // 5. REPAIR
  const repN = blitzDue ? Math.max(3, Math.min(4, S.repair.due || 3)) : Math.max(3, Math.min(6, S.repair.due || 4));
  steps.push({ kind: 'repair', n: repN, label: 'Repair', detail: `${repN} positions${S.repair.due ? ` · ${S.repair.due} due` : ''}`, minutes: Math.ceil(repN * 0.6) });
  const total = steps.reduce((s, x) => s + x.minutes, 0);
  return { id: 's' + Date.now().toString(36), created: Date.now(), steps, total, fam: famId, vision: vArea, repMode, signals: S };
}

// Items for a step (fresh each time so a resumed session still makes sense)
export function stepItems(step, S) {
  if (step.kind === 'calc') {
    let pool = calcItems({}); const mine = pool.filter(c => c.src === 'mine');
    const focus = step.focusKind ? pool.filter(c => c.kind === step.focusKind) : [];
    const pickN = shuffle([...shuffle(mine).slice(0, 2), ...shuffle(focus).slice(0, 2), ...shuffle(pool).slice(0, step.n)]);
    return [...new Map(pickN.map(c => [c.id, c])).values()].slice(0, step.n);
  }
  if (step.kind === 'decide') { const ds = decisions(step.fam); const both = shuffle(ds.filter(d => d.both)).slice(0, step.both ? 1 : 0); return [...both, ...shuffle(ds.filter(d => !d.both)).slice(0, step.n - both.length)]; }
  if (step.kind === 'plan') return shuffle(plans(step.fam)).slice(0, step.n);
  return [];
}

// Summary: short, specific, no gamification.
export function summarise(session, results) {
  const flat = k => results.filter(r => r.step === k).flatMap(r => r.items || []);
  const dec = [...flat('decide'), ...flat('plan')]; const calc = flat('calc'); const rep = flat('repair'); const vis = results.filter(r => r.step === 'vision');
  const blitz = results.find(r => r.step === 'blitz');
  const timed = dec.filter(x => x.sec != null);
  const out = {
    decisionAcc: dec.length ? Math.round(dec.filter(x => x.ok).length / dec.length * 100) : null,
    avgDecision: timed.length ? +(timed.reduce((s, x) => s + x.sec, 0) / timed.length).toFixed(1) : null,
    calc: calc.length ? [calc.filter(x => x.ok).length, calc.length] : null,
    calcDepth: calc.length ? +(calc.reduce((s, x) => s + (x.depth || 0), 0) / calc.length).toFixed(1) : null,
    repair: rep.length ? [rep.filter(x => x.ok).length, rep.length] : null,
    vision: vis.length && vis[0].tally && vis[0].tally.n ? [vis[0].tally.ok, vis[0].tally.n] : null,
    blitz: blitz ? blitz.game : null,
  };
  // Today's issue: the most specific evidence available
  const fastWrong = [...dec, ...rep].filter(x => !x.ok && x.sec != null && x.sec < 4);
  const calcFail = calc.filter(x => !x.ok); const defensiveFail = calcFail.filter(x => x.kind === 'defensive');
  let issue;
  if (blitz && blitz.game && blitz.game.issue && blitz.game.metrics && blitz.game.metrics.errors) issue = blitz.game.issue;
  else if (fastWrong.length >= 2) issue = `Moving too quickly: ${fastWrong.length} wrong answers given in under 4 seconds.`;
  else if (defensiveFail.length >= 2) issue = 'Defensive calculation — the opponent\'s best reply went unseen.';
  else if (calcFail.length >= Math.max(2, calc.length / 2)) issue = `Calculation broke down early (average ${out.calcDepth} accurate plies).`;
  else if (dec.length && out.decisionAcc < 60) issue = `${FAMILY[session.fam].name} decisions: ${out.decisionAcc}% sound.`;
  else issue = 'No clear weakness today.';
  const nextFam = Object.entries(session.signals.fam).filter(([k]) => k !== session.fam).sort((a, b) => b[1].w - a[1].w)[0];
  const nextMode = calcFail.length > calc.length / 2 ? 'calculation' : out.vision && out.vision[0] / out.vision[1] < 0.7 ? 'board vision' : 'decisions';
  out.issue = issue; out.next = `${FAMILY[nextFam[0]].name} + ${nextMode}`;
  return out;
}

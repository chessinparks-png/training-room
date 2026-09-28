// TRAIN TODAY — the primary screen. One button. The session decides itself.
import { buildSession, stepItems, summarise } from '../training/daily.js';
import * as store from '../data/store.js';
import { nextRepair, mountRepairItem } from '../training/repair.js';
import { mountCalc } from '../training/calc.js';
import { mountDecision } from '../training/decision.js';
import { mountPlan } from '../training/plan.js';
import { squares, boardVision, blind } from './vision.js';
import { playBlitz, reviewBlitz } from './blitz.js';
import { esc, NIL } from '../ui.js';
import { C } from '../data/catalog.js';
import { status as engineStatus } from '../analysis/engine.js';

export async function mount(el, params) {
  let un = null; const cleanup = () => { if (typeof un === 'function') un(); un = null; };
  const saved = await store.setting('session.current', null);
  if (params[0] === 'run' && saved) { run(el, saved, f => { un = f; }); return cleanup; }
  const plan = saved && Date.now() - saved.session.created < 12 * 3600e3 ? saved.session : await buildSession();
  home(el, plan, !!saved && saved.index > 0 && saved.session.id === plan.id);
  return cleanup;
}

function home(el, plan, resumable) {
  const d = new Date(); const S = plan.signals;
  const hist = [];
  el.innerHTML = `<div class="today-hero"><div><div class="kicker">${esc(d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
      <h1 class="display" style="margin-top:22px">Today.</h1>
      <p class="lede" style="margin-top:24px">${plan.total} minutes, chosen from your recent training, your due repairs and your games. ${esc(S.blitz.issue ? 'Last blitz: ' + S.blitz.issue : '')}</p>
      <div class="row" style="margin-top:36px;gap:22px"><button class="btn primary big" data-a="start">${resumable ? 'Resume session' : 'Start session'}</button>${resumable ? '<button class="btn link" data-a="new">New session</button>' : ''}</div></div>
    <ol class="plan-list">${plan.steps.map((s, i) => `<li><span class="i">${String(i + 1).padStart(2, '0')}</span><span class="t">${esc(s.label)}<small>${esc(s.detail)}</small></span><span class="q">${s.minutes} min</span></li>`).join('')}</ol></div>
    <section class="section"><div class="grid cols-4">
      <div class="stat"><div class="bignum num">${S.repair.due}</div><span class="label">Due for repair</span><div class="note">${S.repair.mastered} mastered</div></div>
      <div class="stat"><div class="bignum num">${S.calc.acc != null ? Math.round(S.calc.acc * 100) + '%' : NIL}</div><span class="label">Calculation · 3 weeks</span><div class="note">${S.calc.n} positions</div></div>
      <div class="stat"><div class="bignum num">${S.decisions.acc != null ? Math.round(S.decisions.acc * 100) + '%' : NIL}</div><span class="label">Sound decisions</span><div class="note">${S.decisions.n} answered</div></div>
      <div class="stat"><div class="bignum num">${S.blitz.n ? S.blitz.errors.toFixed(1) : NIL}</div><span class="label">Errors per blitz game</span><div class="note">${S.blitz.n} recent games</div></div></div></section>
    <p class="footnote">${engineStatus.mode === 'fallback' ? esc(engineStatus.note) : `Stockfish 19 runs locally. ${C.training.drills.filter(x => x.verdict === 'mistake').length} Stockfish-confirmed mistakes from your games are queued for repair, introduced a few at a time.`}</p>`;
  el.onclick = async e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'new') { await store.setSetting('session.current', null); location.hash = '#/today'; location.reload(); return; }
    if (a.dataset.a === 'start') { let cur = await store.setting('session.current', null); if (!cur || cur.session.id !== plan.id) { cur = { session: plan, index: 0, results: [] }; await store.setSetting('session.current', cur); } location.hash = '#/today/run'; }
  };
}

const blitzWord = g => { if (!g || !g.result) return ''; const won = (g.result === '1-0' && g.color === 'w') || (g.result === '0-1' && g.color === 'b'); return g.result === '1/2-1/2' ? 'Draw' : won ? 'Won' : 'Lost'; };
async function run(el, cur, setUn) {
  const { session } = cur;
  const save = () => store.setSetting('session.current', cur);
  const bar = (i, sub = '') => `<div class="session-bar"><span class="label ink">${String(i + 1).padStart(2, '0')} / ${String(session.steps.length).padStart(2, '0')} · ${esc(session.steps[i].label)}${sub ? ' · ' + esc(sub) : ''}</span><div class="meter"><i style="width:${(i / session.steps.length) * 100}%"></i></div><button class="btn link" data-end>End</button></div>`;
  const frame = (i, sub) => { el.innerHTML = bar(i, sub) + '<div class="step-host"></div>'; el.querySelector('[data-end]').onclick = () => finish(true); return el.querySelector('.step-host'); };
  async function step() {
    const i = cur.index; if (i >= session.steps.length) return finish();
    const s = session.steps[i]; const results = { step: s.kind, items: [] };
    const done = async () => { cur.results.push(results); cur.index++; await save(); step(); };
    if (s.kind === 'vision') {
      const host = frame(i, s.detail); const cb = tally => { results.tally = tally; done(); };
      setUn(s.area === 'squares' ? squares(host, s.mode, { n: 20, onDone: r => cb({ ok: r.ok, n: r.n }) }) : s.area === 'board' ? boardVision(host, { rounds: s.rounds, onDone: cb }) : blind(host, s.level, null, { rounds: s.rounds, onDone: cb }));
    } else if (['calc', 'decide', 'plan'].includes(s.kind)) {
      const items = stepItems(s); let k = 0;
      const next = rec => { if (rec && !rec.skipped) results.items.push({ ...rec }); if (k >= items.length) return done(); const host = frame(i, `${k + 1} of ${items.length}`); const it = items[k++];
        setUn(s.kind === 'calc' ? mountCalc(host, it, { level: s.level, onDone: next }) : s.kind === 'decide' ? mountDecision(host, it, { onDone: next }) : mountPlan(host, it, { onDone: next })); };
      next();
    } else if (s.kind === 'repair') {
      const items = await nextRepair(s.n, { fresh: 3 }); let k = 0;
      const next = async rec => { if (rec && !rec.skipped) results.items.push({ ...rec }); if (k >= items.length) return done(); const host = frame(i, `${k + 1} of ${items.length}`); setUn(await mountRepairItem(host, items[k++], { onDone: next })); };
      next();
    } else if (s.kind === 'blitz') {
      const host = frame(i, '3+2');
      setUn(await playBlitz(host, null, { session: true, onDone: async rec => { const h2 = frame(i, 'review'); setUn(await reviewBlitz(h2, rec.id, { onDone: g => { results.game = { id: g.id, result: g.result, color: g.color, issue: g.issue, metrics: g.metrics }; done(); } })); } }));
    } else done();
  }
  async function finish(early) {
    const sum = summarise(session, cur.results);
    await store.logAttempt({ mode: 'session', ok: true, summary: sum, steps: session.steps.map(s => s.kind), completed: !early });
    await store.setSetting('session.last', { fam: session.fam, vision: session.vision, repMode: session.repMode, t: Date.now() });
    await store.setSetting('session.current', null);
    el.innerHTML = `<div class="feature-head"><div><div class="kicker">${early ? 'Session ended' : 'Session complete'}</div><h1 class="display" style="margin-top:18px">${early ? 'Paused.' : 'Done.'}</h1></div><div></div></div>
      <section class="section"><div class="grid cols-4">
        ${sum.decisionAcc != null ? `<div class="stat"><div class="bignum num">${sum.decisionAcc}%</div><span class="label">Decision accuracy</span></div>` : ''}
        ${sum.avgDecision != null ? `<div class="stat"><div class="bignum num">${sum.avgDecision}<small>sec</small></div><span class="label">Average decision</span></div>` : ''}
        ${sum.calc ? `<div class="stat"><div class="bignum num">${sum.calc[0]} / ${sum.calc[1]}</div><span class="label">Calculation</span><div class="note">${sum.calcDepth} accurate plies on average</div></div>` : ''}
        ${sum.repair ? `<div class="stat"><div class="bignum num">${sum.repair[0]} / ${sum.repair[1]}</div><span class="label">Repair</span></div>` : ''}
        ${sum.vision ? `<div class="stat"><div class="bignum num">${sum.vision[0]} / ${sum.vision[1]}</div><span class="label">Vision</span></div>` : ''}
        ${sum.blitz ? `<div class="stat"><div class="bignum num">${sum.blitz.metrics ? sum.blitz.metrics.errors : NIL}</div><span class="label">Blitz errors</span><div class="note">${esc(blitzWord(sum.blitz))}</div></div>` : ''}
      </div></section>
      <section class="section"><div class="label">Today's issue</div><p class="h2" style="margin-top:12px">${esc(sum.issue)}</p><div class="label" style="margin-top:36px">Next focus</div><p class="h2" style="margin-top:12px">${esc(sum.next)}</p></section>
      <div class="actions"><a class="btn primary" href="#/today">Close</a><a class="btn link" href="#/progress">Progress</a></div>`;
  }
  step();
}

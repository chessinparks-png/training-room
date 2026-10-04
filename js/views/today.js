// TRAIN TODAY — the primary screen. One button. A short, fixed-shape session for 3+2.
import { buildSession, stepItems, summarise } from '../training/daily.js';
import * as store from '../data/store.js';
import { nextRepair, mountRepairItem, TACTICAL } from '../training/repair.js';
import { mountCalc } from '../training/calc.js';
import { cantyQueue, runCanty, clockQueue, mountClock } from '../training/canty.js';
import { esc } from '../ui.js';

const KINDS = ['recog', 'canty', 'clock', 'calc', 'review'];

export async function mount(el, params) {
  let un = null; const cleanup = () => { if (typeof un === 'function') un(); un = null; };
  const saved = await store.setting('session.current', null);
  // sessions saved by the previous version of the app have other step kinds: start fresh
  const valid = saved && saved.session.steps.every(s => KINDS.includes(s.kind)) ? saved : null;
  if (params[0] === 'run' && valid) { run(el, valid, f => { un = f; }); return cleanup; }
  const plan = valid && Date.now() - valid.session.created < 12 * 3600e3 ? valid.session : await buildSession();
  home(el, plan, !!valid && valid.index > 0 && valid.session.id === plan.id);
  return cleanup;
}

function home(el, plan, resumable) {
  const d = new Date();
  el.innerHTML = `<div class="today-hero"><div class="stack" style="--s:20px"><div class="kicker">${esc(d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
      <h1 class="display">Today.</h1>
      <p class="lede">About ${plan.total} minutes of 3+2 training.</p>
      <div class="row" style="gap:22px;padding-top:8px"><button class="btn primary big" data-a="start">${resumable ? 'Resume session' : 'Start session'}</button>${resumable ? '<button class="btn link" data-a="new">New session</button>' : ''}</div>
      <div class="row small" style="gap:22px;padding-top:6px"><a class="arrow-link" href="#/canty">Canty trainer</a><a class="arrow-link" href="#/blitz">Play a 3+2 game</a></div></div>
    <ol class="plan-list">${plan.steps.map((s, i) => `<li><span class="i">${String(i + 1).padStart(2, '0')}</span><span class="t">${esc(s.label)}<small>${esc(s.detail)}</small></span><span class="q">${s.minutes} min</span></li>`).join('')}</ol></div>`;
  el.onclick = async e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'new') { await store.setSetting('session.current', null); home(el, await buildSession(), false); return; }
    if (a.dataset.a === 'start') { let cur = await store.setting('session.current', null); if (!cur || cur.session.id !== plan.id) { cur = { session: plan, index: 0, results: [] }; await store.setSetting('session.current', cur); } location.hash = '#/today/run'; }
  };
}

async function run(el, cur, setUn) {
  const { session } = cur;
  const save = () => store.setSetting('session.current', cur);
  const bar = (i, sub = '') => `<div class="session-bar"><span class="label ink">${String(i + 1).padStart(2, '0')} / ${String(session.steps.length).padStart(2, '0')} · ${esc(session.steps[i].label)}${sub ? ' · ' + esc(sub) : ''}</span><div class="meter"><i style="width:${(i / session.steps.length) * 100}%"></i></div><button class="btn link" data-end>End</button></div>`;
  const frame = (i, sub) => { el.innerHTML = bar(i, sub) + '<div class="step-host"></div>'; el.querySelector('[data-end]').onclick = () => finish(true); window.scrollTo(0, 0); return el.querySelector('.step-host'); };
  // runs a list of items through a mount function, one frame each
  const series = (i, items, mountOne, results, done) => { let k = 0;
    const next = async rec => { if (rec && !rec.skipped) results.items.push({ ...rec }); if (k >= items.length) return done(); const host = frame(i, `${k + 1} of ${items.length}`); setUn(await mountOne(host, items[k++], next)); };
    next(); };
  async function step() {
    const i = cur.index; if (i >= session.steps.length) return finish();
    const s = session.steps[i]; const results = { step: s.kind, items: [] };
    const done = async () => { cur.results.push(results); cur.index++; await save(); step(); };
    if (s.kind === 'recog') series(i, await nextRepair(s.n, { fresh: s.n, skipDue: true, types: TACTICAL }), (h, it, next) => mountRepairItem(h, it, { onDone: next, label: 'RECOGNITION · FIND IT FAST' }), results, done);
    else if (s.kind === 'review') series(i, await nextRepair(s.n, { fresh: 0 }), (h, it, next) => mountRepairItem(h, it, { onDone: next }), results, done);
    else if (s.kind === 'calc') series(i, stepItems(s), (h, it, next) => mountCalc(h, it, { level: s.level, onDone: next }), results, done);
    else if (s.kind === 'clock') series(i, await clockQueue(s.n), (h, it, next) => mountClock(h, it, { onDone: next }), results, done);
    else if (s.kind === 'canty') {
      const items = await cantyQueue(s.n); if (!items.length) return done();
      setUn(runCanty(el, items, { frame: (k, n) => frame(i, `${Math.min(k + 1, n)} of ${n}`), onDone: res => { results.items = res; done(); } }));
    } else done();
  }
  async function finish(early) {
    const sum = summarise(session, cur.results);
    await store.logAttempt({ mode: 'session', ok: true, summary: sum, steps: session.steps.map(s => s.kind), completed: !early });
    await store.setSetting('session.current', null);
    const tile = (v, label) => (v ? `<div class="stat"><div class="bignum num">${v[0]} / ${v[1]}</div><span class="label">${label}</span></div>` : '');
    el.innerHTML = `<div class="stack" style="--s:28px"><div><div class="kicker">${early ? 'Session ended' : 'Session complete'}</div><h1 class="h1" style="margin-top:14px">${early ? 'Paused.' : 'Done.'}</h1></div>
      <div class="grid cols-5">${tile(sum.recog, 'Recognition')}${tile(sum.canty, 'Canty · first try')}${tile(sum.clock, 'Clock calls')}${tile(sum.calc, 'Calculation')}${tile(sum.review, 'Review')}</div>
      <p class="h3">${esc(sum.issue)}</p>
      <div class="actions"><a class="btn primary" href="#/today">Close</a><a class="btn link" href="#/canty">Canty trainer</a><a class="btn link" href="#/blitz">Play a 3+2 game</a></div></div>`;
    window.scrollTo(0, 0);
  }
  step();
}

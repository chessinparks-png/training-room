// CALCULATE — positions from my mistakes first, then my repertoire, then model games.
import { C, calcItems } from '../data/catalog.js';
import { mountCalc, LEVELS, KIND_LABEL } from '../training/calc.js';
import * as store from '../data/store.js';
import { esc, shuffle, pct, NIL } from '../ui.js';
import { FAMILIES } from '../repertoire/families.js';

export async function mount(el, params) {
  const pref = await store.setting('calc.prefs', { level: 'medium', kind: '', fam: '', src: '' });
  const history = await store.attempts('calc');
  let unmountTrainer = null;
  function pool() {
    const seen = new Map(history.map(a => [a.id, a]));
    let items = calcItems({ fam: pref.fam || null, kind: pref.kind || null, src: pref.src || null }).filter(c => c.line.length >= Math.min(LEVELS[pref.level].plies, 3));
    // order: unseen mine > unseen model > failed before > rest
    const rank = c => (seen.has(c.id) ? (seen.get(c.id).ok ? 3 : 2) : c.src === 'mine' ? 0 : 1);
    return shuffle(items).sort((a, b) => rank(a) - rank(b));
  }
  function home() {
    const n = history.length; const ok = history.filter(a => a.ok).length; const depthAvg = n ? (history.reduce((s, a) => s + (a.depth || 0), 0) / n).toFixed(1) : '—';
    const kinds = [...new Set(C.training.calc.map(c => c.kind))];
    el.innerHTML = `<div class="feature-head"><div><div class="kicker">Calculation</div><h1 class="display" style="margin-top:18px">Calculate.</h1><p class="lede" style="margin-top:22px">Do not move the pieces. See the line, then write it down. The comparison finds the first point where your calculation departs from the board.</p></div>
      <div class="grid cols-3"><div class="stat"><div class="bignum num">${n ? pct(ok, n) + '%' : NIL}</div><span class="label">Solved</span><div class="note">${n} attempts</div></div><div class="stat"><div class="bignum num">${depthAvg}</div><span class="label">Avg accurate plies</span></div><div class="stat"><div class="bignum num">${C.training.calc.filter(c => c.src === 'mine').length}</div><span class="label">From your games</span></div></div></div>
      <section class="section stack" style="--s:26px">
        <div class="row between"><span class="label">Depth</span><div class="choices" data-k="level">${Object.entries(LEVELS).map(([k, v]) => `<button data-v="${k}" aria-pressed="${pref.level === k}">${v.label} · ${v.note}</button>`).join('')}</div></div>
        <div class="row between"><span class="label">Type</span><div class="choices" data-k="kind"><button data-v="" aria-pressed="${!pref.kind}">All</button>${kinds.map(k => `<button data-v="${esc(k)}" aria-pressed="${pref.kind === k}">${esc(KIND_LABEL[k] || k)}</button>`).join('')}</div></div>
        <div class="row between"><span class="label">Source</span><div class="choices" data-k="src"><button data-v="" aria-pressed="${!pref.src}">All</button><button data-v="mine" aria-pressed="${pref.src === 'mine'}">My games</button><button data-v="model" aria-pressed="${pref.src === 'model'}">Model games</button></div></div>
        <div class="row between"><span class="label">Repertoire</span><div class="choices" data-k="fam"><button data-v="" aria-pressed="${!pref.fam}">All</button>${FAMILIES.map(f => `<button data-v="${f.id}" aria-pressed="${pref.fam === f.id}">${esc(f.name)}</button>`).join('')}</div></div>
        <div class="row" style="margin-top:12px"><button class="btn primary big" data-a="go">Begin</button><span class="small muted count"></span></div>
      </section>`;
    const upd = () => { el.querySelector('.count').textContent = `${pool().length} positions`; };
    upd();
    el.onclick = async e => {
      const c = e.target.closest('.choices button'); if (c) { const k = c.parentElement.dataset.k; pref[k] = c.dataset.v; await store.setSetting('calc.prefs', { ...pref }); c.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === c)); upd(); return; }
      if (e.target.closest('[data-a="go"]')) run();
    };
  }
  function run() {
    const q = pool(); let i = 0;
    const next = () => { if (unmountTrainer) unmountTrainer(); if (i >= q.length) { home(); return; } el.onclick = null; const it = q[i++]; unmountTrainer = mountCalc(el, it, { level: pref.level, onDone: () => next() }); };
    next();
  }
  if (params[0]) { const it = C.itemById.get(params.join('/')); if (it) { unmountTrainer = mountCalc(el, it, { level: pref.level, onDone: () => home() }); return () => unmountTrainer && unmountTrainer(); } }
  home();
  return () => unmountTrainer && unmountTrainer();
}

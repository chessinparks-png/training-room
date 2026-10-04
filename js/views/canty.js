// CANTY — James Canty's 1.d4 / 2.Nc3 repertoire as a move trainer, plus clock decisions.
import { canty } from '../data/catalog.js';
import { cantyQueue, cantySummary, runCanty, clockQueue, mountClock } from '../training/canty.js';
import { esc, NIL } from '../ui.js';

export async function mount(el, params) {
  const [mode, group] = params; let un = () => {};
  if (mode === 'train') un = await train(el, group || null);
  else if (mode === 'clock') un = await clock(el);
  else await home(el);
  return () => un();
}

const bar = (title, i, n) => `<div class="session-bar"><span class="label ink">${esc(title)} · ${Math.min(i + 1, n)} / ${n}</span><div class="meter"><i style="width:${(i / n) * 100}%"></i></div><a class="btn link" href="#/canty">End</a></div><div class="step-host"></div>`;

async function home(el) {
  const D = await canty(); const s = await cantySummary(); const go = s.all.due + s.all.new;
  el.innerHTML = `<div class="canty-home">
    <div class="stack" style="--s:18px">
      <div class="kicker">Repertoire · White · 1.d4 2.Nc3</div>
      <h1 class="h1">Canty's Jobava.</h1>
      <p class="lede">${D.positions.length} decision points from FM James Canty's games. Play his move. Misses come back sooner, known positions less often.</p>
      <div class="row" style="gap:22px"><a class="btn primary big" href="#/canty/train">${go ? `Train · ${Math.min(go, 8)}` : 'Review early'}</a><a class="arrow-link" href="#/canty/clock">Clock decisions</a></div>
      <div class="canty-stats"><div><b class="num">${s.acc != null ? Math.round(s.acc * 100) + '%' : NIL}</b><span class="label">First try</span></div><div><b class="num">${s.all.new}</b><span class="label">New</span></div><div><b class="num">${s.all.learning}</b><span class="label">Learning</span></div><div><b class="num">${s.all.known}</b><span class="label">Known</span></div></div>
    </div>
    <div class="group-list">${s.groups.map(g => `<a class="group-row" href="#/canty/train/${g.id}"><span class="t">${esc(g.full)}</span><span class="c">${g.due ? `<span class="chip accent">${g.due} due</span>` : ''} <span class="muted small">${g.new} new · ${g.learning} learning · ${g.known} known</span></span><span class="go">→</span></a>`).join('')}
      <p class="footnote">From the supplied games (chess.com, ${esc(D.source.split('—')[0].trim())}). Only positions he reached with 1.d4 and 2.Nc3; every move he chose there is accepted.</p></div>
  </div>`;
}

async function train(el, group) {
  const items = await cantyQueue(8, { group }); let i = 0;
  if (!items.length) { el.innerHTML = '<p class="empty">Nothing here yet.</p>'; return () => {}; }
  const frame = (k, n) => { i = k; el.innerHTML = bar('Canty', k, n); window.scrollTo(0, 0); return el.querySelector('.step-host'); };
  return runCanty(el, items, { frame, onDone: res => done(el, res, () => `#/canty/train${group ? '/' + group : ''}`) });
}

async function clock(el) {
  const items = await clockQueue(6); let k = 0; let un = () => {}; const res = [];
  const next = rec => { if (rec && !rec.skipped) res.push(rec); un(); if (k >= items.length) return done(el, res, () => '#/canty/clock', 'Clock decisions');
    el.innerHTML = bar('Clock decisions', k, items.length); window.scrollTo(0, 0); un = mountClock(el.querySelector('.step-host'), items[k++], { onDone: next }); };
  next();
  return () => un();
}

function done(el, res, again, title = 'Canty') {
  const ok = res.filter(r => r.ok).length;
  el.innerHTML = `<div class="stack" style="--s:22px;max-width:560px"><div class="kicker">${esc(title)}</div><h1 class="h1">${ok} / ${res.length}${title === 'Canty' ? ' first try' : ' correct calls'}.</h1>
    <div class="row" style="gap:22px"><a class="btn primary" href="${again()}" data-again>Again</a><a class="btn link" href="#/canty">Back</a><a class="btn link" href="#/today">Train Today</a></div></div>`;
  // same hash → force a remount
  el.querySelector('[data-again]').onclick = e => { if (location.hash === again()) { e.preventDefault(); window.dispatchEvent(new HashChangeEvent('hashchange')); } };
}

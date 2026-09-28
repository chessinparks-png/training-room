// REPERTOIRE — one system: my games, model games, positions, structures, plans, mistakes,
// model tendencies and training, per family. Every claim shows its sample.
import { C, famData, modelsFor, decisions, plans, calcItems, modelGames, myGames } from '../data/catalog.js';
import { FAMILIES, FAMILY, MODEL, FREQ } from '../repertoire/families.js';
import { miniBoard } from '../board/board.js';
import { Pos } from '../chess/core.js';
import { esc, line, pct, plural, shuffle, date } from '../ui.js';
import { mountDecision } from '../training/decision.js';
import { mountPlan } from '../training/plan.js';
import { mountPlayForward } from '../training/playforward.js';
import { nextRepair, mountRepairItem } from '../training/repair.js';
import * as srs from '../training/srs.js';
import { evidence } from '../repertoire/compare.js';
import { planOf } from '../repertoire/patterns.js';

const colorGames = c => C.rep.legacy.summary[c === 'w' ? 'white' : 'black'].n;
const scoreTxt = m => (m.n >= 5 && m.score != null ? m.score + '%' : '—');
const evidenceNote = n => ({ solid: 'Solid sample', moderate: 'Moderate sample', weak: 'Weak evidence — small sample' }[evidence(n)]);

export async function mount(el, params) {
  const [fam, mode, arg] = params;
  if (!fam || !FAMILY[fam]) return index(el);
  if (!mode) return room(el, fam);
  return trainLoop(el, fam, mode, arg);
}

function index(el) {
  el.innerHTML = `<div class="feature-head" style="border:0;padding-bottom:12px"><div><div class="kicker">My repertoire</div><h1 class="display" style="margin-top:18px">Four rooms.</h1></div>
    <p class="lede">What you play, what your model players play, where you differ, and what to train — built from ${C.rep.legacy.withMoves} of your games and ${Object.values(C.rep.modelStats).reduce((s, x) => s + Object.values(x.byFam).reduce((a, b) => a + b, 0), 0).toLocaleString()} relevant model games.</p></div>
    <div class="fam-list">${FAMILIES.map(f => {
      const F = famData(f.id); const ms = modelsFor(f.id); const mN = ms.reduce((s, m) => s + F.models[m.id].n, 0);
      return `<a class="fam-row" href="#/repertoire/${f.id}"><span class="no">${f.no}</span><span class="nm">${esc(f.name)}<small>${f.color === 'w' ? 'White' : 'Black'} · ${esc(ms.map(m => m.short).join(', '))}</small></span>
        <span class="facts"><span><b class="num">${F.mine.n}</b><span class="label">My games</span></span><span><b class="num">${mN.toLocaleString()}</b><span class="label">Model games</span></span><span><b class="num">${scoreTxt(F.mine)}</b><span class="label">My score</span></span></span>
        <span class="mini-wrap">${F.hero ? miniBoard(F.hero.fen, f.color, { size: '150px' }) : ''}</span></a>`;
    }).join('')}</div>
    <p class="footnote" style="margin-top:28px">Games are grouped by the structures actually reached (pawn skeletons, piece set-ups, transpositions), not by opening names. Chess.com/ECO labels are kept as metadata only.</p>`;
}

async function room(el, fam) {
  const f = FAMILY[fam]; const F = famData(fam); const ms = modelsFor(fam); const mp = ms[0]; const M = F.models[mp.id];
  const share = pct(F.mine.n, colorGames(f.color)); const rs = await srs.items(); const now = Date.now();
  const dueN = rs.filter(r => r.fam === fam && r.due <= now).length;
  const confirmed = C.training.drills.filter(d => d.fam === fam && d.verdict === 'mistake');
  const decN = decisions(fam).filter(d => !d.both).length, bothN = decisions(fam).filter(d => d.both).length, planN = plans(fam).length, calcN = calcItems({ fam }).length;
  const thin = F.mine.n < 10;
  const pats = (M.patterns.patterns || []).filter(p => !(p.type === 'place' && p.rate >= .97) && !(p.type === 'castle' && p.rate >= .97) && p.k >= FREQ.MIN_CLAIM);
  const cats = {}; for (const p of pats) (cats[p.cat] = cats[p.cat] || []).push(p);
  const diffs = M.shared.filter(s => s.differ);
  el.innerHTML = `
  <div class="feature-head"><div>
    <div class="row" style="gap:18px"><span class="no">${f.no}</span><span class="kicker">${f.color === 'w' ? 'White' : 'Black'} · ${esc(f.full)}</span></div>
    <h1 class="display" style="margin-top:18px">${esc(f.name)}</h1>
    <p class="lede" style="margin-top:20px">${esc(f.idea)}</p>
    <div class="grid cols-3" style="margin-top:36px">
      <div class="stat"><div class="bignum num">${F.mine.n && share < 1 ? '&lt;1' : share}%</div><span class="label">of ${f.color === 'w' ? 'White' : 'Black'} games</span><div class="note">${plural(F.mine.n, 'game')}${F.mine.partial ? ` · ${F.mine.partial} partial` : ''}</div></div>
      <div class="stat"><div class="bignum num">${scoreTxt(F.mine)}</div><span class="label">My score</span><div class="note">+${F.mine.wdl[0]} =${F.mine.wdl[1]} −${F.mine.wdl[2]}</div></div>
      <div class="stat"><div class="bignum num">${M.n.toLocaleString()}</div><span class="label">Model games</span><div class="note">${esc(mp.name)} · scored ${M.score}%</div></div>
    </div></div>
    <div>${F.hero ? `<div style="max-width:520px;margin-left:auto">${miniBoard(F.hero.fen, f.color)}<p class="footnote" style="margin-top:10px">The characteristic position after five moves — reached ${F.hero.n} times across your games and ${esc(mp.short)}'s.</p></div>` : ''}</div>
  </div>
  ${thin ? `<section class="section"><p class="insight" style="border:0">Evidence from your own games is too thin here (${plural(F.mine.n, 'game')}). This room is built on ${esc(mp.name)}'s ${M.n} games until you play or import more.</p></section>` : ''}
  <section class="section"><div class="section-head"><h2 class="h2">Train</h2><span class="label">${dueN} due for repair</span></div>
    <div class="grid cols-2" style="row-gap:6px">
      ${trainLink(`#/repertoire/${fam}/decide`, 'What would you play?', `${decN} positions from ${mp.short}'s games`)}
      ${bothN ? trainLink(`#/repertoire/${fam}/both`, 'A position you both play', `${bothN} positions you and ${mp.short} reached`) : ''}
      ${trainLink(`#/repertoire/${fam}/plan`, "What's the plan?", `${planN} positions · then watch how it was executed`)}
      ${trainLink(`#/repertoire/${fam}/play`, 'Play forward', `from ${M.starts.length} key positions`)}
      ${trainLink(`#/calculate`, 'Calculate', `${calcN} positions in this repertoire`, `data-calcfam="${fam}"`)}
      ${trainLink(`#/vision/blind/${fam}`, 'Blindfold — a model game', `follow ${mp.short}'s moves without the board`)}
      ${trainLink(`#/repertoire/${fam}/repair`, 'Repair', `${dueN} due · ${confirmed.length} confirmed mistakes from your games`)}
    </div></section>
  <section class="section"><div class="section-head"><h2 class="h2">What each of us plays</h2><span class="label">Most frequent path · share of games</span></div>
    <div class="grid cols-2">${mainlineCol('You', F.mine.mainline, 0)}${mainlineCol(mp.short, M.mainline, 0)}</div></section>
  <section class="section"><div class="section-head"><h2 class="h2">Where you differ</h2><span class="label">Identical positions · transpositions included</span></div>
    ${diffs.length ? diffs.slice(0, 6).map(s => diffRow(fam, f, mp, s)).join('') : `<p class="empty">No shared position has enough games on both sides yet.</p>`}
    ${diffs.length > 6 ? `<details><summary class="btn link" style="margin-top:16px">${diffs.length - 6} more</summary>${diffs.slice(6).map(s => diffRow(fam, f, mp, s)).join('')}</details>` : ''}</section>
  <section class="section"><div class="section-head"><h2 class="h2">The plans that matter</h2><span class="label">From ${esc(mp.short)}'s games · at least k of n</span></div>${plansThatMatter(M, mp)}</section>
  <section class="section"><div class="section-head"><h2 class="h2">Structures that keep occurring</h2></div>
    ${structures(F, M, mp)}</section>
  <section class="section"><div class="section-head"><h2 class="h2">${esc(mp.short)}'s tendencies</h2><span class="label">${M.n} games · ${M.dateRange[0]?.slice(0, 4)}–${M.dateRange[1]?.slice(0, 4)}</span></div>
    <p class="footnote" style="margin-bottom:18px">Frequency words are strict: <b>common</b> ≥ 50% of games, <b>recurring</b> ≥ 20%, <b>occasional</b> below that. Nothing seen fewer than ${FREQ.MIN_CLAIM} times is shown. Every row links to its source games.</p>
    ${Object.entries(cats).map(([cat, ps]) => `<div style="margin-top:34px"><div class="label ink" style="margin-bottom:6px">${esc(cat)}</div>${ps.slice(0, cat === 'PIECE PLACEMENTS' ? 5 : 4).map(p => patternRow(fam, f, mp, p)).join('')}</div>`).join('')}
  </section>
  <section class="section"><div class="section-head"><h2 class="h2">What you are bad at</h2></div>${weakness(fam, F, confirmed, dueN)}</section>
  <section class="section"><div class="section-head"><h2 class="h2">Games</h2></div><div class="grid cols-2"><div class="games-mine"></div><div class="games-model"><p class="label pulse">Loading…</p></div></div></section>`;
  el.querySelector('.games-mine').innerHTML = myGamesList(fam);
  el.querySelectorAll('[data-calcfam]').forEach(a => a.addEventListener('click', async () => { const store = await import('../data/store.js'); const pr = await store.setting('calc.prefs', { level: 'medium', kind: '', fam: '', src: '' }); await store.setSetting('calc.prefs', { ...pr, fam }); }));
  modelGames().then(gs => { const list = gs.filter(g => g.fam === fam && g.p === mp.id); const sample = list.slice(-12).reverse(); const box = el.querySelector('.games-model'); if (box) box.innerHTML = `<div class="label" style="margin-bottom:12px">${esc(mp.short)} · latest of ${list.length}</div><table class="table">${sample.map(g => `<tr><td class="small">${esc(g.date)}</td><td>${esc(g.opp)} <span class="muted small">${g.oppElo || ''}</span></td><td class="small">${esc(g.sub || '')}</td><td class="r">${g.res === 1 ? 'Won' : g.res === 0 ? 'Lost' : 'Drew'}</td><td class="r">${g.link ? `<a href="${esc(g.link)}" target="_blank" rel="noopener" class="small">Game</a>` : ''}</td></tr>`).join('')}</table>`; });
}
const trainLink = (href, t, sub, extra = '') => `<a href="${href}" ${extra} class="fam-train" style="display:flex;justify-content:space-between;gap:18px;align-items:baseline;padding:18px 0;border-bottom:1px solid var(--rule);text-decoration:none"><span><span class="h3">${esc(t)}</span><span class="small muted" style="display:block;margin-top:4px">${esc(sub)}</span></span><span class="arrow-link" style="border:0"></span></a>`;

function mainlineCol(who, ml, start) {
  if (!ml || !ml.length) return `<div><div class="label">${esc(who)}</div><p class="empty">Not enough games.</p></div>`;
  return `<div><div class="label ink" style="margin-bottom:12px">${esc(who)}</div><table class="table">${ml.map(([s, k, n], i) => `<tr><td style="width:70px" class="muted small">${i % 2 === 0 ? (i / 2 + 1) + '.' : (Math.floor(i / 2) + 1) + '…'}</td><td class="serif" style="font-size:18px">${esc(s)}</td><td style="width:45%"><div class="bar-h"><i style="width:${pct(k, n)}%"></i></div></td><td class="r small muted num">${k}/${n}</td></tr>`).join('')}</table></div>`;
}
function diffRow(fam, f, mp, s) {
  const n = Math.min(s.mine.n, s.model.n);
  const myShare = `${s.mine.topN} of ${s.mine.n}`, moShare = `${s.model.topN} of ${s.model.n}`;
  const ply = (() => { const p = s.fen.split(' '); return p[1] === 'w' ? '' : '…'; })();
  const it = C.training.decisions.find(d => d.both && d.id === 'both:' + s.hash);
  const p = new Pos(s.fen + ' 0 1'); const am = p.parseSan(s.model.top);
  return `<div class="diff"><div>${miniBoard(s.fen + ' 0 1', f.color, { arrow: am ? { from: am & 127, to: (am >> 7) & 127 } : null })}</div>
    <div class="stack" style="--s:14px"><div class="label accent">A position you both play</div>
      <div class="grid cols-2" style="gap:18px"><div class="stat"><div class="midnum">${ply}${esc(s.model.top)}</div><span class="label">${esc(mp.short)} · ${moShare}</span></div><div class="stat"><div class="midnum">${ply}${esc(s.mine.top)}</div><span class="label">You · ${myShare}</span></div></div>
      <p class="small ink2">${s.differ ? `In the supplied games ${esc(mp.short)} usually chose ${esc(s.model.top)}; you usually chose ${esc(s.mine.top)}.` : 'You make the same choice.'} <span class="muted">${evidenceNote(n)} (${s.mine.n} of yours, ${s.model.n} of ${esc(mp.short)}'s).</span></p>
      ${it ? `<a class="arrow-link" href="#/repertoire/${fam}/both/${encodeURIComponent(s.hash)}">Train this idea</a>` : ''}</div></div>`;
}
// Patterns grouped into plans. A plan's share is at least its most frequent member pattern (a lower bound).
function plansThatMatter(M, mp) {
  const by = {};
  for (const p of M.patterns.patterns) { const plan = planOf({ type: p.type, key: p.key, to: p.key.split(':')[1]?.slice(-2) }); if (!plan || p.type === 'castle') continue; const b = by[plan] || (by[plan] = { plan, best: p, list: [] }); b.list.push(p); if (p.k > b.best.k) b.best = p; }
  const rows = Object.values(by).filter(b => b.best.k >= 5).sort((a, b) => b.best.k - a.best.k).slice(0, 8);
  return `<table class="table">${rows.map(b => `<tr><td class="serif" style="font-size:19px;width:34%">${esc(b.plan)}</td><td class="small ink2">${b.list.sort((x, y) => y.k - x.k).slice(0, 3).map(p => esc(p.label.replace(/ (placement|break|pawn storm)$/, '')) + ` <span class="muted">${p.k}</span>`).join(' · ')}</td><td style="width:22%"><div class="bar-h"><i class="acc" style="width:${Math.round(b.best.k / b.best.n * 100)}%"></i></div></td><td class="r num small" style="white-space:nowrap">≥ ${Math.round(b.best.k / b.best.n * 100)}%</td></tr>`).join('')}</table>`;
}
function structures(F, M, mp) {
  const subs = [...new Set([...Object.keys(F.mine.subs), ...Object.keys(M.subs)])].filter(s => !/partial|undetermined/.test(s));
  const tm = F.mine.patterns.tension, to = M.openingPatterns ? M.openingPatterns.tension : M.patterns.tension;
  const rows = subs.map(s => [s, F.mine.subs[s] || 0, M.subs[s] || 0]).sort((a, b) => (b[1] + b[2] / 20) - (a[1] + a[2] / 20));
  const tensionLine = to && to.moments >= 10 ? `<div class="insight">${esc(mp.short)} captures at the first chance in ${pct(to.resolved, to.moments)}% of new central pawn tensions <small>${to.resolved} of ${to.moments} moments in the first 12 moves.${tm && tm.moments >= 6 ? ` You: ${pct(tm.resolved, tm.moments)}% (${tm.resolved} of ${tm.moments}) — ${evidenceNote(tm.moments).toLowerCase()}.` : ' Your sample is too small to compare.'}</small></div>` : '';
  return `<table class="table"><thead><tr><th>Structure / set-up</th><th class="r">You</th><th class="r">${esc(mp.short)}</th></tr></thead><tbody>${rows.map(([s, a, b]) => `<tr><td class="serif" style="font-size:17px">${esc(s)}</td><td class="r num">${a || '—'}</td><td class="r num">${b ? b.toLocaleString() : '—'}</td></tr>`).join('')}</tbody></table>${tensionLine}
    ${M.claims.map(c => `<div class="insight">${esc(c.text)}<small>${esc(c.mine)} · ${esc(c.model)} · ${esc(c.evidence)} evidence</small></div>`).join('')}`;
}
function patternRow(fam, f, mp, p) {
  const pp = p.fen ? new Pos(p.fen) : null; const m = pp && p.san ? pp.parseSan(p.san) : 0;
  const trainable = C.training.decisions.some(d => d.fam === fam && d.pattern === p.key);
  const ex = p.examples.slice(0, 3);
  return `<div class="pattern-row"><div class="thumb">${p.fen ? miniBoard(p.fen, f.color, { arrow: m ? { from: m & 127, to: (m >> 7) & 127 } : null }) : ''}</div>
    <div><div class="t">${esc(p.label)}</div><div class="small ink2" style="margin-top:6px">Typically around move ${p.medianMove}. ${ex.map((e, i) => `<a href="https://www.chess.com/game/live/${esc(e.id)}" target="_blank" rel="noopener" class="small muted">game ${i + 1}</a>`).join(' · ')}</div>
    ${trainable ? `<a class="arrow-link" style="margin-top:10px" href="#/repertoire/${fam}/decide/${encodeURIComponent(p.key)}">Train this</a>` : ''}</div>
    <div class="freq"><b class="num">${p.k.toLocaleString()}<span class="small muted"> / ${p.n.toLocaleString()}</span></b><span class="chip ${p.freq === 'common' || p.freq === 'recurring' ? 'accent' : ''}" style="margin-top:8px">${esc(p.freq)}</span></div></div>`;
}
function weakness(fam, F, confirmed, dueN) {
  const w = F.weak.slice(0, 6);
  const top = confirmed.slice().sort((a, b) => b.n * b.loss - a.n * a.loss).slice(0, 4);
  return `<div class="grid cols-3"><div class="stat"><div class="bignum num">${confirmed.length}</div><span class="label">Confirmed mistakes</span><div class="note">Stockfish-verified positions from your games</div></div><div class="stat"><div class="bignum num">${dueN}</div><span class="label">Due for repair</span></div><div class="stat"><div class="bignum num">${w.length}</div><span class="label">Weak branches</span><div class="note">Lines scoring well below your average</div></div></div>
    ${w.length ? `<table class="table" style="margin-top:28px"><thead><tr><th>Line</th><th>Who</th><th class="r">Games</th><th class="r">Score</th><th class="r">Your avg</th></tr></thead><tbody>${w.map(t => `<tr><td class="small">${line(t.path)}</td><td class="small">${t.oppMove ? 'Opponent’s choice' : 'Your choice'}</td><td class="r num">${t.n}</td><td class="r num err">${t.score}%</td><td class="r num muted">${t.base}%</td></tr>`).join('')}</tbody></table>` : ''}
    ${top.length ? `<div style="margin-top:28px"><div class="label" style="margin-bottom:10px">Most costly repeated mistakes</div><table class="table">${top.map(d => `<tr><td class="serif" style="font-size:17px">${esc(d.moveNo)} <span class="muted">→</span> ${esc(d.sfBest)}</td><td class="small ink2">${d.n > 1 ? `played ${d.n}×` : 'once'} · −${d.loss}% win chance</td><td class="r"><a class="small" href="https://www.chess.com/game/live/${esc(d.games[0])}" target="_blank" rel="noopener">game</a></td></tr>`).join('')}</table><a class="arrow-link" style="margin-top:16px" href="#/repertoire/${fam}/repair">Repair these</a></div>` : ''}`;
}
function myGamesList(fam) {
  const gs = myGames().filter(g => g.fam === fam).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 12);
  if (!gs.length) return '<p class="empty">No games of yours in this family yet.</p>';
  return `<div class="label" style="margin-bottom:12px">You · latest ${gs.length}</div><table class="table">${gs.map(g => `<tr><td class="small">${esc(g.date)}</td><td>${esc(g.opp)} <span class="muted small">${g.oppElo || ''}</span></td><td class="small muted">${g.conf === 'partial' ? 'partial' : esc(g.sub || '')}</td><td class="r">${g.res === 1 ? 'Won' : g.res === 0 ? 'Lost' : 'Drew'}</td><td class="r"><a href="${esc(g.link)}" target="_blank" rel="noopener" class="small">Game</a></td></tr>`).join('')}</table>`;
}

// ---- training loops inside a family ----
async function trainLoop(el, fam, mode, arg) {
  let un = null; const back = () => { location.hash = `#/repertoire/${fam}`; };
  const run = (items, mountFn) => { const q = items.slice(); let i = 0; const next = () => { un && un(); if (i >= q.length) return back(); un = mountFn(el, q[i++], { onDone: next }); }; next(); };
  if (mode === 'decide') {
    const all = decisions(fam).filter(d => !d.both);
    let items = arg && arg.startsWith('dec:') ? [...all.filter(d => d.id === arg), ...shuffle(all.filter(d => d.id !== arg))] : shuffle(all.filter(d => !arg || d.pattern === arg));
    run(items, mountDecision);
  }
  else if (mode === 'both') { let items = decisions(fam).filter(d => d.both); if (arg) items = items.filter(d => d.id === 'both:' + arg).concat(items.filter(d => d.id !== 'both:' + arg)); run(items, mountDecision); }
  else if (mode === 'plan') run(shuffle(plans(fam)), mountPlan);
  else if (mode === 'play') {
    const F = famData(fam); const starts = modelsFor(fam).flatMap(m => (F.models[m.id].starts || []).map(s => ({ ...s, fam, player: m.id, side: FAMILY[fam].color })));
    if (arg == null) {
      el.innerHTML = `<div class="section-head"><div><div class="kicker">Play forward · ${esc(FAMILY[fam].name)}</div><h1 class="h1" style="margin-top:14px">Choose a position.</h1></div><a class="btn link" href="#/repertoire/${fam}">Back</a></div>
        <div class="grid cols-4">${starts.map((s, i) => `<a href="#/repertoire/${fam}/play/${i}" style="text-decoration:none">${miniBoard(s.fen, s.side)}<div class="small ink2" style="margin-top:10px">${esc(MODEL[s.player].short)} ${s.n}×${s.mine ? ' · <span class="accent">also in your games</span>' : ''}</div></a>`).join('')}</div>`;
      return;
    }
    const s = starts[+arg]; if (!s) return back();
    un = mountPlayForward(el, s, { onDone: () => { location.hash = `#/repertoire/${fam}/play`; } });
  }
  else if (mode === 'repair') {
    const items = await nextRepair(12, { fam, fresh: 6 });
    if (!items.length) { el.innerHTML = `<p class="empty">Nothing due in this repertoire. <a href="#/repertoire/${fam}">Back</a></p>`; return; }
    let i = 0; const next = async () => { un && un(); if (i >= items.length) return back(); un = await mountRepairItem(el, items[i++], { onDone: next }); }; next();
  }
  return () => un && un();
}

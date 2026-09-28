// PROGRESS — the diagnostic layer: why am I losing 3+2 games? Few numbers, each with its sample.
import * as store from '../data/store.js';
import * as srs from '../training/srs.js';
import { C, myGames, legacy } from '../data/catalog.js';
import { insights, reliableDepth, blitzMoves, trend } from '../analysis/insights.js';
import { importPgnFile, downloadBackup, restoreBackup, findMistakes } from '../data/importer.js';
import { status as engineStatus } from '../analysis/engine.js';
import { FAMILIES, FAMILY, MODEL_PLAYERS } from '../repertoire/families.js';
import { esc, pct, toast, date, NIL, applyTheme } from '../ui.js';
import { isSound, THRESHOLDS } from '../analysis/quality.js';

export async function mount(el) {
  const [attempts, blitz, rs] = await Promise.all([store.attempts(), store.all('blitz'), srs.stats()]);
  const games = blitz.filter(g => g.metrics).sort((a, b) => a.t - b.t);
  const moves = blitzMoves(games); const calc = attempts.filter(a => a.mode === 'calc'); const vis = attempts.filter(a => a.mode === 'vision');
  const dec = attempts.filter(a => a.mode === 'decision' || a.mode === 'plan');
  const ins = insights({ attempts, blitz: games });
  const L = C.rep.legacy.summary; const lostTime = L.term['lost:time'] || 0, lostAll = L.white.l + L.black.l;
  const rd = reliableDepth(calc);
  const decT = trend(dec.filter(a => a.ok), a => a.sec);
  const m = k => (games.length ? games.reduce((s, g) => s + (g.metrics[k] || 0), 0) / games.length : null);
  const timed = moves.filter(r => r.think != null);
  el.innerHTML = `
  <div class="feature-head"><div><div class="kicker">Progress</div><h1 class="display" style="margin-top:18px">Why am I losing<br>3+2 games?</h1></div>
    <div class="stack" style="--s:0">${ins.length ? ins.slice(0, 4).map(i => `<div class="insight">${esc(i.text)}<small>${esc(i.detail)}</small></div>`).join('') : `<p class="lede">Not enough evidence yet for firm conclusions. Each finding here needs a minimum sample — play blitz, calculate and train decisions, and they will appear.</p>`}</div></div>

  <section class="section"><div class="section-head"><h2 class="h2">From your Chess.com history</h2><span class="label">${L.total} games · ${esc(L.from)} → ${esc(L.to)}</span></div>
    <div class="grid cols-4">
      <div class="stat"><div class="bignum num">${pct(lostTime, lostAll)}%</div><span class="label">Losses on time</span><div class="note">${lostTime} of ${lostAll} losses</div></div>
      <div class="stat"><div class="bignum num">${L.vs.higher.score}%</div><span class="label">Score vs higher-rated</span><div class="note">${L.vs.higher.n} games · vs lower ${L.vs.lower.score}%</div></div>
      <div class="stat"><div class="bignum num">${L.current}</div><span class="label">Rating</span><div class="note">peak ${L.peak}</div>${spark(L.ratingTrend.map(x => x.last))}</div>
      <div class="stat"><div class="bignum num">${C.training.drills.filter(d => d.verdict === 'mistake').length}</div><span class="label">Confirmed mistakes</span><div class="note">of ${C.training.drills.length} Drill Room positions; ${C.training.drills.filter(d => d.verdict === 'not-a-mistake').length} were not mistakes by Stockfish</div></div></div></section>

  <section class="section legacy-groups"></section>

  <section class="section"><div class="section-head"><h2 class="h2">Blitz</h2><span class="label">${games.length} games played here</span></div>
    <div class="grid cols-4">
      <div class="metric"><div class="bignum num">${games.length ? m('errors').toFixed(1) : NIL}</div><span class="label">Serious errors / game</span>${spark(games.map(g => g.metrics.errors))}</div>
      <div class="metric"><div class="bignum num">${games.length ? m('avgThink').toFixed(1) + '<small>sec</small>' : NIL}</div><span class="label">Average think</span><div class="note small ink2">${timed.length ? `good moves ${avgOf(timed.filter(r => isSound(r.quality)).map(r => r.think))}s · before errors ${avgOf(timed.filter(r => !isSound(r.quality) && r.quality !== 'inaccuracy').map(r => r.think))}s` : ''}</div></div>
      <div class="metric"><div class="bignum num">${games.length ? m('impulsive').toFixed(1) : NIL}</div><span class="label">Impulsive errors / game</span><div class="note small ink2">errors in under ${THRESHOLDS.fastSec}s</div></div>
      <div class="metric"><div class="bignum num">${games.length ? m('overthinks').toFixed(1) : NIL}</div><span class="label">Overthinks / game</span><div class="note small ink2">${games.length ? `clock left at end ${avgOf(games.map(g => g.clockEnd))}s` : ''}</div></div></div></section>

  <section class="section"><div class="section-head"><h2 class="h2">Calculation</h2><span class="label">${calc.length} positions</span></div>
    <div class="grid cols-4">
      <div class="metric"><div class="bignum num">${rd.reliable || NIL}<small>${rd.reliable ? 'ply' : ''}</small></div><span class="label">Reliable depth</span><div class="note small ink2">≥ 70% accurate to this depth</div>${curve(rd.curve)}</div>
      <div class="metric"><div class="bignum num">${calc.length ? pct(calc.filter(a => a.firstOk).length, calc.length) + '%' : NIL}</div><span class="label">First-move accuracy</span></div>
      <div class="metric"><div class="bignum num">${calc.length ? Math.round(calc.reduce((s, a) => s + (a.acc || 0), 0) / calc.length * 100) + '%' : NIL}</div><span class="label">Variation accuracy</span></div>
      <div class="metric"><div class="bignum num">${calc.length ? avgOf(calc.map(a => a.sec)) : NIL}<small>${calc.length ? 'sec' : ''}</small></div><span class="label">Calculation time</span></div></div>
    ${kindTable(calc)}</section>

  <section class="section"><div class="section-head"><h2 class="h2">Repertoire</h2><span class="label">${dec.length} decisions</span></div>
    <div class="grid cols-2" style="margin-bottom:24px"><div class="metric"><div class="bignum num">${decT.cur != null ? decT.cur.toFixed(1) + '<small>sec</small>' : NIL}</div><span class="label">Average correct decision</span><div class="note small ink2">${decT.delta != null ? `${decT.delta < 0 ? '↓' : '↑'} ${Math.abs(decT.delta).toFixed(1)} sec vs previous 30 days` : 'last 30 days'}</div></div>
    <div class="metric"><div class="bignum num">${dec.filter(a => a.mode === 'decision').length ? pct(dec.filter(a => a.matched).length, dec.filter(a => a.mode === 'decision').length) + '%' : NIL}</div><span class="label">Model-move recognition</span><div class="note small ink2">same move as the model player</div></div></div>
    <table class="table"><thead><tr><th>Family</th><th class="r">Decisions</th><th class="r">Sound</th><th class="r">Plans</th><th class="r">Repair due</th><th class="r">Weak branches</th></tr></thead><tbody>
    ${await famRows(attempts)}</tbody></table></section>

  <section class="section"><div class="section-head"><h2 class="h2">Vision</h2><span class="label">${vis.length} answers</span></div>
    <div class="grid cols-4">
      <div class="metric"><div class="bignum num">${rate(vis.filter(a => a.area === 'squares'))}</div><span class="label">Square accuracy</span><div class="note small ink2">${speed(vis.filter(a => a.area === 'squares'))}</div></div>
      <div class="metric"><div class="bignum num">${rate(vis.filter(a => a.area === 'board'))}</div><span class="label">Board-memory accuracy</span></div>
      <div class="metric"><div class="bignum num">${rate(vis.filter(a => a.area === 'blind'))}</div><span class="label">Blindfold accuracy</span></div>
      <div class="metric"><div class="bignum num">${Math.max(0, ...vis.filter(a => a.area === 'blind' && a.ok && a.plies).map(a => a.plies)) || NIL}</div><span class="label">Max tracked plies</span></div></div></section>

  <section class="section"><div class="section-head"><h2 class="h2">Repair</h2></div>
    <div class="grid cols-4"><div class="metric"><div class="bignum num">${rs.due}</div><span class="label">Due</span></div><div class="metric"><div class="bignum num">${rs.learning}</div><span class="label">Learning</span></div><div class="metric"><div class="bignum num">${rs.mastered}</div><span class="label">Mastered</span></div><div class="metric"><div class="bignum num">${rs.repeatFailures}</div><span class="label">Repeat failures</span></div></div></section>

  <section class="section" id="data"><div class="section-head"><h2 class="h2">Data</h2><span class="label">Stored only on this device</span></div>
    <div class="grid cols-2">
      <div class="stack" style="--s:16px"><div class="label ink">Import games (PGN)</div>
        <p class="small ink2">Your Chess.com export replaces the opening-only Drill Room records with full games. Model-player PGNs are filtered to the configured repertoire families; unrelated games are ignored.</p>
        <div class="row"><select id="imp-kind" aria-label="Whose games"><option value="mine">My games</option>${MODEL_PLAYERS.map(m => `<option value="model:${m.id}">${esc(m.name)}</option>`).join('')}</select><label class="btn">Choose PGN<input type="file" id="imp-file" accept=".pgn,text/plain" hidden multiple></label></div>
        <div class="imp-status small ink2"></div>
        <div class="row"><button class="btn link" data-a="scan">Find mistakes in imported games</button><span class="scan-status small muted"></span></div>
        <p class="footnote">${C.imported.filter(g => g.kind === 'mine').length} of your games and ${C.imported.filter(g => g.kind === 'model').length} model games imported here. ${myGames().filter(g => g.src === 'legacy').length} Drill Room records.</p></div>
      <div class="stack" style="--s:16px"><div class="label ink">Backup</div>
        <div class="row"><button class="btn" data-a="export">Export backup</button><label class="btn">Import backup<input type="file" id="bk-file" accept=".json,application/json" hidden></label></div>
        <p class="small ink2">Import also accepts the old Drill Room's progress text (paste it into a .json file) — your boxes and history carry over.</p>
        <div class="row"><button class="btn quiet" data-a="reset">Reset data</button></div>
        <div class="label ink" style="margin-top:22px">Edition</div><div class="choices" data-k="theme"><button data-v="noir" aria-pressed="${document.documentElement.dataset.theme !== 'ivory'}">Noir</button><button data-v="ivory" aria-pressed="${document.documentElement.dataset.theme === 'ivory'}">Ivory</button></div>
        <p class="footnote">Engine: ${engineStatus.mode === 'stockfish' ? 'Stockfish 19 (local WASM)' : esc(engineStatus.note || engineStatus.mode)}. Data built ${esc(date(C.rep.built))}.</p></div></div></section>`;
  legacyGroups(el.querySelector('.legacy-groups'));
  el.addEventListener('change', async e => {
    if (e.target.id === 'imp-file' && e.target.files.length) {
      const [k, player] = el.querySelector('#imp-kind').value.split(':'); const st = el.querySelector('.imp-status');
      for (const f of e.target.files) {
        st.innerHTML = `<span class="pulse">Reading ${esc(f.name)}…</span>`;
        try { const r = await importPgnFile(f, { kind: k, player }, p => { st.innerHTML = `<span class="pulse">${p.phase === 'derive' ? `Rebuilding repertoire intelligence ${p.done + 1}/${p.total}` : `Parsed ${p.done} of ~${p.total} games`}</span>`; });
          st.innerHTML = `${esc(f.name)}: ${r.added} added · ${r.dupes} duplicates · ${r.unrelated ? r.unrelated + ' outside the repertoire · ' : ''}${r.invalid} invalid${r.wrongPlayer ? ' · ' + r.wrongPlayer + ' without ' + esc(r.handle) : ''}. ${Object.entries(r.byFam).map(([f2, n]) => `${esc(FAMILY[f2].name)} ${n}`).join(', ')}`; }
        catch (err) { st.innerHTML = `<span class="err">${esc(err.message)}</span>`; }
      }
    }
    if (e.target.id === 'bk-file' && e.target.files[0]) { try { const r = await restoreBackup(await e.target.files[0].text()); toast(r.kind === 'legacy' ? `Drill Room progress imported: ${r.items} positions` : 'Backup restored'); setTimeout(() => location.reload(), 900); } catch (err) { toast(err.message); } }
  });
  el.addEventListener('click', async e => {
    const c = e.target.closest('[data-k="theme"] button'); if (c) { const v = c.dataset.v; applyTheme(v); await store.setSetting('theme', v); c.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === c)); return; }
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'export') downloadBackup();
    if (a.dataset.a === 'reset') { if (a.dataset.armed) { await store.resetAll(); try { localStorage.removeItem('tr.theme'); } catch (x) {} toast('All training data reset'); setTimeout(() => location.reload(), 800); } else { a.dataset.armed = 1; a.textContent = 'Click again to erase everything'; } }
    if (a.dataset.a === 'scan') { const s = el.querySelector('.scan-status'); s.textContent = 'Scanning…'; const r = await findMistakes({ limit: 20, onProgress: (k, n, f) => { s.textContent = `${k}/${n} games · ${f} mistakes queued`; } }); s.textContent = `${r.scanned} games scanned · ${r.found} mistakes added to Repair · ${r.remaining} left`; }
  });
}
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const avgOf = xs => { const v = xs.filter(x => x != null); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '—'; };
const rate = xs => (xs.length ? pct(xs.filter(a => a.ok).length, xs.length) + '%' : '—');
const speed = xs => { const ok = xs.filter(a => a.ok && a.ms); return ok.length ? `${(ok.reduce((s, a) => s + a.ms, 0) / ok.length / 1000).toFixed(2)}s per correct square` : ''; };
function spark(vals) {
  const v = vals.filter(x => x != null); if (v.length < 3) return '';
  const W = 200, H = 40, lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${v.map((x, i) => `${(i / (v.length - 1)) * W},${H - 4 - ((x - lo) / r) * (H - 8)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
}
function curve(c) {
  if (c.length < 2) return '';
  const W = 200, H = 40; return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Accuracy by depth"><line x1="0" x2="${W}" y1="${H - H * 0.7}" y2="${H - H * 0.7}" stroke="var(--rule-2)" stroke-dasharray="3 3"/><polyline points="${c.map((x, i) => `${(i / (c.length - 1)) * W},${H - x.rate * H}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
}
function kindTable(calc) {
  const by = {}; for (const a of calc) { const b = by[a.kind] || (by[a.kind] = { n: 0, ok: 0, d: 0 }); b.n++; if (a.ok) b.ok++; b.d += a.depth || 0; }
  const rows = Object.entries(by).filter(([, b]) => b.n >= 3).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n);
  return rows.length ? `<table class="table" style="margin-top:24px"><thead><tr><th>Type</th><th class="r">Positions</th><th class="r">Solved</th><th class="r">Avg accurate plies</th></tr></thead><tbody>${rows.map(([k, b]) => `<tr><td class="serif" style="font-size:17px">${esc(k)}</td><td class="r num">${b.n}</td><td class="r num">${pct(b.ok, b.n)}%</td><td class="r num">${(b.d / b.n).toFixed(1)}</td></tr>`).join('')}</tbody></table>` : '';
}
async function famRows(attempts) {
  const items = await srs.items(); const now = Date.now();
  return FAMILIES.map(f => { const d = attempts.filter(a => a.mode === 'decision' && a.fam === f.id), p = attempts.filter(a => a.mode === 'plan' && a.fam === f.id);
    return `<tr><td class="serif" style="font-size:18px">${esc(f.name)}</td><td class="r num">${d.length}</td><td class="r num">${d.length ? pct(d.filter(a => a.ok).length, d.length) + '%' : '—'}</td><td class="r num">${p.length ? pct(p.filter(a => a.ok).length, p.length) + '%' : '—'}</td><td class="r num">${items.filter(r => r.fam === f.id && r.due <= now).length}</td><td class="r num">${(C.rep.families[f.id].weak || []).length}</td></tr>`; }).join('');
}

// The Drill Room's recurring-mistake clusters, kept only where Stockfish confirms the example positions.
async function legacyGroups(box) {
  const D = await legacy().catch(() => null); if (!D || !box) return;
  const rows = D.groups.map(g => { const ex = g.examples.map(x => C.drillById.get(x.id)).filter(Boolean); const conf = ex.filter(d => d.verdict === 'mistake').length; return { g, conf, n: ex.length }; })
    .filter(r => r.n && r.conf / r.n >= 0.6).slice(0, 5);
  if (!rows.length) { box.remove(); return; }
  box.innerHTML = `<div class="section-head"><h2 class="h2">Recurring mistakes in your games</h2><span class="label">Drill Room clusters · Stockfish-checked</span></div>
    ${rows.map(({ g, conf, n }) => `<div class="insight">${esc(cap(g.label.replace(/^[^:]+:\s*/, '')))}<small>${esc(g.label.split(':')[0])} · ${g.games} games · ${conf} of ${n} example positions confirmed by Stockfish</small></div>`).join('')}`;
}

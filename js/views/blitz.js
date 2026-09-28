// BLITZ — genuine 3+2. The board and clocks dominate. No evaluation, hints, labels or takebacks.
// Every decision is recorded invisibly and reviewed afterwards.
import { Board } from '../board/board.js';
import { Pos, mFrom, mTo, BL } from '../chess/core.js';
import { playMove, analyse } from '../analysis/engine.js';
import { analyseGame, diagnose, toRepair } from '../analysis/diagnosis.js';
import { book } from '../data/catalog.js';
import * as store from '../data/store.js';
import { esc, fmtClock, line, weighted, sleep, pct, date, NIL } from '../ui.js';
import { MOVE_LABEL, DECISION_LABEL, fmtEval, winPct } from '../analysis/quality.js';
import { mountMoveRepair } from '../training/repair.js';
import { mountCalc } from '../training/calc.js';
import * as srs from '../training/srs.js';
import { famName } from '../training/common.js';

const BASE = 180, INC = 2;
const STRENGTH = { club: { label: 'Club', elo: 1900 }, match: { label: 'Match', elo: 2150 }, strong: { label: 'Strong', elo: 2400 } };

export async function mount(el, params) {
  if (params[0] === 'review' && params[1]) return review(el, params[1]);
  if (params[0] === 'play') return play(el, params[1] || null);
  return lobby(el);
}

async function lobby(el) {
  const games = (await store.all('blitz')).sort((a, b) => b.t - a.t);
  const pref = await store.setting('blitz.prefs', { color: 'alt', strength: 'match' });
  const done = games.filter(g => g.metrics);
  const m = k => (done.length ? (done.reduce((s, g) => s + (g.metrics[k] || 0), 0) / done.length) : null);
  el.innerHTML = `<div class="feature-head"><div><div class="kicker">Blitz</div><h1 class="display" style="margin-top:18px;font-size:clamp(88px,14vw,190px)">3<span class="muted">+</span>2</h1></div>
    <div class="stack" style="--s:24px"><p class="lede">Three minutes, two seconds a move. The opponent opens with what your real opponents play, then Stockfish takes over at a human strength and pace. Nothing is shown until the game ends.</p>
      <div class="row between"><span class="label">Colour</span><div class="choices" data-k="color"><button data-v="alt" aria-pressed="${pref.color === 'alt'}">Alternate</button><button data-v="w" aria-pressed="${pref.color === 'w'}">White</button><button data-v="b" aria-pressed="${pref.color === 'b'}">Black</button></div></div>
      <div class="row between"><span class="label">Opponent</span><div class="choices" data-k="strength">${Object.entries(STRENGTH).map(([k, v]) => `<button data-v="${k}" aria-pressed="${pref.strength === k}">${v.label}</button>`).join('')}</div></div>
      <div><a class="btn primary big" href="#/blitz/play">Play</a></div></div></div>
    <section class="section"><div class="grid cols-4">
      <div class="stat"><div class="bignum num">${done.length ? m('errors').toFixed(1) : NIL}</div><span class="label">Serious errors / game</span></div>
      <div class="stat"><div class="bignum num">${done.length ? m('avgThink').toFixed(1) + '<small>s</small>' : NIL}</div><span class="label">Average think</span></div>
      <div class="stat"><div class="bignum num">${done.length ? m('impulsive').toFixed(1) : NIL}</div><span class="label">Impulsive errors / game</span></div>
      <div class="stat"><div class="bignum num">${done.length ? m('overthinks').toFixed(1) : NIL}</div><span class="label">Overthinks / game</span></div></div></section>
    <section class="section"><div class="section-head"><h2 class="h2">Games</h2><span class="label">${games.length} played here</span></div>
    ${games.length ? `<table class="table"><thead><tr><th>Date</th><th>Colour</th><th>Opening</th><th>Result</th><th class="r">Errors</th><th class="r">Clock left</th><th></th></tr></thead><tbody>${games.slice(0, 30).map(g => `<tr class="click" data-id="${esc(g.id)}"><td class="small">${date(g.t)}</td><td>${g.color === 'w' ? 'White' : 'Black'}</td><td class="small">${esc(g.fam ? famName(g.fam) : '—')}</td><td>${esc(resultWord(g))}</td><td class="r num">${g.metrics ? g.metrics.errors : '…'}</td><td class="r num">${g.clockEnd != null ? fmtClock(g.clockEnd) : ''}</td><td class="r"><span class="arrow-link" style="border:0">Review</span></td></tr>`).join('')}</tbody></table>` : '<p class="empty">No games yet.</p>'}</section>`;
  el.onclick = async e => {
    const c = e.target.closest('.choices button'); if (c) { pref[c.parentElement.dataset.k] = c.dataset.v; await store.setSetting('blitz.prefs', { ...pref }); c.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === c)); return; }
    const r = e.target.closest('tr[data-id]'); if (r) location.hash = `#/blitz/review/${r.dataset.id}`;
  };
}
const resultWord = g => { if (!g.result) return 'Unfinished'; const won = (g.result === '1-0' && g.color === 'w') || (g.result === '0-1' && g.color === 'b'); return (g.result === '1/2-1/2' ? 'Draw' : won ? 'Won' : 'Lost') + (g.reason ? ` · ${g.reason}` : ''); };

// ---------------- the game ----------------
async function play(el, forceColor, { onDone, session } = {}) {
  const pref = await store.setting('blitz.prefs', { color: 'alt', strength: 'match' });
  let color = forceColor || pref.color;
  if (color === 'alt') { const last = await store.setting('blitz.lastColor', 'b'); color = last === 'w' ? 'b' : 'w'; await store.setSetting('blitz.lastColor', color); }
  const elo = STRENGTH[pref.strength]?.elo || 2150; const opp = color === 'w' ? 'b' : 'w';
  const bk = await book().catch(() => ({}));
  const pos = new Pos(); const moves = []; const clockRec = []; let over = false; let result = null, reason = null;
  const t = { w: BASE, b: BASE }; let turn = 'w'; let last = performance.now(); let raf = 0; let moveStart = performance.now();
  el.innerHTML = `<div class="blitz"><div><div class="board-host"></div></div><div class="clocks"><div class="clock c-opp"><span class="who">Opponent · ${STRENGTH[pref.strength].label}</span><span class="t">3:00</span></div>
    <div class="status small muted" aria-live="polite" style="text-align:left"></div><div class="clock c-me"><span class="who">You · ${color === 'w' ? 'White' : 'Black'}</span><span class="t">3:00</span><div class="row" style="margin-top:18px"><button class="btn quiet" data-a="resign">Resign</button></div></div></div></div>`;
  const board = new Board(el.querySelector('.board-host'), { orientation: color, movable: color === 'w' ? 'w' : null, onMove: mv => myMove(mv), label: 'Blitz board' });
  board.setPosition(pos, { animate: false });
  const cMe = el.querySelector('.c-me'), cOpp = el.querySelector('.c-opp'); const status = el.querySelector('.status');
  const now = side => (side === turn && !over ? t[side] - (performance.now() - last) / 1000 : t[side]);
  const draw = () => {
    for (const [side, node] of [[color, cMe], [opp, cOpp]]) { const v = now(side); node.querySelector('.t').textContent = fmtClock(v); node.classList.toggle('on', side === turn && !over); node.classList.toggle('low', v < 20); }
  };
  const loop = () => { if (over) return; if (now(turn) <= 0) { t[turn] = 0; return finish(turn === 'w' ? '0-1' : '1-0', 'time', turn); } draw(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  // background analysis of my positions (low priority, never shown during the game)
  const pre = fen => analyse(fen, { budget: 'review', priority: 'low' });
  function press(side) { const el2 = (performance.now() - last) / 1000; t[side] -= el2; if (t[side] <= 0) { t[side] = 0; return false; } t[side] += INC; turn = side === 'w' ? 'b' : 'w'; last = performance.now(); return true; }
  function myMove(mv) {
    if (over || turn !== color) return; const think = (performance.now() - moveStart) / 1000; const before = now(color);
    const fen = pos.fen(); pos.make(mv.m); moves.push(mv.san);
    if (!press(color)) return finish(color === 'w' ? '0-1' : '1-0', 'time', color);
    clockRec.push({ think: +think.toFixed(2), clockBefore: +before.toFixed(1), clockAfter: +t[color].toFixed(1) });
    board.setPosition(pos, { last: [mFrom(mv.m), mTo(mv.m)] }); board.setMovable(null); pre(fen);
    const st = pos.status(); if (st) return finish(st.result, st.reason);
    oppMove();
  }
  async function oppMove() {
    const t0 = performance.now(); const fen = pos.fen(); let san = null, fromBook = false;
    const e = bk[pos.hash()];
    if (e && moves.length < 30) { const opts = Object.entries(e[1]).filter(([, c]) => c[1] + c[3] > 0); if (opts.length) { san = weighted(opts, ([, c]) => c[1] * 3 + c[3])[0]; fromBook = true; } }
    if (!san) { const u = await playMove(fen, { elo, movetime: t[opp] < 20 ? 120 : 380 }); if (over) return; san = u ? new Pos(fen).uciToSan(u) : null; }
    if (over || !san) return;
    // human-like pace: quick in the book, slower in the middlegame, faster when short of time
    const left = now(opp); const lastCap = moves.length && /x/.test(moves[moves.length - 1]) && /x/.test(san);
    let want = fromBook ? 0.5 + Math.random() * 1.2 : lastCap ? 0.6 + Math.random() : Math.min(7, Math.max(1, left / 32)) * (0.45 + Math.random());
    if (left < 25) want = 0.3 + Math.random() * 0.8;
    const spent = (performance.now() - t0) / 1000; if (want > spent) await sleep((want - spent) * 1000);
    if (over) return;
    const m = pos.parseSan(san); if (!m) return; const s2 = pos.san(m); pos.make(m); moves.push(s2);
    if (!press(opp)) return finish(opp === 'w' ? '0-1' : '1-0', 'time', opp);
    board.setPosition(pos, { last: [mFrom(m), mTo(m)] });
    const st = pos.status(); if (st) return finish(st.result, st.reason);
    board.setMovable(color); moveStart = performance.now();
  }
  async function finish(res, why, flagged) {
    if (over) return; over = true; cancelAnimationFrame(raf); board.setMovable(null);
    if (why === 'time') { // flag vs insufficient mating material = draw
      const winner = flagged === 'w' ? BL : 0; const hasMat = [...pos.b].some(p => p && (p & BL) === winner && (p & 7) !== 6 && (p & 7) !== 0);
      if (!hasMat) res = '1/2-1/2';
    }
    result = res; reason = why; draw();
    const rec = { id: 'b' + Date.now().toString(36), t: Date.now(), color, elo, moves, clock: clockRec, result, reason, clockEnd: +Math.max(0, t[color]).toFixed(1), oppClockEnd: +Math.max(0, t[opp]).toFixed(1) };
    await store.put('blitz', rec);
    status.innerHTML = `<p class="verdict">${esc(resultWord(rec))}.</p><div class="actions"><button class="btn primary" data-a="review">Review</button>${session ? '' : '<a class="btn link" href="#/blitz">Lobby</a>'}</div>`;
    status.querySelector('[data-a="review"]').onclick = () => { if (onDone) onDone(rec); else location.hash = `#/blitz/review/${rec.id}`; };
  }
  el.addEventListener('click', e => { const a = e.target.closest('[data-a="resign"]'); if (!a || over) return; if (a.dataset.armed) finish(color === 'w' ? '0-1' : '1-0', 'resignation'); else { a.dataset.armed = 1; a.textContent = 'Confirm resign'; setTimeout(() => { a.dataset.armed = ''; a.textContent = 'Resign'; }, 2500); } });
  if (color === 'b') { turn = 'w'; last = performance.now(); oppMove(); } else moveStart = performance.now();
  return () => { over = true; cancelAnimationFrame(raf); };
}
export { play as playBlitz };

// ---------------- review ----------------
async function review(el, id, { onDone } = {}) {
  const g = await store.get('blitz', id); if (!g) { el.innerHTML = '<p class="empty">Game not found.</p>'; return; }
  el.innerHTML = `<div class="section-head"><div><div class="kicker">Review · ${esc(date(g.t))}</div><h1 class="h1" style="margin-top:14px">${esc(resultWord(g))}</h1></div>${onDone ? '' : '<a class="btn link" href="#/blitz">Lobby</a>'}</div><div class="rv"><p class="label pulse">Analysing with Stockfish…</p><div class="meter" style="max-width:320px;margin-top:12px"><i style="width:0%"></i></div></div>`;
  let A = g.analysis;
  if (!A) {
    const bar = el.querySelector('.meter i');
    A = await analyseGame({ moves: g.moves, color: g.color, clock: g.clock, clockEnd: g.clockEnd }, (i, n) => { if (bar) bar.style.width = pct(i, n) + '%'; });
    const F = await diagnose({ ...g }, A); await toRepair(g, A, F);
    g.analysis = { rows: A.rows, mine: A.mine, fam: A.fam, evals: A.evals, F: strip(F) }; g.metrics = F.metrics; g.fam = A.fam; g.issue = F.issue; await store.put('blitz', g); A = g.analysis;
  }
  render(el, g, A, onDone);
}
const strip = F => { const o = {}; for (const [k, v] of Object.entries(F)) o[k] = Array.isArray(v) ? v.map(r => r.ply) : v && v.ply != null ? v.ply : v; return o; };

function render(el, g, A, onDone) {
  const F = A.F; const byPly = new Map(A.mine.map(r => [r.ply, r])); const M = g.metrics;
  const moment = (title, ply, note) => { const r = byPly.get(ply); if (!r) return ''; return { title, r, note }; };
  const list = [];
  if (F.firstError != null) list.push(moment('First important error', F.firstError));
  if (F.biggest != null && F.biggest !== F.firstError) list.push(moment('Biggest error', F.biggest));
  for (const [k, title] of [['tactical', 'Tactical miss'], ['defensive', 'Defensive miss'], ['conversion', 'Conversion error'], ['repertoire', 'Repertoire error'], ['modelChances', 'Model-pattern opportunity'], ['impulsive', 'Impulsive move'], ['recurring', 'Recurring error']])
    for (const p of (F[k] || []).slice(0, 2)) if (!list.some(x => x && x.r.ply === p)) list.push(moment(title, p));
  const moments = list.filter(Boolean).slice(0, 7);
  const graph = evalGraph(A.evals, g.color, moments.map(m => m.r.ply));
  el.querySelector('.rv').innerHTML = `
    <div class="grid cols-4" style="margin-top:12px"><div class="stat"><div class="bignum num">${M.errors}</div><span class="label">Serious errors</span></div><div class="stat"><div class="bignum num">${M.accuracyPct}%</div><span class="label">Sound decisions</span><div class="note">${M.moves} moves</div></div><div class="stat"><div class="bignum num">${M.avgThink ?? NIL}<small>s</small></div><span class="label">Average think</span><div class="note">good moves ${M.thinkGood ?? NIL}s · before errors ${M.thinkErrors ?? NIL}s</div></div><div class="stat"><div class="bignum num">${fmtClock(g.clockEnd)}</div><span class="label">Clock left</span><div class="note">${M.impulsive} impulsive · ${M.overthinks} overthinks</div></div></div>
    <section class="section" style="margin-top:36px"><div class="label">Today's issue</div><p class="h2" style="margin-top:12px">${esc(g.issue || F.issue)}</p>${graph}</section>
    <section class="section"><div class="section-head"><h2 class="h2">Important moments</h2><span class="label">${moments.length ? 'Added to Repair where it went wrong' : ''}</span></div>
    ${moments.length ? moments.map((m, i) => momentHTML(m, i, g)).join('') : '<p class="empty">No important errors. Clean game.</p>'}</section>
    <section class="section"><div class="section-head"><h2 class="h2">The game</h2></div><p class="moves">${g.moves.map((s, i) => { const r = byPly.get(i); const bad = r && (r.quality === 'mistake' || r.quality === 'blunder'); return (i % 2 === 0 ? `<span class="mn">${i / 2 + 1}.</span>` : '') + `<span class="m${bad ? ' err' : ''}" title="${r ? MOVE_LABEL[r.quality] + (r.think != null ? ' · ' + r.think + 's' : '') : ''}">${esc(s)}</span> `; }).join('')}</p></section>
    ${onDone ? '<div class="actions"><button class="btn primary" data-a="done">Continue</button></div>' : ''}`;
  el.querySelectorAll('.moment-board').forEach(h => { const r = byPly.get(+h.dataset.ply); const b = new Board(h, { orientation: g.color, coords: false }); b.setPosition(new Pos(r.fen), { animate: false }); const p = new Pos(r.fen); const pm = p.parseSan(r.san), bm = r.bestSan && p.parseSan(r.bestSan); b.setArrows([pm && { from: mFrom(pm), to: mTo(pm), kind: 'you' }, bm && { from: mFrom(bm), to: mTo(bm), kind: 'engine' }].filter(Boolean)); });
  el.onclick = async e => {
    const a = e.target.closest('[data-a]'); if (!a) return; const r = a.dataset.ply != null ? byPly.get(+a.dataset.ply) : null;
    if (a.dataset.a === 'done') return onDone && onDone(g);
    const payload = r && { fen: r.fen, col: g.color, fam: A.fam, played: r.san, sfBest: r.bestSan, good: [r.bestSan], cpBest: r.before, cpPlayed: r.after, pvBest: r.bestPv, pvRef: [r.san, ...r.refPv], loss: r.loss, verdict: 'mistake' };
    if (a.dataset.a === 'redo') { const host = document.createElement('div'); el.innerHTML = ''; el.appendChild(host); mountMoveRepair(host, { id: 'tmp', payload, reason: `From your blitz game: you played ${r.san} with ${r.clockBefore != null ? fmtClock(r.clockBefore) : '?'} on the clock.` }, { label: 'REDO POSITION', onDone: () => review(el, g.id, { onDone }) }); }
    if (a.dataset.a === 'repair') { await srs.add(srs.newItem({ id: 'move:blitz:' + new Pos(r.fen).hash(), kind: 'move', fam: A.fam, reason: `Blitz: ${r.san}`, source: 'blitz', payload })); a.textContent = 'In repair'; a.disabled = true; }
    if (a.dataset.a === 'calc') { const host = document.createElement('div'); el.innerHTML = ''; el.appendChild(host); const it = { id: 'blitz:' + g.id + ':' + r.ply, fen: r.fen, side: g.color, fam: A.fam, line: r.bestPv, cp: r.before, kind: /x|\+/.test(r.bestSan || '') ? 'tactical' : 'positional', played: r.san, src: 'mine', level: r.bestPv.length >= 9 ? 'deep' : 'medium' }; mountCalc(host, it, { level: r.bestPv.length >= 5 ? 'medium' : 'short', label: 'CALCULATE AGAIN', onDone: () => review(el, g.id, { onDone }) }); }
  };
}
function momentHTML(m, i, g) {
  const r = m.r; const tq = r.think != null ? `${r.think.toFixed(1)}s with ${fmtClock(r.clockBefore)} left` : '';
  let why = '';
  if (m.title === 'Impulsive move') why = `Played in ${r.think.toFixed(1)} seconds — ${MOVE_LABEL[r.quality].toLowerCase()}.`;
  else if (m.title === 'Tactical miss') why = `${esc(r.bestSan)} was there: ${line(r.bestPv.slice(0, 5), r.ply)}.`;
  else if (m.title === 'Defensive miss') why = `After ${esc(r.san)} the reply ${esc(r.refPv[0] || '')} hurts: ${line(r.refPv.slice(0, 4), r.ply + 1)}.`;
  else if (m.title === 'Conversion error') why = `You were winning (${fmtEval(r.before, g.color === 'w')}); after ${esc(r.san)} ${fmtEval(r.after, g.color === 'w')}.`;
  else if (m.title === 'Repertoire error' && r.book) why = `Out of your repertoire. ${r.book.myUsual ? `You usually play ${esc(r.book.myUsual[0])} here (${r.book.myUsual[1]}×).` : ''} ${r.book.model ? `In the supplied model games: ${esc(r.book.model[0])} (${r.book.model[1]}×).` : ''}`;
  else if (m.title === 'Model-pattern opportunity' && r.book) why = `<span class="tag-doc">Documented</span>Model players reached this exact position ${r.book.total}× and chose ${esc(r.book.model[0])} ${r.book.model[1]}×.`;
  else why = `${MOVE_LABEL[r.quality]} (−${r.loss}% win chance). Stockfish: ${line(r.bestPv.slice(0, 4), r.ply)}.`;
  return `<div class="review-moment"><div class="moment-board" data-ply="${r.ply}"></div><div class="stack" style="--s:12px"><div class="label accent">${esc(m.title)}</div>
    <div class="reveal two"><div class="you"><div class="label">You</div><div class="mv">${esc(r.san)}</div><div class="sub">${MOVE_LABEL[r.quality]} · ${esc(tq)}</div></div><div class="engine"><div class="label">Stockfish</div><div class="mv">${esc(r.bestSan || '—')}</div><div class="sub">${fmtEval(r.before, g.color === 'w')} → ${fmtEval(r.after, g.color === 'w')}</div></div></div>
    <p class="small ink2">${why}</p><p class="small muted">Decision: ${esc(DECISION_LABEL[r.decision] || '')}</p>
    <div class="actions"><button class="btn link" data-a="redo" data-ply="${r.ply}">Redo position</button><button class="btn link" data-a="calc" data-ply="${r.ply}">Calculate again</button><button class="btn link" data-a="repair" data-ply="${r.ply}">Add to repair</button>${r.book && r.book.model ? `<a class="btn link" href="#/repertoire/${esc(g.fam || '')}">Show model example</a>` : ''}</div></div></div>`;
}
function evalGraph(evals, color, marks) {
  if (!evals || evals.length < 3) return '';
  const W = 800, H = 90; const n = evals.length - 1; const y = cp => H - (winPct(color === 'w' ? cp : -cp) / 100) * H;
  const pts = evals.map((e, i) => `${(i / n) * W},${y(e).toFixed(1)}`).join(' ');
  return `<svg class="evalgraph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Winning chances across the game (your perspective)"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="var(--rule-2)" stroke-width="1"/><polyline points="${pts}" fill="none" stroke="var(--ink-2)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>${marks.map(p => `<circle cx="${((p + 1) / n) * W}" cy="${y(evals[p + 1])}" r="3.5" fill="var(--accent)"/>`).join('')}</svg><p class="footnote">Your winning chances across the game. Marks: the moments below.</p>`;
}
export { review as reviewBlitz };

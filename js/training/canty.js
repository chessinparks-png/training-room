// CANTY — a small MoveTrainer for FM James Canty's 1.d4 / 2.Nc3 decision points, plus the
// 3+2 clock-decision drill. Data: data/canty.json (built by tools/build-canty.mjs).
// Repetition: new → learning → known. A miss returns in minutes (and once more in the current
// run); a correct answer moves the position up a box and it comes back less often.
import { Pos, mFrom, mTo } from '../chess/core.js';
import { esc, line, stopwatch, fmtClock } from '../ui.js';
import { stage, makeBoard, arrows, sameMove } from './common.js';
import * as store from '../data/store.js';
import { canty } from '../data/catalog.js';

const MIN = 6e4, HOUR = 36e5, DAY = 864e5;
const INTERVAL = [0, 4 * HOUR, DAY, 3 * DAY, 7 * DAY, 21 * DAY]; // by box after a correct answer
export const KNOWN_BOX = 3;
const KEY = 'canty.srs';

export async function srsState() { return { ...(await store.setting(KEY, {})) }; }
export function stateOf(r) { return !r ? 'new' : r.box >= KNOWN_BOX ? 'known' : 'learning'; }

async function grade(id, ok, { retry = false } = {}) {
  const all = await srsState(); const r = all[id] || { box: 0, due: 0, seen: 0, ok: 0 };
  if (!retry) { r.seen++; if (ok) r.ok++; } // first-try accuracy counts the first showing only
  if (ok) { r.box = retry ? Math.max(1, Math.min(r.box, 1)) : Math.min(INTERVAL.length - 1, r.box + 1); r.due = Date.now() + INTERVAL[r.box]; }
  else { r.box = 1; r.due = Date.now() + 5 * MIN; }
  r.last = Date.now(); all[id] = r; await store.setSetting(KEY, all); return r;
}

// Due first (oldest first), then new positions in line order. `group` limits to one family.
export async function cantyQueue(n, { group = null, ahead = true } = {}) {
  const D = await canty(); const S = await srsState(); const now = Date.now();
  const pool = D.positions.filter(p => !group || p.group === group);
  const due = pool.filter(p => S[p.id] && S[p.id].due <= now).sort((a, b) => S[a.id].due - S[b.id].due);
  const fresh = pool.filter(p => !S[p.id]);
  let out = [...due, ...fresh].slice(0, n);
  // nothing due or new: review the weakest positions early rather than show an empty screen
  if (!out.length && ahead) out = pool.slice().sort((a, b) => S[a.id].box - S[b.id].box || S[a.id].due - S[b.id].due).slice(0, n);
  return out;
}

export async function cantySummary() {
  const D = await canty(); const S = await srsState(); const now = Date.now();
  const by = g => { const ps = D.positions.filter(p => !g || p.group === g); const c = { new: 0, learning: 0, known: 0, due: 0, n: ps.length };
    for (const p of ps) { c[stateOf(S[p.id])]++; if (S[p.id] && S[p.id].due <= now) c.due++; } return c; };
  const rs = Object.values(S); const seen = rs.reduce((s, r) => s + r.seen, 0), ok = rs.reduce((s, r) => s + r.ok, 0);
  return { all: by(null), groups: D.groups.map(g => ({ ...g, ...by(g.id) })), acc: seen ? ok / seen : null, seen };
}

// Before the move: show the position before Black's last move, then play it, so the decision
// arrives in context — as it does over the board.
function enter(board, fen, prev) {
  if (!prev.length) return;
  const p = new Pos(); if (!prev.slice(0, -1).every(s => p.play(s))) return;
  const m = p.parseSan(prev[prev.length - 1]); if (!m) return;
  board.setPosition(new Pos(p.fen()), { animate: false });
  setTimeout(() => board.setPosition(new Pos(fen), { last: [mFrom(m), mTo(m)] }), 350);
}

export async function mountCanty(el, it, { onDone, retry = false } = {}) {
  if (!it) { onDone && onDone({ skipped: true }); return () => {}; }
  const D = await canty(); const G = D.groups.find(g => g.id === it.group); const st = stateOf((await srsState())[it.id]);
  const S = stage(el, { label: `CANTY · ${G ? G.full : ''}` });
  const board = makeBoard(S.boardHost, it.fen, { orientation: 'w', movable: 'w', onMove: mv => answer(mv) });
  enter(board, it.fen, it.prev);
  S.context.innerHTML = line(it.prev.slice(-6), it.prev.length - Math.min(6, it.prev.length));
  S.underRight.textContent = it.theme;
  S.side.innerHTML = `<p class="prompt">Play Canty's move.<small>White to move · <span class="chip${st === 'new' ? ' accent' : ''}">${retry ? 'again' : st}</span></small></p><div class="timer num">0.0</div><div class="fb"></div>`;
  const sw = stopwatch(S.side.querySelector('.timer')); let done = false;
  async function answer(mv) {
    if (done) return; done = true; const sec = sw.stop(); board.setMovable(null);
    const accepted = [it.move, ...it.also]; const ok = accepted.some(a => sameMove(a, mv.san));
    const p2 = new Pos(it.fen); p2.make(mv.m); board.setPosition(p2, { last: [mFrom(mv.m), mTo(mv.m)] });
    if (!ok) setTimeout(() => { board.setPosition(new Pos(it.fen), { animate: false }); board.setArrows(arrows(it.fen, [[mv.san, 'you'], [it.move, 'model']])); }, 450);
    const r = await grade(it.id, ok, { retry });
    if (!retry) await store.logAttempt({ mode: 'canty', id: it.id, group: it.group, ok, sec });
    const n = it.games.length; const src = it.games[0];
    S.side.querySelector('.fb').innerHTML = `<p class="verdict${ok ? '' : ' bad'}">${ok ? `Correct — ${esc(mv.san)}.` : `Canty played <b>${esc(it.move)}</b>.`}</p>
      <p class="why">${esc(it.why)}</p>
      <p class="footnote">${it.also.length ? `Also played: ${it.also.map(esc).join(', ')}. ` : ''}${n > 1 ? `Reached in ${n} of his games. ` : ''}${src && src.link ? `<a href="${esc(src.link)}" target="_blank" rel="noopener">vs ${esc(src.opp)}</a>` : ''} · ${ok ? (r.box >= KNOWN_BOX ? 'known' : 'learning') : 'back in a few minutes'}</p>
      <div class="actions"><button class="btn primary" data-a="next">Next</button><span class="kbd">Enter</span></div>`;
    S.side.querySelector('[data-a="next"]').onclick = () => onDone && onDone({ ok, sec, id: it.id, retry });
  }
  return () => sw.stop();
}

export const CLOCK_CHOICES = [{ cat: 'routine', sec: 3, label: 'Routine', note: 'move quickly' }, { cat: 'think', sec: 10, label: 'Think', note: 'worth a short check' }, { cat: 'critical', sec: 25, label: 'Critical', note: 'worth spending time' }];
const CH = Object.fromEntries(CLOCK_CHOICES.map(c => [c.cat, c]));

// One of each kind where possible, least-practised first.
export async function clockQueue(n = 3) {
  const D = await canty(); const at = await store.attempts('clock'); const seen = {}; for (const a of at) seen[a.id] = (seen[a.id] || 0) + (a.ok ? 1 : 0.4);
  const rank = xs => xs.slice().sort((a, b) => (seen[a.id] || 0) - (seen[b.id] || 0) + (Math.random() - 0.5) * 0.5);
  const per = CLOCK_CHOICES.map(c => rank(D.clock.filter(x => x.cat === c.cat)));
  const out = []; for (let i = 0; out.length < n && i < 10; i++) for (const list of per) if (list[i] && out.length < n) out.push(list[i]);
  return out.sort(() => Math.random() - 0.5);
}

export function mountClock(el, it, { onDone } = {}) {
  if (!it) { onDone && onDone({ skipped: true }); return () => {}; }
  const S = stage(el, { label: 'CLOCK DECISION · 3+2' });
  const board = makeBoard(S.boardHost, it.fen, { orientation: 'w' });
  enter(board, it.fen, it.prev);
  S.context.innerHTML = line(it.prev.slice(-4), it.prev.length - Math.min(4, it.prev.length));
  S.side.innerHTML = `<div class="mini-clocks"><div><span class="label">Opponent</span><b class="num">${fmtClock(it.opp)}</b></div><div class="me"><span class="label">You</span><b class="num">${fmtClock(it.me)}</b></div></div>
    <p class="prompt">How much time should you spend here?<small>White to move. Decide before you look for the move.</small></p>
    <div class="options clock-opts">${CLOCK_CHOICES.map((c, i) => `<button type="button" data-c="${c.cat}"><span>${c.sec} seconds</span><span class="key">${i + 1}</span></button>`).join('')}</div><div class="fb"></div>`;
  let pick = null, sw = null, done = false, iv = 0;
  const onKey = e => { const k = +e.key; if (!pick && k >= 1 && k <= 3) choose(CLOCK_CHOICES[k - 1].cat); };
  document.addEventListener('keydown', onKey);
  S.side.querySelector('.clock-opts').onclick = e => { const b = e.target.closest('[data-c]'); if (b) choose(b.dataset.c); };
  function choose(c) {
    if (pick) return; pick = c;
    S.side.querySelectorAll('[data-c]').forEach(b => { b.disabled = true; b.classList.toggle('chosen', b.dataset.c === c); });
    S.side.querySelector('.prompt').innerHTML = `Your move.<small>Budget ${CH[c].sec} seconds. <b class="num budget">${CH[c].sec.toFixed(1)}</b></small>`;
    const t0 = performance.now(); const bud = S.side.querySelector('.budget');
    iv = setInterval(() => { const left = CH[c].sec - (performance.now() - t0) / 1000; bud.textContent = left.toFixed(1); bud.classList.toggle('err', left < 0); }, 100);
    sw = stopwatch(document.createElement('span'));
    board.setMovable('w'); board.o.onMove = mv => answer(mv);
  }
  async function answer(mv) {
    if (done) return; done = true; clearInterval(iv); const sec = sw.stop(); board.setMovable(null);
    const moveOk = [it.move, ...it.also].some(a => sameMove(a, mv.san)); const ok = pick === it.cat;
    const p2 = new Pos(it.fen); p2.make(mv.m); board.setPosition(p2, { last: [mFrom(mv.m), mTo(mv.m)] });
    if (!moveOk) setTimeout(() => { board.setPosition(new Pos(it.fen), { animate: false }); board.setArrows(arrows(it.fen, [[mv.san, 'you'], [it.move, 'model']])); }, 450);
    await store.logAttempt({ mode: 'clock', id: it.id, ok, pick, cat: it.cat, moveOk, sec });
    const C = CH[it.cat];
    S.side.querySelector('.fb').innerHTML = `<p class="verdict${ok ? '' : ' bad'}"><span class="cat cat-${it.cat}">${C.label}</span> — ${C.note}.</p>
      <p class="why">${ok ? 'Right call.' : `You chose ${CH[pick].sec} seconds (${CH[pick].label.toLowerCase()}).`} ${esc(it.why)}</p>
      <p class="footnote">${moveOk ? `${esc(mv.san)} — Canty's move` : `Canty played <b>${esc(it.move)}</b>; you played ${esc(mv.san)}`} · ${sec.toFixed(1)}s</p>
      <div class="actions"><button class="btn primary" data-a="next">Next</button><span class="kbd">Enter</span></div>`;
    S.side.querySelector('[data-a="next"]').onclick = () => onDone && onDone({ ok, moveOk, sec, pick, cat: it.cat });
  }
  return () => { clearInterval(iv); sw && sw.stop(); document.removeEventListener('keydown', onKey); };
}

// Runs a queue of Canty positions; a miss is shown once more three positions later.
export function runCanty(host, items, { onItem, onDone, frame } = {}) {
  const q = items.slice(); let un = () => {}; const results = [];
  const next = async rec => {
    if (rec && !rec.skipped) {
      if (!rec.retry) results.push(rec);
      if (!rec.ok && !rec.retry) { const it = items.find(x => x.id === rec.id); q.splice(Math.min(q.length, 3), 0, { ...it, _retry: true }); }
    }
    un();
    if (!q.length) return onDone && onDone(results);
    const it = q.shift(); const h = frame ? frame(results.length, items.length) : host;
    un = await mountCanty(h, it, { retry: !!it._retry, onDone: next }); onItem && onItem(un);
  };
  next();
  return () => un();
}

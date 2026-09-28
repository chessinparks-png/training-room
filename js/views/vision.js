// VISION — the mental board that supports calculation. SQUARES · BOARD VISION · BLINDFOLD.
import { Board } from '../board/board.js';
import { Pos } from '../chess/core.js';
import { C, modelGames, myGames, decisions } from '../data/catalog.js';
import { questions, check, nextMoveQuestion, QTYPES } from '../training/vision-q.js';
import { mountCalc } from '../training/calc.js';
import * as store from '../data/store.js';
import { esc, pct, pick, shuffle, sleep, line, plyFromFen, NIL } from '../ui.js';
import { FAMILY, MODEL } from '../repertoire/families.js';
import { famName } from '../training/common.js';

const FILES = 'abcdefgh';
const VIEW_TIMES = [10, 5, 3, 2, 1];

export async function mount(el, params) {
  const [area, a1, a2] = params; let un = null;
  if (area === 'squares') un = squares(el, a1 || 'find');
  else if (area === 'board') un = boardVision(el);
  else if (area === 'blind') { const lvl = /^[1-4]$/.test(a1) ? +a1 : 3; const fam = FAMILY[a1] ? a1 : FAMILY[a2] ? a2 : null; un = blind(el, FAMILY[a1] ? 3 : lvl, fam); }
  else await hub(el);
  return () => { if (typeof un === 'function') un(); };
}

async function hub(el) {
  const at = await store.attempts('vision');
  const sq = at.filter(a => a.area === 'squares'), bv = at.filter(a => a.area === 'board'), bl = at.filter(a => a.area === 'blind');
  const acc = xs => (xs.length ? pct(xs.filter(x => x.ok).length, xs.length) + '%' : '—');
  const ms = xs => { const ok = xs.filter(x => x.ok && x.ms); return ok.length ? (ok.reduce((s, x) => s + x.ms, 0) / ok.length / 1000).toFixed(2) + 's' : '—'; };
  const maxPlies = Math.max(0, ...bl.filter(a => a.ok && a.plies).map(a => a.plies));
  el.innerHTML = `<div class="feature-head"><div><div class="kicker">Vision</div><h1 class="display" style="margin-top:18px">See it<br>without looking.</h1></div>
    <p class="lede">Instant square recognition, a board you can hold in memory, then whole lines played on a board you cannot see. The positions come from your repertoire and your model players' games.</p></div>
    <section class="section"><div class="grid cols-3">
      <div class="stack" style="--s:18px"><div class="label accent">01 · Squares</div><div class="h2">Squares</div><div class="grid cols-2" style="gap:14px"><div class="stat"><div class="midnum num">${acc(sq)}</div><span class="label">Accuracy</span></div><div class="stat"><div class="midnum num">${ms(sq)}</div><span class="label">Avg response</span></div></div>
        ${sq.length ? `<p class="small ink2">White orientation ${acc(sq.filter(a => a.orient === 'w'))} · ${ms(sq.filter(a => a.orient === 'w'))} &nbsp;·&nbsp; Black ${acc(sq.filter(a => a.orient === 'b'))} · ${ms(sq.filter(a => a.orient === 'b'))}</p>` : ''}
        <div class="stack" style="--s:6px"><a class="arrow-link" href="#/vision/squares/find">Find the square</a><br><a class="arrow-link" href="#/vision/squares/name">Name the square</a><br><a class="arrow-link" href="#/vision/squares/color">Square colour</a></div></div>
      <div class="stack" style="--s:18px"><div class="label accent">02 · Board vision</div><div class="h2">Board vision</div><div class="grid cols-2" style="gap:14px"><div class="stat"><div class="midnum num">${acc(bv)}</div><span class="label">Memory accuracy</span></div><div class="stat"><div class="midnum num">${(await store.setting('vision.viewIdx', 0)) < VIEW_TIMES.length ? VIEW_TIMES[await store.setting('vision.viewIdx', 0)] + 's' : '1s'}</div><span class="label">Current view time</span></div></div>
        <a class="arrow-link" href="#/vision/board">Begin</a></div>
      <div class="stack" style="--s:18px"><div class="label accent">03 · Blindfold</div><div class="h2">Blindfold</div><div class="grid cols-2" style="gap:14px"><div class="stat"><div class="midnum num">${acc(bl)}</div><span class="label">Accuracy</span></div><div class="stat"><div class="midnum num">${maxPlies || NIL}</div><span class="label">Max tracked plies</span></div></div>
        <div class="stack" style="--s:6px"><a class="arrow-link" href="#/vision/blind/1">Level 1 — Vanishing board</a><br><a class="arrow-link" href="#/vision/blind/2">Level 2 — Move tracking</a><br><a class="arrow-link" href="#/vision/blind/3">Level 3 — Full line</a><br><a class="arrow-link" href="#/vision/blind/4">Level 4 — Blindfold calculation</a></div></div>
    </div></section>
    <section class="section"><div class="section-head"><h2 class="h2">What you lose</h2><span class="label">By question type</span></div>${lossTable(bv.concat(bl))}</section>
    <section class="section"><div class="section-head"><h2 class="h2">Weakest squares</h2><span class="label">Slow or missed</span></div>${heat(sq)}</section>`;
}
function lossTable(rows) {
  const by = {}; for (const r of rows) { if (!r.qtype) continue; const b = by[r.qtype] || (by[r.qtype] = { n: 0, ok: 0 }); b.n++; if (r.ok) b.ok++; }
  const list = Object.entries(by).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n);
  if (!list.length) return '<p class="empty">Answer a few board-vision questions to see what you lose.</p>';
  return `<table class="table">${list.map(([t, b]) => `<tr><td class="serif" style="font-size:18px">${esc(QTYPES[t] || t)}</td><td style="width:40%"><div class="bar-h"><i style="width:${pct(b.ok, b.n)}%"></i></div></td><td class="r num">${pct(b.ok, b.n)}%</td><td class="r small muted">${b.n} asked</td></tr>`).join('')}</table>`;
}
function heat(rows) {
  if (rows.length < 20) return '<p class="empty">A few rounds of square training will reveal your weakest squares.</p>';
  const by = {}; for (const r of rows) { const b = by[r.sq] || (by[r.sq] = { n: 0, bad: 0, ms: 0 }); b.n++; if (!r.ok) b.bad++; b.ms += r.ms || 0; }
  const score = s => { const b = by[s]; if (!b) return 0; return Math.min(1, b.bad / b.n * 2 + (b.ms / b.n) / 4000); };
  let cells = ''; for (let r = 7; r >= 0; r--) for (let f = 0; f < 8; f++) { const s = FILES[f] + (r + 1); cells += `<div title="${s}" style="aspect-ratio:1;background:color-mix(in srgb, var(--accent) ${Math.round(score(s) * 100)}%, var(--bg-3));display:flex;align-items:flex-end;justify-content:flex-start;padding:3px;font:500 9px var(--sans);color:var(--mute)">${s}</div>`; }
  const worst = Object.keys(by).sort((a, b) => score(b) - score(a)).slice(0, 5);
  return `<div class="grid cols-2"><div style="display:grid;grid-template-columns:repeat(8,1fr);gap:2px;max-width:360px">${cells}</div><div><p class="lede">Slowest or most-missed: <span class="serif" style="color:var(--ink)">${worst.map(esc).join(', ')}</span>.</p></div></div>`;
}

// ---------- SQUARES ----------
export function squares(el, mode, { onDone, n = 20 } = {}) {
  let orient = 'w', i = 0, ok = 0, t0 = 0, cur = null, done = false; const N = n; const log = [];
  el.innerHTML = `<div class="stage"><div class="board-col"><div class="board-host"></div></div><div class="side"><div class="label ink">VISION / SQUARES / ${mode === 'find' ? 'FIND THE SQUARE' : mode === 'name' ? 'NAME THE SQUARE' : 'SQUARE COLOUR'}</div>
    <div class="choices" role="group" aria-label="Orientation"><button data-o="w" aria-pressed="true">White</button><button data-o="b" aria-pressed="false">Black</button></div>
    <div class="sq-prompt" aria-live="polite"></div><div class="answer"></div><div class="row between"><span class="label count"></span><span class="label speed"></span></div><div class="fb small ink2"></div></div></div>`;
  const board = new Board(el.querySelector('.board-host'), { coords: false, orientation: orient, onSquare: s => mode === 'find' && answer(s) });
  board.setPosition(new Pos('4k3/8/8/8/8/8/8/4K3 w - - 0 1'), { animate: false }); board.hidePieces(true);
  el.querySelector('.cb').classList.add('nocoords');
  const prompt = el.querySelector('.sq-prompt'), ans = el.querySelector('.answer');
  if (mode === 'name') ans.innerHTML = `<input type="text" maxlength="2" aria-label="Square name" style="font:400 48px var(--serif);width:140px" autocomplete="off">`;
  if (mode === 'color') ans.innerHTML = `<div class="vision-pad"><button class="btn" data-c="light">Light <span class="kbd">L</span></button><button class="btn" data-c="dark">Dark <span class="kbd">D</span></button></div>`;
  const inp = ans.querySelector('input');
  inp && inp.addEventListener('input', () => { const v = inp.value.toLowerCase(); if (/^[a-h][1-8]$/.test(v)) answer(v); });
  ans.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) answer(b.dataset.c); });
  const onKey = e => { if (mode === 'color' && /^[ld]$/i.test(e.key)) answer(e.key.toLowerCase() === 'l' ? 'light' : 'dark'); };
  document.addEventListener('keydown', onKey);
  el.querySelector('.choices').addEventListener('click', e => { const b = e.target.closest('[data-o]'); if (!b) return; orient = b.dataset.o; el.querySelectorAll('[data-o]').forEach(x => x.setAttribute('aria-pressed', x === b)); board.setOrientation(orient); el.querySelector('.cb').classList.add('nocoords'); board.hidePieces(true); });
  function next() {
    if (i >= N) return finish();
    let s; do { s = FILES[Math.floor(Math.random() * 8)] + (1 + Math.floor(Math.random() * 8)); } while (s === cur);
    cur = s; i++;
    board.setMarks(mode === 'name' ? { [s]: 'ask' } : {});
    prompt.textContent = mode === 'name' ? '?' : s;
    if (inp) { inp.value = ''; inp.focus(); }
    el.querySelector('.count').textContent = `${i} / ${N}`; t0 = performance.now();
  }
  async function answer(a) {
    if (done || !cur) return; const ms = performance.now() - t0; const s = cur; cur = null;
    const light = (FILES.indexOf(s[0]) + +s[1]) % 2 === 1;
    const good = mode === 'color' ? (a === (light ? 'light' : 'dark')) : a === s;
    if (good) ok++;
    board.setMarks({ [s]: good ? 'hit' : 'miss', ...(mode === 'find' && !good ? { [a]: 'soft' } : {}) });
    if (mode === 'name') prompt.textContent = s;
    el.querySelector('.speed').textContent = `${(ms / 1000).toFixed(2)}s`;
    log.push({ mode: 'vision', area: 'squares', sub: mode, sq: s, orient, ok: good, ms: Math.round(ms) });
    await sleep(good ? 280 : 900); next();
  }
  async function finish() {
    done = true; for (const r of log) await store.logAttempt(r);
    const avg = log.filter(r => r.ok).reduce((s, r) => s + r.ms, 0) / Math.max(1, log.filter(r => r.ok).length) / 1000;
    board.setMarks({}); prompt.innerHTML = `<span class="bignum">${ok}/${N}</span>`;
    if (onDone) { ans.innerHTML = `<p class="lede">${avg.toFixed(2)} seconds per correct answer.</p><div class="actions"><button class="btn primary" data-cont>Continue</button></div>`; ans.querySelector('[data-cont]').onclick = () => onDone({ ok, n: N, avg }); return; }
    ans.innerHTML = `<p class="lede">${avg.toFixed(2)} seconds per correct answer, ${orient === 'w' ? 'White' : 'Black'} orientation.</p><div class="actions"><button class="btn primary" data-again>Again</button><a class="btn link" href="#/vision">Vision</a></div>`;
    ans.querySelector('[data-again]').onclick = () => { i = 0; ok = 0; done = false; log.length = 0; ans.innerHTML = mode === 'color' ? `<div class="vision-pad"><button class="btn" data-c="light">Light <span class="kbd">L</span></button><button class="btn" data-c="dark">Dark <span class="kbd">D</span></button></div>` : mode === 'name' ? `<input type="text" maxlength="2" style="font:400 48px var(--serif);width:140px">` : ''; const ni = ans.querySelector('input'); if (ni) ni.addEventListener('input', () => { const v = ni.value.toLowerCase(); if (/^[a-h][1-8]$/.test(v)) answer(v); }); next(); };
  }
  setTimeout(next, 300);
  return () => document.removeEventListener('keydown', onKey);
}

// ---------- shared: ask questions on a hidden board ----------
function askAll(el, board, qs, { onDone, area, extra = {} }) {
  const box = el.querySelector('.qa'); let k = 0; const results = [];
  const ask = () => {
    if (k >= qs.length) return onDone(results);
    const q = qs[k]; board.setMarks({});
    box.innerHTML = `<p class="prompt" style="font-size:30px">${esc(q.text)}</p>${q.mode === 'choice' ? `<div class="options">${q.options.map(o => `<button type="button" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : `<p class="small muted">Click the square on the board.</p>`}`;
    const t0 = performance.now();
    const finish = async v => {
      board.o.onSquare = null; const ok = check(q, v); const ms = performance.now() - t0;
      results.push({ ok, type: q.type }); await store.logAttempt({ mode: 'vision', area, qtype: q.type, ok, ms: Math.round(ms), ...extra });
      const marks = {}; (Array.isArray(q.answer) ? q.answer : []).forEach(s => { if (/^[a-h][1-8]$/.test(s)) marks[s] = 'hit'; }); if (!ok && /^[a-h][1-8]$/.test(v)) marks[v] = 'miss'; board.setMarks(marks);
      box.querySelectorAll('.options button').forEach(b => { b.disabled = true; if (check(q, b.dataset.v)) b.classList.add('right'); else if (b.dataset.v === v) b.classList.add('wrong'); });
      box.insertAdjacentHTML('beforeend', `<p class="verdict${ok ? '' : ' bad'}" style="margin-top:16px">${ok ? 'Right.' : `No — ${esc(Array.isArray(q.answer) ? q.answer.join(' or ') : q.answer)}.`}</p>`);
      k++; await sleep(ok ? 800 : 1700); ask();
    };
    if (q.mode === 'square') board.o.onSquare = s => finish(s);
    else box.querySelector('.options').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b && !b.disabled) finish(b.dataset.v); });
  };
  ask();
}
function visionPositions() {
  const mine = C.training.drills.filter(d => ['jobava', 'kid', 'oldindian', 'pirc'].includes(d.fam)).map(d => ({ fen: d.fen, col: d.col, src: 'Your game', fam: d.fam }));
  const model = decisions().filter(d => !d.both).map(d => ({ fen: d.fen, col: d.side, src: MODEL[d.player].short, fam: d.fam }));
  return shuffle([...mine, ...model]);
}

// ---------- BOARD VISION ----------
export function boardVision(el, { rounds = Infinity, onDone } = {}) {
  const pool = visionPositions(); let idx = 0; let stopped = false; let played = 0; const tally = { ok: 0, n: 0 };
  const layout = () => { el.innerHTML = `<div class="stage"><div class="board-col"><div class="board-host"></div><div class="under-board"><span class="context-line"></span><span class="label src"></span></div></div><div class="side"><div class="label ink">VISION / BOARD VISION</div><div class="timer num"></div><div class="qa"></div></div></div>`; };
  layout(); const board = new Board(el.querySelector('.board-host'), {});
  async function round() {
    if (stopped) return; const P = pool[idx++ % pool.length]; let vi = await store.setting('vision.viewIdx', 0);
    const secs = VIEW_TIMES[Math.min(vi, VIEW_TIMES.length - 1)];
    board.hidePieces(false); board.setMarks({}); board.setOrientation(P.col); board.setPosition(new Pos(P.fen), { animate: false });
    el.querySelector('.src').textContent = `${P.src} · ${famName(P.fam)}`;
    el.querySelector('.qa').innerHTML = `<p class="prompt">Memorise the position.<small>${secs} seconds. Then the pieces disappear.</small></p>`;
    const tEl = el.querySelector('.timer'); const t0 = performance.now();
    await new Promise(r => { const tick = () => { if (stopped) return r(); const left = secs - (performance.now() - t0) / 1000; tEl.textContent = Math.max(0, left).toFixed(1); if (left <= 0) return r(); requestAnimationFrame(tick); }; tick(); });
    board.hidePieces(true); tEl.textContent = '';
    askAll(el, board, questions(P.fen, 3), { area: 'board', extra: { view: secs }, onDone: async res => {
      const good = res.filter(r => r.ok).length;
      vi = good === res.length ? Math.min(VIEW_TIMES.length - 1, vi + 1) : good <= 1 ? Math.max(0, vi - 1) : vi; await store.setSetting('vision.viewIdx', vi);
      board.hidePieces(false); played++; tally.ok += good; tally.n += res.length;
      const last = played >= rounds;
      el.querySelector('.qa').innerHTML = `<p class="verdict">${good} of ${res.length}.</p><p class="small ink2">Next view time: ${VIEW_TIMES[vi]} seconds.</p><div class="actions"><button class="btn primary" data-n>${last ? 'Continue' : 'Next position'}</button>${onDone ? '' : '<a class="btn link" href="#/vision">Done</a>'}</div>`;
      el.querySelector('[data-n]').onclick = () => (last && onDone ? onDone(tally) : round());
    } });
  }
  round();
  return () => { stopped = true; };
}

// ---------- BLINDFOLD ----------
export function blind(el, level, fam, { rounds = Infinity, onDone } = {}) {
  let stopped = false; let un = null; let played = 0; const tally = { ok: 0, n: 0, plies: 0 };
  if (level === 4) {
    const items = shuffle(C.training.calc.filter(c => !fam || c.fam === fam)); let i = 0;
    const next = r => { if (stopped) return; if (r && !r.skipped) { played++; tally.n++; if (r.ok) tally.ok++; } if (played >= rounds && onDone) { un && un(); return onDone(tally); } un && un(); const it = items[i++ % items.length]; un = mountCalc(el, it, { level: 'medium', label: `BLINDFOLD / LEVEL 4 — CALCULATION${fam ? ' / ' + famName(fam).toUpperCase() : ''}`, blind: true, onDone: next }); };
    next(); return () => { stopped = true; un && un(); };
  }
  el.innerHTML = `<div class="stage"><div class="board-col"><div class="board-host"></div><div class="under-board"><span class="context-line"></span><span class="label src"></span></div></div><div class="side"><div class="label ink">VISION / BLINDFOLD / LEVEL ${level}${fam ? ' / ' + esc(famName(fam).toUpperCase()) : ''}</div><div class="timer num"></div><div class="qa"></div><div class="stream moves" style="font:400 26px/1.5 var(--serif);color:var(--ink);min-height:40px"></div></div></div>`;
  const board = new Board(el.querySelector('.board-host'), {});
  const src = el.querySelector('.src'), stream = el.querySelector('.stream'), qa = el.querySelector('.qa'), tEl = el.querySelector('.timer');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function round() {
    if (stopped) return; stream.textContent = ''; qa.innerHTML = ''; board.setMarks({});
    let plies = await store.setting(`blind.plies.${level}`, level === 2 ? 4 : 8);
    // Source line: Level 1 a repertoire position; Level 2 a model/my position + its continuation; Level 3 a real game from move 1
    let startFen, seq = [], who = null, col = 'w', label = '', nextMove = null;
    if (level === 1 || level === 2) {
      const pool = decisions(fam || undefined).filter(d => !d.both && d.cont && d.cont.length >= 6);
      const d = pick(pool); startFen = d.fen; col = d.side; who = MODEL[d.player].short; label = `${who} vs ${d.opp || ''}`;
      if (level === 2) { seq = d.cont.slice(0, Math.min(plies, d.cont.length - 1)); nextMove = d.cont[seq.length]; }
    } else {
      const useMine = Math.random() < 0.35; let g, mv;
      if (useMine) { const gs = myGames().filter(x => x.fam && (!fam || x.fam === fam) && x.moves && x.moves.split(' ').length >= plies + 1); g = pick(gs); if (g) { mv = g.moves.split(' '); who = 'you'; label = `Your game vs ${g.opp}`; col = g.pc; } }
      if (!g) { const gs = (await modelGames()).filter(x => (!fam || x.fam === fam) && x.moves.split(' ').length > plies + 2); g = pick(gs); mv = g.moves.split(' '); who = MODEL[g.p].short; label = `${who} vs ${g.opp}`; col = g.pc; }
      startFen = new Pos().fen(); seq = mv.slice(0, plies); nextMove = mv[plies];
    }
    src.textContent = label; board.setOrientation(col); board.hidePieces(false); board.setPosition(new Pos(startFen), { animate: false });
    const p = new Pos(startFen);
    if (level === 1) {
      qa.innerHTML = `<p class="prompt">Study the board.<small>10 seconds, then it vanishes.</small></p>`;
      for (let s = 10; s > 0 && !stopped; s--) { tEl.textContent = s; await wait(1000); } tEl.textContent = '';
      board.hidePieces(true);
      return askAll(el, board, questions(startFen, 4), { area: 'blind', extra: { level, plies: 0 }, onDone: res => end(res, 0) });
    }
    qa.innerHTML = `<p class="prompt">${level === 2 ? 'Remember this position.' : 'From the starting position.'}<small>${level === 2 ? 'Then the board goes dark and the moves are read out.' : 'The board goes dark. Follow the game in your head.'} ${plies} plies.</small></p>`;
    if (level === 2) { for (let s = 6; s > 0 && !stopped; s--) { tEl.textContent = s; await wait(1000); } tEl.textContent = ''; } else await wait(1500);
    board.hidePieces(true); const ply0 = plyFromFen(startFen);
    for (let i = 0; i < seq.length && !stopped; i++) { const m = p.parseSan(seq[i]); if (!m) break; p.make(m); board.setPosition(p, { animate: false }); stream.innerHTML = `<span class="label" style="display:block;margin-bottom:6px">Ply ${i + 1} of ${seq.length}</span>${line([seq[i]], ply0 + i)}`; await wait(1800); }
    stream.innerHTML = `<span class="small muted">${line(seq, ply0)}</span>`;
    const qs = questions(p.fen(), 3); if (nextMove && who && who !== 'you') qs.push(nextMoveQuestion(p.fen(), nextMove, who));
    askAll(el, board, qs, { area: 'blind', extra: { level, plies: seq.length }, onDone: res => end(res, seq.length) });
    async function end(res, n) {
      const good = res.filter(r => r.ok).length; const all = good === res.length;
      if (level >= 2) { plies = all ? Math.min(30, plies + 2) : good <= res.length / 2 ? Math.max(2, plies - 2) : plies; await store.setSetting(`blind.plies.${level}`, plies); }
      board.hidePieces(false);
      played++; tally.ok += good; tally.n += res.length; if (all) tally.plies = Math.max(tally.plies, n); const last = played >= rounds;
      qa.innerHTML = `<p class="verdict">${good} of ${res.length}.</p>${level >= 2 ? `<p class="small ink2">${all ? `Tracked ${n} plies cleanly. Next: ${plies}.` : `Next: ${plies} plies.`}</p>` : ''}<div class="actions"><button class="btn primary" data-n>${last ? 'Continue' : 'Next'}</button>${onDone ? '' : '<a class="btn link" href="#/vision">Done</a>'}</div>`;
      qa.querySelector('[data-n]').onclick = () => (last && onDone ? onDone(tally) : round());
    }
  }
  round();
  return () => { stopped = true; };
}

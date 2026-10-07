// Technique candidates from MY full games (raw/games/*.pgn), analysed offline with the bundled
// Stockfish (engine/stockfish-19-lite-single.js, run under Node). Staged, so the expensive part
// only touches promising positions:
//   node tools/build-technique.mjs stats   parse + dedupe + ending statistics (no engine)
//   node tools/build-technique.mjs scan    shallow eval of every position from move 16 (cached)
//   node tools/build-technique.mjs deep    deeper multi-line analysis of candidate moments (cached)
//   node tools/build-technique.mjs report  candidate report from the caches
import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process';
import { splitGames, parseHeaders, movetextTokens, normalizeMoves, chesscomId } from '../js/data/pgn.js';
import { Pos, BL, mFrom, mTo } from '../js/chess/core.js';
import { winPct } from '../js/analysis/quality.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ME = 'localchessexpert';
const CACHE = path.join(ROOT, 'tools/.cache'); fs.mkdirSync(CACHE, { recursive: true });
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };


// ---------- Engine: the bundled Stockfish WASM, one Node process per CPU ----------
const ENGINE = path.join(ROOT, 'engine/stockfish-19-lite-single.js');
class Uci {
  constructor() { this.p = spawn(process.execPath, [ENGINE], { cwd: path.dirname(ENGINE) }); this.buf = ''; this.wait = null; this.p.stdout.on('data', d => this.data(d)); this.send('uci'); this.send('setoption name Hash value 64'); }
  send(c) { this.p.stdin.write(c + '\n'); }
  data(d) { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); if (this.wait) this.wait(l); } }
  // returns [{ move (uci), score (cp, side to move; mate = ±(100000 - n)), pv }] best first
  go(fen, { depth = 10, multipv = 1, moves = null } = {}) {
    return new Promise(res => {
      const lines = {};
      this.wait = l => {
        if (l.startsWith('info') && l.includes(' pv ') && l.includes(' score ')) {
          const mp = +(/ multipv (\d+)/.exec(l) || [0, 1])[1]; const sc = / score (cp|mate) (-?\d+)/.exec(l);
          const score = sc[1] === 'cp' ? +sc[2] : (+sc[2] > 0 ? 100000 - +sc[2] : -100000 - +sc[2]);
          if (/ (lowerbound|upperbound)/.test(l)) return;
          lines[mp] = { score, pv: l.slice(l.indexOf(' pv ') + 4).split(' '), depth: +(/ depth (\d+)/.exec(l) || [0, 0])[1] };
        } else if (l.startsWith('bestmove')) { this.wait = null; res(Object.keys(lines).sort((a, b) => a - b).map(k => ({ move: lines[k].pv[0], ...lines[k] }))); }
      };
      this.send(`setoption name MultiPV value ${multipv}`); this.send(`position fen ${fen}`); this.send(`go depth ${depth}${moves ? ' searchmoves ' + moves.join(' ') : ''}`);
    });
  }
  quit() { this.send('quit'); this.p.kill(); }
}
// Runs jobs (async fn(engine)) across a pool; results in order.
export async function pool(jobs, n = 4, onTick) {
  const es = Array.from({ length: n }, () => new Uci()); const out = new Array(jobs.length); let next = 0, done = 0;
  await Promise.all(es.map(async e => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](e); done++; onTick && onTick(done, jobs.length); } }));
  es.forEach(e => e.quit()); return out;
}

// ---------- Stage 1: parse ----------
export function loadGames() {
  const dir = path.join(ROOT, 'raw/games'); const seen = new Set(); const out = []; let total = 0;
  for (const f of fs.readdirSync(dir).filter(x => x.toLowerCase().endsWith('.pgn')).sort()) {
    for (const raw of splitGames(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      total++; const h = parseHeaders(raw);
      const color = (h.White || '').toLowerCase() === ME ? 'w' : (h.Black || '').toLowerCase() === ME ? 'b' : null; if (!color) continue;
      const { sans } = movetextTokens(raw); const n = normalizeMoves(sans); if (!n.ok || !n.moves.length) continue;
      const id = chesscomId(h) || [h.White, h.Black, h.UTCDate, h.UTCTime].join('|'); if (seen.has(id)) continue; seen.add(id);
      const r = h.Result; const score = r === '1/2-1/2' ? 0.5 : (r === '1-0') === (color === 'w') ? 1 : 0;
      out.push({ id, color, opp: color === 'w' ? h.Black : h.White, oppElo: +(color === 'w' ? h.BlackElo : h.WhiteElo) || null, myElo: +(color === 'w' ? h.WhiteElo : h.BlackElo) || null,
        tc: h.TimeControl || '', date: (h.UTCDate || h.Date || '').replace(/\./g, '-'), link: h.Link || '', score, term: h.Termination || '', moves: n.moves });
    }
  }
  return { total, games: out };
}

// Non-pawn material by side: counts of q, r, minors
export function material(p) {
  const m = { w: { q: 0, r: 0, n: 0, b: 0, p: 0 }, b: { q: 0, r: 0, n: 0, b: 0, p: 0 } };
  for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const x = p.b[s]; if (!x) continue; const side = x & BL ? 'b' : 'w'; const k = ' pnbrqk'[x & 7]; if (k !== 'k') m[side][k]++; }
  return m;
}
// Ending type of a queenless position (null while queens are on)
export function endingType(m) {
  if (m.w.q || m.b.q) return null;
  const r = m.w.r + m.b.r, mi = m.w.n + m.w.b + m.b.n + m.b.b;
  if (!r && !mi) return 'pawn'; if (r && !mi) return 'rook'; if (!r && mi) return 'minor'; return r <= 4 && mi <= 4 ? 'rook+minor' : 'heavy';
}
export const PIECES = m => m.w.r + m.b.r + m.w.n + m.w.b + m.b.n + m.b.b + m.w.q + m.b.q;

// Per-game structure: positions, ply of queen trade, ending at the end.
export function profile(g) {
  const p = new Pos(); const plies = [{ fen: p.fen(), m: material(p) }]; let qOff = null;
  for (const s of g.moves) { p.play(s); const m = material(p); plies.push({ fen: p.fen(), m }); if (qOff == null && !m.w.q && !m.b.q) qOff = plies.length - 1; }
  const last = plies[plies.length - 1].m;
  return { plies, qOff, end: endingType(last), fullMoves: Math.ceil(g.moves.length / 2) };
}

function stats() {
  const { total, games } = loadGames();
  const blitz = games.filter(g => g.tc === '180+2');
  const P = blitz.map(g => ({ g, ...profile(g) }));
  const at = n => P.filter(x => x.fullMoves >= n).length;
  const ends = {}; for (const x of P) if (x.end) ends[x.end] = (ends[x.end] || 0) + 1;
  const res = t => { const xs = P.filter(x => x.end === t); return `${xs.filter(x => x.g.score === 1).length}W ${xs.filter(x => x.g.score === 0.5).length}D ${xs.filter(x => x.g.score === 0).length}L`; };
  console.log(`games in files: ${total}   unique games of ${ME}: ${games.length}   3+2: ${blitz.length}`);
  console.log(`3+2 reaching move 25+: ${at(25)}   35+: ${at(35)}   45+: ${at(45)}`);
  console.log(`3+2 queenless at some point: ${P.filter(x => x.qOff != null).length}   queenless at the end: ${P.filter(x => x.end).length}`);
  console.log('ending at the end of the game (queenless):', Object.entries(ends).map(([k, v]) => `${k} ${v} (${res(k)})`).join(' · '));
  const ends35 = {}; for (const x of P.filter(x => x.fullMoves >= 35 && x.end)) ends35[x.end] = (ends35[x.end] || 0) + 1;
  console.log('… of games reaching move 35+:', JSON.stringify(ends35));
}


// ---------- Stage 2: shallow scan (every position from ply 30, my perspective, cached) ----------
export const FROM_PLY = 30;
const SCAN = path.join(CACHE, 'scan.json');
const mine = (score, fen, color) => (fen.split(' ')[1] === color ? score : -score);
async function scan() {
  const { games } = loadGames(); const cache = readJson(SCAN, {});
  const todo = games.filter(g => g.tc === '180+2' && !cache[g.id] && g.moves.length > FROM_PLY + 6);
  console.log(`scan: ${todo.length} games to analyse (${Object.keys(cache).length} cached)`); let t0 = Date.now();
  const jobs = todo.map(g => async e => {
    const P = profile(g); const ev = [], best = [];
    for (let i = FROM_PLY; i < P.plies.length; i++) {
      const fen = P.plies[i].fen; const pos = new Pos(fen); const st = pos.status && pos.status();
      if (!pos.hasLegal()) { ev.push(pos.inCheck() ? (fen.split(' ')[1] === g.color ? -100000 : 100000) : 0); best.push(null); continue; }
      const [l] = await e.go(fen, { depth: 12 }); ev.push(l ? mine(l.score, fen, g.color) : 0); best.push(l ? l.move : null);
    }
    return { id: g.id, ev, best };
  });
  let saved = Date.now();
  const res = await pool(jobs, 4, (d, n) => { if (d % 25 === 0 || d === n) { process.stdout.write(`\r  ${d}/${n} games · ${((Date.now() - t0) / 1000).toFixed(0)}s`); } });
  for (const r of res) cache[r.id] = { ev: r.ev, best: r.best };
  fs.writeFileSync(SCAN, JSON.stringify(cache)); console.log(`\nscan cached: ${Object.keys(cache).length} games`);
}

// ---------- Stage 3: candidate moments (cheap, from the scan) ----------
const CL = x => Math.max(-1500, Math.min(1500, x));
const myTurn = (i, color) => (i % 2 === 0) === (color === 'w');
const TYPE = x => ' pnbrqk'[x & 7];
const minor = t => t === 'n' || t === 'b';
export function technical(P, i) { const m = P.plies[i].m; return (!m.w.q && !m.b.q) || (P.qOff != null && Math.abs(P.qOff - i) <= 6) || PIECES(m) <= 6; }
// Even trades available to the side to move: Q×Q, R×R, minor×minor that the opponent can recapture.
export function evenTrades(fen) {
  const p = new Pos(fen); const out = [];
  for (const m of p.legal()) {
    const a = TYPE(p.b[mFrom(m)]), cap = p.b[mTo(m)]; if (!cap) continue; const c = TYPE(cap);
    const kind = a === 'q' && c === 'q' ? 'queens' : a === 'r' && c === 'r' ? 'rooks' : minor(a) && minor(c) ? 'minors' : null; if (!kind) continue;
    const san = p.san(m); p.make(m); const re = p.legal().some(x => mTo(x) === mTo(m)); const after = material(p); p.unmake();
    if (re) out.push({ uci: p.uci(m), san, kind, pawnEnding: PIECES(after) <= 1 });
  }
  return out;
}
function candidates() {
  const { games } = loadGames(); const scanned = readJson(SCAN, {}); const C = { convert: [], hold: [], simplify: [] };
  for (const g of games) {
    const S = scanned[g.id]; if (!S) continue; const P = profile(g); const ev = i => CL(S.ev[i - FROM_PLY]);
    const n = Math.min(P.plies.length - 1, FROM_PLY + S.ev.length - 1); const later = i => { let lo = Infinity; for (let j = i; j <= n; j++) lo = Math.min(lo, ev(j)); return lo; };
    let conv = 0, hold = 0, simp = 0;
    for (let i = FROM_PLY; i < n; i++) {
      if (!myTurn(i, g.color)) continue; const e0 = ev(i), e1 = ev(i + 1), drop = e0 - e1; const tech = technical(P, i);
      const base = { gid: g.id, ply: i, fen: P.plies[i].fen, played: g.moves[i], e0, e1, score: g.score, end: P.end, qOff: P.qOff };
      if (tech && e0 >= 200 && e0 <= 700 && drop >= 100 && (g.score < 1 || later(i + 1) < Math.min(100, e0 - 250)) && conv < 2) { C.convert.push(base); conv++; }
      if (tech && e0 <= -120 && e0 >= -350 && drop >= 100 && e1 <= -250 && g.score < 1 && hold < 1) { C.hold.push(base); hold++; }
      if (e0 >= -300 && e0 <= 500 && simp < 3) { const tr = evenTrades(base.fen); if (tr.length) { const playedTrade = tr.find(t => t.san === g.moves[i]); if (playedTrade || (drop >= 80)) { C.simplify.push({ ...base, trades: tr, playedTrade: !!playedTrade }); simp++; } } }
    }
  }
  return C;
}

// ---------- Stage 4: deep analysis of candidates (cached) ----------
const DEEP = path.join(CACHE, 'deep.json');
const pvSan = (fen, pv, n = 8) => { const p = new Pos(fen); const out = []; for (const u of pv.slice(0, n)) { const m = p.fromUci(u); if (!m) break; out.push(p.san(m)); p.make(m); } return out; };
async function deep() {
  const C = candidates(); const cache = readJson(DEEP, {});
  const all = [...C.convert.map(c => ['convert', c]), ...C.hold.map(c => ['hold', c]), ...C.simplify.map(c => ['simplify', c])];
  const key = (k, c) => `${k}:${c.gid}:${c.ply}`; const todo = all.filter(([k, c]) => !cache[key(k, c)]);
  console.log(`deep: convert ${C.convert.length}, hold ${C.hold.length}, simplify ${C.simplify.length} raw; ${todo.length} to analyse`); const t0 = Date.now();
  const jobs = todo.map(([k, c]) => async e => {
    const color = c.fen.split(' ')[1]; const lines = await e.go(c.fen, { depth: 18, multipv: 3 });
    const playedUci = new Pos(c.fen).sanToUci(c.played); const [pl] = playedUci ? await e.go(c.fen, { depth: 16, moves: [playedUci] }) : [null];
    const r = { lines: lines.map(l => ({ uci: l.move, score: l.score, pv: l.pv.slice(0, 12) })), played: pl ? { uci: playedUci, score: pl.score, pv: pl.pv.slice(0, 12) } : null };
    if (k === 'simplify') {
      r.trades = [];
      for (const t of c.trades) { const [tl] = await e.go(c.fen, { depth: 16, moves: [t.uci] }); r.trades.push({ ...t, score: tl ? tl.score : null, pv: tl ? tl.pv.slice(0, 10) : [] }); }
      const non = new Pos(c.fen).legal().map(m => new Pos(c.fen).uci(m)).filter(u => !c.trades.some(t => t.uci === u));
      const [nl] = non.length ? await e.go(c.fen, { depth: 16, moves: non }) : [null]; r.keep = nl ? { uci: nl.move, score: nl.score, pv: nl.pv.slice(0, 10) } : null;
      // "improve first": after the best quiet move and the reply, is the same kind of trade still there — and better?
      if (r.keep && r.keep.pv.length >= 2) { const p = new Pos(c.fen); p.play(new Pos(c.fen).uciToSan(r.keep.pv[0])); const m2 = p.fromUci(r.keep.pv[1]); if (m2) { p.make(m2); const later = evenTrades(p.fen()).filter(t => c.trades.some(x => x.kind === t.kind));
        if (later.length) { const [ll] = await e.go(p.fen(), { depth: 16, moves: later.map(t => t.uci) }); r.later = ll ? { uci: ll.move, score: ll.score, kind: later.find(t => t.uci === ll.move)?.kind } : null; } } }
    }
    return [key(k, c), r];
  });
  const res = await pool(jobs, 4, (d, n) => { if (d % 20 === 0 || d === n) process.stdout.write(`\r  ${d}/${n} · ${((Date.now() - t0) / 1000).toFixed(0)}s`); });
  for (const [k, r] of res) cache[k] = r; fs.writeFileSync(DEEP, JSON.stringify(cache)); console.log(`\ndeep cached: ${Object.keys(cache).length}`);
}

// ---------- Stage 5: quality filter, tags, lessons, report ----------
const sq = s => ({ f: s & 7, r: s >> 4 });
function passed(p, s) { const x = p.b[s]; if (!x || TYPE(x) !== 'p') return false; const black = !!(x & BL); const { f, r } = sq(s);
  for (let s2 = 0; s2 < 128; s2++) { if (s2 & 0x88) { s2 += 7; continue; } const y = p.b[s2]; if (!y || TYPE(y) !== 'p' || !!(y & BL) === black) continue; const q = sq(s2); if (Math.abs(q.f - f) <= 1 && (black ? q.r < r : q.r > r)) return false; } return true; }
function moveInfo(fen, uci) { const p = new Pos(fen); const m = uci && p.fromUci(uci); if (!m) return null; const from = mFrom(m), to = mTo(m); const t = TYPE(p.b[from]); const cap = p.b[to] ? TYPE(p.b[to]) : null; const pass = t === 'p' && passed(p, from); const san = p.san(m); p.make(m); return { t, cap, pass, san, check: p.inCheck(), from, to, white: fen.split(' ')[1] === 'w' }; }
// material swing (in pawns, from the side to move) along a line: ±2 or more inside 6 plies = a tactic, not technique
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function swing(fen, pv, n = 6) { const p = new Pos(fen); const me = p.side(); const bal = () => { let x = 0; for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const y = p.b[s]; if (y) x += ((y & BL ? 'b' : 'w') === me ? 1 : -1) * VAL[TYPE(y)]; } return x; };
  const b0 = bal(); let lo = 0, hi = 0; for (const u of pv.slice(0, n)) { const m = p.fromUci(u); if (!m) break; p.make(m); if (p.side() === me) { const d = bal() - b0; lo = Math.min(lo, d); hi = Math.max(hi, d); } } const d = bal() - b0; return { lo: Math.min(lo, d), hi: Math.max(hi, d) }; }
const activeRook = mi => mi && mi.t === 'r' && !mi.cap && (mi.check || (mi.white ? sq(mi.to).r >= 4 : sq(mi.to).r <= 3));
const backRank = mi => mi && mi.t === 'r' && !mi.check && (mi.white ? sq(mi.to).r < sq(mi.from).r : sq(mi.to).r > sq(mi.from).r); // a retreat
export function analyse(kind, c, r) {
  if (!r || !r.lines.length || !r.played) return null;
  const best = r.lines[0], second = r.lines[1]; const B = moveInfo(c.fen, best.uci), Pm = moveInfo(c.fen, r.played.uci); if (!B || !Pm) return null;
  const loss = CL(best.score) - CL(r.played.score); const queenless = !/q/i.test(c.fen.split(' ')[0]);
  const afterPlayed = (() => { const p = new Pos(c.fen); p.play(c.played); return p.fen(); })();
  const reply = r.played.pv[1] ? moveInfo(afterPlayed, r.played.pv[1]) : null;
  const trades = evenTrades(c.fen); const playedTrade = trades.find(t => t.uci === r.played.uci); const bestTrade = trades.find(t => t.uci === best.uci);
  const tags = new Set(); const why = [];
  if (playedTrade && loss >= 100) { tags.add('EXCHANGE_DECISION'); why.push('traded'); }
  if (bestTrade && !playedTrade) { tags.add('EXCHANGE_DECISION'); why.push('should-trade'); }
  if (reply && reply.pass && !reply.cap) { tags.add('PASSED_PAWN'); why.push('opp-passer'); }
  if (B.pass && !B.cap) { tags.add('PASSED_PAWN'); why.push('my-passer'); }
  if (queenless && B.t === 'k' && Pm.t !== 'k') { tags.add('KING_ACTIVITY'); why.push('king'); }
  if ((activeRook(B) && !activeRook(Pm)) || (backRank(Pm) && !backRank(B))) { tags.add('ROOK_ACTIVITY'); why.push(backRank(Pm) ? 'rook-passive' : 'rook-active'); }
  if (reply && (reply.check || (reply.cap && reply.to !== Pm.to) || reply.pass) && loss >= 150) { tags.add('COUNTERPLAY'); why.push('counterplay'); }
  const tactic = ((B.cap || B.check) && !bestTrade && (!second || CL(best.score) - CL(second.score) >= 200)) || swing(c.fen, best.pv).hi >= 2 || swing(c.fen, r.played.pv).lo <= -2;
  const replySan = reply ? reply.san : null;
  return { tags: [...tags], why, loss, replySan, best: { san: B.san, score: best.score, pv: pvSan(c.fen, best.pv) }, played: { san: Pm.san, score: r.played.score, pv: pvSan(c.fen, r.played.pv) }, tactic, queenless };
}
const LESSON = {
  convert: { traded: 'Trading here gave back much of the advantage.', 'should-trade': 'The exchange was the clean way to convert.', 'opp-passer': 'Deal with the passed pawn before anything else.', king: 'Improve the king before pushing.', 'rook-passive': 'Your rook became passive.', 'rook-active': 'Your rook needed to be active.', 'my-passer': 'Push the passed pawn; it is the winning asset.', counterplay: 'You allowed unnecessary counterplay.' },
  hold: { traded: 'Trading here made the defense much harder.', 'should-trade': 'The exchange was the way to hold.', 'opp-passer': 'Stop the passed pawn first.', king: 'Your king had to become active.', 'rook-passive': 'The rook needed activity.', 'rook-active': 'The rook needed activity.', 'my-passer': 'Your own passed pawn was the counterplay.', counterplay: 'That gave the opponent the initiative.' },
};
const ORDER = ['traded', 'should-trade', 'opp-passer', 'king', 'rook-passive', 'rook-active', 'my-passer', 'counterplay'];
export function select() {
  const { games } = loadGames(); const G = new Map(games.map(g => [g.id, g])); const C = candidates(); const D = readJson(DEEP, {}); const out = { convert: [], hold: [], simplify: [] }; const seenFen = new Set();
  const fenKey = f => f.split(' ').slice(0, 2).join(' ');
  for (const kind of ['convert', 'hold']) for (const c of C[kind]) {
    const a = analyse(kind, c, D[`${kind}:${c.gid}:${c.ply}`]); if (!a) continue; const b = CL(a.best.score);
    const ok = kind === 'convert' ? b >= 180 && b <= 800 : b >= -230 && b <= -60;
    const reason = ORDER.find(w => a.why.includes(w));
    // a technique error costs 1–4 pawns and does not hand over a lost position; bigger swings are blunders (Repair)
    const pl = CL(a.played.score); const sane = a.loss <= 400 && (kind === 'convert' ? pl >= -150 : pl >= -650);
    const hq = ok && sane && !a.tactic && a.loss >= 100 && reason && !seenFen.has(fenKey(c.fen)) && !out[kind].some(x => x.gid === c.gid);
    if (hq) seenFen.add(fenKey(c.fen));
    const lesson = reason === 'counterplay' && a.replySan ? `${a.played.san} allowed ${a.replySan}.` : reason ? LESSON[kind][reason] : null;
    out[kind].push({ ...c, ...a, hq: !!hq, lesson, reason, ending: endingType(material(new Pos(c.fen))) || 'queens', g: G.get(c.gid) });
  }
  for (const c of C.simplify) {
    const r = D[`simplify:${c.gid}:${c.ply}`]; if (!r || !r.keep || !r.trades || !r.trades.length) continue;
    const bt = r.trades.filter(t => t.score != null).sort((a, b) => b.score - a.score)[0]; if (!bt) continue;
    const tradeS = CL(bt.score), keepS = CL(r.keep.score), diff = tradeS - keepS;
    let answer = diff > 0 ? bt.kind : 'keep';
    if (diff < 0 && r.later && r.later.kind && CL(r.later.score) >= tradeS + 50 && CL(r.later.score) >= keepS - 40) answer = 'improve';
    const K = moveInfo(c.fen, r.keep.uci); const keepTactic = K && (K.cap || K.check) && diff < 0 && r.lines[1] && CL(r.lines[0].score) - CL(r.lines[1].score) >= 200;
    const gameChoice = c.playedTrade ? 'trade' : 'keep'; const wrongInGame = (answer === 'keep' || answer === 'improve') ? gameChoice === 'trade' : gameChoice === 'keep';
    const inRange = Math.max(tradeS, keepS) <= 800 && Math.min(tradeS, keepS) >= -400 && Math.max(tradeS, keepS) >= -250;
    const tags = ['EXCHANGE_DECISION']; const queenless = !/q/i.test(c.fen.split(' ')[0]);
    if (answer === 'improve' && K && K.t === 'k') tags.push('KING_ACTIVITY'); if (answer === 'improve' && K && K.t === 'r') tags.push('ROOK_ACTIVITY'); if (bt.pawnEnding) tags.push('PASSED_PAWN');
    const P_ = profile(G.get(c.gid)); const techn = technical(P_, c.ply) || c.trades.some(t => t.kind === 'queens');
    const tradePv = r.trades.find(t => t.uci === bt.uci)?.pv || []; const quiet = Math.abs(swing(c.fen, tradePv).lo) < 2 && swing(c.fen, tradePv).hi < 2 && Math.abs(swing(c.fen, r.keep.pv).lo) < 2 && swing(c.fen, r.keep.pv).hi < 2 && !new Pos(c.fen).inCheck();
    const hq = quiet && techn && Math.abs(diff) >= 120 && Math.abs(diff) <= 300 && wrongInGame && inRange && !keepTactic && !seenFen.has(fenKey(c.fen)) && !out.simplify.some(x => x.gid === c.gid && x.hq);
    if (hq) seenFen.add(fenKey(c.fen));
    out.simplify.push({ ...c, answer, diff, tradeS, keepS, kinds: [...new Set(c.trades.map(t => t.kind))], pawnEnding: !!bt.pawnEnding, wrongInGame, tags, hq: !!hq, queenless, ending: endingType(material(new Pos(c.fen))) || 'queens', g: G.get(c.gid) });
  }
  return out;
}

function weaknesses() {
  const { games } = loadGames(); const S = readJson(SCAN, {}); const W = { enteredBad: 0, enteredBadLost: 0, tradesBad: { queens: 0, rooks: 0, minors: 0 }, tradesAll: { queens: 0, rooks: 0, minors: 0 }, endErr: {}, endMoves: {}, convFail: 0, convChances: 0, convFailBy: {}, defFail: 0, defChances: 0 };
  for (const g of games) { const sc = S[g.id]; if (!sc) continue; const P = profile(g); const ev = i => CL(sc.ev[i - FROM_PLY]); const n = Math.min(P.plies.length - 1, FROM_PLY + sc.ev.length - 1);
    if (P.qOff != null && P.qOff >= FROM_PLY && P.qOff <= n && ev(P.qOff) <= -150) { W.enteredBad++; if (g.score === 0) W.enteredBadLost++; }
    let conv = false, convLost = false, def = false, defLost = false;
    for (let i = FROM_PLY; i < n; i++) { if (!myTurn(i, g.color)) continue; const e0 = ev(i), e1 = ev(i + 1), drop = e0 - e1, et = endingType(P.plies[i].m);
      const t = evenTrades(P.plies[i].fen).find(x => x.san === g.moves[i]); if (t) { W.tradesAll[t.kind]++; if (drop >= 100 && e0 > -400 && e0 < 600) W.tradesBad[t.kind]++; }
      if (et && et !== 'heavy') { W.endMoves[et] = (W.endMoves[et] || 0) + 1; if (drop >= 150 && e0 > -150 && e0 < 300) W.endErr[et] = (W.endErr[et] || 0) + 1; }
      if (technical(P, i) && e0 >= 200 && e0 <= 800) { conv = true; if (drop >= 150) convLost = true; }
      if (technical(P, i) && e0 <= -80 && e0 >= -250) { def = true; if (drop >= 150 && e1 <= -300) defLost = true; } }
    if (conv) { W.convChances++; if (g.score < 1 && convLost) { W.convFail++; W.convFailBy[P.end || 'queens'] = (W.convFailBy[P.end || 'queens'] || 0) + 1; } }
    if (def) { W.defChances++; if (defLost && g.score === 0) W.defFail++; } }
  return W;
}

function report() {
  const { games } = loadGames(); const blitz = games.filter(g => g.tc === '180+2'); const P = blitz.map(profile);
  const sel = select(); const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  const count = (xs, f) => { const o = {}; for (const x of xs) for (const k of [].concat(f(x))) o[k] = (o[k] || 0) + 1; return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '); };
  const ends = {}; for (const x of P) if (x.end) ends[x.end] = (ends[x.end] || 0) + 1;
  console.log(`unique full games: ${games.length} (3+2: ${blitz.length}) · move 35+: ${P.filter(x => x.fullMoves >= 35).length} · queenless: ${P.filter(x => x.qOff != null).length}`);
  console.log(`endings (final position): ${JSON.stringify(ends)}`);
  for (const k of ['simplify', 'convert', 'hold']) { const all = sel[k], hq = all.filter(x => x.hq);
    console.log(`\n${k.toUpperCase()}: raw ${all.length} · analysed-qualifying ${k === 'simplify' ? all.filter(x => Math.abs(x.diff) >= 100).length : all.filter(x => x.lesson).length} · high-quality ${hq.length}`);
    console.log('  tags:', count(hq, x => x.tags)); console.log('  by ending:', count(hq, x => x.ending));
    if (k === 'simplify') console.log('  answers:', count(hq, x => x.answer), '· trade kinds offered:', count(hq, x => x.kinds));
    else console.log('  lessons:', count(hq, x => x.lesson));
    for (const x of hq.slice(0, 4)) console.log(`   e.g. ${x.g.link} ply ${x.ply} · ${k === 'simplify' ? `answer ${x.answer} (trade ${x.tradeS} / keep ${x.keepS}), game: ${x.played}` : `best ${x.best.san} ${x.best.score} vs played ${x.played.san} ${x.played.score} · ${x.lesson}`}`);
  }
  const W = weaknesses(); console.log('\nWEAKNESS SIGNALS', JSON.stringify(W, null, 0));
  fs.writeFileSync(path.join(CACHE, 'selected.json'), JSON.stringify(Object.fromEntries(Object.entries(sel).map(([k, v]) => [k, v.filter(x => x.hq).map(({ g, ...x }) => ({ ...x, link: g.link, opp: g.opp, date: g.date, color: g.color }))]))));
}

// ---------- Stage 6: build data/technique.json ----------
const LABEL = { queens: 'Trade queens', rooks: 'Trade rooks', minors: 'Trade the minor pieces' };
const GAINS = ['Reduce counterplay', 'Activate my king', 'Reach a favorable pawn ending', 'Improve my rook', 'Remove a defender', 'Keep attacking chances'];
const myMaterial = fen => { const p = new Pos(fen); const me = p.side(); let x = 0; for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const y = p.b[s]; if (y) x += ((y & BL ? 'b' : 'w') === me ? 1 : -1) * VAL[TYPE(y)]; } return x; };
const fen4 = f => f.split(' ').slice(0, 4).join(' ');
function context(g, ply) { const from = Math.max(0, ply - 6); return { prev: g.moves.slice(from, ply), prevPly: from }; }
function build() {
  const sel = select(); const D = readJson(DEEP, {}); const used = new Set(); const pick = (x, extra) => { used.add(fen4(x.fen)); return extra; };
  const meta = x => ({ link: x.g.link, opp: x.g.opp, date: x.g.date, ...context(x.g, x.ply) });
  // SIMPLIFY: every clean technical exchange decision, whether the game choice was right or wrong
  const simplify = [];
  for (const x of sel.simplify) {
    const r = D[`simplify:${x.gid}:${x.ply}`]; const P_ = profile(x.g);
    const bt = r.trades.filter(t => t.score != null).sort((a, b) => b.score - a.score)[0]; const s1 = swing(x.fen, bt.pv || []), s2 = swing(x.fen, r.keep.pv);
    const quiet = s1.lo > -2 && s1.hi < 2 && s2.lo > -2 && s2.hi < 2 && !new Pos(x.fen).inCheck();
    const techn = technical(P_, x.ply) || x.trades.some(t => t.kind === 'queens');
    const K = moveInfo(x.fen, r.keep.uci); const keepTactic = K && (K.cap || K.check) && x.diff < 0 && r.lines[1] && CL(r.lines[0].score) - CL(r.lines[1].score) >= 200;
    const inRange = Math.max(x.tradeS, x.keepS) <= 800 && Math.min(x.tradeS, x.keepS) >= -400 && Math.max(x.tradeS, x.keepS) >= -250;
    if (!(quiet && techn && Math.abs(x.diff) >= 120 && Math.abs(x.diff) <= 300 && inRange && !keepTactic)) continue;
    if (used.has(fen4(x.fen)) || simplify.some(y => y.gid === x.gid)) continue;
    const trade = x.answer !== 'keep' && x.answer !== 'improve'; const kinds = x.kinds;
    const choices = kinds.map(k => ({ key: k, label: x.pawnEnding && k === bt.kind ? 'Trade into the pawn ending' : LABEL[k] })); choices.push({ key: 'keep', label: 'Keep pieces' });
    if (r.later) choices.push({ key: 'improve', label: 'Improve first' });
    // accepted answers: trades within 0.4 of the best trade; not trading now = keep or improve
    const accept = trade ? r.trades.filter(t => t.score != null && t.score >= bt.score - 40).map(t => t.kind) : ['keep', 'improve'].filter(k => choices.some(c => c.key === k));
    const ahead = myMaterial(x.fen) >= 2; const quietSan = K ? K.san : null;
    let explain;
    if (trade && x.pawnEnding) explain = 'Trade into the pawn ending. It is better for you than keeping the pieces.';
    else if (trade && ahead) explain = `${LABEL[x.answer]}. You are ahead in material, and the exchange brings the win closer.`;
    else if (trade) explain = x.tradeS > 50 ? `${LABEL[x.answer]}. It keeps more of your advantage than avoiding the exchange.` : `${LABEL[x.answer]}. Avoiding the exchange leaves you worse.`;
    else if (x.answer === 'improve') explain = `Improve first: ${quietSan}. The exchange is stronger a move later.`;
    else if (x.pawnEnding) explain = 'Keep the pieces. The pawn ending would be worse for you.';
    else if (x.keepS >= 100) explain = 'Keep the pieces. The exchange gives away much of your advantage.';
    else explain = 'Keep the pieces. The exchange leaves you worse off.';
    let gain = null;
    if (trade && x.pawnEnding) gain = 'Reach a favorable pawn ending';
    else if (x.answer === 'improve' && K && K.t === 'k') gain = 'Activate my king';
    else if (x.answer === 'improve' && K && K.t === 'r') gain = 'Improve my rook';
    const correctPv = trade ? (r.trades.find(t => t.kind === x.answer) || bt).pv : r.keep.pv;
    simplify.push(pick(x, { id: 's' + x.gid + '-' + x.ply, gid: x.gid, fen: x.fen, color: x.fen.split(' ')[1], choices, answer: x.answer, accept, explain,
      gain: gain ? { answer: gain, options: [gain, ...GAINS.filter(q => q !== gain).sort(() => 0.5 - Math.random()).slice(0, 2)].sort() } : null,
      line: pvSan(x.fen, correctPv, 8), game: { played: x.played, traded: x.playedTrade, right: trade ? x.playedTrade : !x.playedTrade },
      tags: x.tags, ending: x.ending, ...meta(x) }));
  }
  const play = kind => sel[kind].filter(x => x.hq && !used.has(fen4(x.fen))).map(x => pick(x, { id: kind[0] + x.gid + '-' + x.ply, gid: x.gid, fen: x.fen, color: x.fen.split(' ')[1],
    startCp: CL(x.best.score), tags: x.tags, ending: x.ending, game: { played: x.played.san, best: x.best.san, lesson: x.lesson }, ...meta(x) }));
  const convert = play('convert'), hold = play('hold');
  // Tactical failures while better → Repair (find the move) or Calculate (forcing line), never Technique
  const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/training.json'), 'utf8'));
  const existing = new Set([...T.drills.map(d => fen4(d.fen)), ...T.calc.map(c => fen4(c.fen))]);
  const repair = [], calc = []; let dup = 0, blunders = 0;
  for (const x of sel.convert) {
    const b = CL(x.best.score), pl = CL(x.played.score); if (!(b >= 180 && b <= 800)) continue;
    if (!(x.tactic || x.loss > 400 || pl < -150)) continue; blunders++;
    const k = fen4(x.fen); if (existing.has(k) || used.has(k)) { dup++; continue; } existing.add(k);
    const r = D[`convert:${x.gid}:${x.ply}`]; const B = moveInfo(x.fen, r.lines[0].uci); const pvB = pvSan(x.fen, r.lines[0].pv, 10);
    const color = x.fen.split(' ')[1]; const before = x.g.moves.slice(0, x.ply);
    if ((B.cap || B.check) && pvB.length >= 5) calc.push({ id: `calc:${k}|${B.san}`, src: 'mine', drillId: null, fam: null, fen: x.fen, side: color, kind: 'tactical', line: pvB, cp: b, played: x.played.san, level: 'medium', games: [x.gid], origin: 'technique-scan' });
    else repair.push({ id: `${k}|${x.played.san}`, legacyFam: null, fam: null, col: color, fen: x.fen, path: before, moveNo: `${Math.floor(x.ply / 2) + 1}${color === 'w' ? '.' : '…'}${x.played.san}`, played: x.played.san, sfBest: B.san, good: [B.san],
      cpBest: b, cpPlayed: pl, loss: +(winPct(b) - winPct(pl)).toFixed(1), verdict: 'mistake', pvBest: pvB, pvRef: pvSan(x.fen, r.played.pv, 8),
      type: swing(x.fen, r.played.pv).lo <= -2 ? 'allowed-tactic' : swing(x.fen, r.lines[0].pv).hi >= 2 ? 'missed-win' : 'allowed-tactic', tags: [], why: [], n: 1, seen: 1, games: [x.gid], origin: 'technique-scan' });
  }
  const strip = xs => xs.map(({ gid, ...x }) => x);
  const out = { built: new Date().toISOString().slice(0, 10), source: 'raw/games/*.pgn (localchessexpert, 3+2), Stockfish 19 lite depth 16-18',
    simplify: strip(simplify), convert: strip(convert), hold: strip(hold), repair, calc };
  fs.writeFileSync(path.join(ROOT, 'data/technique.json'), JSON.stringify(out));
  const ends = xs => { const o = {}; for (const x of xs) o[x.ending] = (o[x.ending] || 0) + 1; return JSON.stringify(o); };
  console.log(`technique.json: simplify ${simplify.length} (game choice right ${simplify.filter(x => x.game.right).length}, wrong ${simplify.filter(x => !x.game.right).length}) · convert ${convert.length} · hold ${hold.length}`);
  console.log(`  endings: simplify ${ends(simplify)} · convert ${ends(convert)} · hold ${ends(hold)}`);
  console.log(`tactical conversion failures: ${blunders} → repair ${repair.length} · calculate ${calc.length} · duplicates rejected ${dup}`);
}

if (process.argv[1] && process.argv[1].endsWith('build-technique.mjs')) {
  const cmd = process.argv[2] || 'stats';
  if (cmd === 'stats') stats();
  if (cmd === 'scan') scan();
  if (cmd === 'deep') deep();
  if (cmd === 'report') report();
  if (cmd === 'build') build();
  if (cmd === 'candidates') { const C = candidates(); console.log(Object.fromEntries(Object.entries(C).map(([k, v]) => [k, v.length]))); }
}
export { readJson, DEEP, CL, swing, candidates };

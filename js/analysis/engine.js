// Stockfish 19 (lite, single-threaded WASM) in Web Workers. Offline, asynchronous, cached.
//  - `analysis` worker: priority queue; high-priority (interactive) jobs pre-empt low ones.
//  - `play` worker: the Blitz opponent (strength-limited), so it never waits behind analysis.
// If WASM workers cannot start, a small built-in searcher is used and the UI is told so.
import { Pos, QuickEngine } from '../chess/core.js';
import { THRESHOLDS, lineCp } from './quality.js';
import * as store from '../data/store.js';

const ENGINE_URL = 'engine/stockfish-19-lite-single.js';
const fen4 = fen => fen.split(' ').slice(0, 4).join(' ');

class UciWorker {
  constructor(name) { this.name = name; this.queue = []; this.cur = null; this.ready = this.start(); }
  start() {
    return new Promise((res, rej) => {
      let w; try { w = new Worker(ENGINE_URL); } catch (e) { rej(e); return; }
      this.w = w; let ok = false;
      const to = setTimeout(() => { if (!ok) rej(new Error('Stockfish did not start')); }, 15000);
      w.onmessage = e => { const line = typeof e.data === 'string' ? e.data : ''; if (!ok) { if (line.startsWith('uciok')) { w.postMessage('setoption name Hash value 32'); w.postMessage('isready'); } else if (line.startsWith('readyok')) { ok = true; clearTimeout(to); res(); } return; } this.onLine(line); };
      w.onerror = err => { clearTimeout(to); rej(err); };
      w.postMessage('uci');
    });
  }
  post(c) { this.w.postMessage(c); }
  push(job) { this.queue.push(job); this.queue.sort((a, b) => b.pri - a.pri); this.pump(); }
  pump() {
    if (this.cur) { const top = this.queue[0]; if (top && top.pri > this.cur.pri && !this.cur.stopping) { this.cur.preempted = true; this.cur.stopping = true; this.post('stop'); } return; }
    const job = this.queue.shift(); if (!job) return;
    if (job.cancelled) { job.resolve(null); this.pump(); return; }
    this.cur = job; job.lines = []; job.depth = 0;
    const o = job.opts;
    this.post('ucinewgame');
    this.post(`setoption name MultiPV value ${o.multipv || 1}`);
    if (o.elo) { this.post('setoption name UCI_LimitStrength value true'); this.post(`setoption name UCI_Elo value ${Math.max(1320, Math.min(3190, Math.round(o.elo)))}`); }
    else this.post('setoption name UCI_LimitStrength value false');
    this.post('position fen ' + job.fen);
    const go = o.depth && o.movetime ? `go depth ${o.depth} movetime ${o.movetime}` : o.depth ? `go depth ${o.depth}` : `go movetime ${o.movetime || 500}`;
    this.post(go);
  }
  onLine(line) {
    const job = this.cur; if (!job) return;
    if (line.startsWith('info') && line.includes(' pv ') && !/ (lower|upper)bound/.test(line)) {
      const d = +(/ depth (\d+)/.exec(line) || [])[1]; const k = +((/ multipv (\d+)/.exec(line) || [])[1] || 1);
      const cp = / score cp (-?\d+)/.exec(line), mate = / score mate (-?\d+)/.exec(line);
      const l = { d, cp: cp ? +cp[1] : null, mate: mate ? +mate[1] : null, pv: line.split(' pv ')[1].trim().split(/\s+/) }; l.score = lineCp(l);
      job.lines[k - 1] = l; if (k === 1) job.depth = d;
      job.onInfo && job.onInfo(job.lines.filter(Boolean));
    } else if (line.startsWith('bestmove')) {
      const best = line.split(/\s+/)[1]; this.cur = null;
      const r = { best: best && best !== '(none)' ? best : null, depth: job.depth, lines: job.lines.filter(Boolean) };
      if (job.preempted && !job.cancelled) { job.preempted = false; job.stopping = false; this.queue.push(job); this.queue.sort((a, b) => b.pri - a.pri); }
      else job.resolve(job.cancelled ? null : r);
      this.pump();
    }
  }
  cancel(job) { job.cancelled = true; if (this.cur === job && !job.stopping) { job.stopping = true; this.post('stop'); } }
}

const mem = new Map(); // key -> result
let analysis = null, play = null, quick = null;
export const status = { mode: 'loading', note: '' };

export async function initEngine() {
  try { analysis = new UciWorker('analysis'); await analysis.ready; status.mode = 'stockfish'; }
  catch (e) { status.mode = 'fallback'; status.note = 'Stockfish could not start here (serve the app over http). Using the small built-in engine.'; quick = new QuickEngine(); }
  return status.mode;
}
async function getPlay() { if (status.mode !== 'stockfish') return null; if (!play) { play = new UciWorker('play'); try { await play.ready; } catch (e) { play = null; } } return play; }

function key(fen, mpv) { return fen4(fen) + '|' + (mpv || 1); }

// analyse(fen, {budget:'fast'|'review'|'deep', depth, movetime, multipv, priority:'high'|'low', onInfo})
// Resolves {best, depth, lines:[{cp,mate,score,pv[uci],d}]} (scores from the side to move), or null if cancelled.
export function analyse(fen, opts = {}) {
  const b = THRESHOLDS[opts.budget || 'fast'] || THRESHOLDS.fast;
  const o = { depth: opts.depth ?? b.depth, movetime: opts.movetime ?? b.movetime, multipv: opts.multipv || 1 };
  const k = key(fen, o.multipv);
  const handle = { cancel: () => {} };
  handle.promise = (async () => {
    const hit = mem.get(k) || await store.get('engine', k).catch(() => null);
    if (hit && hit.depth >= Math.min(o.depth, 14)) { mem.set(k, hit); return hit; }
    if (status.mode === 'loading') await new Promise(r => setTimeout(r, 50));
    if (!analysis) return quickSearch(fen, o);
    const r = await new Promise(resolve => { const job = { fen, opts: o, pri: opts.priority === 'low' ? 0 : 1, resolve, onInfo: opts.onInfo }; handle.cancel = () => analysis.cancel(job); analysis.push(job); });
    if (r && r.lines.length) { mem.set(k, r); store.put('engine', r, k).catch(() => {}); }
    return r;
  })();
  return handle;
}
export const analyseP = (fen, opts) => analyse(fen, opts).promise;

function quickSearch(fen, o) {
  const pos = new Pos(fen); const r = quick.search(pos, { ms: Math.min(1500, o.movetime || 600) });
  if (!r.move) return { best: null, depth: 0, lines: [] };
  const l = { d: r.depth, cp: r.score, mate: null, pv: [pos.uci(r.move)] }; l.score = l.cp;
  return { best: pos.uci(r.move), depth: r.depth, lines: [l], fallback: true };
}

// Opponent move with limited strength. Returns uci.
export async function playMove(fen, { elo = 2250, movetime = 400 } = {}) {
  const w = await getPlay();
  if (!w) { const r = quickSearch(fen, { movetime }); return r.best; }
  const r = await new Promise(resolve => w.push({ fen, opts: { movetime, elo, multipv: 1 }, pri: 1, resolve }));
  return r && r.best;
}

// Evaluate the position after a move, from the MOVER's perspective.
export async function evalAfter(fen, uciOrSan, opts = {}) {
  const p = new Pos(fen); const m = /^[a-h][1-8][a-h][1-8]/.test(uciOrSan) ? p.fromUci(uciOrSan) : p.parseSan(uciOrSan); if (!m) return null;
  p.make(m); const st = p.status(); if (st) return st.reason === 'checkmate' ? 99990 : 0;
  const r = await analyseP(p.fen(), opts); if (!r || !r.lines.length) return null; return -r.lines[0].score;
}
export function pvToSan(fen, pv, max = 12) { const p = new Pos(fen); const out = []; for (const u of (pv || []).slice(0, max)) { const m = p.fromUci(u); if (!m) break; out.push(p.san(m)); p.make(m); } return out; }

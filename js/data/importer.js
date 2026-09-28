// Main-thread side of importing: PGNs (my games / model players), backups, legacy Drill Room progress.
import * as store from './store.js';
import { C, myGames } from './catalog.js';
import { dupKey } from './pgn.js';
import * as srs from '../training/srs.js';
import { Pos } from '../chess/core.js';
import { analyseP } from '../analysis/engine.js';
import { moveQuality, isError, MOVE_LABEL } from '../analysis/quality.js';

function worker(msg, onProgress) {
  return new Promise((res, rej) => {
    const w = new Worker(new URL('./import-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = e => { const d = e.data; if (d.type === 'progress') onProgress && onProgress(d); else if (d.type === 'done') { w.terminate(); res(d.result); } else if (d.type === 'error') { w.terminate(); rej(new Error(d.message)); } };
    w.onerror = e => { w.terminate(); rej(new Error(e.message || 'Import worker failed')); };
    w.postMessage(msg);
  });
}

// kind: 'mine' | 'model'; player: model profile id
export async function importPgnFile(file, { kind, player }, onProgress) {
  const text = await file.text();
  const existing = kind === 'mine' ? myGames() : [...C.imported.filter(g => g.kind === 'model' && g.p === player)];
  const res = await worker({ type: 'import', text, kind, player, existingIds: existing.filter(g => g.src !== 'legacy').map(g => g.id), existingKeys: existing.filter(g => g.moves && g.white).map(dupKey) }, onProgress);
  if (res.games.length) { await store.putMany('games', res.games); C.imported.push(...res.games); await rederive(onProgress); }
  return res.stats;
}
// Recompute per-family intelligence with imported games included (same code as the build).
export async function rederive(onProgress) {
  const imported = await store.all('games');
  const r = await worker({ type: 'derive', imported }, onProgress);
  for (const [f, F] of Object.entries(r.families)) F.weak = C.rep.families[f]?.weak || [];
  await store.setSetting('derived.families', r); applyDerived(r);
  return r;
}
export function applyDerived(r) { if (!r) return; for (const [f, F] of Object.entries(r.families)) C.rep.families[f] = { ...C.rep.families[f], ...F }; }

// Scans imported games of mine for my mistakes (fast Stockfish budget) and queues them for Repair.
export async function findMistakes({ limit = 20, onProgress, signal } = {}) {
  const done = new Set(await store.setting('scan.done', []));
  const todo = C.imported.filter(g => g.kind === 'mine' && g.fam && !done.has(g.id)).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, limit);
  let found = 0, k = 0;
  for (const g of todo) {
    if (signal && signal.aborted) break;
    const mv = g.moves.split(' '); const p = new Pos(); const me = g.pc;
    for (let i = 0; i < Math.min(mv.length, 50); i++) {
      if (signal && signal.aborted) break;
      const mover = p.turn ? 'b' : 'w'; const fen = p.fen(); const m = p.parseSan(mv[i]); if (!m) break;
      if (mover === me && i >= 8) {
        const r = await analyseP(fen, { budget: 'fast', priority: 'low' }); const best = r && r.lines[0];
        if (best) {
          const san = p.san(m); const bestSan = p.uciToSan(best.pv[0]);
          p.make(m); const r2 = await analyseP(p.fen(), { budget: 'fast', priority: 'low' }); p.unmake();
          const after = r2 && r2.lines[0] ? -r2.lines[0].score : null;
          if (after != null && bestSan !== san) { const q = moveQuality(best.score, after, false); if (isError(q.label)) { found++; await srs.add(srs.newItem({ id: 'move:game:' + new Pos(fen).hash(), kind: 'move', fam: g.fam, reason: `vs ${g.opp} (${g.date}): ${san} was a ${MOVE_LABEL[q.label].toLowerCase()}`, source: 'my games', payload: { fen, col: me, fam: g.fam, played: san, sfBest: bestSan, good: [bestSan], cpBest: best.score, cpPlayed: after, pvBest: [bestSan], loss: q.loss, verdict: 'mistake', games: [g.id] } })); } }
        }
      }
      p.make(m);
    }
    done.add(g.id); await store.setSetting('scan.done', [...done]); k++; onProgress && onProgress(k, todo.length, found);
  }
  return { scanned: k, found, remaining: C.imported.filter(g => g.kind === 'mine' && g.fam && !done.has(g.id)).length };
}

// ---- backups ----
export async function downloadBackup() {
  const data = await store.exportAll();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `training-room-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
// Accepts a Training Room backup, or a Drill Room progress blob ({drills, sessions, play}).
export async function restoreBackup(text) {
  const o = JSON.parse(text);
  if (o.format === 'training-room-backup') { await store.importAll(o); const d = await store.setting('derived.families', null); if (d) applyDerived(d); return { kind: 'backup' }; }
  if (o && o.drills && typeof o.drills === 'object') {
    const items = srs.fromLegacy(o, C.drillById);
    for (const it of items) { const cur = await store.get('repair', it.id); if (!cur || (cur.tries || 0) < it.tries) await store.put('repair', it); }
    await store.setSetting('legacy.sessions', o.sessions || []); await store.setSetting('legacy.play', o.play || {});
    return { kind: 'legacy', items: items.length };
  }
  throw new Error('Not a Training Room backup or Drill Room progress export');
}

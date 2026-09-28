// REPAIR — spaced repetition underneath the whole application.
// Preserves the Drill Room semantics: a success counts only on the first try without help;
// success moves an item up one box, a miss sends it back to box 0. Intervals (days):
export const BOX_DAYS = [0.007, 1, 3, 7, 16, 35]; // 10 min → 1 → 3 → 7 → 16 → 35 days
export const MASTERED_BOX = 4;
const DAY = 864e5;
import * as store from '../data/store.js';

// kind: 'move' (find the move), 'calc' (calculate a line), 'plan', 'model' (model decision)
// ref: id of the source training item (legacy drill id, calc id, decision id, plan id) or an
// inline position payload for positions created at runtime (blitz errors).
export function newItem({ id, kind, ref, fam = null, reason, source, payload = null }) {
  return { id, kind, ref: ref || id, fam, reason, source, payload, box: 0, due: Date.now(), created: Date.now(), tries: 0, ok: 0, hist: [], misses: 0, lastSeen: 0 };
}
export async function add(it) {
  const cur = await store.get('repair', it.id);
  if (cur) { cur.due = Math.min(cur.due, Date.now()); cur.box = Math.min(cur.box, 1); cur.reasons = [...new Set([...(cur.reasons || [cur.reason]), it.reason])].slice(-5); cur.misses++; await store.put('repair', cur); return cur; }
  await store.put('repair', it); return it;
}
export async function grade(id, firstTry, extra = {}) {
  const r = await store.get('repair', id); if (!r) return null;
  r.tries++; if (firstTry) r.ok++; else r.misses++;
  r.hist.push(firstTry ? 1 : 0); if (r.hist.length > 30) r.hist.shift();
  // repeated misses return sooner: two misses in a row -> short re-show inside the session window
  r.box = firstTry ? Math.min(BOX_DAYS.length - 1, r.box + 1) : 0;
  const recentMisses = r.hist.slice(-3).filter(x => !x).length;
  const days = firstTry ? BOX_DAYS[r.box] : (recentMisses >= 2 ? 0.003 : BOX_DAYS[0]);
  r.due = Date.now() + days * DAY; r.lastSeen = Date.now(); Object.assign(r, extra);
  await store.put('repair', r); return r;
}
export async function items() { return store.all('repair'); }
export async function due(now = Date.now()) { return (await items()).filter(r => r.due <= now).sort((a, b) => a.box - b.box || a.due - b.due); }
export async function stats() {
  const all = await items(); const now = Date.now();
  return { total: all.length, due: all.filter(r => r.due <= now).length, mastered: all.filter(r => r.box >= MASTERED_BOX).length,
    repeatFailures: all.filter(r => r.misses >= 2 && r.box < 2).length, learning: all.filter(r => r.box > 0 && r.box < MASTERED_BOX).length,
    next: all.filter(r => r.due > now).sort((a, b) => a.due - b.due)[0]?.due || null };
}
// Legacy Drill Room progress ({drills:{id:{box,due,tries,ok,hist}}}) -> repair items.
export function fromLegacy(S, drillById) {
  const out = [];
  for (const [id, r] of Object.entries(S.drills || {})) {
    const d = drillById.get(id); if (!d) continue;
    out.push({ ...newItem({ id: 'move:' + id, kind: 'move', ref: id, fam: d.fam, reason: 'Imported from the Drill Room', source: 'legacy' }), box: r.box | 0, due: r.due || Date.now(), tries: r.tries | 0, ok: r.ok | 0, hist: (r.hist || []).slice(-30), created: r.last || Date.now(), lastSeen: r.last || 0 });
  }
  return out;
}

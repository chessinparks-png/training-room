// Read-only access to the pre-built data in data/ plus games imported in the browser.
// Large files load lazily; nothing is re-derived at startup.
import * as store from './store.js';
import { FAMILIES, FAMILY, MODEL, MODEL_PLAYERS } from '../repertoire/families.js';

const cache = {};
async function load(name) {
  if (!cache[name]) cache[name] = fetch('data/' + name, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`Missing data/${name} — run: node tools/build-data.mjs`); return r.json(); });
  return cache[name];
}
export const C = { rep: null, training: null, mine: null, imported: [] };

export async function initCatalog() {
  const [rep, training, mine] = await Promise.all([load('repertoire.json'), load('training.json'), load('games-mine.json')]);
  C.rep = rep; C.training = training; C.mine = mine;
  C.imported = await store.all('games').catch(() => []);
  // per-family intelligence recomputed after PGN imports (same derivation as the build)
  const derived = await store.setting('derived.families', null).catch(() => null);
  if (derived) for (const [f, F] of Object.entries(derived.families)) C.rep.families[f] = { ...C.rep.families[f], ...F };
  C.drillById = new Map(training.drills.map(d => [d.id, d]));
  C.itemById = new Map([...training.decisions, ...training.plans, ...training.calc].map(x => [x.id, x]));
  return C;
}
export const modelGames = () => load('games-model.json').then(gs => gs.concat(C.imported.filter(g => g.kind === 'model')));
export const book = () => load('book.json');
export const legacy = () => load('legacy/drill-room-data.json');
export function myGames() { const byId = new Map(C.mine.map(g => [g.id, g])); for (const g of C.imported.filter(x => x.kind === 'mine')) byId.set(g.id, g); return [...byId.values()]; }

export const families = () => FAMILIES;
export const family = id => FAMILY[id];
export const famData = id => C.rep.families[id];
export const modelsFor = id => MODEL_PLAYERS.filter(m => C.rep.families[id] && C.rep.families[id].models[m.id]);
export const model = id => MODEL[id];

// Lopsided positions teach little about plans or decisions; keep training where both sides still play.
export const PLAYABLE = { decision: 400, plan: 300 };
export function decisions(fam) { return C.training.decisions.filter(d => (!fam || d.fam === fam) && (!d.sf || !d.sf[0] || Math.abs(d.sf[0].cp) < PLAYABLE.decision)); }
export function plans(fam) { return C.training.plans.filter(d => (!fam || d.fam === fam) && Math.abs(d.sfCp ?? 0) < PLAYABLE.plan); }
export function calcItems(filter = {}) { return C.training.calc.filter(c => (!filter.fam || c.fam === filter.fam) && (!filter.kind || c.kind === filter.kind) && (!filter.src || c.src === filter.src)); }
export function drills() { return C.training.drills; }
export const canty = () => load('canty.json');

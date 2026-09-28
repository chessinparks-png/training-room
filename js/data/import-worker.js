// Import worker: parse → validate → identify player/colour → classify → dedupe → derive.
// Runs off the main thread so large PGN files never freeze the interface.
import { splitGames, toGame, dupKey } from './pgn.js';
import { classifyGame } from '../repertoire/classifier.js';
import { MODEL, ME } from '../repertoire/families.js';
import { deriveFamily, FAMILY_IDS } from '../repertoire/derive.js';

const post = (type, data) => self.postMessage({ type, ...data });

function detectHandle(text) {
  const cnt = {}; const re = /^\[(White|Black)\s+"([^"]+)"\]/gm; let m; let n = 0;
  while ((m = re.exec(text)) && n < 4000) { cnt[m[2].toLowerCase()] = (cnt[m[2].toLowerCase()] || 0) + 1; n++; }
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; return top && top[1] >= n / 2 * 0.8 ? top[0] : null;
}

async function importPgn({ text, kind, player, existingIds = [], existingKeys = [] }) {
  const ids = new Set(existingIds), keys = new Set(existingKeys);
  const handle = kind === 'model' ? MODEL[player].handle : (text.toLowerCase().includes(ME.handle) ? ME.handle : detectHandle(text));
  if (!handle) throw new Error('Could not tell whose games these are (no player appears in most games).');
  const stats = { scanned: 0, added: 0, dupes: 0, invalid: 0, wrongPlayer: 0, unrelated: 0, byFam: {}, handle };
  const target = kind === 'model' ? MODEL[player].targets : null; const out = [];
  const total = (text.match(/^\[Event /gm) || []).length || 1;
  for (const raw of splitGames(text)) {
    stats.scanned++; if (stats.scanned % 200 === 0) post('progress', { done: stats.scanned, total });
    const g = toGame(raw, { player: handle });
    if (!g.pc) { stats.wrongPlayer++; continue; }
    if (!g.moves.length || (!g.ok && g.moves.length < 10)) { stats.invalid++; continue; }
    if (ids.has(g.id) || keys.has(dupKey(g))) { stats.dupes++; continue; }
    const c = classifyGame(g.moves, g.pc, { complete: true });
    if (target) { const t = target.find(x => x.color === g.pc); if (!t || !c.family || !t.families.includes(c.family)) { stats.unrelated++; continue; } }
    ids.add(g.id); keys.add(dupKey(g)); if (c.family) stats.byFam[c.family] = (stats.byFam[c.family] || 0) + 1; stats.added++;
    const res = g.result == null ? null : g.pc === 'w' ? g.result : 1 - g.result;
    const rec = { id: g.id, kind, src: 'import', pc: g.pc, opp: g.pc === 'w' ? g.black : g.white, oppElo: g.pc === 'w' ? g.be : g.we, elo: g.pc === 'w' ? g.we : g.be, date: g.date, tc: g.tc, res, term: g.term, eco: g.eco, opening: g.opening, link: g.link,
      moves: g.moves.join(' '), clocks: g.clocks, complete: true, fam: c.family, sub: c.sub || null, tags: c.tags || [], conf: c.family ? 'full' : null, why: c.reasons, t: Date.now() };
    if (kind === 'model') rec.p = player;
    out.push(rec);
  }
  post('progress', { done: stats.scanned, total: stats.scanned });
  return { games: out, stats };
}

async function derive({ imported }) {
  const [mineStatic, modelStatic] = await Promise.all([fetch('../../data/games-mine.json').then(r => r.json()), fetch('../../data/games-model.json').then(r => r.json())]);
  const byId = new Map(mineStatic.map(g => [g.id, g])); for (const g of imported.filter(x => x.kind === 'mine')) byId.set(g.id, g);
  const mine = [...byId.values()];
  const models = {}; for (const g of [...modelStatic, ...imported.filter(x => x.kind === 'model')]) (models[g.p] = models[g.p] || []).push(g);
  const families = {}; let i = 0;
  for (const f of FAMILY_IDS) { post('progress', { done: i++, total: FAMILY_IDS.length, phase: 'derive' }); families[f] = deriveFamily(f, mine, models); }
  return { families, t: Date.now() };
}

self.onmessage = async e => {
  const { type, id } = e.data;
  try {
    const r = type === 'import' ? await importPgn(e.data) : type === 'derive' ? await derive(e.data) : null;
    self.postMessage({ type: 'done', id, result: r });
  } catch (err) { self.postMessage({ type: 'error', id, message: err.message || String(err) }); }
};

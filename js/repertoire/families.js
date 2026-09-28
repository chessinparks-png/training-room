// Central repertoire configuration. Add a family here (plus a rule in classifier.js) to extend
// the system. Model-player profiles are configured the same way.

export const FAMILIES = [
  { id: 'jobava', no: '01', name: 'Jobava', full: 'Jobava London', color: 'w',
    idea: 'd4, Nc3 and Bf4 before c4 or e4 — fast queenside development, Nb5 and kingside pawn storms.',
    models: ['naroditsky'] },
  { id: 'kid', no: '02', name: "King's Indian", full: "King's Indian Defence", color: 'b',
    idea: '…Nf6, …g6, …Bg7, …d6 — the fianchetto set-up against d4 and flank openings, when White does not build e4 without c4.',
    models: ['naroditsky'] },
  { id: 'oldindian', no: '03', name: 'Old Indian', full: 'Old Indian / Black Lion (vs d4)', color: 'b',
    idea: '…Nf6, …d6, …e5 with …Nbd7 or …Be7 and no fianchetto, against d4 set-ups without an early e4.',
    models: ['firouzja'] },
  { id: 'pirc', no: '04', name: 'Pirc / Black Lion', full: 'Pirc & Black Lion (vs e4)', color: 'b',
    idea: 'Against e4 + d4 without c4: the Pirc fianchetto (…g6/…Bg7) or the Lion (…d6, …Nf6, …Nbd7, …e5).',
    models: ['firouzja'] },
];
export const FAMILY = Object.fromEntries(FAMILIES.map(f => [f.id, f]));

export const MODEL_PLAYERS = [
  { id: 'naroditsky', name: 'Daniel Naroditsky', short: 'Naroditsky', handle: 'DanielNaroditsky',
    targets: [{ color: 'w', families: ['jobava'] }, { color: 'b', families: ['kid'] }] },
  { id: 'firouzja', name: 'Alireza Firouzja', short: 'Firouzja', handle: 'Firouzja2003',
    targets: [{ color: 'b', families: ['oldindian', 'pirc'] }] },
];
export const MODEL = Object.fromEntries(MODEL_PLAYERS.map(m => [m.id, m]));

export const ME = { handle: 'localchessexpert', name: 'You' };

// Frequency language. Claims are never made from fewer than MIN_CLAIM examples.
export const FREQ = { COMMON: 0.5, RECURRING: 0.2, MIN_CLAIM: 3 };
export function freqLabel(k, n) {
  if (!n || k <= 0) return null;
  if (k === 1) return 'one-off';
  const r = k / n;
  if (k >= FREQ.MIN_CLAIM && r >= FREQ.COMMON) return 'common';
  if (k >= FREQ.MIN_CLAIM && r >= FREQ.RECURRING) return 'recurring';
  return 'occasional';
}

// Structural repertoire classifier. Classifies a game from the moves actually played —
// piece set-ups, pawn structure and transpositions — not from PGN opening names or ECO.
// ECO/opening names are preserved on the game record as supporting metadata only.
import { Pos, mFrom, mTo, mFlag, F_CASTLE, sqName, BL } from '../chess/core.js';

const WATCH = new Set(['wPd4', 'wPc4', 'wPe4', 'wNc3', 'wBf4', 'wBg5', 'wPf4', 'wPd5',
  'bPd6', 'bPd5', 'bPg6', 'bBg7', 'bNf6', 'bNd7', 'bPe5', 'bBe7', 'bPc5', 'bPc6', 'bNc6', 'bPe6', 'bPf5', 'bOO', 'wOO', 'wOOO']);
const PL = ' PNBRQK';

// Replays up to `plies` and records the first ply (1-based) at which each watched event happens.
export function setupEvents(moves, plies = 32) {
  const pos = new Pos(); const ev = {};
  for (let i = 0; i < moves.length && i < plies; i++) {
    const m = pos.parseSan(moves[i]); if (!m) break;
    const f = mFrom(m), t = mTo(m), pc = pos.b[f], side = pc & BL ? 'b' : 'w', type = PL[pc & 7];
    const fromF = sqName(f)[0], to = sqName(t);
    let key = null;
    if (mFlag(m) === F_CASTLE) key = side + ((t & 7) === 6 ? 'OO' : 'OOO');
    else if (type === 'P') { if (fromF === to[0]) key = side + 'P' + to; }      // pawn pushes only (not recaptures)
    else if (type === 'N' && to === 'd7') { if (sqName(f) === 'b8') key = 'bNd7'; } // …Nbd7 specifically
    else key = side + type + to;
    if (key && WATCH.has(key) && !(key in ev)) ev[key] = i + 1;
    pos.make(m);
  }
  return ev;
}

const within = (ev, k, ply) => ev[k] != null && ev[k] <= ply;
const bMove = n => n * 2;      // ply of Black's n-th move
const wMove = n => n * 2 - 1;  // ply of White's n-th move

// Returns { family, sub, reasons[] } or { family:null, reasons[] }.
export function classify(moves, color) {
  const ev = setupEvents(moves, 36);
  const R = [];
  if (color === 'w') {
    const d4 = ev.wPd4, nc3 = ev.wNc3, bf4 = ev.wBf4;
    if (within(ev, 'wPd4', wMove(6)) && within(ev, 'wNc3', wMove(6)) && within(ev, 'wBf4', wMove(6))) {
      const done = Math.max(d4, nc3, bf4);
      const c4Early = ev.wPc4 != null && ev.wPc4 < done, e4Early = ev.wPe4 != null && ev.wPe4 < done;
      if (!c4Early && !e4Early) {
        R.push(`White set up d4 (ply ${d4}), Nc3 (ply ${nc3}), Bf4 (ply ${bf4}) with no c4/e4 first`);
        const sub = ev.bPd5 && ev.bPd5 <= bMove(4) ? '…d5 systems' : ev.bPg6 && ev.bPg6 <= bMove(4) ? '…g6 systems' : 'other replies';
        return { family: 'jobava', sub, reasons: R };
      }
      R.push('d4/Nc3/Bf4 present but c4 or e4 came first');
    }
    return { family: null, reasons: R.length ? R : ['No Jobava set-up (d4 + Nc3 + Bf4) in the first six moves'] };
  }
  // Black: d6 systems only (…d5 first rules out KID/Old Indian/Pirc/Lion).
  const d6 = within(ev, 'bPd6', bMove(10)) && !(ev.bPd5 && ev.bPd5 < ev.bPd6);
  const nf6 = within(ev, 'bNf6', bMove(8));
  if (!d6 || !nf6) return { family: null, reasons: ['Black did not build …d6 + …Nf6 (without …d5 first)'] };
  const fian = within(ev, 'bPg6', bMove(8)) && within(ev, 'bBg7', bMove(10));
  const e4 = within(ev, 'wPe4', wMove(8)), c4 = within(ev, 'wPc4', wMove(10)), d4 = within(ev, 'wPd4', wMove(8));
  const e5 = within(ev, 'bPe5', bMove(10)), nbd7 = within(ev, 'bNd7', bMove(10)), be7 = within(ev, 'bBe7', bMove(10));
  const c5 = ev.bPc5, e6 = within(ev, 'bPe6', bMove(8));
  if (c5 != null && c5 <= bMove(3) && e4) return { family: null, reasons: ['…c5 in the first three moves against e4 — Sicilian structure, not Pirc/Lion'] };
  if (c5 != null && c5 <= bMove(8) && e6) return { family: null, reasons: ['…c5 + …e6 — Benoni structure'] };
  if (e4 && ev.bPe5 === 2 && !(within(ev, 'bNd7', bMove(10)) && ev.bPd6 < ev.bNf6)) return { family: null, reasons: ['1…e5 open game (Ruy/Italian/Petrov/Philidor order) without the Hanham …d6 + …Nbd7 set-up'] };
  const ctx = `White ${[e4 && 'e4', c4 && 'c4', d4 && 'd4'].filter(Boolean).join('+') || 'no central pawn duo'}`;
  if (fian) {
    if (e4 && !c4) {
      R.push(`…Nf6/…d6/…g6/…Bg7 vs e4 without c4 (${ctx}) → Pirc structure`);
      return { family: 'pirc', sub: 'Pirc (fianchetto)', reasons: R };
    }
    R.push(`…Nf6/…d6/…g6/…Bg7 (${ctx}) → King's Indian structure`);
    const sub = c4 && e4 ? 'Classical/Sämisch (c4+e4)' : c4 ? 'vs c4 without e4' : d4 ? 'vs d4 systems (London/Torre/Nf3)' : 'vs flank openings';
    const tags = []; if (within(ev, 'bNc6', bMove(8))) tags.push('…Nc6 set-up');
    return { family: 'kid', sub, tags, reasons: R };
  }
  if (ev.bPg6 && ev.bPg6 <= bMove(8)) return { family: null, reasons: ['…g6 without …Bg7 fianchetto'] };
  // No fianchetto: Lion / Old Indian territory requires …e5 plus …Nbd7 or …Be7.
  if (e5 && (nbd7 || be7)) {
    if (e4 && !c4) {
      if (!d4) return { family: null, reasons: ['…d6/…e5 vs e4 without d4 — not the Lion structure'] };
      R.push(`…Nf6/…d6/…e5 with ${nbd7 ? '…Nbd7' : '…Be7'}, no fianchetto, ${ctx} → Black Lion structure`);
      return { family: 'pirc', sub: 'Black Lion', tags: within(ev, 'bPc6', bMove(6)) ? ['…c6/…Qc7 (Czech-Lion) set-up'] : [], reasons: R };
    }
    if (!d4 && !c4) return { family: null, reasons: ['…d6/…e5 set-up without White d4 or c4'] };
    R.push(`…Nf6/…d6/…e5 with ${nbd7 ? '…Nbd7' : '…Be7'}, no fianchetto, ${ctx} → Old Indian structure`);
    return { family: 'oldindian', sub: c4 ? 'vs c4' : 'vs d4 without c4', tags: [nbd7 && 'Lion set-up', within(ev, 'bPc6', bMove(6)) && '…c6 set-up'].filter(Boolean), reasons: R };
  }
  return { family: null, reasons: [`…d6/…Nf6 without fianchetto or …e5 + …Nbd7/…Be7 (${ctx})`] };
}

// Legacy Drill Room families that map onto a target family when the evidence is only partial.
export const LEGACY_HINT = { 'jobava-nf6': 'jobava', 'jobava-alt': 'jobava', 'kid-d4': 'kid', flank: 'kid', pirc: 'pirc', tango: null };

// For games whose moves are known only to an early ply (the Drill Room kept opening prefixes),
// accept a family when (a) the full rules fail only because the data ends early and (b) every
// structural fact that IS known is consistent with that family. Always marked confidence:'partial'.
export function classifyGame(moves, color, { complete = true, hint = null } = {}) {
  const c = classify(moves, color);
  if (c.family) return { ...c, confidence: 'full' };
  if (complete || moves.length >= 24) return { ...c, confidence: 'full' };
  const ev = setupEvents(moves, 36); const known = `moves known to ply ${moves.length}`;
  let fam = null, why = '';
  if (color === 'w') {
    if (ev.wPd4 && ev.wNc3 && !ev.wPc4 && !ev.wPe4 && (ev.wBf4 || hint === 'jobava-nf6' || hint === 'jobava-alt')) { fam = 'jobava'; why = 'd4 + Nc3 with no c4/e4' + (ev.wBf4 ? ' + Bf4' : ''); }
  } else if (!ev.bPd5) {
    const g6 = ev.bPg6 != null, nf6 = ev.bNf6 != null, d6 = ev.bPd6 != null, e4 = ev.wPe4 != null, c4 = ev.wPc4 != null;
    const sicilian = ev.bPc5 != null && ev.bPc5 <= 6;
    if (g6 && nf6 && !(e4 && !c4) && !ev.bPe6 && !ev.bPc5) { fam = 'kid'; why = '…Nf6 + …g6' + (ev.bBg7 ? ' + …Bg7' : '') + (d6 ? ' + …d6' : '') + ', no …d5'; }
    else if (hint === 'pirc' && e4 && d6 && !c4 && !sicilian) { fam = 'pirc'; why = 'e4 vs …d6' + (nf6 ? ' + …Nf6' : '') + (ev.bNd7 ? ' + …Nbd7' : '') + (g6 ? ' + …g6' : ''); }
  }
  if (!fam) return { ...c, confidence: 'full' };
  const sub = fam === 'pirc' ? (ev.bPg6 ? 'Pirc (fianchetto)' : ev.bNd7 || ev.bPe5 ? 'Black Lion' : 'Pirc/Lion (undetermined)') : fam === 'kid' ? 'set-up (partial data)' : '…d5 systems';
  return { family: fam, sub, confidence: 'partial', reasons: [`Partial data (${known}): ${why}; nothing contradicts the ${fam} structure`] };
}

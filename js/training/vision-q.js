// Question generator for board-vision and blindfold training. Questions come from the real
// position; answers are checked against it.
import { Pos, BL, sqName, sqIdx } from '../chess/core.js';
import { openFiles, isolatedPawns, attackedPieces, pieces } from '../chess/features.js';
import { shuffle, pick } from '../ui.js';

const NAME = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const col = c => (c ? 'Black' : 'White');
export const QTYPES = { piece: 'Piece location', king: 'Kings', occupant: 'Square contents', attacked: 'Attacked pieces', file: 'Open files', isolated: 'Pawn structure', empty: 'Empty squares', next: 'Model move' };

// Each question: {type, text, answer: {squares:[...]}|{option}, options?:[...], mode:'square'|'choice'}
export function questions(fen, n = 3) {
  const p = new Pos(fen); const out = [];
  const all = [...pieces(p, 0).map(x => ({ ...x, c: 0 })), ...pieces(p, BL).map(x => ({ ...x, c: BL }))];
  const qs = all.filter(x => x.t === 5); if (qs.length) { const q = pick(qs); out.push({ type: 'piece', mode: 'square', text: `Where was the ${col(q.c)} queen?`, answer: all.filter(x => x.t === 5 && x.c === q.c).map(x => sqName(x.sq)) }); }
  const minors = all.filter(x => x.t === 2 || x.t === 3 || x.t === 4);
  if (minors.length) { const m = pick(minors); const same = all.filter(x => x.t === m.t && x.c === m.c).map(x => sqName(x.sq)); out.push({ type: 'piece', mode: 'square', text: `Click a square with a ${col(m.c)} ${NAME[m.t]}.`, answer: same }); }
  const kc = pick([0, BL]); out.push({ type: 'king', mode: 'square', text: `Where was the ${col(kc)} king?`, answer: [sqName(kc ? p.kb : p.kw)] });
  // what occupied a central-ish square
  const cand = ['c4', 'c5', 'd4', 'd5', 'e4', 'e5', 'f4', 'f5', 'd3', 'e3', 'd6', 'e6', 'c3', 'f3', 'c6', 'f6', 'g5', 'b5', 'g4', 'b4'];
  const sq = pick(cand); const occ = p.b[sqIdx(sq)];
  const label = x => (x ? `${col(x & BL)} ${NAME[x & 7]}` : 'Empty');
  const others = [...new Set(['Empty', ...shuffle(all).map(x => label(x.t | x.c))])].filter(x => x !== label(occ)).slice(0, 3);
  out.push({ type: 'occupant', mode: 'choice', text: `What occupied ${sq}?`, answer: label(occ), options: shuffle([label(occ), ...others]) });
  const side = p.turn; const att = attackedPieces(p, side ^ BL).filter(x => x.t >= 2);
  if (att.length) out.push({ type: 'attacked', mode: 'square', text: `${col(side)} is to move. Click a ${col(side ^ BL)} piece that is attacked.`, answer: att.map(x => x.sq) });
  const of = openFiles(p);
  if (of.length) { const files = 'abcdefgh'.split(''); out.push({ type: 'file', mode: 'choice', text: 'Which file was open?', answer: of.map(f => f + '-file'), options: shuffle(files).slice(0, 4).concat(of.slice(0, 1)).filter((v, i, a) => a.indexOf(v) === i).map(f => f + '-file').sort() }); }
  for (const c of [0, BL]) { const iso = isolatedPawns(p, c); if (iso.length) { out.push({ type: 'isolated', mode: 'square', text: `Click the isolated ${col(c)} pawn.`, answer: iso }); break; } }
  { const s = pick(['c4', 'd5', 'e5', 'f5', 'e4', 'd4', 'c5', 'f4']); out.push({ type: 'empty', mode: 'choice', text: `Is ${s} empty?`, answer: p.b[sqIdx(s)] ? 'No' : 'Yes', options: ['Yes', 'No'] }); }
  // prefer variety: one of each type first
  const seen = new Set(); const pickd = [];
  for (const q of shuffle(out)) { if (seen.has(q.type)) continue; seen.add(q.type); pickd.push(q); if (pickd.length >= n) break; }
  return pickd;
}
export function check(q, ans) { return Array.isArray(q.answer) ? q.answer.includes(ans) : q.answer === ans; }

// "What did the model play next?" — the real move plus three legal alternatives.
export function nextMoveQuestion(fen, modelMove, who) {
  const p = new Pos(fen); const legal = p.legal().map(m => p.san(m)).filter(s => s.replace(/[+#]/g, '') !== modelMove.replace(/[+#]/g, ''));
  const opts = shuffle([modelMove, ...shuffle(legal).slice(0, 3)]);
  return { type: 'next', mode: 'choice', text: `What did ${who} play next?`, answer: modelMove, options: opts };
}

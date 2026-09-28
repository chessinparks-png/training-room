// Shared pieces for training screens.
import { Board } from '../board/board.js';
import { Pos, mFrom, mTo } from '../chess/core.js';
import { esc } from '../ui.js';
import { FAMILY, MODEL } from '../repertoire/families.js';

export function stage(el, { label = '' } = {}) {
  el.innerHTML = `<div class="stage"><div class="board-col"><div class="board-host"></div><div class="under-board"><span class="context-line"></span><span class="label under-right"></span></div></div><div class="side"><div class="label ink stage-label">${esc(label)}</div><div class="side-body stack" style="--s:22px"></div></div></div>`;
  return { boardHost: el.querySelector('.board-host'), side: el.querySelector('.side-body'), labelEl: el.querySelector('.stage-label'), context: el.querySelector('.context-line'), underRight: el.querySelector('.under-right') };
}
export function makeBoard(host, fen, opts = {}) { const b = new Board(host, opts); b.setPosition(new Pos(fen), { animate: false }); return b; }

// Plays SAN moves on the board one by one. Returns cancel(). onStep(i, pos) after each.
export function animateLine(board, fen, sans, { delay = 900, kind = null, onStep, onDone } = {}) {
  const p = new Pos(fen); let i = 0; let t = null; let stopped = false;
  const step = () => {
    if (stopped) return; if (i >= sans.length) { onDone && onDone(); return; }
    const m = p.parseSan(sans[i]); if (!m) { onDone && onDone(); return; }
    p.make(m); board.setPosition(p, { last: [mFrom(m), mTo(m)] }); board.setArrows([]);
    onStep && onStep(i, p); i++; t = setTimeout(step, delay);
  };
  t = setTimeout(step, 250);
  return () => { stopped = true; clearTimeout(t); };
}
export function arrow(fen, san, kind) { const p = new Pos(fen); const m = p.parseSan(san); return m ? { from: mFrom(m), to: mTo(m), kind } : null; }
export function arrows(fen, list) { return list.map(([san, kind]) => san && arrow(fen, san, kind)).filter(Boolean); }
export const famName = id => (FAMILY[id] ? FAMILY[id].name : 'Other lines');
export const modelName = id => (MODEL[id] ? MODEL[id].short : '');
export const sideName = c => (c === 'w' ? 'White' : 'Black');
export const cleanSan = s => String(s || '').replace(/[+#!?]/g, '');
export const sameMove = (a, b) => cleanSan(a) === cleanSan(b);

// PGN parsing + normalization. Pure functions; shared by the Node build pipeline and the
// in-browser import worker.
import { Pos, START_FEN } from '../chess/core.js';

// Splits a PGN database into raw game strings (header block + movetext).
export function* splitGames(text) {
  const re = /\r?\n\s*\r?\n(?=\s*\[Event\s)/g;
  let last = 0, m;
  const src = text.replace(/^\uFEFF/, '');
  while ((m = re.exec(src))) { const chunk = src.slice(last, m.index).trim(); if (chunk) yield chunk; last = m.index; }
  const tail = src.slice(last).trim(); if (tail) yield tail;
}

export function parseHeaders(raw) {
  const h = {}; const re = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/gm; let m;
  while ((m = re.exec(raw))) h[m[1]] = m[2].replace(/\\"/g, '"');
  return h;
}

// Movetext -> SAN tokens (main line only; comments, variations, NAGs, clock tags removed).
// Chess.com clock comments {[%clk 0:02:58.1]} are captured into `clocks` (seconds, per ply).
export function movetextTokens(raw) {
  const body = raw.replace(/^\s*\[[^\]]*\]\s*$/gm, '');
  const sans = [], clocks = [];
  let i = 0, depth = 0; const n = body.length;
  while (i < n) {
    const c = body[i];
    if (c === '{') {
      const j = body.indexOf('}', i); const cm = body.slice(i + 1, j < 0 ? n : j);
      if (depth === 0) { const ck = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/.exec(cm); if (ck && sans.length) clocks[sans.length - 1] = +ck[1] * 3600 + +ck[2] * 60 + +ck[3]; }
      i = j < 0 ? n : j + 1; continue;
    }
    if (c === ';') { const j = body.indexOf('\n', i); i = j < 0 ? n : j + 1; continue; }
    if (c === '(') { depth++; i++; continue; }
    if (c === ')') { depth = Math.max(0, depth - 1); i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    let j = i; while (j < n && !/[\s{}();]/.test(body[j])) j++;
    const tok = body.slice(i, j); i = j;
    if (depth > 0) continue;
    if (/^\$\d+$/.test(tok)) continue;
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) continue;
    const t = tok.replace(/^\d+\.(\.\.)?/, '').replace(/^\.+/, '');
    if (!t || /^\d+\.*$/.test(t)) continue;
    sans.push(t);
  }
  return { sans, clocks };
}

// Validates/normalizes moves by replay. maxPlies limits work for classification passes.
export function normalizeMoves(sans, fen, maxPlies = Infinity) {
  const pos = new Pos(fen || START_FEN); const out = [];
  for (let i = 0; i < sans.length && i < maxPlies; i++) {
    const m = pos.parseSan(sans[i]);
    if (!m) return { moves: out, ok: false, error: `Illegal/unreadable move "${sans[i]}" at ply ${i + 1}`, pos };
    out.push(pos.san(m)); pos.make(m);
  }
  return { moves: out, ok: true, pos };
}

const RES = { '1-0': 1, '0-1': 0, '1/2-1/2': 0.5 };
export function chesscomId(h) { const m = /\/game\/(?:live|daily)\/(\d+)/.exec(h.Link || h.Site || ''); return m ? m[1] : null; }

// Normalized game record. `player` = the name we care about (a model player or me).
// Score/result are stored from White's perspective; `pc` (player colour) lets callers flip.
export function toGame(raw, { source, player, maxPlies } = {}) {
  const h = parseHeaders(raw); const { sans, clocks } = movetextTokens(raw);
  const fen = h.SetUp === '1' && h.FEN ? h.FEN : null;
  const norm = normalizeMoves(sans, fen, maxPlies);
  const lc = s => String(s || '').toLowerCase();
  let pc = null;
  if (player) { const p = lc(player); if (lc(h.White) === p) pc = 'w'; else if (lc(h.Black) === p) pc = 'b'; }
  const id = chesscomId(h) || hashString([h.White, h.Black, h.Date, h.UTCTime, sans.slice(0, 30).join(' ')].join('|'));
  return {
    id, source: source || null,
    white: h.White || '?', black: h.Black || '?', we: +h.WhiteElo || null, be: +h.BlackElo || null,
    date: (h.UTCDate || h.Date || '').replace(/\./g, '-'), tc: h.TimeControl || null,
    result: h.Result in RES ? RES[h.Result] : null, term: h.Termination || null,
    eco: h.ECO || null, opening: openingName(h), link: h.Link || null, event: h.Event || null,
    pc, fen, moves: norm.moves, clocks: clocks.length ? clocks.slice(0, norm.moves.length) : null,
    ok: norm.ok, error: norm.error || null, plyCount: sans.length,
  };
}
export function openingName(h) {
  if (h.Opening) return h.Opening + (h.Variation ? ': ' + h.Variation : '');
  if (h.ECOUrl) { const s = h.ECOUrl.split('/openings/')[1]; if (s) return decodeURIComponent(s).replace(/-/g, ' ').replace(/\.\.\./g, ' …').trim(); }
  return null;
}
// Dedupe key: same players + same moves = same game even from different exports.
export function dupKey(g) { return [g.white.toLowerCase(), g.black.toLowerCase(), g.date, g.moves.join(' ')].join('|'); }

export function hashString(s) { let h1 = 0x811c9dc5, h2 = 0x1234567; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507); } return 'h' + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36); }

export function gameToPgn(g) {
  const res = g.result === 1 ? '1-0' : g.result === 0 ? '0-1' : g.result === 0.5 ? '1/2-1/2' : '*';
  const hd = [['Event', g.event || '?'], ['Site', 'Chess.com'], ['Date', (g.date || '????.??.??').replace(/-/g, '.')], ['White', g.white], ['Black', g.black], ['Result', res]];
  if (g.we) hd.push(['WhiteElo', g.we]); if (g.be) hd.push(['BlackElo', g.be]); if (g.eco) hd.push(['ECO', g.eco]); if (g.tc) hd.push(['TimeControl', g.tc]); if (g.link) hd.push(['Link', g.link]);
  let mv = ''; g.moves.forEach((s, i) => { mv += (i % 2 === 0 ? (i / 2 + 1) + '. ' : '') + s + ' '; });
  return hd.map(([k, v]) => `[${k} "${String(v).replace(/"/g, '\\"')}"]`).join('\n') + '\n\n' + (mv + res).trim() + '\n';
}

// Chess core: 0x88 board, legal move generation, SAN, Zobrist keys, game-end status.
// Ported from the original Repertoire Drill Room (legacy/repertoire-drill-room.html) and
// extended with a fast SAN parser, draw detection and helpers. Runs in browser, worker and Node.

export const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6, BL = 8;
const NDIR = [33, 31, 18, 14, -33, -31, -18, -14], BDIR = [15, 17, -15, -17], RDIR = [1, -1, 16, -16], KDIR = [1, -1, 16, -16, 15, 17, -15, -17];
const FILES = 'abcdefgh';
export const PCH = ' pnbrqk';
export const F_EP = 1, F_CASTLE = 2, F_DOUBLE = 4;
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const sqName = s => FILES[s & 7] + ((s >> 4) + 1);
export const sqIdx = n => (n.charCodeAt(1) - 49) * 16 + (n.charCodeAt(0) - 97);
export const mFrom = m => m & 127, mTo = m => (m >> 7) & 127, mPromo = m => (m >> 14) & 7, mFlag = m => (m >> 17) & 7;
const mk = (f, t, pr, fl) => f | (t << 7) | ((pr || 0) << 14) | ((fl || 0) << 17);

// Zobrist (two 32-bit halves), deterministic seed so keys are stable across sessions.
let seed = 1234567;
function rnd() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
const ZP = new Uint32Array(16 * 128 * 2); for (let i = 0; i < ZP.length; i++) ZP[i] = rnd();
const ZC = new Uint32Array(32); for (let i = 0; i < 32; i++) ZC[i] = rnd();
const ZE = new Uint32Array(16); for (let i = 0; i < 16; i++) ZE[i] = rnd();
const ZS = [rnd(), rnd()];
const CMASK = new Uint8Array(128).fill(15);
CMASK[4] = 12; CMASK[0] = 13; CMASK[7] = 14; CMASK[116] = 3; CMASK[112] = 7; CMASK[119] = 11;

export class Pos {
  constructor(fen) { this.load(fen || START_FEN); }

  load(fen) {
    const b = this.b = new Uint8Array(128); const parts = fen.trim().split(/\s+/);
    let r = 7, f = 0; this.kw = -1; this.kb = -1;
    for (const c of parts[0]) {
      if (c === '/') { r--; f = 0; continue; }
      if (c >= '1' && c <= '8') { f += +c; continue; }
      const t = PCH.indexOf(c.toLowerCase()); if (t < 1) throw new Error('Bad FEN: ' + fen);
      const col = c === c.toLowerCase() ? BL : 0;
      b[r * 16 + f] = t | col; if (t === K) (col ? this.kb = r * 16 + f : this.kw = r * 16 + f); f++;
    }
    if (this.kw < 0 || this.kb < 0) throw new Error('FEN missing a king: ' + fen);
    this.turn = parts[1] === 'b' ? BL : 0;
    const cs = parts[2] || '-';
    this.castle = (cs.includes('K') ? 1 : 0) | (cs.includes('Q') ? 2 : 0) | (cs.includes('k') ? 4 : 0) | (cs.includes('q') ? 8 : 0);
    this.ep = parts[3] && parts[3] !== '-' ? sqIdx(parts[3]) : -1;
    this.half = +(parts[4] || 0); this.full = +(parts[5] || 1);
    this.hist = []; this.computeHash();
    return this;
  }

  clone() { const p = Object.create(Pos.prototype); p.b = this.b.slice(); p.kw = this.kw; p.kb = this.kb; p.turn = this.turn; p.castle = this.castle; p.ep = this.ep; p.half = this.half; p.full = this.full; p.h1 = this.h1; p.h2 = this.h2; p.hist = this.hist.slice(); return p; }

  computeHash() {
    let h1 = 0, h2 = 0; const b = this.b;
    for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } if (b[s]) { const i = (b[s] * 128 + s) * 2; h1 ^= ZP[i]; h2 ^= ZP[i + 1]; } }
    h1 ^= ZC[this.castle * 2]; h2 ^= ZC[this.castle * 2 + 1];
    if (this.ep >= 0) { h1 ^= ZE[(this.ep & 7) * 2]; h2 ^= ZE[(this.ep & 7) * 2 + 1]; }
    if (this.turn) { h1 ^= ZS[0]; h2 ^= ZS[1]; }
    this.h1 = h1 >>> 0; this.h2 = h2 >>> 0;
  }

  // Board part + side + castling + (capturable) ep. Used as the canonical position key.
  fen(full) {
    const b = this.b; let s = '';
    for (let r = 7; r >= 0; r--) { let e = 0; for (let f = 0; f < 8; f++) { const p = b[r * 16 + f]; if (!p) { e++; continue; } if (e) { s += e; e = 0; } const ch = PCH[p & 7]; s += p & BL ? ch : ch.toUpperCase(); } if (e) s += e; if (r) s += '/'; }
    const c = (this.castle & 1 ? 'K' : '') + (this.castle & 2 ? 'Q' : '') + (this.castle & 4 ? 'k' : '') + (this.castle & 8 ? 'q' : '');
    let ep = '-';
    if (this.ep >= 0) { const pc = this.turn ? BL | P : P, d = this.turn ? 16 : -16; for (const o of [-1, 1]) { const s2 = this.ep + d + o; if (!(s2 & 0x88) && b[s2] === pc) ep = sqName(this.ep); } }
    s += ' ' + (this.turn ? 'b' : 'w') + ' ' + (c || '-') + ' ' + ep;
    return full === false ? s : s + ' ' + this.half + ' ' + this.full;
  }
  key() { return this.fen(false); }
  hash() { return this.h1.toString(36) + '.' + this.h2.toString(36); }
  side() { return this.turn ? 'b' : 'w'; }

  attacked(sq, by) {
    const b = this.b;
    if (by === 0) { if (!((sq - 15) & 0x88) && b[sq - 15] === P) return true; if (!((sq - 17) & 0x88) && b[sq - 17] === P) return true; }
    else { if (!((sq + 15) & 0x88) && b[sq + 15] === (BL | P)) return true; if (!((sq + 17) & 0x88) && b[sq + 17] === (BL | P)) return true; }
    for (const d of NDIR) { const s = sq + d; if (!(s & 0x88) && b[s] === (by | N)) return true; }
    for (const d of KDIR) { const s = sq + d; if (!(s & 0x88) && b[s] === (by | K)) return true; }
    for (const d of BDIR) { let s = sq + d; while (!(s & 0x88)) { const p = b[s]; if (p) { if (p === (by | B) || p === (by | Q)) return true; break; } s += d; } }
    for (const d of RDIR) { let s = sq + d; while (!(s & 0x88)) { const p = b[s]; if (p) { if (p === (by | R) || p === (by | Q)) return true; break; } s += d; } }
    return false;
  }
  // All squares of `by` pieces attacking sq (0x88 indices).
  attackers(sq, by) {
    const out = []; const b = this.b;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = b[s]; if (!p || (p & BL) !== by) continue;
      if (this.pieceAttacks(s, sq)) out.push(s);
    }
    return out;
  }
  pieceAttacks(from, to) {
    const b = this.b, p = b[from], t = p & 7, d = to - from;
    if (t === P) { const up = p & BL ? -16 : 16; return d === up - 1 || d === up + 1; }
    if (t === N) return NDIR.includes(d);
    if (t === K) return KDIR.includes(d);
    const dirs = t === B ? BDIR : t === R ? RDIR : KDIR;
    for (const dd of dirs) { let s = from + dd; while (!(s & 0x88)) { if (s === to) return true; if (b[s]) break; s += dd; } }
    return false;
  }
  inCheck(side) { side = side === undefined ? this.turn : side; return this.attacked(side ? this.kb : this.kw, side ^ BL); }

  pseudo(capsOnly) {
    const b = this.b, us = this.turn, them = us ^ BL, out = [];
    const up = us ? -16 : 16, startR = us ? 6 : 1, promoR = us ? 0 : 7;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = b[s]; if (!p || (p & BL) !== us) continue; const t = p & 7;
      if (t === P) {
        const t1 = s + up;
        if (!capsOnly && !(t1 & 0x88) && !b[t1]) {
          if ((t1 >> 4) === promoR) { for (const pr of [Q, R, B, N]) out.push(mk(s, t1, pr)); }
          else { out.push(mk(s, t1)); const t2 = t1 + up; if ((s >> 4) === startR && !b[t2]) out.push(mk(s, t2, 0, F_DOUBLE)); }
        } else if (capsOnly && !(t1 & 0x88) && !b[t1] && (t1 >> 4) === promoR) out.push(mk(s, t1, Q));
        for (const o of [-1, 1]) {
          const c = t1 + o; if (c & 0x88) continue;
          if (b[c] && (b[c] & BL) === them) { if ((c >> 4) === promoR) { for (const pr of (capsOnly ? [Q] : [Q, R, B, N])) out.push(mk(s, c, pr)); } else out.push(mk(s, c)); }
          else if (c === this.ep) out.push(mk(s, c, 0, F_EP));
        }
      } else if (t === N || t === K) {
        for (const d of (t === N ? NDIR : KDIR)) { const s2 = s + d; if (s2 & 0x88) continue; const q = b[s2]; if (q ? (q & BL) === them : !capsOnly) out.push(mk(s, s2)); }
        if (t === K && !capsOnly) {
          if (us === 0 && s === 4) {
            if ((this.castle & 1) && !b[5] && !b[6] && b[7] === R && !this.attacked(4, BL) && !this.attacked(5, BL) && !this.attacked(6, BL)) out.push(mk(4, 6, 0, F_CASTLE));
            if ((this.castle & 2) && !b[3] && !b[2] && !b[1] && b[0] === R && !this.attacked(4, BL) && !this.attacked(3, BL) && !this.attacked(2, BL)) out.push(mk(4, 2, 0, F_CASTLE));
          } else if (us === BL && s === 116) {
            if ((this.castle & 4) && !b[117] && !b[118] && b[119] === (BL | R) && !this.attacked(116, 0) && !this.attacked(117, 0) && !this.attacked(118, 0)) out.push(mk(116, 118, 0, F_CASTLE));
            if ((this.castle & 8) && !b[115] && !b[114] && !b[113] && b[112] === (BL | R) && !this.attacked(116, 0) && !this.attacked(115, 0) && !this.attacked(114, 0)) out.push(mk(116, 114, 0, F_CASTLE));
          }
        }
      } else {
        const dirs = t === B ? BDIR : t === R ? RDIR : KDIR;
        for (const d of dirs) { let s2 = s + d; while (!(s2 & 0x88)) { const q = b[s2]; if (q) { if ((q & BL) === them) out.push(mk(s, s2)); break; } if (!capsOnly) out.push(mk(s, s2)); s2 += d; } }
      }
    }
    return out;
  }

  make(m) {
    const b = this.b, f = mFrom(m), t = mTo(m), pr = mPromo(m), fl = mFlag(m), p = b[f], us = this.turn;
    let cap = b[t], capSq = t;
    if (fl === F_EP) { capSq = us ? t + 16 : t - 16; cap = b[capSq]; }
    this.hist.push([m, cap, this.castle, this.ep, this.half, this.h1, this.h2]);
    if (cap) { zx(this, cap * 128 + capSq); b[capSq] = 0; }
    zx(this, p * 128 + f); b[f] = 0;
    const np = pr ? (pr | us) : p; b[t] = np; zx(this, np * 128 + t);
    if (fl === F_CASTLE) {
      let rf, rt; if (t === 6) { rf = 7; rt = 5; } else if (t === 2) { rf = 0; rt = 3; } else if (t === 118) { rf = 119; rt = 117; } else { rf = 112; rt = 115; }
      const rp = b[rf]; b[rf] = 0; b[rt] = rp; zx(this, rp * 128 + rf); zx(this, rp * 128 + rt);
    }
    if ((p & 7) === K) { if (us) this.kb = t; else this.kw = t; }
    this.h1 ^= ZC[this.castle * 2]; this.h2 ^= ZC[this.castle * 2 + 1];
    this.castle &= CMASK[f] & CMASK[t];
    this.h1 ^= ZC[this.castle * 2]; this.h2 ^= ZC[this.castle * 2 + 1];
    if (this.ep >= 0) { this.h1 ^= ZE[(this.ep & 7) * 2]; this.h2 ^= ZE[(this.ep & 7) * 2 + 1]; }
    this.ep = fl === F_DOUBLE ? (f + t) >> 1 : -1;
    if (this.ep >= 0) { this.h1 ^= ZE[(this.ep & 7) * 2]; this.h2 ^= ZE[(this.ep & 7) * 2 + 1]; }
    this.half = (cap || (p & 7) === P) ? 0 : this.half + 1;
    if (us) this.full++;
    this.turn ^= BL; this.h1 ^= ZS[0]; this.h2 ^= ZS[1]; this.h1 >>>= 0; this.h2 >>>= 0;
  }
  unmake() {
    const [m, cap, castle, ep, half, h1, h2] = this.hist.pop(); const b = this.b;
    this.turn ^= BL; const us = this.turn; if (us) this.full--;
    const f = mFrom(m), t = mTo(m), pr = mPromo(m), fl = mFlag(m);
    const p = pr ? (P | us) : b[t]; b[f] = p; b[t] = 0;
    if (fl === F_EP) b[us ? t + 16 : t - 16] = cap; else b[t] = cap;
    if (fl === F_CASTLE) { let rf, rt; if (t === 6) { rf = 7; rt = 5; } else if (t === 2) { rf = 0; rt = 3; } else if (t === 118) { rf = 119; rt = 117; } else { rf = 112; rt = 115; } b[rf] = b[rt]; b[rt] = 0; }
    if ((p & 7) === K) { if (us) this.kb = f; else this.kw = f; }
    this.castle = castle; this.ep = ep; this.half = half; this.h1 = h1; this.h2 = h2;
  }
  legal() { const out = []; for (const m of this.pseudo()) { this.make(m); if (!this.inCheck(this.turn ^ BL)) out.push(m); this.unmake(); } return out; }
  hasLegal() { for (const m of this.pseudo()) { this.make(m); const ok = !this.inCheck(this.turn ^ BL); this.unmake(); if (ok) return true; } return false; }

  san(m, legal) {
    const b = this.b, f = mFrom(m), t = mTo(m), p = b[f] & 7; let s;
    if (mFlag(m) === F_CASTLE) s = (t & 7) === 6 ? 'O-O' : 'O-O-O';
    else if (p === P) { s = (b[t] || mFlag(m) === F_EP) ? FILES[f & 7] + 'x' + sqName(t) : sqName(t); if (mPromo(m)) s += '=' + PCH[mPromo(m)].toUpperCase(); }
    else {
      legal = legal || this.legal(); let amb = false, sameF = false, sameR = false;
      for (const o of legal) { if (o !== m && mTo(o) === t && (b[mFrom(o)] & 7) === p) { amb = true; if ((mFrom(o) & 7) === (f & 7)) sameF = true; if ((mFrom(o) >> 4) === (f >> 4)) sameR = true; } }
      s = PCH[p].toUpperCase(); if (amb) s += !sameF ? FILES[f & 7] : !sameR ? ((f >> 4) + 1) : sqName(f);
      s += (b[t] ? 'x' : '') + sqName(t);
    }
    this.make(m); if (this.inCheck()) s += this.hasLegal() ? '+' : '#'; this.unmake();
    return s;
  }

  // Fast SAN parser: filters legal moves by piece/destination/disambiguation instead of
  // generating SAN for every legal move. Returns 0 when the move is not legal here.
  parseSan(san) {
    let s = String(san).trim().replace(/[+#!?]+$/g, '').replace(/[+#!?]/g, '').replace(/e\.p\.?$/, '').trim();
    if (!s) return 0;
    s = s.replace(/0/g, 'O');
    const legal = this.legal();
    if (s === 'O-O' || s === 'O-O-O') {
      const to = this.turn ? (s === 'O-O' ? 118 : 114) : (s === 'O-O' ? 6 : 2);
      return legal.find(m => mFlag(m) === F_CASTLE && mTo(m) === to) || 0;
    }
    const mt = /^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([NBRQnbrq]))?$/.exec(s);
    if (!mt) return 0;
    const piece = mt[1] ? PCH.indexOf(mt[1].toLowerCase()) : P;
    const df = mt[2] ? mt[2].charCodeAt(0) - 97 : -1, dr = mt[3] ? +mt[3] - 1 : -1;
    const to = sqIdx(mt[4]); const promo = mt[5] ? PCH.indexOf(mt[5].toLowerCase()) : 0;
    const cands = legal.filter(m => mTo(m) === to && (this.b[mFrom(m)] & 7) === piece && (df < 0 || (mFrom(m) & 7) === df) && (dr < 0 || (mFrom(m) >> 4) === dr) && (piece !== P || (mPromo(m) || 0) === (promo || (mPromo(m) ? Q : 0))));
    if (cands.length === 1) return cands[0];
    if (cands.length > 1 && piece === P) return cands.find(m => mPromo(m) === (promo || Q)) || cands[0];
    return 0;
  }
  uci(m) { return sqName(mFrom(m)) + sqName(mTo(m)) + (mPromo(m) ? PCH[mPromo(m)] : ''); }
  fromUci(u) { for (const m of this.legal()) if (this.uci(m) === u || this.uci(m) === u + 'q') return m; return 0; }
  uciToSan(u) { const m = this.fromUci(u); return m ? this.san(m) : null; }
  sanToUci(s) { const m = this.parseSan(s); return m ? this.uci(m) : null; }
  // Plays SAN if legal; returns the move or 0.
  play(san) { const m = this.parseSan(san); if (m) this.make(m); return m; }

  material() { let w = 0, bl = 0; const V = [0, 1, 3, 3, 5, 9, 0]; for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const p = this.b[s]; if (p) { if (p & BL) bl += V[p & 7]; else w += V[p & 7]; } } return w - bl; }
  isRepetition() { let n = 0; for (let i = this.hist.length - 2; i >= 0 && i >= this.hist.length - this.half; i -= 2) { const h = this.hist[i]; if (h[5] === this.h1 && h[6] === this.h2) { n++; if (n >= 1) return true; } } return false; }
  repetitions() { let n = 1; for (let i = this.hist.length - 2; i >= 0 && i >= this.hist.length - this.half; i -= 2) { const h = this.hist[i]; if (h[5] === this.h1 && h[6] === this.h2) n++; } return n; }
  insufficient() {
    const minors = []; for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const p = this.b[s]; if (!p) continue; const t = p & 7; if (t === K) continue; if (t === P || t === R || t === Q) return false; minors.push([t, ((s >> 4) + (s & 7)) & 1]); }
    if (minors.length <= 1) return true;
    return minors.every(x => x[0] === B) && minors.every(x => x[1] === minors[0][1]);
  }
  // null | {result:'1-0'|'0-1'|'1/2-1/2', reason}
  status() {
    if (!this.hasLegal()) return this.inCheck() ? { result: this.turn ? '1-0' : '0-1', reason: 'checkmate' } : { result: '1/2-1/2', reason: 'stalemate' };
    if (this.insufficient()) return { result: '1/2-1/2', reason: 'insufficient material' };
    if (this.half >= 100) return { result: '1/2-1/2', reason: 'fifty-move rule' };
    if (this.repetitions() >= 3) return { result: '1/2-1/2', reason: 'threefold repetition' };
    return null;
  }
  // 64-char board string a8..h1 (rank 8 first), '.' for empty. Handy for features.
  grid() { let s = ''; for (let r = 7; r >= 0; r--) for (let f = 0; f < 8; f++) { const p = this.b[r * 16 + f]; s += p ? (p & BL ? PCH[p & 7] : PCH[p & 7].toUpperCase()) : '.'; } return s; }
  at(name) { const p = this.b[sqIdx(name)]; return p ? (p & BL ? PCH[p & 7] : PCH[p & 7].toUpperCase()) : null; }
  lastMove() { const h = this.hist[this.hist.length - 1]; return h ? h[0] : 0; }
}
function zx(pos, i) { pos.h1 = (pos.h1 ^ ZP[i * 2]) >>> 0; pos.h2 = (pos.h2 ^ ZP[i * 2 + 1]) >>> 0; }

// Replays a SAN list from a FEN. Returns {pos, moves:[{san,uci,from,to,fen}] , ok}
export function replay(sans, fen) {
  const pos = new Pos(fen); const out = []; let ok = true;
  for (const s of sans) { const m = pos.parseSan(s); if (!m) { ok = false; break; } const san = pos.san(m); out.push({ san, uci: pos.uci(m), from: mFrom(m), to: mTo(m) }); pos.make(m); }
  return { pos, moves: out, ok };
}
export function perft(pos, d) { if (!d) return 1; let n = 0; for (const m of pos.legal()) { pos.make(m); n += perft(pos, d - 1); pos.unmake(); } return n; }

// ---------------- Quick engine (legacy fallback only) ----------------
// The small alpha-beta searcher from the Drill Room. Stockfish (js/analysis/engine.js) is the
// analytical authority; this is used only if the Stockfish worker cannot start.
export const VAL = [0, 100, 320, 330, 500, 900, 0];
const T = {
  1: [0,0,0,0,0,0,0,0,50,50,50,50,50,50,50,50,10,10,20,30,30,20,10,10,5,5,10,25,25,10,5,5,0,0,0,20,20,0,0,0,5,-5,-10,0,0,-10,-5,5,5,10,10,-20,-20,10,10,5,0,0,0,0,0,0,0,0],
  2: [-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,5,5,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50],
  3: [-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,10,10,5,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,-10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20],
  4: [0,0,0,0,0,0,0,0,5,10,10,10,10,10,10,5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,0,0,0,5,5,0,0,0],
  5: [-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5,0,0,5,5,5,5,0,-5,-10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20],
  6: [-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20],
  7: [-50,-40,-30,-20,-20,-30,-40,-50,-30,-20,-10,0,0,-10,-20,-30,-30,-10,20,30,30,20,-10,-30,-30,-10,30,40,40,30,-10,-30,-30,-10,30,40,40,30,-10,-30,-30,-10,20,30,30,20,-10,-30,-30,-30,0,0,0,0,-30,-30,-50,-30,-30,-30,-30,-30,-30,-50]
};
const pst = (t, s, black) => { const r = s >> 4, f = s & 7; const row = black ? r : 7 - r; return T[t][row * 8 + f]; };
function evaluate(pos) {
  const b = pos.b; let mg = 0, kmW = 0, kmB = 0, keW = 0, keB = 0, npm = 0, bw = 0, bb = 0;
  const pf = [new Uint8Array(8), new Uint8Array(8)];
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; } const p = b[s]; if (!p) continue; const t = p & 7, bl = p & BL;
    if (t === K) { if (bl) { kmB = pst(6, s, 1); keB = pst(7, s, 1); } else { kmW = pst(6, s, 0); keW = pst(7, s, 0); } continue; }
    const v = VAL[t] + pst(t, s, bl); mg += bl ? -v : v;
    if (t !== P) npm += VAL[t]; else pf[bl ? 1 : 0][s & 7]++;
    if (t === B) { if (bl) bb++; else bw++; }
  }
  if (bw >= 2) mg += 30; if (bb >= 2) mg -= 30;
  for (let f = 0; f < 8; f++) for (let c = 0; c < 2; c++) { const n = pf[c][f]; if (!n) continue; let pen = 0; if (n > 1) pen += 12 * (n - 1); if (!(f > 0 && pf[c][f - 1]) && !(f < 7 && pf[c][f + 1])) pen += 12 * n; mg += c ? pen : -pen; }
  const ph = Math.min(1, npm / 6200);
  const sc = mg + Math.round(ph * (kmW - kmB) + (1 - ph) * (keW - keB));
  return pos.turn ? -sc : sc;
}
export class QuickEngine {
  constructor() { this.tt = new Map(); }
  search(pos, opts = {}) {
    const maxDepth = opts.depth || 64, tlim = opts.ms || 1e9;
    const t0 = Date.now(); let nodes = 0, stop = false; const tt = this.tt; if (tt.size > 1000000) tt.clear();
    const killers = []; const hh = new Int32Array(128 * 128); const MATE = 30000;
    const order = (moves, ttm, ply) => {
      const b = pos.b; const sc = moves.map(m => {
        if (m === ttm) return 1e7; const cap = b[mTo(m)], fl = mFlag(m);
        if (cap || fl === F_EP) return 1e6 + VAL[cap & 7 || 1] * 10 - VAL[b[mFrom(m)] & 7] / 10;
        if (mPromo(m)) return 9e5; const k = killers[ply]; if (k && (k[0] === m || k[1] === m)) return 8e5;
        return hh[mFrom(m) * 128 + mTo(m)];
      });
      return moves.map((_, i) => i).sort((a, c) => sc[c] - sc[a]).map(i => moves[i]);
    };
    const qs = (alpha, beta, ply) => {
      nodes++; const stand = evaluate(pos); if (stand >= beta) return stand; if (stand > alpha) alpha = stand;
      if (ply > 40) return stand;
      for (const m of order(pos.pseudo(true), 0, 99)) {
        const cap = pos.b[mTo(m)]; if (cap && stand + VAL[cap & 7] + 200 < alpha && !mPromo(m)) continue;
        pos.make(m); if (pos.inCheck(pos.turn ^ BL)) { pos.unmake(); continue; }
        const v = -qs(-beta, -alpha, ply + 1); pos.unmake();
        if (v >= beta) return v; if (v > alpha) alpha = v;
      }
      return alpha;
    };
    const ab = (depth, alpha, beta, ply, pvNode) => {
      if ((nodes & 2047) === 0 && Date.now() - t0 > tlim) stop = true;
      if (stop) return 0;
      if (ply > 0 && (pos.half >= 100 || pos.isRepetition())) return 0;
      const inChk = pos.inCheck(); if (inChk) depth++;
      if (depth <= 0) return qs(alpha, beta, ply);
      nodes++;
      const key = pos.h1 + ':' + pos.h2; const e = tt.get(key); let ttm = 0;
      if (e) { ttm = e.m; if (e.d >= depth && ply > 0 && !pvNode) { if (e.f === 0) return e.v; if (e.f === 1 && e.v >= beta) return e.v; if (e.f === 2 && e.v <= alpha) return e.v; } }
      const moves = order(pos.pseudo(), ttm, ply); let best = -MATE - 1, bestM = 0, legalN = 0; const a0 = alpha;
      for (const m of moves) {
        pos.make(m); if (pos.inCheck(pos.turn ^ BL)) { pos.unmake(); continue; }
        legalN++; let v; const quiet = !pos.hist[pos.hist.length - 1][1] && !mPromo(m);
        if (legalN === 1) v = -ab(depth - 1, -beta, -alpha, ply + 1, pvNode);
        else {
          const r = (quiet && !inChk && depth >= 3 && legalN > 3) ? 1 + (legalN > 8 ? 1 : 0) : 0;
          v = -ab(depth - 1 - r, -alpha - 1, -alpha, ply + 1, false);
          if (v > alpha && (r || pvNode)) v = -ab(depth - 1, -beta, -alpha, ply + 1, pvNode);
        }
        pos.unmake(); if (stop) return 0;
        if (v > best) { best = v; bestM = m; }
        if (v > alpha) { alpha = v; if (v >= beta) { if (quiet) { const k = killers[ply] || (killers[ply] = [0, 0]); if (k[0] !== m) { k[1] = k[0]; k[0] = m; } hh[mFrom(m) * 128 + mTo(m)] += depth * depth; } break; } }
      }
      if (!legalN) return inChk ? -MATE + ply : 0;
      tt.set(key, { d: depth, v: best, f: best >= beta ? 1 : best <= a0 ? 2 : 0, m: bestM });
      return best;
    };
    const rootMoves = pos.legal(); if (!rootMoves.length) return { move: 0, score: pos.inCheck() ? -MATE : 0, depth: 0 };
    let result = { move: rootMoves[0], score: 0, depth: 0 };
    for (let d = 1; d <= maxDepth; d++) {
      const v = ab(d, -MATE - 1, MATE + 1, 0, true);
      if (stop && d > 1) break;
      const e = tt.get(pos.h1 + ':' + pos.h2);
      result = { move: e && rootMoves.includes(e.m) ? e.m : rootMoves[0], score: v, depth: d };
      if (Math.abs(v) > MATE - 100 || Date.now() - t0 > tlim * 0.5) break;
    }
    return result;
  }
}

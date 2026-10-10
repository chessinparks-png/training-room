// Headless check of the deployed Training Room (iPhone 13 emulation). Usage: node live.cjs <base-url-ending-in-slash>
const { chromium, devices } = require('playwright');
const base = process.argv[2];
const fails = []; const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'] }); const p = await ctx.newPage();
  const errors = [], bad = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  ctx.on('requestfailed', r => { if (!r.url().startsWith('data:')) bad.push('failed ' + r.url() + ' ' + (r.failure() || {}).errorText); });
  const T = await (await p.request.get(base + 'data/training.json')).json();
  const center = async (s, flip) => { const box = await (await p.$('.cb')).boundingBox(); const f = s.charCodeAt(0) - 97, r = +s[1] - 1; const x = flip ? 7 - f : f, y = flip ? r : 7 - r; return [box.x + (x + .5) * box.width / 8, box.y + (y + .5) * box.height / 8]; };
  const tap = async (s, flip) => { await p.waitForTimeout(80); await p.touchscreen.tap(...await center(s, flip)); await p.waitForTimeout(150); };
  const sq = (fen, san) => p.evaluate(async ([fen, san]) => { const { Pos, sqName, mFrom, mTo } = await import('./js/chess/core.js'); const q = new Pos(fen); const m = q.parseSan(san); return [sqName(mFrom(m)), sqName(mTo(m))]; }, [fen, san]);
  const hscroll = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const text = () => p.evaluate(() => document.querySelector('#main').innerText);

  await p.goto(base); await p.waitForTimeout(2500);
  ok(/Train/i.test(await text()), 'app loads at ' + base);
  const man = await p.evaluate(async () => { const m = await (await fetch(document.querySelector('link[rel=manifest]').href)).json(); return m; });
  const manUrl = await p.evaluate(() => document.querySelector('link[rel=manifest]').href);
  ok(man.display === 'standalone' && new URL(man.scope, manUrl).href === base && new URL(man.start_url, manUrl).href.startsWith(base), 'manifest standalone, scope ' + new URL(man.scope, manUrl).href);
  for (const ic of man.icons) ok((await p.request.get(new URL(ic.src, manUrl).href)).status() === 200, 'icon ' + ic.src);
  ok((await p.request.get(base + 'assets/icons/apple-touch-icon.png')).status() === 200, 'apple-touch-icon');
  const reg = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return r.scope; });
  ok(reg === base, 'service worker registered, scope ' + reg);
  let n = 0; for (let i = 0; i < 80; i++) { n = await p.evaluate(async () => { const k = (await caches.keys()).filter(x => x.startsWith('training-room-')); return k.length ? (await (await caches.open(k[k.length - 1])).keys()).length : 0; }); if (n >= 74) break; await p.waitForTimeout(500); }
  ok(n >= 74, 'precached files: ' + n);

  // sections
  for (const r of ['today', 'train', 'canty', 'blitz', 'calculate', 'repertoire', 'vision', 'progress']) {
    await p.goto(base + '#/' + r); await p.waitForTimeout(1800);
    const t = await text(); ok(t.length > 80 && !/error/i.test(t.slice(0, 200)), 'section ' + r + ': ' + t.slice(0, 40).replace(/\n/g, ' '));
    ok(await hscroll() <= 0, 'no horizontal scroll on ' + r);
  }
  // repertoire + model data
  await p.goto(base + '#/repertoire/kid'); await p.waitForTimeout(2000);
  const rt = await text(); ok(/Naroditsky/i.test(rt), 'repertoire KID shows model-player data');
  await p.goto(base + '#/repertoire/pirc'); await p.waitForTimeout(2000);
  ok(/Firouzja/i.test(await text()), 'repertoire Pirc shows Firouzja data');

  // calculation with board entry
  const own = new Set((await (await p.request.get(base + 'data/tactics.json')).json()).cards.map(c => c.own)); // owned by Tactics, not in Calculate
  const it = T.calc.find(c => c.side === 'w' && c.line.length >= 5 && !own.has(c.fen.split(' ').slice(0, 4).join(' ')));
  await p.goto(base + '#/calculate/' + encodeURIComponent(it.id)); await p.waitForTimeout(2000);
  const bw = await p.evaluate(() => Math.round(document.querySelector('.cb').getBoundingClientRect().width));
  ok(bw >= 340, 'chessboard visible, width ' + bw + ' of 390');
  await p.tap('[data-a=enter]'); await p.waitForTimeout(900); await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300); // keep the top rank clear of the sticky header
  let fen = it.fen;
  for (let i = 0; i < 3; i++) { const [a, c] = await sq(fen, it.line[i]); await tap(a); await tap(c);
    fen = await p.evaluate(async ([f, s]) => { const { Pos } = await import('./js/chess/core.js'); const x = new Pos(f); x.play(s); return x.fen(); }, [fen, it.line[i]]); }
  const chips = await p.evaluate(() => [...document.querySelectorAll('.line-entry .chips span')].map(s => s.textContent).join(' '));
  ok(chips.split(' ').length === 3, 'board move entry by tap: ' + chips + ' (expected ' + it.line.slice(0, 3).join(' ') + ')');
  await p.tap('[data-a=undo]'); await p.waitForTimeout(200);
  ok((await p.evaluate(() => document.querySelectorAll('.line-entry .chips span').length)) === 2, 'undo last move');
  await p.tap('[data-a=submit]'); await p.waitForSelector('.verdict', { timeout: 30000 }).catch(() => {});
  ok(!!(await p.$('.verdict')), 'calculation evaluated: ' + (await p.$eval('.verdict', e => e.textContent).catch(() => 'none')));
  ok(await p.evaluate(() => document.documentElement.dataset.engine) === 'stockfish', 'engine: ' + await p.evaluate(() => document.documentElement.dataset.engine));

  // theme + progress persistence
  await p.goto(base + '#/progress'); await p.waitForTimeout(1500);
  await p.tap('[data-k="theme"] [data-v="ivory"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.documentElement.dataset.theme) === 'ivory', 'light (Ivory) theme');
  await p.evaluate(async () => { const s = await import('./js/data/store.js'); await s.logAttempt({ mode: 'calc', ok: true, depth: 3, required: 3, kind: 'tactical', sec: 12, marker: 'live-test' }); });

  // offline
  await ctx.setOffline(true);
  for (const r of ['today', 'blitz', 'calculate', 'repertoire/kid', 'vision', 'progress']) { await p.goto(base + '#/' + r); await p.reload(); await p.waitForTimeout(2000); const t = await text(); ok(t.length > 80, 'offline reload ' + r + ': ' + t.slice(0, 32).replace(/\n/g, ' ')); }
  ok(await p.evaluate(() => document.documentElement.dataset.theme) === 'ivory', 'theme persisted');
  ok(await p.evaluate(async () => { const s = await import('./js/data/store.js'); return (await s.all('attempts')).some(a => a.marker === 'live-test'); }), 'progress persisted');
  const sf = await p.evaluate(async () => { const E = await import('./js/analysis/engine.js'); const x = await E.analyseP('4k3/8/8/8/8/8/4P3/R3K3 w Q - 0 1', { depth: 12, priority: 'high' }); return x && x.best + ' d' + x.depth; });
  ok(!!sf, 'Stockfish analysis offline: ' + sf);
  await p.tap('[data-k="theme"] [data-v="noir"]').catch(() => {});
  await p.goto(base + '#/progress'); await p.waitForTimeout(1500);
  await p.tap('[data-k="theme"] [data-v="noir"]').catch(() => {}); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.documentElement.dataset.theme) !== 'ivory', 'dark (Noir) theme');
  await ctx.setOffline(false);

  const onlineBad = bad.filter(x => !/^failed /.test(x) || !/ERR_INTERNET_DISCONNECTED|ERR_ABORTED/.test(x));
  const pre = (await (await p.request.get(base + 'precache.json')).json()).files;
  const missing = []; for (const f of pre) { const st = (await p.request.get(new URL(f, base).href)).status(); if (st !== 200) missing.push(st + ' ' + f); }
  ok(missing.length === 0, 'all ' + pre.length + ' app files served' + (missing.length ? ':\n  ' + missing.join('\n  ') : ''));
  ok(onlineBad.length === 0, 'no broken paths' + (onlineBad.length ? ':\n  ' + onlineBad.join('\n  ') : ''));
  ok(errors.length === 0, 'no console errors' + (errors.length ? ':\n  ' + errors.join('\n  ') : ''));
  await b.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL CHECKS PASSED'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

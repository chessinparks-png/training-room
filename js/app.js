// Boot + hash router. Views live in js/views/*; each exports mount(el, params) and may return
// an unmount function.
import { initStore, setting } from './data/store.js';
import { initCatalog } from './data/catalog.js';
import { initEngine, status as engineStatus } from './analysis/engine.js';
import { onKeys, $, esc, applyTheme } from './ui.js';
import { seedRepair } from './training/repair.js';

const ROUTES = {
  today: () => import('./views/today.js'),
  blitz: () => import('./views/blitz.js'),
  calculate: () => import('./views/calculate.js'),
  repertoire: () => import('./views/repertoire.js'),
  vision: () => import('./views/vision.js'),
  progress: () => import('./views/progress.js'),
};
let unmount = null; let token = 0;

async function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'today';
  const [name, ...params] = hash.split('/');
  const load = ROUTES[name] || ROUTES.today;
  const my = ++token;
  document.querySelectorAll('[data-nav]').forEach(a => a.toggleAttribute('aria-current', false));
  const nav = document.querySelector(`[data-nav="${ROUTES[name] ? name : 'today'}"]`); if (nav) nav.setAttribute('aria-current', 'page');
  if (unmount) { try { unmount(); } catch (e) { console.warn(e); } unmount = null; }
  onKeys(null);
  const mod = await load(); if (my !== token) return;
  const main = $('#main'); main.innerHTML = ''; const el = document.createElement('div'); el.className = 'view'; main.appendChild(el);
  try { unmount = (await mod.mount(el, params.map(decodeURIComponent))) || null; }
  catch (e) { console.error(e); el.innerHTML = `<p class="label">Something went wrong</p><p class="lede">${esc(e.message)}</p>`; }
  if (!location.hash.includes('/', 2)) window.scrollTo(0, 0);
}

async function boot() {
  const bar = document.querySelector('#boot .meter i');
  await initStore(); bar && (bar.style.width = '45%');
  await initCatalog(); bar && (bar.style.width = '80%');
  initEngine().then(mode => { document.documentElement.dataset.engine = mode; if (mode === 'fallback') console.info(engineStatus.note); });
  await seedRepair();
  applyTheme(await setting('theme', 'noir'));
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {} // ask the browser not to evict training data
  window.addEventListener('hashchange', route);
  await route();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot().catch(e => { console.error(e); $('#main').innerHTML = `<p class="label">Could not open the training room</p><p class="lede">${esc(e.message)}</p><p class="footnote">Start the local server with <b>node serve.mjs</b> in the trainer folder and open http://localhost:8765.</p>`; });

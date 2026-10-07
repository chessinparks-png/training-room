// Boot + hash router. Views live in js/views/*; each exports mount(el, params) and may return
// an unmount function.
import { initStore, setting } from './data/store.js';
import { initCatalog } from './data/catalog.js';
import { initEngine, status as engineStatus } from './analysis/engine.js';
import { onKeys, $, esc, applyTheme } from './ui.js';
import { seedRepair } from './training/repair.js';

const ROUTES = {
  today: () => import('./views/today.js'),
  canty: () => import('./views/canty.js'),
  technique: () => import('./views/technique.js'),
  courses: () => import('./views/courses.js'),
  blitz: () => import('./views/blitz.js'),
  calculate: () => import('./views/calculate.js'),
  repertoire: () => import('./views/repertoire.js'),
  vision: () => import('./views/vision.js'),
  progress: () => import('./views/progress.js'),
};
// TRAIN groups the individual trainers behind one tab with a quiet secondary selector.
const TRAIN = [['courses', 'Repertoire'], ['canty', 'Canty Repertoire'], ['technique', 'Technique'], ['blitz', 'Blitz'], ['calculate', 'Calculate'], ['vision', 'Vision']];
const IN_TRAIN = new Set([...TRAIN.map(t => t[0]), 'repertoire']);
const lastTrain = () => { try { const v = localStorage.getItem('tr.train'); return TRAIN.some(t => t[0] === v) ? v : 'canty'; } catch (e) { return 'canty'; } };
let unmount = null; let token = 0; let routeOk = false;

async function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'today';
  const [name, ...params] = hash.split('/');
  if (name === 'train') { location.replace('#/' + lastTrain()); return; }
  const load = ROUTES[name] || ROUTES.today;
  const my = ++token;
  const top = !ROUTES[name] ? 'today' : IN_TRAIN.has(name) ? 'train' : name;
  if (TRAIN.some(t => t[0] === name)) try { localStorage.setItem('tr.train', name); } catch (e) {}
  document.querySelectorAll('[data-nav]').forEach(a => a.toggleAttribute('aria-current', a.dataset.nav === top));
  if (unmount) { try { unmount(); } catch (e) { console.warn(e); } unmount = null; }
  onKeys(null);
  const main = $('#main');
  routeOk = false;
  let mod; try { mod = await withTimeout(load(), 15000, 'loading this screen'); }
  catch (e) { console.error(e); if (my === token) main.innerHTML = problem('This screen could not be loaded', e); return; }
  if (my !== token) return;
  main.innerHTML = ''; if (bootIssues.length) main.insertAdjacentHTML('beforeend', `<p class="boot-note">${esc(bootIssues.join(' · '))} <a href="#" onclick="location.reload();return false">Reload</a></p>`);
  if (top === 'train') main.insertAdjacentHTML('beforeend', `<nav class="subnav" aria-label="Trainers">${TRAIN.map(([id, label]) => `<a href="#/${id}"${id === name ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`);
  const el = document.createElement('div'); el.className = 'view'; main.appendChild(el);
  try { unmount = (await mod.mount(el, params.map(decodeURIComponent))) || null; routeOk = my === token; }
  catch (e) { console.error(e); el.innerHTML = problem('Something went wrong', e); }
  window.scrollTo(0, 0);
}
const problem = (title, e) => `<p class="label">${esc(title)}</p><p class="lede" style="margin-top:12px">${esc(e && e.message || e)}</p><div class="row" style="margin-top:20px;gap:22px"><button class="btn primary" onclick="location.reload()">Reload</button><a class="btn link" href="#/today">Train Today</a></div>`;

// Every startup stage is bounded: a stage that fails or stalls is reported, never waited on forever.
const bootIssues = [];
function withTimeout(promise, ms, what) {
  let t; return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`Timed out ${what}`)), ms); })]).finally(() => clearTimeout(t));
}
async function stage(what, fn, ms) { window.__trStage = what; try { return await withTimeout(Promise.resolve().then(fn), ms, what); } catch (e) { console.error(what, e); bootIssues.push(e.message.startsWith('Timed out') ? e.message : `${what}: ${e.message}`); return null; } }

async function boot() {
  window.__trBooting = true;
  const bar = document.querySelector('#boot .meter i');
  await stage('opening local storage', initStore, 6000); bar && (bar.style.width = '45%');
  await stage('loading training data', initCatalog, 12000); bar && (bar.style.width = '80%');
  initEngine().then(mode => { document.documentElement.dataset.engine = mode; if (mode === 'fallback') console.info(engineStatus.note); }).catch(e => console.warn('engine', e));
  await stage('preparing repair', seedRepair, 4000);
  const theme = await stage('reading settings', () => setting('theme', 'noir'), 4000); applyTheme(theme || 'noir');
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch (e) {} // ask the browser not to evict training data
  window.addEventListener('hashchange', route);
  await route();
  window.__trReady = true;
  // Grounding moment: only after a successful start, loaded on demand, never required.
  if (routeOk && !bootIssues.length) import('./grounding.js').then(m => m.show()).catch(e => console.warn('grounding skipped', e));
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot().catch(e => { console.error(e); window.__trReady = true; $('#main').innerHTML = problem('Could not open the training room', e); });

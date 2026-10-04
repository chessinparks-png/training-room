// Grounding: a nearly empty moment on launch, shown over the app once it has fully started.
// Optional by design: loaded after startup, and any failure here simply leaves Train Today open.
const PROMPTS = [
  'press your palms together for 5 seconds.',
  'feel both feet on the floor.',
  'wiggle your left big toe. now your right.',
  'notice the farthest sound you can hear.',
  'soften your shoulders.',
  'unclench your jaw.',
  'notice one thing in the room you had not noticed before.',
  'look at one object without naming it.',
  'feel the weight of your hands.',
  'take one slow breath.',
  'notice where your body touches the chair.',
  'find one small thing you are grateful is here.',
  'let your eyes rest on one point.',
  'notice three different sounds.',
  'feel the temperature of the air on your skin.',
  'take one breath before your first move.',
  'you do not need to move quickly yet.',
  'arrive before you calculate.',
];
const KEY = 'tr.ground.last';

function pickPrompt() {
  let last = -1; try { last = +localStorage.getItem(KEY); } catch (e) {}
  let i = Math.floor(Math.random() * PROMPTS.length);
  if (i === last) i = (i + 1 + Math.floor(Math.random() * (PROMPTS.length - 1))) % PROMPTS.length;
  try { localStorage.setItem(KEY, String(i)); } catch (e) {}
  return PROMPTS[i];
}

export function show() {
  const el = document.createElement('div');
  el.className = 'grounding'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Before training');
  el.innerHTML = `<p class="grounding-prompt"></p><button type="button" class="grounding-enter">Enter the room</button>`;
  el.querySelector('.grounding-prompt').textContent = pickPrompt();
  document.documentElement.classList.add('grounded');
  document.body.appendChild(el);
  const btn = el.querySelector('.grounding-enter');
  let gone = false;
  const enter = () => {
    if (gone) return; gone = true;
    const h = location.hash.replace(/^#\/?/, ''); if (h && !h.startsWith('today')) location.hash = '#/today';
    document.documentElement.classList.remove('grounded');
    el.classList.add('leaving'); setTimeout(() => el.remove(), 400);
  };
  btn.addEventListener('click', enter);
  el.addEventListener('touchmove', e => e.preventDefault(), { passive: false }); // nothing behind it should move
  requestAnimationFrame(() => { el.classList.add('in'); try { btn.focus({ preventScroll: true }); } catch (e) {} });
  return enter;
}

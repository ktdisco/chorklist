(function () {
'use strict';

// Feedback when a chore is checked off: a burst of confetti and a cheer.

const PHRASES = [
  'You slayed that!',
  'You are amazing!',
  'Amazing job!',
  'Incredible!',
  'Wow!',
  'Great job!',
  'You rock!',
  'Exceptional job!',
];

// Shown next to "Wow!".
const WOW_IMAGE = 'wow.png';

const LETTER_COLORS = ['#7b2cbf', '#e63946', '#2a9d8f', '#f77f00', '#3a86ff', '#d62887'];

const COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#8e7dbe', '#f4a261', '#457b9d', '#d62887', '#6a994e'];

let last = -1;
function pickPhrase() {
  let i;
  do { i = Math.floor(Math.random() * PHRASES.length); } while (i === last && PHRASES.length > 1);
  last = i;
  return PHRASES[i];
}

function confetti(originX, originY) {
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pieces = Array.from({ length: 120 }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
    const speed = 7 + Math.random() * 9;
    return {
      x: originX, y: originY,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      size: 6 + Math.random() * 6,
      rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      round: Math.random() < 0.3,
    };
  });

  const start = performance.now();
  const duration = 2200;
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - duration + 600) / 600);
    for (const p of pieces) {
      p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx; p.y += p.vy; p.rot += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}

// A jagged starburst, a little different every time.
function burstPath(spikes, inner, wobble) {
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
    const r = i % 2 ? inner + (Math.random() - 0.5) * wobble * 0.5 : 1 - Math.random() * wobble;
    pts.push(`${(50 + Math.cos(a) * 50 * r).toFixed(1)},${(50 + Math.sin(a) * 50 * r).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

function burstSvg() {
  const outer = burstPath(16, 0.74, 0.12);
  const inner = burstPath(16, 0.8, 0.08);
  return `
    <svg class="cheer-burst" viewBox="-4 -4 108 108" preserveAspectRatio="none" aria-hidden="true">
      <path d="${outer}" fill="#ffc300" stroke="#e85d04" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="${inner}" transform="translate(9 9) scale(.82)" fill="#fffdf5" stroke="#ffb703" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;
}

let cheerEl;
let cheerTimer;
function cheer(phrase) {
  if (cheerEl) cheerEl.remove();
  clearTimeout(cheerTimer);
  const el = document.createElement('div');
  el.className = 'cheer';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', phrase);
  el.style.setProperty('--tilt', `${(Math.random() * 10 - 5).toFixed(1)}deg`);
  el.innerHTML = burstSvg();

  const content = document.createElement('div');
  content.className = 'cheer-content';
  if (phrase === 'Wow!') {
    const img = document.createElement('img');
    img.src = WOW_IMAGE;
    img.alt = '';
    img.onerror = () => img.remove();
    content.appendChild(img);
  }
  const text = document.createElement('span');
  text.className = 'cheer-text';
  text.setAttribute('aria-hidden', 'true');
  const offset = Math.floor(Math.random() * LETTER_COLORS.length);
  let n = 0;
  for (const word of phrase.split(' ')) {
    const w = document.createElement('span');
    w.className = 'cheer-word';
    for (const ch of word) {
      const l = document.createElement('span');
      l.className = 'cheer-letter';
      l.textContent = ch;
      l.style.color = LETTER_COLORS[(n + offset) % LETTER_COLORS.length];
      l.style.setProperty('--r', `${((n % 2 ? 1 : -1) * (3 + Math.random() * 5)).toFixed(1)}deg`);
      l.style.setProperty('--y', `${((n % 2 ? 1 : -1) * Math.random() * 4).toFixed(1)}px`);
      l.style.animationDelay = `${120 + n * 35}ms`;
      w.appendChild(l);
      n++;
    }
    text.appendChild(w);
  }
  content.appendChild(text);
  el.appendChild(content);

  document.body.appendChild(el);
  cheerEl = el;
  cheerTimer = setTimeout(() => { el.remove(); if (cheerEl === el) cheerEl = null; }, 2300);
}

// from: the element that was tapped, so the confetti bursts out of it.
function celebrate(from) {
  const r = from && from.getBoundingClientRect ? from.getBoundingClientRect() : null;
  const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
  const y = r ? r.top + r.height / 2 : window.innerHeight / 2;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced) confetti(x, y);
  cheer(pickPhrase());
}

window.Celebrate = { celebrate, cheer, PHRASES };
})();

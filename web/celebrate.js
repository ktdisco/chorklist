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

// Shown next to "Wow!" if web/wow.jpg exists (add your own image there).
const WOW_IMAGE = 'wow.jpg';

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

let cheerEl;
let cheerTimer;
function cheer(phrase) {
  if (cheerEl) cheerEl.remove();
  clearTimeout(cheerTimer);
  const el = document.createElement('div');
  el.className = 'cheer';
  el.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = phrase;
  el.appendChild(text);
  if (phrase === 'Wow!') {
    const img = document.createElement('img');
    img.src = WOW_IMAGE;
    img.alt = '';
    img.onerror = () => img.remove(); // no image added: just the word
    el.prepend(img);
  }
  document.body.appendChild(el);
  cheerEl = el;
  cheerTimer = setTimeout(() => { el.remove(); if (cheerEl === el) cheerEl = null; }, 1900);
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

window.Celebrate = { celebrate, PHRASES };
})();

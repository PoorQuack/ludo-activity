// Taunts: what plays on the board when you capture someone (the 'taunt' items in the shop).
//
// Each one is a little cartoon scene, a couple of seconds long, drawn over the board: a hammer
// flattening the square, a glove waving the token all the way home, a giant L falling on their
// base... Some leave a MARK on the victim's base (dizzy stars, a clown nose, the L) that stays
// until it is their turn again. Every scene has its own sound (audio.js, 'taunt-…').
//
// All drawing is in CSS pixels of whatever canvas it is given, from a `g` (geometry) object:
//   x, y     the square where the capture happened
//   hx, hy   the middle of the victim's base
//   s        one board square
//   w, h     the canvas (scenes stay inside it)
//   color    the capturer's colour, vcolor the victim's, name the victim's name
//   px(u)    board units -> pixels (for the fireworks), null in shop previews
// `k` is 0..1 over the scene; `tm` (marks) is milliseconds since the mark appeared.
import { TAU, easeOutBack, easeOutCubic, roundRect, sparkle } from './draw-util.js';
import { t } from './i18n.js';

const INK = '#1d1430';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const seg = (k, a, b) => clamp((k - a) / (b - a), 0, 1);
const fadeOut = (k, from = 0.82) => (k > from ? 1 - (k - from) / (1 - from) : 1);
// a bounce landing: 0 -> 1 with a little hop back up at the end
const drop = (k) => (k < 0.7 ? (k / 0.7) ** 2 : 1 - Math.sin(((k - 0.7) / 0.3) * Math.PI) * 0.12);
const up = (s) => s.toLocaleUpperCase();

function ink(ctx, w) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = w;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

// Big comic lettering: thick white outline, dark ink, a colour fill. `pop` 0..1 grows it in.
export function word(ctx, text, x, y, size, fill, { rot = -0.1, pop = 1, maxW = Infinity } = {}) {
  if (pop <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const g = easeOutBack(Math.min(1, pop));
  ctx.scale(g, g);
  ctx.font = `900 ${size}px "Arial Black", "Segoe UI Black", Arial, sans-serif`;
  const w = ctx.measureText(text).width;
  if (w > maxW) ctx.scale(maxW / w, maxW / w);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.36;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(text, 0, 0);
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = INK;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// keep a scene's anchor inside the canvas, `m` pixels from every edge
const inside = (g, x, y, m) => ({ x: clamp(x, m, g.w - m), y: clamp(y, m, g.h - m) });

// ---------- the pieces ----------

function hammer(ctx, len, s) {
  // handle along +x, head across it at the far end
  roundRect(ctx, 0, -s * 0.13, len * 0.9, s * 0.26, s * 0.1);
  ctx.fillStyle = '#d99a55';
  ctx.fill();
  ink(ctx, s * 0.1);
  roundRect(ctx, len - s * 0.5, -s * 0.8, s * 1.0, s * 1.6, s * 0.28);
  ctx.fillStyle = '#ff4d5e';
  ctx.fill();
  ink(ctx, s * 0.12);
  ctx.fillStyle = '#ffd23f';
  for (const sy of [-1, 1]) {
    ctx.fillRect(len - s * 0.5, sy * s * 0.48 - s * 0.09, s * 1.0, s * 0.18);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  roundRect(ctx, len - s * 0.32, -s * 0.66, s * 0.2, s * 1.0, s * 0.1);
  ctx.fill();
}

function glove(ctx, s, cuff) {
  ctx.fillStyle = '#ffffff';
  // fingers
  for (let i = 0; i < 4; i++) {
    const fx = -s * 0.42 + i * s * 0.28;
    const len = s * (i === 0 || i === 3 ? 0.62 : 0.78);
    roundRect(ctx, fx, -s * 0.2 - len, s * 0.26, len + s * 0.3, s * 0.13);
    ctx.fill();
    ink(ctx, s * 0.08);
  }
  // thumb
  ctx.save();
  ctx.translate(-s * 0.5, s * 0.1);
  ctx.rotate(-0.9);
  roundRect(ctx, -s * 0.13, -s * 0.5, s * 0.26, s * 0.55, s * 0.13);
  ctx.fill();
  ink(ctx, s * 0.08);
  ctx.restore();
  // palm
  ctx.beginPath();
  ctx.ellipse(0, s * 0.18, s * 0.55, s * 0.48, 0, 0, TAU);
  ctx.fill();
  ink(ctx, s * 0.08);
  // cuff
  roundRect(ctx, -s * 0.48, s * 0.55, s * 0.96, s * 0.34, s * 0.12);
  ctx.fillStyle = cuff;
  ctx.fill();
  ink(ctx, s * 0.08);
}

function skull(ctx, r, jaw) {
  ctx.fillStyle = '#f6f3ea';
  ctx.beginPath();
  ctx.arc(0, -r * 0.15, r * 0.85, Math.PI * 0.88, Math.PI * 0.12);
  ctx.lineTo(r * 0.5, r * 0.5);
  ctx.lineTo(-r * 0.5, r * 0.5);
  ctx.closePath();
  ctx.fill();
  ink(ctx, r * 0.12);
  roundRect(ctx, -r * 0.42, r * 0.5 + jaw * r * 0.22, r * 0.84, r * 0.3, r * 0.1);
  ctx.fill();
  ink(ctx, r * 0.12);
  ctx.fillStyle = INK;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sx * r * 0.33, -r * 0.12, r * 0.21, r * 0.26, sx * 0.2, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(0, r * 0.14);
  ctx.lineTo(-r * 0.09, r * 0.33);
  ctx.lineTo(r * 0.09, r * 0.33);
  ctx.fill();
  // teeth
  ctx.lineWidth = r * 0.06;
  ctx.strokeStyle = INK;
  for (const tx of [-0.2, 0, 0.2]) {
    ctx.beginPath();
    ctx.moveTo(tx * r, r * 0.5 + jaw * r * 0.22);
    ctx.lineTo(tx * r, r * 0.68 + jaw * r * 0.22);
    ctx.stroke();
  }
}

function shades(ctx, s, glint = -1) {
  ctx.fillStyle = '#0e0b14';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sx * s * 0.08, -s * 0.18);
    ctx.lineTo(sx * s * 0.78, -s * 0.18);
    ctx.lineTo(sx * s * 0.7, s * 0.12);
    ctx.quadraticCurveTo(sx * s * 0.45, s * 0.3, sx * s * 0.15, s * 0.1);
    ctx.closePath();
    ctx.fill();
    ink(ctx, s * 0.06);
  }
  ctx.fillRect(-s * 0.85, -s * 0.22, s * 1.7, s * 0.1);
  if (glint >= 0 && glint <= 1) {
    ctx.save();
    ctx.beginPath();
    for (const sx of [-1, 1]) ctx.rect(sx < 0 ? -s * 0.78 : s * 0.08, -s * 0.18, s * 0.7, s * 0.45);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const gx = lerp(-s, s, glint);
    ctx.beginPath();
    ctx.moveTo(gx - s * 0.1, -s * 0.3);
    ctx.lineTo(gx + s * 0.06, -s * 0.3);
    ctx.lineTo(gx - s * 0.14, s * 0.4);
    ctx.lineTo(gx - s * 0.3, s * 0.4);
    ctx.fill();
    ctx.restore();
  }
}

function violin(ctx, s, bow) {
  ctx.save();
  ctx.rotate(-0.55);
  // neck and scroll
  roundRect(ctx, -s * 0.09, -s * 1.55, s * 0.18, s * 0.9, s * 0.05);
  ctx.fillStyle = '#3b2412';
  ctx.fill();
  ink(ctx, s * 0.06);
  ctx.beginPath();
  ctx.arc(0, -s * 1.6, s * 0.13, 0, TAU);
  ctx.fillStyle = '#8a4b1c';
  ctx.fill();
  ink(ctx, s * 0.06);
  // body: two lobes and a waist
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.38, s * 0.34, s * 0.32, 0, 0, TAU);
  ctx.ellipse(0, s * 0.22, s * 0.44, s * 0.4, 0, 0, TAU);
  ctx.fillStyle = '#c0661f';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.38, s * 0.34, s * 0.32, 0, 0, TAU);
  ink(ctx, s * 0.07);
  ctx.beginPath();
  ctx.ellipse(0, s * 0.22, s * 0.44, s * 0.4, 0, 0, TAU);
  ink(ctx, s * 0.07);
  ctx.fillStyle = '#c0661f';
  ctx.fillRect(-s * 0.26, -s * 0.2, s * 0.52, s * 0.2);
  // f-holes and strings
  ctx.lineWidth = s * 0.05;
  ctx.strokeStyle = INK;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sx * s * 0.16, -s * 0.05);
    ctx.quadraticCurveTo(sx * s * 0.24, s * 0.12, sx * s * 0.14, s * 0.3);
    ctx.stroke();
  }
  ctx.lineWidth = s * 0.015;
  ctx.strokeStyle = '#f3e6c8';
  for (const sx of [-0.06, -0.02, 0.02, 0.06]) {
    ctx.beginPath();
    ctx.moveTo(sx * s, -s * 1.5);
    ctx.lineTo(sx * s, s * 0.45);
    ctx.stroke();
  }
  ctx.restore();
  // the bow, sawing back and forth across the strings
  ctx.save();
  ctx.translate(bow * s * 0.35, -s * 0.1);
  ctx.rotate(0.35);
  ctx.lineWidth = s * 0.07;
  ctx.strokeStyle = '#5a3418';
  ctx.beginPath();
  ctx.moveTo(-s * 1.0, 0);
  ctx.lineTo(s * 1.0, 0);
  ctx.stroke();
  ctx.lineWidth = s * 0.03;
  ctx.strokeStyle = '#fffbe8';
  ctx.beginPath();
  ctx.moveTo(-s * 0.95, s * 0.08);
  ctx.lineTo(s * 0.95, s * 0.08);
  ctx.stroke();
  ctx.restore();
}

function note(ctx, s) {
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.16, s * 0.12, -0.4, 0, TAU);
  ctx.fill();
  ctx.fillRect(s * 0.1, -s * 0.5, s * 0.05, s * 0.5);
  ctx.beginPath();
  ctx.moveTo(s * 0.15, -s * 0.5);
  ctx.quadraticCurveTo(s * 0.35, -s * 0.35, s * 0.3, -s * 0.18);
  ctx.lineWidth = s * 0.05;
  ctx.strokeStyle = ctx.fillStyle;
  ctx.stroke();
}

function cloud(ctx, s, tm) {
  ctx.fillStyle = '#7e8aa3';
  ctx.beginPath();
  for (const [cx, cy, r] of [[-0.35, 0.05, 0.3], [0, -0.12, 0.38], [0.36, 0.04, 0.3], [0, 0.12, 0.32]]) {
    ctx.moveTo(cx * s + r * s, cy * s);
    ctx.arc(cx * s, cy * s, r * s, 0, TAU);
  }
  ctx.fill();
  // rain
  ctx.strokeStyle = '#7fb6ff';
  ctx.lineWidth = s * 0.06;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const ph = ((tm / 600 + i * 0.27) % 1);
    const dx = (-0.36 + i * 0.24) * s;
    const dy = s * 0.35 + ph * s * 0.7;
    ctx.globalAlpha *= 1 - ph * 0.6;
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.lineTo(dx - s * 0.04, dy + s * 0.16);
    ctx.stroke();
    ctx.globalAlpha /= 1 - ph * 0.6;
  }
}

function nose(ctx, r, squish = 1) {
  ctx.save();
  ctx.scale(1 / Math.sqrt(squish), squish);
  const gr = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  gr.addColorStop(0, '#ff9a9a');
  gr.addColorStop(0.35, '#ff2a3a');
  gr.addColorStop(1, '#a3001a');
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = gr;
  ctx.fill();
  ink(ctx, r * 0.12);
  ctx.beginPath();
  ctx.ellipse(-r * 0.35, -r * 0.42, r * 0.22, r * 0.13, -0.6, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.restore();
}

function stampMark(ctx, s, text) {
  ctx.save();
  ctx.rotate(-0.22);
  const w = s * 3.1;
  const h = s * 1.15;
  ctx.strokeStyle = '#e0313f';
  ctx.lineWidth = s * 0.14;
  roundRect(ctx, -w / 2, -h / 2, w, h, s * 0.12);
  ctx.stroke();
  ctx.lineWidth = s * 0.05;
  roundRect(ctx, -w / 2 + s * 0.16, -h / 2 + s * 0.16, w - s * 0.32, h - s * 0.32, s * 0.06);
  ctx.stroke();
  ctx.fillStyle = '#e0313f';
  ctx.font = `900 ${s * 0.52}px "Arial Black", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  const fit = Math.min(1, (w - s * 0.5) / tw);
  ctx.save();
  ctx.scale(fit, 1);
  ctx.fillText(text, 0, s * 0.03);
  ctx.restore();
  // worn ink: a few gaps where the stamp didn't take
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 14; i++) {
    const rx = Math.sin(i * 12.9898) * 0.5 * w;
    const ry = Math.sin(i * 78.233) * 0.45 * h;
    ctx.beginPath();
    ctx.arc(rx, ry, s * (0.03 + 0.04 * Math.abs(Math.sin(i * 3.1))), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function stamp(ctx, s) {
  // wooden knob and neck, and the dark rubber block
  ctx.beginPath();
  ctx.arc(0, -s * 1.55, s * 0.36, 0, TAU);
  ctx.fillStyle = '#d99a55';
  ctx.fill();
  ink(ctx, s * 0.09);
  roundRect(ctx, -s * 0.16, -s * 1.3, s * 0.32, s * 0.85, s * 0.08);
  ctx.fill();
  ink(ctx, s * 0.09);
  roundRect(ctx, -s * 1.5, -s * 0.5, s * 3.0, s * 0.55, s * 0.12);
  ctx.fillStyle = '#7a1f2b';
  ctx.fill();
  ink(ctx, s * 0.1);
  roundRect(ctx, -s * 1.4, 0, s * 2.8, s * 0.18, s * 0.06);
  ctx.fillStyle = '#e0313f';
  ctx.fill();
  ink(ctx, s * 0.07);
}

function bigL(ctx, s) {
  const shape = (dx, dy) => {
    ctx.beginPath();
    ctx.moveTo(-s * 0.9 + dx, -s * 1.6 + dy);
    ctx.lineTo(-s * 0.15 + dx, -s * 1.6 + dy);
    ctx.lineTo(-s * 0.15 + dx, s * 0.55 + dy);
    ctx.lineTo(s * 1.05 + dx, s * 0.55 + dy);
    ctx.lineTo(s * 1.05 + dx, s * 1.25 + dy);
    ctx.lineTo(-s * 0.9 + dx, s * 1.25 + dy);
    ctx.closePath();
  };
  shape(s * 0.22, s * 0.22);
  ctx.fillStyle = '#9c2a12';
  ctx.fill();
  ink(ctx, s * 0.1);
  shape(0, 0);
  const gr = ctx.createLinearGradient(0, -s * 1.6, 0, s * 1.25);
  gr.addColorStop(0, '#ffe066');
  gr.addColorStop(1, '#ff7a1a');
  ctx.fillStyle = gr;
  ctx.fill();
  ink(ctx, s * 0.12);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(-s * 0.75, -s * 1.45, s * 0.14, s * 1.6);
}

function chicken(ctx, s, squeeze) {
  const neck = 1 + squeeze * 0.6;
  // legs
  ctx.strokeStyle = '#ff9f1a';
  ctx.lineWidth = s * 0.1;
  ctx.lineCap = 'round';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sx * s * 0.25, s * 0.4);
    ctx.lineTo(sx * s * 0.42, s * 0.8);
    ctx.lineTo(sx * s * 0.62, s * 0.86);
    ctx.stroke();
  }
  // body, squashed when squeezed
  ctx.save();
  ctx.scale(1 + squeeze * 0.25, 1 - squeeze * 0.3);
  ctx.beginPath();
  ctx.ellipse(0, s * 0.1, s * 0.75, s * 0.45, 0.15, 0, TAU);
  ctx.fillStyle = '#ffd84a';
  ctx.fill();
  ink(ctx, s * 0.08);
  // wing
  ctx.beginPath();
  ctx.ellipse(s * 0.05, s * 0.12, s * 0.35, s * 0.2, -0.3, 0, TAU);
  ctx.fillStyle = '#f2bf1f';
  ctx.fill();
  ink(ctx, s * 0.06);
  ctx.restore();
  // long floppy neck
  ctx.strokeStyle = INK;
  ctx.lineWidth = s * 0.34;
  const hx = -s * 0.75;
  const hy = -s * 0.75 * neck;
  ctx.beginPath();
  ctx.moveTo(-s * 0.45, 0);
  ctx.quadraticCurveTo(-s * 0.9, -s * 0.3 * neck, hx, hy);
  ctx.stroke();
  ctx.strokeStyle = '#ffd84a';
  ctx.lineWidth = s * 0.2;
  ctx.stroke();
  // head: comb, beak (wide open when squeezed), an X for an eye
  ctx.beginPath();
  for (let i = 0; i < 3; i++) ctx.arc(hx - s * 0.12 + i * s * 0.12, hy - s * 0.25, s * 0.09, Math.PI, 0);
  ctx.fillStyle = '#ff3b3b';
  ctx.fill();
  ink(ctx, s * 0.05);
  ctx.beginPath();
  ctx.arc(hx, hy, s * 0.24, 0, TAU);
  ctx.fillStyle = '#ffd84a';
  ctx.fill();
  ink(ctx, s * 0.07);
  const open = s * (0.04 + squeeze * 0.16);
  ctx.beginPath();
  ctx.moveTo(hx - s * 0.18, hy - s * 0.02);
  ctx.lineTo(hx - s * 0.55, hy - open);
  ctx.lineTo(hx - s * 0.18, hy + s * 0.04);
  ctx.lineTo(hx - s * 0.5, hy + open + s * 0.04);
  ctx.lineTo(hx - s * 0.16, hy + s * 0.1);
  ctx.fillStyle = '#ff9f1a';
  ctx.fill();
  ink(ctx, s * 0.05);
  ctx.lineWidth = s * 0.05;
  ctx.beginPath();
  for (const d of [-1, 1]) {
    ctx.moveTo(hx - s * 0.06, hy - s * 0.08 * d - s * 0.02);
    ctx.lineTo(hx + s * 0.08, hy + s * 0.08 * d - s * 0.02);
  }
  ctx.stroke();
}

function marquee(ctx, text, s, tm, maxW) {
  ctx.font = `900 ${s * 0.62}px "Arial Black", Arial, sans-serif`;
  const tw = Math.min(ctx.measureText(text).width, maxW - s * 1.4);
  const w = tw + s * 1.2;
  const h = s * 1.4;
  roundRect(ctx, -w / 2, -h / 2, w, h, s * 0.3);
  ctx.fillStyle = '#2a1238';
  ctx.fill();
  ctx.lineWidth = s * 0.14;
  ctx.strokeStyle = '#ffc83a';
  ctx.stroke();
  // chasing bulbs round the edge
  const n = Math.max(10, Math.round((w + h) / (s * 0.35)));
  for (let i = 0; i < n; i++) {
    const p = (i / n) * 2 * (w + h);
    let bx;
    let by;
    if (p < w) (bx = -w / 2 + p), (by = -h / 2);
    else if (p < w + h) (bx = w / 2), (by = -h / 2 + (p - w));
    else if (p < 2 * w + h) (bx = w / 2 - (p - w - h)), (by = h / 2);
    else (bx = -w / 2), (by = h / 2 - (p - 2 * w - h));
    const on = (i + Math.floor(tm / 120)) % 3 === 0;
    ctx.beginPath();
    ctx.arc(bx, by, s * 0.09, 0, TAU);
    ctx.fillStyle = on ? '#fff6c2' : '#8a6a2a';
    ctx.fill();
  }
  ctx.save();
  ctx.shadowColor = '#ffcf3a';
  ctx.shadowBlur = s * 0.4;
  ctx.fillStyle = '#ffe58a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fit = Math.min(1, tw / ctx.measureText(text).width);
  ctx.scale(fit, 1);
  ctx.fillText(text, 0, s * 0.04);
  ctx.restore();
}

// ---------- the scenes ----------

export const TAUNT_FX = {
  // A squeaky hammer swings down and flattens the square. They're dizzy until their turn.
  'taunt-bonk': {
    ms: 2400,
    shake: [0.29],
    mark: 'dizzy',
    draw(ctx, k, g) {
      const s = g.s;
      const L = s * 2.6;
      const a1 = -Math.PI + 0.2;
      const P = { x: g.x - L * Math.cos(a1), y: g.y - L * Math.sin(a1) };
      const a0 = -Math.PI / 2 + 0.25;
      const a = k < 0.12 ? a0 + 0.25 * easeOutCubic(k / 0.12) : k < 0.29 ? lerp(a0 + 0.25, a1, seg(k, 0.12, 0.29) ** 2.2) : a1 + 0.3 * Math.sin(seg(k, 0.29, 0.45) * Math.PI) * (1 - seg(k, 0.29, 0.45));
      ctx.save();
      ctx.globalAlpha *= fadeOut(k) * Math.min(1, k / 0.06);
      ctx.translate(P.x, P.y);
      ctx.rotate(a);
      hammer(ctx, L, s);
      ctx.restore();
      if (k > 0.29) {
        const i = seg(k, 0.29, 0.6);
        ctx.save();
        ctx.globalAlpha *= (1 - i) * fadeOut(k);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = s * 0.12;
        ctx.lineCap = 'round';
        for (let n = 0; n < 8; n++) {
          const d = (n / 8) * TAU + 0.2;
          ctx.beginPath();
          ctx.moveTo(g.x + Math.cos(d) * s * (0.7 + i), g.y + Math.sin(d) * s * (0.7 + i));
          ctx.lineTo(g.x + Math.cos(d) * s * (1.2 + i * 1.5), g.y + Math.sin(d) * s * (1.2 + i * 1.5));
          ctx.stroke();
        }
        ctx.restore();
        const at = inside(g, g.x, g.y - s * 1.7, s * 1.6);
        ctx.save();
        ctx.globalAlpha *= fadeOut(k);
        word(ctx, up(t('Bonk!')), at.x, at.y, s * 0.95, '#ffd23f', { pop: seg(k, 0.29, 0.4), maxW: g.w - s });
        ctx.restore();
      }
    },
    mark(ctx, tm, g) {
      // three stars circling over their base
      const s = g.s;
      for (let i = 0; i < 3; i++) {
        const a = tm / 380 + (i * TAU) / 3;
        sparkle(ctx, g.hx + Math.cos(a) * s * 0.9, g.hy - s * 1.25 + Math.sin(a) * s * 0.3, s * 0.32, i % 2 ? '#ffd23f' : '#ffffff');
      }
    },
  },

  // A waving glove follows the captured token all the way back to its base.
  'taunt-bye': {
    ms: 2600,
    draw(ctx, k, g) {
      const s = g.s;
      const tr = easeOutCubic(seg(k, 0.22, 0.82));
      const hx = lerp(g.x, g.hx, tr);
      const hy = lerp(g.y - s * 1.1, g.hy - s * 1.1, tr) - Math.sin(tr * Math.PI) * s * 1.2;
      const at = inside(g, hx, hy, s * 1.2);
      ctx.save();
      ctx.globalAlpha *= fadeOut(k, 0.86);
      // puffs left behind while it travels
      if (tr > 0 && tr < 1) {
        for (let i = 1; i < 5; i++) {
          const b = Math.max(0, tr - i * 0.05);
          const px = lerp(g.x, g.hx, b);
          const py = lerp(g.y - s * 1.1, g.hy - s * 1.1, b) - Math.sin(b * Math.PI) * s * 1.2;
          ctx.beginPath();
          ctx.arc(px, py + s * 0.3, s * (0.3 - i * 0.05), 0, TAU);
          ctx.fillStyle = `rgba(255,255,255,${0.35 - i * 0.07})`;
          ctx.fill();
        }
      }
      ctx.translate(at.x, at.y);
      const grow = easeOutBack(Math.min(1, k / 0.12));
      ctx.scale(grow, grow);
      ctx.save();
      ctx.rotate(Math.sin(k * 26) * 0.45);
      glove(ctx, s * 0.9, g.color);
      ctx.restore();
      ctx.restore();
      // the speech bubble
      const bx = clamp(at.x + s * 1.6, s * 1.4, g.w - s * 1.4);
      const by = clamp(at.y - s * 1.3, s * 0.8, g.h);
      ctx.save();
      ctx.globalAlpha *= fadeOut(k, 0.86);
      word(ctx, up(t('Bye!')), bx, by, s * 0.8, '#8fd3ff', { pop: seg(k, 0.08, 0.2), rot: 0.08, maxW: g.w - s });
      ctx.restore();
    },
  },

  // A tiny violin plays the saddest tune over their base, under its own little rain cloud.
  'taunt-violin': {
    ms: 3200,
    mark: 'rain',
    draw(ctx, k, g) {
      const s = g.s;
      const at = inside(g, g.hx, g.hy - s * 0.6, s * 1.8);
      ctx.save();
      ctx.globalAlpha *= fadeOut(k, 0.85) * Math.min(1, k / 0.08);
      ctx.translate(at.x, at.y);
      const bob = Math.sin(k * 18) * s * 0.06;
      ctx.translate(0, bob);
      violin(ctx, s * 1.2, Math.sin(k * 22));
      ctx.restore();
      // notes drifting up and away
      for (let i = 0; i < 5; i++) {
        const ph = seg(k, 0.1 + i * 0.13, 0.5 + i * 0.13);
        if (ph <= 0 || ph >= 1) continue;
        ctx.save();
        ctx.globalAlpha *= 1 - ph;
        ctx.translate(at.x + s * (0.6 + Math.sin(i * 2 + ph * 4) * 0.5), at.y - s * (0.6 + ph * 2.2));
        ctx.fillStyle = i % 2 ? '#a9c8ff' : '#ffffff';
        note(ctx, s);
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha *= fadeOut(k, 0.85);
      ctx.font = `italic 700 ${s * 0.42}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = INK;
      ctx.lineWidth = s * 0.14;
      ctx.lineJoin = 'round';
      const cap = t('*sad violin noises*');
      const cy = clamp(at.y + s * 1.6, 0, g.h - s * 0.3);
      ctx.strokeText(cap, at.x, cy, g.w - s * 0.4);
      ctx.fillText(cap, at.x, cy, g.w - s * 0.4);
      ctx.restore();
    },
    mark(ctx, tm, g) {
      ctx.save();
      ctx.globalAlpha *= 0.9;
      ctx.translate(g.hx, g.hy - g.s * 1.35);
      cloud(ctx, g.s * 1.0, tm);
      ctx.restore();
    },
  },

  // Sunglasses drop onto your token, and GG EZ.
  'taunt-ggez': {
    ms: 2600,
    draw(ctx, k, g) {
      const s = g.s;
      const d = drop(seg(k, 0, 0.35));
      const at = inside(g, g.x, g.y - s * 0.55, s * 1.2);
      const y = lerp(-s, at.y, d);
      ctx.save();
      ctx.globalAlpha *= fadeOut(k);
      ctx.translate(at.x, y);
      shades(ctx, s * 1.05, k > 0.45 ? seg(k, 0.45, 0.62) : -1);
      ctx.restore();
      const wy = inside(g, g.x, g.y - s * 1.8, s * 1.5);
      ctx.save();
      ctx.globalAlpha *= fadeOut(k);
      word(ctx, 'GG EZ', wy.x, wy.y, s * 1.0, '#b8f26a', { pop: seg(k, 0.35, 0.48), maxW: g.w - s });
      if (k > 0.4) {
        for (let i = 0; i < 4; i++) {
          const a = k * 6 + (i * TAU) / 4;
          sparkle(ctx, wy.x + Math.cos(a) * s * 1.9, wy.y + Math.sin(a) * s * 0.7, s * 0.24, i % 2 ? '#ffffff' : '#ffd23f');
        }
      }
      ctx.restore();
    },
  },

  // A laughing skull bounces from the square to their base and stays there, giggling.
  'taunt-cackle': {
    ms: 3000,
    mark: 'skull',
    draw(ctx, k, g) {
      const s = g.s;
      const tr = seg(k, 0.12, 0.78);
      const hopN = 3;
      const hp = (tr * hopN) % 1;
      const along = tr < 1 ? (Math.floor(tr * hopN) + easeOutCubic(hp)) / hopN : 1;
      const x = lerp(g.x, g.hx, along);
      const y = lerp(g.y, g.hy, along) - s * 0.6 - (tr < 1 ? Math.sin(hp * Math.PI) * s * 1.3 : 0);
      const at = inside(g, x, y, s * 0.8);
      ctx.save();
      ctx.translate(at.x, at.y);
      const grow = easeOutBack(Math.min(1, k / 0.12));
      ctx.scale(grow, grow);
      ctx.rotate(Math.sin(k * 30) * 0.12);
      skull(ctx, s * 0.7, Math.abs(Math.sin(k * 45)));
      ctx.restore();
      // "HA!"s popping off each landing
      for (let i = 0; i < 4; i++) {
        const ph = seg(k, 0.12 + i * 0.2, 0.42 + i * 0.2);
        if (ph <= 0 || ph >= 1) continue;
        ctx.save();
        ctx.globalAlpha *= 1 - ph;
        const hx = lerp(g.x, g.hx, Math.min(1, i / hopN));
        const hy = lerp(g.y, g.hy, Math.min(1, i / hopN));
        const p = inside(g, hx + (i % 2 ? s : -s), hy - s * (1.4 + ph * 1.4), s);
        word(ctx, up(t('Ha!')), p.x, p.y, s * 0.6, '#c5f04a', { rot: i % 2 ? 0.2 : -0.2 });
        ctx.restore();
      }
    },
    mark(ctx, tm, g) {
      const c = (tm % 2600) / 2600;
      const jaw = c < 0.2 ? Math.abs(Math.sin(c * 60)) : 0;
      ctx.save();
      ctx.translate(g.hx, g.hy - g.s * 0.2 - (c < 0.2 ? Math.abs(Math.sin(c * 30)) * g.s * 0.15 : 0));
      skull(ctx, g.s * 0.5, jaw);
      ctx.restore();
    },
  },

  // Legendary: fireworks over the whole board, an airhorn, and their name up in lights.
  'taunt-fireworks': {
    ms: 3400,
    shake: [0.12, 0.3, 0.48],
    bursts: [
      [0.24, -3.6, -3.4],
      [0.4, 3.8, -3.8],
      [0.56, 0, -5.4],
      [0.7, -3.2, 3.6],
      [0.82, 3.4, 3.2],
    ],
    draw(ctx, k, g) {
      const s = g.s;
      // rockets streaking up to where they burst
      if (g.px) {
        for (const [bk, ux, uy] of this.bursts) {
          const r = seg(k, bk - 0.12, bk);
          if (r <= 0 || r >= 1) continue;
          const tx = g.px(ux);
          const ty = g.px(uy);
          const sy = g.h + s;
          ctx.save();
          ctx.strokeStyle = '#fff2b0';
          ctx.lineWidth = s * 0.12;
          ctx.lineCap = 'round';
          ctx.beginPath();
          const yy = lerp(sy, ty, easeOutCubic(r));
          ctx.moveTo(tx, yy + s * 1.2);
          ctx.lineTo(tx, yy);
          ctx.stroke();
          ctx.restore();
        }
      }
      const sign = inside(g, g.w / 2, g.h * 0.3, s * 2);
      ctx.save();
      ctx.globalAlpha *= fadeOut(k, 0.85);
      ctx.translate(sign.x, sign.y);
      const grow = easeOutBack(seg(k, 0.06, 0.2));
      ctx.scale(grow, grow);
      ctx.rotate(Math.sin(k * 9) * 0.03);
      marquee(ctx, t('{name} got sent home!', { name: g.name || '' }), s, k * 3400, g.w - s);
      ctx.restore();
    },
  },

  // A clown nose bounces onto their base (HONK) and stays there until their turn.
  'taunt-clown': {
    ms: 2400,
    mark: 'nose',
    draw(ctx, k, g) {
      const s = g.s;
      const at = inside(g, g.hx, g.hy, s);
      const d = drop(seg(k, 0, 0.3));
      const y = lerp(-s, at.y, d);
      const squish = k > 0.3 && k < 0.42 ? 0.7 + 0.3 * seg(k, 0.3, 0.42) : k > 0.55 && k < 0.66 ? 0.72 + 0.28 * seg(k, 0.55, 0.66) : 1;
      ctx.save();
      ctx.translate(at.x, y);
      nose(ctx, s * 0.7, squish);
      ctx.restore();
      const w1 = inside(g, at.x + s * 1.5, at.y - s * 1.4, s * 1.4);
      ctx.save();
      ctx.globalAlpha *= fadeOut(k);
      word(ctx, up(t('Honk!')), w1.x, w1.y, s * 0.75, '#ff6b81', { pop: seg(k, 0.3, 0.42), rot: 0.15 });
      if (k > 0.55) word(ctx, up(t('Honk!')), w1.x - s * 2.6, w1.y + s * 0.4, s * 0.6, '#ffd23f', { pop: seg(k, 0.55, 0.66), rot: -0.2 });
      ctx.restore();
    },
    mark(ctx, tm, g) {
      const c = (tm % 3000) / 3000;
      const squish = c < 0.08 ? 0.75 + 0.25 * (c / 0.08) : 1;
      ctx.save();
      ctx.translate(g.hx, g.hy);
      nose(ctx, g.s * 0.5, squish);
      ctx.restore();
    },
  },

  // A rubber stamp slams SKILL ISSUE across their base, and the ink stays.
  'taunt-skill': {
    ms: 2500,
    shake: [0.3],
    mark: 'stamp',
    draw(ctx, k, g) {
      const s = g.s;
      const at = inside(g, g.hx, g.hy, s * 1.7);
      if (k > 0.3) {
        ctx.save();
        ctx.globalAlpha *= Math.min(1, seg(k, 0.3, 0.34));
        ctx.translate(at.x, at.y);
        stampMark(ctx, s, up(t('Skill issue')));
        ctx.restore();
      }
      const lift = k < 0.3 ? 1 - drop(seg(k, 0.05, 0.3)) : seg(k, 0.42, 0.7);
      if (lift >= 1 && k > 0.42) return;
      ctx.save();
      ctx.globalAlpha *= Math.min(1, k / 0.05) * (1 - seg(k, 0.6, 0.7));
      ctx.translate(at.x, at.y - s * 0.1 - lift * (at.y + s * 2));
      ctx.rotate(-0.22);
      stamp(ctx, s);
      ctx.restore();
    },
    mark(ctx, tm, g) {
      ctx.save();
      ctx.globalAlpha *= 0.82;
      ctx.translate(g.hx, g.hy);
      ctx.scale(0.8, 0.8);
      stampMark(ctx, g.s, up(t('Skill issue')));
      ctx.restore();
    },
  },

  // A giant L falls on their base, with a wah-wah trombone. It stays until their turn.
  'taunt-l': {
    ms: 2400,
    shake: [0.32],
    mark: 'l',
    draw(ctx, k, g) {
      const s = g.s;
      const at = inside(g, g.hx, g.hy, s * 1.7);
      const d = drop(seg(k, 0.04, 0.32));
      const y = lerp(-s * 2, at.y, d);
      ctx.save();
      ctx.translate(at.x, y);
      const sq = k > 0.32 && k < 0.42 ? 1 - 0.18 * Math.sin(seg(k, 0.32, 0.42) * Math.PI) : 1;
      ctx.scale(1 / sq, sq);
      bigL(ctx, s * 0.95);
      ctx.restore();
      // dust puffs where it lands
      if (k > 0.32) {
        const p = seg(k, 0.32, 0.7);
        ctx.save();
        ctx.globalAlpha *= 1 - p;
        ctx.fillStyle = '#efe6d6';
        for (const sx of [-1, 1]) {
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(at.x + sx * s * (1.1 + p * 1.2 + i * 0.3), at.y + s * 1.1 - i * s * 0.15 - p * s * 0.4, s * (0.3 - i * 0.06), 0, TAU);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    },
    mark(ctx, tm, g) {
      ctx.save();
      ctx.translate(g.hx, g.hy);
      const wob = Math.sin(tm / 500) * 0.04;
      ctx.rotate(wob);
      ctx.scale(0.55, 0.55);
      bigL(ctx, g.s * 0.95);
      ctx.restore();
    },
  },

  // A rubber chicken flops onto the square and lets out the longest squeak.
  'taunt-chicken': {
    ms: 2600,
    draw(ctx, k, g) {
      const s = g.s;
      const at = inside(g, g.x, g.y - s * 0.4, s * 1.3);
      const d = drop(seg(k, 0, 0.26));
      const y = lerp(-s * 1.5, at.y, d);
      const squeeze = k > 0.34 && k < 0.78 ? Math.sin(seg(k, 0.34, 0.78) * Math.PI) : 0;
      ctx.save();
      ctx.globalAlpha *= fadeOut(k, 0.85);
      ctx.translate(at.x, y);
      ctx.rotate(Math.sin(k * 20) * 0.08 * (1 - k));
      chicken(ctx, s * 1.05, squeeze);
      ctx.restore();
      const w1 = inside(g, at.x + s * 0.4, at.y - s * 2.2, s * 1.7);
      ctx.save();
      ctx.globalAlpha *= fadeOut(k, 0.85);
      word(ctx, up(t('Squeak!')), w1.x, w1.y, s * 0.78, '#ffd84a', { pop: seg(k, 0.36, 0.48), rot: 0.12, maxW: g.w - s });
      ctx.restore();
    },
  },
};

// Which marks fade with the victim's next turn (for whoever draws them)
export const tauntHasMark = (id) => !!TAUNT_FX[id]?.mark;

// One taunt for a shop card or close-up, looping: a little scene of a token taking another's
// place, the taunt, and its mark for a moment after. `w`×`h`: the drawing area.
export function drawTauntPreview(ctx, id, w, h, now, { color = '#e8483f', vcolor = '#3b82f6', name = '' } = {}) {
  const fx = TAUNT_FX[id];
  const s = Math.min(w / 7.2, h / 4.6);
  const g = { x: w * 0.3, y: h * 0.68, hx: w * 0.72, hy: h * 0.66, s, w, h, color, vcolor, name, px: null };
  // the victim's base, and the capturer's token on the square
  ctx.save();
  roundRect(ctx, g.hx - s * 1.0, g.hy - s * 0.75, s * 2.0, s * 1.5, s * 0.3);
  ctx.fillStyle = vcolor;
  ctx.globalAlpha *= 0.35;
  ctx.fill();
  ctx.restore();
  pawn(ctx, g.x, g.y + s * 0.2, s * 0.5, color);
  if (!fx) return;
  const loop = fx.ms + (fx.mark ? 1400 : 300);
  const e = now % loop;
  if (e < fx.ms) fx.draw(ctx, e / fx.ms, g);
  else if (fx.mark) fx.mark(ctx, e - fx.ms, g);
}

function pawn(ctx, x, y, r, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-r * 0.8, r * 0.6);
  ctx.lineTo(-r * 0.35, -r * 0.4);
  ctx.lineTo(r * 0.35, -r * 0.4);
  ctx.lineTo(r * 0.8, r * 0.6);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ink(ctx, r * 0.14);
  ctx.beginPath();
  ctx.arc(0, -r * 0.65, r * 0.42, 0, TAU);
  ctx.fill();
  ink(ctx, r * 0.14);
  ctx.restore();
}

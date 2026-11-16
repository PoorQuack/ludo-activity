// Every token: the pawn and each shop shape, with their effects. (Split out of renderer.js.)
import { TAU, circle, drawStar, hexA, mix, path, polygon, roundRect, sparkle, zodiacPath } from './draw-util.js';

// ---------- tokens ----------

// Draws one 3D pawn standing on (x, y). `lift` raises it (px), `squash` < 1 flattens it on landing.
// `t` (ms): the time, for skins with a moving effect (the Legendary ones); leave it out for a
// still picture.
export function drawToken(ctx, x, y, r, hex, skin, { lift = 0, squash = 1, sign = 'red', t = null } = {}) {
  const gy = y + r * 0.2; // the pawn's base sits on the centre of its square
  const shrink = 1 - Math.min(0.45, lift / (r * 4));
  ctx.beginPath();
  ctx.ellipse(x, gy, r * 0.95 * shrink, r * 0.4 * shrink, 0, 0, TAU);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fill();

  const style = PAWN_STYLES[skin] || PAWN_STYLES['token-classic'];
  const fx = t !== null && style.fx ? TOKEN_FX[style.fx] : null;
  if (style.hover && t !== null) lift += r * style.hover * (1 + Math.sin(t / 380 + x * 0.05)); // it floats
  // each token keeps its own beat (from where it stands), so a row of them doesn't blink as one
  const time = fx ? t / 1000 + ((x * 0.37 + y * 0.91) % 7) : 0;
  ctx.save();
  ctx.translate(x, gy - lift);
  if (fx) fx(ctx, r, hex, time, 'back');
  ctx.save();
  ctx.scale(1 / squash, squash);
  const sp = pawnSprite(ctx, r, hex, skin, sign);
  if (sp) ctx.drawImage(sp.canvas, -SPRITE_L * r, -SPRITE_T * r, SPRITE_L * 2 * r, (SPRITE_T + SPRITE_B) * r);
  else paintPawn(ctx, r, hex, style, sign);
  ctx.restore();
  if (fx) fx(ctx, r, hex, time, 'front');
  ctx.restore();
}

// The Legendary tokens' effects: a few cheap shapes drawn over (and behind) the token's cached
// picture each frame. Drawn from (0, 0) at the token's foot, y up is negative.
export const TOKEN_FX = {
  // Royal: the crown and the gold catch the light, one glint after another
  glitter(ctx, r, hex, t, part) {
    if (part === 'back') {
      // a soft golden halo breathing behind the king
      const p = 0.5 + 0.5 * Math.sin(t * 1.7);
      const gr = r * (1.5 + 0.15 * p);
      ctx.globalAlpha = 0.35 + 0.25 * p;
      ctx.drawImage(glowSprite('royal-halo', [[0, 'rgba(255, 226, 130, 0.75)'], [0.5, 'rgba(255, 205, 90, 0.25)'], [1, 'rgba(255, 200, 80, 0)']]), -gr, -r * 1.25 - gr, gr * 2, gr * 2);
      ctx.globalAlpha = 1;
      return;
    }
    const spots = [[0, -2.62, 1], [-0.42, -2.2, 0.7], [0.5, -1.55, 0.75], [-0.6, -0.75, 0.8], [0.45, -0.3, 0.6]];
    spots.forEach(([sx, sy, size], i) => {
      const a = Math.max(0, Math.sin(t * 2.1 - i * 1.25)) ** 6;
      if (a < 0.03) return;
      ctx.globalAlpha = a;
      sparkle(ctx, sx * r, sy * r, r * 0.3 * size * (0.6 + 0.4 * a), '#fffbe6');
    });
    ctx.globalAlpha = 1;
  },
  // Rocket: its engine burns, flickering, and puffs of smoke roll away from it
  thrust(ctx, r, hex, t, part) {
    if (part !== 'back') return;
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.9 + i / 3) % 1;
      ctx.globalAlpha = (1 - p) * 0.4;
      ctx.fillStyle = '#e9e6f0';
      circle(ctx, (i - 1) * r * 0.5 * p + Math.sin(i * 9) * r * 0.1, r * 0.1 - p * r * 0.15, r * (0.16 + p * 0.3));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const h = r * (0.55 + 0.2 * Math.sin(t * 23) + 0.1 * Math.sin(t * 37));
    const g = ctx.createLinearGradient(0, -r * 0.4, 0, -r * 0.4 + h);
    g.addColorStop(0, '#fff7c2');
    g.addColorStop(0.4, '#ffb02e');
    g.addColorStop(1, 'rgba(255, 70, 30, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, -r * 0.4);
    ctx.quadraticCurveTo(Math.sin(t * 17) * r * 0.08, -r * 0.4 + h * 1.5, r * 0.3, -r * 0.4);
    ctx.closePath();
    ctx.fill();
  },
  // UFO: a beam of light under it, and lights chasing round its rim
  saucer(ctx, r, hex, t, part) {
    r *= 1.25;
    if (part === 'back') {
      const a = 0.28 + 0.12 * Math.sin(t * 4);
      const g = ctx.createLinearGradient(0, -r * 0.8, 0, r * 0.25);
      g.addColorStop(0, `rgba(170, 255, 230, ${a + 0.25})`);
      g.addColorStop(1, 'rgba(170, 255, 230, 0)');
      ctx.fillStyle = g;
      path(ctx, [[-r * 0.3, -r * 0.8], [r * 0.3, -r * 0.8], [r * 0.85, r * 0.25], [-r * 0.85, r * 0.25]]);
      ctx.fill();
      return;
    }
    const on = Math.floor(t * 6) % 5;
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * r * 0.36;
      circle(ctx, x, -r * 0.83 + Math.abs(i - 2) * -r * 0.04, r * 0.085);
      ctx.fillStyle = i === on ? '#fff7a8' : 'rgba(255, 255, 255, 0.35)';
      ctx.fill();
      if (i === on) {
        ctx.globalAlpha = 0.5;
        circle(ctx, x, -r * 0.83, r * 0.2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  },
  // Dragon: wings that beat behind it, and now and then a puff of flame
  wings(ctx, r, hex, t, part) {
    if (part === 'back') {
      const beat = Math.sin(t * 6) * 0.3;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * r * 0.35, -r * 1.05);
        ctx.scale(side, 1);
        ctx.rotate(-0.35 + beat);
        ctx.beginPath();
        ctx.moveTo(0, r * 0.1);
        ctx.lineTo(r * 0.4, -r * 0.75);
        ctx.lineTo(r * 1.2, -r * 0.95);
        ctx.quadraticCurveTo(r * 1.0, -r * 0.5, r * 1.12, -r * 0.15);
        ctx.quadraticCurveTo(r * 0.85, -r * 0.25, r * 0.75, r * 0.1);
        ctx.quadraticCurveTo(r * 0.5, -r * 0.1, r * 0.3, r * 0.3);
        ctx.closePath();
        ctx.fillStyle = mix(hex, '#000000', 0.28);
        ctx.fill();
        ctx.lineWidth = Math.max(1, r * 0.06);
        ctx.strokeStyle = mix(hex, '#000000', 0.55);
        ctx.stroke();
        ctx.restore();
      }
      return;
    }
    const p = (t * 0.45) % 1; // one breath every couple of seconds
    if (p < 0.3) {
      const k = p / 0.3;
      for (let i = 0; i < 4; i++) {
        const d = k * (0.5 + i * 0.22);
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.fillStyle = i % 2 ? '#ffb02e' : '#ff5a1a';
        circle(ctx, -r * (0.75 + d), -r * (1.35 - d * 0.15 + Math.sin(i * 5) * 0.08), r * (0.1 + d * 0.16));
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  },
  // Constellation: three stars circle the animal (behind it, then in front), and its plinth glows
  orbit(ctx, r, hex, t, part) {
    if (part === 'back') {
      const p = 0.5 + 0.5 * Math.sin(t * 1.4);
      const gr = r * (1.25 + 0.2 * p);
      ctx.globalAlpha = 0.45 + 0.3 * p;
      ctx.drawImage(glowSprite(`plinth-${hex}`, [[0, hexA(hex, 0.7)], [0.5, hexA(hex, 0.22)], [1, hexA(hex, 0)]]), -gr, -r * 0.2 - gr * 0.5, gr * 2, gr);
      ctx.globalAlpha = 1;
    }
    for (let i = 0; i < 3; i++) {
      const a = t * 1.3 + (i * TAU) / 3;
      const depth = Math.sin(a); // > 0: in front
      if (depth > 0 !== (part === 'front')) continue;
      const sx = Math.cos(a) * r * 1.05;
      const sy = -r * (1.15 + 0.35 * Math.sin(a * 0.5 + i)) + depth * r * 0.3;
      ctx.globalAlpha = 0.65 + 0.35 * depth;
      sparkle(ctx, sx, sy, r * (0.2 + 0.07 * depth), i === 1 ? mix(hex, '#ffffff', 0.6) : '#fff1c2');
    }
    ctx.globalAlpha = 1;
  },
};

// A soft round glow (a radial gradient), painted once and stamped: making gradients for every
// glowing particle on every frame was a large share of a frame's work on the moving boards.
export const glows = new Map();
export function glowSprite(key, stops) {
  let c = glows.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    for (const [at, col] of stops) grad.addColorStop(at, col);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glows.set(key, c);
  }
  return c;
}

// A pawn is ~15 shapes and 3-4 gradients; 24 of them redrawn every frame was most of a frame's
// work (and what made phones lag). Each look is painted once into a small picture at the
// screen's real resolution and stamped from then on: moved, lifted and squashed for free.
// Room around the pawn's base point, in pawn radii: left/right, above, below.
export const SPRITE_L = 2;
export const SPRITE_T = 3.6;
export const SPRITE_B = 1.2;
export const pawnSprites = new Map();
export const pawnCache = { on: true }; // (tests compare against painting directly)
export function pawnSprite(ctx, r, hex, skin, sign) {
  if (!pawnCache.on) return null;
  const m = ctx.getTransform();
  const scale = Math.hypot(m.a, m.b); // CSS → device pixels where it will be stamped
  const px = Math.round(r * scale * 2) / 2; // radius in device pixels (half-pixel steps)
  if (!(px > 1) || px > 200) return null; // tiny or huge: just paint it
  const key = `${skin}|${hex}|${sign}|${px}`;
  let sp = pawnSprites.get(key);
  if (!sp) {
    if (pawnSprites.size > 300) pawnSprites.clear(); // themes/skins changed a lot: start over
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(SPRITE_L * 2 * px);
    canvas.height = Math.ceil((SPRITE_T + SPRITE_B) * px);
    const g = canvas.getContext('2d');
    g.setTransform(canvas.width / (SPRITE_L * 2 * r), 0, 0, canvas.height / ((SPRITE_T + SPRITE_B) * r), SPRITE_L * r * (canvas.width / (SPRITE_L * 2 * r)), SPRITE_T * r * (canvas.height / ((SPRITE_T + SPRITE_B) * r)));
    paintPawn(g, r, hex, PAWN_STYLES[skin] || PAWN_STYLES['token-classic'], sign);
    sp = { canvas };
    pawnSprites.set(key, sp);
  }
  return sp;
}

// What each token skin changes about the pawn.
export const PAWN_STYLES = {
  'token-classic': {},
  'token-star': { star: true },
  'token-gem': { gem: true },
  'token-neon': { neon: true },
  'token-candy': { stripes: true },

  // Whole new shapes instead of the pawn
  'token-checker': { shape: 'checker' },
  'token-ghost': { shape: 'ghost' },
  'token-slime': { shape: 'slime' },
  'token-duck': { shape: 'duck' },
  'token-cat': { shape: 'cat' },
  'token-robot': { shape: 'robot' },
  'token-penguin': { shape: 'penguin' },
  'token-sakura': { shape: 'sakura' },
  // Legendary: a figure of their own, with an effect that moves (TOKEN_FX), and a way of their
  // own of going back to base when captured (TOKEN_SIGNATURES in skins.js)
  'token-crown': { shape: 'king', fx: 'glitter' },
  'token-rocket': { shape: 'rocket', fx: 'thrust' },
  'token-ufo': { shape: 'ufo', fx: 'saucer', hover: 0.16 },
  'token-dragon': { shape: 'dragon', fx: 'wings' },
  // The player's zodiac sign: a ram for red, a bull for green, a crab for blue…
  'token-constellation': { shape: 'zodiac', fx: 'orbit' },
};

// Where the colour-blind shape sits on each token shape: height above the base (in r), a
// sideways nudge, and its size — on the body, clear of eyes, windows and beaks.
export const TOKEN_MARKS = {
  pawn: { y: 0.82, x: 0, size: 1 },
  checker: { y: 0.66, x: 0, size: 1.1 },
  ghost: { y: 0.6, x: 0, size: 1 },
  slime: { y: 0.36, x: 0, size: 0.85 },
  rocket: { y: 0.78, x: 0, size: 0.85 },
  duck: { y: 0.5, x: 0.12, size: 0.95 },
  cat: { y: 0.55, x: 0, size: 0.9 },
  zodiac: { y: 0.62, x: -0.15, size: 0.75 },
  king: { y: 0.72, x: 0, size: 0.8 },
  robot: { y: 0.72, x: 0, size: 0.7 },
  penguin: { y: 0.6, x: 0, size: 0.7 },
  sakura: { y: 0.5, x: 0, size: 0.62 },
  ufo: { y: 0.95, x: 0, size: 0.6 },
  dragon: { y: 0.6, x: 0, size: 0.7 },
};

export const GOLD = '#f6cf57';
export const GOLD_DARK = '#9a6f00';

// A pawn drawn upwards from (0, 0): base disc, tapered body, collar and round head.
export function paintPawn(ctx, r, hex, style, sign) {
  if (style.shape) return TOKEN_SHAPES[style.shape](ctx, r, hex, sign);
  const body = style.neon ? '#1c1c26' : hex;
  const edge = style.neon ? hex : mix(hex, '#000000', 0.38);
  const trim = mix(body, '#ffffff', 0.22);
  ctx.lineWidth = Math.max(1, r * (style.neon ? 0.1 : 0.05));
  ctx.strokeStyle = edge;
  ctx.lineJoin = 'round';
  if (style.neon) {
    ctx.shadowColor = hex;
    ctx.shadowBlur = r * 0.7;
  }

  // Base: a short cylinder with a lighter top
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.08, r * 0.9, r * 0.34, 0, 0, Math.PI);
  ctx.lineTo(-r * 0.9, -r * 0.3);
  ctx.ellipse(0, -r * 0.3, r * 0.9, r * 0.34, 0, Math.PI, TAU);
  ctx.closePath();
  ctx.fillStyle = cylinder(ctx, r * 0.9, body);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.3, r * 0.9, r * 0.34, 0, 0, TAU);
  ctx.fillStyle = trim;
  ctx.fill();
  ctx.stroke();

  // Body
  ctx.beginPath();
  ctx.moveTo(-r * 0.68, -r * 0.32);
  ctx.quadraticCurveTo(-r * 0.56, -r * 0.95, -r * 0.27, -r * 1.3);
  ctx.lineTo(r * 0.27, -r * 1.3);
  ctx.quadraticCurveTo(r * 0.56, -r * 0.95, r * 0.68, -r * 0.32);
  ctx.ellipse(0, -r * 0.32, r * 0.68, r * 0.22, 0, 0, Math.PI);
  ctx.closePath();
  ctx.fillStyle = cylinder(ctx, r * 0.68, body);
  ctx.fill();
  if (style.stripes) {
    ctx.save();
    ctx.clip();
    ctx.rotate(-Math.PI / 5);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = -4; i <= 4; i++) ctx.fillRect(i * r * 0.36 - r * 0.08, -r * 2.5, r * 0.16, r * 3);
    ctx.restore();
  }
  ctx.stroke();

  // Collar
  ctx.beginPath();
  ctx.ellipse(0, -r * 1.3, r * 0.38, r * 0.12, 0, 0, TAU);
  ctx.fillStyle = trim;
  ctx.fill();
  ctx.stroke();

  // Head
  const hy = -r * 1.68;
  if (style.gem) {
    const outer = polygon(6, r * 0.5).map(([x, y]) => [x, y + hy]);
    const inner = polygon(6, r * 0.22).map(([x, y]) => [x - r * 0.04, y + hy - r * 0.04]);
    const g = ctx.createLinearGradient(-r * 0.5, hy - r * 0.5, r * 0.5, hy + r * 0.5);
    g.addColorStop(0, mix(hex, '#ffffff', 0.6));
    g.addColorStop(0.5, hex);
    g.addColorStop(1, mix(hex, '#000000', 0.4));
    path(ctx, outer);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    outer.forEach(([x, y], i) => {
      ctx.moveTo(x, y);
      ctx.lineTo(...inner[i]);
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.stroke();
    path(ctx, inner);
    ctx.fillStyle = mix(hex, '#ffffff', 0.45);
    ctx.fill();
  } else {
    const g = ctx.createRadialGradient(-r * 0.15, hy - r * 0.16, r * 0.04, 0, hy, r * 0.44);
    g.addColorStop(0, mix(body, '#ffffff', 0.6));
    g.addColorStop(0.55, body);
    g.addColorStop(1, mix(body, '#000000', 0.35));
    circle(ctx, 0, hy, r * 0.46);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.stroke();
  }
  if (style.neon) {
    circle(ctx, 0, hy, r * 0.2);
    ctx.fillStyle = hex;
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  if (style.star) drawStar(ctx, 0, hy, r * 0.3, '#ffffff');
}

// ---------- token shapes ----------
// Each draws upwards from (0, 0), about as tall as the pawn (2.1 r), in the player's colour.

export function outline(ctx, r, hex) {
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.strokeStyle = mix(hex, '#000000', 0.4);
  ctx.lineJoin = 'round';
}

// A cartoon eye: white, a dark pupil looking slightly forward, and a glint.
export function eye(ctx, x, y, w, h, look = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, w, h, 0, 0, TAU);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = Math.max(0.6, w * 0.18);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.stroke();
  circle(ctx, x + look * w * 0.25, y + h * 0.15, w * 0.55);
  ctx.fillStyle = '#17171f';
  ctx.fill();
  circle(ctx, x + look * w * 0.25 - w * 0.2, y - h * 0.1, w * 0.18);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

export const TOKEN_SHAPES = {
  // A cherry blossom on a stem: the base and stem in the player's colour, two leaves, and a
  // five-petal pink flower for a head (each petal with the little notch at its tip)
  sakura(ctx, r, hex) {
    outline(ctx, r, hex);
    const dark = mix(hex, '#000000', 0.4);
    // base
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.12, r * 0.72, r * 0.26, 0, 0, TAU);
    ctx.fillStyle = cylinder(ctx, r * 0.72, hex);
    ctx.fill();
    ctx.stroke();
    // stem, narrowing as it rises
    path(ctx, [[-r * 0.36, -r * 0.2], [-r * 0.14, -r * 1.0], [r * 0.14, -r * 1.0], [r * 0.36, -r * 0.2]]);
    ctx.fillStyle = cylinder(ctx, r * 0.36, hex);
    ctx.fill();
    ctx.stroke();
    // two leaves under the flower
    for (const sx of [-1, 1]) {
      ctx.save();
      ctx.translate(sx * r * 0.12, -r * 0.98);
      ctx.rotate(sx * 0.9);
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.28, r * 0.13, r * 0.3, 0, 0, TAU);
      ctx.fillStyle = '#6cc46a';
      ctx.fill();
      ctx.strokeStyle = '#2f7a34';
      ctx.stroke();
      ctx.restore();
    }
    // the flower, tipped a little towards you
    ctx.save();
    ctx.translate(0, -r * 1.48);
    ctx.scale(1, 0.9);
    const R = r * 0.66;
    const g = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
    g.addColorStop(0, '#fff3f7');
    g.addColorStop(0.55, '#ffc7da');
    g.addColorStop(1, '#ff8fb6');
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.rotate((i * TAU) / 5);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-R * 0.52, -R * 0.22, -R * 0.56, -R * 0.86, -R * 0.16, -R);
      ctx.lineTo(0, -R * 0.84);
      ctx.lineTo(R * 0.16, -R);
      ctx.bezierCurveTo(R * 0.56, -R * 0.86, R * 0.52, -R * 0.22, 0, 0);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.045);
      ctx.strokeStyle = '#d0628f';
      ctx.stroke();
      ctx.restore();
    }
    // the middle: deep pink, ringed with yellow stamens
    circle(ctx, 0, 0, R * 0.24);
    ctx.fillStyle = '#e2457a';
    ctx.fill();
    for (let i = 0; i < 7; i++) {
      const a = (i * TAU) / 7 + 0.3;
      circle(ctx, Math.cos(a) * R * 0.34, Math.sin(a) * R * 0.34, R * 0.07);
      ctx.fillStyle = '#ffd23f';
      ctx.fill();
    }
    ctx.restore();
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.strokeStyle = dark;
  },
  // A little robot on tracks: a body in the player's colour, a visor with two bright eyes
  robot(ctx, r, hex) {
    outline(ctx, r, hex);
    const steel = '#dfe6f0';
    roundRect(ctx, -r * 0.78, -r * 0.34, r * 1.56, r * 0.42, r * 0.2);
    ctx.fillStyle = '#4a5466';
    ctx.fill();
    ctx.stroke();
    for (const sx of [-1, 1]) {
      roundRect(ctx, sx * r * 0.62 - r * 0.13, -r * 1.05, r * 0.26, r * 0.6, r * 0.1);
      ctx.fillStyle = steel;
      ctx.fill();
      ctx.stroke();
    }
    roundRect(ctx, -r * 0.56, -r * 1.2, r * 1.12, r * 0.92, r * 0.16);
    ctx.fillStyle = cylinder(ctx, r * 0.56, hex);
    ctx.fill();
    ctx.stroke();
    roundRect(ctx, -r * 0.3, -r * 0.95, r * 0.6, r * 0.4, r * 0.06);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
    for (const [x, c] of [[-0.14, '#ff5a5a'], [0.02, '#ffd23f'], [0.18, '#3fd08a']]) {
      circle(ctx, x * r, -r * 0.75, r * 0.06);
      ctx.fillStyle = c;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.9);
    ctx.lineTo(0, -r * 2.2);
    ctx.stroke();
    circle(ctx, 0, -r * 2.25, r * 0.1);
    ctx.fillStyle = hex;
    ctx.fill();
    ctx.stroke();
    roundRect(ctx, -r * 0.5, -r * 1.95, r, r * 0.7, r * 0.18);
    ctx.fillStyle = steel;
    ctx.fill();
    ctx.stroke();
    roundRect(ctx, -r * 0.38, -r * 1.76, r * 0.76, r * 0.3, r * 0.12);
    ctx.fillStyle = '#1b2233';
    ctx.fill();
    for (const sx of [-1, 1]) {
      circle(ctx, sx * r * 0.17, -r * 1.61, r * 0.085);
      ctx.fillStyle = '#5cf2ff';
      ctx.fill();
    }
  },
  // A penguin in a bobble hat and scarf of the player's colour
  penguin(ctx, r, hex) {
    outline(ctx, r, hex);
    const navy = '#2b3350';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.3, -r * 0.04, r * 0.3, r * 0.13, 0, 0, TAU);
      ctx.fillStyle = '#ff9a2e';
      ctx.fill();
      ctx.strokeStyle = '#b85f0c';
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.74, -r * 0.8, r * 0.16, r * 0.42, sx * 0.35, 0, TAU);
      ctx.fillStyle = navy;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.9, r * 0.72, r * 0.9, 0, 0, TAU);
    ctx.fillStyle = cylinder(ctx, r * 0.72, navy);
    ctx.fill();
    ctx.strokeStyle = '#141a2e';
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.72, r * 0.46, r * 0.66, 0, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    for (const sx of [-1, 1]) {
      circle(ctx, sx * r * 0.2, -r * 1.3, r * 0.085);
      ctx.fillStyle = '#15151c';
      ctx.fill();
    }
    path(ctx, [[-r * 0.14, -r * 1.18], [r * 0.14, -r * 1.18], [0, -r * 1.0]]);
    ctx.fillStyle = '#ff9a2e';
    ctx.fill();
    // scarf
    roundRect(ctx, -r * 0.62, -r * 1.02, r * 1.24, r * 0.22, r * 0.1);
    ctx.fillStyle = hex;
    ctx.fill();
    ctx.strokeStyle = mix(hex, '#000000', 0.4);
    ctx.stroke();
    roundRect(ctx, r * 0.22, -r * 0.92, r * 0.24, r * 0.5, r * 0.08);
    ctx.fill();
    ctx.stroke();
    // bobble hat
    ctx.beginPath();
    ctx.ellipse(0, -r * 1.5, r * 0.56, r * 0.5, 0, Math.PI, TAU);
    ctx.closePath();
    ctx.fillStyle = hex;
    ctx.fill();
    ctx.stroke();
    roundRect(ctx, -r * 0.6, -r * 1.56, r * 1.2, r * 0.16, r * 0.08);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#c9d2e0';
    ctx.stroke();
    circle(ctx, 0, -r * 2.04, r * 0.15);
    ctx.fill();
    ctx.stroke();
  },
  // A flying saucer in the player's colour, a little green alien under the glass
  ufo(ctx, r, hex) {
    r *= 1.25;
    outline(ctx, r, hex);
    const cy = -r * 0.95;
    ctx.beginPath();
    ctx.ellipse(0, cy - r * 0.3, r * 0.52, r * 0.56, 0, Math.PI, TAU);
    ctx.closePath();
    const glass = ctx.createLinearGradient(-r * 0.5, cy - r * 0.9, r * 0.5, cy);
    glass.addColorStop(0, 'rgba(235, 252, 255, 0.95)');
    glass.addColorStop(1, 'rgba(150, 215, 245, 0.75)');
    ctx.fillStyle = glass;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(0, cy - r * 0.42, r * 0.25, r * 0.28, 0, 0, TAU);
    ctx.fillStyle = '#7ed957';
    ctx.fill();
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.1, cy - r * 0.46, r * 0.07, r * 0.1, sx * 0.4, 0, TAU);
      ctx.fillStyle = '#15151c';
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, cy, r * 1.02, r * 0.36, 0, 0, TAU);
    const g = ctx.createLinearGradient(0, cy - r * 0.36, 0, cy + r * 0.36);
    g.addColorStop(0, mix(hex, '#ffffff', 0.45));
    g.addColorStop(0.5, hex);
    g.addColorStop(1, mix(hex, '#000000', 0.4));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = mix(hex, '#000000', 0.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, cy + r * 0.2, r * 0.42, r * 0.13, 0, 0, TAU);
    ctx.fillStyle = '#3a4252';
    ctx.fill();
  },
  // A small dragon sitting up: horns, a pale belly, spines down its back (its wings beat: TOKEN_FX)
  dragon(ctx, r, hex) {
    outline(ctx, r, hex);
    const dark = mix(hex, '#000000', 0.35);
    // tail
    ctx.beginPath();
    ctx.moveTo(r * 0.4, -r * 0.25);
    ctx.quadraticCurveTo(r * 1.15, -r * 0.1, r * 0.95, -r * 0.7);
    ctx.lineWidth = r * 0.26;
    ctx.lineCap = 'round';
    ctx.strokeStyle = dark;
    ctx.stroke();
    ctx.lineWidth = r * 0.16;
    ctx.strokeStyle = hex;
    ctx.stroke();
    outline(ctx, r, hex);
    path(ctx, [[r * 0.8, -r * 0.78], [r * 1.08, -r * 0.95], [r * 1.05, -r * 0.6]]);
    ctx.fillStyle = '#f3e3c0';
    ctx.fill();
    // body
    ctx.beginPath();
    ctx.moveTo(-r * 0.62, -r * 0.05);
    ctx.bezierCurveTo(-r * 0.85, -r * 0.7, -r * 0.45, -r * 1.2, 0, -r * 1.2);
    ctx.bezierCurveTo(r * 0.45, -r * 1.2, r * 0.85, -r * 0.7, r * 0.62, -r * 0.05);
    ctx.closePath();
    ctx.fillStyle = cylinder(ctx, r * 0.7, hex);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.5, r * 0.36, r * 0.46, 0, 0, TAU);
    ctx.fillStyle = '#f6e7b8';
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.strokeStyle = '#c9a85a';
    ctx.beginPath();
    for (const y of [-0.7, -0.5, -0.3]) {
      ctx.moveTo(-r * 0.3, y * r);
      ctx.lineTo(r * 0.3, y * r);
    }
    ctx.stroke();
    outline(ctx, r, hex);
    // horns, then the head with its snout to the left
    for (const sx of [-1, 1]) {
      path(ctx, [[sx * r * 0.2, -r * 1.85], [sx * r * 0.52, -r * 2.32], [sx * r * 0.44, -r * 1.75]]);
      ctx.fillStyle = '#f3e3c0';
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(0, -r * 1.55, r * 0.56, r * 0.46, 0, 0, TAU);
    ctx.fillStyle = cylinder(ctx, r * 0.56, hex);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-r * 0.42, -r * 1.42, r * 0.34, r * 0.24, 0.1, 0, TAU);
    ctx.fillStyle = mix(hex, '#ffffff', 0.18);
    ctx.fill();
    ctx.stroke();
    circle(ctx, -r * 0.62, -r * 1.48, r * 0.04);
    ctx.fillStyle = dark;
    ctx.fill();
    circle(ctx, -r * 0.05, -r * 1.66, r * 0.13);
    ctx.fillStyle = '#fff7a8';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-r * 0.06, -r * 1.66, r * 0.04, r * 0.1, 0, 0, TAU);
    ctx.fillStyle = '#15151c';
    ctx.fill();
  },
  // The Royal token: a king in a robe of the player's colour: gold-banded base, an ermine collar,
  // and a jewelled crown with a velvet cap.
  king(ctx, r, hex) {
    const dark = mix(hex, '#000000', 0.4);
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, r * 0.05);
    // base: a gold drum
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.06, r * 0.95, r * 0.35, 0, 0, Math.PI);
    ctx.lineTo(-r * 0.95, -r * 0.3);
    ctx.ellipse(0, -r * 0.3, r * 0.95, r * 0.35, 0, Math.PI, TAU);
    ctx.closePath();
    ctx.fillStyle = cylinder(ctx, r * 0.95, GOLD);
    ctx.fill();
    ctx.strokeStyle = GOLD_DARK;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.3, r * 0.95, r * 0.35, 0, 0, TAU);
    ctx.fillStyle = '#ffe9a0';
    ctx.fill();
    ctx.stroke();
    // the robe: a bell, wide at the hem
    ctx.beginPath();
    ctx.moveTo(-r * 0.78, -r * 0.3);
    ctx.bezierCurveTo(-r * 0.74, -r * 0.9, -r * 0.3, -r * 1.0, -r * 0.3, -r * 1.42);
    ctx.lineTo(r * 0.3, -r * 1.42);
    ctx.bezierCurveTo(r * 0.3, -r * 1.0, r * 0.74, -r * 0.9, r * 0.78, -r * 0.3);
    ctx.ellipse(0, -r * 0.3, r * 0.78, r * 0.26, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = cylinder(ctx, r * 0.78, hex);
    ctx.fill();
    ctx.save();
    ctx.clip();
    // a gold hem and a gold band down the front
    ctx.lineWidth = r * 0.16;
    ctx.strokeStyle = GOLD;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.36, r * 0.78, r * 0.26, 0, 0, Math.PI);
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.fillRect(-r * 0.09, -r * 1.5, r * 0.18, r * 1.5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillRect(-r * 0.03, -r * 1.5, r * 0.05, r * 1.5);
    ctx.restore();
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.strokeStyle = dark;
    ctx.stroke();
    // ermine collar: white fur with black tips
    ctx.beginPath();
    ctx.ellipse(0, -r * 1.36, r * 0.5, r * 0.2, 0, 0, TAU);
    ctx.fillStyle = '#fffdf6';
    ctx.fill();
    ctx.strokeStyle = '#b9ad94';
    ctx.stroke();
    ctx.fillStyle = '#2a2622';
    for (const [ex, ey] of [[-0.3, -1.3], [0, -1.24], [0.3, -1.3]]) {
      ctx.beginPath();
      ctx.ellipse(ex * r, ey * r, r * 0.035, r * 0.06, 0, 0, TAU);
      ctx.fill();
    }
    // head
    const hy = -r * 1.78;
    const g = ctx.createRadialGradient(-r * 0.14, hy - r * 0.14, r * 0.04, 0, hy, r * 0.42);
    g.addColorStop(0, mix(hex, '#ffffff', 0.6));
    g.addColorStop(0.55, hex);
    g.addColorStop(1, dark);
    circle(ctx, 0, hy, r * 0.42);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.stroke();
    // crown: a velvet cap, then five gold points with a ball on each, and a jewelled band
    const cy = hy - r * 0.3;
    ctx.beginPath();
    ctx.ellipse(0, cy - r * 0.22, r * 0.34, r * 0.3, 0, Math.PI, TAU);
    ctx.fillStyle = '#8f1d35';
    ctx.fill();
    path(ctx, [[-0.44, 0.02], [-0.5, -0.5], [-0.26, -0.26], [-0.13, -0.6], [0, -0.3], [0.13, -0.6], [0.26, -0.26], [0.5, -0.5], [0.44, 0.02]].map(([px, py]) => [px * r, cy + py * r]));
    const cg = ctx.createLinearGradient(-r * 0.5, 0, r * 0.5, 0);
    cg.addColorStop(0, '#c9971c');
    cg.addColorStop(0.35, '#fff1b0');
    cg.addColorStop(0.6, GOLD);
    cg.addColorStop(1, '#a87a10');
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = GOLD_DARK;
    ctx.stroke();
    for (const [bx, by] of [[-0.5, -0.5], [-0.13, -0.6], [0.13, -0.6], [0.5, -0.5]]) {
      circle(ctx, bx * r, cy + by * r, r * 0.065);
      ctx.fillStyle = '#fff1b0';
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(0, cy - r * 0.02, r * 0.44, r * 0.11, 0, 0, Math.PI);
    ctx.lineTo(-r * 0.44, cy - r * 0.12);
    ctx.lineTo(r * 0.44, cy - r * 0.12);
    ctx.closePath();
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.stroke();
    [['#e23b55', -0.24], ['#3fb6ff', 0], ['#3fd08a', 0.24]].forEach(([jewel, jx]) => {
      circle(ctx, jx * r, cy - r * 0.03 + Math.abs(jx) * r * 0.06 - r * 0.0, r * 0.06);
      ctx.fillStyle = jewel;
      ctx.fill();
    });
  },
  // The player's zodiac animal in their colour, edged in gold, on a starry navy plinth
  zodiac(ctx, r, hex, sign) {
    // the plinth
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.05, r * 0.92, r * 0.34, 0, 0, Math.PI);
    ctx.lineTo(-r * 0.92, -r * 0.24);
    ctx.ellipse(0, -r * 0.24, r * 0.92, r * 0.34, 0, Math.PI, TAU);
    ctx.closePath();
    ctx.fillStyle = cylinder(ctx, r * 0.92, '#1a2260');
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.strokeStyle = '#d9b25a';
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.24, r * 0.92, r * 0.34, 0, 0, TAU);
    const top = ctx.createRadialGradient(-r * 0.2, -r * 0.3, 0, 0, -r * 0.24, r);
    top.addColorStop(0, '#3a4aa8');
    top.addColorStop(1, '#0d1240');
    ctx.fillStyle = top;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff3c4';
    for (const [sx, sy] of [[-0.5, -0.26], [0.45, -0.18], [0.1, -0.4]]) {
      circle(ctx, sx * r, sy * r, r * 0.035);
      ctx.fill();
    }
    // the animal, standing on it
    const z = zodiacPath(sign);
    const sc = (r * 2.1) / 100;
    ctx.save();
    ctx.translate(-50 * sc, -r * 0.3 - 92 * sc);
    ctx.scale(sc, sc);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const g = ctx.createLinearGradient(0, 10, 0, 92);
    g.addColorStop(0, mix(hex, '#ffffff', 0.35));
    g.addColorStop(1, mix(hex, '#000000', 0.25));
    // horns, claws and tails first, thick in the player's colour so they read as part of the body
    ctx.lineWidth = 7;
    ctx.strokeStyle = mix(hex, '#000000', 0.35);
    ctx.stroke(z.lines);
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = mix(hex, '#ffffff', 0.15);
    ctx.stroke(z.lines);
    ctx.fillStyle = g;
    ctx.fill(z.body);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#e9c46a';
    ctx.stroke(z.body);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#fff1c2';
    ctx.stroke(z.lines);
    ctx.restore();
  },
  // Two stacked game checkers with a ridged top.
  checker(ctx, r, hex) {
    outline(ctx, r, hex);
    for (const y0 of [0, -r * 0.34]) {
      ctx.beginPath();
      ctx.ellipse(0, y0 - r * 0.05, r, r * 0.42, 0, 0, Math.PI);
      ctx.lineTo(-r, y0 - r * 0.32);
      ctx.ellipse(0, y0 - r * 0.32, r, r * 0.42, 0, Math.PI, TAU);
      ctx.closePath();
      ctx.fillStyle = cylinder(ctx, r, hex);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, y0 - r * 0.32, r, r * 0.42, 0, 0, TAU);
      ctx.fillStyle = mix(hex, '#ffffff', 0.18);
      ctx.fill();
      ctx.stroke();
    }
    const ty = -r * 0.66;
    ctx.beginPath();
    ctx.ellipse(0, ty, r * 0.66, r * 0.27, 0, 0, TAU);
    ctx.strokeStyle = mix(hex, '#000000', 0.22);
    ctx.stroke();
    drawStar(ctx, 0, ty, r * 0.26, mix(hex, '#ffffff', 0.55));
  },

  // A friendly ghost with a wavy hem.
  ghost(ctx, r, hex) {
    outline(ctx, r, hex);
    const hem = -r * 0.15;
    ctx.beginPath();
    ctx.moveTo(-r * 0.78, hem);
    ctx.lineTo(-r * 0.78, -r * 1.3);
    ctx.arc(0, -r * 1.3, r * 0.78, Math.PI, 0);
    ctx.lineTo(r * 0.78, hem);
    const w = (r * 1.56) / 4;
    for (let i = 0; i < 4; i++) {
      const x0 = r * 0.78 - i * w;
      ctx.quadraticCurveTo(x0 - w / 2, hem + r * 0.32, x0 - w, hem);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(-r * 0.3, -r * 1.55, r * 0.1, 0, -r * 1.1, r * 1.2);
    g.addColorStop(0, mix(hex, '#ffffff', 0.75));
    g.addColorStop(0.55, mix(hex, '#ffffff', 0.3));
    g.addColorStop(1, hex);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.stroke();
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.27, -r * 1.38, r * 0.13, r * 0.2, 0, 0, TAU);
      ctx.fillStyle = '#1a1a24';
      ctx.fill();
      circle(ctx, sx * r * 0.27 - r * 0.04, -r * 1.45, r * 0.045);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.98, r * 0.1, r * 0.13, 0, 0, TAU);
    ctx.fillStyle = '#1a1a24';
    ctx.fill();
  },

  // A glossy jelly blob with big eyes.
  slime(ctx, r, hex) {
    outline(ctx, r, hex);
    ctx.beginPath();
    ctx.moveTo(-r * 0.98, -r * 0.12);
    ctx.bezierCurveTo(-r * 1.05, -r * 0.95, -r * 0.62, -r * 1.72, 0, -r * 1.76);
    ctx.bezierCurveTo(r * 0.62, -r * 1.72, r * 1.05, -r * 0.95, r * 0.98, -r * 0.12);
    ctx.quadraticCurveTo(0, r * 0.18, -r * 0.98, -r * 0.12);
    ctx.closePath();
    const g = ctx.createRadialGradient(-r * 0.3, -r * 1.25, r * 0.08, 0, -r * 0.8, r * 1.2);
    g.addColorStop(0, mix(hex, '#ffffff', 0.55));
    g.addColorStop(0.6, hex);
    g.addColorStop(1, mix(hex, '#000000', 0.3));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-r * 0.42, -r * 1.33, r * 0.2, r * 0.1, -0.5, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fill();
    eye(ctx, -r * 0.3, -r * 0.92, r * 0.17, r * 0.21, 0.4);
    eye(ctx, r * 0.3, -r * 0.92, r * 0.17, r * 0.21, 0.4);
    ctx.beginPath();
    ctx.arc(0, -r * 0.62, r * 0.17, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.strokeStyle = mix(hex, '#000000', 0.55);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  },

  // A little rocket with fins, a porthole and a flame.
  rocket(ctx, r, hex) {
    outline(ctx, r, hex);
    for (const sx of [-1, 1]) {
      path(ctx, [[sx * r * 0.36, -r * 1.05], [sx * r * 0.86, -r * 0.36], [sx * r * 0.8, -r * 0.14], [sx * r * 0.34, -r * 0.46]]);
      ctx.fillStyle = mix(hex, '#000000', 0.25);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-r * 0.42, -r * 0.4);
    ctx.bezierCurveTo(-r * 0.52, -r * 1.3, -r * 0.3, -r * 1.9, 0, -r * 2.3);
    ctx.bezierCurveTo(r * 0.3, -r * 1.9, r * 0.52, -r * 1.3, r * 0.42, -r * 0.4);
    ctx.closePath();
    ctx.fillStyle = cylinder(ctx, r * 0.46, hex);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(-r, -r * 2.4, r * 2, r * 0.56);
    ctx.restore();
    ctx.stroke();
    circle(ctx, 0, -r * 1.25, r * 0.2);
    ctx.fillStyle = '#bfe8ff';
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.strokeStyle = '#e9eef5';
    ctx.stroke();
    circle(ctx, -r * 0.06, -r * 1.31, r * 0.06);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  },

  // A cat sitting up, tail curled round, in your colour.
  cat(ctx, r, hex) {
    const dark = mix(hex, '#000000', 0.4);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r * 0.5, -r * 0.22);
    ctx.bezierCurveTo(r * 1.25, -r * 0.3, r * 1.2, -r * 1.1, r * 0.82, -r * 1.22);
    ctx.lineWidth = r * 0.24;
    ctx.strokeStyle = dark;
    ctx.stroke();
    ctx.lineWidth = r * 0.14;
    ctx.strokeStyle = hex;
    ctx.stroke();
    ctx.lineCap = 'butt';
    outline(ctx, r, hex);
    ctx.beginPath();
    ctx.moveTo(-r * 0.72, -r * 0.1);
    ctx.bezierCurveTo(-r * 0.82, -r * 0.8, -r * 0.45, -r * 1.18, 0, -r * 1.18);
    ctx.bezierCurveTo(r * 0.45, -r * 1.18, r * 0.82, -r * 0.8, r * 0.72, -r * 0.1);
    ctx.quadraticCurveTo(0, r * 0.12, -r * 0.72, -r * 0.1);
    ctx.closePath();
    ctx.fillStyle = cylinder(ctx, r * 0.76, hex);
    ctx.fill();
    ctx.stroke();
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.28, -r * 0.08, r * 0.2, r * 0.12, 0, 0, TAU);
      ctx.fillStyle = mix(hex, '#ffffff', 0.3);
      ctx.fill();
      ctx.stroke();
    }
    const hy = -r * 1.52;
    for (const sx of [-1, 1]) {
      path(ctx, [[sx * r * 0.14, hy - r * 0.36], [sx * r * 0.5, hy - r * 0.78], [sx * r * 0.56, hy - r * 0.12]]);
      ctx.fillStyle = hex;
      ctx.fill();
      ctx.stroke();
      path(ctx, [[sx * r * 0.24, hy - r * 0.34], [sx * r * 0.46, hy - r * 0.6], [sx * r * 0.48, hy - r * 0.24]]);
      ctx.fillStyle = '#ffb3c1';
      ctx.fill();
    }
    const g = ctx.createRadialGradient(-r * 0.18, hy - r * 0.2, r * 0.05, 0, hy, r * 0.6);
    g.addColorStop(0, mix(hex, '#ffffff', 0.5));
    g.addColorStop(0.6, hex);
    g.addColorStop(1, mix(hex, '#000000', 0.25));
    circle(ctx, 0, hy, r * 0.55);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.stroke();
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.21, hy - r * 0.04, r * 0.11, r * 0.15, 0, 0, TAU);
      ctx.fillStyle = '#fffbe6';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.21, hy - r * 0.02, r * 0.045, r * 0.12, 0, 0, TAU);
      ctx.fillStyle = '#15151c';
      ctx.fill();
    }
    path(ctx, [[-r * 0.07, hy + r * 0.14], [r * 0.07, hy + r * 0.14], [0, hy + r * 0.23]]);
    ctx.fillStyle = '#ff7a95';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(0.6, r * 0.03);
    ctx.beginPath();
    for (const sx of [-1, 1]) {
      for (const dy of [0.12, 0.28]) {
        ctx.moveTo(sx * r * 0.16, hy + r * 0.2);
        ctx.lineTo(sx * r * 0.66, hy + r * dy);
      }
    }
    ctx.stroke();
  },

  // A rubber duck, in your colour, with an orange beak.
  duck(ctx, r, hex) {
    outline(ctx, r, hex);
    path(ctx, [[r * 0.7, -r * 0.72], [r * 1.08, -r * 1.18], [r * 0.98, -r * 0.55]]);
    ctx.fillStyle = hex;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.55, r * 0.98, r * 0.56, 0, 0, TAU);
    ctx.fillStyle = cylinder(ctx, r * 0.98, hex);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(r * 0.18, -r * 0.62, r * 0.42, r * 0.22, -0.35, 0, TAU);
    ctx.fillStyle = mix(hex, '#000000', 0.14);
    ctx.fill();
    ctx.stroke();
    const g = ctx.createRadialGradient(-r * 0.5, -r * 1.6, r * 0.05, -r * 0.35, -r * 1.4, r * 0.55);
    g.addColorStop(0, mix(hex, '#ffffff', 0.55));
    g.addColorStop(0.6, hex);
    g.addColorStop(1, mix(hex, '#000000', 0.25));
    circle(ctx, -r * 0.35, -r * 1.4, r * 0.5);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-r * 0.86, -r * 1.3, r * 0.3, r * 0.13, 0.15, 0, TAU);
    ctx.fillStyle = '#ff9a2e';
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.strokeStyle = '#b85f0c';
    ctx.stroke();
    circle(ctx, -r * 0.47, -r * 1.52, r * 0.09);
    ctx.fillStyle = '#15151c';
    ctx.fill();
    circle(ctx, -r * 0.5, -r * 1.55, r * 0.03);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  },
};

// Left-to-right shading that makes a flat shape look round.
export function cylinder(ctx, w, color) {
  const g = ctx.createLinearGradient(-w, 0, w, 0);
  g.addColorStop(0, mix(color, '#000000', 0.22));
  g.addColorStop(0.3, mix(color, '#ffffff', 0.28));
  g.addColorStop(0.55, color);
  g.addColorStop(1, mix(color, '#000000', 0.3));
  return g;
}

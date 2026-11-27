// Every token: the pawn and each shop shape, with their effects. (Split out of renderer.js.)
import { TAU, circle, drawStar, hexA, mix, path, polygon, roundRect, sparkle, zodiacPath } from './draw-util.js';

// ---------- tokens ----------

// A token's shadow on the board: an ellipse (0.95 × 0.40 of its radius) filled with a circular
// gradient as wide as the ellipse. Same picture at every size, so it's made once.
let shadowPic = null;
function groundShadow() {
  if (shadowPic) return shadowPic;
  const W = 190;
  const H = 80; // 0.40 / 0.95 of the width, as drawn
  shadowPic = document.createElement('canvas');
  shadowPic.width = W;
  shadowPic.height = H;
  const g = shadowPic.getContext('2d');
  const sg = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
  sg.addColorStop(0, 'rgba(0,0,0,0.38)');
  sg.addColorStop(0.55, 'rgba(0,0,0,0.18)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  g.beginPath();
  g.ellipse(W / 2, H / 2, W / 2, H / 2, 0, 0, TAU);
  g.fillStyle = sg;
  g.fill();
  return shadowPic;
}

// Draws one 3D pawn standing on (x, y). `lift` raises it (px), `squash` < 1 flattens it on landing.
// `t` (ms): the time, for skins with a moving effect (the Legendary ones); leave it out for a
// still picture.
export function drawToken(ctx, x, y, r, hex, skin, { lift = 0, squash = 1, sign = 'red', t = null } = {}) {
  const gy = y + r * 0.2; // the pawn's base sits on the centre of its square
  const shrink = 1 - Math.min(0.45, lift / (r * 4));
  const sw = r * 0.95 * shrink;
  const sh = r * 0.4 * shrink;
  // its shadow on the board: one picture made once and stamped (it was a new gradient per token
  // per frame); always the same shape, sw wide and sh = sw × 0.42 tall
  ctx.drawImage(groundShadow(), x - sw, gy - sh, sw * 2, sh * 2);

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
  // Rocket: its engine burns with supersonic shock diamonds, billowing exhaust clouds, and sparkling embers
  thrust(ctx, r, hex, t, part) {
    if (part === 'back') {
      // 1. Volumetric billowing smoke clouds rolling away from launch
      for (let i = 0; i < 5; i++) {
        const p = (t * 0.85 + i * 0.2) % 1;
        const drift = Math.sin(i * 11 + t * 0.7) * r * 0.45 * p;
        ctx.globalAlpha = (1 - p) * 0.38;
        const sg = ctx.createRadialGradient(drift, -r * 0.2 + p * r * 0.2, 0, drift, -r * 0.2 + p * r * 0.2, r * (0.2 + p * 0.42));
        sg.addColorStop(0, '#f0edf7');
        sg.addColorStop(0.5, '#d3cce3');
        sg.addColorStop(1, 'rgba(180, 175, 200, 0)');
        ctx.fillStyle = sg;
        circle(ctx, drift, -r * 0.2 + p * r * 0.2, r * (0.2 + p * 0.42));
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 2. Heavy engine thermal glow stamped beneath the rocket
      const th = r * (1.1 + 0.15 * Math.sin(t * 19));
      ctx.drawImage(glowSprite('rocket-nozzle-heat', [[0, 'rgba(255, 140, 30, 0.7)'], [0.4, 'rgba(255, 50, 0, 0.25)'], [1, 'rgba(255, 0, 0, 0)']]), -th, -r * 0.4 - th * 0.4, th * 2, th * 1.6);

      // 3. Blazing supersonic rocket exhaust plume
      const flLen = r * (0.8 + 0.25 * Math.sin(t * 29) + 0.12 * Math.sin(t * 43));
      const sway = Math.sin(t * 19) * r * 0.05;

      // Outer plasma flame envelope
      const fg = ctx.createLinearGradient(0, -r * 0.35, 0, -r * 0.35 + flLen);
      fg.addColorStop(0, '#ffffff');
      fg.addColorStop(0.2, '#fff176');
      fg.addColorStop(0.5, '#ff9100');
      fg.addColorStop(0.85, '#ff3d00');
      fg.addColorStop(1, 'rgba(220, 20, 60, 0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(-r * 0.28, -r * 0.35);
      ctx.quadraticCurveTo(-r * 0.35, -r * 0.35 + flLen * 0.5, sway, -r * 0.35 + flLen);
      ctx.quadraticCurveTo(r * 0.35, -r * 0.35 + flLen * 0.5, r * 0.28, -r * 0.35);
      ctx.closePath();
      ctx.fill();

      // Inner white-hot supersonic core
      const cg = ctx.createLinearGradient(0, -r * 0.35, 0, -r * 0.35 + flLen * 0.65);
      cg.addColorStop(0, '#ffffff');
      cg.addColorStop(0.6, '#fff9c4');
      cg.addColorStop(1, 'rgba(255, 235, 59, 0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(-r * 0.15, -r * 0.35);
      ctx.quadraticCurveTo(-r * 0.18, -r * 0.35 + flLen * 0.35, sway * 0.5, -r * 0.35 + flLen * 0.65);
      ctx.quadraticCurveTo(r * 0.18, -r * 0.35 + flLen * 0.35, r * 0.15, -r * 0.35);
      ctx.closePath();
      ctx.fill();

      // Supersonic shock diamond nodes
      for (const [dy, dw, dh] of [[0.28, 0.11, 0.16], [0.55, 0.08, 0.12]]) {
        const ny = -r * 0.35 + flLen * dy;
        ctx.beginPath();
        ctx.moveTo(sway * dy, ny - r * dh * 0.5);
        ctx.lineTo(sway * dy + r * dw * 0.5, ny);
        ctx.lineTo(sway * dy, ny + r * dh * 0.5);
        ctx.lineTo(sway * dy - r * dw * 0.5, ny);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }

      // 4. High-velocity fiery sparks and launch embers
      for (let i = 0; i < 6; i++) {
        const sp = (t * 2.4 + i * 0.28) % 1;
        const sx = (i - 2.5) * r * 0.14 * (1 + sp * 1.5) + Math.sin(i * 9 + t * 7) * r * 0.06;
        const sy = -r * 0.32 + sp * flLen * 1.45;
        const sa = (1 - sp) * 0.95;
        ctx.globalAlpha = sa;
        sparkle(ctx, sx, sy, r * 0.11 * (1 - sp * 0.4), i % 2 ? '#fff9c4' : '#ff7043');
      }
      ctx.globalAlpha = 1;
      return;
    }
    // part === 'front': Nose probe beacon pulse & cockpit viewport glint
    const beacon = 0.5 + 0.5 * Math.sin(t * 8);
    circle(ctx, 0, -r * 2.42, r * (0.05 + 0.03 * beacon));
    ctx.fillStyle = `rgba(92, 242, 255, ${0.6 + 0.4 * beacon})`;
    ctx.fill();
    sparkle(ctx, -r * 0.07, -r * 1.32, r * 0.065 * (0.5 + 0.5 * Math.sin(t * 3.5)), '#ffffff');
  },
  // UFO: pulsating cascading tractor beam with descending energy wave rings, ascending particles, and rim beacon lights
  saucer(ctx, r, hex, t, part) {
    r *= 1.25;
    if (part === 'back') {
      // 1. Ambient anti-gravity forcefield aura behind craft
      const auraPulse = 0.5 + 0.5 * Math.sin(t * 3.5);
      const aurR = r * (1.3 + 0.15 * auraPulse);
      ctx.drawImage(glowSprite('ufo-field', [[0, 'rgba(92, 242, 255, 0.45)'], [0.45, 'rgba(126, 217, 87, 0.18)'], [1, 'rgba(0, 0, 0, 0)']]), -aurR, -r * 1.15 - aurR * 0.45, aurR * 2, aurR * 1.35);

      // 2. Conical tractor beam extending to the ground
      const a = 0.32 + 0.14 * Math.sin(t * 4);
      const bg = ctx.createLinearGradient(0, -r * 0.8, 0, r * 0.3);
      bg.addColorStop(0, `rgba(160, 255, 235, ${a + 0.35})`);
      bg.addColorStop(0.4, `rgba(92, 242, 255, ${a * 0.8})`);
      bg.addColorStop(0.85, `rgba(126, 217, 87, ${a * 0.45})`);
      bg.addColorStop(1, 'rgba(126, 217, 87, 0)');
      ctx.fillStyle = bg;
      path(ctx, [[-r * 0.34, -r * 0.8], [r * 0.34, -r * 0.8], [r * 0.95, r * 0.3], [-r * 0.95, r * 0.3]]);
      ctx.fill();

      // 3. Descending energy wave rings cascading down the beam
      for (let i = 0; i < 3; i++) {
        const ringP = (t * 0.75 + i / 3) % 1;
        const ry = -r * 0.8 + ringP * r * 1.1;
        const rw = r * (0.34 + ringP * 0.61);
        const rh = rw * 0.28;
        ctx.beginPath();
        ctx.ellipse(0, ry, rw, rh, 0, 0, TAU);
        ctx.lineWidth = Math.max(1, r * 0.05 * (1 - ringP * 0.3));
        ctx.strokeStyle = `rgba(200, 255, 245, ${(1 - ringP) * 0.75})`;
        ctx.stroke();
      }

      // 4. Ground impact energy contact ring
      ctx.beginPath();
      ctx.ellipse(0, r * 0.28, r * 0.92, r * 0.26, 0, 0, TAU);
      ctx.fillStyle = `rgba(92, 242, 255, ${0.18 + 0.12 * Math.sin(t * 5)})`;
      ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.04);
      ctx.strokeStyle = `rgba(160, 255, 240, ${0.4 + 0.3 * Math.sin(t * 5)})`;
      ctx.stroke();

      // 5. Floating anti-gravity particles rising into the saucer
      for (let i = 0; i < 4; i++) {
        const p = (t * 0.9 + i * 0.25) % 1;
        const px = Math.sin(i * 13 + t * 2) * r * 0.35 * (1 - p * 0.4);
        const py = r * 0.28 - p * r * 1.08;
        ctx.globalAlpha = Math.sin(p * Math.PI) * 0.85;
        circle(ctx, px, py, r * (0.035 + 0.02 * (1 - p)));
        ctx.fillStyle = i % 2 ? '#5cf2ff' : '#a8ff78';
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }

    // part === 'front': Rotating perimeter hyper-drive beacon lights & cockpit glass sheen
    const numLights = 7;
    const sweep = (t * 3.8) % numLights;
    for (let i = 0; i < numLights; i++) {
      const angle = Math.PI * (0.08 + 0.84 * (i / (numLights - 1)));
      const lx = -Math.cos(angle) * r * 0.95;
      const ly = -r * 0.86 + Math.sin(angle) * r * 0.26;

      // Distance from the sweeping light wave
      let dist = Math.abs(i - sweep);
      if (dist > numLights / 2) dist = numLights - dist;
      const intensity = Math.max(0, 1 - dist / 1.5) ** 2;

      // Outer glow bloom
      if (intensity > 0.1) {
        ctx.globalAlpha = intensity * 0.65;
        circle(ctx, lx, ly, r * (0.12 + 0.08 * intensity));
        ctx.fillStyle = i % 2 ? '#5cf2ff' : '#fff7a8';
        ctx.fill();
      }

      // Core light bulb
      ctx.globalAlpha = 0.4 + 0.6 * intensity;
      circle(ctx, lx, ly, r * (0.065 + 0.02 * intensity));
      ctx.fillStyle = intensity > 0.5 ? '#ffffff' : (i % 2 ? '#5cf2ff' : '#ffe082');
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Cockpit dome glass glint sweep
    const glintX = Math.sin(t * 1.6) * r * 0.25;
    ctx.beginPath();
    ctx.ellipse(glintX, -r * 1.35, r * 0.15, r * 0.07, -0.4, 0, TAU);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fill();
  },
  // Dragon: warm draconic magma aura, floating embers, glowing reptilian eye glints, and smoldering jaw whisps
  wings(ctx, r, hex, t, part) {
    if (part === 'back') {
      // 1. Warm draconic magma aura breathing behind the beast
      const auraP = 0.5 + 0.5 * Math.sin(t * 3);
      const aurR = r * (1.6 + 0.2 * auraP);
      ctx.drawImage(glowSprite('dragon-aura', [[0, 'rgba(255, 90, 20, 0.45)'], [0.45, 'rgba(255, 160, 30, 0.18)'], [1, 'rgba(0,0,0,0)']]), -aurR, -r * 1.3 - aurR * 0.5, aurR * 2, aurR * 1.5);

      // 2. Floating fiery embers rising around the dragon
      for (let i = 0; i < 5; i++) {
        const p = (t * 0.8 + i * 0.2) % 1;
        const px = Math.sin(i * 17 + t * 2) * r * 0.9;
        const py = -r * 0.2 - p * r * 2.3;
        ctx.globalAlpha = Math.sin(p * Math.PI) * 0.85;
        sparkle(ctx, px, py, r * (0.08 + 0.04 * (1 - p)), i % 2 ? '#ffb300' : '#ff5722');
      }
      ctx.globalAlpha = 1;
      return;
    }

    // part === 'front': Eye glint and rising draconic smoke & spark whisps
    const eyeX = r * 0.22;
    const eyeY = -r * 1.95;
    const glint = Math.max(0, Math.sin(t * 4)) ** 4;
    if (glint > 0.1) {
      ctx.globalAlpha = glint * 0.9;
      circle(ctx, eyeX, eyeY, r * 0.045);
      ctx.fillStyle = '#fff9c4';
      ctx.fill();
      sparkle(ctx, eyeX, eyeY, r * 0.09, '#ffd54f');
      ctx.globalAlpha = 1;
    }

    // Gentle smoke and ember whisps from jaws
    const mouthX = r * 0.32;
    const mouthY = -r * 1.78;
    for (let i = 0; i < 2; i++) {
      const sp = (t * 1.2 + i * 0.5) % 1;
      ctx.globalAlpha = (1 - sp) * 0.6;
      circle(ctx, mouthX + sp * r * 0.25, mouthY - sp * r * 0.35 + Math.sin(i * 5 + t * 4) * r * 0.04, r * 0.03 * (1 + sp));
      ctx.fillStyle = i % 2 ? '#ff9800' : '#d1c4e9';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
  // Constellation: multi-spectral 4-star celestial orbit with stardust particle trails and a cosmic nebula aura
  orbit(ctx, r, hex, t, part) {
    if (part === 'back') {
      // 1. Swirling cosmic nebula aura behind star-beast
      const p = 0.5 + 0.5 * Math.sin(t * 1.3);
      const gr = r * (1.6 + 0.25 * p);
      ctx.globalAlpha = 0.55 + 0.3 * p;
      ctx.drawImage(glowSprite(`nebula-${hex}`, [[0, hexA(hex, 0.6)], [0.45, 'rgba(120, 75, 235, 0.28)'], [1, 'rgba(10, 15, 50, 0)']]), -gr, -r * 0.85 - gr * 0.55, gr * 2, gr * 1.25);
      ctx.globalAlpha = 1;

      // 2. Pulsing golden astrological rune ring on plinth base
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.24, r * (0.85 + 0.06 * p), r * (0.31 + 0.02 * p), 0, 0, TAU);
      ctx.lineWidth = Math.max(1, r * 0.04);
      ctx.strokeStyle = `rgba(246, 207, 87, ${0.35 + 0.3 * p})`;
      ctx.stroke();
    }

    // 3. Four celestial stars orbiting in inclined 3D orbits with stardust trails
    const starConfigs = [
      { speed: 1.25, phase: 0, col: '#ffd23f', inc: 0.28, radX: 1.15, radY: 0.38, baseH: 1.1 },
      { speed: 1.45, phase: (TAU * 1) / 4, col: '#ffffff', inc: -0.42, radX: 1.05, radY: 0.44, baseH: 1.3 },
      { speed: 1.25, phase: (TAU * 2) / 4, col: '#5cf2ff', inc: 0.28, radX: 1.15, radY: 0.38, baseH: 1.1 },
      { speed: 1.45, phase: (TAU * 3) / 4, col: '#ff70a6', inc: -0.42, radX: 1.05, radY: 0.44, baseH: 1.3 },
    ];

    starConfigs.forEach((cfg, idx) => {
      const a = t * cfg.speed + cfg.phase;
      const depth = Math.sin(a); // > 0 is in front
      if ((depth > 0) !== (part === 'front')) return;

      const sx = Math.cos(a) * r * cfg.radX;
      const sy = -r * (cfg.baseH + cfg.radY * Math.sin(a * 0.5 + idx)) + depth * r * cfg.inc;
      const starScale = 0.75 + 0.35 * depth;
      const alpha = 0.55 + 0.45 * depth;

      // Stardust particle comet tail (3 fading trail particles)
      for (let j = 1; j <= 3; j++) {
        const taj = a - j * 0.18;
        const tx = Math.cos(taj) * r * cfg.radX;
        const ty = -r * (cfg.baseH + cfg.radY * Math.sin(taj * 0.5 + idx)) + Math.sin(taj) * r * cfg.inc;
        ctx.globalAlpha = alpha * (1 - j * 0.28);
        sparkle(ctx, tx, ty, r * (0.09 - j * 0.02) * starScale, cfg.col);
      }

      // Star core & diffraction cross flares
      ctx.globalAlpha = alpha;
      if (depth > 0.3) {
        // Glowing star bloom
        circle(ctx, sx, sy, r * 0.22 * starScale);
        ctx.fillStyle = hexA(cfg.col, 0.4);
        ctx.fill();
      }
      sparkle(ctx, sx, sy, r * 0.22 * starScale, cfg.col);
      circle(ctx, sx, sy, r * 0.06 * starScale);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.globalAlpha = 1;
    });
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
  'token-dino': { shape: 'dino' },
  // Cosmetic bundle tokens: /bundles/<tier>/<dir>/token_<col>.webp + token_glow.webp
  'token-woodland-grove': { bundle: 'common/woodland_grove' },
  'token-street-playground': { bundle: 'common/street_playground' },
  'token-space-odyssey': { bundle: 'rare/space_odyssey' },
  'token-pharaohs-oasis': { bundle: 'rare/pharaohs_oasis' },
  'token-mystic-alchemy': { bundle: 'epic/mystic_alchemy' },
  'token-christmas-holiday': { bundle: 'epic/christmas_holiday' },
  'token-turtle-lotus': { bundle: 'epic/turtle_lotus' },
  'token-pirates-cove': { bundle: 'epic/pirates_cove' },
  'token-celestial-olympus': { bundle: 'legendary/celestial_olympus', fx: 'glitter' },
  'token-steampunk-workshop': { bundle: 'legendary/steampunk_workshop', fx: 'glitter' },
  // Battle Pass Season 1: painted pictures, one per colour
  'token-samurai': { shape: 'samurai' },
  'token-football': { shape: 'football' },
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
  dino: { y: 0.95, x: 0, size: 0.6 },
  samurai: { y: 0.35, x: 0, size: 0.6 },
  football: { y: 0.3, x: 0, size: 0.6 },
  ufo: { y: 0.95, x: 0, size: 0.6 },
  dragon: { y: 0.6, x: 0, size: 0.7 },
};

export const GOLD = '#f6cf57';
export const GOLD_DARK = '#9a6f00';

// A pawn drawn upwards from (0, 0): base disc, tapered body, collar and round head.
export function paintPawn(ctx, r, hex, style, sign) {
  if (style.bundle) {
    // six colours, like the other picture tokens (6-player games need orange and purple too)
    const col = ['red', 'green', 'yellow', 'blue', 'orange', 'purple'].includes(sign) ? sign : 'red';
    // first time this bundle shows: start loading its effects too, so they're ready when needed
    for (const f of ['token_shield_back', 'token_shield_front', 'vfx_aura', 'vfx_capture']) bundleTokenPic(style.bundle, f);
    const glow = bundleTokenPic(style.bundle, 'token_glow');
    const img = bundleTokenPic(style.bundle, `token_${col}`);
    if (img) {
      const h = r * 2.75 * bundleScale(style.bundle, img);
      const w = (h * img.naturalWidth) / img.naturalHeight;
      if (glow) {
        ctx.save();
        ctx.globalAlpha *= 0.65;
        ctx.drawImage(glow, -w / 2, -h + r * 0.14, w, h);
        ctx.restore();
      }
      ctx.drawImage(img, -w / 2, -h + r * 0.14, w, h);
      return;
    }
    return paintPawn(ctx, r, hex, {}, sign);
  }
  if (style.shape) return TOKEN_SHAPES[style.shape](ctx, r, hex, sign);
  const body = style.neon ? '#141724' : hex;
  const edge = style.neon ? mix(hex, '#ffffff', 0.25) : mix(hex, '#000000', 0.38);
  const trim = style.neon ? mix(hex, '#090b12', 0.68) : mix(body, '#ffffff', 0.22);
  ctx.lineWidth = Math.max(1, r * (style.neon ? 0.12 : 0.05));
  ctx.strokeStyle = edge;
  ctx.lineJoin = 'round';
  if (style.neon) {
    ctx.shadowColor = hex;
    ctx.shadowBlur = r * 0.95;
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
    g.addColorStop(0, mix(body, '#ffffff', 0.72));
    g.addColorStop(0.22, mix(body, '#ffffff', 0.4));
    g.addColorStop(0.6, body);
    g.addColorStop(0.92, mix(body, '#000000', 0.32));
    g.addColorStop(1, mix(body, '#ffffff', 0.08));
    circle(ctx, 0, hy, r * 0.46);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.stroke();
    circle(ctx, -r * 0.16, hy - r * 0.18, r * 0.09);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.fill();
  }
  if (style.neon) {
    circle(ctx, 0, hy, r * 0.26);
    ctx.fillStyle = hex;
    ctx.fill();
    circle(ctx, 0, hy, r * 0.13);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    // glowing core stripe down the center of the pawn
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.44);
    ctx.lineTo(0, -r * 1.15);
    ctx.lineWidth = Math.max(1.2, r * 0.09);
    ctx.strokeStyle = mix(hex, '#ffffff', 0.55);
    ctx.stroke();
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

// The Dino tokens are painted pictures, one dinosaur per colour, each on its own pedestal:
// a triceratops for red (orange too), a T. rex for green (purple too), a long-neck for yellow
// and a stegosaurus with crystal plates for blue. They load once; until they have, the token
// is drawn (dinoDrawn), and when one arrives the cached token pictures are thrown away.
const dinoArt = {};
function dinoPicture(name) {
  const file = ['red', 'green', 'yellow', 'blue', 'orange', 'purple'].includes(name) ? name : 'green';
  let img = dinoArt[file];
  if (!img) {
    if (typeof Image === 'undefined') return null;
    img = dinoArt[file] = new Image();
    img.onload = () => pawnSprites.clear();
    img.src = `/tokens/dino-${file}.webp`;
  }
  return img.complete && img.naturalWidth ? img : null;
}

// The Legendary Dragon tokens: majestic 3D miniature figurines of elder dragons perched on obsidian pedestals
const dragonArt = {};
function dragonPicture(name) {
  const file = ['red', 'green', 'yellow', 'blue', 'orange', 'purple'].includes(name) ? name : 'red';
  let img = dragonArt[file];
  if (!img) {
    if (typeof Image === 'undefined') return null;
    img = dragonArt[file] = new Image();
    img.onload = () => pawnSprites.clear();
    img.src = `/tokens/dragon-${file}.webp`;
  }
  return img.complete && img.naturalWidth ? img : null;
}

// Battle Pass tokens: one painted picture per colour (/tokens/<name>-<colour>.webp), loaded once
const pictureArt = {};
function tokenPicture(name, sign) {
  const file = ['red', 'green', 'yellow', 'blue', 'orange', 'purple'].includes(sign) ? sign : 'red';
  const key = `${name}-${file}`;
  let img = pictureArt[key];
  if (!img) {
    if (typeof Image === 'undefined') return null;
    img = pictureArt[key] = new Image();
    img.onload = () => {
      pawnSprites.clear();
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('ludo-textures'));
    };
    img.src = `/tokens/${key}.webp`;
  }
  return img.complete && img.naturalWidth ? img : null;
}
// ---- Cosmetic bundles: their own shield, aura and capture burst (pictures in /bundles/<dir>/) ----
// The bundle folder of a token skin, or null
export const bundleOf = (skin) => PAWN_STYLES[skin]?.bundle || null;
// How much a bundle token's picture is scaled up (1 until its picture has loaded)
export const bundleTokenScale = (skin) => (bundleOf(skin) ? bundleScale(bundleOf(skin)) : 1);

// The token's own shield while it sits on a safe square: `part` 'back' goes before the token,
// 'front' after it. Same frame as the token picture (156×220), so it wraps it exactly. `grow`
// 0..1 pops it up when the token arrives.
export function drawBundleShield(ctx, x, y, r, skin, part, { lift = 0, grow = 1, t = 0 } = {}) {
  const dir = bundleOf(skin);
  const img = dir && bundleTokenPic(dir, part === 'back' ? 'token_shield_back' : 'token_shield_front');
  if (!img || grow <= 0) return;
  const h = r * 2.75 * bundleScale(dir) * (0.85 + 0.15 * grow);
  const w = (h * img.naturalWidth) / img.naturalHeight;
  ctx.save();
  ctx.translate(x, y + r * 0.2 - lift);
  ctx.globalAlpha *= Math.min(1, grow) * (part === 'front' ? 0.82 + 0.1 * Math.sin(t / 420) : 1);
  ctx.drawImage(img, -w / 2, -h + r * 0.14, w, h);
  ctx.restore();
}

// A glowing ring under a token you can move, turning slowly (flattened onto the board)
export function drawBundleAura(ctx, x, y, r, skin, t = 0) {
  const dir = bundleOf(skin);
  const img = dir && bundleTokenPic(dir, 'vfx_aura');
  if (!img) return;
  const size = r * 3.1 * (1 + 0.05 * Math.sin(t / 300));
  ctx.save();
  ctx.translate(x, y + r * 0.2);
  ctx.scale(1, 0.48);
  ctx.rotate(t / 1600);
  ctx.globalAlpha *= 0.85;
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}

// The capture burst's picture (renderer.picture plays it), or null while it loads
export function bundleCaptureArt(skin) {
  const dir = bundleOf(skin);
  return dir ? bundleTokenPic(dir, 'vfx_capture') : null;
}

// Bundle token pictures share one frame (156×220) but some fill little of it (a turtle, a
// bottle cap): scale those up so every token stands about as tall as the rest, but never wider
// than its square allows. Measured once from the red token's visible pixels; anchored at the foot.
const bundleScales = new Map();
function bundleScale(dir, img = null) {
  if (bundleScales.has(dir)) return bundleScales.get(dir);
  const pic = img || bundleTokenPic(dir, 'token_red');
  if (!pic || typeof document === 'undefined') return 1;
  let k = 1;
  try {
    const c = document.createElement('canvas');
    c.width = pic.naturalWidth;
    c.height = pic.naturalHeight;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(pic, 0, 0);
    const a = x.getImageData(0, 0, c.width, c.height).data;
    let top = c.height, left = c.width, right = 0;
    for (let y = 0; y < c.height; y++)
      for (let i = 0; i < c.width; i++)
        if (a[(y * c.width + i) * 4 + 3] > 40) {
          if (y < top) top = y;
          if (i < left) left = i;
          if (i > right) right = i;
        }
    const tall = (c.height - top) / c.height;
    const wide = (right - left + 1) / c.width;
    if (tall > 0 && wide > 0) k = Math.max(1, Math.min(1.45, 0.86 / tall, 1.3 / wide));
  } catch {
    k = 1;
  }
  bundleScales.set(dir, k);
  return k;
}

function bundleTokenPic(dir, file) {
  const key = `bundle/${dir}/${file}`;
  let img = pictureArt[key];
  if (!img) {
    if (typeof Image === 'undefined') return null;
    img = pictureArt[key] = new Image();
    img.onload = () => {
      pawnSprites.clear();
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('ludo-textures'));
    };
    img.src = `/bundles/${dir}/${file}.webp`;
  }
  return img.complete && img.naturalWidth ? img : null;
}
function drawPicture(ctx, r, img, height) {
  const h = r * height;
  const w = (h * img.naturalWidth) / img.naturalHeight;
  ctx.drawImage(img, -w / 2, -h + r * 0.28, w, h);
}

// Astronomical constellation star coordinates and asterism connector lines for each zodiac sign
export const ZODIAC_STARS = {
  red: {
    // Aries: Hamal (alpha), Sheratan (beta), Mesarthim (gamma)
    stars: [[84, 22, 1.4], [74, 27, 1.1], [68, 33, 0.9], [52, 38, 0.8], [38, 44, 0.8], [22, 52, 0.9], [16, 64, 0.7], [32, 88, 0.8], [78, 88, 0.8]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [4, 7], [3, 8]],
  },
  green: {
    // Taurus: Aldebaran (alpha), Elnath (beta), Tianguan (zeta), Pleiades
    stars: [[82, 38, 1.5], [94, 21, 1.2], [98, 32, 1.0], [72, 30, 0.9], [60, 38, 0.8], [50, 32, 1.1], [34, 42, 0.8], [18, 52, 0.8], [62, 88, 0.8], [78, 88, 0.8]],
    lines: [[1, 3], [2, 0], [0, 3], [3, 4], [4, 5], [5, 6], [6, 7], [4, 8], [3, 9]],
  },
  yellow: {
    // Leo: Regulus (alpha), Algieba (gamma), Adhafera, Denebola (beta)
    stars: [[64, 46, 1.5], [78, 36, 1.1], [84, 24, 1.0], [92, 30, 0.9], [96, 40, 0.8], [84, 54, 0.9], [44, 46, 1.1], [30, 48, 0.9], [12, 42, 1.2], [34, 88, 0.8], [78, 88, 0.8]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 1], [0, 6], [6, 8], [8, 7], [7, 6], [0, 10], [7, 9]],
  },
  blue: {
    // Cancer: Praesepe / Beehive Cluster (M44), Asellus Bor/Aus, Acubens, Altarf
    stars: [[50, 58, 1.5], [42, 46, 1.0], [58, 46, 1.0], [24, 24, 1.1], [16, 12, 1.2], [76, 24, 1.1], [84, 12, 1.2], [26, 72, 0.9], [74, 72, 0.9], [12, 86, 0.8], [88, 86, 0.8]],
    lines: [[1, 2], [1, 0], [2, 0], [1, 3], [3, 4], [2, 5], [5, 6], [0, 7], [0, 8], [7, 9], [8, 10]],
  },
  purple: {
    // Scorpius: Antares (alpha), Shaula (lambda), Graffias
    stars: [[36, 64, 1.5], [28, 56, 1.0], [18, 44, 1.1], [14, 36, 1.0], [48, 68, 0.9], [62, 66, 1.0], [74, 58, 1.0], [82, 46, 1.1], [76, 34, 1.0], [64, 30, 1.2]],
    lines: [[3, 2], [2, 1], [1, 0], [0, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9]],
  },
  orange: {
    // Sagittarius: Teapot & Bow
    stars: [[91, 18, 1.4], [76, 12, 1.1], [58, 38, 1.0], [42, 58, 1.0], [22, 88, 1.1], [30, 76, 0.9], [50, 68, 0.9], [70, 52, 0.9]],
    lines: [[1, 2], [2, 3], [3, 4], [0, 2], [0, 7], [7, 6], [6, 5], [5, 3]],
  },
};

export const TOKEN_SHAPES = {
  // (while a picture loads, the plain pawn stands in)
  samurai(ctx, r, hex, sign) {
    const img = tokenPicture('samurai', sign);
    if (!img) return paintPawn(ctx, r, hex, {}, sign);
    drawPicture(ctx, r, img, 2.5);
  },
  football(ctx, r, hex, sign) {
    const img = tokenPicture('football', sign);
    if (!img) return paintPawn(ctx, r, hex, {}, sign);
    drawPicture(ctx, r, img, 2.7);
  },
  dino(ctx, r, hex, sign) {
    const img = dinoPicture(sign);
    if (!img) return TOKEN_SHAPES.dinoDrawn(ctx, r, hex);
    const h = r * 2.8;
    const w = (h * img.naturalWidth) / img.naturalHeight;
    ctx.drawImage(img, -w / 2, -h + r * 0.28, w, h);
  },
  // (stand-in while the picture loads) A little dinosaur sitting up in the player's colour: a
  // pale belly, a big friendly eye, tiny arms, and crystal points down its back and tail
  dinoDrawn(ctx, r, hex) {
    outline(ctx, r, hex);
    const dark = mix(hex, '#000000', 0.4);
    const crystal = (x, y, h, w, rot) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      path(ctx, [[-w, 0], [-w, -h * 0.62], [0, -h], [0, 0]]);
      ctx.fillStyle = '#f2f7ff';
      ctx.fill();
      path(ctx, [[0, 0], [0, -h], [w, -h * 0.62], [w, 0]]);
      ctx.fillStyle = mix(hex, '#ffffff', 0.45);
      ctx.fill();
      path(ctx, [[-w, 0], [-w, -h * 0.62], [0, -h], [w, -h * 0.62], [w, 0]]);
      ctx.lineWidth = Math.max(0.8, r * 0.035);
      ctx.strokeStyle = dark;
      ctx.stroke();
      ctx.restore();
    };
    // tail, curling round to the right, with its own little crystals
    ctx.beginPath();
    ctx.moveTo(r * 0.3, -r * 0.12);
    ctx.quadraticCurveTo(r * 1.05, -r * 0.05, r * 1.05, -r * 0.5);
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.3;
    ctx.strokeStyle = dark;
    ctx.stroke();
    ctx.lineWidth = r * 0.2;
    ctx.strokeStyle = hex;
    ctx.stroke();
    outline(ctx, r, hex);
    crystal(r * 0.78, -r * 0.24, r * 0.26, r * 0.07, 0.9);
    crystal(r * 1.0, -r * 0.48, r * 0.2, r * 0.055, 1.25);
    // back crystals, behind the body
    crystal(r * 0.56, -r * 0.48, r * 0.46, r * 0.12, 1.15);
    crystal(r * 0.62, -r * 0.86, r * 0.56, r * 0.14, 0.85);
    crystal(r * 0.42, -r * 1.2, r * 0.56, r * 0.14, 0.5);
    crystal(r * 0.18, -r * 1.86, r * 0.42, r * 0.11, 0.15);
    // feet
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.36, -r * 0.06, r * 0.24, r * 0.12, 0, 0, TAU);
      ctx.fillStyle = dark;
      ctx.fill();
    }
    // body: a round pear shape
    ctx.beginPath();
    ctx.moveTo(-r * 0.58, -r * 0.08);
    ctx.bezierCurveTo(-r * 0.78, -r * 0.7, -r * 0.48, -r * 1.12, -r * 0.05, -r * 1.12);
    ctx.bezierCurveTo(r * 0.4, -r * 1.12, r * 0.74, -r * 0.7, r * 0.58, -r * 0.08);
    ctx.closePath();
    ctx.fillStyle = cylinder(ctx, r * 0.68, hex);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-r * 0.06, -r * 0.5, r * 0.32, r * 0.42, 0, 0, TAU);
    ctx.fillStyle = mix(hex, '#fff6dc', 0.72);
    ctx.fill();
    ctx.lineWidth = Math.max(0.8, r * 0.03);
    ctx.strokeStyle = mix(hex, '#fff6dc', 0.35);
    ctx.beginPath();
    for (const y of [-0.72, -0.52, -0.32]) {
      ctx.moveTo(-r * 0.3, y * r);
      ctx.quadraticCurveTo(-r * 0.06, y * r + r * 0.05, r * 0.2, y * r);
    }
    ctx.stroke();
    outline(ctx, r, hex);
    // tiny arms
    for (const [x, rot] of [[-r * 0.5, -0.5], [r * 0.34, 0.5]]) {
      ctx.beginPath();
      ctx.ellipse(x, -r * 0.72, r * 0.13, r * 0.07, rot, 0, TAU);
      ctx.fillStyle = hex;
      ctx.fill();
      ctx.stroke();
    }
    // head: big and round, snout to the left
    ctx.beginPath();
    ctx.ellipse(-r * 0.08, -r * 1.48, r * 0.58, r * 0.46, -0.08, 0, TAU);
    ctx.fillStyle = cylinder(ctx, r * 0.58, hex);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-r * 0.46, -r * 1.36, r * 0.3, r * 0.24, 0.15, 0, TAU);
    ctx.fillStyle = mix(hex, '#ffffff', 0.15);
    ctx.fill();
    ctx.stroke();
    // nostril, smile, cheek, eye
    circle(ctx, -r * 0.64, -r * 1.42, r * 0.035);
    ctx.fillStyle = dark;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.68, -r * 1.24);
    ctx.quadraticCurveTo(-r * 0.46, -r * 1.12, -r * 0.24, -r * 1.24);
    ctx.lineWidth = Math.max(0.8, r * 0.04);
    ctx.strokeStyle = dark;
    ctx.stroke();
    circle(ctx, -r * 0.14, -r * 1.3, r * 0.08);
    ctx.fillStyle = 'rgba(255, 120, 150, 0.45)';
    ctx.fill();
    eye(ctx, -r * 0.08, -r * 1.6, r * 0.15, r * 0.17, -1);
  },
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
  // A sleek alien mothership with dual-beveled saucer hull, glowing neon energy conduit, crystal canopy and charismatic alien pilot.
  ufo(ctx, r, hex) {
    r *= 1.25;
    outline(ctx, r, hex);
    const cy = -r * 0.95;

    // 1. Underside anti-gravity propulsion dish
    ctx.beginPath();
    ctx.ellipse(0, cy + r * 0.22, r * 0.46, r * 0.16, 0, 0, TAU);
    const dishGrad = ctx.createLinearGradient(0, cy + r * 0.1, 0, cy + r * 0.35);
    dishGrad.addColorStop(0, '#2d3748');
    dishGrad.addColorStop(0.6, '#1a202c');
    dishGrad.addColorStop(1, '#0d1117');
    ctx.fillStyle = dishGrad;
    ctx.fill();
    ctx.strokeStyle = '#10141d';
    ctx.stroke();

    // Central pulsing anti-grav emitter aperture
    ctx.beginPath();
    ctx.ellipse(0, cy + r * 0.24, r * 0.28, r * 0.09, 0, 0, TAU);
    const apGrad = ctx.createRadialGradient(0, cy + r * 0.24, 0, 0, cy + r * 0.24, r * 0.28);
    apGrad.addColorStop(0, '#ffffff');
    apGrad.addColorStop(0.35, '#5cf2ff');
    apGrad.addColorStop(0.85, '#0099b8');
    apGrad.addColorStop(1, '#1a202c');
    ctx.fillStyle = apGrad;
    ctx.fill();

    // 2. Cockpit bubble canopy with multi-layer aerospace glass and alien commander
    ctx.beginPath();
    ctx.ellipse(0, cy - r * 0.32, r * 0.54, r * 0.58, 0, Math.PI, TAU);
    ctx.closePath();
    const glass = ctx.createLinearGradient(-r * 0.5, cy - r * 0.9, r * 0.5, cy);
    glass.addColorStop(0, 'rgba(240, 253, 255, 0.96)');
    glass.addColorStop(0.4, 'rgba(180, 235, 255, 0.85)');
    glass.addColorStop(1, 'rgba(92, 210, 245, 0.65)');
    ctx.fillStyle = glass;
    ctx.fill();

    // Clipped cockpit interior (alien pilot and holographic dashboard)
    ctx.save();
    ctx.clip();

    // Alien Pilot Body
    ctx.beginPath();
    ctx.ellipse(0, cy - r * 0.2, r * 0.28, r * 0.24, 0, 0, TAU);
    ctx.fillStyle = '#223042';
    ctx.fill();

    // Alien Pilot Head (pear-shaped with cranial antenna)
    ctx.beginPath();
    ctx.ellipse(0, cy - r * 0.45, r * 0.26, r * 0.3, 0, 0, TAU);
    const alienSkin = ctx.createRadialGradient(-r * 0.08, cy - r * 0.5, 0, 0, cy - r * 0.45, r * 0.28);
    alienSkin.addColorStop(0, '#a8ff78');
    alienSkin.addColorStop(0.65, '#62d645');
    alienSkin.addColorStop(1, '#3ca822');
    ctx.fillStyle = alienSkin;
    ctx.fill();

    // Cute alien antenna with glowing cyan bead
    ctx.beginPath();
    ctx.moveTo(0, cy - r * 0.72);
    ctx.lineTo(0, cy - r * 0.84);
    ctx.lineWidth = Math.max(1, r * 0.035);
    ctx.strokeStyle = '#62d645';
    ctx.stroke();
    circle(ctx, 0, cy - r * 0.84, r * 0.045);
    ctx.fillStyle = '#5cf2ff';
    ctx.fill();

    // Mesmerizing bioluminescent almond eyes with starfield iris
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.11, cy - r * 0.46, r * 0.085, r * 0.12, sx * 0.35, 0, TAU);
      const eyeGrad = ctx.createRadialGradient(sx * r * 0.09, cy - r * 0.48, 0, sx * r * 0.11, cy - r * 0.46, r * 0.12);
      eyeGrad.addColorStop(0, '#5cf2ff');
      eyeGrad.addColorStop(0.4, '#1b0a36');
      eyeGrad.addColorStop(1, '#070512');
      ctx.fillStyle = eyeGrad;
      ctx.fill();

      // Sharp white starlight glint
      circle(ctx, sx * r * 0.1 - sx * r * 0.02, cy - r * 0.5, r * 0.028);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }

    // Holographic instrument dashboard in front of alien
    ctx.beginPath();
    ctx.ellipse(0, cy - r * 0.22, r * 0.38, r * 0.12, 0, 0, TAU);
    ctx.fillStyle = '#141b26';
    ctx.fill();
    ctx.lineWidth = Math.max(0.8, r * 0.025);
    ctx.strokeStyle = 'rgba(92, 242, 255, 0.75)';
    ctx.stroke();

    // Glowing telemetry blips on console
    for (const [bx, col] of [[-0.2, '#5cf2ff'], [-0.08, '#a8ff78'], [0.08, '#ffcc00'], [0.2, '#5cf2ff']]) {
      circle(ctx, bx * r, cy - r * 0.23, r * 0.022);
      ctx.fillStyle = col;
      ctx.fill();
    }
    ctx.restore();

    // Canopy glass outer rim & specular gloss highlights
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.stroke();

    // Dual-specular gloss highlight arcs on glass
    ctx.beginPath();
    ctx.ellipse(-r * 0.22, cy - r * 0.55, r * 0.24, r * 0.12, -Math.PI / 4, 0, TAU);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.fill();

    // 3. Double-beveled saucer chassis disc
    // Lower shadowed rim
    ctx.beginPath();
    ctx.ellipse(0, cy + r * 0.08, r * 1.05, r * 0.35, 0, 0, TAU);
    ctx.fillStyle = mix(hex, '#000000', 0.55);
    ctx.fill();

    // Main saucer disc
    ctx.beginPath();
    ctx.ellipse(0, cy, r * 1.06, r * 0.38, 0, 0, TAU);
    const sg = ctx.createLinearGradient(0, cy - r * 0.38, 0, cy + r * 0.38);
    sg.addColorStop(0, mix(hex, '#ffffff', 0.55));
    sg.addColorStop(0.25, mix(hex, '#ffffff', 0.2));
    sg.addColorStop(0.65, hex);
    sg.addColorStop(1, mix(hex, '#000000', 0.45));
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.strokeStyle = mix(hex, '#000000', 0.5);
    ctx.lineWidth = Math.max(1, r * 0.045);
    ctx.stroke();

    // Inlaid glowing neon energy conduit trench along rim
    ctx.beginPath();
    ctx.ellipse(0, cy - r * 0.04, r * 0.96, r * 0.31, 0, 0, TAU);
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.strokeStyle = 'rgba(92, 242, 255, 0.85)';
    ctx.stroke();

    // Chrome base ring around cockpit canopy
    ctx.beginPath();
    ctx.ellipse(0, cy - r * 0.25, r * 0.58, r * 0.18, 0, 0, TAU);
    ctx.fillStyle = '#7a889b';
    ctx.fill();
    ctx.lineWidth = Math.max(0.8, r * 0.035);
    ctx.strokeStyle = '#3a4454';
    ctx.stroke();
  },
  dragon(ctx, r, hex, sign) {
    const img = dragonPicture(sign);
    if (!img) return TOKEN_SHAPES.dragonDrawn(ctx, r, hex);
    const h = r * 2.85;
    const w = (h * img.naturalWidth) / img.naturalHeight;
    ctx.drawImage(img, -w / 2, -h + r * 0.28, w, h);
  },
  // Fallback procedural dragon: an elder dragon perched majestically upon an obsidian & gold pedestal
  dragonDrawn(ctx, r, hex) {
    outline(ctx, r, hex);
    const dark = mix(hex, '#000000', 0.48);
    const gold = '#ffd23f';
    const goldDark = '#8e6200';

    // 1. Multi-tiered volcanic obsidian & gold plinth
    // Lower gold rim
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.04, r * 0.94, r * 0.33, 0, 0, Math.PI);
    ctx.lineTo(-r * 0.94, -r * 0.14);
    ctx.ellipse(0, -r * 0.14, r * 0.94, r * 0.33, 0, Math.PI, TAU);
    ctx.closePath();
    ctx.fillStyle = cylinder(ctx, r * 0.94, gold);
    ctx.fill();
    ctx.strokeStyle = goldDark;
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.stroke();

    // Obsidian drum body
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.14, r * 0.9, r * 0.31, 0, 0, Math.PI);
    ctx.lineTo(-r * 0.9, -r * 0.28);
    ctx.ellipse(0, -r * 0.28, r * 0.9, r * 0.31, 0, Math.PI, TAU);
    ctx.closePath();
    ctx.fillStyle = cylinder(ctx, r * 0.9, '#1a141a');
    ctx.fill();
    ctx.strokeStyle = '#382218';
    ctx.lineWidth = Math.max(0.8, r * 0.035);
    ctx.stroke();

    // Gold dragon runes around drum
    for (const rx of [-0.62, -0.31, 0, 0.31, 0.62]) {
      sparkle(ctx, rx * r, -r * 0.21 + Math.abs(rx) * r * 0.05, r * 0.045, gold);
    }

    // Polished obsidian pedestal top with golden perimeter inlay
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.28, r * 0.9, r * 0.31, 0, 0, TAU);
    const topG = ctx.createRadialGradient(-r * 0.15, -r * 0.32, 0, 0, -r * 0.28, r * 0.9);
    topG.addColorStop(0, '#2e1c22');
    topG.addColorStop(0.6, '#180e14');
    topG.addColorStop(1, '#0c070a');
    ctx.fillStyle = topG;
    ctx.fill();
    ctx.strokeStyle = gold;
    ctx.lineWidth = Math.max(1, r * 0.045);
    ctx.stroke();

    // 2. Thick muscular dragon tail coiling around the pedestal
    ctx.beginPath();
    ctx.moveTo(r * 0.15, -r * 0.4);
    ctx.bezierCurveTo(r * 0.75, -r * 0.35, r * 1.05, -r * 0.12, r * 0.78, -r * 0.04);
    ctx.bezierCurveTo(r * 0.6, 0, r * 0.7, -r * 0.32, r * 0.88, -r * 0.65);
    ctx.lineWidth = r * 0.26;
    ctx.lineCap = 'round';
    ctx.strokeStyle = dark;
    ctx.stroke();
    ctx.lineWidth = r * 0.17;
    ctx.strokeStyle = hex;
    ctx.stroke();

    // Gold spinal spines on tail
    for (const [tx, ty, rot] of [[0.62, -0.26, 0.3], [0.88, -0.15, -0.2], [0.76, -0.45, -0.5]]) {
      ctx.save();
      ctx.translate(tx * r, ty * r);
      ctx.rotate(rot);
      path(ctx, [[0, -r * 0.09], [r * 0.08, 0], [-r * 0.04, r * 0.07]]);
      ctx.fillStyle = gold;
      ctx.fill();
      ctx.restore();
    }

    // Barbed golden dragon spade blade at tail tip
    ctx.save();
    ctx.translate(r * 0.88, -r * 0.72);
    ctx.rotate(0.2);
    path(ctx, [[0, -r * 0.26], [r * 0.13, -r * 0.04], [r * 0.11, r * 0.12], [0, r * 0.05], [-r * 0.11, r * 0.12], [-r * 0.13, -r * 0.04]]);
    const spadeGrad = ctx.createLinearGradient(0, -r * 0.26, 0, r * 0.12);
    spadeGrad.addColorStop(0, '#fff4b8');
    spadeGrad.addColorStop(0.5, gold);
    spadeGrad.addColorStop(1, goldDark);
    ctx.fillStyle = spadeGrad;
    ctx.fill();
    ctx.strokeStyle = '#5a3d00';
    ctx.lineWidth = Math.max(0.8, r * 0.035);
    ctx.stroke();
    ctx.restore();

    // 3. Heavy draconic talons gripping the pedestal rim
    for (const side of [-1, 1]) {
      const footX = side * r * 0.38;
      const footY = -r * 0.26;
      // Golden scale knuckle
      circle(ctx, footX, footY, r * 0.12);
      ctx.fillStyle = cylinder(ctx, r * 0.12, mix(hex, gold, 0.35));
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(0.7, r * 0.03);
      ctx.stroke();

      // Three razor-sharp ivory claws grasping over the rim
      for (const cx of [-0.075, 0, 0.075]) {
        path(ctx, [
          [footX + cx * r, footY + r * 0.02],
          [footX + (cx + side * 0.04) * r, footY + r * 0.16],
          [footX + (cx - side * 0.03) * r, footY + r * 0.06],
        ]);
        ctx.fillStyle = '#fffde8';
        ctx.fill();
        ctx.strokeStyle = '#3a2d18';
        ctx.lineWidth = Math.max(0.6, r * 0.025);
        ctx.stroke();
      }
    }

    // 4. Symmetrical, muscular dragon body
    ctx.beginPath();
    ctx.moveTo(-r * 0.44, -r * 0.28);
    // Haunches to cinched waist
    ctx.bezierCurveTo(-r * 0.52, -r * 0.48, -r * 0.32, -r * 0.72, -r * 0.34, -r * 0.95);
    // Waist to broad shoulders
    ctx.bezierCurveTo(-r * 0.46, -r * 1.05, -r * 0.48, -r * 1.15, -r * 0.32, -r * 1.25);
    // Neck to chin
    ctx.bezierCurveTo(-r * 0.24, -r * 1.35, -r * 0.18, -r * 1.45, 0, -r * 1.45);
    // Right side (symmetrical)
    ctx.bezierCurveTo(r * 0.18, -r * 1.45, r * 0.24, -r * 1.35, r * 0.32, -r * 1.25);
    ctx.bezierCurveTo(r * 0.48, -r * 1.15, r * 0.46, -r * 1.05, r * 0.34, -r * 0.95);
    ctx.bezierCurveTo(r * 0.32, -r * 0.72, r * 0.52, -r * 0.48, r * 0.44, -r * 0.28);
    ctx.closePath();
    ctx.fillStyle = cylinder(ctx, r * 0.48, hex);
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(1, r * 0.045);
    ctx.stroke();

    // Golden shoulder crest pauldrons
    for (const sx of [-1, 1]) {
      path(ctx, [
        [sx * r * 0.32, -r * 1.25],
        [sx * r * 0.52, -r * 1.15],
        [sx * r * 0.48, -r * 1.02],
        [sx * r * 0.28, -r * 1.08],
      ]);
      ctx.fillStyle = gold;
      ctx.fill();
      ctx.strokeStyle = goldDark;
      ctx.lineWidth = Math.max(0.7, r * 0.03);
      ctx.stroke();
    }

    // 5. Armored ventral chest plates (5 overlapping golden chevron scales)
    for (let i = 0; i < 5; i++) {
      const py = -r * (1.18 - i * 0.18);
      const pw = r * (0.13 + (i < 3 ? i * 0.05 : (4 - i) * 0.04 + 0.08));
      const ph = r * 0.16;
      ctx.beginPath();
      ctx.moveTo(-pw, py);
      ctx.quadraticCurveTo(0, py + ph * 0.85, pw, py);
      ctx.lineTo(pw * 0.8, py + ph * 0.45);
      ctx.quadraticCurveTo(0, py + ph * 1.25, -pw * 0.8, py + ph * 0.45);
      ctx.closePath();
      const bg = ctx.createLinearGradient(0, py, 0, py + ph);
      bg.addColorStop(0, '#fff8d6');
      bg.addColorStop(0.55, gold);
      bg.addColorStop(1, goldDark);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.strokeStyle = '#624300';
      ctx.lineWidth = Math.max(0.8, r * 0.032);
      ctx.stroke();
    }

    // 6. Dorsal spine crest along back and neck
    for (let i = 0; i < 3; i++) {
      const sy = -r * (1.32 + i * 0.16);
      path(ctx, [[0, sy - r * 0.12], [r * 0.07, sy], [-r * 0.07, sy]]);
      ctx.fillStyle = gold;
      ctx.fill();
      ctx.strokeStyle = goldDark;
      ctx.stroke();
    }

    // 7. Grand Elder Dragon Horns (swept back, recurved, gold-banded)
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sx * r * 0.12, -r * 1.76);
      ctx.bezierCurveTo(sx * r * 0.32, -r * 2.08, sx * r * 0.65, -r * 2.38, sx * r * 0.74, -r * 2.48);
      ctx.bezierCurveTo(sx * r * 0.58, -r * 2.22, sx * r * 0.38, -r * 1.96, sx * r * 0.28, -r * 1.74);
      ctx.closePath();
      const hg = ctx.createLinearGradient(sx * r * 0.12, -r * 1.74, sx * r * 0.74, -r * 2.48);
      hg.addColorStop(0, goldDark);
      hg.addColorStop(0.4, gold);
      hg.addColorStop(0.75, '#fff6c8');
      hg.addColorStop(1, '#ffffff');
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.strokeStyle = '#5a3d00';
      ctx.lineWidth = Math.max(0.8, r * 0.035);
      ctx.stroke();

      // Golden horn ridges / rings
      for (const t of [0.32, 0.62]) {
        ctx.beginPath();
        ctx.ellipse(sx * r * (0.16 + t * 0.42), -r * (1.78 + t * 0.52), r * 0.05, r * 0.025, sx * 0.55, 0, TAU);
        ctx.fillStyle = '#fff8d6';
        ctx.fill();
      }

      // Secondary brow hornlet
      path(ctx, [[sx * r * 0.14, -r * 1.84], [sx * r * 0.32, -r * 2.02], [sx * r * 0.25, -r * 1.78]]);
      ctx.fillStyle = gold;
      ctx.fill();
      ctx.strokeStyle = goldDark;
      ctx.stroke();

      // Cheek crest horn
      path(ctx, [[sx * r * 0.28, -r * 1.48], [sx * r * 0.48, -r * 1.54], [sx * r * 0.34, -r * 1.38]]);
      ctx.fillStyle = gold;
      ctx.fill();
      ctx.strokeStyle = goldDark;
      ctx.stroke();
    }

    // 8. Sculpted ferocious dragon head (frontal, predatory, majestic)
    // Head cranium
    ctx.beginPath();
    ctx.ellipse(0, -r * 1.66, r * 0.36, r * 0.3, 0, 0, TAU);
    ctx.fillStyle = cylinder(ctx, r * 0.36, hex);
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.stroke();

    // Sculpted muzzle / snout tapering forward
    ctx.beginPath();
    ctx.moveTo(-r * 0.24, -r * 1.6);
    ctx.lineTo(-r * 0.18, -r * 1.4);
    ctx.quadraticCurveTo(0, -r * 1.34, r * 0.18, -r * 1.4);
    ctx.lineTo(r * 0.24, -r * 1.6);
    ctx.closePath();
    ctx.fillStyle = mix(hex, '#ffffff', 0.15);
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(0.9, r * 0.038);
    ctx.stroke();

    // Sharp ivory fangs protruding from upper jaw!
    for (const [fx, fy] of [[-0.14, -1.38], [-0.07, -1.36], [0.07, -1.36], [0.14, -1.38]]) {
      path(ctx, [[fx * r - r * 0.02, fy * r], [fx * r, (fy + 0.1) * r], [fx * r + r * 0.02, fy * r]]);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#3a2d18';
      ctx.lineWidth = Math.max(0.6, r * 0.025);
      ctx.stroke();
    }

    // Flared nostrils with glowing ember cores
    for (const nx of [-0.075, 0.075]) {
      circle(ctx, nx * r, -r * 1.44, r * 0.032);
      ctx.fillStyle = '#ff5722';
      ctx.fill();
      circle(ctx, nx * r, -r * 1.44, r * 0.016);
      ctx.fillStyle = '#fff59d';
      ctx.fill();
    }

    // Golden forehead crest plate & ruby gem
    path(ctx, [[0, -r * 1.94], [r * 0.1, -r * 1.8], [0, -r * 1.68], [-r * 0.1, -r * 1.8]]);
    ctx.fillStyle = gold;
    ctx.fill();
    ctx.strokeStyle = goldDark;
    ctx.lineWidth = Math.max(0.8, r * 0.035);
    ctx.stroke();
    circle(ctx, 0, -r * 1.8, r * 0.038);
    ctx.fillStyle = '#e53935';
    ctx.fill();

    // 9. Dual fierce glowing reptilian dragon eyes with vertical slit pupils
    for (const sx of [-1, 1]) {
      const eyeX = sx * r * 0.16;
      const eyeY = -r * 1.66;

      // Dark armored eye socket / heavy brow ridge
      ctx.beginPath();
      ctx.ellipse(eyeX, eyeY, r * 0.12, r * 0.09, sx * 0.2, 0, TAU);
      ctx.fillStyle = '#100c14';
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(0.8, r * 0.03);
      ctx.stroke();

      // Blazing amber/gold iris gradient
      ctx.beginPath();
      ctx.ellipse(eyeX, eyeY, r * 0.095, r * 0.075, sx * 0.2, 0, TAU);
      const eyeGrad = ctx.createRadialGradient(eyeX - sx * r * 0.02, eyeY - r * 0.02, 0, eyeX, eyeY, r * 0.095);
      eyeGrad.addColorStop(0, '#ffffff');
      eyeGrad.addColorStop(0.3, '#ffea00');
      eyeGrad.addColorStop(0.7, '#ff5722');
      eyeGrad.addColorStop(1, '#7a0000');
      ctx.fillStyle = eyeGrad;
      ctx.fill();

      // Sharp black vertical slit pupil
      ctx.beginPath();
      ctx.ellipse(eyeX, eyeY, r * 0.025, r * 0.065, sx * 0.15, 0, TAU);
      ctx.fillStyle = '#06060a';
      ctx.fill();

      // Catchlight spark
      circle(ctx, eyeX - sx * r * 0.025, eyeY - r * 0.025, r * 0.02);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
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

  // A cosmic constellation star-beast standing on a celestial obsidian plinth with golden astrolabe runes and embedded starlight.
  zodiac(ctx, r, hex, sign) {
    // 1. Multi-tiered celestial obsidian & gold plinth
    // Gold base rim
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.03, r * 0.96, r * 0.35, 0, 0, Math.PI);
    ctx.lineTo(-r * 0.96, -r * 0.12);
    ctx.ellipse(0, -r * 0.12, r * 0.96, r * 0.35, 0, Math.PI, TAU);
    ctx.closePath();
    ctx.fillStyle = cylinder(ctx, r * 0.96, GOLD);
    ctx.fill();
    ctx.strokeStyle = GOLD_DARK;
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.stroke();

    // Obsidian plinth drum
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.12, r * 0.92, r * 0.34, 0, 0, Math.PI);
    ctx.lineTo(-r * 0.92, -r * 0.28);
    ctx.ellipse(0, -r * 0.28, r * 0.92, r * 0.34, 0, Math.PI, TAU);
    ctx.closePath();
    ctx.fillStyle = cylinder(ctx, r * 0.92, '#0c1236');
    ctx.fill();
    ctx.strokeStyle = '#d9b25a';
    ctx.lineWidth = Math.max(1, r * 0.055);
    ctx.stroke();

    // Engraved celestial zodiac star runes around the drum
    for (const rx of [-0.65, -0.35, 0, 0.35, 0.65]) {
      sparkle(ctx, rx * r, -r * 0.2 + Math.abs(rx) * r * 0.06, r * 0.045, '#ffd23f');
    }

    // Polished cosmic mirror plinth top with deep nebula gradient
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.28, r * 0.92, r * 0.34, 0, 0, TAU);
    const top = ctx.createRadialGradient(-r * 0.15, -r * 0.32, 0, 0, -r * 0.28, r);
    top.addColorStop(0, '#3a4aa8');
    top.addColorStop(0.55, '#182056');
    top.addColorStop(1, '#080c24');
    ctx.fillStyle = top;
    ctx.fill();
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.stroke();

    // Inlaid golden astrological ring & miniature starfield on plinth top
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.28, r * 0.74, r * 0.27, 0, 0, TAU);
    ctx.lineWidth = Math.max(0.8, r * 0.03);
    ctx.strokeStyle = 'rgba(255, 230, 130, 0.55)';
    ctx.stroke();

    for (const [sx, sy] of [[-0.52, -0.28], [0.48, -0.22], [0.12, -0.42], [-0.22, -0.38], [0.32, -0.35]]) {
      circle(ctx, sx * r, sy * r, r * 0.03);
      ctx.fillStyle = '#fff4c4';
      ctx.fill();
    }

    // 2. The living celestial star-beast standing on the plinth
    const z = zodiacPath(sign);
    const sc = (r * 2.1) / 100;
    ctx.save();
    ctx.translate(-50 * sc, -r * 0.3 - 92 * sc);
    ctx.scale(sc, sc);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Faint celestial coordinate meridian ring
    ctx.beginPath();
    ctx.ellipse(50, 52, 46, 38, 0, 0, TAU);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 230, 140, 0.22)';
    ctx.stroke();

    // Semi-translucent cosmic nebula body fill (ethereal celestial atlas texture)
    const bg = ctx.createLinearGradient(0, 10, 0, 92);
    bg.addColorStop(0, hexA(mix(hex, '#ffffff', 0.65), 0.75));
    bg.addColorStop(0.45, hexA(hex, 0.6));
    bg.addColorStop(0.85, hexA(mix(hex, '#080c24', 0.65), 0.75));
    bg.addColorStop(1, 'rgba(8, 12, 36, 0.85)');
    ctx.fillStyle = bg;
    ctx.fill(z.body);

    // Dark contrast outer stroke
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = '#060919';
    ctx.stroke(z.lines);

    // Polished gold celestial rim
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#e9c46a';
    ctx.stroke(z.body);

    // Anatomical star line details
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#fff4c4';
    ctx.stroke(z.lines);

    // Real astronomical constellation asterism lines connecting the star nodes
    const cData = ZODIAC_STARS[sign] || ZODIAC_STARS.red;
    ctx.beginPath();
    for (const [i1, i2] of cData.lines) {
      const s1 = cData.stars[i1];
      const s2 = cData.stars[i2];
      if (s1 && s2) {
        ctx.moveTo(s1[0], s1[1]);
        ctx.lineTo(s2[0], s2[1]);
      }
    }
    ctx.lineWidth = 2.8;
    ctx.strokeStyle = 'rgba(255, 240, 160, 0.38)';
    ctx.stroke();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#fff8d6';
    ctx.stroke();

    // Real constellation stars plotted at authentic coordinates with magnitude scaling
    for (const [sx, sy, mag] of cData.stars) {
      const starR = mag * 3.0;
      // Diamond star sparkle
      sparkle(ctx, sx, sy, starR, '#ffd23f');
      // Bright white stellar core
      circle(ctx, sx, sy, starR * 0.35);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      // Prominent alpha star glow bloom
      if (mag >= 1.4) {
        circle(ctx, sx, sy, starR * 1.5);
        ctx.fillStyle = 'rgba(255, 235, 130, 0.28)';
        ctx.fill();
      }
    }
    ctx.restore();
  },
  // Two stacked 3D king checkers with fluted rims and a beveled crown star emblem.
  checker(ctx, r, hex) {
    outline(ctx, r, hex);
    const rim = mix(hex, '#ffffff', 0.24);
    const groove = mix(hex, '#000000', 0.35);
    for (const [idx, y0] of [[0, 0], [1, -r * 0.42]]) {
      ctx.beginPath();
      ctx.ellipse(0, y0 - r * 0.06, r, r * 0.44, 0, 0, Math.PI);
      ctx.lineTo(-r, y0 - r * 0.4);
      ctx.ellipse(0, y0 - r * 0.4, r, r * 0.44, 0, Math.PI, TAU);
      ctx.closePath();
      ctx.fillStyle = cylinder(ctx, r, idx ? hex : mix(hex, '#000000', 0.12));
      ctx.fill();
      ctx.stroke();
      // vertical knurled edge ridges
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = Math.max(0.8, r * 0.045);
      for (const fx of [-0.65, -0.34, 0, 0.34, 0.65]) {
        const yEdge = y0 - r * 0.4 + Math.sqrt(Math.max(0, 1 - fx * fx)) * r * 0.42;
        ctx.beginPath();
        ctx.moveTo(fx * r, yEdge);
        ctx.lineTo(fx * r, yEdge + r * 0.3);
        ctx.stroke();
      }
      outline(ctx, r, hex);
      ctx.beginPath();
      ctx.ellipse(0, y0 - r * 0.4, r, r * 0.44, 0, 0, TAU);
      ctx.fillStyle = rim;
      ctx.fill();
      ctx.stroke();
    }
    const ty = -r * 0.82;
    ctx.beginPath();
    ctx.ellipse(0, ty, r * 0.72, r * 0.3, 0, 0, TAU);
    ctx.fillStyle = groove;
    ctx.fill();
    ctx.strokeStyle = mix(hex, '#ffffff', 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, ty + r * 0.02, r * 0.62, r * 0.24, 0, 0, TAU);
    ctx.fillStyle = rim;
    ctx.fill();
    drawStar(ctx, 0, ty + r * 0.02, r * 0.3, '#ffffff');
  },

  // A luminous spectral ghost with a soft ectoplasm glow, rosy cheeks and wavy hem.
  ghost(ctx, r, hex) {
    outline(ctx, r, hex);
    const hem = -r * 0.16;
    ctx.save();
    ctx.shadowColor = mix(hex, '#ffffff', 0.45);
    ctx.shadowBlur = r * 0.45;
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, hem);
    ctx.lineTo(-r * 0.8, -r * 1.32);
    ctx.arc(0, -r * 1.32, r * 0.8, Math.PI, 0);
    ctx.lineTo(r * 0.8, hem);
    const w = (r * 1.6) / 4;
    for (let i = 0; i < 4; i++) {
      const x0 = r * 0.8 - i * w;
      ctx.quadraticCurveTo(x0 - w / 2, hem + r * 0.36, x0 - w, hem);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(-r * 0.28, -r * 1.6, r * 0.08, 0, -r * 1.05, r * 1.25);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, mix(hex, '#ffffff', 0.55));
    g.addColorStop(1, mix(hex, '#181432', 0.2));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.restore();
    // glossy sheen crest
    ctx.beginPath();
    ctx.ellipse(-r * 0.34, -r * 1.66, r * 0.16, r * 0.09, -0.5, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.44, -r * 1.12, r * 0.11, r * 0.07, 0, 0, TAU);
      ctx.fillStyle = 'rgba(255, 110, 150, 0.45)';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.26, -r * 1.36, r * 0.14, r * 0.21, 0, 0, TAU);
      ctx.fillStyle = '#191828';
      ctx.fill();
      circle(ctx, sx * r * 0.26 - r * 0.04, -r * 1.43, r * 0.055);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.96, r * 0.11, r * 0.14, 0, 0, TAU);
    ctx.fillStyle = '#191828';
    ctx.fill();
  },

  // A glossy translucent jelly blob with an inner core bubble, big eyes, and rim highlight.
  slime(ctx, r, hex) {
    outline(ctx, r, hex);
    ctx.beginPath();
    ctx.moveTo(-r * 0.98, -r * 0.12);
    ctx.bezierCurveTo(-r * 1.05, -r * 0.95, -r * 0.62, -r * 1.72, 0, -r * 1.76);
    ctx.bezierCurveTo(r * 0.62, -r * 1.72, r * 1.05, -r * 0.95, r * 0.98, -r * 0.12);
    ctx.quadraticCurveTo(0, r * 0.18, -r * 0.98, -r * 0.12);
    ctx.closePath();
    const g = ctx.createRadialGradient(-r * 0.25, -r * 1.25, r * 0.08, 0, -r * 0.8, r * 1.2);
    g.addColorStop(0, mix(hex, '#ffffff', 0.68));
    g.addColorStop(0.55, hex);
    g.addColorStop(1, mix(hex, '#000000', 0.34));
    ctx.fillStyle = g;
    ctx.fill();
    // suspended inner jelly bubbles
    for (const [bx, by, br] of [[0.38, -0.5, 0.1], [-0.46, -0.45, 0.08], [0.16, -1.36, 0.07]]) {
      circle(ctx, bx * r, by * r, br * r);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fill();
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-r * 0.42, -r * 1.33, r * 0.22, r * 0.1, -0.5, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
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

  // An aerospace rocket with metallic cylindrical fuselage, heat-shield fins, titanium nozzle and illuminated command cockpit.
  rocket(ctx, r, hex) {
    outline(ctx, r, hex);

    // 1. Swept aerodynamic delta fins (with heat-shield bevel & navigation beacon lights)
    for (const sx of [-1, 1]) {
      // Fin base
      path(ctx, [
        [sx * r * 0.36, -r * 1.05],
        [sx * r * 0.94, -r * 0.32],
        [sx * r * 0.88, -r * 0.12],
        [sx * r * 0.34, -r * 0.44],
      ]);
      const finGrad = ctx.createLinearGradient(sx * r * 0.36, -r * 1.05, sx * r * 0.94, -r * 0.12);
      finGrad.addColorStop(0, mix(hex, '#ffffff', 0.25));
      finGrad.addColorStop(0.5, mix(hex, '#000000', 0.2));
      finGrad.addColorStop(1, mix(hex, '#000000', 0.65));
      ctx.fillStyle = finGrad;
      ctx.fill();
      ctx.strokeStyle = mix(hex, '#000000', 0.55);
      ctx.stroke();

      // Fin leading edge highlight
      ctx.beginPath();
      ctx.moveTo(sx * r * 0.36, -r * 1.05);
      ctx.lineTo(sx * r * 0.94, -r * 0.32);
      ctx.lineWidth = Math.max(1, r * 0.04);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.stroke();

      // Wingtip navigation beacon lights (red on left/port, cyan/green on right/starboard)
      circle(ctx, sx * r * 0.91, -r * 0.28, r * 0.05);
      ctx.fillStyle = sx < 0 ? '#ff3b30' : '#34c759';
      ctx.fill();
    }
    outline(ctx, r, hex);

    // 2. Heavy-duty titanium engine bell (exhaust nozzle)
    ctx.beginPath();
    ctx.moveTo(-r * 0.24, -r * 0.42);
    ctx.lineTo(-r * 0.36, -r * 0.2);
    ctx.quadraticCurveTo(0, -r * 0.14, r * 0.36, -r * 0.2);
    ctx.lineTo(r * 0.24, -r * 0.42);
    ctx.closePath();
    const bellGrad = ctx.createLinearGradient(-r * 0.36, 0, r * 0.36, 0);
    bellGrad.addColorStop(0, '#2c3240');
    bellGrad.addColorStop(0.3, '#737f96');
    bellGrad.addColorStop(0.7, '#3d4454');
    bellGrad.addColorStop(1, '#1b1f28');
    ctx.fillStyle = bellGrad;
    ctx.fill();
    ctx.strokeStyle = '#15171e';
    ctx.stroke();

    // Ribbed cooling rings on nozzle
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.28, r * 0.3, r * 0.07, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = Math.max(0.8, r * 0.035);
    ctx.stroke();

    // Superheated glowing nozzle throat interior
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.2, r * 0.34, r * 0.09, 0, 0, TAU);
    const throatGrad = ctx.createRadialGradient(0, -r * 0.2, 0, 0, -r * 0.2, r * 0.34);
    throatGrad.addColorStop(0, '#fff9c4');
    throatGrad.addColorStop(0.4, '#ff9100');
    throatGrad.addColorStop(0.85, '#d50000');
    throatGrad.addColorStop(1, '#2c1010');
    ctx.fillStyle = throatGrad;
    ctx.fill();

    // 3. Sleek aerodynamic rocket fuselage
    ctx.beginPath();
    ctx.moveTo(-r * 0.44, -r * 0.4);
    ctx.bezierCurveTo(-r * 0.54, -r * 1.3, -r * 0.32, -r * 1.95, 0, -r * 2.36);
    ctx.bezierCurveTo(r * 0.32, -r * 1.95, r * 0.54, -r * 1.3, r * 0.44, -r * 0.4);
    ctx.closePath();
    ctx.fillStyle = cylinder(ctx, r * 0.48, hex);
    ctx.fill();
    ctx.save();
    ctx.clip();

    // Multi-panel structural seams and crisp racing stripes
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.fillRect(-r * 0.07, -r * 2.4, r * 0.14, r * 2.1);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fillRect(-r * 0.16, -r * 2.4, r * 0.05, r * 2.1);
    ctx.fillRect(r * 0.11, -r * 2.4, r * 0.05, r * 2.1);

    // Nosecone heat cap
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.ellipse(0, -r * 2.05, r * 0.3, r * 0.1, 0, 0, TAU);
    ctx.fillRect(-r * 0.3, -r * 2.4, r * 0.6, r * 0.35);

    // Micro-rivets along horizontal panel seam
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    for (const rx of [-0.35, -0.22, 0.22, 0.35]) {
      circle(ctx, rx * r, -r * 0.72, r * 0.022);
      ctx.fill();
    }
    ctx.restore();
    outline(ctx, r, hex);
    ctx.stroke();

    // Horizontal fuselage panel seam lines
    ctx.lineWidth = Math.max(0.8, r * 0.03);
    ctx.strokeStyle = mix(hex, '#000000', 0.45);
    for (const py of [-0.72, -1.68]) {
      ctx.beginPath();
      ctx.ellipse(0, py * r, r * 0.42 * (py === -0.72 ? 1 : 0.7), r * 0.08, 0, 0, TAU);
      ctx.stroke();
    }

    // 4. Reinforced command cockpit porthole (double titanium rim with 6 micro-rivets)
    const portY = -r * 1.25;
    const portR = r * 0.24;

    // Outer titanium bezel
    circle(ctx, 0, portY, portR);
    const bezelGrad = ctx.createLinearGradient(-portR, portY - portR, portR, portY + portR);
    bezelGrad.addColorStop(0, '#f0f4f8');
    bezelGrad.addColorStop(0.5, '#9aa6b8');
    bezelGrad.addColorStop(1, '#535c6e');
    ctx.fillStyle = bezelGrad;
    ctx.fill();
    ctx.lineWidth = Math.max(0.8, r * 0.035);
    ctx.strokeStyle = '#2d3340';
    ctx.stroke();

    // Micro-rivets around bezel
    for (let i = 0; i < 6; i++) {
      const ba = (i * TAU) / 6;
      circle(ctx, Math.cos(ba) * portR * 0.85, portY + Math.sin(ba) * portR * 0.85, r * 0.022);
      ctx.fillStyle = '#2d3340';
      ctx.fill();
    }

    // Deep-space glass viewport with glowing cockpit HUD telemetry
    circle(ctx, 0, portY, portR * 0.68);
    const glassGrad = ctx.createRadialGradient(-portR * 0.2, portY - portR * 0.2, 0, 0, portY, portR * 0.68);
    glassGrad.addColorStop(0, '#102a54');
    glassGrad.addColorStop(0.65, '#071226');
    glassGrad.addColorStop(1, '#020610');
    ctx.fillStyle = glassGrad;
    ctx.fill();

    // Illuminated cockpit HUD (miniature cyan radar arc & amber telemetry blip)
    ctx.beginPath();
    ctx.arc(0, portY, portR * 0.45, -0.6 * Math.PI, 0.2 * Math.PI);
    ctx.lineWidth = Math.max(0.6, r * 0.025);
    ctx.strokeStyle = 'rgba(92, 242, 255, 0.85)';
    ctx.stroke();
    circle(ctx, portR * 0.22, portY + portR * 0.15, r * 0.025);
    ctx.fillStyle = '#ffb300';
    ctx.fill();

    // High-gloss spherical glass catchlight arc
    ctx.beginPath();
    ctx.ellipse(-portR * 0.25, portY - portR * 0.25, portR * 0.28, portR * 0.14, -Math.PI / 4, 0, TAU);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fill();

    // 5. Nosecone sensor probe needle
    ctx.beginPath();
    ctx.moveTo(0, -r * 2.36);
    ctx.lineTo(0, -r * 2.48);
    ctx.lineWidth = Math.max(1, r * 0.045);
    ctx.strokeStyle = '#e0e6ed';
    ctx.stroke();
    circle(ctx, 0, -r * 2.48, r * 0.038);
    ctx.fillStyle = '#5cf2ff';
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
  g.addColorStop(0.28, mix(color, '#ffffff', 0.32));
  g.addColorStop(0.55, color);
  g.addColorStop(0.88, mix(color, '#000000', 0.28));
  g.addColorStop(0.96, mix(color, '#ffffff', 0.1));
  g.addColorStop(1, mix(color, '#000000', 0.3));
  return g;
}

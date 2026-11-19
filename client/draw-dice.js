// Every dice: the faces, artwork, pips, props and the tumbling 3D cube. (Split out of renderer.js.)
import { IDENTITY, TAU, apply, circle, easeOutBack, hexA, mix, mul, path, pawPrint, polygon, rnd, rotX, rotY, roundRect, snowflake, sparkle, zodiacOutline } from './draw-util.js';
import { DICE_STYLES } from './skins.js';

// ---------- dice ----------
// The dice is a real cube: it is rotated in 3D and the faces turned towards you are drawn.

export const PIPS = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

// Where the stars sit on a speckled (galaxy) dice face: x, y, size.
export const SPECKS = [
  [-38, -30, 1.6], [-20, -42, 1], [6, -36, 1.4], [30, -40, 1], [40, -18, 1.8], [-42, 4, 1.2], [-14, -12, 1],
  [18, -6, 1.2], [38, 12, 1], [-30, 26, 1.8], [-6, 40, 1.2], [22, 34, 1.6], [42, 40, 1], [-44, 42, 1],
];

// Each face: its value, outward normal and two in-face axes (y points down). Opposite faces add up to 7.
export const FACES = [
  { value: 1, n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { value: 6, n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  { value: 2, n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { value: 5, n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { value: 3, n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { value: 4, n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
];
// Rotation that turns a value's face towards the viewer.
export const FACE_FRONT = {
  1: rotY(0),
  6: rotY(Math.PI),
  2: rotY(-Math.PI / 2),
  5: rotY(Math.PI / 2),
  3: rotX(-Math.PI / 2),
  4: rotX(Math.PI / 2),
};
// A slight tilt (0 = flat, 1 = full), so the top and right faces show as well.
export const tiltBy = (t) => mul(rotX(-0.42 * t), rotY(-0.5 * t));
export const LIGHT = [-0.35, -0.6, 0.72].map((c, _, a) => c / Math.hypot(...a));

// A dice skin's colours; skins with `playerColor` take on the roller's colour.
export function diceStyle(styleId, color, sign) {
  const st = DICE_STYLES[styleId] || DICE_STYLES['dice-classic'];
  // Constellation-style dice take the roller's colour for their nebula and show their sign
  if (st.signed) return color ? { ...st, tint: color, sign: sign || 'red' } : { ...st, sign: sign || 'red' };
  if (!st.playerColor || !color) return st;
  return { ...st, edge: color, pip: color, outline: color };
}

// One face of the dice in its own coordinates (-50..50). The flat dice and every face of the
// 3D cube use this, so the cube's front face looks exactly like the flat dice it turns into.
// `light` < 1 darkens faces turned away from you; `px` is one face unit in pixels; `t` is the
// time in ms, for skins that move (twinkling stars, glowing cracks, a glint sweeping across).
export function paintFace(ctx, st, value, { light = 1, pips = true, glow = null, px = 1, t = 0, solid = false } = {}) {
  let fill = st.face;
  if (st.shine) {
    fill = ctx.createLinearGradient(-50, -50, 50, 50);
    fill.addColorStop(0, st.shine);
    fill.addColorStop(1, st.face);
  }
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = 45 * px;
  }
  const cr = solid ? 6 : 16;
  roundRect(ctx, -50, -50, 100, 100, cr);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.save();
  roundRect(ctx, -50, -50, 100, 100, cr);
  ctx.clip();
  if (st.art) DICE_ART[st.art](ctx, st, t);
  if (pips) {
    if (value && st.links) {
      // join the pips with fine gold lines, like a constellation
      const p = PIPS[value];
      ctx.strokeStyle = 'rgba(240, 205, 120, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [i, j] of PIP_LINKS[value]) {
        ctx.moveTo(p[i][0] * 27, p[i][1] * 27);
        ctx.lineTo(p[j][0] * 27, p[j][1] * 27);
      }
      ctx.stroke();
    }
    if (value) {
      PIPS[value].forEach(([x, y], i) => (PIP_STYLES[st.pips || 'round'])(ctx, x * 27, y * 27, 10, st, i, t, px));
    } else {
      ctx.fillStyle = st.pip;
      ctx.font = '800 58px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, 3);
    }
  }
  ctx.shadowBlur = 0;
  // Faces turned away from the light are darker
  if (light < 1) {
    ctx.fillStyle = `rgba(0,0,0,${(1 - light).toFixed(3)})`;
    ctx.fillRect(-50, -50, 100, 100);
  }
  ctx.restore();

  roundRect(ctx, -50, -50, 100, 100, cr);
  if (st.outline) {
    ctx.shadowColor = st.outline;
    ctx.shadowBlur = (st.pulse ? 14 + 8 * Math.sin(t / 260) : 20) * px;
  }
  // On the 3D cube the faces meet at the edges, so each one gets only a fine seam (a heavy
  // border round every face made the cube look like separate sheets). Glowing dice keep their rim.
  ctx.lineWidth = solid && !st.outline ? 1.5 : 3;
  ctx.strokeStyle = st.outline || (solid ? mix(st.face, st.edge, 0.55) : st.edge);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ---------- dice artwork ----------
// Drawn inside the face (clipped), under the pips. Coordinates -50..50.

// A bright band sweeping across the face every `every` ms
export function glint(ctx, t, every = 3200, alpha = 0.55) {
  const k = (t % every) / every;
  if (k > 0.35) return;
  const x = -90 + (k / 0.35) * 180;
  const g = ctx.createLinearGradient(x - 22, x - 22, x + 22, x + 22);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-50, -50, 100, 100);
}

// Small four-point stars that twinkle
export function twinkles(ctx, t, n, color, seed = 1) {
  for (let i = 0; i < n; i++) {
    const x = -46 + rnd(i * 3 + seed) * 92;
    const y = -46 + rnd(i * 3 + seed + 1) * 92;
    const a = 0.35 + 0.65 * Math.max(0, Math.sin(t / 420 + rnd(i + seed * 7) * 20));
    const r = 1.2 + rnd(i * 5 + seed) * 2.2;
    ctx.globalAlpha = a;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 2);
    ctx.quadraticCurveTo(x, y, x + r * 2, y);
    ctx.quadraticCurveTo(x, y, x, y + r * 2);
    ctx.quadraticCurveTo(x, y, x - r * 2, y);
    ctx.quadraticCurveTo(x, y, x, y - r * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Cracks: a fixed network of jagged lines
export const CRACKS = [
  [[-50, -18], [-30, -12], [-22, 4], [-38, 22], [-50, 30]],
  [[-22, 4], [2, 10], [18, -6], [34, -2], [50, -14]],
  [[2, 10], [8, 30], [-4, 50]],
  [[18, -6], [12, -28], [24, -50]],
  [[34, -2], [40, 22], [50, 34]],
  [[-30, -12], [-34, -36], [-20, -50]],
];
export function strokeCracks(ctx) {
  ctx.beginPath();
  for (const line of CRACKS) line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
}

// One cherry-blossom petal, pointing up from (0, 0), `len` long, with the notch at its tip
function petal(ctx, len, fill) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-len * 0.55, -len * 0.25, -len * 0.55, -len * 0.85, -len * 0.16, -len);
  ctx.lineTo(0, -len * 0.84);
  ctx.lineTo(len * 0.16, -len);
  ctx.bezierCurveTo(len * 0.55, -len * 0.85, len * 0.55, -len * 0.25, 0, 0);
  ctx.fillStyle = fill;
  ctx.fill();
}

export const DICE_ART = {
  // Pale pink, with faint blossoms pressed into it (sakura)
  sakura(ctx) {
    const g = ctx.createRadialGradient(-14, -16, 6, 0, 0, 74);
    g.addColorStop(0, '#fff6f9');
    g.addColorStop(1, '#ffd3e2');
    ctx.fillStyle = g;
    ctx.fillRect(-50, -50, 100, 100);
    for (const [x, y, s, a] of [[-34, 30, 14, 0.4], [32, -34, 12, 1.2], [36, 34, 9, 2.1], [-30, -36, 8, 0.9]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      for (let i = 0; i < 5; i++) {
        ctx.rotate(TAU / 5);
        petal(ctx, s, 'rgba(255, 143, 182, 0.18)');
      }
      ctx.restore();
    }
  },
  // Slime: wobbly green jelly, lit from inside
  goo(ctx, st, t) {
    const g = ctx.createRadialGradient(-12, -16, 6, 0, 0, 78);
    g.addColorStop(0, '#d6ff9a');
    g.addColorStop(0.55, st.face);
    g.addColorStop(1, '#2f8a26');
    ctx.fillStyle = g;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    for (let i = 0; i < 5; i++) {
      const y = 44 - (((t / 4000 + i * 0.23) % 1) * 96);
      circle(ctx, -36 + ((i * 41) % 76), y, 3 + (i % 3) * 2);
      ctx.fill();
    }
  },
  // Robot: brushed steel plates, a seam down the middle, a row of status lights
  steel(ctx, st, t) {
    const g = ctx.createLinearGradient(-50, -50, 50, 50);
    g.addColorStop(0, '#e6ecf5');
    g.addColorStop(0.5, '#9aa6ba');
    g.addColorStop(1, '#6f7a8c');
    ctx.fillStyle = g;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.strokeStyle = 'rgba(40, 48, 64, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(-42, -42, 84, 84);
    const lit = Math.floor(t / 300) % 4;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i === lit ? '#5cf2ff' : 'rgba(30, 40, 60, 0.45)';
      ctx.fillRect(-15 + i * 8.5, 40, 5, 4);
    }
  },
  // Dragon: overlapping scales, a glow of embers from below
  scales(ctx, st, t) {
    ctx.fillStyle = st.face;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    for (let row = 0; row < 8; row++) {
      for (let col = -1; col < 7; col++) {
        const x = -50 + col * 17 + (row % 2 ? 8.5 : 0);
        const y = -50 + row * 13;
        ctx.fillStyle = (row + col) % 3 ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 190, 90, 0.16)';
        ctx.beginPath();
        ctx.arc(x + 8.5, y, 9.5, 0, Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    }
    const g = ctx.createLinearGradient(0, 10, 0, 50);
    g.addColorStop(0, 'rgba(255, 120, 30, 0)');
    g.addColorStop(1, `rgba(255, 120, 30, ${(0.3 + 0.15 * Math.sin(t / 300)).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(-50, 0, 100, 50);
  },
  // Bubble: clear sea-water, light rippling across it
  water(ctx, st, t) {
    const g = ctx.createLinearGradient(0, -50, 0, 50);
    g.addColorStop(0, '#c9f6ff');
    g.addColorStop(1, st.face);
    ctx.fillStyle = g;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 4; i++) {
      const y = -34 + i * 24 + Math.sin(t / 700 + i) * 3;
      ctx.beginPath();
      ctx.moveTo(-50, y);
      ctx.bezierCurveTo(-20, y - 9, 10, y + 9, 50, y - 2);
      ctx.stroke();
    }
  },
  // Navy sky in a gold ring; the pips are stars joined into a little constellation
  zodiac(ctx, st, t) {
    const g = ctx.createRadialGradient(-18, -22, 4, 0, 0, 78);
    g.addColorStop(0, st.tint ? mix(st.tint, '#101850', 0.45) : '#26306e');
    g.addColorStop(1, st.tint ? mix(st.tint, '#05071e', 0.82) : '#070a26');
    ctx.fillStyle = g;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.globalCompositeOperation = 'lighter';
    const n = ctx.createRadialGradient(18, 22, 0, 18, 22, 58);
    n.addColorStop(0, st.tint ? hexA(st.tint, 0.55) : 'rgba(140, 70, 220, 0.35)');
    n.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = n;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.globalCompositeOperation = 'source-over';
    twinkles(ctx, t, 9, '#fff3d0', 11);
    if (st.sign) zodiacOutline(ctx, st.sign, 2, 4, 80, st.tint ? hexA(mix(st.tint, '#ffffff', 0.55), 0.6) : 'rgba(240, 210, 140, 0.45)', 2.2, st.tint || null);
    ctx.strokeStyle = 'rgba(217, 178, 90, 0.75)';
    ctx.lineWidth = 1.6;
    roundRect(ctx, -42, -42, 84, 84, 10);
    ctx.stroke();
    ctx.lineWidth = 0.8;
    roundRect(ctx, -38, -38, 76, 76, 8);
    ctx.stroke();
  },
  // Night sky: a deep gradient and twinkling stars
  night(ctx, st, t) {
    const g = ctx.createRadialGradient(-20, -25, 5, 0, 0, 80);
    g.addColorStop(0, '#2c3a78');
    g.addColorStop(1, '#0b1030');
    ctx.fillStyle = g;
    ctx.fillRect(-50, -50, 100, 100);
    twinkles(ctx, t, 10, '#fff7d6', 3);
  },
  // Wood grain with a knot
  grain(ctx) {
    ctx.strokeStyle = 'rgba(110, 66, 28, 0.45)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 9; i++) {
      const y0 = -50 + i * 12 + rnd(i) * 4;
      ctx.beginPath();
      for (let x = -52; x <= 52; x += 4) ctx.lineTo(x, y0 + Math.sin(x / 13 + i) * 3 + Math.sin(x / 5 + i * 3) * 0.8);
      ctx.stroke();
    }
    ctx.lineWidth = 1.4;
    for (let k = 1; k <= 3; k++) {
      ctx.beginPath();
      ctx.ellipse(30, 34, k * 4.5, k * 2.6, 0.3, 0, TAU);
      ctx.stroke();
    }
    const v = ctx.createRadialGradient(0, 0, 30, 0, 0, 72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(60,30,5,0.35)');
    ctx.fillStyle = v;
    ctx.fillRect(-50, -50, 100, 100);
  },
  // A cut gem: a bright table in the middle, four bevelled facets lit from the top-left
  gem(ctx, st, t) {
    const [hi, mid, lo, deep] = st.facets;
    const fac = (pts, c) => {
      path(ctx, pts);
      ctx.fillStyle = c;
      ctx.fill();
    };
    fac([[-50, -50], [50, -50], [24, -24], [-24, -24]], hi);
    fac([[-50, -50], [-24, -24], [-24, 24], [-50, 50]], mid);
    fac([[50, -50], [50, 50], [24, 24], [24, -24]], lo);
    fac([[-50, 50], [-24, 24], [24, 24], [50, 50]], deep);
    const g = ctx.createLinearGradient(-24, -24, 24, 24);
    g.addColorStop(0, hi);
    g.addColorStop(1, mid);
    fac([[-24, -24], [24, -24], [24, 24], [-24, 24]], g);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const [a, b] of [[[-50, -50], [-24, -24]], [[50, -50], [24, -24]], [[50, 50], [24, 24]], [[-50, 50], [-24, 24]]]) {
      ctx.moveTo(...a);
      ctx.lineTo(...b);
    }
    ctx.rect(-24, -24, 48, 48);
    ctx.stroke();
    glint(ctx, t, 2800, 0.6);
  },
  // Emerald step cut: rings of bevels stepping in towards a long table
  stepcut(ctx, st, t) {
    const [hi, mid, lo] = st.facets;
    for (let k = 0; k < 4; k++) {
      const m = 50 - k * 9;
      const g = ctx.createLinearGradient(-m, -m, m, m);
      g.addColorStop(0, k % 2 ? hi : mid);
      g.addColorStop(1, lo);
      ctx.fillStyle = g;
      octagon(ctx, m, m * 0.36);
      ctx.fill();
      ctx.strokeStyle = 'rgba(220,255,235,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    glint(ctx, t, 3400, 0.5);
    twinkles(ctx, t, 3, '#ffffff', 11);
  },
  // Brushed gold with a shine sweeping across
  metal(ctx, st, t) {
    const g = ctx.createLinearGradient(-50, -50, 50, 50);
    g.addColorStop(0, '#fff2b0');
    g.addColorStop(0.3, '#f0c44c');
    g.addColorStop(0.55, '#b8860b');
    g.addColorStop(0.8, '#f5d36a');
    g.addColorStop(1, '#a87910');
    ctx.fillStyle = g;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.8;
    for (let y = -48; y < 50; y += 3) {
      ctx.beginPath();
      ctx.moveTo(-50, y);
      ctx.lineTo(50, y + rnd(y) * 2);
      ctx.stroke();
    }
    glint(ctx, t, 2600, 0.75);
  },
  // Frosted ice: cold gradient, white cracks, crystals in the corners, a glint
  frost(ctx, st, t) {
    const g = ctx.createLinearGradient(-50, -50, 50, 50);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#d6f0fc');
    g.addColorStop(1, '#9fd2ee');
    ctx.fillStyle = g;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.2;
    strokeCracks(ctx);
    ctx.stroke();
    for (const [x, y] of [[-40, -40], [40, 40], [40, -40], [-40, 40]]) snowflake(ctx, x, y, 7, 'rgba(255,255,255,0.85)', 1.3);
    glint(ctx, t, 3000, 0.7);
  },
  // Peppermint: a red-and-white pinwheel that slowly turns
  peppermint(ctx, st, t) {
    ctx.save();
    ctx.rotate(t / 3000);
    for (let i = 0; i < 12; i++) {
      if (i % 2) continue;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 80, (i / 12) * TAU, ((i + 1) / 12) * TAU);
      ctx.closePath();
      ctx.fillStyle = '#ff4f7b';
      ctx.fill();
    }
    ctx.restore();
    const g = ctx.createRadialGradient(-18, -22, 4, 0, 0, 70);
    g.addColorStop(0, 'rgba(255,255,255,0.65)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-50, -50, 100, 100);
  },
  // The four Ludo colours, one per corner as on a Ludo board, with a white star in the middle
  ludo(ctx, st) {
    const [red, green, yellow, blue] = st.quads;
    for (const [x, y, c] of [[-50, -50, red], [0, -50, green], [0, 0, yellow], [-50, 0, blue]]) {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 50, 50);
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -50);
    ctx.lineTo(0, 50);
    ctx.moveTo(-50, 0);
    ctx.lineTo(50, 0);
    ctx.stroke();
    const g = ctx.createLinearGradient(0, -50, 0, 50);
    g.addColorStop(0, 'rgba(255,255,255,0.28)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-50, -50, 100, 100);
  },
  // Cooling lava: dark rock with cracks that glow and pulse
  magma(ctx, st, t) {
    const g = ctx.createRadialGradient(0, 10, 10, 0, 0, 75);
    g.addColorStop(0, '#3a1610');
    g.addColorStop(1, '#140806');
    ctx.fillStyle = g;
    ctx.fillRect(-50, -50, 100, 100);
    const pulse = 0.55 + 0.45 * Math.sin(t / 380);
    strokeCracks(ctx);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#ff6a1a';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = `rgba(255, 110, 30, ${0.5 + 0.4 * pulse})`;
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255, 220, 120, ${0.5 + 0.5 * pulse})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.lineCap = 'butt';
  },
  // Deep space: drifting nebula clouds and twinkling stars
  nebula(ctx, st, t) {
    ctx.fillStyle = '#0d0726';
    ctx.fillRect(-50, -50, 100, 100);
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, r, c, sp] of [[-22, -18, 46, 'rgba(160, 60, 255, 0.55)', 1], [26, 20, 42, 'rgba(255, 70, 170, 0.45)', -1.3], [18, -30, 30, 'rgba(60, 140, 255, 0.45)', 0.8]]) {
      const dx = Math.sin(t / 1800 * sp) * 8;
      const dy = Math.cos(t / 2100 * sp) * 6;
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-50, -50, 100, 100);
    }
    ctx.globalCompositeOperation = 'source-over';
    twinkles(ctx, t, 14, '#ffffff', 5);
  },
  // Neon: a faint grid in the glow colour
  grid(ctx, st, t) {
    ctx.strokeStyle = st.edge;
    ctx.globalAlpha = 0.14 + 0.06 * Math.sin(t / 300);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = -40; k <= 40; k += 13.3) {
      ctx.moveTo(k, -50);
      ctx.lineTo(k, 50);
      ctx.moveTo(-50, k);
      ctx.lineTo(50, k);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  },
  // A ginger tabby: stripes curling in from the edges, and little ears on top
  tabby(ctx) {
    const g = ctx.createRadialGradient(-10, -14, 6, 0, 0, 72);
    g.addColorStop(0, '#ffd09a');
    g.addColorStop(1, '#f0a050');
    ctx.fillStyle = g;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.fillStyle = 'rgba(176, 92, 26, 0.55)';
    for (const [x, y, a] of [[-50, -26, 0], [-50, 6, 0.1], [-50, 32, -0.1], [50, -20, Math.PI], [50, 12, Math.PI + 0.1], [50, 36, Math.PI - 0.1]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.quadraticCurveTo(14, -6, 22, 0);
      ctx.quadraticCurveTo(14, 3, 0, 4);
      ctx.fill();
      ctx.restore();
    }
    for (const x of [-16, 0, 16]) {
      ctx.beginPath();
      ctx.moveTo(x - 4, -50);
      ctx.quadraticCurveTo(x, -38, x + 4, -50);
      ctx.fill();
    }
  },
};

export function octagon(ctx, m, c) {
  path(ctx, [[-m + c, -m], [m - c, -m], [m, -m + c], [m, m - c], [m - c, m], [-m + c, m], [-m, m - c], [-m, -m + c]]);
}

// ---------- pip styles ----------
// (ctx, x, y, r, style, pip index, time, px)
// How the pips of each face are joined when a dice draws them as a constellation
export const PIP_LINKS = {
  1: [],
  2: [[0, 1]],
  3: [[0, 1], [1, 2]],
  4: [[0, 1], [1, 3], [3, 2]],
  5: [[0, 2], [2, 1], [2, 3], [3, 4]],
  6: [[0, 2], [2, 4], [4, 5], [5, 3], [3, 1]],
};

export const PIP_STYLES = {
  // a glowing four-pointed star
  star(ctx, x, y, r, st, i, t, px) {
    const tw = 0.85 + 0.15 * Math.sin(t / 300 + i * 1.9);
    ctx.shadowColor = '#fff1c2';
    ctx.shadowBlur = 12 * px;
    sparkle(ctx, x, y, r * 1.55 * tw, st.pip);
    ctx.fillStyle = '#ffffff';
    circle(ctx, x, y, r * 0.38);
    ctx.fill();
    ctx.shadowBlur = 0;
  },
  round(ctx, x, y, r, st, i) {
    ctx.fillStyle = st.pipColors ? st.pipColors[i % st.pipColors.length] : st.pip;
    circle(ctx, x, y, r);
    ctx.fill();
  },
  // Lit from inside (neon, galaxy, midnight)
  glow(ctx, x, y, r, st, i, t, px) {
    ctx.shadowColor = st.pip;
    ctx.shadowBlur = 14 * px;
    ctx.fillStyle = st.pip;
    circle(ctx, x, y, r * 0.95);
    ctx.fill();
    ctx.shadowBlur = 0;
    circle(ctx, x - r * 0.3, y - r * 0.3, r * 0.3);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
  },
  // Holes drilled into the face, with a lit lower edge (wood, classic-ish)
  inset(ctx, x, y, r, st) {
    circle(ctx, x, y, r);
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#000000');
    g.addColorStop(1, st.pip);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  },
  // Shiny pearls / balls in the pip colour (ruby, emerald, ice, gold)
  pearl(ctx, x, y, r, st) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, st.pip);
    g.addColorStop(1, st.pipDark || mix(st.pip, '#000000', 0.45));
    circle(ctx, x, y, r);
    ctx.fillStyle = g;
    ctx.fill();
  },
  // Stamped into metal: dark with a bright rim at the bottom-right
  engraved(ctx, x, y, r, st) {
    circle(ctx, x, y, r);
    ctx.fillStyle = st.pip;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, -0.1 * Math.PI, 0.6 * Math.PI);
    ctx.strokeStyle = 'rgba(255, 245, 200, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
  },
  // Sweets in different colours, each with a highlight (candy)
  candy(ctx, x, y, r, st, i) {
    const c = st.pipColors[i % st.pipColors.length];
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 3;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, c);
    g.addColorStop(1, mix(c, '#000000', 0.2));
    circle(ctx, x, y, r * 1.05);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;
  },
  // White pips with a dark ring, readable on any colour (Ludo)
  outlined(ctx, x, y, r, st) {
    circle(ctx, x, y, r);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
  },
  // Molten: yellow-hot centres that flicker
  magma(ctx, x, y, r, st, i, t, px) {
    const f = 0.75 + 0.25 * Math.sin(t / 140 + i * 1.7);
    ctx.shadowColor = '#ff7a1a';
    ctx.shadowBlur = 16 * px * f;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, '#fff6b0');
    g.addColorStop(0.5, '#ffb52e');
    g.addColorStop(1, '#ff5a1a');
    circle(ctx, x, y, r);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;
  },
  // Little five-petal blossoms with a yellow heart (sakura)
  blossom(ctx, x, y, r, st, i) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(i * 0.7);
    for (let n = 0; n < 5; n++) {
      ctx.rotate(TAU / 5);
      petal(ctx, r * 1.25, st.pip);
    }
    circle(ctx, 0, 0, r * 0.38);
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
    ctx.restore();
  },
  // Paw prints (cat)
  paw(ctx, x, y, r, st) {
    pawPrint(ctx, x, y, r * 1.15, st.pip);
  },
};

// Draws a flat dice centred on (cx, cy) showing one face. `value` null shows "?".
export function drawDice(ctx, cx, cy, size, value, styleId, { alpha = 1, glow = null, color = null, sign = null, t = performance.now(), fx = true } = {}) {
  const st = diceStyle(styleId, color, sign);
  const k = (size * 0.96) / 100; // same size as the cube's face when it lands
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.lineJoin = 'round';
  const prop = fx && DICE_PROPS[st.prop];
  if (prop) prop(ctx, st, t / 1000, 'back', 1);
  // A darker edge underneath gives it a little thickness
  ctx.fillStyle = st.edge;
  roundRect(ctx, -50, -43, 100, 100, 16);
  ctx.fill();
  paintFace(ctx, st, value, { glow, px: k, t });
  if (prop) prop(ctx, st, t / 1000, 'front', 1);
  ctx.restore();
  if (st.sparks && fx) diceSparks(ctx, cx, cy, size, st.sparks, t, 0); // (fx false: a still picture)
}

// The Legendary dice's sparkles: now and then one glints at a corner while the dice rests
// (`whirl` 0); while it tumbles (`whirl` up to 1) a ring of them swirls round it.
export function diceSparks(ctx, cx, cy, size, colors, t, whirl) {
  const s = t / 1000;
  ctx.save();
  ctx.translate(cx, cy);
  if (whirl > 0.02) {
    for (let i = 0; i < 7; i++) {
      const a = s * 5 + (i * TAU) / 7;
      const rad = size * (0.62 + 0.14 * Math.sin(s * 3 + i * 1.9));
      ctx.globalAlpha = Math.min(1, whirl * 1.6) * (0.55 + 0.45 * Math.sin(s * 9 + i * 2.4));
      sparkle(ctx, Math.cos(a) * rad, Math.sin(a) * rad * 0.8, size * (0.1 + 0.05 * (i % 3)), colors[i % colors.length]);
    }
  } else {
    const spots = [[-0.5, -0.5], [0.52, -0.44], [0.46, 0.5], [-0.48, 0.42]];
    spots.forEach(([x, y], i) => {
      const a = Math.max(0, Math.sin(s * 1.6 - i * 1.57)) ** 8;
      if (a < 0.03) return;
      ctx.globalAlpha = a;
      sparkle(ctx, x * size, y * size, size * 0.2 * (0.5 + 0.5 * a), colors[i % colors.length]);
    });
  }
  ctx.restore();
}

// Draws the dice as a tumbling 3D cube, with the `value` face towards you after `spin`.
// As `tilt` reaches 0 only that face shows, so it hands over smoothly to the flat dice.
export function drawDiceCube(ctx, cx, cy, size, value, styleId, { spin = IDENTITY, tilt = 1, alpha = 1, glow = null, color = null, sign = null, t = performance.now() } = {}) {
  const st = diceStyle(styleId, color, sign);
  const R = mul(tiltBy(tilt), mul(spin, FACE_FRONT[value || 1]));
  const h = size * (0.48 - 0.08 * tilt); // half the cube's edge; a flat face is drawn a little bigger
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  // One solid cube. The body is drawn first, in the dice's own colour: a rounded cube is a
  // smaller cube grown by a ball, and its outline on screen is the smaller cube's outline grown by
  // a disc, so fill that and stroke it thick and round. The faces then sit on it and meet at the
  // edges, so the rounded edges and corners between them show the body, not a dark gap.
  // Its props (ears, flames, a crown…) are tucked away while it tumbles and pop out as it lands
  const prop = DICE_PROPS[st.prop];
  const out = prop ? Math.max(0, 1 - tilt * 2.2) : 0;
  const pop = out > 0 ? easeOutBack(out) : 0;
  const propAt = (part) => {
    ctx.save();
    ctx.scale((size * 0.96) / 100, (size * 0.96) / 100);
    ctx.globalAlpha *= Math.min(1, out * 2);
    prop(ctx, st, t / 1000, part, pop);
    ctx.restore();
  };
  if (pop > 0) propAt('back');
  const k = 0.05; // tight seam backfill that never balloons past the 3D faces
  const corners = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push(apply(R, [x, y, z]).map((c) => c * h * (1 - k)));
  const hull = convexHull(corners);
  const body = st.outline ? mix(st.face, st.outline, 0.3) : mix(st.face, st.edge, 0.3);
  ctx.beginPath();
  hull.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.strokeStyle = body;
  ctx.lineWidth = Math.max(1.5, h * 0.08);
  ctx.fill();
  ctx.stroke();
  // Faces turned towards you: filter out edge-on slivers (< 0.06 nz) that cause detached line artifacts
  const shown = FACES.map((f) => ({ f, n: apply(R, f.n) }))
    .filter(({ n }) => n[2] > 0.06)
    .sort((a, b) => a.n[2] - b.n[2]);
  for (const { f, n } of shown) {
    const u = apply(R, f.u);
    const v = apply(R, f.v);
    // Full brightness when facing you, darker as it turns away (from the top-left light).
    const side = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1]);
    const light = Math.min(1, 0.58 + 0.42 * n[2] + 0.12 * side);

    // Draw the face in its own flat coordinates, -50..50 on each side.
    ctx.save();
    ctx.transform((u[0] * h) / 50, (u[1] * h) / 50, (v[0] * h) / 50, (v[1] * h) / 50, n[0] * h, n[1] * h);
    // Faces seen at steep angles get no pips: avoids cut-off pips spilling past edges
    paintFace(ctx, st, value ? f.value : null, { light, pips: n[2] > 0.28, glow, px: h / 50, t, solid: true });
    ctx.restore();
  }
  if (pop > 0) propAt('front');
  ctx.restore();
  if (st.sparks && tilt > 0) diceSparks(ctx, cx, cy, size, st.sparks, t, tilt * alpha);
}


// ---------- dice props ----------
// What makes each dice more than a painted cube: things that stick out of it and move (art.prop
// in DICE_STYLES). Drawn in the face's own frame (-50..50, y down), in two halves: 'back' before
// the dice (ears, wings, rays behind it) and 'front' after it (whiskers, drips, a crown on top).
// t: seconds. k: 0..1 as they pop out when a tumbling dice lands (1 at rest).
export const INK = '#2a1838';
export const DICE_PROPS = {
  // A blossoming twig over the top corner, and petals drifting down past the dice (sakura)
  sakura(ctx, st, t, part, k) {
    if (part === 'back') return;
    // the twig, laid over the top-left corner and reaching out above the top edge
    ctx.save();
    ctx.translate(-50, -46);
    ctx.scale(k, k);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#6b3f2a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-8, 18);
    ctx.quadraticCurveTo(10, -10, 52, -14);
    ctx.stroke();
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(24, -11);
    ctx.quadraticCurveTo(30, -24, 24, -32);
    ctx.stroke();
    // blossoms along it, swaying a touch
    const sway = Math.sin(t * 1.4) * 0.08;
    for (const [x, y, s] of [[52, -14, 12], [24, -32, 10], [4, 2, 9]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(sway);
      for (let i = 0; i < 5; i++) {
        ctx.rotate(TAU / 5);
        petal(ctx, s, '#ffb7d0');
      }
      ctx.lineWidth = 1.2;
      circle(ctx, 0, 0, s * 0.32);
      ctx.fillStyle = '#e2457a';
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    // a few petals falling slowly past, turning as they go
    for (let i = 0; i < 4; i++) {
      const p = (t * 0.18 + i * 0.27) % 1;
      const x = -40 + i * 28 + Math.sin(t * 1.1 + i * 2) * 10;
      const y = -60 + p * 140;
      ctx.save();
      ctx.globalAlpha *= Math.sin(p * Math.PI) * 0.85;
      ctx.translate(x, y);
      ctx.rotate(t * 1.5 + i);
      ctx.scale(1, 0.5 + 0.5 * Math.abs(Math.sin(t * 2 + i)));
      petal(ctx, 9, '#ff9cc1');
      ctx.restore();
    }
  },
  // Ghost: no feet, just a ragged hem that ripples, and a pale glow round it
  ghost(ctx, st, t, part, k) {
    if (part !== 'back') return;
    const g = ctx.createRadialGradient(0, 0, 30, 0, 0, 92);
    g.addColorStop(0, 'rgba(200, 190, 255, 0.5)');
    g.addColorStop(1, 'rgba(200, 190, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(-92, -92, 184, 184);
    ctx.beginPath();
    ctx.moveTo(-50, 30);
    for (let i = 0; i <= 5; i++) {
      const x = -50 + i * 20;
      const d = (16 + 7 * Math.sin(t * 4 + i * 1.7)) * k;
      if (i) ctx.quadraticCurveTo(x - 10, 56 + d * 1.5, x, 54 + (i % 2 ? d : 4));
      else ctx.lineTo(x, 54 + 4);
    }
    ctx.lineTo(50, 30);
    ctx.closePath();
    ctx.fillStyle = st.face;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = st.edge;
    ctx.stroke();
  },
  // Duck: a beak, a tuft of feathers, flapping wings and two webbed feet
  duck(ctx, st, t, part, k) {
    if (part === 'back') {
      const flap = Math.sin(t * 9) * 0.3 * (Math.sin(t * 1.3) > 0.4 ? 1 : 0.15);
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * 46, 6);
        ctx.scale(side * k, 1);
        ctx.rotate(-0.2 + flap);
        ctx.beginPath();
        ctx.ellipse(16, 0, 22, 13, 0.3, 0, TAU);
        ctx.fillStyle = st.face;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = st.edge;
        ctx.stroke();
        ctx.restore();
        path(ctx, [[side * 22 - 12, 52], [side * 22, 52 + 16 * k], [side * 22 + 12, 52]]);
        ctx.fillStyle = '#ff9a2e';
        ctx.fill();
      }
      ctx.lineCap = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = st.edge;
      ctx.beginPath();
      for (const dx of [-8, 0, 8]) {
        ctx.moveTo(0, -46);
        ctx.quadraticCurveTo(dx, -58, dx * 1.6, -50 - 14 * k);
      }
      ctx.stroke();
      return;
    }
    ctx.beginPath();
    ctx.ellipse(48 + 8 * k, 6, 15, 8, 0, 0, TAU);
    ctx.fillStyle = '#ff9a2e';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#b85f0c';
    ctx.stroke();
  },
  // Snowball: a bobble hat on top, and snow falling round it
  bobble(ctx, st, t, part, k) {
    if (part === 'back') {
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 7; i++) {
        const p = (t * 0.3 + i / 7) % 1;
        ctx.globalAlpha = 0.9 * (1 - p);
        circle(ctx, -62 + ((i * 53) % 124) + Math.sin(t * 2 + i) * 4, -70 + p * 140, 3 + (i % 3));
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    ctx.save();
    ctx.translate(0, -48);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.ellipse(0, 0, 38, 30, 0, Math.PI, TAU);
    ctx.closePath();
    ctx.fillStyle = st.hat || '#e2566a';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.stroke();
    roundRect(ctx, -42, -5, 84, 13, 6);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();
    circle(ctx, 0, -34 + Math.sin(t * 3) * 1.5, 10);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  },
  // Comet: a tail of fire streaming off behind it
  comet(ctx, st, t, part, k) {
    if (part !== 'back') return;
    ctx.save();
    ctx.rotate(-0.7);
    for (let i = 0; i < 5; i++) {
      const w = (30 - i * 5) * (1 + 0.15 * Math.sin(t * 11 + i * 2));
      const len = (150 - i * 22 + 14 * Math.sin(t * 7 + i)) * k;
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, ['#ff5a1a', '#ff8a2a', '#ffb02e', '#ffe14d', '#fff7c2'][i]);
      g.addColorStop(1, 'rgba(255, 120, 30, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(20, -w);
      ctx.quadraticCurveTo(len * 0.6, -w * 0.5 + Math.sin(t * 9 + i) * 5, len, 0);
      ctx.quadraticCurveTo(len * 0.6, w * 0.5 + Math.cos(t * 8 + i) * 5, 20, w);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },
  // Alien: two eyes on stalks that look about and blink, and rings of light under it
  alien(ctx, st, t, part, k) {
    if (part !== 'back') return;
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.6 + i / 3) % 1;
      ctx.globalAlpha = (1 - p) * 0.7;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#aaffe6';
      ctx.beginPath();
      ctx.ellipse(0, 56 + p * 22, 34 + p * 30, 8 + p * 6, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const look = Math.sin(t * 1.4) * 3;
    const blink = Math.sin(t * 0.9) > 0.97;
    for (const side of [-1, 1]) {
      const ex = side * 24 + Math.sin(t * 2 + side) * 2;
      const ey = -48 - 30 * k;
      ctx.lineCap = 'round';
      ctx.lineWidth = 7;
      ctx.strokeStyle = st.edge;
      ctx.beginPath();
      ctx.moveTo(side * 18, -44);
      ctx.quadraticCurveTo(side * 30, -60, ex, ey);
      ctx.stroke();
      circle(ctx, ex, ey, 12);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.stroke();
      if (blink) {
        ctx.fillStyle = st.face;
        ctx.fill();
      } else {
        circle(ctx, ex + look, ey + 1, 5);
        ctx.fillStyle = '#12301a';
        ctx.fill();
      }
    }
  },
  // Cat: ears that twitch, whiskers, and a tail that swishes
  cat(ctx, st, t, part, k) {
    const fur = st.face;
    const dark = st.edge;
    if (part === 'back') {
      const twitch = Math.max(0, Math.sin(t * 1.3)) ** 12 * 0.25;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * 30, -44);
        ctx.rotate(side * (0.12 + (side > 0 ? twitch : 0)));
        ctx.scale(1, k);
        path(ctx, [[-17, 4], [0, -30], [17, 4]]);
        ctx.fillStyle = fur;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = dark;
        ctx.stroke();
        path(ctx, [[-8, 2], [0, -17], [8, 2]]);
        ctx.fillStyle = '#ffb3c1';
        ctx.fill();
        ctx.restore();
      }
      // the tail, out to the right
      const sw = Math.sin(t * 2.4) * 0.35;
      ctx.save();
      ctx.translate(46, 36);
      ctx.rotate(-0.5 + sw);
      ctx.scale(k, k);
      ctx.lineCap = 'round';
      ctx.lineWidth = 15;
      ctx.strokeStyle = dark;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(26, -4, 30, -32);
      ctx.stroke();
      ctx.lineWidth = 9.5;
      ctx.strokeStyle = fur;
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(60, 30, 10, 0.75)';
    ctx.beginPath();
    for (const side of [-1, 1]) {
      for (const dy of [-5, 5]) {
        ctx.moveTo(side * 46, 22 + dy * 0.4);
        ctx.lineTo(side * (46 + 20 * k), 20 + dy);
      }
    }
    ctx.stroke();
  },
  // Candy: a sweet in its wrapper, twisted at both ends
  candy(ctx, st, t, part, k) {
    if (part !== 'back') return;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 46, 4);
      ctx.scale(side * k, 1);
      ctx.rotate(Math.sin(t * 2 + side) * 0.06);
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(30, -30);
      ctx.quadraticCurveTo(24, 0, 30, 30);
      ctx.lineTo(0, 9);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = st.edge;
      ctx.stroke();
      ctx.lineWidth = 5;
      ctx.strokeStyle = st.pip;
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(27, -17);
      ctx.moveTo(6, 0);
      ctx.lineTo(27, 17);
      ctx.moveTo(8, 0);
      ctx.lineTo(25, 0);
      ctx.stroke();
      ctx.restore();
    }
  },
  // Ice: icicles hanging off it, one of them dripping
  ice(ctx, st, t, part, k) {
    if (part !== 'front') return;
    const g = ctx.createLinearGradient(0, 46, 0, 84);
    g.addColorStop(0, '#f4fbff');
    g.addColorStop(1, 'rgba(127, 196, 232, 0.75)');
    ctx.fillStyle = g;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    [[-36, 20], [-20, 34], [-4, 16], [14, 28], [32, 18]].forEach(([x, len]) => {
      ctx.beginPath();
      ctx.moveTo(x - 7, 50);
      ctx.lineTo(x, 50 + len * k);
      ctx.lineTo(x + 7, 50);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
    const d = (t * 0.7) % 1;
    ctx.globalAlpha *= 1 - d;
    ctx.fillStyle = '#bfe6fa';
    circle(ctx, -20, 86 + d * 26, 3.2);
    ctx.fill();
  },
  // Lava: flames licking up from the top
  lava(ctx, st, t, part, k) {
    if (part !== 'back') return;
    for (let i = 0; i < 6; i++) {
      const x = -38 + i * 15.2;
      const h = (26 + 16 * Math.sin(t * 7 + i * 1.9) + 8 * Math.sin(t * 13 + i)) * k;
      const sway = Math.sin(t * 5 + i * 2.3) * 5;
      const g = ctx.createLinearGradient(0, -44, 0, -50 - h);
      g.addColorStop(0, '#ff5a1a');
      g.addColorStop(0.5, '#ffb02e');
      g.addColorStop(1, 'rgba(255, 240, 170, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - 10, -42);
      ctx.quadraticCurveTo(x - 9 + sway, -50 - h * 0.5, x + sway, -50 - h);
      ctx.quadraticCurveTo(x + 9 + sway, -50 - h * 0.5, x + 10, -42);
      ctx.closePath();
      ctx.fill();
    }
  },
  // Galaxy: a ringed planet's ring round it, and a little moon in orbit
  galaxy(ctx, st, t, part, k) {
    ctx.save();
    ctx.rotate(-0.38);
    ctx.scale(k, k);
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(190, 160, 255, 0.85)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 80, 22, 0, part === 'back' ? Math.PI : 0, part === 'back' ? TAU : Math.PI);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 80, 22, 0, part === 'back' ? Math.PI : 0, part === 'back' ? TAU : Math.PI);
    ctx.stroke();
    const a = t * 1.6;
    if (Math.sin(a) > 0 === (part === 'front')) {
      circle(ctx, Math.cos(a) * 80, Math.sin(a) * 22, 6);
      ctx.fillStyle = '#ffe9a8';
      ctx.fill();
    }
    ctx.restore();
  },
  // Neon: electricity crackling off the corners
  neon(ctx, st, t, part, k) {
    if (part !== 'front') return;
    const step = Math.floor(t * 9);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = st.outline;
    ctx.shadowColor = st.outline;
    ctx.shadowBlur = 10;
    for (let c = 0; c < 4; c++) {
      if (rnd(step * 7 + c) < 0.45) continue;
      const sx = c % 2 ? 1 : -1;
      const sy = c < 2 ? -1 : 1;
      ctx.beginPath();
      let x = sx * 48;
      let y = sy * 48;
      ctx.moveTo(x, y);
      for (let i = 0; i < 3; i++) {
        x += sx * (5 + 9 * rnd(step + c * 3 + i)) * k;
        y += sy * (5 + 9 * rnd(step * 3 + c + i * 5)) * k;
        ctx.lineTo(x + (rnd(step + i + c) - 0.5) * 8, y + (rnd(step * 2 + i + c) - 0.5) * 8);
      }
      ctx.stroke();
    }
  },
  // Gold: the crown jewels. Rays of light turn behind it, a jewelled crown sits on top, and a
  // gem is set in every corner.
  gold(ctx, st, t, part, k) {
    if (part === 'back') {
      ctx.save();
      ctx.rotate(t * 0.35);
      for (let i = 0; i < 12; i++) {
        ctx.rotate(TAU / 12);
        const len = (i % 2 ? 78 : 96) * k;
        const g = ctx.createLinearGradient(0, -40, 0, -len);
        g.addColorStop(0, 'rgba(255, 226, 120, 0.75)');
        g.addColorStop(1, 'rgba(255, 226, 120, 0)');
        ctx.fillStyle = g;
        path(ctx, [[-9, -40], [0, -len], [9, -40]]);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    // gems in the corners
    [['#e23b55', -38, -38], ['#3fb6ff', 38, -38], ['#3fd08a', -38, 38], ['#b07bff', 38, 38]].forEach(([c, x, y], i) => {
      path(ctx, polygon(4, 7).map(([px, py]) => [x + px, y + py]));
      ctx.fillStyle = c;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#fff3c0';
      ctx.stroke();
      const a = Math.max(0, Math.sin(t * 2.4 - i * 1.5)) ** 8;
      if (a > 0.05) {
        ctx.globalAlpha = a;
        sparkle(ctx, x, y, 9, '#ffffff');
        ctx.globalAlpha = 1;
      }
    });
    // the crown, bobbing a little
    ctx.save();
    ctx.translate(0, -50 + Math.sin(t * 2) * 1.5);
    ctx.scale(k, k);
    path(ctx, [[-26, 2], [-32, -26], [-15, -12], [0, -34], [15, -12], [32, -26], [26, 2]]);
    const g = ctx.createLinearGradient(-30, 0, 30, 0);
    g.addColorStop(0, '#c9971c');
    g.addColorStop(0.4, '#fff1b0');
    g.addColorStop(1, '#a87a10');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#7a5600';
    ctx.stroke();
    for (const [x, y, c] of [[-32, -26, '#fff1b0'], [0, -34, '#e23b55'], [32, -26, '#fff1b0'], [0, -6, '#3fb6ff']]) {
      circle(ctx, x, y, 4.5);
      ctx.fillStyle = c;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  },
  // Constellation: a halo of stars turning round it, joined by a fine gold line
  cosmos(ctx, st, t, part, k) {
    ctx.save();
    ctx.rotate(0.3);
    ctx.scale(k, k);
    const back = part === 'back';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(240, 205, 120, 0.6)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 78, 26, 0, back ? Math.PI : 0, back ? TAU : Math.PI);
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const a = t * 0.9 + (i * TAU) / 5;
      if (Math.sin(a) > 0 === back) continue;
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 3 + i * 2);
      sparkle(ctx, Math.cos(a) * 78, Math.sin(a) * 26, i % 2 ? 7 : 10, i % 2 ? '#bcd0ff' : '#fff1c2');
    }
    ctx.restore();
  },
  // Midnight: the moon peeping over one corner
  moon(ctx, st, t, part, k) {
    if (part !== 'back') return;
    ctx.save();
    ctx.translate(34, -40 - 8 * k);
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 34);
    g.addColorStop(0, 'rgba(255, 240, 190, 0.5)');
    g.addColorStop(1, 'rgba(255, 240, 190, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(-34, -34, 68, 68);
    circle(ctx, 0, 0, 17);
    ctx.fillStyle = '#fff3c4';
    ctx.fill();
    ctx.fillStyle = 'rgba(200, 180, 120, 0.5)';
    circle(ctx, -5, -4, 4);
    ctx.fill();
    circle(ctx, 6, 3, 2.5);
    ctx.fill();
    ctx.restore();
  },
  // Wood: a sprig still growing out of the top
  sprout(ctx, st, t, part, k) {
    if (part !== 'back') return;
    ctx.save();
    ctx.translate(-14, -46);
    ctx.rotate(Math.sin(t * 1.6) * 0.07);
    ctx.scale(k, k);
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#6b4a1f';
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.quadraticCurveTo(-2, -12, 6, -24);
    ctx.stroke();
    for (const [x, y, r, rot] of [[6, -24, 13, -0.5], [-3, -12, 10, -2.4]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(r, -r * 0.7, r * 1.6, 0);
      ctx.quadraticCurveTo(r, r * 0.7, 0, 0);
      ctx.fillStyle = '#6cbf4a';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#3e7f28';
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  },
  // Ruby, Emerald: the cut stone flashes at one corner, then another
  flash(ctx, st, t, part) {
    if (part !== 'front') return;
    [[-40, -40], [40, -34], [36, 40], [-38, 36]].forEach(([x, y], i) => {
      const a = Math.max(0, Math.sin(t * 1.8 - i * 1.57)) ** 10;
      if (a < 0.04) return;
      ctx.globalAlpha = a;
      sparkle(ctx, x, y, 16 * (0.5 + 0.5 * a), '#ffffff');
    });
    ctx.globalAlpha = 1;
  },
  // Ludo: a little pawn standing on top, hopping
  pawn(ctx, st, t, part, k) {
    if (part !== 'back') return;
    const hop = Math.abs(Math.sin(t * 2.2)) * 7;
    ctx.save();
    ctx.translate(20, -50 - hop);
    ctx.scale(k, k);
    ctx.fillStyle = '#d24d47';
    ctx.strokeStyle = '#8c2b27';
    ctx.lineWidth = 2.5;
    path(ctx, [[-13, 4], [-5, -14], [5, -14], [13, 4]]);
    ctx.fill();
    ctx.stroke();
    circle(ctx, 0, -20, 9);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  },
  // Slime: goo running down over the top edge, a bubble rising in it
  slime(ctx, st, t, part, k) {
    if (part !== 'front') return;
    ctx.beginPath();
    ctx.moveTo(-52, -52);
    ctx.lineTo(52, -52);
    ctx.lineTo(52, -30);
    const drips = [[40, 12], [22, 30], [4, 8], [-14, 24], [-34, 38]];
    let x = 52;
    for (const [dx, len] of drips) {
      const d = len * k * (0.8 + 0.2 * Math.sin(t * 1.7 + dx));
      ctx.quadraticCurveTo(x - 2, -30 + d * 0.2, dx + 8, -30 + d * 0.5);
      ctx.quadraticCurveTo(dx + 8, -22 + d, dx, -22 + d);
      ctx.quadraticCurveTo(dx - 8, -22 + d, dx - 8, -30 + d * 0.5);
      x = dx - 8;
    }
    ctx.quadraticCurveTo(-50, -34, -52, -30);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -52, 0, 10);
    g.addColorStop(0, '#b8f26a');
    g.addColorStop(1, '#4fbf3a');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#2f8a26';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.beginPath();
    ctx.ellipse(-26, -42, 12, 4, -0.1, 0, TAU);
    ctx.fill();
  },
  // Robot: an aerial with a blinking light, and a bolt in the side of its head
  robot(ctx, st, t, part, k) {
    if (part === 'back') {
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#6f7a8c';
      ctx.beginPath();
      ctx.moveTo(18, -46);
      ctx.lineTo(18 + Math.sin(t * 3) * 2, -46 - 30 * k);
      ctx.stroke();
      const on = Math.sin(t * 5) > 0;
      const bx = 18 + Math.sin(t * 3) * 2;
      const by = -46 - 34 * k;
      if (on) {
        const g = ctx.createRadialGradient(bx, by, 1, bx, by, 20);
        g.addColorStop(0, 'rgba(255, 90, 90, 0.8)');
        g.addColorStop(1, 'rgba(255, 90, 90, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(bx - 20, by - 20, 40, 40);
      }
      circle(ctx, bx, by, 7);
      ctx.fillStyle = on ? '#ff5a5a' : '#8a2f2f';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#3a4252';
      ctx.stroke();
      for (const side of [-1, 1]) {
        roundRect(ctx, side * 48 - (side > 0 ? 0 : 12 * k), -12, 12 * k, 24, 3);
        ctx.fillStyle = '#8f9bb0';
        ctx.fill();
        ctx.stroke();
      }
      return;
    }
    ctx.fillStyle = '#3a4252';
    for (const [x, y] of [[-41, -41], [41, -41], [-41, 41], [41, 41]]) {
      circle(ctx, x, y, 3.2);
      ctx.fill();
    }
  },
  // Dragon: horns, and wings that beat
  dragon(ctx, st, t, part, k) {
    if (part !== 'back') {
      // a wisp of smoke from its nostrils
      for (let i = 0; i < 3; i++) {
        const p = (t * 0.5 + i / 3) % 1;
        ctx.globalAlpha = (1 - p) * 0.45;
        ctx.fillStyle = '#e8e2dc';
        circle(ctx, 30 + p * 26 + Math.sin(p * 9 + i) * 4, -30 - p * 34, 4 + p * 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    const beat = Math.sin(t * 5) * 0.28;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 44, -8);
      ctx.scale(side * k, 1);
      ctx.rotate(-0.25 + beat);
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.lineTo(18, -34);
      ctx.lineTo(52, -44);
      ctx.quadraticCurveTo(44, -22, 50, -6);
      ctx.quadraticCurveTo(38, -10, 34, 6);
      ctx.quadraticCurveTo(24, -2, 16, 14);
      ctx.closePath();
      ctx.fillStyle = st.wing || '#c2412d';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = st.edge;
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(18, -34);
      ctx.lineTo(34, 6);
      ctx.moveTo(18, -34);
      ctx.lineTo(50, -6);
      ctx.stroke();
      ctx.restore();
      // horns
      ctx.save();
      ctx.translate(side * 28, -46);
      ctx.scale(side, k);
      ctx.beginPath();
      ctx.moveTo(-9, 4);
      ctx.quadraticCurveTo(-2, -22, 16, -30);
      ctx.quadraticCurveTo(8, -12, 9, 4);
      ctx.closePath();
      ctx.fillStyle = '#f3e3c0';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#8a6a3a';
      ctx.stroke();
      ctx.restore();
    }
  },
  // Bubble: bubbles rising off it
  bubbles(ctx, st, t, part, k) {
    if (part !== 'front') return;
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const p = (t * (0.25 + 0.08 * (i % 3)) + i * 0.37) % 1;
      const x = -40 + ((i * 37) % 80) + Math.sin(t * 2 + i) * 5;
      const y = -36 - p * 52 * k;
      const r = 4 + (i % 3) * 2.5;
      ctx.globalAlpha = Math.min(1, (1 - p) * 1.6) * 0.9;
      ctx.strokeStyle = '#eafcff';
      ctx.fillStyle = 'rgba(190, 240, 255, 0.3)';
      circle(ctx, x, y, r);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      circle(ctx, x - r * 0.35, y - r * 0.35, r * 0.25);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
};

// A dice tumbling in 3D outside the board (the shop's close-up). `left` runs from 1 (just thrown)
// to 0 (landed, `value` towards you); `axes` set how many turns it makes around x and y.
export function drawTumblingDice(ctx, cx, cy, size, value, styleId, left, axes = [2.5, 1.5], opts = {}) {
  const spin = mul(rotX(axes[0] * TAU * left), rotY(axes[1] * TAU * left));
  drawDiceCube(ctx, cx, cy, size, value, styleId, { ...opts, spin, tilt: Math.min(1, left * 2) });
}

// The outline of some points on screen (their x, y), in order round the outside.
export function convexHull(points) {
  const pts = points.map(([x, y]) => [x, y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

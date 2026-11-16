// Small drawing helpers shared by the board, the tokens and the dice. (Split out of renderer.js.)

export const TAU = Math.PI * 2;

// ---------- 3D maths (row-major 3x3 matrices) ----------

export const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function rotX(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

export function rotY(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

export function mul(a, b) {
  const m = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) m.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
  }
  return m;
}

export function apply(m, [x, y, z]) {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

// A player's shape (colour-blind mode), centred on (x, y) and about `r` from centre to edge.
// `stroke` (optional) outlines it with `lineWidth`, so it reads on any background.
export function drawShape(ctx, shape, x, y, r, fill, stroke, lineWidth = 1) {
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(x, y, r * 0.85, 0, TAU);
  } else if (shape === 'square') {
    const h = r * 0.75;
    ctx.rect(x - h, y - h, h * 2, h * 2);
  } else if (shape === 'diamond') {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.8, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r * 0.8, y);
  } else if (shape === 'triangle') {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.95, y + r * 0.7);
    ctx.lineTo(x - r * 0.95, y + r * 0.7);
  } else {
    // plus, or a plus turned 45° for the cross
    const t = r * 0.34;
    const pts = [[-t, -r], [t, -r], [t, -t], [r, -t], [r, t], [t, t], [t, r], [-t, r], [-t, t], [-r, t], [-r, -t], [-t, -t]];
    const turn = shape === 'cross' ? Math.PI / 4 : 0;
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    pts.forEach(([px, py], i) => {
      const qx = x + (px * c - py * sn) * 0.9;
      const qy = y + (px * sn + py * c) * 0.9;
      if (i) ctx.lineTo(qx, qy);
      else ctx.moveTo(qx, qy);
    });
  }
  ctx.closePath();
  ctx.lineJoin = 'round';
  if (stroke) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
  ctx.fillStyle = fill;
  ctx.fill();
}

// Team A gold, team B blue (the same as the A/B badges in the player list)
export const TEAM_COLORS = ['#ffc83a', '#5c9dff'];
export function teamBadge(ctx, x, y, r, team) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = TEAM_COLORS[team];
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, r * 0.22);
  ctx.strokeStyle = '#141824';
  ctx.stroke();
  ctx.fillStyle = '#141824';
  ctx.font = `900 ${Math.round(r * 1.3)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('AB'[team], x, y + r * 0.06);
  ctx.restore();
}

export function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, TAU);
}

// Image emotes (from packs) are shared between the DOM buttons and the canvas:
// one element per URL so the browser does the fetching once.
export const emoteImgs = new Map();
export function emoteImg(url) {
  let im = emoteImgs.get(url);
  if (!im) {
    im = new Image();
    im.src = url;
    emoteImgs.set(url, im);
  }
  return im;
}

// The four spots in a base where pins wait, like the circles on a real Ludo board:
// a disc in the player's colour with a soft inset rim, so it reads as a hollow to stand in.
// Soft dents in a cushion where the pins sit
export function drawDents(ctx, b, spread, r) {
  for (const [ox, oy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = b.x + ox * spread;
    const y = b.y + oy * spread;
    const g = ctx.createRadialGradient(x, y + r * 0.1, 0, x, y, r);
    g.addColorStop(0, 'rgba(120, 72, 32, 0.2)');
    g.addColorStop(0.7, 'rgba(120, 72, 32, 0.08)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.8, 0, 0, TAU);
    ctx.fill();
  }
}

// The Cat board's base corners: a paw print, a ball of yarn with its loose end, claw scratches
export function catDecor(ctx, x, y, outer, color, k) {
  const ink = mix(color, '#3a2010', 0.45);
  const m = outer - 0.48;
  ctx.save();
  ctx.globalAlpha = 0.6;
  pawPrint(ctx, x - m, y - m, 0.22, ink);
  // yarn ball
  const bx = x - m;
  const by = y + m;
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 0.035;
  ctx.lineCap = 'round';
  ctx.strokeStyle = ink;
  circle(ctx, bx, by, 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(bx - 0.28, by - 0.02, 0.3, -0.75, 0.75);
  ctx.moveTo(bx + 0.14, by - 0.16);
  ctx.quadraticCurveTo(bx - 0.04, by, bx + 0.12, by + 0.17);
  ctx.moveTo(bx + 0.2, by + 0.04);
  ctx.bezierCurveTo(bx + 0.45, by + 0.15, bx + 0.35, by - 0.2, bx + 0.62, by - 0.05);
  ctx.stroke();
  // claw scratches
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const sx = x + m - 0.3 + i * 0.12;
    ctx.moveTo(sx, y - m - 0.18);
    ctx.quadraticCurveTo(sx + 0.12, y - m, sx + 0.06, y - m + 0.2);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawPinSpots(ctx, b, spread, r, color) {
  for (const [ox, oy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = b.x + ox * spread;
    const y = b.y + oy * spread;
    ctx.fillStyle = color;
    circle(ctx, x, y, r);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.lineWidth = r * 0.3;
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    circle(ctx, x, y - r * 0.08, r);
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = r * 0.12;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    circle(ctx, x, y, r);
    ctx.stroke();
  }
}

export function polygon(n, r) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * TAU - Math.PI / 2;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
}

export function path(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Blends two #rrggbb colours: t = 0 gives `a`, t = 1 gives `b`.
// A shape colour that stands out on a tile of colour `hex`: dark on light colours (like yellow), white otherwise.
export function inkOn(hex) {
  const p = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((p >> 16) & 255) + 0.587 * ((p >> 8) & 255) + 0.114 * (p & 255)) / 255;
  return lum > 0.6 ? { fill: 'rgba(0,0,0,0.62)', edge: null } : { fill: '#ffffff', edge: 'rgba(0,0,0,0.5)' };
}

export function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

export function easeOutBack(k) {
  const c = 1.70158;
  return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
}

export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export function easeOutCubic(k) {
  return 1 - (1 - k) ** 3;
}


// The animals of the Constellation set, as line art in a 100×100 box, facing right, feet on
// y = 92. body: one closed outline (filled on tokens); lines: the rest (horns, claws, legs…).
export const ZODIAC = {
  // Aries: a ram with a curled horn
  red: {
    body: 'M18 50 C22 40 36 35 52 36 C60 36 66 35 70 32 C73 26 78 22 84 22 C91 22 96 27 96 33 C96 37 94 40 90 41 C86 42 82 41 80 44 C78 50 77 56 74 60 C74 66 76 74 80 82 L81 90 L76 91 C74 84 70 76 68 70 C66 76 64 84 64 91 L59 91 C59 84 59 76 58 69 C50 72 40 72 34 69 C33 76 34 84 36 91 L31 91 C29 84 28 78 26 72 C24 78 20 84 16 90 L11 90 C14 82 16 74 15 66 C13 60 14 54 18 50 Z',
    lines: 'M82 26 C72 20 66 31 73 36 C79 40 86 33 81 29 C78 27 75 30 77 32 M86 23 L84 18 M27 44 C31 41 35 44 39 41 C43 44 47 41 51 44 C55 41 59 44 63 41',
  },
  // Taurus: a bull with its head down and horns forward
  green: {
    body: 'M16 48 C20 36 34 30 50 30 C58 30 64 27 70 26 C76 26 80 30 82 36 C86 40 92 44 95 50 C97 55 94 59 89 59 C84 59 82 57 80 58 C77 62 76 66 75 70 C76 77 78 84 81 91 L76 91 C73 84 70 78 68 73 C66 79 65 85 65 91 L60 91 C60 85 60 78 59 73 C50 76 40 76 34 72 C33 79 34 85 36 91 L31 91 C29 85 28 79 26 74 C23 80 19 86 15 91 L10 91 C13 83 15 75 14 66 C12 58 12 52 16 48 Z',
    lines: 'M15 52 C7 56 6 68 9 77 C7 79 7 82 10 82 M84 40 C81 30 86 23 94 21 M88 43 C91 35 96 31 100 31 M92 52 L92 52',
  },
  // Cancer: a crab with its claws raised
  blue: {
    body: 'M24 62 C24 50 38 44 50 44 C62 44 76 50 76 62 C76 72 64 78 50 78 C36 78 24 72 24 62 Z',
    lines: 'M31 51 C22 41 18 33 22 25 M22 25 C13 23 11 14 18 10 M22 25 C27 19 25 12 18 10 M69 51 C78 41 82 33 78 25 M78 25 C87 23 89 14 82 10 M78 25 C73 19 75 12 82 10 M28 68 L15 73 L9 85 M31 73 L20 81 L16 92 M72 68 L85 73 L91 85 M69 73 L80 81 L84 92 M44 44 L42 35 M56 44 L58 35',
  },
  // Leo: a lion with a big mane and a tufted tail
  yellow: {
    body: 'M16 56 C18 46 30 42 46 43 L62 43 C63 32 71 23 82 23 C93 23 99 32 98 41 C97 50 92 56 85 58 C80 61 78 65 76 70 C77 77 79 84 82 91 L77 91 C74 85 71 79 69 74 C67 80 66 86 66 91 L61 91 C61 85 61 79 60 74 C51 77 41 77 35 73 C34 80 35 86 37 91 L32 91 C30 85 29 79 27 74 C24 80 20 86 16 91 L11 91 C14 83 16 75 15 67 C14 62 14 59 16 56 Z',
    lines: 'M16 58 C7 56 4 45 8 38 M8 38 C4 35 6 30 10 32 C12 34 11 37 8 38 M88 33 C93 35 95 41 92 46 M71 31 C76 36 76 46 71 52 M77 26 C80 30 80 36 77 40',
  },
  // Scorpius: a scorpion with its tail curled over its back
  purple: {
    body: 'M22 72 C22 64 31 60 41 61 L60 63 C67 64 69 71 63 75 L41 78 C31 79 22 78 22 72 Z',
    lines: 'M60 67 C76 65 87 53 85 39 C83 27 71 23 65 31 M65 31 L58 29 L62 37 M24 67 C14 61 10 53 14 47 M14 47 C8 43 10 37 16 37 M14 47 C20 45 20 39 16 37 M24 76 C14 80 9 86 12 91 M35 78 L31 90 M43 78 L41 91 M51 77 L51 91 M57 76 L61 89',
  },
  // Sagittarius: the archer's drawn bow and arrow
  orange: {
    body: 'M22 88 C6 62 26 20 76 12 C50 28 34 54 30 84 Z',
    lines: 'M22 88 L76 12 M27 82 L91 18 M91 18 L78 20 M91 18 L89 31 M33 76 L24 76 M33 76 L33 85 M38 71 L29 71 M38 71 L38 80',
  },
};

export const zodiacPaths = new Map(); // made on first use (Path2D only exists in the browser)

export const flameGradients = new WeakMap();

// A cat's paw print: one big pad and four toes, centred on (x, y), about 2r across.
export function pawPrint(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.35, r * 0.62, r * 0.5, 0, 0, TAU);
  ctx.fill();
  for (const [dx, dy, s] of [[-0.62, -0.28, 0.24], [-0.22, -0.68, 0.25], [0.22, -0.68, 0.25], [0.62, -0.28, 0.24]]) {
    ctx.beginPath();
    ctx.ellipse(x + dx * r, y + dy * r, s * r, s * r * 1.2, dx * 0.5, 0, TAU);
    ctx.fill();
  }
}

// A repeatable pseudo-random number for index i (so static details don't flicker).
export const rnd = (i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function snowflake(ctx, x, y, r, color, w = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  for (let k = 0; k < 6; k++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -r);
    ctx.moveTo(0, -r * 0.55);
    ctx.lineTo(-r * 0.25, -r * 0.8);
    ctx.moveTo(0, -r * 0.55);
    ctx.lineTo(r * 0.25, -r * 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

export function flameGradient(ctx) {
  let g = flameGradients.get(ctx);
  if (!g) {
    g = ctx.createLinearGradient(0, 0, 0, -1);
    g.addColorStop(0, 'rgba(255, 70, 10, 0.9)');
    g.addColorStop(0.45, 'rgba(255, 150, 30, 0.85)');
    g.addColorStop(1, 'rgba(255, 240, 150, 0)');
    flameGradients.set(ctx, g);
  }
  return g;
}

export function drawStar(ctx, cx, cy, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (i / 10) * TAU - Math.PI / 2;
    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// '#rrggbb' (or mix()'s 'rgb(…)') with an alpha, as rgba()
export function hexA(hex, a) {
  if (hex.startsWith('rgb(')) return hex.replace('rgb(', 'rgba(').replace(')', `, ${a})`);
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// A four-pointed twinkle
export function sparkle(ctx, x, y, s, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.fill();
}

export function zodiacPath(sign) {
  if (!zodiacPaths.has(sign)) {
    const z = ZODIAC[sign] || ZODIAC.red;
    zodiacPaths.set(sign, { body: new Path2D(z.body), lines: new Path2D(z.lines) });
  }
  return zodiacPaths.get(sign);
}

// A zodiac animal outlined in light, centred on (x, y), `w` wide (Constellation board, dice)
export function zodiacOutline(ctx, sign, x, y, w, color, lineWidth, glow) {
  const z = zodiacPath(sign);
  const sc = w / 100;
  ctx.save();
  ctx.translate(x - 50 * sc, y - 52 * sc);
  ctx.scale(sc, sc);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = lineWidth / sc;
  ctx.strokeStyle = color;
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = lineWidth * 6;
  }
  ctx.stroke(z.body);
  ctx.stroke(z.lines);
  ctx.restore();
}

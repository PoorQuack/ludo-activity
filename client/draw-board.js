// The boards themselves: tiles, textures, safe-square shields and each theme's own details. (Split out of renderer.js.)
import { TAU, circle, drawStar, flameGradient, hexA, mix, path, pawPrint, polygon, rnd, roundRect, snowflake, sparkle } from './draw-util.js';

// ---------- drawing helpers ----------

// One square of the track: a slightly rounded tile, a little smaller than its cell.
// `style` (a board theme's art.tile) dresses it up: gloss, frost, stone, neon, wood, moss, gilded, starry.
// Which way tokens travel through a square, as a turn from the square's own frame (whose +x
// points out along its arm): out along lane -1, across the end, back in along lane +1, and in
// towards the middle on a home column.
export function routeTurn(sq, home) {
  if (home) return Math.PI;
  const lane = -Math.sin(sq.angle) * sq.x + Math.cos(sq.angle) * sq.y;
  if (Math.abs(lane) < 0.3) return Math.PI / 2; // the square across the end of the arm
  return lane < 0 ? 0 : Math.PI;
}

// role: 'cell', 'safe', 'start' or 'home'; turn: the route's direction (see routeTurn)
export function drawTile(ctx, sq, fill, style, theme, role = 'cell', turn = 0) {
  ctx.save();
  ctx.translate(sq.x, sq.y);
  ctx.rotate(sq.angle);
  ctx.fillStyle = fill;
  roundRect(ctx, -0.45, -0.45, 0.9, 0.9, 0.12);
  ctx.fill();
  const spec = theme?.art?.tex?.tile;
  // (only on plain squares: player-coloured ones keep their colour clean)
  const seed = rnd(sq.x * 7.3 + sq.y * 3.1);
  const tex = fill === theme?.cell || fill === theme?.safe ? texPattern(ctx, spec, seed) : null;
  if (tex) {
    ctx.save();
    ctx.globalCompositeOperation = spec.blend || 'multiply';
    ctx.globalAlpha = spec.alpha ?? 0.5;
    ctx.fillStyle = tex;
    ctx.fill();
    ctx.restore();
  }
  if (style && TURNED_TILES.has(style)) {
    // one of eight ways up, so no two neighbours carry the same marks
    ctx.rotate(Math.floor(rnd(seed * 41.3 + 2) * 4) * (Math.PI / 2));
    if (rnd(seed * 19.9 + 7) < 0.5) ctx.scale(-1, 1);
  }
  if (style) TILE_STYLES[style]?.(ctx, fill, theme, seed, role, turn);
  ctx.restore();
}

export let tileK = 1; // pixels per board unit while the board is drawn (for glows)

// ---------- zodiac figures ----------

// ---------- constellation board ----------
// Each base holds its player's zodiac constellation as a real star chart: the actual stars
// (right ascension in hours, declination in degrees, brightness as magnitude: smaller is brighter)
// joined the way star maps join them, with the name underneath. The four tokens wait on
// star-chart rings at (±1, ±1) "spread" units. It's all part of the board's static layer, drawn
// once, so it costs nothing per frame.
export const CONSTELLATIONS = {
  red: { name: 'Aries', stars: [[2.833, 27.26, 3.6], [2.119, 23.46, 2.0], [1.911, 20.81, 2.6], [1.892, 19.29, 3.9]], lines: [[0, 1], [1, 2], [2, 3]] },
  green: {
    name: 'Taurus',
    stars: [[4.599, 16.51, 0.9], [5.438, 28.61, 1.7], [5.627, 21.14, 3.0], [4.477, 19.18, 3.5], [4.382, 17.54, 3.8], [4.33, 15.63, 3.7], [4.478, 15.87, 3.4], [4.011, 12.49, 3.4], [3.413, 9.03, 3.6], [3.791, 24.11, 2.9], [3.75, 24.37, 4.3], [3.82, 23.95, 3.9], [3.763, 24.47, 4.2]],
    lines: [[2, 0], [0, 6], [6, 5], [5, 4], [4, 3], [3, 1], [5, 7], [7, 8]],
  },
  blue: { name: 'Cancer', stars: [[8.975, 11.86, 4.3], [8.745, 18.15, 3.9], [8.722, 21.47, 4.7], [8.275, 9.19, 3.5], [8.778, 28.76, 4.0], [8.667, 19.7, 5.5], [8.652, 19.95, 5.8], [8.69, 19.55, 5.8]], lines: [[3, 1], [1, 0], [1, 2], [2, 4]] },
  yellow: {
    name: 'Leo',
    stars: [[10.139, 11.97, 1.4], [10.122, 16.76, 3.5], [10.333, 19.84, 2.0], [10.278, 23.42, 3.4], [9.879, 26.0, 3.9], [9.764, 23.77, 3.0], [11.235, 20.52, 2.6], [11.237, 15.43, 3.3], [11.818, 14.57, 2.1]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 8], [8, 7], [7, 0], [6, 7]],
  },
  purple: {
    name: 'Scorpius',
    stars: [[16.49, -26.43, 1.0], [16.353, -25.59, 2.9], [16.598, -28.22, 2.8], [16.006, -22.62, 2.3], [16.09, -19.81, 2.6], [15.981, -26.11, 2.9], [16.836, -34.29, 2.3], [16.864, -38.05, 3.0], [16.91, -42.36, 3.6], [17.203, -43.24, 3.3], [17.622, -43.0, 1.9], [17.793, -40.13, 3.0], [17.708, -39.03, 2.4], [17.56, -37.1, 1.6], [17.513, -37.3, 2.7]],
    lines: [[4, 3], [3, 5], [3, 1], [1, 0], [0, 2], [2, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14]],
  },
  orange: {
    name: 'Sagittarius',
    stars: [[18.403, -34.38, 1.9], [18.35, -29.83, 2.7], [18.466, -25.42, 2.8], [18.097, -30.42, 3.0], [18.761, -26.99, 3.2], [18.921, -26.3, 2.1], [19.116, -27.67, 3.3], [19.043, -29.88, 2.6]],
    lines: [[3, 1], [1, 0], [0, 3], [1, 2], [2, 4], [1, 4], [4, 5], [5, 6], [6, 7], [7, 4], [7, 0]],
  },
};
export const TOKEN_STARS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

// The chart's stars in board units, fitted into a base window of half-size `inner` (sky charts
// have east on the left, so right ascension grows to the left).
export function constellationChart(name, b, inner) {
  const c = CONSTELLATIONS[name] || CONSTELLATIONS.red;
  const dec0 = c.stars.reduce((a, s) => a + s[1], 0) / c.stars.length;
  const ra0 = c.stars.reduce((a, s) => a + s[0], 0) / c.stars.length;
  const cos = Math.cos((dec0 * Math.PI) / 180);
  const raw = c.stars.map(([ra, dec, mag]) => ({ x: -(ra - ra0) * 15 * cos, y: -(dec - dec0), mag }));
  const xs = raw.map((p) => p.x);
  const ys = raw.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs) || 1;
  const h = Math.max(...ys) - Math.min(...ys) || 1;
  const fit = (inner * 1.5) / Math.max(w, h); // leave room for the name underneath
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return { c, pts: raw.map((p) => ({ x: b.x + (p.x - cx) * fit, y: b.y - inner * 0.08 + (p.y - cy) * fit, mag: p.mag })) };
}

// The star chart inside a base's window. (r: a token spot's radius, inner: the window's half-size)
export function drawConstellation(ctx, b, spread, r, color, name, inner, k) {
  const { c, pts } = constellationChart(name, b, inner);
  const pale = mix(color, '#ffffff', 0.7);
  ctx.save();
  // a faint nebula in the player's colour
  for (const [ox, oy, rr, a] of [[0, 0, 1.1, 0.32], [-0.35, 0.3, 0.6, 0.22], [0.4, -0.35, 0.55, 0.2]]) {
    const gx = b.x + ox * inner;
    const gy = b.y + oy * inner;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, inner * rr);
    g.addColorStop(0, hexA(color, a));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(b.x - inner, b.y - inner, inner * 2, inner * 2);
  }
  // background stars, scattered the same way every time
  ctx.fillStyle = 'rgba(255, 250, 235, 0.55)';
  for (let i = 0; i < 46; i++) {
    const x = b.x + (rnd(i * 3 + name.length * 31) * 2 - 1) * inner * 0.95;
    const y = b.y + (rnd(i * 3 + 1 + name.length * 31) * 2 - 1) * inner * 0.95;
    circle(ctx, x, y, inner * (0.004 + rnd(i * 3 + 2) * 0.007));
    ctx.fill();
  }
  // the star-chart lines: fine, pale, and stopping short of each star
  ctx.lineCap = 'round';
  ctx.lineWidth = inner * 0.018;
  ctx.strokeStyle = hexA(pale, 0.8);
  ctx.beginPath();
  for (const [i, j] of c.lines) {
    const p = pts[i];
    const q = pts[j];
    const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const gp = starRadius(p.mag, inner) * 1.8;
    const gq = starRadius(q.mag, inner) * 1.8;
    if (d <= gp + gq) continue;
    ctx.moveTo(p.x + ((q.x - p.x) * gp) / d, p.y + ((q.y - p.y) * gp) / d);
    ctx.lineTo(q.x - ((q.x - p.x) * gq) / d, q.y - ((q.y - p.y) * gq) / d);
  }
  ctx.stroke();
  // the stars: brighter ones bigger, with a soft halo in the player's colour
  for (const p of pts) {
    const sr = starRadius(p.mag, inner);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sr * 3.2);
    g.addColorStop(0, hexA(pale, 0.75));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    circle(ctx, p.x, p.y, sr * 3.2);
    ctx.fill();
    ctx.fillStyle = '#fffaf0';
    circle(ctx, p.x, p.y, sr);
    ctx.fill();
    if (p.mag < 1.6) sparkle(ctx, p.x, p.y, sr * 2.6, 'rgba(255, 252, 240, 0.85)'); // the brightest star twinkles
  }
  // where the tokens wait: star-chart rings with little ticks, glowing in the player's colour
  for (const [ox, oy] of TOKEN_STARS) {
    const x = b.x + ox * spread;
    const y = b.y + oy * spread;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.7);
    g.addColorStop(0, hexA(color, 0.45));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    circle(ctx, x, y, r * 1.7);
    ctx.fill();
    ctx.lineWidth = r * 0.09;
    ctx.strokeStyle = hexA(pale, 0.9);
    circle(ctx, x, y, r);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.moveTo(x + Math.cos(a) * r * 1.15, y + Math.sin(a) * r * 1.15);
      ctx.lineTo(x + Math.cos(a) * r * 1.45, y + Math.sin(a) * r * 1.45);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// A star's size on the chart from its magnitude (0.9 → big, 5.8 → a speck)
export function starRadius(mag, inner) {
  return inner * Math.max(0.012, 0.058 - mag * 0.0078);
}

// ---------- safe-square shields ----------
// A token standing on a safe square is wrapped in a shield in the board's theme (art.shield):
// a bubble in the ocean, a ring of fire on lava, a frost crystal on ice… Each is drawn in two
// halves, 'back' before the token and 'front' after it, round a pawn whose base sits at (x, gy).
// The pawn is about 2.1r tall. t: seconds, k: 0..1 as the shield pops up.
export function drawShield(ctx, spec, x, gy, r, hex, t, k, part) {
  if (k <= 0) return;
  const kind = typeof spec === 'string' ? spec : spec.kind;
  ctx.save();
  SHIELDS[kind]?.(ctx, spec, x, gy, r, hex, t, k, part);
  ctx.restore();
}

// The dome that fits round a pawn
export const dome = (x, gy, r, k) => ({ cx: x, cy: gy - r * 0.92, rx: r * 1.18 * k, ry: r * 1.42 * k });

// Little things circling a token: 'back' draws the ones behind it, 'front' the rest
export function orbiters(ctx, part, n, x, cy, rx, ry, t, speed, draw) {
  for (let i = 0; i < n; i++) {
    const a = t * speed + (i / n) * TAU;
    const behind = Math.sin(a) < 0;
    if (behind !== (part === 'back')) continue;
    draw(x + Math.cos(a) * rx, cy + Math.sin(a) * ry, i, 0.75 + 0.25 * Math.sin(a));
  }
}

// A soft glow behind the token
export function aura(ctx, x, gy, r, k, color) {
  const d = dome(x, gy, r, k);
  const g = ctx.createRadialGradient(d.cx, d.cy, 0, d.cx, d.cy, d.ry * 1.05);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(d.cx, d.cy, d.rx * 1.05, d.ry * 1.05, 0, 0, TAU);
  ctx.fill();
}

export const SHIELDS = {
  // A little ring of stars, joined by gold lines, turning round the token
  constellation(ctx, spec, x, gy, r, hex, t, k, part) {
    const d = dome(x, gy, r, k);
    if (part === 'back') {
      aura(ctx, x, gy, r, k, 'rgba(150, 170, 255, 0.6)');
      aura(ctx, x, gy, r, k * 0.7, 'rgba(255, 225, 150, 0.35)');
    }
    const n = 6;
    const cy = gy - r * 0.85;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = t * 0.9 + (i / n) * TAU;
      const wob = 1 + 0.12 * Math.sin(i * 2.3);
      pts.push({ x: x + Math.cos(a) * d.rx * 1.05 * wob, y: cy + Math.sin(a) * r * 0.62 * k + Math.sin(i * 1.7) * r * 0.25 * k, back: Math.sin(a) < 0, i });
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.2, r * 0.07);
    ctx.shadowColor = 'rgba(255, 220, 140, 0.9)';
    ctx.shadowBlur = r * 0.3;
    ctx.strokeStyle = 'rgba(250, 220, 140, 0.95)';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      if ((p.back && q.back) !== (part === 'back')) continue;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    for (const p of pts) {
      if (p.back !== (part === 'back')) continue;
      const tw = 0.7 + 0.3 * Math.sin(t * 5 + p.i * 2);
      ctx.shadowColor = '#fff3c4';
      ctx.shadowBlur = r * 0.5;
      sparkle(ctx, p.x, p.y, r * (p.i % 2 ? 0.3 : 0.44) * tw * k, p.i % 3 ? '#fff6d8' : hex);
    }
    ctx.shadowBlur = 0;
  },

  // A soap bubble that wobbles a little, with a rainbow sheen
  bubble(ctx, spec, x, gy, r, hex, t, k, part) {
    const d = dome(x, gy, r, k);
    const w = Math.sin(t * 3.1) * 0.035;
    const rx = d.rx * (1 + w);
    const ry = d.ry * (1 - w);
    ctx.beginPath();
    ctx.ellipse(d.cx, d.cy, rx, ry, 0, 0, TAU);
    if (part === 'back') {
      ctx.fillStyle = 'rgba(150, 225, 255, 0.16)';
      ctx.fill();
      return;
    }
    const g = ctx.createRadialGradient(d.cx, d.cy, ry * 0.55, d.cx, d.cy, ry);
    g.addColorStop(0, 'rgba(200, 245, 255, 0)');
    g.addColorStop(0.8, 'rgba(170, 235, 255, 0.18)');
    g.addColorStop(1, 'rgba(230, 250, 255, 0.55)');
    ctx.fillStyle = g;
    ctx.fill();
    const sheen = ctx.createLinearGradient(d.cx - rx, d.cy - ry, d.cx + rx, d.cy + ry);
    const h = (t * 0.15) % 1;
    sheen.addColorStop(0, 'rgba(255, 140, 220, 0.5)');
    sheen.addColorStop(0.2 + h * 0.5, 'rgba(120, 230, 255, 0.55)');
    sheen.addColorStop(1, 'rgba(255, 235, 130, 0.5)');
    ctx.lineWidth = Math.max(1.2, r * 0.07);
    ctx.strokeStyle = sheen;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(d.cx - rx * 0.45, d.cy - ry * 0.5, rx * 0.2, ry * 0.11, -0.7, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(d.cx - rx * 0.12, d.cy - ry * 0.72, Math.max(1, r * 0.07), 0, TAU);
    ctx.fill();
  },

  // A ring of flickering flames round the base, taller at the back
  fire(ctx, spec, x, gy, r, hex, t, k, part) {
    ctx.globalCompositeOperation = 'lighter';
    if (part === 'back') aura(ctx, x, gy, r, k, 'rgba(255, 110, 20, 0.45)');
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.2;
      const behind = Math.sin(a) < 0;
      if (behind !== (part === 'back')) continue;
      const px = x + Math.cos(a) * r * 1.0 * k;
      const py = gy + Math.sin(a) * r * 0.42 * k;
      const flick = 0.75 + 0.25 * Math.sin(t * 11 + i * 2.3) + 0.15 * Math.sin(t * 17 + i * 5.1);
      const h = r * (behind ? 1.25 : 0.7) * flick * k;
      const w = r * 0.26 * k;
      const sway = Math.sin(t * 6 + i) * w * 0.6;
      // one gradient (0 → -1 upwards) made once, stretched to each flame's height
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(1, h);
      ctx.fillStyle = flameGradient(ctx);
      ctx.beginPath();
      ctx.moveTo(-w, 0);
      ctx.quadraticCurveTo(-w, -0.55, sway, -1);
      ctx.quadraticCurveTo(w, -0.55, w, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255, 250, 200, 0.7)';
      ctx.beginPath();
      ctx.ellipse(px, py - h * 0.18, w * 0.4, h * 0.2, 0, 0, TAU);
      ctx.fill();
    }
  },

  // A six-sided ice crystal round the token, with frost at its foot and glints at the corners
  frost(ctx, spec, x, gy, r, hex, t, k, part) {
    const d = dome(x, gy, r, k);
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i / 6) * TAU;
      pts.push([d.cx + Math.cos(a) * d.rx * 1.08, d.cy + Math.sin(a) * d.ry]);
    }
    if (part === 'back') {
      aura(ctx, x, gy, r, k, 'rgba(190, 235, 255, 0.4)');
      return;
    }
    ctx.beginPath();
    pts.forEach(([px, py]) => ctx.lineTo(px, py));
    ctx.closePath();
    const g = ctx.createLinearGradient(d.cx - d.rx, d.cy - d.ry, d.cx + d.rx, d.cy + d.ry);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.5, 'rgba(190,235,255,0.18)');
    g.addColorStop(1, 'rgba(120,195,240,0.45)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(120, 200, 255, 0.9)';
    ctx.shadowBlur = r * 0.4;
    ctx.lineWidth = Math.max(1.5, r * 0.08);
    ctx.strokeStyle = 'rgba(235, 250, 255, 1)';
    ctx.stroke();
    ctx.shadowBlur = 0;
    // facets
    ctx.lineWidth = Math.max(0.8, r * 0.025);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    for (const i of [0, 2, 4]) {
      ctx.moveTo(d.cx, d.cy);
      ctx.lineTo(...pts[i]);
    }
    ctx.stroke();
    // frost spikes round the foot
    ctx.fillStyle = 'rgba(240, 252, 255, 0.9)';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI + 0.2;
      const px = x + Math.cos(a) * r * 0.95 * k;
      const py = gy + Math.sin(a) * r * 0.4 * k;
      const h = r * (0.3 + 0.18 * rnd(i + 5)) * k;
      ctx.beginPath();
      ctx.moveTo(px - r * 0.09, py);
      ctx.lineTo(px, py - h);
      ctx.lineTo(px + r * 0.09, py);
      ctx.fill();
    }
    // glints that come and go on the corners
    for (let i = 0; i < 6; i++) {
      const a = Math.max(0, Math.sin(t * 2.2 + i * 1.7)) ** 4;
      if (a < 0.05) continue;
      ctx.globalAlpha = a;
      sparkle(ctx, pts[i][0], pts[i][1], r * 0.22, '#ffffff');
    }
  },

  // A force field in the player's own colour, with a scan line running up it
  force(ctx, spec, x, gy, r, hex, t, k, part) {
    const d = dome(x, gy, r, k);
    ctx.beginPath();
    ctx.ellipse(d.cx, d.cy, d.rx, d.ry, 0, 0, TAU);
    if (part === 'back') {
      ctx.fillStyle = hex;
      ctx.globalAlpha = 0.12;
      ctx.fill();
      return;
    }
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = hex;
    ctx.lineWidth = Math.max(0.8, r * 0.025);
    const step = r * 0.32;
    ctx.beginPath();
    for (let yy = d.cy - d.ry; yy < d.cy + d.ry; yy += step) {
      ctx.moveTo(d.cx - d.rx, yy);
      ctx.lineTo(d.cx + d.rx, yy);
    }
    ctx.stroke();
    const sy = d.cy + d.ry - ((t * 0.9) % 1) * d.ry * 2;
    const g = ctx.createLinearGradient(0, sy - r * 0.3, 0, sy + r * 0.3);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = g;
    ctx.fillRect(d.cx - d.rx, sy - r * 0.3, d.rx * 2, r * 0.6);
    ctx.restore();
    ctx.shadowColor = hex;
    ctx.shadowBlur = r * 0.8;
    ctx.lineWidth = Math.max(1.5, r * 0.08);
    ctx.strokeStyle = hex;
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 6);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(0.8, r * 0.03);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  },

  // A peppermint ring spinning round the base, under a sugary glow
  candy(ctx, spec, x, gy, r, hex, t, k, part) {
    if (part === 'back') aura(ctx, x, gy, r, k, 'rgba(255, 170, 215, 0.45)');
    const cy = gy - r * 0.05;
    const rx = r * 1.02 * k;
    const ry = r * 0.44 * k;
    const [a0, a1] = part === 'back' ? [Math.PI, TAU] : [0, Math.PI];
    ctx.lineCap = 'butt';
    ctx.lineWidth = r * 0.24 * k;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x, cy, rx, ry, 0, a0, a1);
    ctx.stroke();
    ctx.setLineDash([r * 0.22, r * 0.22]);
    ctx.lineDashOffset = -t * r * 1.2;
    ctx.strokeStyle = '#ff4f7b';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = Math.max(0.8, r * 0.04);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.ellipse(x, cy - r * 0.06 * k, rx, ry, 0, a0, a1);
    ctx.stroke();
  },

  // Motifs circling the token (stars, leaves, paws…) over a soft glow. spec: { motif, colors,
  // glow, n, size, crown }
  orbit(ctx, spec, x, gy, r, hex, t, k, part) {
    const d = dome(x, gy, r, k);
    const glow = spec.glow || 'rgba(255, 230, 140, 0.45)';
    if (part === 'back') {
      aura(ctx, x, gy, r, k, glow);
      aura(ctx, x, gy, r, k * 0.75, glow);
    } else {
      // a faint glassy dome, so it reads as a shield
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(d.cx, d.cy, d.rx, d.ry, 0, 0, TAU);
      const g = ctx.createRadialGradient(d.cx, d.cy, d.ry * 0.6, d.cx, d.cy, d.ry);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, glow);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.globalAlpha = 0.55 + 0.2 * Math.sin(t * 3);
      ctx.lineWidth = Math.max(1, r * 0.05);
      ctx.strokeStyle = spec.colors?.[0] || '#ffd54a';
      ctx.stroke();
      ctx.restore();
    }
    const cy = gy - r * 0.8;
    const colors = spec.colors || ['#ffd54a'];
    orbiters(ctx, part, spec.n || 5, x, cy, d.rx * 1.1, r * 0.55 * k, t, spec.speed || 1.3, (px, py, i, depth) => {
      const s = r * (spec.size || 0.34) * k * depth;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.sin(t * 2 + i) * 0.5);
      if (spec.motif === 'sparkle') sparkle(ctx, 0, 0, s * 1.4, colors[i % colors.length]);
      else {
        motif(ctx, spec.motif, 0, 0, s, colors[i % colors.length]);
        if (spec.motif === 'star') {
          ctx.lineWidth = Math.max(0.6, r * 0.02);
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.stroke();
        }
      }
      ctx.restore();
    });
    // A little crown floating over the token's head
    if (spec.crown && part === 'front') {
      const bob = Math.sin(t * 2.5) * r * 0.08;
      ctx.save();
      ctx.translate(x, gy - r * 2.45 * k + bob);
      ctx.scale(k, k);
      ctx.shadowColor = 'rgba(255, 210, 90, 0.9)';
      ctx.shadowBlur = r * 0.5;
      motif(ctx, 'crown', 0, 0, r * 0.36, '#f6cf57');
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(0.8, r * 0.035);
      ctx.strokeStyle = '#9a6f00';
      ctx.stroke();
      ctx.restore();
    }
  },
};

// ---------- board textures ----------
// Image textures (client/public/textures, made by tools/textures) load once and are shared.
// A board drawn before its textures arrive is redrawn when they do.
export const TEXTURES = new Map(); // src -> { img, ready, waiting: Set of renderers }
export let drawingFor = null; // the renderer whose board is being drawn

export function texture(src, renderer = drawingFor) {
  let t = TEXTURES.get(src);
  if (!t) {
    const img = new Image();
    t = { img, ready: false, waiting: new Set() };
    TEXTURES.set(src, t);
    img.onload = () => {
      t.ready = true;
      for (const r of t.waiting) r.size = 0; // redrawn on its next frame
      t.waiting.clear();
      window.dispatchEvent(new Event('ludo-textures'));
    };
    img.src = src;
  }
  if (!t.ready && renderer) t.waiting.add(renderer);
  return t.ready ? t.img : null;
}

// A repeating pattern of a texture spec { src, size (board units per tile) }, or null if
// there's none or it hasn't loaded yet.
// `seed` (0..1, for one square): take a different piece of the texture, turned a different way.
// Without it every square shows the very same piece, which is what made the squares look stamped.
export function texPattern(ctx, spec, seed = null) {
  if (!spec) return null;
  const img = texture(spec.src);
  if (!img) return null;
  const p = ctx.createPattern(img, 'repeat');
  const sc = spec.size / img.width;
  const m = new DOMMatrix();
  if (seed !== null) {
    m.rotateSelf(Math.floor(rnd(seed * 91.7 + 3) * 4) * 90);
    if (rnd(seed * 57.3 + 9) < 0.5) m.scaleSelf(-1, 1);
    m.translateSelf(rnd(seed * 31.1 + 1) * spec.size, rnd(seed * 77.9 + 5) * spec.size);
  }
  m.scaleSelf(sc, sc);
  p.setTransform(m);
  return p;
}

// Tile styles whose marks (cracks, veins) may be turned and mirrored from square to square
export const TURNED_TILES = new Set(['stone', 'frost', 'slate', 'moss', 'sandstone']);

// Cracks across a square (-0.45..0.45): one of three layouts, its corners nudged by the seed, and
// about one square in six has none at all. (It strokes them: set the stroke style first.)
export function crackLines(ctx, r) {
  const j = (k) => (rnd(r * 17 + k) - 0.5) * 0.3;
  const kind = Math.floor(rnd(r * 23 + 8) * 6);
  if (kind === 0) return; // an unbroken square
  ctx.beginPath();
  if (kind <= 2) {
    // a fork: in from one edge, splitting two ways
    ctx.moveTo(-0.45, -0.2 + j(1));
    ctx.lineTo(-0.1 + j(2), j(3));
    ctx.lineTo(0.1 + j(4), -0.12 + j(5));
    ctx.lineTo(0.45, 0.15 + j(6));
    ctx.moveTo(-0.1 + j(2), j(3));
    ctx.lineTo(j(7), 0.45);
  } else if (kind <= 4) {
    // one long crack edge to edge, a short one off it
    ctx.moveTo(-0.45, 0.3 + j(1));
    ctx.lineTo(-0.15 + j(2), 0.12 + j(3));
    ctx.lineTo(0.12 + j(4), -0.1 + j(5));
    ctx.lineTo(0.45, -0.35 + j(6));
    ctx.moveTo(0.12 + j(4), -0.1 + j(5));
    ctx.lineTo(0.3 + j(7), 0.2 + j(8));
  } else {
    // two chipped corners
    ctx.moveTo(0.1 + j(1), -0.45);
    ctx.lineTo(0.18 + j(2), -0.2 + j(3));
    ctx.lineTo(0.45, -0.1 + j(4));
    ctx.moveTo(-0.45, 0.25 + j(5));
    ctx.lineTo(-0.25 + j(6), 0.45);
  }
  ctx.stroke();
}

// Each is drawn over a tile already filled, in the tile's own frame (-0.45..0.45), path still set.
export const TILE_STYLES = {
  // Crystal: each square cut like a gem seen from above: a flat table in the middle, four
  // bevelled facets round it (lit from the top-left), a bright edge, and now and then a glint
  facet(ctx, fill, theme, r) {
    ctx.save();
    ctx.clip();
    const o = 0.5;
    const i = 0.27;
    const side = (pts, f) => {
      path(ctx, pts);
      ctx.fillStyle = f;
      ctx.fill();
    };
    side([[-o, -o], [o, -o], [i, -i], [-i, -i]], 'rgba(255,255,255,0.34)'); // top
    side([[-o, -o], [-i, -i], [-i, i], [-o, o]], 'rgba(255,255,255,0.16)'); // left
    side([[o, -o], [o, o], [i, i], [i, -i]], 'rgba(0,0,0,0.16)'); // right
    side([[-o, o], [-i, i], [i, i], [o, o]], 'rgba(0,0,0,0.3)'); // bottom
    const g = ctx.createLinearGradient(-i, -i, i, i);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.02)');
    g.addColorStop(1, 'rgba(255,255,255,0.1)');
    ctx.fillStyle = g;
    ctx.fillRect(-i, -i, i * 2, i * 2);
    ctx.lineWidth = 0.014;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(x * o, y * o);
      ctx.lineTo(x * i, y * i);
    }
    ctx.stroke();
    ctx.strokeRect(-i, -i, i * 2, i * 2);
    if (rnd(r * 17 + 3) < 0.22) {
      // a glint on the table
      const x = (rnd(r * 5 + 1) - 0.5) * 0.3;
      const y = (rnd(r * 9 + 2) - 0.5) * 0.3;
      const k = 0.07;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(x, y - k * 1.6);
      ctx.quadraticCurveTo(x, y, x + k, y);
      ctx.quadraticCurveTo(x, y, x, y + k * 1.6);
      ctx.quadraticCurveTo(x, y, x - k, y);
      ctx.quadraticCurveTo(x, y, x, y - k * 1.6);
      ctx.fill();
    }
    ctx.restore();
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = 'rgba(214, 196, 255, 0.55)';
    roundRect(ctx, -0.45, -0.45, 0.9, 0.9, 0.08);
    ctx.stroke();
  },
  // Knitted squares: two columns of V stitches pointing the way the route runs, inside a
  // twisted-yarn edge. Safe and start squares are plain felt.
  knit(ctx, fill, theme, r, role, turn) {
    if (role === 'cell' || role === 'home') {
      ctx.save();
      ctx.clip();
      ctx.rotate(turn);
      ctx.fillStyle = mix(fill.startsWith('#') ? fill : '#f2e6d4', '#5a3418', 0.14);
      ctx.fillRect(-0.5, -0.5, 1, 1);
      const lit = mix(fill, '#ffffff', 0.18);
      const dark = mix(fill, '#5a3418', 0.3);
      ctx.lineWidth = 0.018;
      for (const cy of [-0.215, 0.215]) {
        for (let cx = -0.6; cx <= 0.6; cx += 0.26) {
          for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(cx, cy + side * 0.085, 0.15, 0.075, -side * 0.55, 0, TAU);
            const g = ctx.createLinearGradient(cx - 0.12, 0, cx + 0.12, 0);
            g.addColorStop(0, dark);
            g.addColorStop(0.45, lit);
            g.addColorStop(1, fill);
            ctx.fillStyle = g;
            ctx.fill();
            ctx.strokeStyle = dark;
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    } else TILE_STYLES.gloss(ctx);
    // the twisted yarn round the edge
    ctx.lineWidth = 0.06;
    ctx.strokeStyle = '#c9986a';
    roundRect(ctx, -0.47, -0.47, 0.94, 0.94, 0.12);
    ctx.stroke();
    ctx.setLineDash([0.045, 0.04]);
    ctx.lineDashOffset = r * 0.08;
    ctx.strokeStyle = '#7a4a28';
    ctx.stroke();
    ctx.setLineDash([]);
  },
  celestial(ctx, fill, theme) {
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(0, -0.45, 0, 0.45);
    g.addColorStop(0, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(-0.5, -0.5, 1, 1);
    ctx.restore();
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = 'rgba(222, 186, 100, 0.9)';
    roundRect(ctx, -0.43, -0.43, 0.86, 0.86, 0.08);
    ctx.stroke();
  },
  gloss(ctx) {
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(0, -0.45, 0, 0.45);
    g.addColorStop(0, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(-0.5, -0.5, 1, 1);
    ctx.restore();
  },
  frost(ctx, fill, theme, r) {
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(-0.45, -0.45, 0.45, 0.45);
    g.addColorStop(0, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(120,190,230,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(-0.5, -0.5, 1, 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 0.02;
    crackLines(ctx, r);
    // some squares carry a patch of frost as well
    if (rnd(r * 29 + 6) < 0.35) snowflake(ctx, (rnd(r * 3 + 1) - 0.5) * 0.5, (rnd(r * 5 + 2) - 0.5) * 0.5, 0.1 + 0.08 * rnd(r * 7), 'rgba(255,255,255,0.7)', 0.018);
    ctx.restore();
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    roundRect(ctx, -0.42, -0.42, 0.84, 0.84, 0.1);
    ctx.stroke();
  },
  stone(ctx, fill, theme, r) {
    ctx.save();
    ctx.clip();
    const g = ctx.createRadialGradient(-0.1, -0.15, 0.05, 0, 0, 0.7);
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(-0.5, -0.5, 1, 1);
    ctx.shadowColor = '#ff6a1a';
    ctx.shadowBlur = 0.25 * tileK;
    ctx.strokeStyle = 'rgba(255, 140, 40, 0.85)';
    ctx.lineWidth = 0.02 + 0.025 * rnd(r * 13 + 4);
    crackLines(ctx, r);
    ctx.restore();
  },
  neon(ctx, fill, theme) {
    const plain = fill === theme.cell || fill === theme.safe;
    const lit = plain ? theme.star : fill;
    if (!plain) {
      ctx.fillStyle = '#10111b';
      ctx.fill();
    }
    ctx.save();
    ctx.shadowColor = lit;
    ctx.shadowBlur = 0.3 * tileK;
    ctx.strokeStyle = lit;
    ctx.lineWidth = 0.045;
    roundRect(ctx, -0.4, -0.4, 0.8, 0.8, 0.1);
    ctx.stroke();
    ctx.restore();
  },
  wood(ctx, fill, theme, r) {
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(110, 66, 28, 0.28)';
    ctx.lineWidth = 0.025;
    for (let i = 0; i < 4; i++) {
      const y0 = -0.36 + i * 0.24 + r * 0.06;
      ctx.beginPath();
      for (let x = -0.5; x <= 0.5; x += 0.05) ctx.lineTo(x, y0 + Math.sin(x * 9 + i + r * 6) * 0.03);
      ctx.stroke();
    }
    ctx.restore();
    TILE_STYLES.gloss(ctx);
  },
  moss(ctx) {
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(0, -0.45, 0, 0.45);
    g.addColorStop(0, 'rgba(255,255,255,0.3)');
    g.addColorStop(0.6, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(40,90,30,0.28)');
    ctx.fillStyle = g;
    ctx.fillRect(-0.5, -0.5, 1, 1);
    ctx.restore();
  },
  gilded(ctx) {
    TILE_STYLES.gloss(ctx);
    ctx.lineWidth = 0.045;
    ctx.strokeStyle = '#d4a52a';
    roundRect(ctx, -0.39, -0.39, 0.78, 0.78, 0.09);
    ctx.stroke();
  },
  // dark slate: a thin silver edge, lit from the top left
  slate(ctx) {
    const g = ctx.createLinearGradient(-0.45, -0.45, 0.45, 0.45);
    g.addColorStop(0, 'rgba(225, 231, 255, 0.5)');
    g.addColorStop(0.5, 'rgba(225, 231, 255, 0.08)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = g;
    roundRect(ctx, -0.44, -0.44, 0.88, 0.88, 0.11);
    ctx.stroke();
  },
  // Arcade: a chunky pixel bevel, light on two sides and dark on the other two
  pixel(ctx, fill) {
    const u = 0.075;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.fillRect(-0.45, -0.45, 0.9, u);
    ctx.fillRect(-0.45, -0.45, u, 0.9);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(-0.45, 0.45 - u, 0.9, u);
    ctx.fillRect(0.45 - u, -0.45, u, 0.9);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillRect(-0.45 + u * 1.6, -0.45 + u * 1.6, u, u);
  },
  // Desert: sandstone, a few grains and a wind-worn groove
  sandstone(ctx, fill, theme, r) {
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(-0.45, -0.45, 0.45, 0.45);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
    g.addColorStop(1, 'rgba(150, 95, 30, 0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(-0.5, -0.5, 1, 1);
    ctx.strokeStyle = 'rgba(150, 100, 40, 0.35)';
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    const y = (rnd(r * 11 + 2) - 0.5) * 0.5;
    ctx.moveTo(-0.45, y);
    ctx.bezierCurveTo(-0.15, y - 0.12, 0.15, y + 0.12, 0.45, y - 0.04);
    ctx.stroke();
    ctx.fillStyle = 'rgba(120, 80, 30, 0.4)';
    for (let i = 0; i < 4; i++) ctx.fillRect((rnd(r * 7 + i) - 0.5) * 0.8, (rnd(r * 3 + i * 5) - 0.5) * 0.8, 0.025, 0.025);
    ctx.restore();
  },
  starry(ctx, fill, theme, r) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    circle(ctx, -0.2 + r * 0.3, -0.18, 0.025);
    ctx.fill();
    circle(ctx, 0.22 - r * 0.2, 0.2, 0.018);
    ctx.fill();
    ctx.lineWidth = 0.025;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, -0.45, -0.45, 0.9, 0.9, 0.12);
    ctx.stroke();
  },
};


// ---------- each board's own details (all painted once, on the still layer) ----------

// Where the pins wait in a yard: one spot per pin, in the theme's own style (art.pins).
export function drawSpots(ctx, kind, b, spread, r, color) {
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([ox, oy], i) => {
    ctx.save();
    ctx.translate(b.x + ox * spread, b.y + oy * spread);
    ctx.lineJoin = 'round';
    SPOTS[kind](ctx, r, color, i + Math.round(b.x * 3 + b.y * 7));
    ctx.restore();
  });
}

// A wobbly round outline (islands, stones): `n` points round a circle, each pushed in or out a little.
export function blob(ctx, r, n, seed, wobble = 0.12) {
  ctx.beginPath();
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const d = r * (1 - wobble + 2 * wobble * rnd(seed * 13 + i));
    pts.push([Math.cos(a) * d, Math.sin(a) * d]);
  }
  pts.forEach(([x, y], i) => {
    const [nx, ny] = pts[(i + 1) % n];
    if (!i) ctx.moveTo((x + nx) / 2, (y + ny) / 2);
    const [mx, my] = pts[(i + 2) % n];
    ctx.quadraticCurveTo(nx, ny, (nx + mx) / 2, (ny + my) / 2);
  });
  ctx.closePath();
}

// A five-petalled flower (blossom spots, the Sakura board's emblem)
export function blossom(ctx, r, petal, heart) {
  ctx.fillStyle = petal;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU - Math.PI / 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.5, r * 0.36, a, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  circle(ctx, 0, 0, r * 0.38);
  ctx.fillStyle = heart;
  ctx.fill();
}

export const SPOTS = {
  // Crystal: a step-cut gem in the player's colour, like the Emerald dice's pips
  gem(ctx, r, color) {
    const R = r * 1.05;
    const oct = (w, h, c) => [[-w + c, -h], [w - c, -h], [w, -h + c], [w, h - c], [w - c, h], [-w + c, h], [-w, h - c], [-w, -h + c]];
    const outer = oct(R * 0.86, R, R * 0.3);
    const inner = oct(R * 0.48, R * 0.6, R * 0.16);
    ctx.save();
    ctx.shadowColor = hexA(color, 0.8);
    ctx.shadowBlur = 0.35 * tileK;
    path(ctx, outer);
    ctx.fillStyle = mix(color, '#000000', 0.35);
    ctx.fill();
    ctx.restore();
    // the crown facets, each lit by which way it faces
    for (let j = 0; j < 8; j++) {
      const a = outer[j];
      const b = outer[(j + 1) % 8];
      const c = inner[(j + 1) % 8];
      const d = inner[j];
      const nx = (a[0] + b[0]) / 2;
      const ny = (a[1] + b[1]) / 2;
      const light = Math.max(-1, Math.min(1, (-nx - ny) / (R * 1.1)));
      path(ctx, [a, b, c, d]);
      ctx.fillStyle = light > 0 ? mix(color, '#ffffff', light * 0.55) : mix(color, '#000000', -light * 0.4);
      ctx.fill();
    }
    path(ctx, inner);
    const g = ctx.createLinearGradient(-R * 0.5, -R * 0.6, R * 0.5, R * 0.6);
    g.addColorStop(0, mix(color, '#ffffff', 0.45));
    g.addColorStop(0.55, color);
    g.addColorStop(1, mix(color, '#000000', 0.2));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = r * 0.04;
    ctx.strokeStyle = hexA('#ffffff', 0.4);
    ctx.beginPath();
    outer.forEach(([x, y], j) => {
      ctx.moveTo(x, y);
      ctx.lineTo(...inner[j]);
    });
    ctx.stroke();
    path(ctx, outer);
    ctx.lineWidth = r * 0.06;
    ctx.strokeStyle = mix(color, '#ffffff', 0.55);
    ctx.stroke();
    // a glint
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(-R * 0.22, -R * 0.3, R * 0.14, R * 0.06, -0.6, 0, TAU);
    ctx.fill();
  },
  // Swamp: a lily pad, a notch cut out of it
  lily(ctx, r, color, seed) {
    ctx.rotate(rnd(seed) * TAU);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 1.08, 0.35, TAU - 0.1);
    ctx.closePath();
    ctx.fillStyle = '#2f7a3a';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 0.95, 0.4, TAU - 0.15);
    ctx.closePath();
    ctx.fillStyle = '#5fb45a';
    ctx.fill();
    ctx.lineWidth = r * 0.04;
    ctx.strokeStyle = 'rgba(30, 90, 40, 0.5)';
    ctx.beginPath();
    for (let i = 1; i < 6; i++) {
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(i) * r * 0.9, Math.sin(i) * r * 0.9);
    }
    ctx.stroke();
    circle(ctx, 0, 0, r * 0.55);
    ctx.fillStyle = hexA(color, 0.9);
    ctx.fill();
    ctx.lineWidth = r * 0.07;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.stroke();
  },
  // Factory: a cog, the player's colour on its hub
  gear(ctx, r, color, seed) {
    ctx.rotate(rnd(seed) * 0.8);
    ctx.fillStyle = '#5a6478';
    for (let i = 0; i < 8; i++) {
      ctx.rotate(TAU / 8);
      ctx.fillRect(-r * 0.2, -r * 1.16, r * 0.4, r * 0.4);
    }
    circle(ctx, 0, 0, r * 0.95);
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, '#c9d2e0');
    g.addColorStop(1, '#6f7a8c');
    ctx.fillStyle = g;
    ctx.fill();
    circle(ctx, 0, 0, r * 0.66);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = r * 0.07;
    ctx.strokeStyle = 'rgba(20, 26, 40, 0.55)';
    ctx.stroke();
  },
  // Sakura: a blossom, the player's colour at its heart
  blossom(ctx, r, color) {
    ctx.lineWidth = r * 0.05;
    ctx.strokeStyle = '#f29ab8';
    blossom(ctx, r * 1.05, '#fff5f8', color);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    circle(ctx, -r * 0.1, -r * 0.12, r * 0.1);
    ctx.fill();
  },
  // Desert: a water hole ringed with sandstone
  oasis(ctx, r, color, seed) {
    blob(ctx, r * 1.1, 9, seed, 0.07);
    ctx.fillStyle = '#b98a4a';
    ctx.fill();
    blob(ctx, r * 0.95, 9, seed, 0.07);
    ctx.fillStyle = '#f6e3b0';
    ctx.fill();
    const g = ctx.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.05, 0, 0, r * 0.7);
    g.addColorStop(0, mix(color, '#ffffff', 0.45));
    g.addColorStop(1, color);
    circle(ctx, 0, 0, r * 0.68);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = r * 0.05;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.45, Math.PI * 1.05, Math.PI * 1.5);
    ctx.stroke();
  },
  // Arcade: a square pad built of pixels
  pad(ctx, r, color) {
    const u = r * 0.22;
    ctx.fillStyle = '#0c0c1c';
    ctx.fillRect(-r - u * 0.5, -r - u * 0.5, r * 2 + u, r * 2 + u);
    ctx.fillStyle = color;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillRect(-r, -r, r * 2, u);
    ctx.fillRect(-r, -r, u, r * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(-r, r - u, r * 2, u);
    ctx.fillRect(r - u, -r, u, r * 2);
  },
  // Wood: a hole drilled into the board, lined with the player's colour
  recess(ctx, r, color) {
    const g = ctx.createRadialGradient(0, r * 0.25, r * 0.1, 0, 0, r);
    g.addColorStop(0, mix(color, '#ffffff', 0.18));
    g.addColorStop(1, mix(color, '#000000', 0.3));
    circle(ctx, 0, 0, r);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.lineWidth = r * 0.34;
    ctx.strokeStyle = 'rgba(40, 18, 4, 0.5)';
    circle(ctx, 0, r * 0.16, r * 1.08);
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = r * 0.13;
    ctx.strokeStyle = '#8a5a2c';
    circle(ctx, 0, 0, r * 1.04);
    ctx.stroke();
    ctx.lineWidth = r * 0.04;
    ctx.strokeStyle = 'rgba(255, 232, 190, 0.8)';
    circle(ctx, 0, 0, r * 1.1);
    ctx.stroke();
  },
  // Candy: a peppermint swirl
  cookie(ctx, r, color) {
    // A flat peppermint swirl in the player's colour (like the one in the middle of the board)
    const R = r * 0.95;
    circle(ctx, 0, 0, R);
    ctx.fillStyle = '#fffaf3';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = color;
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * TAU;
      const a1 = a0 + TAU / 12;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(a0 - 0.7) * R * 0.6, Math.sin(a0 - 0.7) * R * 0.6, Math.cos(a0) * R * 1.05, Math.sin(a0) * R * 1.05);
      ctx.arc(0, 0, R * 1.05, a0, a1);
      ctx.quadraticCurveTo(Math.cos(a1 - 0.7) * R * 0.6, Math.sin(a1 - 0.7) * R * 0.6, 0, 0);
      ctx.fill();
    }
    ctx.restore();
    ctx.lineWidth = r * 0.08;
    ctx.strokeStyle = mix(color, '#000000', 0.2);
    circle(ctx, 0, 0, R);
    ctx.stroke();
    ctx.lineWidth = r * 0.06;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.74, Math.PI * 1.1, Math.PI * 1.45);
    ctx.stroke();
  },
  // Neon: a dark pad with a glowing ring
  ring(ctx, r, color) {
    circle(ctx, 0, 0, r);
    ctx.fillStyle = 'rgba(6, 7, 14, 0.85)';
    ctx.fill();
    ctx.shadowColor = color;
    ctx.shadowBlur = 0.3 * tileK;
    ctx.lineWidth = r * 0.13;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = r * 0.04;
    ctx.strokeStyle = hexA(color, 0.55);
    circle(ctx, 0, 0, r * 0.62);
    ctx.stroke();
    ctx.fillStyle = hexA(color, 0.8);
    circle(ctx, 0, 0, r * 0.12);
    ctx.fill();
  },
  // Ocean: a little sandbank in the lagoon, foam round it
  islet(ctx, r, color, seed) {
    blob(ctx, r * 1.16, 9, seed);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fill();
    blob(ctx, r * 1.02, 9, seed);
    const g = ctx.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#fff3cf');
    g.addColorStop(1, '#e3c88a');
    ctx.fillStyle = g;
    ctx.fill();
    circle(ctx, 0, 0, r * 0.62);
    ctx.fillStyle = hexA(color, 0.85);
    ctx.fill();
    ctx.lineWidth = r * 0.07;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.stroke();
  },
  // Forest: the top of a tree stump, growth rings and all
  stump(ctx, r, color, seed) {
    blob(ctx, r * 1.08, 11, seed, 0.06);
    ctx.fillStyle = '#5a3b1e';
    ctx.fill();
    circle(ctx, 0, 0, r * 0.9);
    ctx.fillStyle = mix('#e6cf9c', color, 0.35);
    ctx.fill();
    ctx.lineWidth = r * 0.05;
    ctx.strokeStyle = hexA(mix(color, '#5a3b1e', 0.5), 0.6);
    for (const k of [0.7, 0.48, 0.26]) {
      circle(ctx, r * 0.04, -r * 0.03, r * k);
      ctx.stroke();
    }
    ctx.lineWidth = r * 0.09;
    ctx.strokeStyle = color;
    circle(ctx, 0, 0, r * 0.9);
    ctx.stroke();
  },
  // Ice: a six-sided crystal of ice, tinted with the player's colour
  crystal(ctx, r, color) {
    const hex = polygon(6, r * 1.08);
    path(ctx, hex);
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, mix(color, '#ffffff', 0.25));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = r * 0.035;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    for (const [x, y] of hex) {
      ctx.moveTo(0, 0);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    path(ctx, polygon(6, r * 0.55));
    ctx.fillStyle = hexA(color, 0.8);
    ctx.fill();
    ctx.lineWidth = r * 0.1;
    ctx.strokeStyle = mix(color, '#ffffff', 0.15);
    path(ctx, hex);
    ctx.stroke();
  },
  // Lava: a slab of basalt to stand on, its edge glowing
  slab(ctx, r, color, seed) {
    blob(ctx, r * 1.05, 8, seed, 0.1);
    const g = ctx.createRadialGradient(-r * 0.2, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#5a4a45');
    g.addColorStop(1, '#221614');
    ctx.fillStyle = g;
    ctx.shadowColor = color;
    ctx.shadowBlur = 0.3 * tileK;
    ctx.fill();
    ctx.lineWidth = r * 0.1;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = r * 0.04;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, -r * 0.1);
    ctx.lineTo(-r * 0.15, r * 0.1);
    ctx.lineTo(r * 0.1, -r * 0.25);
    ctx.moveTo(-r * 0.15, r * 0.1);
    ctx.lineTo(r * 0.05, r * 0.6);
    ctx.stroke();
  },
  // Royal: a gold medallion, enamelled in the player's colour
  medal(ctx, r, color) {
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, '#fff1b0');
    g.addColorStop(0.5, '#d9a92e');
    g.addColorStop(1, '#9a6f00');
    circle(ctx, 0, 0, r * 1.06);
    ctx.fillStyle = g;
    ctx.fill();
    const e = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.05, 0, 0, r * 0.85);
    e.addColorStop(0, mix(color, '#ffffff', 0.35));
    e.addColorStop(1, mix(color, '#000000', 0.15));
    circle(ctx, 0, 0, r * 0.84);
    ctx.fillStyle = e;
    ctx.fill();
    ctx.lineWidth = r * 0.045;
    ctx.strokeStyle = 'rgba(255, 233, 160, 0.85)';
    circle(ctx, 0, 0, r * 0.64);
    ctx.stroke();
  },
};

// The corners of a square yard, dressed in the theme (art.decor). (x, y) is the yard's middle,
// `outer`/`inner` half its size and half the size of the panel inside it.
export function baseDecor(ctx, kind, x, y, outer, inner, color) {
  const m = (outer + inner) / 2; // the middle of the band between panel and edge
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy], i) => {
    ctx.save();
    ctx.translate(sx * m, sy * m);
    DECOR[kind](ctx, sx, sy, i, color, outer - inner);
    ctx.restore();
  });
  ctx.restore();
}

// A picture made of square pixels: rows of '#' and '.', centred on (0, 0), each pixel `u` wide
export function pixelArt(ctx, rows, u, color) {
  ctx.fillStyle = color;
  const w = rows[0].length;
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) if (row[x] === '#') ctx.fillRect((x - w / 2) * u, (y - rows.length / 2) * u, u * 1.02, u * 1.02);
  });
}
export const PIXEL_BUG = ['..#..#..', '.######.', '##.##.##', '########', '.#.##.#.', '#.#..#.#'];
export const PIXEL_HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];

export const DECOR = {
  // Crystal: a cluster of crystal points growing out of the corner, in the player's colour, with
  // a clear quartz one among them
  geode(ctx, sx, sy, i, color) {
    ctx.rotate(Math.atan2(-sy, -sx) - Math.PI / 2 + Math.PI); // points lean in, away from the corner
    ctx.scale(1.35, 1.35);
    const shards = [[-0.15, 0.05, -0.45, 0.32, color], [0.16, 0.06, 0.4, 0.3, color], [0.02, 0.1, 0.02, 0.44, '#eaf2ff'], [-0.27, 0.12, -0.9, 0.2, color], [0.28, 0.12, 0.9, 0.2, mix(color, '#ffffff', 0.25)]];
    for (const [x, y, lean, len, c] of shards) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(lean * 0.6);
      const w = 0.06 + len * 0.12;
      const tip = -len;
      // two faces of a hexagonal point: a lit one and a shaded one
      path(ctx, [[-w, 0], [-w, tip + w * 1.2], [0, tip], [0, 0]]);
      ctx.fillStyle = mix(c, '#ffffff', 0.4);
      ctx.fill();
      path(ctx, [[0, 0], [0, tip], [w, tip + w * 1.2], [w, 0]]);
      ctx.fillStyle = mix(c, '#000000', 0.25);
      ctx.fill();
      path(ctx, [[-w, 0], [-w, tip + w * 1.2], [0, tip], [w, tip + w * 1.2], [w, 0]]);
      ctx.lineWidth = 0.018;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.stroke();
      ctx.restore();
    }
    // the rock they grow from
    ctx.beginPath();
    ctx.ellipse(0, 0.14, 0.36, 0.1, 0, 0, TAU);
    ctx.fillStyle = '#2a1f40';
    ctx.fill();
  },
  // Haunted: a leaning headstone
  grave(ctx, sx, sy, i) {
    ctx.rotate((rnd(i + 3) - 0.5) * 0.5);
    ctx.beginPath();
    ctx.moveTo(-0.17, 0.26);
    ctx.lineTo(-0.17, -0.08);
    ctx.arc(0, -0.08, 0.17, Math.PI, 0);
    ctx.lineTo(0.17, 0.26);
    ctx.closePath();
    ctx.fillStyle = '#8f8aa6';
    ctx.fill();
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = '#3a3552';
    ctx.stroke();
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.moveTo(0, -0.14);
    ctx.lineTo(0, 0.08);
    ctx.moveTo(-0.08, -0.06);
    ctx.lineTo(0.08, -0.06);
    ctx.stroke();
  },
  // Space: a little ringed planet
  planet(ctx, sx, sy, i) {
    ctx.rotate(-0.4 + i);
    circle(ctx, 0, 0, 0.17);
    ctx.fillStyle = ['#ffb02e', '#5aa8ff', '#b07bff', '#3fd8a4'][i % 4];
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    circle(ctx, 0.05, 0.05, 0.13);
    ctx.fill();
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.32, 0.08, 0, 0, TAU);
    ctx.stroke();
  },
  // Dragon's lair: a heap of gold coins and a gem
  hoard(ctx, sx, sy, i, color) {
    for (const [x, y] of [[-0.18, 0.1], [0.14, 0.12], [-0.02, 0.02], [0.2, -0.04], [-0.14, -0.08], [0.04, -0.14]]) {
      ctx.beginPath();
      ctx.ellipse(x, y, 0.12, 0.07, 0, 0, TAU);
      ctx.fillStyle = '#ffd23f';
      ctx.fill();
      ctx.lineWidth = 0.02;
      ctx.strokeStyle = '#9a6f00';
      ctx.stroke();
    }
    path(ctx, polygon(4, 0.1).map(([x, y]) => [x + 0.02, y - 0.2]));
    ctx.fillStyle = mix(color, '#ffffff', 0.4);
    ctx.fill();
    ctx.stroke();
  },
  // Sakura: a twig in blossom
  sakura(ctx, sx, sy, i) {
    ctx.rotate(Math.atan2(-sy, -sx) + 0.3);
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = '#7a4a34';
    ctx.beginPath();
    ctx.moveTo(-0.34, 0.06);
    ctx.quadraticCurveTo(0, -0.08, 0.34, 0.04);
    ctx.moveTo(0.02, -0.03);
    ctx.lineTo(0.16, -0.22);
    ctx.stroke();
    ctx.lineWidth = 0.012;
    ctx.strokeStyle = '#f29ab8';
    for (const [x, y, r] of [[0.32, 0.04, 0.11], [0.16, -0.24, 0.09], [-0.12, 0.0, 0.08]]) {
      ctx.save();
      ctx.translate(x, y);
      blossom(ctx, r, i % 2 ? '#ffd6e2' : '#fff5f8', '#f6c453');
      ctx.restore();
    }
  },
  // Desert: a cactus (one of them in flower)
  desert(ctx, sx, sy, i) {
    ctx.lineCap = 'round';
    for (const [w, c] of [[0.2, '#2f6b3a'], [0.14, '#5fae5a']]) {
      ctx.lineWidth = w;
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.moveTo(0, 0.26);
      ctx.lineTo(0, -0.24);
      ctx.moveTo(0, 0.04);
      ctx.lineTo(-0.2, 0.04);
      ctx.lineTo(-0.2, -0.1);
      ctx.moveTo(0, 0.12);
      ctx.lineTo(0.2, 0.12);
      ctx.lineTo(0.2, -0.02);
      ctx.stroke();
    }
    if (i % 2 === 0) {
      circle(ctx, 0, -0.3, 0.06);
      ctx.fillStyle = '#ff6fa0';
      ctx.fill();
    }
  },
  // Arcade: a pixel invader in each corner
  arcade(ctx, sx, sy, i, color) {
    pixelArt(ctx, PIXEL_BUG, 0.07, mix(color, '#ffffff', 0.55));
  },
  // Wood: brass corner brackets, each held by two screws
  wood(ctx, sx, sy, i, color, band) {
    const a = band * 0.42;
    const g = ctx.createLinearGradient(-a, -a, a, a);
    g.addColorStop(0, '#f6dc8c');
    g.addColorStop(1, '#9c7420');
    ctx.lineWidth = 0.13;
    ctx.strokeStyle = 'rgba(40, 20, 4, 0.45)';
    for (const pass of [0, 1]) {
      ctx.beginPath();
      ctx.moveTo(sx * a, -sy * a * 1.6 + pass * 0);
      ctx.lineTo(sx * a, sy * a);
      ctx.lineTo(-sx * a * 1.6, sy * a);
      if (pass) {
        ctx.lineWidth = 0.09;
        ctx.strokeStyle = g;
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#6b4a10';
    for (const [px, py] of [[sx * a, -sy * a * 1.2], [-sx * a * 1.2, sy * a]]) {
      circle(ctx, px, py, 0.035);
      ctx.fill();
    }
  },
  // Candy: a pinch of sprinkles
  candy(ctx, sx, sy, i) {
    const colors = ['#ff5ca8', '#3fd8a4', '#ffd23f', '#5aa8ff', '#b07bff', '#ffffff'];
    for (let j = 0; j < 7; j++) {
      ctx.save();
      ctx.translate((rnd(i * 31 + j) - 0.5) * 0.55, (rnd(i * 17 + j + 5) - 0.5) * 0.55);
      ctx.rotate(rnd(i * 7 + j * 3) * TAU);
      ctx.fillStyle = colors[(i + j) % colors.length];
      roundRect(ctx, -0.09, -0.027, 0.18, 0.054, 0.027);
      ctx.fill();
      ctx.restore();
    }
  },
  // Neon: circuit traces turning the corner, a node at each end
  neon(ctx, sx, sy, i, color, band) {
    const a = band * 0.3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 0.18 * tileK;
    ctx.strokeStyle = hexA(color, 0.9);
    ctx.fillStyle = color;
    ctx.lineWidth = 0.035;
    for (const d of [0, 0.16]) {
      const b = a - d;
      ctx.beginPath();
      ctx.moveTo(sx * b, -sy * (a * 2.2 - d * 3));
      ctx.lineTo(sx * b, sy * (b - 0.12));
      ctx.lineTo(sx * (b - 0.12), sy * b);
      ctx.lineTo(-sx * (a * 2.2 - d * 3), sy * b);
      ctx.stroke();
      for (const [px, py] of [[sx * b, -sy * (a * 2.2 - d * 3)], [-sx * (a * 2.2 - d * 3), sy * b]]) {
        circle(ctx, px, py, 0.05);
        ctx.fill();
      }
    }
  },
  // Ocean: shells and starfish washed up on the sand
  ocean(ctx, sx, sy, i) {
    ctx.rotate((rnd(i + 2) - 0.5) * 1.2);
    ctx.globalAlpha = 0.9;
    motif(ctx, i % 2 ? 'starfish' : 'shell', 0, 0, 0.24, i % 2 ? '#ffb199' : '#fff3d6');
    ctx.lineWidth = 0.025;
    ctx.strokeStyle = 'rgba(120, 80, 40, 0.45)';
    ctx.stroke();
  },
  // Forest: fallen leaves, and a toadstool in one corner
  forest(ctx, sx, sy, i) {
    if (i === 2) {
      ctx.fillStyle = '#f4ead2';
      roundRect(ctx, -0.07, -0.02, 0.14, 0.24, 0.05);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, -0.02, 0.24, 0.19, 0, Math.PI, TAU);
      ctx.closePath();
      ctx.fillStyle = '#d8402f';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      for (const [px, py, pr] of [[-0.11, -0.09, 0.035], [0.05, -0.13, 0.045], [0.14, -0.05, 0.028]]) {
        circle(ctx, px, py, pr);
        ctx.fill();
      }
      return;
    }
    ['#b9d86a', '#e2a93a', '#8fc24f'].forEach((leaf, j) => {
      ctx.save();
      ctx.translate((j - 1) * 0.17, (j % 2) * 0.12 - 0.05);
      ctx.rotate(rnd(i * 5 + j) * TAU);
      motif(ctx, 'leaf', 0, 0, 0.17, leaf);
      ctx.restore();
    });
  },
  // Ice: frost in the corners
  ice(ctx, sx, sy, i) {
    ctx.rotate(rnd(i) * 1);
    snowflake(ctx, 0, 0, 0.26, 'rgba(255, 255, 255, 0.95)', 0.04);
    snowflake(ctx, sx * 0.34, -sy * 0.2, 0.11, 'rgba(255, 255, 255, 0.8)', 0.025);
    snowflake(ctx, -sx * 0.2, sy * 0.36, 0.09, 'rgba(255, 255, 255, 0.8)', 0.025);
  },
  // Lava: glowing cracks running in from the corner
  lava(ctx, sx, sy, i, color, band) {
    ctx.shadowColor = '#ff7a2a';
    ctx.shadowBlur = 0.2 * tileK;
    ctx.strokeStyle = '#ffc45a';
    ctx.lineWidth = 0.04;
    const o = band * 0.45;
    ctx.beginPath();
    for (let j = 0; j < 3; j++) {
      let px = sx * o;
      let py = sy * o;
      ctx.moveTo(px, py);
      const dir = Math.atan2(-sy, -sx) + (j - 1) * 0.75;
      for (let s = 0; s < 4; s++) {
        const a = dir + (rnd(i * 9 + j * 4 + s) - 0.5) * 1.3;
        px += Math.cos(a) * 0.2;
        py += Math.sin(a) * 0.2;
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
  },
  // Royal: gold filigree, a jewel in the middle of it
  royal(ctx, sx, sy, i, color) {
    ctx.strokeStyle = '#f3d27a';
    ctx.lineWidth = 0.035;
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(d * sx * 0.1, -d * sy * 0.3, d * sx * 0.45, -d * sy * 0.3, d * sx * 0.38, -d * sy * 0.02);
      ctx.bezierCurveTo(d * sx * 0.34, d * sy * 0.1, d * sx * 0.2, d * sy * 0.06, d * sx * 0.24, -d * sy * 0.06);
      ctx.stroke();
    }
    path(ctx, polygon(4, 0.12));
    ctx.fillStyle = mix(color, '#ffffff', 0.55);
    ctx.fill();
    ctx.stroke();
  },
  // Constellation: a compass star in each corner, like the corners of a star chart
  cosmos(ctx, sx, sy, i) {
    sparkle(ctx, 0, 0, 0.3, '#f3d98a');
    ctx.fillStyle = '#fff6d8';
    for (const [px, py] of [[sx * 0.36, 0], [0, sy * 0.36], [-sx * 0.3, -sy * 0.3]]) {
      circle(ctx, px, py, 0.03);
      ctx.fill();
    }
    ctx.lineWidth = 0.02;
    ctx.strokeStyle = 'rgba(243, 217, 138, 0.6)';
    circle(ctx, 0, 0, 0.2);
    ctx.stroke();
  },
};

// An eight-pointed compass star, each point split into a light and a dark half
export function compassStar(ctx, r, light, dark) {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2;
    const len = i % 2 ? r * 0.58 : r;
    const w = (i % 2 ? 0.16 : 0.2) * r;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.lineTo(Math.cos(a + side * 0.9) * w, Math.sin(a + side * 0.9) * w);
      ctx.closePath();
      ctx.fillStyle = side < 0 ? light : dark;
      ctx.fill();
    }
  }
}

// The emblem in the middle of the board (art.hub), radius r. The players' triangles stay visible
// round it; the dice lands on top of it.
export const HUBS = {
  // Crystal: a brilliant-cut diamond seen from above: an octagonal table, star and kite facets
  // in icy blues and whites, and flashes of colour (its fire)
  brilliant(ctx, r) {
    const R = r * 1.02;
    const ring = (n, rad, rot = 0) => Array.from({ length: n }, (_, j) => [Math.cos((j / n) * TAU + rot) * rad, Math.sin((j / n) * TAU + rot) * rad]);
    const rim = ring(16, R, Math.PI / 16);
    const mid = ring(8, R * 0.72, Math.PI / 8);
    const table = ring(8, R * 0.45, 0);
    ctx.save();
    ctx.shadowColor = 'rgba(190, 220, 255, 0.9)';
    ctx.shadowBlur = 0.5 * tileK;
    path(ctx, rim);
    ctx.fillStyle = '#b9cdf2';
    ctx.fill();
    ctx.restore();
    const shadeOf = (pts) => {
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      return Math.max(-1, Math.min(1, (-cx - cy) / R));
    };
    const fire = ['#ffd1e6', '#c7ffe9', '#fff1b8', '#d4ddff'];
    // the girdle facets: between the rim and the middle ring
    for (let j = 0; j < 16; j++) {
      const m = mid[Math.floor(((j + 1) % 16) / 2) % 8];
      const pts = [rim[j], rim[(j + 1) % 16], m];
      const l = shadeOf(pts);
      path(ctx, pts);
      ctx.fillStyle = j % 5 === 2 ? fire[j % 4] : l > 0 ? mix('#cfe0ff', '#ffffff', l * 0.8) : mix('#cfe0ff', '#5a6fb8', -l * 0.7);
      ctx.fill();
    }
    // the kites: middle ring to the table's corners
    for (let j = 0; j < 8; j++) {
      const pts = [mid[j], table[(j + 1) % 8], table[j]];
      const pts2 = [mid[j], rim[(2 * j + 1) % 16], table[(j + 1) % 8]];
      for (const [q, k] of [[pts, 0], [pts2, 1]]) {
        const l = shadeOf(q);
        path(ctx, q);
        ctx.fillStyle = (j + k) % 6 === 1 ? fire[(j + k) % 4] : l > 0 ? mix('#e3ecff', '#ffffff', l) : mix('#e3ecff', '#7b8fd0', -l * 0.6);
        ctx.fill();
      }
      path(ctx, [mid[j], rim[(2 * j) % 16], table[j]]);
      ctx.fillStyle = mix('#dbe6ff', shadeOf([mid[j], table[j]]) > 0 ? '#ffffff' : '#6c80c4', 0.35);
      ctx.fill();
    }
    path(ctx, table);
    const g = ctx.createLinearGradient(-R * 0.45, -R * 0.45, R * 0.45, R * 0.45);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#dfe9ff');
    g.addColorStop(1, '#b4c6ef');
    ctx.fillStyle = g;
    ctx.fill();
    // the lines between the facets
    ctx.lineWidth = r * 0.025;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    for (let j = 0; j < 8; j++) {
      ctx.moveTo(...table[j]);
      ctx.lineTo(...mid[j]);
      ctx.lineTo(...table[(j + 1) % 8]);
      ctx.moveTo(...mid[j]);
      ctx.lineTo(...rim[(2 * j) % 16]);
      ctx.moveTo(...mid[j]);
      ctx.lineTo(...rim[(2 * j + 1) % 16]);
    }
    ctx.stroke();
    path(ctx, table);
    ctx.stroke();
    path(ctx, rim);
    ctx.lineWidth = r * 0.06;
    ctx.strokeStyle = '#f4f8ff';
    ctx.stroke();
  },
  // Haunted: a ghost's face in the fog
  ghost(ctx, r) {
    ctx.beginPath();
    ctx.arc(0, -r * 0.15, r * 0.8, Math.PI, 0);
    ctx.lineTo(r * 0.8, r * 0.8);
    for (let i = 0; i < 4; i++) ctx.quadraticCurveTo(r * (0.6 - i * 0.4), r * (i % 2 ? 0.85 : 0.5), r * (0.4 - i * 0.4), r * 0.8);
    ctx.closePath();
    ctx.fillStyle = '#f4f2ff';
    ctx.fill();
    ctx.lineWidth = r * 0.07;
    ctx.strokeStyle = '#8f86c9';
    ctx.stroke();
    ctx.fillStyle = '#2a2140';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.28, -r * 0.15, r * 0.13, r * 0.19, 0, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(0, r * 0.25, r * 0.12, r * 0.16, 0, 0, TAU);
    ctx.fill();
  },
  // Swamp: a pool of bubbling goo
  goo(ctx, r) {
    blob(ctx, r * 1.05, 10, 4, 0.1);
    ctx.fillStyle = '#2f6b2a';
    ctx.fill();
    blob(ctx, r * 0.86, 10, 4, 0.1);
    const g = ctx.createRadialGradient(-r * 0.2, -r * 0.25, 0, 0, 0, r);
    g.addColorStop(0, '#d6ff9a');
    g.addColorStop(1, '#5fbf3a');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = r * 0.05;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    for (const [x, y, b] of [[-0.3, 0.1, 0.2], [0.25, -0.2, 0.14], [0.2, 0.35, 0.1]]) {
      circle(ctx, x * r, y * r, b * r);
      ctx.stroke();
    }
  },
  // Factory: one big cog
  cog(ctx, r) {
    ctx.fillStyle = '#4a5466';
    for (let i = 0; i < 10; i++) {
      ctx.rotate(TAU / 10);
      ctx.fillRect(-r * 0.16, -r * 1.12, r * 0.32, r * 0.3);
    }
    circle(ctx, 0, 0, r * 0.92);
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, '#e6ecf5');
    g.addColorStop(1, '#6f7a8c');
    ctx.fillStyle = g;
    ctx.fill();
    circle(ctx, 0, 0, r * 0.5);
    ctx.fillStyle = '#1b2233';
    ctx.fill();
    circle(ctx, 0, 0, r * 0.26);
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
  },
  // Space: a ringed planet
  planet(ctx, r) {
    ctx.rotate(-0.4);
    const ring = (from, to) => {
      ctx.lineWidth = r * 0.14;
      ctx.strokeStyle = '#e9d7a8';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.25, r * 0.36, 0, from, to);
      ctx.stroke();
    };
    ring(Math.PI, TAU);
    circle(ctx, 0, 0, r * 0.74);
    const g = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.05, 0, 0, r * 0.8);
    g.addColorStop(0, '#ffd9a0');
    g.addColorStop(0.6, '#e08a3a');
    g.addColorStop(1, '#7a3a1a');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = r * 0.07;
    ctx.strokeStyle = 'rgba(120, 50, 20, 0.5)';
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.1);
    ctx.quadraticCurveTo(0, r * 0.1, r * 0.7, -r * 0.15);
    ctx.stroke();
    ring(0, Math.PI);
  },
  // Sakura: one great blossom
  blossom(ctx, r) {
    ctx.lineWidth = r * 0.04;
    ctx.strokeStyle = '#f29ab8';
    blossom(ctx, r * 1.05, '#fff5f8', '#f6c453');
    ctx.fillStyle = '#d98a2a';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      circle(ctx, Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2, r * 0.04);
      ctx.fill();
    }
  },
  // Desert: the sun
  sun(ctx, r) {
    compassStar(ctx, r * 1.05, '#ffd76a', '#f29a2e');
    circle(ctx, 0, 0, r * 0.56);
    const g = ctx.createRadialGradient(-r * 0.15, -r * 0.2, r * 0.05, 0, 0, r * 0.56);
    g.addColorStop(0, '#fff6c2');
    g.addColorStop(1, '#ffb52e');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = r * 0.05;
    ctx.strokeStyle = '#d9822a';
    ctx.stroke();
  },
  // Arcade: a pixel heart on a dark screen
  heart(ctx, r) {
    ctx.fillStyle = '#0c0c1c';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.lineWidth = r * 0.1;
    ctx.strokeStyle = '#2ef2ff';
    ctx.strokeRect(-r, -r, r * 2, r * 2);
    pixelArt(ctx, PIXEL_HEART, r * 0.22, '#ff3d7f');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-r * 0.55, -r * 0.44, r * 0.22, r * 0.22);
  },
  // Wood: a marquetry compass star set into a walnut disc
  inlay(ctx, r) {
    circle(ctx, 0, 0, r);
    ctx.fillStyle = '#5a3414';
    ctx.fill();
    ctx.lineWidth = r * 0.07;
    ctx.strokeStyle = '#e7c79a';
    ctx.stroke();
    compassStar(ctx, r * 0.86, '#f6e2b8', '#b9824a');
  },
  // Candy: a peppermint swirl
  swirl(ctx, r) {
    circle(ctx, 0, 0, r);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#ff5c8f';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(a + 0.5) * r * 0.6, Math.sin(a + 0.5) * r * 0.6, Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1);
      ctx.lineTo(Math.cos(a + 0.52) * r * 1.1, Math.sin(a + 0.52) * r * 1.1);
      ctx.quadraticCurveTo(Math.cos(a + 0.95) * r * 0.6, Math.sin(a + 0.95) * r * 0.6, 0, 0);
      ctx.fill();
    }
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, 0, 0, 0, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
    ctx.lineWidth = r * 0.08;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.lineWidth = r * 0.03;
    ctx.strokeStyle = '#f7a8c4';
    circle(ctx, 0, 0, r * 1.05);
    ctx.stroke();
  },
  // Neon: a target of glowing rings
  rings(ctx, r) {
    circle(ctx, 0, 0, r);
    ctx.fillStyle = 'rgba(6, 7, 14, 0.8)';
    ctx.fill();
    ['#2ef2ff', '#ff2fd1', '#ffe04a'].forEach((c, i) => {
      ctx.shadowColor = c;
      ctx.shadowBlur = 0.25 * tileK;
      ctx.lineWidth = r * 0.06;
      ctx.strokeStyle = c;
      circle(ctx, 0, 0, r * (1 - i * 0.3));
      ctx.stroke();
    });
  },
  // Ocean: a ship's compass
  compass(ctx, r) {
    circle(ctx, 0, 0, r);
    ctx.fillStyle = '#f6ecd2';
    ctx.fill();
    ctx.lineWidth = r * 0.1;
    ctx.strokeStyle = '#c99a4a';
    ctx.stroke();
    ctx.lineWidth = r * 0.03;
    ctx.strokeStyle = '#0d4a6b';
    circle(ctx, 0, 0, r * 0.8);
    ctx.stroke();
    compassStar(ctx, r * 0.78, '#ff7a59', '#0d4a6b');
  },
  // Forest: a great stump
  stump(ctx, r) {
    blob(ctx, r * 1.04, 14, 3, 0.05);
    ctx.fillStyle = '#4b3018';
    ctx.fill();
    circle(ctx, 0, 0, r * 0.9);
    ctx.fillStyle = '#e2c992';
    ctx.fill();
    ctx.lineWidth = r * 0.03;
    ctx.strokeStyle = 'rgba(122, 82, 42, 0.55)';
    for (let i = 1; i < 6; i++) {
      circle(ctx, r * 0.05, -r * 0.04, r * 0.15 * i);
      ctx.stroke();
    }
    ctx.rotate(-0.5);
    motif(ctx, 'leaf', 0, 0, r * 0.42, '#5d9a2e');
  },
  // Ice: one great snowflake
  flake(ctx, r) {
    path(ctx, polygon(6, r * 1.04));
    ctx.fillStyle = 'rgba(232, 247, 255, 0.92)';
    ctx.fill();
    ctx.lineWidth = r * 0.06;
    ctx.strokeStyle = '#7fc4e8';
    ctx.stroke();
    snowflake(ctx, 0, 0, r * 0.82, '#3a9fd0', r * 0.09);
  },
  // Lava: a crater, white-hot in the middle
  crater(ctx, r) {
    blob(ctx, r * 1.08, 10, 5, 0.08);
    ctx.fillStyle = '#1e1210';
    ctx.fill();
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.9);
    g.addColorStop(0, '#fff3b0');
    g.addColorStop(0.35, '#ffb02e');
    g.addColorStop(0.75, '#e8421a');
    g.addColorStop(1, '#5a1608');
    blob(ctx, r * 0.86, 9, 8, 0.1);
    ctx.fillStyle = g;
    ctx.fill();
  },
  // Cat: a big paw print on a cushion
  paw(ctx, r) {
    circle(ctx, 0, 0, r);
    ctx.fillStyle = '#f7ecdc';
    ctx.fill();
    ctx.setLineDash([r * 0.14, r * 0.1]);
    ctx.lineWidth = r * 0.045;
    ctx.strokeStyle = '#a8683e';
    circle(ctx, 0, 0, r * 0.86);
    ctx.stroke();
    ctx.setLineDash([]);
    pawPrint(ctx, 0, r * 0.06, r * 0.5, '#b9784a');
  },
  // Royal: the crown, on a gold-rimmed seal
  seal(ctx, r) {
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, '#fff1b0');
    g.addColorStop(0.5, '#d9a92e');
    g.addColorStop(1, '#9a6f00');
    circle(ctx, 0, 0, r * 1.04);
    ctx.fillStyle = g;
    ctx.fill();
    circle(ctx, 0, 0, r * 0.86);
    ctx.fillStyle = '#3a2068';
    ctx.fill();
    ctx.lineWidth = r * 0.03;
    ctx.strokeStyle = '#f3d27a';
    circle(ctx, 0, 0, r * 0.74);
    ctx.stroke();
    motif(ctx, 'crown', 0, r * 0.04, r * 0.44, '#f6cf57');
  },
};

// A player's base block (its path already set), in the theme's style:
//  solid (default) · outline: dark with a neon edge · rock: dark stone with a glowing rim ·
//  frame: a gold border · frosted: pale with a white rim · pool: water, lighter in the middle ·
//  inlay: a wooden frame · dusk: the colour fading into the night · cushion: soft, with stitching
export function paintBase(ctx, art, theme, x, y, w, h, color, k) {
  const style = art.base || 'solid';
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (style === 'outline') ctx.fillStyle = '#0c0d16';
  else if (style === 'rock') ctx.fillStyle = mix(color, '#000000', 0.6);
  else if (style === 'frosted') ctx.fillStyle = mix(color, '#ffffff', 0.3);
  else if (style === 'celestial') ctx.fillStyle = 'rgba(8, 10, 40, 0.55)';
  else if (style === 'moonlit') ctx.fillStyle = mix(color, '#141726', 0.3);
  else if (art.baseLight) ctx.fillStyle = mix(color, '#ffffff', art.baseLight);
  else ctx.fillStyle = color;
  ctx.fill();
  const tex = texPattern(ctx, art.tex?.base);
  if (tex) {
    ctx.save();
    ctx.globalCompositeOperation = art.tex.base.blend || 'soft-light';
    ctx.globalAlpha = art.tex.base.alpha ?? 1;
    ctx.fillStyle = tex;
    ctx.fill();
    ctx.restore();
  }
  if (style === 'pool' || style === 'dusk' || style === 'rock') {
    ctx.save();
    ctx.clip();
    let g;
    if (style === 'pool') {
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.7);
      g.addColorStop(0, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(0,30,60,0.35)');
    } else if (style === 'dusk') {
      g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, 'rgba(10,12,40,0)');
      g.addColorStop(1, 'rgba(10,12,40,0.7)');
    } else {
      g = ctx.createRadialGradient(cx, cy, w * 0.2, cx, cy, w * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, color);
      ctx.globalAlpha = 0.55;
    }
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  basePattern(ctx, art, x, y, w, h, color);
  ctx.save();
  if (style === 'outline' || style === 'rock') {
    ctx.shadowColor = color;
    ctx.shadowBlur = 0.5 * k;
    ctx.lineWidth = style === 'outline' ? 0.14 : 0.18;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.stroke();
  } else if (style === 'frame') {
    ctx.lineWidth = 0.26;
    ctx.strokeStyle = '#d9a92e';
    ctx.stroke();
    ctx.lineWidth = 0.06;
    ctx.strokeStyle = '#fff1b8';
    ctx.stroke();
  } else if (style === 'frosted') {
    ctx.lineWidth = 0.2;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
  } else if (style === 'inlay') {
    ctx.lineWidth = 0.36;
    ctx.strokeStyle = '#6e4420';
    ctx.stroke();
    ctx.lineWidth = 0.08;
    ctx.strokeStyle = '#c99760';
    ctx.stroke();
  } else if (style === 'cushion') {
    ctx.lineWidth = 0.07;
    ctx.setLineDash([0.22, 0.16]);
    ctx.strokeStyle = art.stitch ? mix(color, art.stitch, 0.45) : 'rgba(255,255,255,0.75)';
    ctx.translate(cx, cy);
    ctx.scale(0.9, 0.9);
    ctx.translate(-cx, -cy);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (style === 'celestial') {
    ctx.lineWidth = 0.09;
    ctx.strokeStyle = '#d9b25a';
    ctx.stroke();
    ctx.translate(cx, cy);
    ctx.scale(0.94, 0.94);
    ctx.translate(-cx, -cy);
    ctx.shadowColor = color;
    ctx.shadowBlur = 0.3 * k;
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = color;
    ctx.stroke();
  } else if (style === 'pool') {
    ctx.lineWidth = 0.14;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.stroke();
  } else if (style === 'moonlit') {
    // a silver rim, as if the moon caught the edge
    ctx.lineWidth = 0.16;
    ctx.strokeStyle = mix(color, '#dfe5ff', 0.55);
    ctx.stroke();
    ctx.lineWidth = 0.045;
    ctx.strokeStyle = 'rgba(245, 247, 255, 0.85)';
    ctx.stroke();
  }
  ctx.restore();
}

// The pattern over a coloured base block, clipped to the path that was just filled.
export function basePattern(ctx, art, x, y, w, h, color) {
  ctx.save();
  ctx.clip();
  // depth: lighter in the top-left, darker in the bottom-right
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const c = art.patternColor || 'rgba(255,255,255,0.18)';
  const kind = art.pattern;
  if (kind === 'stripes') {
    ctx.strokeStyle = c;
    ctx.lineWidth = 0.32;
    for (let k = -h; k < w + h; k += 0.8) {
      ctx.beginPath();
      ctx.moveTo(x + k, y);
      ctx.lineTo(x + k - h, y + h);
      ctx.stroke();
    }
  } else if (kind === 'grid') {
    ctx.strokeStyle = c;
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    for (let k = 0; k <= w; k += 0.6) {
      ctx.moveTo(x + k, y);
      ctx.lineTo(x + k, y + h);
      ctx.moveTo(x, y + k);
      ctx.lineTo(x + w, y + k);
    }
    ctx.stroke();
  } else if (kind === 'waves' || kind === 'grain') {
    ctx.strokeStyle = c;
    ctx.lineWidth = kind === 'waves' ? 0.09 : 0.05;
    const step = kind === 'waves' ? 0.55 : 0.32;
    for (let j = 0, yy = y; yy < y + h + 0.5; yy += step, j++) {
      ctx.beginPath();
      for (let xx = x; xx <= x + w + 0.2; xx += 0.1) {
        const off = kind === 'waves' ? Math.sin(xx * 3.2 + j * 1.3) * 0.12 : Math.sin(xx * 1.4 + j) * 0.08 + Math.sin(xx * 5 + j * 2) * 0.02;
        ctx.lineTo(xx, yy + off);
      }
      ctx.stroke();
    }
  } else if (kind) {
    // a scatter of little motifs
    const gap = art.patternGap || 0.95;
    let i = 0;
    for (let yy = y + gap / 2; yy < y + h; yy += gap) {
      for (let xx = x + gap / 2 + ((Math.round((yy - y) / gap) % 2) * gap) / 2; xx < x + w; xx += gap, i++) {
        const jx = (rnd(i + 3) - 0.5) * gap * 0.3;
        const jy = (rnd(i + 9) - 0.5) * gap * 0.3;
        ctx.save();
        ctx.translate(xx + jx, yy + jy);
        ctx.rotate((rnd(i) - 0.5) * (art.patternSpin ?? 1));
        motif(ctx, kind, 0, 0, art.patternSize || 0.2, c);
        ctx.restore();
      }
    }
  }
  ctx.restore();
}

// The panel inside a base where the pins wait: a soft glow, and the theme's emblem faintly.
export function innerPanel(ctx, theme, x, y, r, color, square = true) {
  const art = theme.art || {};
  if (art.panel === 'fluffy') {
    // A soft cushion: puffs all round the edge, then the cushion itself, gently shaded
    ctx.save();
    const pts = [];
    if (square) {
      const step = 0.24;
      for (let d = -r; d < r; d += step) pts.push([x + d, y - r], [x + r, y + d], [x - d, y + r], [x - r, y - d]);
    } else for (let i = 0; i < 40; i++) pts.push([x + Math.cos((i / 40) * TAU) * r, y + Math.sin((i / 40) * TAU) * r]);
    ctx.shadowColor = 'rgba(110, 66, 30, 0.35)';
    ctx.shadowBlur = 0.15 * tileK;
    ctx.shadowOffsetY = 0.04 * tileK;
    ctx.fillStyle = theme.baseInner;
    pts.forEach(([px, py], i) => {
      circle(ctx, px, py, 0.16 + rnd(i * 3 + 1) * 0.05);
      ctx.fill();
    });
    ctx.restore();
    ctx.save();
    if (square) roundRect(ctx, x - r, y - r, r * 2, r * 2, 0.3);
    else circle(ctx, x, y, r);
    ctx.fillStyle = theme.baseInner;
    ctx.fill();
    const tex = texPattern(ctx, art.tex?.panel);
    if (tex) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = tex;
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    ctx.clip();
    const g = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.1, x, y, r * 1.4);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(120, 70, 30, 0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 1.5, y - r * 1.5, r * 3, r * 3);
    ctx.restore();
    return;
  }
  if (art.panel === 'window') {
    // An opening onto the surface below (the lagoon, the lava…), with a shaded rim for depth
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.clip();
    ctx.lineWidth = r * 0.22;
    ctx.strokeStyle = 'rgba(0,0,0,0.38)';
    ctx.stroke();
    ctx.lineWidth = r * 0.07;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = r * (art.windowRim ? 0.03 : 0.035);
    ctx.strokeStyle = art.windowRim || 'rgba(255,255,255,0.55)';
    ctx.stroke();
    return;
  }
  if (art.panel === 'moonlit') {
    // A dark yard with the moon over it: pale light pooling from one corner, a big faint crescent
    ctx.fillStyle = theme.baseInner;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const g = ctx.createRadialGradient(x - r * 0.55, y - r * 0.6, 0, x - r * 0.3, y - r * 0.3, r * 2.1);
    g.addColorStop(0, 'rgba(214, 222, 255, 0.5)');
    g.addColorStop(0.45, mix(color, '#1b1e2c', 0.45));
    g.addColorStop(1, 'rgba(8, 9, 16, 0.6)');
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 1.5, y - r * 1.5, r * 3, r * 3);
    ctx.restore();
    ctx.lineWidth = r * 0.035;
    ctx.strokeStyle = 'rgba(214, 222, 255, 0.55)';
    ctx.stroke();
    return;
  }
  const panelTex = texPattern(ctx, art.tex?.panel);
  ctx.fillStyle = panelTex || theme.baseInner;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.25, r * 0.1, x, y, r * 1.3);
  g.addColorStop(0, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, art.innerShade || 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r * 1.5, y - r * 1.5, r * 3, r * 3);
  if (art.emblem) {
    ctx.globalAlpha = art.emblemAlpha ?? 0.16;
    motif(ctx, art.emblem, x, y, r * 0.62, art.emblemColor || color);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// Small symbols used in patterns, on safe squares and as emblems. (x, y) is the centre,
// s about half the width.
export function motif(ctx, kind, x, y, s, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  switch (kind) {
    case 'star':
      drawStar(ctx, x, y, s, color);
      return;
    case 'sparkle':
      sparkle(ctx, x, y, s * 1.25, color);
      return;
    case 'paw':
      pawPrint(ctx, x, y + s * 0.05, s * 0.95, color);
      return;
    case 'snowflake':
    case 'snow':
      snowflake(ctx, x, y, s, color, s * 0.16);
      return;
    case 'moon':
    case 'stars':
      if (kind === 'stars') {
        drawStar(ctx, x, y, s * 0.55, color);
        return;
      }
      ctx.beginPath();
      ctx.moveTo(x + s * 0.25, y - s);
      ctx.bezierCurveTo(x - s * 1.25, y - s * 0.85, x - s * 1.25, y + s * 0.85, x + s * 0.25, y + s);
      ctx.bezierCurveTo(x - s * 0.55, y + s * 0.55, x - s * 0.55, y - s * 0.55, x + s * 0.25, y - s);
      ctx.fill();
      return;
    case 'heart':
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.85);
      ctx.bezierCurveTo(x - s * 1.25, y - s * 0.05, x - s * 0.55, y - s * 1.05, x, y - s * 0.4);
      ctx.bezierCurveTo(x + s * 0.55, y - s * 1.05, x + s * 1.25, y - s * 0.05, x, y + s * 0.85);
      ctx.fill();
      return;
    case 'starfish': {
      // five plump, rounded arms
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a0 = (i / 5) * TAU - Math.PI / 2;
        const a1 = a0 + Math.PI / 5;
        const tip = [x + Math.cos(a0) * s, y + Math.sin(a0) * s];
        const inner = [x + Math.cos(a1) * s * 0.42, y + Math.sin(a1) * s * 0.42];
        if (i === 0) ctx.moveTo(...tip);
        ctx.quadraticCurveTo(x + Math.cos(a0 + 0.3) * s * 0.62, y + Math.sin(a0 + 0.3) * s * 0.62, ...inner);
        const next = (i + 1) / 5 * TAU - Math.PI / 2;
        ctx.quadraticCurveTo(x + Math.cos(next - 0.3) * s * 0.62, y + Math.sin(next - 0.3) * s * 0.62, x + Math.cos(next) * s, y + Math.sin(next) * s);
      }
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 5; i++) {
        const a0 = (i / 5) * TAU - Math.PI / 2;
        for (const d of [0.25, 0.5]) {
          circle(ctx, x + Math.cos(a0) * s * d, y + Math.sin(a0) * s * d, s * 0.06);
          ctx.fill();
        }
      }
      ctx.restore();
      return;
    }
    case 'shell':
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.85);
      ctx.lineTo(x - s * 0.95, y - s * 0.15);
      ctx.quadraticCurveTo(x, y - s * 1.35, x + s * 0.95, y - s * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = s * 0.08;
      ctx.beginPath();
      for (const a of [-0.6, -0.3, 0, 0.3, 0.6]) {
        ctx.moveTo(x, y + s * 0.75);
        ctx.lineTo(x + Math.sin(a) * s * 0.95, y + s * 0.75 - Math.cos(a) * s * 1.5);
      }
      ctx.stroke();
      ctx.restore();
      return;
    case 'leaf':
    case 'leaves':
      ctx.beginPath();
      ctx.moveTo(x, y + s);
      ctx.bezierCurveTo(x - s * 0.95, y + s * 0.2, x - s * 0.6, y - s * 0.8, x, y - s);
      ctx.bezierCurveTo(x + s * 0.6, y - s * 0.8, x + s * 0.95, y + s * 0.2, x, y + s);
      ctx.fill();
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = s * 0.08;
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.9);
      ctx.lineTo(x, y - s * 0.7);
      ctx.stroke();
      ctx.restore();
      return;
    case 'flame':
    case 'flames':
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.bezierCurveTo(x + s * 0.35, y - s * 0.35, x + s * 0.9, y - s * 0.1, x + s * 0.65, y + s * 0.5);
      ctx.quadraticCurveTo(x + s * 0.4, y + s, x, y + s);
      ctx.quadraticCurveTo(x - s * 0.4, y + s, x - s * 0.65, y + s * 0.5);
      ctx.bezierCurveTo(x - s * 0.85, y, x - s * 0.2, y - s * 0.3, x, y - s);
      ctx.fill();
      return;
    case 'crown':
      path(ctx, [[x - s, y + s * 0.6], [x - s, y - s * 0.5], [x - s * 0.5, y], [x, y - s * 0.8], [x + s * 0.5, y], [x + s, y - s * 0.5], [x + s, y + s * 0.6]]);
      ctx.fill();
      return;
    case 'damask':
      path(ctx, [[x, y - s], [x + s * 0.55, y], [x, y + s], [x - s * 0.55, y]]);
      ctx.fill();
      circle(ctx, x, y - s * 1.2, s * 0.15);
      ctx.fill();
      return;
    case 'candy': {
      ctx.beginPath();
      ctx.ellipse(x, y, s * 0.55, s * 0.4, 0, 0, TAU);
      ctx.fill();
      path(ctx, [[x - s * 0.5, y], [x - s, y - s * 0.4], [x - s, y + s * 0.4]]);
      ctx.fill();
      path(ctx, [[x + s * 0.5, y], [x + s, y - s * 0.4], [x + s, y + s * 0.4]]);
      ctx.fill();
      return;
    }
    case 'cat':
      circle(ctx, x, y + s * 0.15, s * 0.75);
      ctx.fill();
      path(ctx, [[x - s * 0.7, y - s * 0.1], [x - s * 0.62, y - s * 0.95], [x - s * 0.15, y - s * 0.55]]);
      ctx.fill();
      path(ctx, [[x + s * 0.7, y - s * 0.1], [x + s * 0.62, y - s * 0.95], [x + s * 0.15, y - s * 0.55]]);
      ctx.fill();
      return;
    default:
      drawStar(ctx, x, y, s, color);
  }
}

export const setTileK = (k) => (tileK = k);
export const setDrawingFor = (r) => (drawingFor = r);

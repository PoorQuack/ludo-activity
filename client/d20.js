// The daily chest's d20, as a real 3D icosahedron: 20 numbered triangles, lit from the top left.
// It wobbles while it waits, tumbles end over end when rolled, and lands with the rolled number
// facing you with beveled metallic/crystal facets, specular highlights, and celebratory sparkles.

import { sparkle } from './draw-util.js';
import { convexHull } from './draw-dice.js';

const TAU = Math.PI * 2;
const PHI = (1 + Math.sqrt(5)) / 2;

// ---------- the solid ----------
const RAW = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];
const VERTS = RAW.map((v) => scale(v, 1 / Math.hypot(...v)));

// Faces: every three vertices that are all one edge apart (edge 2 before normalising).
const FACES = [];
for (let a = 0; a < 12; a++)
  for (let b = a + 1; b < 12; b++)
    for (let c = b + 1; c < 12; c++) {
      const e = (i, j) => Math.abs(Math.hypot(...sub(RAW[i], RAW[j])) - 2) < 1e-6;
      if (!(e(a, b) && e(b, c) && e(a, c))) continue;
      const centre = scale(add(add(VERTS[a], VERTS[b]), VERTS[c]), 1 / 3);
      let tri = [a, b, c];
      // wind them the same way round (outward normal)
      if (dot(cross(sub(VERTS[b], VERTS[a]), sub(VERTS[c], VERTS[a])), centre) < 0) tri = [a, c, b];
      const n = norm(centre);
      // the face's own axes: "up" points at its first corner, so the number stands upright
      const up = norm(sub(VERTS[tri[0]], centre));
      const right = cross(up, n);
      FACES.push({ tri, n, up, right, centre });
    }
// Numbers like a real d20: opposite faces add up to 21.
{
  let next = 1;
  for (const f of FACES) {
    if (f.value) continue;
    const opposite = FACES.find((g) => !g.value && g !== f && dot(g.n, f.n) < -0.99);
    f.value = next;
    opposite.value = 21 - next;
    next++;
  }
}
const BY_VALUE = Object.fromEntries(FACES.map((f) => [f.value, f]));

// The rotation that turns face `value` towards you, number upright.
function faceFront(value) {
  const f = BY_VALUE[value];
  // rows: where the face's right, up and normal end up (x right, -y up, z towards you)
  return [...f.right, ...scale(f.up, -1), ...f.n];
}
// Square on: the rolled face sits dead centre (the faces around it still show, it's a d20).
// Any tilt pushes the front face off centre and makes a neighbour look like the result.
const REST_TILT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
// Every roll takes the same time, whatever number it lands on.
export const ROLL_MS = 2000;

// ---------- lighting and materials ----------
const LIGHT = norm([-0.42, -0.68, 0.60]);
const VIEW = [0, 0, 1];
const HALF = norm(add(LIGHT, VIEW));
const LIGHT_2D = norm([-0.42, -0.68]);

const SKINS = {
  gold: {
    name: 'gold',
    body: '#754605',
    faceLit: [255, 235, 140],
    faceBase: [255, 198, 55],
    faceMid: [210, 145, 20],
    faceShade: [110, 68, 6],
    edgeLit: 'rgba(255, 248, 205, 0.85)',
    edgeShade: 'rgba(40, 20, 0, 0.75)',
    outline: '#8c5807',
    glow: 'rgba(255, 195, 45, 0.45)',
    glowLanded: 'rgba(255, 220, 80, 0.75)',
    text: '#221200',
    textHighlight: 'rgba(255, 245, 195, 0.9)',
    textShadow: 'rgba(35, 18, 0, 0.5)',
    sparks: ['#fff9d4', '#ffd700', '#ffb300', '#ffffff'],
  },
  used: {
    name: 'used',
    body: '#140c1e',
    faceLit: [195, 175, 245],
    faceBase: [100, 80, 155],
    faceMid: [58, 42, 92],
    faceShade: [20, 13, 35],
    edgeLit: 'rgba(215, 200, 255, 0.75)',
    edgeShade: 'rgba(10, 5, 20, 0.8)',
    outline: '#2e2048',
    glow: 'rgba(145, 115, 235, 0.25)',
    glowLanded: 'rgba(175, 145, 255, 0.55)',
    text: '#ede8fa',
    textHighlight: 'rgba(255, 255, 255, 0.95)',
    textShadow: 'rgba(12, 6, 22, 0.7)',
    sparks: ['#e8e0ff', '#b39ddb', '#7e57c2', '#ffffff'],
  },
};

function mixRgb(c1, c2, t) {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * k),
    Math.round(c1[1] + (c2[1] - c1[1]) * k),
    Math.round(c1[2] + (c2[2] - c1[2]) * k),
  ];
}

// `focus`: the number that was rolled. Its face's number is drawn big and the others fade back,
// so it's clear which one it landed on.
export function drawD20(ctx, cx, cy, size, M, skin = 'gold', number = true, focus = 0) {
  const sk = SKINS[skin] || SKINS.gold;
  const r = size * 0.5;
  const P = VERTS.map((v) => apply(M, v));
  const pts2d = P.map((p) => [p[0] * r, p[1] * r]);
  const hull = convexHull(pts2d);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';

  // 1. Uniform silhouette glow halo (rendered cleanly around the solid hull)
  if (sk.glow) {
    ctx.save();
    ctx.shadowColor = focus ? sk.glowLanded : sk.glow;
    ctx.shadowBlur = size * (focus ? 0.35 : 0.22);
    ctx.fillStyle = sk.body;
    ctx.beginPath();
    hull.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 2. Solid backfill so internal polygon seams never leak background color
  ctx.beginPath();
  hull.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = sk.body;
  ctx.fill();

  // 3. Filter front-facing facets
  const shown = [];
  for (const f of FACES) {
    const n = apply(M, f.n);
    if (n[2] <= 0.02) continue; // cull backfaces and edge-on slivers
    shown.push({ f, n });
  }
  // Sort back-to-front
  shown.sort((a, b) => a.n[2] - b.n[2]);

  // 4. Draw facets with directional linear gradients + specular highlights
  for (const { f, n } of shown) {
    const p0 = pts2d[f.tri[0]];
    const p1 = pts2d[f.tri[1]];
    const p2 = pts2d[f.tri[2]];
    const c2d = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3];

    const diffuse = Math.max(0, dot(n, LIGHT));
    const specular = Math.pow(Math.max(0, dot(n, HALF)), 8);
    const forward = Math.max(0, n[2]);
    const kDiff = 0.35 + 0.55 * diffuse + 0.1 * forward;

    // Project face vertices onto 2D screen light direction to find the gradient span
    const d0 = p0[0] * LIGHT_2D[0] + p0[1] * LIGHT_2D[1];
    const d1 = p1[0] * LIGHT_2D[0] + p1[1] * LIGHT_2D[1];
    const d2 = p2[0] * LIGHT_2D[0] + p2[1] * LIGHT_2D[1];
    const dMin = Math.min(d0, d1, d2);
    const dMax = Math.max(d0, d1, d2);
    const span = Math.max(1, dMax - dMin);

    const gx1 = c2d[0] + LIGHT_2D[0] * (span * 0.5);
    const gy1 = c2d[1] + LIGHT_2D[1] * (span * 0.5);
    const gx2 = c2d[0] - LIGHT_2D[0] * (span * 0.5);
    const gy2 = c2d[1] - LIGHT_2D[1] * (span * 0.5);

    const grad = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
    const specBoost = Math.min(1, specular * 1.5);
    const cLit = mixRgb(sk.faceBase, sk.faceLit, Math.min(1, diffuse * 0.8 + specBoost * 0.6));
    const cMid = mixRgb(sk.faceShade, sk.faceBase, kDiff);
    const cShade = mixRgb(sk.faceShade, sk.faceMid, Math.max(0, kDiff * 0.7 - 0.1));

    grad.addColorStop(0, `rgb(${cLit.join(',')})`);
    grad.addColorStop(0.5, `rgb(${cMid.join(',')})`);
    grad.addColorStop(1, `rgb(${cShade.join(',')})`);

    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 5. Chamfered / Beveled ridge highlighting along edges
    const edges = [
      [p0, p1],
      [p1, p2],
      [p2, p0],
    ];
    for (const [ea, eb] of edges) {
      const emx = (ea[0] + eb[0]) * 0.5;
      const emy = (ea[1] + eb[1]) * 0.5;
      const edx = emx - c2d[0];
      const edy = emy - c2d[1];
      const edLen = Math.hypot(edx, edy) || 1;
      const enx = edx / edLen;
      const eny = edy / edLen;
      const edgeLight = enx * LIGHT_2D[0] + eny * LIGHT_2D[1];

      ctx.beginPath();
      ctx.moveTo(ea[0], ea[1]);
      ctx.lineTo(eb[0], eb[1]);

      if (edgeLight > 0.1) {
        ctx.strokeStyle = sk.edgeLit;
        ctx.lineWidth = Math.max(1, size * 0.016);
        ctx.stroke();
      } else if (edgeLight < -0.15) {
        ctx.strokeStyle = sk.edgeShade;
        ctx.lineWidth = Math.max(1, size * 0.018);
        ctx.stroke();
      } else {
        ctx.strokeStyle = sk.outline;
        ctx.lineWidth = Math.max(1, size * 0.012);
        ctx.stroke();
      }
    }
  }

  // 6. Chiseled 3D Engraved Numerals
  if (number) {
    for (const { f, n } of shown) {
      if (n[2] < 0.42) continue;
      const u = apply(M, f.right);
      const v = apply(M, scale(f.up, -1));
      const c = apply(M, f.centre);
      ctx.save();
      const big = focus && f.value === focus;
      ctx.globalAlpha = Math.min(1, (n[2] - 0.42) * 3.5) * (focus && !big ? 0.3 : 1);
      ctx.transform(u[0] * r, u[1] * r, v[0] * r, v[1] * r, c[0] * r, c[1] * r);
      ctx.scale(0.01, 0.01);
      const fontSize = Math.round((f.value >= 10 ? 27 : 33) * (big ? 1.75 : 1));
      ctx.font = `800 ${fontSize}px Fraunces, Georgia, "Times New Roman", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const txt = String(f.value);

      if (big) {
        ctx.lineWidth = 6;
        ctx.strokeStyle = skin === 'used' ? 'rgba(15, 8, 30, 0.8)' : 'rgba(255, 252, 225, 0.95)';
        ctx.strokeText(txt, 0, 5);
      } else {
        ctx.fillStyle = sk.textHighlight;
        ctx.fillText(txt, -0.7, 4.3);
        ctx.fillStyle = sk.textShadow;
        ctx.fillText(txt, 0.7, 5.7);
      }
      ctx.fillStyle = sk.text;
      ctx.fillText(txt, 0, 5);

      if (f.value === 6 || f.value === 9) {
        const bw = big ? 32 : 18;
        const bh = big ? 5 : 3;
        const by = big ? 33 : 20;
        if (!big) {
          ctx.fillStyle = sk.textHighlight;
          ctx.fillRect(-bw / 2 - 0.7, by - 0.7, bw, bh);
        }
        ctx.fillStyle = sk.text;
        ctx.fillRect(-bw / 2, by, bw, bh);
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

// ---------- the animated die on a canvas ----------
// state: 'ready' (gold, wobbling, 20 up), 'rolling' (tumbling until told the result), 'landed', 'used'
export class D20 {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'ready';
    this.value = 20;
    this.roll = null;
    this.raf = 0;
    this.particles = [];
    this.lastTwinkle = 0;
    this.frame = this.frame.bind(this);
  }

  set(state, value = this.value) {
    this.state = state;
    this.value = value;
    if (state !== 'rolling') this.roll = null;
    this.start();
  }

  // Tapped: it crouches, ready to jump, until land() brings the number from the server.
  throw() {
    this.roll = { start: null, pressed: performance.now() };
    this.state = 'rolling';
    this.particles = [];
    this.start();
  }

  // The number is known: tumble end over end for ROLL_MS (always the same) and land on it.
  land(value, onDone) {
    const ax = (3 + Math.random()) * (Math.random() < 0.5 ? -1 : 1);
    const ay = (2 + Math.random()) * (Math.random() < 0.5 ? -1 : 1);
    this.roll = { start: performance.now(), axes: [ax, ay], result: value, onDone };
    this.state = 'rolling';
    this.start();
  }

  start() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  frame(now) {
    this.raf = 0;
    const c = this.canvas;
    if (!c.isConnected || c.offsetParent === null) return; // off screen: start() wakes it again
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const size = w * 0.86;
    const cy = h - w / 2;
    let M;
    let hop = 0;
    const skin = this.state === 'used' ? 'used' : 'gold';
    const sk = SKINS[skin] || SKINS.gold;
    let keepGoing = false;

    if (this.state === 'rolling' && this.roll) {
      const r = this.roll;
      if (r.start == null) {
        // waiting for the number: a little crouch
        M = mul(REST_TILT, faceFront(this.value));
        hop = -Math.min(1, (now - r.pressed) / 120) * size * 0.04;
      } else {
        // the spin runs down to nothing, leaving the result facing you
        const k = Math.min(1, (now - r.start) / ROLL_MS);
        const left = (1 - k) ** 3;
        const [ax, ay] = r.axes;
        M = mul(REST_TILT, mul(mul(rotX(ax * TAU * left), rotY(ay * TAU * left)), faceFront(r.result)));
        // thrown up, two bounces, then it rolls on the spot while the spin dies down
        hop =
          (k < 0.25 ? Math.sin((k / 0.25) * Math.PI) : k < 0.4 ? Math.sin(((k - 0.25) / 0.15) * Math.PI) * 0.3 : k < 0.5 ? Math.sin(((k - 0.4) / 0.1) * Math.PI) * 0.1 : 0) *
          size *
          0.4;

        // Sparkle trail during tumbling
        if (Math.random() < 0.85) {
          const pAngle = Math.random() * TAU;
          const pDist = size * (0.2 + Math.random() * 0.28);
          this.particles.push({
            x: w / 2 + Math.cos(pAngle) * pDist,
            y: cy - hop + Math.sin(pAngle) * pDist * 0.65,
            vx: (Math.random() - 0.5) * 1.2,
            vy: (Math.random() - 0.5) * 1.2 - 0.5,
            size: size * (0.07 + Math.random() * 0.08),
            color: sk.sparks[Math.floor(Math.random() * sk.sparks.length)],
            life: 1,
            decay: 0.035 + Math.random() * 0.03,
          });
        }

        if (k >= 1) {
          this.state = 'landed';
          this.value = r.result;
          this.roll = null;
          // Celebratory starburst!
          for (let i = 0; i < 16; i++) {
            const a = (i * TAU) / 16 + (Math.random() - 0.5) * 0.25;
            const spd = (size * 0.02) * (1.5 + Math.random() * 2.5);
            this.particles.push({
              x: w / 2,
              y: cy,
              vx: Math.cos(a) * spd,
              vy: Math.sin(a) * spd * 0.7 - 0.8,
              size: size * (0.09 + Math.random() * 0.08),
              color: sk.sparks[i % sk.sparks.length],
              life: 1,
              decay: 0.022 + Math.random() * 0.02,
            });
          }
          r.onDone?.();
        }
      }
      keepGoing = true;
    } else {
      // at rest: the value towards you, gently rocking when it's waiting to be rolled
      const wobble = this.state === 'ready' ? Math.sin(now / 900) * 0.18 : 0;
      M = mul(REST_TILT, mul(rotY(wobble), faceFront(this.value)));
      keepGoing = this.state === 'ready';
      if (this.state === 'ready') {
        hop = (0.5 + 0.5 * Math.sin(now / 450)) * size * 0.03;
        // Subtle periodic twinkle glint on front vertex
        if (now - this.lastTwinkle > 1400) {
          this.lastTwinkle = now;
          const frontVerts = VERTS.map(v => apply(M, v)).filter(p => p[2] > 0.35);
          if (frontVerts.length > 0) {
            const fv = frontVerts[Math.floor(Math.random() * frontVerts.length)];
            this.particles.push({
              x: w / 2 + fv[0] * (size * 0.5),
              y: cy - hop + fv[1] * (size * 0.5),
              vx: 0,
              vy: -0.15,
              size: size * 0.16,
              color: sk.sparks[0],
              life: 1,
              decay: 0.045,
            });
          }
        }
      }
    }

    // Ground contact shadow: multi-stop radial gradient with ambient occlusion
    const groundY = cy + size * 0.46;
    const hopNorm = Math.max(0, hop / (size * 0.4));
    const sRadX = size * (0.33 + 0.08 * hopNorm);
    const sRadY = size * (0.075 + 0.03 * hopNorm);
    const shadowAlpha = Math.max(0.04, (1 - hopNorm * 0.6) * 0.42);

    ctx.save();
    ctx.translate(w / 2, groundY);
    ctx.scale(1, sRadY / sRadX);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, sRadX);
    sg.addColorStop(0, `rgba(18, 10, 4, ${shadowAlpha})`);
    sg.addColorStop(0.35, `rgba(18, 10, 4, ${shadowAlpha * 0.65})`);
    sg.addColorStop(0.7, `rgba(20, 12, 6, ${shadowAlpha * 0.2})`);
    sg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(0, 0, sRadX, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Once it has landed (and while it settles), the rolled number stands out
    const focus = this.state === 'landed' || this.state === 'used' ? this.value : this.roll?.start != null && performance.now() - this.roll.start > ROLL_MS * 0.75 ? this.roll.result : 0;
    drawD20(ctx, w / 2, cy - hop, size, M, skin, true, focus);

    // Particle system update and draw
    if (this.particles.length > 0) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) {
          this.particles.splice(i, 1);
        } else {
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.life);
          sparkle(ctx, p.x, p.y, p.size * p.life, p.color);
          ctx.restore();
        }
      }
      keepGoing = true;
    }

    if (keepGoing) this.start();
  }
}

// ---------- vector and matrix helpers (row-major 3x3) ----------
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function rotX(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
function rotY(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
function mul(a, b) {
  const m = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
  return m;
}
function apply(m, [x, y, z]) {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}
function add(a, b) {
  return a.map((x, i) => x + b[i]);
}
function sub(a, b) {
  return a.map((x, i) => x - b[i]);
}
function scale(a, k) {
  return a.map((x) => x * k);
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a) {
  return scale(a, 1 / Math.hypot(...a));
}

export const D20_FACES = FACES; // for tests

// The daily chest's d20, as a real 3D icosahedron: 20 numbered triangles, lit from the top left.
// It wobbles while it waits, tumbles end over end when rolled, and lands with the rolled number
// facing you (slightly tilted, so it still looks solid).

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

// ---------- drawing ----------
const LIGHT = norm([-0.45, -0.7, 0.75]);
const SKINS = {
  gold: { face: [255, 205, 70], edge: '#9c6f08', text: '#3d2700', glow: 'rgba(255, 200, 64, 0.45)' },
  used: { face: [112, 104, 156], edge: '#3b3560', text: '#f1edff', glow: null },
};

// `focus`: the number that was rolled. Its face's number is drawn big and the others fade back,
// so it's clear which one it landed on.
export function drawD20(ctx, cx, cy, size, M, skin = 'gold', number = true, focus = 0) {
  const sk = SKINS[skin];
  const r = size * 0.5;
  const P = VERTS.map((v) => apply(M, v));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  if (sk.glow) {
    ctx.shadowColor = sk.glow;
    ctx.shadowBlur = size * 0.25;
  }
  // Back faces are culled (it's convex), so drawing order doesn't matter
  const shown = [];
  for (const f of FACES) {
    const n = apply(M, f.n);
    if (n[2] <= 0) continue;
    shown.push({ f, n });
  }
  for (const { f, n } of shown) {
    const light = Math.max(0, dot(n, LIGHT));
    const k = 0.5 + 0.55 * light + 0.08 * n[2];
    const [cr, cg, cb] = sk.face.map((c) => Math.min(255, Math.round(c * k)));
    ctx.beginPath();
    f.tri.forEach((i, j) => (j ? ctx.lineTo : ctx.moveTo).call(ctx, P[i][0] * r, P[i][1] * r));
    ctx.closePath();
    ctx.fillStyle = `rgb(${cr}, ${cg}, ${cb})`;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, size * 0.022);
    ctx.strokeStyle = sk.edge;
    ctx.stroke();
  }
  // Numbers on the faces that look at you (squashed ones are skipped)
  if (number) {
    for (const { f, n } of shown) {
      if (n[2] < 0.45) continue;
      const u = apply(M, f.right);
      const v = apply(M, scale(f.up, -1));
      const c = apply(M, f.centre);
      ctx.save();
      const big = focus && f.value === focus;
      ctx.globalAlpha = Math.min(1, (n[2] - 0.45) * 3) * (focus && !big ? 0.3 : 1);
      ctx.transform(u[0] * r, u[1] * r, v[0] * r, v[1] * r, c[0] * r, c[1] * r);
      ctx.fillStyle = sk.text;
      // Draw at 100× and scale down: browsers space letters badly at fractions of a pixel,
      // which ran the two digits of 10–20 into each other.
      ctx.scale(0.01, 0.01);
      ctx.font = `800 ${Math.round((f.value >= 10 ? 27 : 32) * (big ? 1.8 : 1))}px Fraunces, Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (big) {
        // a light outline so the rolled number reads at a glance
        ctx.lineWidth = 5;
        ctx.strokeStyle = skin === 'used' ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 244, 200, 0.9)';
        ctx.strokeText(String(f.value), 0, 5);
      }
      ctx.fillText(String(f.value), 0, 5);
      if (f.value === 6 || f.value === 9) ctx.fillRect(big ? -16 : -9, big ? 33 : 20, big ? 32 : 18, big ? 5 : 3); // 6 or 9?
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
    // the canvas is taller than wide: the die rests in the square at the bottom and the space
    // above is room to be thrown up into (so it isn't cut off)
    const size = w * 0.86;
    const cy = h - w / 2;
    let M;
    let hop = 0;
    let skin = this.state === 'used' ? 'used' : 'gold';
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
        if (k >= 1) {
          this.state = 'landed';
          this.value = r.result;
          this.roll = null;
          r.onDone?.();
        }
      }
      keepGoing = true;
    } else {
      // at rest: the value towards you, gently rocking when it's waiting to be rolled
      const wobble = this.state === 'ready' ? Math.sin(now / 900) * 0.18 : 0;
      M = mul(REST_TILT, mul(rotY(wobble), faceFront(this.value)));
      keepGoing = this.state === 'ready';
      if (this.state === 'ready') hop = (0.5 + 0.5 * Math.sin(now / 450)) * size * 0.03;
    }
    // shadow
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(w / 2, cy + size * 0.47, size * 0.32 * (1 - hop / size), size * 0.06, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    // Once it has landed (and while it settles), the rolled number stands out
    const focus = this.state === 'landed' || this.state === 'used' ? this.value : this.roll?.start != null && performance.now() - this.roll.start > ROLL_MS * 0.75 ? this.roll.result : 0;
    drawD20(ctx, w / 2, cy - hop, size, M, skin, true, focus);
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

// Draws the Ludo board and tokens on a <canvas>.
import {
  COLORS,
  COLOR_HEX,
  TRACK,
  HOME_COLUMNS,
  BASE_ORIGIN,
  START_INDEX,
  SAFE_INDICES,
  FINISHED,
  tokenCenter,
  cellKey,
} from '../shared/board.js';

const N = 15;
const LIGHT = { red: '#fbd5d6', green: '#c9ecd9', yellow: '#fdecb3', blue: '#d3dcf8' };
const DARK = { red: '#a3242a', green: '#1d6b45', yellow: '#a57600', blue: '#233f9c' };

export class BoardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 0;
    this.cell = 0;
    this.boardLayer = document.createElement('canvas');
  }

  resize(cssSize) {
    const dpr = window.devicePixelRatio || 1;
    const size = Math.floor(cssSize);
    if (size === this.size && dpr === this.dpr) return;
    this.size = size;
    this.dpr = dpr;
    this.cell = size / N;
    for (const c of [this.canvas, this.boardLayer]) {
      c.width = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
    }
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.drawBoard();
  }

  // The static board is drawn once to an offscreen canvas and copied every frame.
  drawBoard() {
    const ctx = this.boardLayer.getContext('2d');
    const s = this.cell;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.fillStyle = '#fbf7ee';
    roundRect(ctx, 0, 0, this.size, this.size, 14);
    ctx.fill();

    // Track squares
    TRACK.forEach(([r, c], i) => {
      let fill = '#ffffff';
      const startSeat = START_INDEX.indexOf(i);
      if (startSeat >= 0) fill = COLOR_HEX[COLORS[startSeat]];
      drawCell(ctx, r, c, s, fill);
      if (SAFE_INDICES.has(i) && startSeat < 0) drawStar(ctx, (c + 0.5) * s, (r + 0.5) * s, s * 0.32, '#c3bfb4');
      if (startSeat >= 0) drawStar(ctx, (c + 0.5) * s, (r + 0.5) * s, s * 0.32, 'rgba(255,255,255,0.75)');
    });

    // Home columns
    HOME_COLUMNS.forEach((cells, seat) => {
      cells.forEach(([r, c]) => drawCell(ctx, r, c, s, COLOR_HEX[COLORS[seat]]));
    });

    // Bases
    BASE_ORIGIN.forEach(([r0, c0], seat) => {
      const color = COLORS[seat];
      ctx.fillStyle = COLOR_HEX[color];
      roundRect(ctx, c0 * s + 1, r0 * s + 1, 6 * s - 2, 6 * s - 2, s * 0.5);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, (c0 + 0.8) * s, (r0 + 0.8) * s, 4.4 * s, 4.4 * s, s * 0.6);
      ctx.fill();
      for (let t = 0; t < 4; t++) {
        const [y, x] = tokenCenter(seat, -1, t);
        ctx.beginPath();
        ctx.arc(x * s, y * s, s * 0.52, 0, Math.PI * 2);
        ctx.fillStyle = LIGHT[color];
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = COLOR_HEX[color];
        ctx.stroke();
      }
    });

    // Centre triangles: left=red, top=green, right=yellow, bottom=blue
    const cx = 7.5 * s;
    const cy = 7.5 * s;
    const a = 6 * s;
    const b = 9 * s;
    const tris = [
      [[a, a], [a, b], [cx, cy]],
      [[a, a], [b, a], [cx, cy]],
      [[b, a], [b, b], [cx, cy]],
      [[a, b], [b, b], [cx, cy]],
    ];
    tris.forEach((pts, seat) => {
      ctx.beginPath();
      ctx.moveTo(...pts[0]);
      ctx.lineTo(...pts[1]);
      ctx.lineTo(...pts[2]);
      ctx.closePath();
      ctx.fillStyle = COLOR_HEX[COLORS[seat]];
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  /**
   * @param {object} view
   *  tokens: number[4][4] progress to draw
   *  active: Set of seats in the game
   *  override: { seat, token, progress } token currently animating
   *  highlight: { seat, tokens: number[] } tokens the local player can move
   *  turn: seat whose turn it is (or null)
   */
  draw(view, now) {
    const ctx = this.ctx;
    const s = this.cell;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.boardLayer, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Glow the base of whoever's turn it is
    if (view.turn !== null && view.turn !== undefined) {
      const [r0, c0] = BASE_ORIGIN[view.turn];
      const pulse = 0.5 + 0.5 * Math.sin(now / 300);
      ctx.strokeStyle = `rgba(255,255,255,${0.4 + 0.5 * pulse})`;
      ctx.lineWidth = 3 + 2 * pulse;
      roundRect(ctx, c0 * s + 4, r0 * s + 4, 6 * s - 8, 6 * s - 8, s * 0.45);
      ctx.stroke();
    }

    const placed = this.layout(view);
    this.lastLayout = placed;

    // Draw non-highlighted first, then highlighted on top, then the moving one.
    const order = [...placed].sort((p, q) => (p.hl - q.hl) || (p.moving - q.moving));
    for (const p of order) this.drawToken(p, now);

    // Finished counters
    for (const seat of view.active) {
      const done = view.tokens[seat].filter((p) => p >= FINISHED).length;
      if (done > 1) {
        const [y, x] = tokenCenter(seat, FINISHED, 0);
        ctx.fillStyle = '#111';
        ctx.font = `700 ${s * 0.38}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`×${done}`, x * s + s * 0.38, y * s - s * 0.38);
      }
    }
  }

  layout(view) {
    const groups = new Map();
    const items = [];
    for (const seat of view.active) {
      for (let t = 0; t < 4; t++) {
        const moving = view.override && view.override.seat === seat && view.override.token === t;
        const progress = moving ? view.override.progress : view.tokens[seat][t];
        const [y, x] = moving && view.override.point ? view.override.point : tokenCenter(seat, progress, t);
        const key = moving ? `moving` : cellKey(seat, progress, t);
        const hl = view.highlight && view.highlight.seat === seat && view.highlight.tokens.includes(t) ? 1 : 0;
        const item = { seat, token: t, x, y, key, hl, moving: moving ? 1 : 0, scale: 1, progress };
        items.push(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }
    }
    // Spread out tokens that share a square
    for (const [key, group] of groups) {
      if (group.length < 2 || key === 'moving') continue;
      const n = group.length;
      const radius = key.startsWith('finish') ? 0 : 0.2;
      group.forEach((it, i) => {
        const ang = (i / n) * Math.PI * 2 - Math.PI / 4;
        it.x += Math.cos(ang) * radius;
        it.y += Math.sin(ang) * radius;
        it.scale = key.startsWith('finish') ? 0.8 : n > 2 ? 0.66 : 0.78;
      });
    }
    return items;
  }

  drawToken(p, now) {
    const ctx = this.ctx;
    const s = this.cell;
    const color = COLORS[p.seat];
    const x = p.x * s;
    const y = p.y * s;
    const lift = p.moving ? s * 0.08 : 0;
    const r = s * 0.36 * p.scale * (p.moving ? 1.12 : 1);

    if (p.hl) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      ctx.beginPath();
      ctx.arc(x, y, r + s * (0.1 + 0.08 * pulse), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.35 * pulse})`;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#111';
      ctx.stroke();
    }

    // shadow
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.55, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fill();

    // body
    const grad = ctx.createRadialGradient(x - r * 0.35, y - lift - r * 0.4, r * 0.1, x, y - lift, r);
    grad.addColorStop(0, lighten(COLOR_HEX[color]));
    grad.addColorStop(1, COLOR_HEX[color]);
    ctx.beginPath();
    ctx.arc(x, y - lift, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.strokeStyle = DARK[color];
    ctx.stroke();

    // inner ring
    ctx.beginPath();
    ctx.arc(x, y - lift, r * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.stroke();
  }

  // Returns the token index (of `seat`) at a click position, preferring highlighted ones.
  hitTest(clientX, clientY, seat, allowed) {
    if (!this.lastLayout) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / this.cell;
    const y = (clientY - rect.top) / this.cell;
    let best = null;
    let bestDist = 0.75;
    for (const p of this.lastLayout) {
      if (p.seat !== seat || !allowed.includes(p.token)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = p.token;
      }
    }
    return best;
  }
}

function drawCell(ctx, r, c, s, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(c * s, r * s, s, s);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(c * s + 0.5, r * s + 0.5, s - 1, s - 1);
}

function drawStar(ctx, cx, cy, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function lighten(hex) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (v) => Math.round(v + (255 - v) * 0.45);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

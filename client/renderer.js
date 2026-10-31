// Draws the board, tokens, dice and effects on a <canvas>.
// Board positions come in board units (one square = 1, centre = 0,0); see shared/board.js.
import { COLOR_HEX } from '../shared/board.js';
import { BOARD_THEMES, DICE_STYLES } from './skins.js';

export const SPIN_MS = 750;
export const LEAVE_MS = 260;
export const EMOTE_MS = 2400;
const TAU = Math.PI * 2;

export class BoardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 0;
    this.dpr = 1;
    this.board = null;
    this.theme = null;
    this.layer = document.createElement('canvas');
    this.particles = [];
    this.lastNow = 0;
  }

  setBoard(board, themeId) {
    const theme = BOARD_THEMES[themeId] || BOARD_THEMES['board-classic'];
    if (board === this.board && theme === this.theme) return;
    this.board = board;
    this.theme = theme;
    this.size = 0; // redraw the static layer on the next resize()
  }

  resize(cssSize) {
    const dpr = window.devicePixelRatio || 1;
    const size = Math.floor(cssSize);
    if (size === this.size && dpr === this.dpr) return;
    this.size = size;
    this.dpr = dpr;
    this.span = this.board.extent * 2 + 0.3;
    this.cell = size / this.span;
    for (const c of [this.canvas, this.layer]) {
      c.width = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
    }
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.drawBoard();
  }

  // Board units → CSS pixels on the canvas.
  px(u) {
    return (u + this.span / 2) * this.cell;
  }

  toBoard(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) / this.cell - this.span / 2, y: (clientY - rect.top) / this.cell - this.span / 2 };
  }

  toClient(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + this.px(x), y: rect.top + this.px(y) };
  }

  get diceSize() {
    return Math.min(this.board.hub * 0.95, 1.9);
  }

  // The static board is drawn once to an offscreen canvas and copied every frame.
  drawBoard() {
    const { board, theme } = this;
    const ctx = this.layer.getContext('2d');
    const k = this.dpr * this.cell;
    const mid = (this.dpr * this.size) / 2;
    const lw = 1 / this.cell; // one CSS pixel in board units
    const half = this.span / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.layer.width, this.layer.height);
    ctx.setTransform(k, 0, 0, k, mid, mid);

    ctx.fillStyle = theme.bg;
    roundRect(ctx, -half, -half, this.span, this.span, 14 * lw);
    ctx.fill();

    // Bases
    board.bases.forEach((b, seat) => {
      const hex = COLOR_HEX[board.colors[seat]];
      ctx.fillStyle = hex;
      if (b.square) {
        roundRect(ctx, b.x - b.size + lw, b.y - b.size + lw, b.size * 2 - 2 * lw, b.size * 2 - 2 * lw, 0.5);
        ctx.fill();
        const inner = b.size * 0.73;
        ctx.fillStyle = theme.baseInner;
        roundRect(ctx, b.x - inner, b.y - inner, inner * 2, inner * 2, 0.6);
        ctx.fill();
      } else {
        circle(ctx, b.x, b.y, b.size);
        ctx.fill();
        ctx.fillStyle = theme.baseInner;
        circle(ctx, b.x, b.y, b.size * 0.8);
        ctx.fill();
      }
      for (let t = 0; t < 4; t++) {
        const p = board.tokenCenter(seat, -1, t);
        circle(ctx, p.x, p.y, b.square ? 0.52 : 0.4);
        ctx.fillStyle = mix(hex, theme.baseInner, 0.72);
        ctx.fill();
        ctx.lineWidth = 2 * lw;
        ctx.strokeStyle = hex;
        ctx.stroke();
      }
    });

    // Track squares
    board.track.forEach((sq, i) => {
      const startSeat = board.startIndex.indexOf(i);
      drawSquare(ctx, sq, startSeat >= 0 ? COLOR_HEX[board.colors[startSeat]] : theme.cell, theme.line, lw);
      if (board.safe.has(i)) drawStar(ctx, sq.x, sq.y, 0.32, startSeat >= 0 ? 'rgba(255,255,255,0.75)' : theme.star);
    });

    // Home columns
    board.homeColumns.forEach((col, seat) => {
      for (const sq of col) drawSquare(ctx, sq, COLOR_HEX[board.colors[seat]], theme.line, lw);
    });

    // Centre: one triangle per seat, pointing at its home column
    const n = board.arms;
    const R = board.hub / Math.cos(Math.PI / n);
    for (let s = 0; s < n; s++) {
      const a = board.armAngle(s);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a - Math.PI / n) * R, Math.sin(a - Math.PI / n) * R);
      ctx.lineTo(Math.cos(a + Math.PI / n) * R, Math.sin(a + Math.PI / n) * R);
      ctx.closePath();
      ctx.fillStyle = COLOR_HEX[board.colors[s]];
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  }

  /**
   * @param {object} view
   *  tokens: progress[seat][4] to draw
   *  active: seats in the game
   *  skins: token skin id per seat
   *  overrides: Map "seat-token" -> { x, y, lift, squash } for tokens being animated
   *  highlight: { seat, tokens } tokens the local player can move
   *  turn: seat whose turn it is (or null)
   *  dice: { mode, t, value, style, color, mine } for the dice in the centre (or null)
   *  emotes: [{ seat, emoji, start }]
   */
  draw(view, now) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.layer, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (view.turn !== null && view.turn !== undefined) this.drawTurnGlow(view.turn, now);

    const placed = this.layout(view, now);
    this.lastLayout = placed;
    // Resting tokens first, then highlighted ones, then the ones in motion.
    const order = [...placed].sort((p, q) => p.hl - q.hl || p.moving - q.moving);
    for (const p of order) this.drawPlaced(p, now);

    this.drawFinishedCounts(view);
    this.drawCenterDice(view.dice, now);
    this.drawParticles(now);
    this.drawEmotes(view.emotes, now);
  }

  layout(view, now) {
    const { board } = this;
    const groups = new Map();
    const items = [];
    for (const seat of view.active) {
      for (let t = 0; t < 4; t++) {
        const o = view.overrides?.get(`${seat}-${t}`);
        const progress = view.tokens[seat][t];
        const pos = o || board.tokenCenter(seat, progress, t);
        const hl = view.highlight && view.highlight.seat === seat && view.highlight.tokens.includes(t) ? 1 : 0;
        const item = {
          seat,
          token: t,
          x: pos.x,
          y: pos.y,
          lift: o ? o.lift : hl ? 0.08 + 0.08 * Math.sin(now / 200 + t) : 0,
          squash: o?.squash || 1,
          hl,
          moving: o ? 1 : 0,
          scale: 1,
          skin: view.skins[seat],
        };
        items.push(item);
        if (o) continue;
        const key = board.cellKey(seat, progress, t);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }
    }
    // Spread out tokens that share a square
    for (const [key, group] of groups) {
      if (group.length < 2) continue;
      const n = group.length;
      const finish = key.startsWith('finish');
      group.forEach((it, i) => {
        const ang = (i / n) * TAU - Math.PI / 4;
        it.x += finish ? 0 : Math.cos(ang) * 0.2;
        it.y += finish ? 0 : Math.sin(ang) * 0.2;
        it.scale = finish ? 0.8 : n > 2 ? 0.66 : 0.78;
      });
    }
    return items;
  }

  drawPlaced(p, now) {
    const ctx = this.ctx;
    const s = this.cell;
    const x = this.px(p.x);
    const y = this.px(p.y);
    const r = s * 0.36 * p.scale * (p.moving ? 1.1 : 1);
    if (p.hl) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      circle(ctx, x, y, r + s * (0.1 + 0.08 * pulse));
      ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.35 * pulse})`;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#111';
      ctx.stroke();
    }
    drawToken(ctx, x, y, r, COLOR_HEX[this.board.colors[p.seat]], p.skin, { lift: p.lift * s, squash: p.squash });
  }

  drawTurnGlow(seat, now) {
    const ctx = this.ctx;
    const s = this.cell;
    const b = this.board.bases[seat];
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    ctx.strokeStyle = `rgba(255,255,255,${0.4 + 0.5 * pulse})`;
    ctx.lineWidth = 3 + 2 * pulse;
    if (b.square) roundRect(ctx, this.px(b.x - b.size) + 4, this.px(b.y - b.size) + 4, b.size * 2 * s - 8, b.size * 2 * s - 8, s * 0.45);
    else circle(ctx, this.px(b.x), this.px(b.y), b.size * s - 3);
    ctx.stroke();
  }

  drawFinishedCounts(view) {
    const ctx = this.ctx;
    const s = this.cell;
    for (const seat of view.active) {
      const done = view.tokens[seat].filter((p) => p >= this.board.finished).length;
      if (done < 2) continue;
      const p = this.board.finishSpots[seat];
      ctx.fillStyle = '#111';
      ctx.font = `700 ${s * 0.38}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`×${done}`, this.px(p.x) + s * 0.38, this.px(p.y) - s * 0.38);
    }
  }

  // The dice lives in the middle of the board: it pops in for whoever's turn it is,
  // spins when rolled, shows the result, then shrinks away once it has been used.
  drawCenterDice(d, now) {
    if (!d) return;
    const ctx = this.ctx;
    const size = this.diceSize * this.cell;
    const cx = this.px(0);
    const cy = this.px(0);
    let scale = 1;
    let angle = 0;
    let alpha = 1;
    let hop = 0;
    let value = d.value;
    if (d.mode === 'ready') {
      scale = easeOutBack(Math.min(1, d.t / 320));
      hop = (0.5 + 0.5 * Math.sin(now / 260)) * size * 0.08;
      value = null;
    } else if (d.mode === 'spin') {
      const k = Math.min(1, d.t / SPIN_MS);
      angle = (1 - easeOutCubic(k)) * 3 * TAU;
      hop = Math.sin(Math.PI * k) * size * 0.55;
      scale = 1 + 0.2 * Math.sin(Math.PI * k);
      if (k < 0.8) value = 1 + ((Math.floor(now / 65) * 2654435761) >>> 0) % 6;
    } else if (d.mode === 'shown') {
      scale = 1 + 0.1 * Math.sin(Math.min(1, d.t / 220) * Math.PI);
    } else if (d.mode === 'leave') {
      const k = Math.min(1, d.t / LEAVE_MS);
      scale = 1 - 0.7 * k * k;
      alpha = 1 - k;
      angle = k * 0.6;
    }

    // Shadow stays on the board while the dice hops
    ctx.save();
    ctx.globalAlpha = alpha * 0.3;
    ctx.beginPath();
    const shrink = 1 - Math.min(0.5, hop / (size * 1.5));
    ctx.ellipse(cx, cy + size * 0.55, size * 0.5 * scale * shrink, size * 0.15 * scale * shrink, 0, 0, TAU);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();

    if (d.mode === 'ready') {
      const pulse = 0.5 + 0.5 * Math.sin(now / 220);
      ctx.save();
      ctx.globalAlpha = (0.35 + 0.5 * pulse) * scale;
      circle(ctx, cx, cy - hop, size * (0.82 + 0.12 * pulse));
      ctx.lineWidth = 3;
      ctx.strokeStyle = d.color;
      ctx.stroke();
      ctx.restore();
    }

    drawDice(ctx, cx, cy - hop, size * scale, value, d.style, {
      angle,
      alpha,
      glow: d.mode === 'ready' ? d.color : null,
    });

    if (d.mode === 'ready' && d.mine) {
      ctx.font = `800 ${Math.max(11, size * 0.2)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText('TAP TO ROLL', cx, cy + size * 0.88);
      ctx.fillStyle = '#fff';
      ctx.fillText('TAP TO ROLL', cx, cy + size * 0.88);
    }
  }

  drawEmotes(list, now) {
    if (!list) return;
    const ctx = this.ctx;
    const s = this.cell;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const e of list) {
      const age = now - e.start;
      if (age < 0 || age > EMOTE_MS) continue;
      const k = age / EMOTE_MS;
      const b = this.board.bases[e.seat];
      const scale = easeOutBack(Math.min(1, age / 220));
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `${s * 1.6 * scale}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.fillText(e.emoji, this.px(b.x), this.px(b.y) - k * s * 1.4);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- effects ----------

  ring(x, y, color, size = 0.7) {
    this.particles.push({ kind: 'ring', x, y, color, size, born: performance.now(), life: 420 });
  }

  burst(x, y, colors, { count = 16, speed = 4, life = 700, size = 0.13 } = {}) {
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({
        kind: 'dot',
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        gravity: 3,
        color: colors[i % colors.length],
        size: size * (0.6 + Math.random() * 0.8),
        born: now,
        life: life * (0.7 + Math.random() * 0.5),
      });
    }
  }

  confetti(colors) {
    const now = performance.now();
    const half = this.span / 2;
    for (let i = 0; i < 110; i++) {
      this.particles.push({
        kind: 'confetti',
        x: (Math.random() * 2 - 1) * half,
        y: -half - Math.random() * half * 0.8,
        vx: (Math.random() - 0.5) * 2,
        vy: 2 + Math.random() * 3,
        gravity: 4,
        color: colors[i % colors.length],
        size: 0.18 + Math.random() * 0.16,
        rot: Math.random() * TAU,
        vr: (Math.random() - 0.5) * 10,
        born: now,
        life: 3200 + Math.random() * 1400,
      });
    }
  }

  drawParticles(now) {
    const dt = Math.min(50, Math.max(0, now - (this.lastNow || now))) / 1000;
    this.lastNow = now;
    const ctx = this.ctx;
    const s = this.cell;
    this.particles = this.particles.filter((p) => now - p.born < p.life);
    for (const p of this.particles) {
      const k = Math.max(0, (now - p.born) / p.life);
      if (p.kind === 'ring') {
        circle(ctx, this.px(p.x), this.px(p.y), (0.3 + k * p.size) * s);
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.strokeStyle = p.color;
        ctx.stroke();
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.fillStyle = p.color;
      if (p.kind === 'confetti') {
        p.rot += p.vr * dt;
        ctx.globalAlpha = Math.min(1, (1 - k) * 3);
        ctx.save();
        ctx.translate(this.px(p.x), this.px(p.y));
        ctx.rotate(p.rot);
        ctx.fillRect((-p.size * s) / 2, (-p.size * s) / 4, p.size * s, (p.size * s) / 2);
        ctx.restore();
      } else {
        ctx.globalAlpha = 1 - k;
        circle(ctx, this.px(p.x), this.px(p.y), p.size * s * (1 - k * 0.5));
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- hit tests ----------

  // Returns the token index (of `seat`) at a click position, preferring highlighted ones.
  hitToken(clientX, clientY, seat, allowed) {
    if (!this.lastLayout) return null;
    const { x, y } = this.toBoard(clientX, clientY);
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

  hitDice(clientX, clientY) {
    const { x, y } = this.toBoard(clientX, clientY);
    return Math.hypot(x, y) < this.diceSize * 0.75;
  }
}

// ---------- tokens ----------

// Draws one token standing at (x, y). `lift` raises it (px), `squash` < 1 flattens it.
export function drawToken(ctx, x, y, r, hex, skin, { lift = 0, squash = 1 } = {}) {
  const shrink = 1 - Math.min(0.45, lift / (r * 4));
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.55, r * 0.9 * shrink, r * 0.45 * shrink, 0, 0, TAU);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fill();

  ctx.save();
  ctx.translate(x, y - lift + r);
  ctx.scale(1 / squash, squash);
  ctx.translate(0, -r);
  (TOKEN_PAINTERS[skin] || TOKEN_PAINTERS['token-classic'])(ctx, r, hex);
  ctx.restore();
}

const TOKEN_PAINTERS = {
  'token-classic'(ctx, r, hex) {
    disc(ctx, r, bodyGradient(ctx, r, hex), mix(hex, '#000000', 0.35), Math.max(1.5, r * 0.14));
    circle(ctx, 0, 0, r * 0.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.stroke();
  },
  'token-star'(ctx, r, hex) {
    disc(ctx, r, bodyGradient(ctx, r, hex), mix(hex, '#000000', 0.35), Math.max(1.5, r * 0.14));
    drawStar(ctx, 0, 0, r * 0.62, '#ffffff');
  },
  'token-gem'(ctx, r, hex) {
    const outer = polygon(6, r * 1.05);
    const inner = polygon(6, r * 0.5);
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, mix(hex, '#ffffff', 0.55));
    g.addColorStop(0.5, hex);
    g.addColorStop(1, mix(hex, '#000000', 0.4));
    path(ctx, outer);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    ctx.strokeStyle = mix(hex, '#000000', 0.45);
    ctx.stroke();
    ctx.beginPath();
    outer.forEach(([x, y], i) => {
      ctx.moveTo(x, y);
      ctx.lineTo(...inner[i]);
    });
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.stroke();
    path(ctx, inner);
    ctx.fillStyle = mix(hex, '#ffffff', 0.35);
    ctx.fill();
  },
  'token-neon'(ctx, r, hex) {
    disc(ctx, r, '#14141c');
    ctx.shadowColor = hex;
    ctx.shadowBlur = r * 0.9;
    circle(ctx, 0, 0, r * 0.8);
    ctx.lineWidth = r * 0.24;
    ctx.strokeStyle = hex;
    ctx.stroke();
    circle(ctx, 0, 0, r * 0.26);
    ctx.fillStyle = hex;
    ctx.fill();
    ctx.shadowBlur = 0;
  },
  'token-candy'(ctx, r, hex) {
    ctx.save();
    circle(ctx, 0, 0, r);
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = hex;
    for (let i = -3; i <= 3; i++) ctx.fillRect(i * r * 0.55 - r * 0.14, -r * 1.5, r * 0.28, r * 3);
    ctx.restore();
    const gloss = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r);
    gloss.addColorStop(0, 'rgba(255,255,255,0.7)');
    gloss.addColorStop(0.6, 'rgba(255,255,255,0)');
    disc(ctx, r, gloss, mix(hex, '#000000', 0.35), Math.max(1.5, r * 0.14));
  },
  'token-crown'(ctx, r, hex) {
    disc(ctx, r, bodyGradient(ctx, r, hex), '#9a6f00', Math.max(1.5, r * 0.1));
    circle(ctx, 0, 0, r * 0.86);
    ctx.lineWidth = r * 0.16;
    ctx.strokeStyle = '#f6cf57';
    ctx.stroke();
    path(ctx, [
      [-0.48, 0.28],
      [-0.48, -0.18],
      [-0.24, 0.04],
      [0, -0.36],
      [0.24, 0.04],
      [0.48, -0.18],
      [0.48, 0.28],
    ].map(([x, y]) => [x * r, y * r]));
    ctx.fillStyle = '#f6cf57';
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.strokeStyle = '#9a6f00';
    ctx.stroke();
  },
};

function bodyGradient(ctx, r, hex) {
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, mix(hex, '#ffffff', 0.45));
  g.addColorStop(1, hex);
  return g;
}

function disc(ctx, r, fill, stroke, width) {
  circle(ctx, 0, 0, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = width;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

// ---------- dice ----------

const PIPS = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

// Draws a dice centred on (cx, cy). `value` null shows a "?".
export function drawDice(ctx, cx, cy, size, value, styleId, { angle = 0, alpha = 1, glow = null } = {}) {
  const st = DICE_STYLES[styleId] || DICE_STYLES['dice-classic'];
  const h = size / 2;
  const rad = size * 0.2;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = size * 0.45;
  }
  ctx.fillStyle = st.edge;
  roundRect(ctx, -h, -h + size * 0.07, size, size, rad);
  ctx.fill();
  ctx.shadowBlur = 0;

  let face = st.face;
  if (st.shine) {
    face = ctx.createLinearGradient(-h, -h, h, h);
    face.addColorStop(0, st.shine);
    face.addColorStop(1, st.face);
  }
  ctx.fillStyle = face;
  roundRect(ctx, -h, -h, size, size, rad);
  ctx.fill();
  if (st.outline) {
    ctx.lineWidth = Math.max(1.5, size * 0.04);
    ctx.strokeStyle = st.outline;
    ctx.shadowColor = st.outline;
    ctx.shadowBlur = size * 0.2;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.fillStyle = st.pip;
  if (st.outline) {
    ctx.shadowColor = st.pip;
    ctx.shadowBlur = size * 0.15;
  }
  if (value) {
    for (const [px, py] of PIPS[value]) {
      circle(ctx, px * size * 0.27, py * size * 0.27, size * 0.085);
      ctx.fill();
    }
  } else {
    ctx.font = `800 ${size * 0.5}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, size * 0.03);
  }
  ctx.restore();
}

// ---------- drawing helpers ----------

function drawSquare(ctx, sq, fill, line, lw) {
  ctx.save();
  ctx.translate(sq.x, sq.y);
  ctx.rotate(sq.angle);
  ctx.fillStyle = fill;
  ctx.fillRect(-0.5, -0.5, 1, 1);
  ctx.strokeStyle = line;
  ctx.lineWidth = lw;
  ctx.strokeRect(-0.5 + lw / 2, -0.5 + lw / 2, 1 - lw, 1 - lw);
  ctx.restore();
}

function drawStar(ctx, cx, cy, r, color) {
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

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, TAU);
}

function polygon(n, r) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * TAU - Math.PI / 2;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
}

function path(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
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

// Blends two #rrggbb colours: t = 0 gives `a`, t = 1 gives `b`.
function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function easeOutBack(k) {
  const c = 1.70158;
  return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
}

function easeOutCubic(k) {
  return 1 - (1 - k) ** 3;
}

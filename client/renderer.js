// Draws the board, tokens, dice and effects on a <canvas>.
// Board positions come in board units (one square = 1, centre = 0,0); see shared/board.js.
import { BOARD_THEMES, DICE_STYLES, CB_COLORS, SHAPES, isColorBlind } from './skins.js';

export const SPIN_MS = 600;
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
    const cb = isColorBlind();
    if (board === this.board && theme === this.theme && cb === this.cb) return;
    this.board = board;
    this.theme = theme;
    this.cb = cb; // colour-blind mode: safe colours plus a shape for each player
    this.size = 0; // redraw the static layer on the next resize()
  }

  // A seat's colour on this board (the colour-blind palette when that's on).
  seatColor(seat) {
    const name = this.board.colors[seat];
    return this.cb ? CB_COLORS[name] : this.theme.players[name];
  }

  seatShape(seat) {
    return SHAPES[this.board.colors[seat]];
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

    // Flat tiles with small gaps, so the board colour shows through as clean grout lines.
    const n = board.arms;
    ctx.fillStyle = theme.bg;
    if (n === 4) {
      roundRect(ctx, -half, -half, this.span, this.span, 12 * lw);
    } else {
      // The hexagon board's outline: the outer corners of every arm, a little grout beyond them
      ctx.beginPath();
      const r = board.hub + 6 + 0.12;
      for (let s = 0; s < n; s++) {
        const a = board.armAngle(s);
        for (const v of [-1.62, 1.62]) ctx.lineTo(Math.cos(a) * r - Math.sin(a) * v, Math.sin(a) * r + Math.cos(a) * v);
      }
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 0.3;
      ctx.strokeStyle = theme.bg;
      ctx.stroke();
    }
    ctx.fill();
    const color = (seat) => this.seatColor(seat);
    const cb = this.cb;

    // Bases: a solid block of the player's colour with a plain panel inside
    board.bases.forEach((b, seat) => {
      ctx.fillStyle = color(seat);
      if (b.square) {
        const outer = b.size - 0.1;
        roundRect(ctx, b.x - outer, b.y - outer, outer * 2, outer * 2, 0.5);
        ctx.fill();
        const inner = b.size * 0.7;
        ctx.fillStyle = theme.baseInner;
        roundRect(ctx, b.x - inner, b.y - inner, inner * 2, inner * 2, 0.4);
        ctx.fill();
        drawPinSpots(ctx, b, board.baseSpread, 0.62, color(seat));
      } else {
        // The whole triangle between two arms in the player's colour, a plain circle inside,
        // and a faint spot for each pin to stand on
        const apex = { x: Math.cos(b.angle) * board.corner, y: Math.sin(b.angle) * board.corner };
        const pts = [apex, ...[-1, 1].map((d) => ({
          x: apex.x + Math.cos(b.angle + (d * Math.PI) / n) * 6,
          y: apex.y + Math.sin(b.angle + (d * Math.PI) / n) * 6,
        }))];
        ctx.beginPath();
        for (const p of pts) ctx.lineTo(b.x + (p.x - b.x) * 0.975, b.y + (p.y - b.y) * 0.975);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = theme.baseInner;
        circle(ctx, b.x, b.y, b.size);
        ctx.fill();
        drawPinSpots(ctx, b, board.baseSpread, 0.42, color(seat));
      }
      // Colour-blind mode: the player's shape in the middle of their base
      if (cb) drawShape(ctx, this.seatShape(seat), b.x, b.y, b.square ? 0.6 : 0.42, color(seat), 'rgba(0,0,0,0.35)', 0.08);
    });

    // Track: start squares in the player's colour, safe squares tinted with a star
    board.track.forEach((sq, i) => {
      const startSeat = board.startIndex.indexOf(i);
      const safe = board.safe.has(i);
      drawTile(ctx, sq, startSeat >= 0 ? color(startSeat) : safe ? theme.safe : theme.cell);
      // (in colour-blind mode the start square shows its player's shape instead of the star)
      if (startSeat >= 0 && cb) {
        const ink = inkOn(color(startSeat));
        drawShape(ctx, this.seatShape(startSeat), sq.x, sq.y, 0.27, ink.fill, ink.edge, 0.05);
      }
      else if (startSeat >= 0) drawStar(ctx, sq.x, sq.y, 0.26, 'rgba(255,255,255,0.9)');
      else if (safe) drawStar(ctx, sq.x, sq.y, 0.26, theme.star);
    });

    // Home columns
    board.homeColumns.forEach((col, seat) => {
      for (const sq of col) {
        drawTile(ctx, sq, color(seat));
        if (cb) drawShape(ctx, this.seatShape(seat), sq.x, sq.y, 0.17, inkOn(color(seat)).fill, null);
      }
    });

    // Centre: one triangle per seat pointing at its home column, with thin gaps between
    const R = board.hub / Math.cos(Math.PI / n) - 0.05;
    for (let s = 0; s < n; s++) {
      const a = board.armAngle(s);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a - Math.PI / n) * R, Math.sin(a - Math.PI / n) * R);
      ctx.lineTo(Math.cos(a + Math.PI / n) * R, Math.sin(a + Math.PI / n) * R);
      ctx.closePath();
      ctx.fillStyle = color(s);
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 0.1;
      ctx.strokeStyle = theme.bg;
      ctx.stroke();
      if (cb) {
        const d = n === 4 ? R * 0.62 : R * 0.72; // the wide part of the wedge (clear of the dice well)
        const ink = inkOn(color(s));
        drawShape(ctx, this.seatShape(s), Math.cos(a) * d, Math.sin(a) * d, 0.22, ink.fill, ink.edge, 0.05);
      }
    }
    // The hexagon board has a dark well in the middle for the dice
    if (n !== 4) {
      ctx.beginPath();
      for (let s = 0; s < n; s++) {
        const a = board.armAngle(s) + Math.PI / n;
        ctx.lineTo(Math.cos(a) * 1.5, Math.sin(a) * 1.5);
      }
      ctx.closePath();
      ctx.fillStyle = '#2a2030';
      ctx.fill();
      ctx.lineWidth = 0.1;
      ctx.strokeStyle = theme.bg;
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
    // Back to front (so nearer pawns overlap farther ones), with moving pawns on top.
    const order = [...placed].sort((p, q) => p.moving - q.moving || p.y - q.y);
    for (const p of order) this.drawPlaced(p, now);

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
          onBoard: !o && progress >= 0,
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
    for (const [key, group] of groups) {
      const n = group.length;
      if (key.startsWith('finish')) {
        // Finished pins stand in a small 2×2 cluster in their triangle, so you can count them.
        const spots = n === 1 ? [[0, 0]] : [[-0.21, -0.14], [0.21, -0.14], [-0.21, 0.14], [0.21, 0.14]];
        group.forEach((it, i) => {
          it.x += spots[i][0];
          it.y += spots[i][1];
          it.scale = 0.68;
        });
        continue;
      }
      // Spread out tokens that share a square
      if (n < 2) continue;
      group.forEach((it, i) => {
        const ang = (i / n) * TAU - Math.PI / 4;
        it.x += Math.cos(ang) * 0.2;
        it.y += Math.sin(ang) * 0.2;
        it.scale = n > 2 ? 0.66 : 0.78;
      });
    }
    return items;
  }

  drawPlaced(p, now) {
    const ctx = this.ctx;
    const s = this.cell;
    const x = this.px(p.x);
    const y = this.px(p.y);
    const r = s * 0.4 * p.scale * (p.moving ? 1.1 : 1);
    if (p.hl) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      const grow = s * (0.12 + 0.08 * pulse);
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.2, r * 1.05 + grow, r * 0.45 + grow * 0.5, 0, 0, TAU);
      ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.35 * pulse})`;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#111';
      ctx.stroke();
    }
    const hex = this.seatColor(p.seat);
    // A coloured ring on the square under a pawn on the track, so you can see whose it is and where it stands.
    if (p.onBoard) {
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.2, r * 1.0, r * 0.46, 0, 0, TAU);
      ctx.fillStyle = mix(hex, '#ffffff', 0.55);
      ctx.globalAlpha = 0.75;
      ctx.fill();
      ctx.globalAlpha = 1;
      // White outside the coloured ring, so it still shows on squares of the same colour
      ctx.lineWidth = Math.max(3, s * 0.1);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.lineWidth = Math.max(1.5, s * 0.05);
      ctx.strokeStyle = hex;
      ctx.stroke();
    }
    drawToken(ctx, x, y, r, hex, p.skin, { lift: p.lift * s, squash: p.squash });
    // Colour-blind mode: the player's shape on the pawn's body
    if (this.cb) {
      const by = y + r * 0.2 - p.lift * s - r * 0.82 * p.squash;
      drawShape(ctx, this.seatShape(p.seat), x, by, r * 0.36, '#ffffff', '#111111', Math.max(1.2, r * 0.08));
    }
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

  // The dice lives in the middle of the board: it pops in for whoever's turn it is,
  // spins when rolled, shows the result, then shrinks away once it has been used.
  drawCenterDice(d, now) {
    if (!d) return;
    const ctx = this.ctx;
    const size = this.diceSize * this.cell;
    const cx = this.px(0);
    const cy = this.px(0);
    let scale = 1;
    let spin = IDENTITY;
    let tilt = 0; // landed dice sit flat, showing just the rolled face
    let alpha = 1;
    let hop = 0;
    let value = d.value;
    if (d.mode === 'ready') {
      // Unrolled: a flat dice with "?", bobbing gently
      scale = easeOutBack(Math.min(1, d.t / 320));
      hop = (0.5 + 0.5 * Math.sin(now / 260)) * size * 0.08;
      value = null;
    } else if (d.mode === 'spin') {
      // Tumbles end over end and settles with the rolled face towards you
      const k = Math.min(1, d.t / SPIN_MS);
      const left = 1 - easeOutCubic(k);
      const [ax, ay] = d.axes || [2.5, 1.5];
      spin = mul(rotX(ax * TAU * left), rotY(ay * TAU * left));
      tilt = Math.min(1, left * 2); // straightens out over the last part of the roll
      hop = Math.sin(Math.PI * k) * size * 0.55;
      scale = 1 + 0.15 * Math.sin(Math.PI * k);
    } else if (d.mode === 'shown') {
      scale = 1 + 0.1 * Math.sin(Math.min(1, d.t / 220) * Math.PI);
    } else if (d.mode === 'leave') {
      const k = Math.min(1, d.t / LEAVE_MS);
      // Shrinks away still showing the rolled face (fading would let the edge show through)
      scale = 1 - easeOutCubic(k) * 0.999;
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

    // 3D while it tumbles; flat with a single number before the roll and once it lands.
    const draw = d.mode === 'spin' ? drawDiceCube : drawDice;
    draw(ctx, cx, cy - hop, size * scale, value, d.style, {
      spin,
      tilt,
      alpha,
      glow: d.mode === 'ready' ? d.color : null,
      color: d.color,
    });

    this.drawBank(d, size, cx, cy - hop);

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
    // Colour emoji fonts first: with a text font first, Windows can fall back to Segoe UI
    // Symbol's monochrome glyphs, which paint in the leftover fillStyle (white). Opaque black
    // fill and no shadow keep any fallback glyph dark instead of washed out.
    ctx.fillStyle = '#000';
    ctx.shadowBlur = 0;
    for (const e of list) {
      const age = now - e.start;
      if (age < 0 || age > EMOTE_MS) continue;
      const k = age / EMOTE_MS;
      const b = this.board.bases[e.seat];
      const scale = easeOutBack(Math.min(1, age / 220));
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      if (e.img) {
        const im = emoteImg(e.img);
        if (im.complete && im.naturalWidth) {
          const size = s * 1.6 * scale;
          ctx.drawImage(im, this.px(b.x) - size / 2, this.px(b.y) - k * s * 1.4 - size / 2, size, size);
        }
        continue;
      }
      ctx.font = `${s * 1.6 * scale}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
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

  // The turn's other rolls (6s kept for later, or rolls still to play) sit in a row of small
  // dice above the big one.
  drawBank(d, size, cx, cy) {
    // Equal rolls share one dice with a "×N" count
    const groups = [];
    for (const value of d.bank || []) {
      const g = groups.find((g) => g.value === value);
      if (g) g.count++;
      else groups.push({ value, count: 1 });
    }
    if (!groups.length) return;
    const ctx = this.ctx;
    const small = size * 0.4;
    const slot = small * 1.9; // room for the count beside each dice
    const y = cy - size * 0.5 - small * 0.75;
    groups.forEach((g, i) => {
      const x = cx + (i - (groups.length - 1) / 2) * slot - (g.count > 1 ? small * 0.3 : 0);
      drawDice(ctx, x, y, small, g.value, d.style, { color: d.color });
      if (g.count > 1) {
        ctx.font = `800 ${Math.max(10, small * 0.5)}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(`×${g.count}`, x + small * 0.58, y);
        ctx.fillStyle = '#fff';
        ctx.fillText(`×${g.count}`, x + small * 0.58, y);
      }
    });
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
      const d = Math.hypot(p.x - x, p.y - 0.25 - y); // pawns stand up from their square
      if (d < bestDist) {
        bestDist = d;
        best = p.token;
      }
    }
    return best;
  }

  // Screen point of a pawn's body, for tapping it.
  tokenPoint(item) {
    return this.toClient(item.x, item.y - 0.25);
  }

  hitDice(clientX, clientY) {
    const { x, y } = this.toBoard(clientX, clientY);
    return Math.hypot(x, y) < this.diceSize * 0.75;
  }
}

// ---------- tokens ----------

// Draws one 3D pawn standing on (x, y). `lift` raises it (px), `squash` < 1 flattens it on landing.
export function drawToken(ctx, x, y, r, hex, skin, { lift = 0, squash = 1 } = {}) {
  const gy = y + r * 0.2; // the pawn's base sits on the centre of its square
  const shrink = 1 - Math.min(0.45, lift / (r * 4));
  ctx.beginPath();
  ctx.ellipse(x, gy, r * 0.95 * shrink, r * 0.4 * shrink, 0, 0, TAU);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fill();

  ctx.save();
  ctx.translate(x, gy - lift);
  ctx.scale(1 / squash, squash);
  paintPawn(ctx, r, hex, PAWN_STYLES[skin] || PAWN_STYLES['token-classic']);
  ctx.restore();
}

// What each token skin changes about the pawn.
const PAWN_STYLES = {
  'token-classic': {},
  'token-star': { star: true },
  'token-gem': { gem: true },
  'token-neon': { neon: true },
  'token-candy': { stripes: true },
  'token-crown': { gold: true, crown: true },
};

const GOLD = '#f6cf57';
const GOLD_DARK = '#9a6f00';

// A pawn drawn upwards from (0, 0): base disc, tapered body, collar and round head.
function paintPawn(ctx, r, hex, style) {
  const body = style.neon ? '#1c1c26' : hex;
  const edge = style.neon ? hex : mix(hex, '#000000', 0.38);
  const trim = style.gold ? GOLD : mix(body, '#ffffff', 0.22);
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
  if (style.crown) {
    path(ctx, [
      [-0.3, -0.38],
      [-0.3, -0.62],
      [-0.15, -0.5],
      [0, -0.72],
      [0.15, -0.5],
      [0.3, -0.62],
      [0.3, -0.38],
    ].map(([x, y]) => [x * r, hy + y * r]));
    ctx.fillStyle = GOLD;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.strokeStyle = GOLD_DARK;
    ctx.stroke();
  }
}

// Left-to-right shading that makes a flat shape look round.
function cylinder(ctx, w, color) {
  const g = ctx.createLinearGradient(-w, 0, w, 0);
  g.addColorStop(0, mix(color, '#000000', 0.22));
  g.addColorStop(0.3, mix(color, '#ffffff', 0.28));
  g.addColorStop(0.55, color);
  g.addColorStop(1, mix(color, '#000000', 0.3));
  return g;
}

// ---------- dice ----------
// The dice is a real cube: it is rotated in 3D and the faces turned towards you are drawn.

const PIPS = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

// Each face: its value, outward normal and two in-face axes (y points down). Opposite faces add up to 7.
const FACES = [
  { value: 1, n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { value: 6, n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  { value: 2, n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { value: 5, n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { value: 3, n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { value: 4, n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
];
// Rotation that turns a value's face towards the viewer.
const FACE_FRONT = {
  1: rotY(0),
  6: rotY(Math.PI),
  2: rotY(-Math.PI / 2),
  5: rotY(Math.PI / 2),
  3: rotX(-Math.PI / 2),
  4: rotX(Math.PI / 2),
};
// A slight tilt (0 = flat, 1 = full), so the top and right faces show as well.
const tiltBy = (t) => mul(rotX(-0.42 * t), rotY(-0.5 * t));
const LIGHT = [-0.35, -0.6, 0.72].map((c, _, a) => c / Math.hypot(...a));

// A dice skin's colours; skins with `playerColor` take on the roller's colour.
function diceStyle(styleId, color) {
  const st = DICE_STYLES[styleId] || DICE_STYLES['dice-classic'];
  if (!st.playerColor || !color) return st;
  return { ...st, edge: color, pip: color, outline: color };
}

// One face of the dice in its own coordinates (-50..50). The flat dice and every face of the
// 3D cube use this, so the cube's front face looks exactly like the flat dice it turns into.
// `light` < 1 darkens faces turned away from you; `px` is one face unit in pixels.
function paintFace(ctx, st, value, { light = 1, pips = true, glow = null, px = 1 } = {}) {
  const shade = (c) => (light < 1 ? mix(c, '#000000', 1 - light) : c);
  let fill = shade(st.face);
  if (st.shine) {
    fill = ctx.createLinearGradient(-50, -50, 50, 50);
    fill.addColorStop(0, shade(st.shine));
    fill.addColorStop(1, shade(st.face));
  }
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = 45 * px;
  }
  roundRect(ctx, -50, -50, 100, 100, 16);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowBlur = 0;
  if (st.outline) {
    ctx.shadowColor = st.outline;
    ctx.shadowBlur = 20 * px;
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = st.outline || st.edge;
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (!pips) return;

  ctx.fillStyle = st.pip;
  if (st.outline) {
    ctx.shadowColor = st.pip;
    ctx.shadowBlur = 15 * px;
  }
  if (value) {
    for (const [x, y] of PIPS[value]) {
      circle(ctx, x * 27, y * 27, 10);
      ctx.fill();
    }
  } else {
    ctx.font = '800 58px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, 3);
  }
  ctx.shadowBlur = 0;
}

// Draws a flat dice centred on (cx, cy) showing one face. `value` null shows "?".
export function drawDice(ctx, cx, cy, size, value, styleId, { alpha = 1, glow = null, color = null } = {}) {
  const st = diceStyle(styleId, color);
  const k = (size * 0.96) / 100; // same size as the cube's face when it lands
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.lineJoin = 'round';
  // A darker edge underneath gives it a little thickness
  ctx.fillStyle = st.edge;
  roundRect(ctx, -50, -43, 100, 100, 16);
  ctx.fill();
  paintFace(ctx, st, value, { glow, px: k });
  ctx.restore();
}

// Draws the dice as a tumbling 3D cube, with the `value` face towards you after `spin`.
// As `tilt` reaches 0 only that face shows, so it hands over smoothly to the flat dice.
function drawDiceCube(ctx, cx, cy, size, value, styleId, { spin = IDENTITY, tilt = 1, alpha = 1, glow = null, color = null } = {}) {
  const st = diceStyle(styleId, color);
  const R = mul(tiltBy(tilt), mul(spin, FACE_FRONT[value || 1]));
  const h = size * (0.48 - 0.08 * tilt); // half the cube's edge; a flat face is drawn a little bigger
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  for (const f of FACES) {
    const n = apply(R, f.n);
    if (n[2] <= 0.01) continue; // facing away
    const u = apply(R, f.u);
    const v = apply(R, f.v);
    // Full brightness when facing you, darker as it turns away (from the top-left light).
    const side = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1]);
    const light = Math.min(1, 0.58 + 0.42 * n[2] + 0.12 * side);

    // Draw the face in its own flat coordinates, -50..50 on each side.
    ctx.save();
    ctx.transform((u[0] * h) / 50, (u[1] * h) / 50, (v[0] * h) / 50, (v[1] * h) / 50, n[0] * h, n[1] * h);
    // Faces seen almost edge-on get no pips: squashed pips just look like stripes.
    paintFace(ctx, st, value ? f.value : null, { light, pips: n[2] > 0.3, glow, px: h / 50 });
    ctx.restore();
  }
  ctx.restore();
}

// ---------- 3D maths (row-major 3x3 matrices) ----------

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
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) m.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
  }
  return m;
}

function apply(m, [x, y, z]) {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

// ---------- drawing helpers ----------

// One square of the track: a slightly rounded tile, a little smaller than its cell.
function drawTile(ctx, sq, fill) {
  ctx.save();
  ctx.translate(sq.x, sq.y);
  ctx.rotate(sq.angle);
  ctx.fillStyle = fill;
  roundRect(ctx, -0.45, -0.45, 0.9, 0.9, 0.12);
  ctx.fill();
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

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, TAU);
}

// Image emotes (from packs) are shared between the DOM buttons and the canvas:
// one element per URL so the browser does the fetching once.
const emoteImgs = new Map();
function emoteImg(url) {
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
function drawPinSpots(ctx, b, spread, r, color) {
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
// A shape colour that stands out on a tile of colour `hex`: dark on light colours (like yellow), white otherwise.
function inkOn(hex) {
  const p = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((p >> 16) & 255) + 0.587 * ((p >> 8) & 255) + 0.114 * (p & 255)) / 255;
  return lum > 0.6 ? { fill: 'rgba(0,0,0,0.62)', edge: null } : { fill: '#ffffff', edge: 'rgba(0,0,0,0.5)' };
}

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

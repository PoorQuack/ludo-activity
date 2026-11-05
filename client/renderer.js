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
    if (theme.bg2) {
      // Some themes glow from the middle out
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, half * 1.25);
      g.addColorStop(0, theme.bg2);
      g.addColorStop(1, theme.bg);
      ctx.fillStyle = g;
    } else ctx.fillStyle = theme.bg;
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
    const art = theme.art || {};
    tileK = k; // tiles that glow need to know how big a board unit is in pixels

    // Bases: a solid block of the player's colour with a plain panel inside
    board.bases.forEach((b, seat) => {
      ctx.fillStyle = color(seat);
      if (b.square) {
        const outer = b.size - 0.1;
        roundRect(ctx, b.x - outer, b.y - outer, outer * 2, outer * 2, 0.5);
        paintBase(ctx, art, theme, b.x - outer, b.y - outer, outer * 2, outer * 2, color(seat), k);
        const inner = b.size * 0.7;
        roundRect(ctx, b.x - inner, b.y - inner, inner * 2, inner * 2, 0.4);
        innerPanel(ctx, theme, b.x, b.y, inner, color(seat));
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
        paintBase(ctx, art, theme, b.x - 7, b.y - 7, 14, 14, color(seat), k);
        circle(ctx, b.x, b.y, b.size);
        innerPanel(ctx, theme, b.x, b.y, b.size, color(seat));
        drawPinSpots(ctx, b, board.baseSpread, 0.42, color(seat));
      }
      // Colour-blind mode: the player's shape in the middle of their base
      if (cb) drawShape(ctx, this.seatShape(seat), b.x, b.y, b.square ? 0.6 : 0.42, color(seat), 'rgba(0,0,0,0.35)', 0.08);
    });

    // Track: start squares in the player's colour, safe squares tinted with a star
    board.track.forEach((sq, i) => {
      const startSeat = board.startIndex.indexOf(i);
      const safe = board.safe.has(i);
      drawTile(ctx, sq, startSeat >= 0 ? color(startSeat) : safe ? theme.safe : theme.cell, art.tile, theme);
      // (in colour-blind mode the start square shows its player's shape instead of the star)
      if (startSeat >= 0 && cb) {
        const ink = inkOn(color(startSeat));
        drawShape(ctx, this.seatShape(startSeat), sq.x, sq.y, 0.27, ink.fill, ink.edge, 0.05);
      }
      else if (startSeat >= 0) motif(ctx, art.mark || 'star', sq.x, sq.y, 0.27, 'rgba(255,255,255,0.92)');
      else if (safe) {
        // Safe squares: optionally a ring round the tile and an outlined mark, so they stand out
        if (art.safeRing) {
          ctx.save();
          ctx.translate(sq.x, sq.y);
          ctx.rotate(sq.angle);
          ctx.lineWidth = 0.07;
          ctx.strokeStyle = art.safeRing;
          roundRect(ctx, -0.37, -0.37, 0.74, 0.74, 0.09);
          ctx.stroke();
          ctx.restore();
        }
        motif(ctx, art.mark || 'star', sq.x, sq.y, art.markSize || 0.27, theme.star);
        if (art.markEdge) {
          ctx.lineWidth = 0.045;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = art.markEdge;
          ctx.stroke();
          motif(ctx, art.mark || 'star', sq.x, sq.y, art.markSize || 0.27, theme.star);
        }
      }
    });

    // Home columns
    board.homeColumns.forEach((col, seat) => {
      for (const sq of col) {
        drawTile(ctx, sq, color(seat), art.tile, theme);
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
      if (art.base === 'outline' || art.base === 'rock') {
        ctx.fillStyle = art.base === 'outline' ? '#0c0d16' : mix(color(s), '#000000', 0.55);
        ctx.fill();
        ctx.save();
        ctx.shadowColor = color(s);
        ctx.shadowBlur = 0.35 * k;
        ctx.lineWidth = 0.09;
        ctx.strokeStyle = color(s);
        ctx.stroke();
        ctx.restore();
      } else ctx.fill();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 0.1;
      ctx.strokeStyle = theme.bg;
      if (art.base !== 'outline' && art.base !== 'rock') ctx.stroke();
      if (cb) {
        // In the middle of the wedge: its centroid on the square board; on the hexagon board,
        // halfway between the dice well and the wedge's outer edge
        const d = n === 4 ? board.hub * 0.64 : (1.5 + board.hub) / 2;
        const ink = inkOn(color(s));
        drawShape(ctx, this.seatShape(s), Math.cos(a) * d, Math.sin(a) * d, 0.22, ink.fill, ink.edge, 0.05);
      }
    }
    // A soft shine over the middle
    if (art.tile) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      g.addColorStop(0, 'rgba(255,255,255,0.28)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      circle(ctx, 0, 0, R);
      ctx.fill();
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
    // The theme's frame round the whole board
    if (art.frame && n === 4) {
      const [c1, c2, w] = art.frame;
      const f = w / 2 + 0.02;
      const g = ctx.createLinearGradient(-half, -half, half, half);
      g.addColorStop(0, c1);
      g.addColorStop(0.5, c2);
      g.addColorStop(1, c1);
      ctx.lineWidth = w;
      ctx.strokeStyle = g;
      roundRect(ctx, -half + f, -half + f, this.span - f * 2, this.span - f * 2, 12 * lw);
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
    if (this.theme.art?.fx) this.drawAmbience(this.theme.art, now);
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
    // Colour-blind mode: the player's shape on the token's body (each shape has its own spot)
    if (this.cb) {
      const mark = TOKEN_MARKS[PAWN_STYLES[p.skin]?.shape || 'pawn'];
      const by = y + r * 0.2 - p.lift * s - r * mark.y * p.squash;
      drawShape(ctx, this.seatShape(p.seat), x + r * mark.x, by, r * 0.36 * mark.size, '#ffffff', '#111111', Math.max(1.2, r * 0.08));
    }
  }

  // The theme's living layer, under the tokens: snow, embers, bubbles, fireflies, twinkles…
  // Every particle is worked out from the time alone, so there's nothing to keep track of.
  drawAmbience(art, now) {
    const ctx = this.ctx;
    const k = this.dpr * this.cell;
    const mid = (this.dpr * this.size) / 2;
    const half = this.span / 2;
    const t = now / 1000;
    ctx.save();
    ctx.setTransform(k, 0, 0, k, mid, mid);
    const wrap = (v) => ((((v + half) % this.span) + this.span) % this.span) - half;
    const n = art.fxCount || 26;
    const kind = art.fx;
    if (kind === 'scan') {
      // a soft band of light sweeping down the board
      const y = wrap(t * 2.2);
      const g = ctx.createLinearGradient(0, y - 1.2, 0, y + 1.2);
      g.addColorStop(0, 'rgba(120, 220, 255, 0)');
      g.addColorStop(0.5, 'rgba(120, 220, 255, 0.10)');
      g.addColorStop(1, 'rgba(120, 220, 255, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(-half, y - 1.2, this.span, 2.4);
      ctx.restore();
      return;
    }
    if (['embers', 'fireflies', 'twinkle', 'sparkle'].includes(kind)) ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const a = rnd(i * 4 + 1);
      const b = rnd(i * 4 + 2);
      const c = rnd(i * 4 + 3);
      const x0 = -half + a * this.span;
      const y0 = -half + b * this.span;
      if (kind === 'snow') {
        const y = wrap(y0 + t * (0.35 + c * 0.4));
        const x = x0 + Math.sin(t * (0.6 + c) + i) * 0.35;
        ctx.globalAlpha = 0.55 + c * 0.35;
        ctx.fillStyle = '#ffffff';
        circle(ctx, x, y, 0.05 + c * 0.07);
        ctx.fill();
      } else if (kind === 'embers') {
        const y = wrap(y0 - t * (0.5 + c * 0.6));
        const x = x0 + Math.sin(t * 1.3 + i) * 0.25;
        const life = (y + half) / this.span; // fade near the top
        ctx.globalAlpha = Math.min(1, life * 1.4) * (0.5 + 0.5 * Math.sin(t * 9 + i * 3));
        const g = ctx.createRadialGradient(x, y, 0, x, y, 0.14 + c * 0.1);
        g.addColorStop(0, '#fff3b0');
        g.addColorStop(0.4, '#ff8a2a');
        g.addColorStop(1, 'rgba(255,60,20,0)');
        ctx.fillStyle = g;
        circle(ctx, x, y, 0.14 + c * 0.1);
        ctx.fill();
      } else if (kind === 'bubbles') {
        const y = wrap(y0 - t * (0.3 + c * 0.35));
        const x = x0 + Math.sin(t * 1.6 + i * 2) * 0.18;
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#e8fbff';
        ctx.lineWidth = 0.035;
        circle(ctx, x, y, 0.08 + c * 0.12);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        circle(ctx, x - 0.03, y - 0.04, 0.025 + c * 0.02);
        ctx.fill();
      } else if (kind === 'fireflies') {
        const x = x0 + Math.sin(t * (0.3 + c * 0.3) + i) * 0.9;
        const y = y0 + Math.cos(t * (0.25 + a * 0.3) + i * 2) * 0.7;
        ctx.globalAlpha = Math.max(0, Math.sin(t * (1.2 + c) + i * 5)) * 0.9;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 0.28);
        g.addColorStop(0, '#f6ffb0');
        g.addColorStop(0.3, 'rgba(200, 255, 90, 0.6)');
        g.addColorStop(1, 'rgba(120, 200, 40, 0)');
        ctx.fillStyle = g;
        circle(ctx, x, y, 0.28);
        ctx.fill();
      } else if (kind === 'twinkle' || kind === 'sparkle') {
        ctx.globalAlpha = Math.max(0, Math.sin(t * (1 + c * 1.5) + i * 7)) ** 3;
        const r = 0.08 + c * 0.1;
        ctx.fillStyle = art.fxColor || '#ffffff';
        ctx.beginPath();
        ctx.moveTo(x0, y0 - r * 2);
        ctx.quadraticCurveTo(x0, y0, x0 + r * 2, y0);
        ctx.quadraticCurveTo(x0, y0, x0, y0 + r * 2);
        ctx.quadraticCurveTo(x0, y0, x0 - r * 2, y0);
        ctx.quadraticCurveTo(x0, y0, x0, y0 - r * 2);
        ctx.fill();
      } else if (kind === 'sprinkles') {
        const y = wrap(y0 + t * (0.3 + c * 0.3));
        ctx.globalAlpha = 0.85;
        ctx.save();
        ctx.translate(x0 + Math.sin(t + i) * 0.2, y);
        ctx.rotate(t * (c - 0.5) * 3 + i);
        ctx.fillStyle = ['#ff5ca8', '#3fd8a4', '#ffd23f', '#5aa8ff', '#b07bff'][i % 5];
        roundRect(ctx, -0.13, -0.035, 0.26, 0.07, 0.035);
        ctx.fill();
        ctx.restore();
      } else if (kind === 'paws') {
        // paw prints that appear one after another along a little walk, then fade
        const cycle = 6;
        const ph = (t + c * cycle) % cycle;
        const step = i % 6;
        const appear = step * 0.4;
        if (ph < appear) continue;
        ctx.globalAlpha = Math.max(0, 0.35 * (1 - (ph - appear) / (cycle - appear)));
        const walk = Math.floor(i / 6);
        const bx = -half + rnd(walk * 11 + Math.floor((t + c * cycle) / cycle) * 3) * this.span;
        const by = -half + rnd(walk * 13 + 1) * this.span;
        motif(ctx, 'paw', bx + step * 0.45, by + (step % 2 ? 0.22 : -0.22), 0.16, art.fxColor || '#ffffff');
      } else if (kind === 'dust') {
        const x = x0 + Math.sin(t * 0.2 + i) * 0.6;
        const y = y0 + Math.cos(t * 0.17 + i * 3) * 0.6;
        ctx.globalAlpha = 0.25 + 0.2 * Math.sin(t + i);
        ctx.fillStyle = '#fff2d0';
        circle(ctx, x, y, 0.04);
        ctx.fill();
      }
    }
    ctx.restore();
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
  // Whole new shapes instead of the pawn
  'token-checker': { shape: 'checker' },
  'token-ghost': { shape: 'ghost' },
  'token-slime': { shape: 'slime' },
  'token-rocket': { shape: 'rocket' },
  'token-duck': { shape: 'duck' },
  'token-cat': { shape: 'cat' },
};

// Where the colour-blind shape sits on each token shape: height above the base (in r), a
// sideways nudge, and its size — on the body, clear of eyes, windows and beaks.
const TOKEN_MARKS = {
  pawn: { y: 0.82, x: 0, size: 1 },
  checker: { y: 0.66, x: 0, size: 1.1 },
  ghost: { y: 0.6, x: 0, size: 1 },
  slime: { y: 0.36, x: 0, size: 0.85 },
  rocket: { y: 0.78, x: 0, size: 0.85 },
  duck: { y: 0.5, x: 0.12, size: 0.95 },
  cat: { y: 0.55, x: 0, size: 0.9 },
};

const GOLD = '#f6cf57';
const GOLD_DARK = '#9a6f00';

// A pawn drawn upwards from (0, 0): base disc, tapered body, collar and round head.
function paintPawn(ctx, r, hex, style) {
  if (style.shape) return TOKEN_SHAPES[style.shape](ctx, r, hex);
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

// ---------- token shapes ----------
// Each draws upwards from (0, 0), about as tall as the pawn (2.1 r), in the player's colour.

function outline(ctx, r, hex) {
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.strokeStyle = mix(hex, '#000000', 0.4);
  ctx.lineJoin = 'round';
}

// A cartoon eye: white, a dark pupil looking slightly forward, and a glint.
function eye(ctx, x, y, w, h, look = 0) {
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

const TOKEN_SHAPES = {
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
    ctx.beginPath();
    ctx.moveTo(-r * 0.28, -r * 0.38);
    ctx.quadraticCurveTo(0, r * 0.4, r * 0.28, -r * 0.38);
    ctx.closePath();
    const fg = ctx.createLinearGradient(0, -r * 0.38, 0, r * 0.35);
    fg.addColorStop(0, '#fff3a0');
    fg.addColorStop(0.45, '#ffb02e');
    fg.addColorStop(1, 'rgba(255,80,40,0)');
    ctx.fillStyle = fg;
    ctx.fill();
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

// Where the stars sit on a speckled (galaxy) dice face: x, y, size.
const SPECKS = [
  [-38, -30, 1.6], [-20, -42, 1], [6, -36, 1.4], [30, -40, 1], [40, -18, 1.8], [-42, 4, 1.2], [-14, -12, 1],
  [18, -6, 1.2], [38, 12, 1], [-30, 26, 1.8], [-6, 40, 1.2], [22, 34, 1.6], [42, 40, 1], [-44, 42, 1],
];

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
// `light` < 1 darkens faces turned away from you; `px` is one face unit in pixels; `t` is the
// time in ms, for skins that move (twinkling stars, glowing cracks, a glint sweeping across).
function paintFace(ctx, st, value, { light = 1, pips = true, glow = null, px = 1, t = 0 } = {}) {
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
  roundRect(ctx, -50, -50, 100, 100, 16);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.save();
  roundRect(ctx, -50, -50, 100, 100, 16);
  ctx.clip();
  if (st.art) DICE_ART[st.art](ctx, st, t);
  if (pips) {
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

  roundRect(ctx, -50, -50, 100, 100, 16);
  if (st.outline) {
    ctx.shadowColor = st.outline;
    ctx.shadowBlur = (st.pulse ? 14 + 8 * Math.sin(t / 260) : 20) * px;
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = st.outline || st.edge;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ---------- dice artwork ----------
// Drawn inside the face (clipped), under the pips. Coordinates -50..50.

// A repeatable pseudo-random number for index i (so static details don't flicker).
const rnd = (i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// A bright band sweeping across the face every `every` ms
function glint(ctx, t, every = 3200, alpha = 0.55) {
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
function twinkles(ctx, t, n, color, seed = 1) {
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
const CRACKS = [
  [[-50, -18], [-30, -12], [-22, 4], [-38, 22], [-50, 30]],
  [[-22, 4], [2, 10], [18, -6], [34, -2], [50, -14]],
  [[2, 10], [8, 30], [-4, 50]],
  [[18, -6], [12, -28], [24, -50]],
  [[34, -2], [40, 22], [50, 34]],
  [[-30, -12], [-34, -36], [-20, -50]],
];
function strokeCracks(ctx) {
  ctx.beginPath();
  for (const line of CRACKS) line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
}

const DICE_ART = {
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

function octagon(ctx, m, c) {
  path(ctx, [[-m + c, -m], [m - c, -m], [m, -m + c], [m, m - c], [m - c, m], [-m + c, m], [-m, m - c], [-m, -m + c]]);
}

function snowflake(ctx, x, y, r, color, w = 1) {
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

// A cat's paw print: one big pad and four toes, centred on (x, y), about 2r across.
function pawPrint(ctx, x, y, r, color) {
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

// ---------- pip styles ----------
// (ctx, x, y, r, style, pip index, time, px)
const PIP_STYLES = {
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
  // Paw prints (cat)
  paw(ctx, x, y, r, st) {
    pawPrint(ctx, x, y, r * 1.15, st.pip);
  },
};

// Draws a flat dice centred on (cx, cy) showing one face. `value` null shows "?".
export function drawDice(ctx, cx, cy, size, value, styleId, { alpha = 1, glow = null, color = null, t = performance.now() } = {}) {
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
  paintFace(ctx, st, value, { glow, px: k, t });
  ctx.restore();
}

// Draws the dice as a tumbling 3D cube, with the `value` face towards you after `spin`.
// As `tilt` reaches 0 only that face shows, so it hands over smoothly to the flat dice.
function drawDiceCube(ctx, cx, cy, size, value, styleId, { spin = IDENTITY, tilt = 1, alpha = 1, glow = null, color = null, t = performance.now() } = {}) {
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
    paintFace(ctx, st, value ? f.value : null, { light, pips: n[2] > 0.3, glow, px: h / 50, t });
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
// `style` (a board theme's art.tile) dresses it up: gloss, frost, stone, neon, wood, moss, gilded, starry.
function drawTile(ctx, sq, fill, style, theme) {
  ctx.save();
  ctx.translate(sq.x, sq.y);
  ctx.rotate(sq.angle);
  ctx.fillStyle = fill;
  roundRect(ctx, -0.45, -0.45, 0.9, 0.9, 0.12);
  ctx.fill();
  if (style) TILE_STYLES[style]?.(ctx, fill, theme, rnd(sq.x * 7.3 + sq.y * 3.1));
  ctx.restore();
}

let tileK = 1; // pixels per board unit while the board is drawn (for glows)

// Each is drawn over a tile already filled, in the tile's own frame (-0.45..0.45), path still set.
const TILE_STYLES = {
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
    ctx.beginPath();
    ctx.moveTo(-0.45, -0.1 + r * 0.3);
    ctx.lineTo(-0.1, 0.05);
    ctx.lineTo(0.15 - r * 0.2, 0.45);
    ctx.moveTo(-0.1, 0.05);
    ctx.lineTo(0.45, -0.2 + r * 0.2);
    ctx.stroke();
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
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.moveTo(-0.45, -0.25 + r * 0.4);
    ctx.lineTo(-0.12 + r * 0.1, 0.02);
    ctx.lineTo(0.08, -0.1);
    ctx.lineTo(0.45, 0.2 - r * 0.3);
    ctx.moveTo(-0.12 + r * 0.1, 0.02);
    ctx.lineTo(-0.05, 0.45);
    ctx.stroke();
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

// A player's base block (its path already set), in the theme's style:
//  solid (default) · outline: dark with a neon edge · rock: dark stone with a glowing rim ·
//  frame: a gold border · frosted: pale with a white rim · pool: water, lighter in the middle ·
//  inlay: a wooden frame · dusk: the colour fading into the night · cushion: soft, with stitching
function paintBase(ctx, art, theme, x, y, w, h, color, k) {
  const style = art.base || 'solid';
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (style === 'outline') ctx.fillStyle = '#0c0d16';
  else if (style === 'rock') ctx.fillStyle = mix(color, '#000000', 0.6);
  else if (style === 'frosted') ctx.fillStyle = mix(color, '#ffffff', 0.3);
  else ctx.fillStyle = color;
  ctx.fill();
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
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.translate(cx, cy);
    ctx.scale(0.9, 0.9);
    ctx.translate(-cx, -cy);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (style === 'pool') {
    ctx.lineWidth = 0.14;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.stroke();
  }
  ctx.restore();
}

// The pattern over a coloured base block, clipped to the path that was just filled.
function basePattern(ctx, art, x, y, w, h, color) {
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
function innerPanel(ctx, theme, x, y, r, color) {
  const art = theme.art || {};
  ctx.fillStyle = theme.baseInner;
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
function motif(ctx, kind, x, y, s, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  switch (kind) {
    case 'star':
      drawStar(ctx, x, y, s, color);
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

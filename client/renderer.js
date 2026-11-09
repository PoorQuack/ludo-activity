// Draws the board, tokens, dice and effects on a <canvas>.
// Board positions come in board units (one square = 1, centre = 0,0); see shared/board.js.
import { BOARD_THEMES, DICE_STYLES, CB_COLORS, SHAPES, isColorBlind } from './skins.js';

export const SPIN_MS = 600;
export const LEAVE_MS = 260;
export const EMOTE_MS = 2400;
const TAU = Math.PI * 2;

// The drifting-texture layer's resolution, in pixels per CSS pixel (see drawUnder).
export let ANIM_SCALE = 0.6;
export const setAnimScale = (k) => (ANIM_SCALE = k);

export class BoardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 0;
    this.dpr = 1;
    this.board = null;
    this.theme = null;
    this.layer = document.createElement('canvas');
    this.under = document.createElement('canvas'); // the board's surface, seen through gaps and windows
    this.anim = document.createElement('canvas'); // surface + drifting texture, small and refreshed ~20×/s
    this.animFull = document.createElement('canvas'); // that, stretched to the board's size once per refresh
    this.animAt = -Infinity;
    this.particles = [];
    this.lastNow = 0;
    this.shieldSince = new Map(); // "seat-token" -> when it stepped onto a safe square
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

  // Smooth mode: no drifting surface, no floating particles, and no blurred glows on the board
  // (blur is the costliest thing for a phone's GPU). Everything still shows, just stiller.
  setLite(on) {
    if (on === !!this.lite) return;
    this.lite = on;
    const ctx = this.ctx;
    if (on) Object.defineProperty(ctx, 'shadowBlur', { configurable: true, get: () => 0, set: () => {} });
    else delete ctx.shadowBlur;
    this.animAt = -Infinity;
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
    // Phones report 3× pixel density; drawing at 2× looks the same on a board this size and is
    // well under half the pixels to fill every frame.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.floor(cssSize);
    if (size === this.size && dpr === this.dpr) return;
    this.size = size;
    this.dpr = dpr;
    this.span = this.board.extent * 2 + 0.3;
    this.cell = size / this.span;
    this.lastCss = cssSize;
    for (const c of [this.canvas, this.layer, this.under, this.animFull]) {
      c.width = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
    }
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.anim.width = Math.round(size * ANIM_SCALE); // the drifting textures are soft anyway
    this.anim.height = this.anim.width;
    this.animAt = -Infinity;
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
    drawingFor = this; // textures that are still loading redraw this board when they arrive
    const art = theme.art || {};

    // The surface goes on its own layer underneath: it shows through the grout between tiles, and
    // through "window" panels, with any moving texture (water, lava…) drawn between the two.
    const bg = this.under.getContext('2d');
    bg.setTransform(1, 0, 0, 1, 0, 0);
    bg.clearRect(0, 0, this.under.width, this.under.height);
    bg.setTransform(k, 0, 0, k, mid, mid);
    const n = board.arms;
    if (theme.bg2) {
      // Some themes glow from the middle out
      const g = bg.createRadialGradient(0, 0, 0, 0, 0, half * 1.25);
      g.addColorStop(0, theme.bg2);
      g.addColorStop(1, theme.bg);
      bg.fillStyle = g;
    } else bg.fillStyle = theme.bg;
    if (n === 4) {
      roundRect(bg, -half, -half, this.span, this.span, 12 * lw);
    } else {
      // The hexagon board's outline: the outer corners of every arm, a little grout beyond them
      bg.beginPath();
      const r = board.hub + 6 + 0.12;
      for (let s = 0; s < n; s++) {
        const a = board.armAngle(s);
        for (const v of [-1.62, 1.62]) bg.lineTo(Math.cos(a) * r - Math.sin(a) * v, Math.sin(a) * r + Math.cos(a) * v);
      }
      bg.closePath();
      bg.lineJoin = 'round';
      bg.lineWidth = 0.3;
      bg.strokeStyle = theme.bg;
      bg.stroke();
    }
    bg.fill();
    const surface = texPattern(bg, art.tex?.surface);
    if (surface) {
      bg.fillStyle = surface;
      bg.fill();
    }
    const color = (seat) => this.seatColor(seat);
    const cb = this.cb;
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
        if (art.pins === 'constellation') drawConstellation(ctx, b, board.baseSpread, 0.4, color(seat), this.board.colors[seat], inner, k);
        else if (art.pins === 'dents') drawDents(ctx, b, board.baseSpread, 0.6);
        else drawPinSpots(ctx, b, board.baseSpread, 0.62, color(seat));
        if (art.decor === 'cat') catDecor(ctx, b.x, b.y, outer, color(seat), k);
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
        innerPanel(ctx, theme, b.x, b.y, b.size, color(seat), false);
        if (art.pins === 'constellation') drawConstellation(ctx, b, board.baseSpread, 0.3, color(seat), this.board.colors[seat], b.size, k);
        else if (art.pins === 'dents') drawDents(ctx, b, board.baseSpread, 0.42);
        else drawPinSpots(ctx, b, board.baseSpread, 0.42, color(seat));
      }
      // Colour-blind mode: the player's shape in the middle of their base
      if (cb) drawShape(ctx, this.seatShape(seat), b.x, b.y, b.square ? 0.6 : 0.42, color(seat), 'rgba(0,0,0,0.35)', 0.08);
    });

    // Track: start squares in the player's colour, safe squares tinted with a star
    board.track.forEach((sq, i) => {
      const startSeat = board.startIndex.indexOf(i);
      const safe = board.safe.has(i);
      drawTile(ctx, sq, startSeat >= 0 ? color(startSeat) : safe ? theme.safe : theme.cell, art.tile, theme, startSeat >= 0 ? 'start' : safe ? 'safe' : 'cell', routeTurn(sq, false));
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
        drawTile(ctx, sq, color(seat), art.tile, theme, 'home', routeTurn(sq, true));
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
      if (art.center === 'stitched') {
        // felt triangles with a running stitch just inside the edge
        const pts = [[0, 0], [Math.cos(a - Math.PI / n) * R, Math.sin(a - Math.PI / n) * R], [Math.cos(a + Math.PI / n) * R, Math.sin(a + Math.PI / n) * R]];
        const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
        const cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fill();
        const fab = texPattern(ctx, art.tex?.panel);
        if (fab) {
          ctx.globalCompositeOperation = 'multiply';
          ctx.globalAlpha = 0.4;
          ctx.fillStyle = fab;
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        for (const [px, py] of pts) ctx.lineTo(cx + (px - cx) * 0.78, cy + (py - cy) * 0.78);
        ctx.closePath();
        ctx.setLineDash([0.13, 0.09]);
        ctx.lineWidth = 0.045;
        ctx.strokeStyle = mix(color(s), '#3a2010', 0.4);
        ctx.stroke();
        ctx.restore();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(pts[1][0], pts[1][1]);
        ctx.lineTo(pts[2][0], pts[2][1]);
        ctx.closePath();
      }
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
    this.fast = this.particles.length > 0; // set when something needs smooth frames (see main.js)
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.size === 0 && this.lastCss) this.resize(this.lastCss); // a texture arrived: redraw
    this.busy = !!view.busy;
    if (this.theme.art?.under) this.drawUnder(this.theme.art.under, now);
    else ctx.drawImage(this.under, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
    if (this.theme.art?.fx && !this.lite) this.drawAmbience(this.theme.art, now);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.teamOf = view.teams || null;
    if (view.teams) this.drawTeamMarks(view);
    if (view.turn !== null && view.turn !== undefined) this.drawTurnGlow(view.turn, now);

    const placed = this.layout(view, now);
    this.lastLayout = placed;
    // Back to front (so nearer pawns overlap farther ones), with moving pawns on top.
    const order = [...placed].sort((p, q) => p.moving - q.moving || p.y - q.y);
    for (const p of order) this.drawPlaced(p, now);
    if (view.teams) this.drawTeamMarks(view, true);

    this.drawCenterDice(view.dice, now);
    this.drawParticles(now);
    this.drawEmotes(view.emotes, now);
  }

  layout(view, now) {
    const { board } = this;
    const groups = new Map();
    const items = [];
    // Two or more tokens of one colour on a track square make a pair, which is safe like a star
    const onTrack = (seat, p) => p >= 0 && p <= board.lastTrack;
    const counts = new Map();
    // (in team games a teammate's token counts too: view.teams is seat -> team)
    const side = (seat) => (view.teams ? view.teams[seat] : seat);
    for (const seat of view.active) {
      for (const p of view.tokens[seat]) {
        if (!onTrack(seat, p)) continue;
        const key = `${side(seat)}:${board.trackIndex(seat, p)}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const isSafe = (seat, p) => {
      if (!onTrack(seat, p)) return false;
      const idx = board.trackIndex(seat, p);
      return board.safe.has(idx) || counts.get(`${side(seat)}:${idx}`) >= 2;
    };
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
          safe: !o && isSafe(seat, progress),
          scale: 1,
          skin: view.skins[seat],
        };
        // The shield pops up when a token arrives on a safe square, so remember when that was
        const sk = `${seat}-${t}`;
        if (item.safe) {
          if (!this.shieldSince.has(sk)) this.shieldSince.set(sk, now);
          item.shieldAge = now - this.shieldSince.get(sk);
        } else this.shieldSince.delete(sk);
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
    const shield = p.safe && this.theme.art?.shield;
    const grow = shield ? easeOutBack(Math.min(1, p.shieldAge / 450)) : 0;
    if (p.moving || (shield && p.shieldAge < 450)) this.fast = true;
    if (shield) drawShield(ctx, shield, x, y + r * 0.2 - p.lift * s, r, hex, now / 1000, grow, 'back');
    drawToken(ctx, x, y, r, hex, p.skin, { lift: p.lift * s, squash: p.squash, sign: this.board.colors[p.seat] });
    // Colour-blind mode: the player's shape on the token's body (each shape has its own spot)
    if (this.cb) {
      const mark = TOKEN_MARKS[PAWN_STYLES[p.skin]?.shape || 'pawn'];
      const by = y + r * 0.2 - p.lift * s - r * mark.y * p.squash;
      drawShape(ctx, this.seatShape(p.seat), x + r * mark.x, by, r * 0.36 * mark.size, '#ffffff', '#111111', Math.max(1.2, r * 0.08));
    }
    if (shield) drawShield(ctx, shield, x, y + r * 0.2 - p.lift * s, r, hex, now / 1000, grow, 'front');
    // Team games: a small A/B badge at the foot of pins out on the board, so you can tell
    // a teammate's pin from a rival's at a glance
    const team = this.teamOf?.[p.seat];
    if (team >= 0 && (p.onBoard || p.moving)) {
      const br = Math.max(5.5, r * 0.36);
      teamBadge(ctx, x + r * 0.8, y + r * 0.45 - p.lift * s, br, team);
    }
  }

  // Team games: each base is outlined in its team's colour and labelled from your side of the
  // table (YOU / ALLY / RIVAL; "TEAM A" when you're watching).
  // (the outlines go under the pins, the labels over them so they always stay readable)
  drawTeamMarks(view, labels = false) {
    if (labels) return this.drawTeamLabels(view);
    const ctx = this.ctx;
    const s = this.cell;
    ctx.save();
    for (const seat of view.active) {
      const team = view.teams[seat];
      if (!(team >= 0)) continue;
      const b = this.board.bases[seat];
      // just inside the base's edge (the turn glow runs along the edge itself), with a dark line
      // under the colour instead of a blurred shadow: blur is costly on phones' GPUs
      const lw = Math.max(2.5, s * 0.13);
      const inset = 6 + lw;
      if (b.square) roundRect(ctx, this.px(b.x - b.size) + inset, this.px(b.y - b.size) + inset, b.size * 2 * s - inset * 2, b.size * 2 * s - inset * 2, s * 0.4);
      else circle(ctx, this.px(b.x), this.px(b.y), b.size * s - inset + 2);
      ctx.lineWidth = lw + 2.5;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.stroke();
      ctx.lineWidth = lw;
      ctx.strokeStyle = TEAM_COLORS[team];
      ctx.stroke();
    }
    ctx.restore();
  }

  drawTeamLabels(view) {
    const ctx = this.ctx;
    const s = this.cell;
    const mine = view.me >= 0 ? view.teams[view.me] : -1;
    ctx.save();
    for (const seat of view.active) {
      const team = view.teams[seat];
      if (!(team >= 0)) continue;
      const b = this.board.bases[seat];
      const col = TEAM_COLORS[team];
      // the label: along the outer edge of a square base; on the hexagon board, across the
      // bottom of the base's ring (off the track squares)
      const word = view.me < 0 ? `TEAM ${'AB'[team]}` : seat === view.me ? 'YOU' : team === mine ? 'ALLY' : 'RIVAL';
      let lx, ly;
      if (b.square) {
        lx = b.x;
        ly = b.y + Math.sign(b.y) * (b.size - 0.5);
      } else {
        lx = b.x;
        ly = b.y + b.size * 0.97;
      }
      const h = Math.max(13, s * 0.5);
      ctx.font = `800 ${Math.round(h * 0.62)}px system-ui, sans-serif`;
      const tw = ctx.measureText(word).width;
      const w = tw + h * 1.45;
      const cx = this.px(lx);
      const cy = this.px(ly);
      ctx.fillStyle = 'rgba(14, 18, 30, 0.82)';
      roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = col;
      ctx.stroke();
      teamBadge(ctx, cx - w / 2 + h * 0.5, cy, h * 0.36, team);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(word, cx - w / 2 + h * 0.95, cy + 0.5);
    }
    ctx.restore();
  }

  // A texture drifting slowly over the surface (water, lava…), in two layers going different
  // ways so it ripples. It only shows through the grout and the window panels. Blending two
  // board-sized patterns every frame at full resolution was the slowest thing on phones, so the
  // surface and its drift are composed into a small canvas (one pixel per CSS pixel), refreshed
  // about 20 times a second, and stretched into place each frame.
  drawUnder(spec, now) {
    const img = texture(spec.src, this);
    if (!img) {
      this.ctx.drawImage(this.under, 0, 0);
      return;
    }
    // Refreshing it is the heaviest thing a frame does, so it waits while the dice rolls or a pin
    // moves (view.busy): a hitch every few frames is what made those look jerky. The drift is slow
    // enough that a second's pause can't be seen.
    // Otherwise it refreshes about when the drift has moved a pixel: smooth, and far fewer than
    // 20 a second for the slow ones (ocean ~6, starry skies ~2)
    const every = Math.min(250, Math.max(50, 1000 / ((spec.speed || 0.1) * this.cell * 1.35)));
    const due = this.lite ? this.animAt === -Infinity : now - this.animAt >= (this.busy ? 1500 : every);
    if (due || now < this.animAt) {
      this.animAt = now;
      // Drawn on the CPU (willReadFrequently keeps this small canvas off the GPU): the blend modes
      // it uses make a GPU stop and copy what's under them for every fill, which is what made the
      // moving boards stutter; on the CPU they're quick at this size. One upload per refresh.
      const a = this.anim.getContext('2d', { willReadFrequently: true });
      const k = (this.cell * this.anim.width) / this.size; // board units → anim pixels
      const mid = this.anim.width / 2;
      const half = this.span / 2;
      const t = now / 1000;
      a.setTransform(1, 0, 0, 1, 0, 0);
      a.globalCompositeOperation = 'source-over';
      a.globalAlpha = 1;
      a.clearRect(0, 0, this.anim.width, this.anim.height);
      a.drawImage(this.under, 0, 0, this.anim.width, this.anim.height);
      a.setTransform(k, 0, 0, k, mid, mid);
      a.globalCompositeOperation = spec.blend || 'overlay';
      a.globalAlpha = spec.alpha ?? 0.5;
      const loop = spec.size * 4;
      const layers = spec.single ? [[1, 0.6, 1]] : [[1, 1, 0.6], [1.35, -0.8, 0.9]];
      // (patterns made once and moved each time: making one per refresh re-sent the whole
      // texture to the GPU every time, which was most of the cost on phones)
      if (this.animImg !== img) {
        this.animImg = img;
        this.animPats = layers.map(() => a.createPattern(img, 'repeat'));
      }
      for (const [li, [scale, dx, dy]] of layers.entries()) {
        const p = this.animPats[li];
        const sc = (spec.size * scale) / img.width;
        p.setTransform(new DOMMatrix([sc, 0, 0, sc, (t * spec.speed * dx) % loop, (t * spec.speed * dy) % loop]));
        a.fillStyle = p;
        a.fillRect(-half, -half, this.span, this.span);
      }
      // keep only the board's own shape (the drift was drawn over the whole square)
      a.setTransform(1, 0, 0, 1, 0, 0);
      a.globalAlpha = 1;
      a.globalCompositeOperation = 'destination-in';
      a.drawImage(this.under, 0, 0, this.anim.width, this.anim.height);
      a.globalCompositeOperation = 'source-over';
      // Stretched to full size here, once per refresh: stretching it every frame cost phones
      // as much as the rest of the board put together
      const f = this.animFull.getContext('2d');
      f.clearRect(0, 0, this.animFull.width, this.animFull.height);
      f.drawImage(this.anim, 0, 0, this.animFull.width, this.animFull.height);
    }
    this.ctx.drawImage(this.animFull, 0, 0);
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
    let kind = art.fx;
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
    if (kind === 'cosmos') {
      this.drawCosmos(t, half);
      kind = 'twinkle';
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

  // The Constellation board's moving sky (board units, set up by drawAmbience)
  drawCosmos(t, half) {
    const ctx = this.ctx;
    const { board } = this;
    // a zodiac ring turning slowly round the middle
    const R = board.hub * 0.98;
    ctx.save();
    ctx.translate(0, 0);
    ctx.rotate(t * 0.04);
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = 'rgba(240, 205, 120, 0.9)';
    ctx.lineWidth = 0.035;
    for (const rr of [R, R * 0.8]) {
      circle(ctx, 0, 0, rr);
      ctx.stroke();
    }
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      ctx.moveTo(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8);
      ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    ctx.stroke();
    ctx.fillStyle = '#fff1c2';
    for (let i = 0; i < 12; i++) {
      const a = ((i + 0.5) / 12) * TAU;
      circle(ctx, Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9, i % 3 ? 0.03 : 0.055);
      ctx.fill();
    }
    ctx.restore();
    // the token stars in each base breathe
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    board.bases.forEach((b, seat) => {
      const color = this.seatColor(seat);
      TOKEN_STARS.forEach(([ox, oy], i) => {
        const x = b.x + ox * board.baseSpread;
        const y = b.y + oy * board.baseSpread;
        const p = 0.5 + 0.5 * Math.sin(t * 1.6 + seat * 1.3 + i * 2.1);
        const r = (b.square ? 0.75 : 0.55) * (0.8 + 0.3 * p);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, hexA(color, 0.35 * p));
        g.addColorStop(1, hexA(color, 0));
        ctx.fillStyle = g;
        circle(ctx, x, y, r);
        ctx.fill();
      });
    });
    // now and then a shooting star
    const every = 6.5;
    const n = Math.floor(t / every);
    const ph = (t % every) / 0.9;
    if (ph < 1) {
      const sx = -half + rnd(n * 7 + 1) * this.span * 0.7;
      const sy = -half + rnd(n * 7 + 2) * this.span * 0.4;
      const len = 3.2;
      const x = sx + ph * 5;
      const y = sy + ph * 2.6;
      const g = ctx.createLinearGradient(x - len, y - len * 0.52, x, y);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, `rgba(255, 248, 220, ${0.9 * Math.sin(ph * Math.PI)})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 0.06;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - len, y - len * 0.52);
      ctx.lineTo(x, y);
      ctx.stroke();
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
    } else if (d.mode === 'spin' && d.waiting) {
      // Rolled, the answer not back yet: tumble on at the speed a roll starts with
      // (main.js picks up from this exact angle when the result arrives)
      const left = 1 - (3 * d.t) / SPIN_MS;
      const [ax, ay] = d.axes;
      spin = mul(rotX(ax * TAU * left), rotY(ay * TAU * left));
      tilt = 1;
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
      sign: d.sign,
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
      drawDice(ctx, x, y, small, g.value, d.style, { color: d.color, sign: d.sign });
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
export function drawToken(ctx, x, y, r, hex, skin, { lift = 0, squash = 1, sign = 'red' } = {}) {
  const gy = y + r * 0.2; // the pawn's base sits on the centre of its square
  const shrink = 1 - Math.min(0.45, lift / (r * 4));
  ctx.beginPath();
  ctx.ellipse(x, gy, r * 0.95 * shrink, r * 0.4 * shrink, 0, 0, TAU);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fill();

  ctx.save();
  ctx.translate(x, gy - lift);
  ctx.scale(1 / squash, squash);
  paintPawn(ctx, r, hex, PAWN_STYLES[skin] || PAWN_STYLES['token-classic'], sign);
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
  // The player's zodiac sign: a ram for red, a bull for green, a crab for blue…
  'token-constellation': { shape: 'zodiac' },
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
  zodiac: { y: 0.62, x: -0.15, size: 0.75 },
};

const GOLD = '#f6cf57';
const GOLD_DARK = '#9a6f00';

// A pawn drawn upwards from (0, 0): base disc, tapered body, collar and round head.
function paintPawn(ctx, r, hex, style, sign) {
  if (style.shape) return TOKEN_SHAPES[style.shape](ctx, r, hex, sign);
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
  // The player's zodiac animal in their colour, edged in gold, on a starry navy plinth
  zodiac(ctx, r, hex, sign) {
    // the plinth
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.05, r * 0.92, r * 0.34, 0, 0, Math.PI);
    ctx.lineTo(-r * 0.92, -r * 0.24);
    ctx.ellipse(0, -r * 0.24, r * 0.92, r * 0.34, 0, Math.PI, TAU);
    ctx.closePath();
    ctx.fillStyle = cylinder(ctx, r * 0.92, '#1a2260');
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.strokeStyle = '#d9b25a';
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.24, r * 0.92, r * 0.34, 0, 0, TAU);
    const top = ctx.createRadialGradient(-r * 0.2, -r * 0.3, 0, 0, -r * 0.24, r);
    top.addColorStop(0, '#3a4aa8');
    top.addColorStop(1, '#0d1240');
    ctx.fillStyle = top;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff3c4';
    for (const [sx, sy] of [[-0.5, -0.26], [0.45, -0.18], [0.1, -0.4]]) {
      circle(ctx, sx * r, sy * r, r * 0.035);
      ctx.fill();
    }
    // the animal, standing on it
    const z = zodiacPath(sign);
    const sc = (r * 2.1) / 100;
    ctx.save();
    ctx.translate(-50 * sc, -r * 0.3 - 92 * sc);
    ctx.scale(sc, sc);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const g = ctx.createLinearGradient(0, 10, 0, 92);
    g.addColorStop(0, mix(hex, '#ffffff', 0.35));
    g.addColorStop(1, mix(hex, '#000000', 0.25));
    // horns, claws and tails first, thick in the player's colour so they read as part of the body
    ctx.lineWidth = 7;
    ctx.strokeStyle = mix(hex, '#000000', 0.35);
    ctx.stroke(z.lines);
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = mix(hex, '#ffffff', 0.15);
    ctx.stroke(z.lines);
    ctx.fillStyle = g;
    ctx.fill(z.body);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#e9c46a';
    ctx.stroke(z.body);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#fff1c2';
    ctx.stroke(z.lines);
    ctx.restore();
  },
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
function diceStyle(styleId, color, sign) {
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
// How the pips of each face are joined when a dice draws them as a constellation
const PIP_LINKS = {
  1: [],
  2: [[0, 1]],
  3: [[0, 1], [1, 2]],
  4: [[0, 1], [1, 3], [3, 2]],
  5: [[0, 2], [2, 1], [2, 3], [3, 4]],
  6: [[0, 2], [2, 4], [4, 5], [5, 3], [3, 1]],
};

const PIP_STYLES = {
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
  // Paw prints (cat)
  paw(ctx, x, y, r, st) {
    pawPrint(ctx, x, y, r * 1.15, st.pip);
  },
};

// Draws a flat dice centred on (cx, cy) showing one face. `value` null shows "?".
export function drawDice(ctx, cx, cy, size, value, styleId, { alpha = 1, glow = null, color = null, sign = null, t = performance.now() } = {}) {
  const st = diceStyle(styleId, color, sign);
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
function drawDiceCube(ctx, cx, cy, size, value, styleId, { spin = IDENTITY, tilt = 1, alpha = 1, glow = null, color = null, sign = null, t = performance.now() } = {}) {
  const st = diceStyle(styleId, color, sign);
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
// Which way tokens travel through a square, as a turn from the square's own frame (whose +x
// points out along its arm): out along lane -1, across the end, back in along lane +1, and in
// towards the middle on a home column.
function routeTurn(sq, home) {
  if (home) return Math.PI;
  const lane = -Math.sin(sq.angle) * sq.x + Math.cos(sq.angle) * sq.y;
  if (Math.abs(lane) < 0.3) return Math.PI / 2; // the square across the end of the arm
  return lane < 0 ? 0 : Math.PI;
}

// role: 'cell', 'safe', 'start' or 'home'; turn: the route's direction (see routeTurn)
function drawTile(ctx, sq, fill, style, theme, role = 'cell', turn = 0) {
  ctx.save();
  ctx.translate(sq.x, sq.y);
  ctx.rotate(sq.angle);
  ctx.fillStyle = fill;
  roundRect(ctx, -0.45, -0.45, 0.9, 0.9, 0.12);
  ctx.fill();
  const spec = theme?.art?.tex?.tile;
  // (only on plain squares: player-coloured ones keep their colour clean)
  const tex = fill === theme?.cell || fill === theme?.safe ? texPattern(ctx, spec) : null;
  if (tex) {
    ctx.save();
    ctx.globalCompositeOperation = spec.blend || 'multiply';
    ctx.globalAlpha = spec.alpha ?? 0.5;
    ctx.fillStyle = tex;
    ctx.fill();
    ctx.restore();
  }
  if (style) TILE_STYLES[style]?.(ctx, fill, theme, rnd(sq.x * 7.3 + sq.y * 3.1), role, turn);
  ctx.restore();
}

let tileK = 1; // pixels per board unit while the board is drawn (for glows)

// ---------- zodiac figures ----------
// The animals of the Constellation set, as line art in a 100×100 box, facing right, feet on
// y = 92. body: one closed outline (filled on tokens); lines: the rest (horns, claws, legs…).
const ZODIAC = {
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
const zodiacPaths = new Map(); // made on first use (Path2D only exists in the browser)
function zodiacPath(sign) {
  if (!zodiacPaths.has(sign)) {
    const z = ZODIAC[sign] || ZODIAC.red;
    zodiacPaths.set(sign, { body: new Path2D(z.body), lines: new Path2D(z.lines) });
  }
  return zodiacPaths.get(sign);
}

// A zodiac animal outlined in light, centred on (x, y), `w` wide (Constellation board, dice)
function zodiacOutline(ctx, sign, x, y, w, color, lineWidth, glow) {
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

// ---------- constellation board ----------
// Each base holds its player's constellation, and four of its stars are where the tokens wait.
// Star positions are in "spread" units: the token stars are always the first four, at (±1, ±1)
// (top-left, top-right, bottom-left, bottom-right); [x, y, size] for the rest. Lines join stars by index.
const CONSTELLATIONS = {
  // Aries, the ram: a long bent line of stars
  red: { stars: [[-1.75, 0.25, 0.8], [1.7, -1.6, 0.9], [1.55, 0.05, 0.7]], lines: [[4, 2], [2, 0], [0, 1], [1, 5], [1, 6], [6, 3]] },
  // Taurus, the bull: the V of its face round bright Aldebaran, and two long horns
  green: { stars: [[0, 0.1, 1.5], [-1.75, -1.7, 0.9], [1.75, -1.55, 0.9], [0.3, 1.75, 0.6]], lines: [[2, 4], [4, 3], [4, 0], [0, 5], [4, 1], [1, 6], [3, 7]] },
  // Cancer, the crab: its upside-down Y, with a claw curling up each side
  blue: { stars: [[0, 0.3, 1.1], [0, -1.65, 0.9], [-1.75, 0.15, 0.8], [1.75, 0.15, 0.8]], lines: [[5, 4], [4, 2], [4, 3], [2, 6], [6, 0], [3, 7], [7, 1]] },
  // Leo, the lion: the sickle of its mane down to Regulus, its body, and its tail
  yellow: { stars: [[-0.35, -1.75, 0.8], [-1.72, -1.5, 0.8], [-1.72, 0, 0.8], [1.75, 1.7, 0.9]], lines: [[4, 5], [5, 0], [0, 6], [6, 2], [0, 1], [1, 3], [3, 2], [3, 7]] },
  // Scorpius: claws, red Antares at its heart, and the curling tail
  purple: { stars: [[-1.7, -1.5, 0.8], [-0.05, -0.25, 1.4], [1.65, -1.7, 0.8], [-0.35, 1.75, 0.7], [0.55, 1.7, 0.7]], lines: [[4, 0], [0, 5], [5, 1], [1, 6], [5, 2], [2, 7], [7, 8], [8, 3]] },
  // Sagittarius: the teapot, with its handle, lid and spout
  orange: { stars: [[-1.75, 0, 0.8], [0, -1.7, 0.8], [1.75, 1.55, 0.9]], lines: [[0, 1], [1, 3], [3, 2], [2, 0], [0, 4], [4, 2], [0, 5], [5, 1], [3, 6]] },
};
const TOKEN_STARS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

function constellationStars(name, b, spread) {
  const c = CONSTELLATIONS[name] || CONSTELLATIONS.red;
  const pts = [...TOKEN_STARS.map(([x, y]) => [x, y, 0]), ...c.stars];
  return { c, pts: pts.map(([x, y, sz]) => ({ x: b.x + x * spread, y: b.y + y * spread, sz })) };
}

// The constellation inside a base's window: a nebula in the player's colour, glowing lines,
// small stars, and the four big stars the tokens sit on. (r: a token star's radius, inner: the
// window's half-size)
function drawConstellation(ctx, b, spread, r, color, name, inner, k) {
  const { c, pts } = constellationStars(name, b, spread);
  ctx.save();
  // the nebula
  for (const [ox, oy, rr, a] of [[0, 0, 1.1, 0.5], [-0.35, 0.3, 0.6, 0.35], [0.4, -0.35, 0.55, 0.3]]) {
    const gx = b.x + ox * inner;
    const gy = b.y + oy * inner;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, inner * rr);
    g.addColorStop(0, hexA(color, a));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(b.x - inner, b.y - inner, inner * 2, inner * 2);
  }
  // the animal itself, drawn in faint light behind its stars
  zodiacOutline(ctx, name, b.x, b.y, inner * 1.85, hexA(mix(color, '#ffffff', 0.6), 0.62), inner * 0.026, color);
  // the lines
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 0.25 * k;
  ctx.lineWidth = r * 0.12;
  ctx.strokeStyle = hexA(mix(color, '#ffffff', 0.55), 0.75);
  ctx.beginPath();
  for (const [i, j] of c.lines) {
    ctx.moveTo(pts[i].x, pts[i].y);
    ctx.lineTo(pts[j].x, pts[j].y);
  }
  ctx.stroke();
  // the small stars
  pts.slice(4).forEach((p) => {
    ctx.shadowBlur = 0.3 * k;
    ctx.shadowColor = '#ffffff';
    ctx.fillStyle = '#fffaf0';
    circle(ctx, p.x, p.y, r * 0.18 * p.sz);
    ctx.fill();
  });
  // the token stars: a glow in the player's colour, a white-hot middle and a twinkle
  for (const p of pts.slice(0, 4)) {
    ctx.shadowBlur = 0;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.9);
    g.addColorStop(0, hexA(mix(color, '#ffffff', 0.5), 0.95));
    g.addColorStop(0.35, hexA(color, 0.6));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    circle(ctx, p.x, p.y, r * 1.9);
    ctx.fill();
    ctx.lineWidth = r * 0.1;
    ctx.strokeStyle = hexA(mix(color, '#ffffff', 0.6), 0.9);
    circle(ctx, p.x, p.y, r);
    ctx.stroke();
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 0.3 * k;
    sparkle(ctx, p.x, p.y, r * 0.75, '#ffffff');
  }
  ctx.restore();
}

// '#rrggbb' (or mix()'s 'rgb(…)') with an alpha, as rgba()
function hexA(hex, a) {
  if (hex.startsWith('rgb(')) return hex.replace('rgb(', 'rgba(').replace(')', `, ${a})`);
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- safe-square shields ----------
// A token standing on a safe square is wrapped in a shield in the board's theme (art.shield):
// a bubble in the ocean, a ring of fire on lava, a frost crystal on ice… Each is drawn in two
// halves, 'back' before the token and 'front' after it, round a pawn whose base sits at (x, gy).
// The pawn is about 2.1r tall. t: seconds, k: 0..1 as the shield pops up.
function drawShield(ctx, spec, x, gy, r, hex, t, k, part) {
  if (k <= 0) return;
  const kind = typeof spec === 'string' ? spec : spec.kind;
  ctx.save();
  SHIELDS[kind]?.(ctx, spec, x, gy, r, hex, t, k, part);
  ctx.restore();
}

// The dome that fits round a pawn
const dome = (x, gy, r, k) => ({ cx: x, cy: gy - r * 0.92, rx: r * 1.18 * k, ry: r * 1.42 * k });

// Little things circling a token: 'back' draws the ones behind it, 'front' the rest
function orbiters(ctx, part, n, x, cy, rx, ry, t, speed, draw) {
  for (let i = 0; i < n; i++) {
    const a = t * speed + (i / n) * TAU;
    const behind = Math.sin(a) < 0;
    if (behind !== (part === 'back')) continue;
    draw(x + Math.cos(a) * rx, cy + Math.sin(a) * ry, i, 0.75 + 0.25 * Math.sin(a));
  }
}

// A soft glow behind the token
function aura(ctx, x, gy, r, k, color) {
  const d = dome(x, gy, r, k);
  const g = ctx.createRadialGradient(d.cx, d.cy, 0, d.cx, d.cy, d.ry * 1.05);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(d.cx, d.cy, d.rx * 1.05, d.ry * 1.05, 0, 0, TAU);
  ctx.fill();
}

const SHIELDS = {
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
      const g = ctx.createLinearGradient(px, py, px, py - h);
      g.addColorStop(0, 'rgba(255, 70, 10, 0.9)');
      g.addColorStop(0.45, 'rgba(255, 150, 30, 0.85)');
      g.addColorStop(1, 'rgba(255, 240, 150, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(px - w, py);
      ctx.quadraticCurveTo(px - w, py - h * 0.55, px + sway, py - h);
      ctx.quadraticCurveTo(px + w, py - h * 0.55, px + w, py);
      ctx.closePath();
      ctx.fill();
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

// A four-pointed twinkle
function sparkle(ctx, x, y, s, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.fill();
}

// ---------- board textures ----------
// Image textures (client/public/textures, made by tools/textures) load once and are shared.
// A board drawn before its textures arrive is redrawn when they do.
const TEXTURES = new Map(); // src -> { img, ready, waiting: Set of renderers }
let drawingFor = null; // the renderer whose board is being drawn

function texture(src, renderer = drawingFor) {
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
function texPattern(ctx, spec) {
  if (!spec) return null;
  const img = texture(spec.src);
  if (!img) return null;
  const p = ctx.createPattern(img, 'repeat');
  const sc = spec.size / img.width;
  p.setTransform(new DOMMatrix([sc, 0, 0, sc, 0, 0]));
  return p;
}

// Each is drawn over a tile already filled, in the tile's own frame (-0.45..0.45), path still set.
const TILE_STYLES = {
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
  else if (style === 'celestial') ctx.fillStyle = 'rgba(8, 10, 40, 0.55)';
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
function innerPanel(ctx, theme, x, y, r, color, square = true) {
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
function motif(ctx, kind, x, y, s, color) {
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

// Team A gold, team B blue (the same as the A/B badges in the player list)
const TEAM_COLORS = ['#ffc83a', '#5c9dff'];
function teamBadge(ctx, x, y, r, team) {
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
// Soft dents in a cushion where the pins sit
function drawDents(ctx, b, spread, r) {
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
function catDecor(ctx, x, y, outer, color, k) {
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

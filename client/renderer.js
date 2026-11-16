// Draws the board, tokens, dice and effects on a <canvas>.
// Board positions come in board units (one square = 1, centre = 0,0); see shared/board.js.
import { DECOR, HUBS, SPOTS, TOKEN_STARS, baseDecor, drawConstellation, drawShield, drawSpots, cutSpots, drawTile, gemYard, innerPanel, motif, paintBase, routeTurn, setDrawingFor, setTileK, texPattern, texture } from './draw-board.js';
import { drawDice, drawDiceCube } from './draw-dice.js';
import { PAWN_STYLES, TOKEN_MARKS, drawToken, glowSprite } from './draw-tokens.js';
import { IDENTITY, TAU, TEAM_COLORS, catDecor, circle, drawDents, drawPinSpots, drawShape, easeInOut, easeOutBack, easeOutCubic, emoteImg, hexA, inkOn, mix, mul, path, rnd, rotX, rotY, roundRect, sparkle, teamBadge } from './draw-util.js';
import { BOARD_THEMES, SHAPES, TOKEN_SIGNATURES, cbColor, colorBlindMode } from './skins.js';
import { currentLanguage, t } from './i18n.js';
import { TAUNT_FX, word } from './taunts.js';
import { drawSceneFx, litBoard, pieceShadow, sceneSwitch } from './scene.js';

// Taunts are drawn bigger than a square: they're meant to be in your face
const TAUNT_SCALE = 1.5;

export const SPIN_MS = 600;
export const LEAVE_MS = 260;
export const EMOTE_MS = 2400;

// The drifting-texture layer's resolution, in pixels per CSS pixel (see refreshUnder).
export let ANIM_SCALE = 0.6;
export const setAnimScale = (k) => (ANIM_SCALE = k);

// The six-player board's outline: the outer corners of every arm, a little grout beyond them.
// (It is stroked HEX_EDGE wide, so it reaches half that further out.)
const HEX_EDGE = 0.3;
// Board units of border beyond the outermost squares, on every side
const TOKEN_HEADROOM = 0.55;
function hexOutline(board) {
  const r = board.hub + 6 + 0.12;
  const pts = [];
  for (let s = 0; s < board.arms; s++) {
    const a = board.armAngle(s);
    for (const v of [-1.62, 1.62]) pts.push([Math.cos(a) * r - Math.sin(a) * v, Math.sin(a) * r + Math.cos(a) * v]);
  }
  return pts;
}

// How far from the middle the board's drawing goes (board units), so the canvas fits all of it.
// The square board fills its own extent (its frame is drawn inside it); the hexagon board's
// outline pokes out past its squares and yards, so measure that instead (the canvas used to
// slice its left and right points off flat).
function boardReach(board) {
  if (board.arms === 4) return board.extent;
  const out = Math.max(...hexOutline(board).map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
  return Math.max(board.extent, out + HEX_EDGE / 2);
}

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
    // Three layers, each redrawn only when its own content changes (see splitLayers):
    this.back = null; // the board itself: drawn once, or when its moving surface moves on
    this.fx = null; // the theme's one living effect (snow, fireflies…), on its own clock
    this.backDirty = true;
    this.fxAt = -Infinity;
    this.particles = [];
    this.lastNow = 0;
    this.shieldSince = new Map(); // "seat-token" -> when it stepped onto a safe square
  }

  setBoard(board, themeId) {
    const theme = BOARD_THEMES[themeId] || BOARD_THEMES['board-classic'];
    const cb = colorBlindMode() === 'off' ? false : colorBlindMode();
    if (board === this.board && theme === this.theme && cb === this.cb) return;
    this.board = board;
    this.theme = theme;
    this.cb = cb; // colour-blind mode (its name, or false): safe colours plus a shape for each player
    this.size = 0; // redraw the static layer on the next resize()
  }

  // In a game the board is three canvases stacked: the board, its effect, and the pieces (this
  // renderer's own canvas, on top). Rolling the dice or moving a pin then repaints only the
  // pieces: the board underneath isn't touched, and its effect keeps its own steady pace whatever
  // the game is doing. Previews (the shop, the menu) skip this and draw everything on one canvas.
  splitLayers() {
    if (this.back) return;
    const make = () => {
      const c = document.createElement('canvas');
      c.className = 'board-layer';
      c.setAttribute('aria-hidden', 'true');
      this.canvas.before(c);
      return c;
    };
    this.back = make();
    this.fx = make();
    this.size = 0;
  }

  // The size on the page of every layer (the pixels stay as they are: see main.js, which
  // stretches the board while its box is still changing size).
  setCssSize(px) {
    for (const c of [this.canvas, this.back, this.fx]) {
      if (c && c.style.width !== `${px}px`) c.style.width = c.style.height = `${px}px`;
    }
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
    this.fxAt = -Infinity;
    this.size = 0; // redraw at the new sharpness (Low draws at 1.5×)
  }

  // A seat's colour on this board (the colour-blind palette when that's on).
  seatColor(seat) {
    const name = this.board.colors[seat];
    return (this.cb && cbColor(name)) || this.theme.players[name];
  }

  seatShape(seat) {
    return SHAPES[this.board.colors[seat]];
  }

  resize(cssSize) {
    // Phones report 3× pixel density; drawing at 2× looks the same on a board this size and is
    // well under half the pixels to fill every frame.
    // Low graphics: 1.5× (about 44% fewer pixels to fill each frame than 2×).
    const dpr = Math.min(this.lite ? 1.5 : 2, window.devicePixelRatio || 1);
    const size = Math.floor(cssSize);
    if (size === this.size && dpr === this.dpr) return;
    this.size = size;
    this.dpr = dpr;
    // (+ room above the top row: a standing token is taller than its square, and its head used to
    // be cut off by the canvas edge there)
    this.span = boardReach(this.board) * 2 + 0.3 + 2 * TOKEN_HEADROOM;
    this.cell = size / this.span;
    this.lastCss = cssSize;
    for (const c of [this.canvas, this.layer, this.under, this.animFull, this.back]) {
      if (!c) continue;
      c.width = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
    }
    if (this.fx) {
      // the effect is soft, moving specks: three quarters of the sharpness is plenty
      this.fxScale = Math.max(1, dpr * 0.75);
      this.fx.width = this.fx.height = Math.round(size * this.fxScale);
    }
    this.setCssSize(size);
    this.fxAt = -Infinity;
    this.anim.width = Math.round(size * ANIM_SCALE); // the drifting textures are soft anyway
    this.anim.height = this.anim.width;
    this.animAt = -Infinity;
    this.animReady = false;
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
    setDrawingFor(this); // textures that are still loading redraw this board when they arrive
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
      for (const [x, y] of hexOutline(board)) bg.lineTo(x, y);
      bg.closePath();
      bg.lineJoin = 'round';
      bg.lineWidth = HEX_EDGE;
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
    setTileK(k); // tiles that glow need to know how big a board unit is in pixels

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
        if (art.yardGem) gemYard(ctx, b.x, b.y, inner * 0.94, color(seat), this.board.colors[seat]);
        if (art.pins === 'constellation') drawConstellation(ctx, b, board.baseSpread, 0.4, color(seat), this.board.colors[seat], inner, k);
        else if (art.pins === 'dents') drawDents(ctx, b, board.baseSpread, 0.6);
        else if (art.pins === 'cut') cutSpots(ctx, b, board.baseSpread, 0.66, color(seat), this.board.colors[seat]);
        else if (SPOTS[art.pins]) drawSpots(ctx, art.pins, b, board.baseSpread, 0.62, color(seat));
        else drawPinSpots(ctx, b, board.baseSpread, 0.62, color(seat));
        if (art.decor === 'cat') catDecor(ctx, b.x, b.y, outer, color(seat), k);
        else if (DECOR[art.decor]) baseDecor(ctx, art.decor, b.x, b.y, outer, inner, color(seat));
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
        if (art.yardGem) gemYard(ctx, b.x, b.y, b.size * 0.72, color(seat), this.board.colors[seat]); // (smaller: a round yard)
        if (art.pins === 'constellation') drawConstellation(ctx, b, board.baseSpread, 0.3, color(seat), this.board.colors[seat], b.size, k);
        else if (art.pins === 'dents') drawDents(ctx, b, board.baseSpread, 0.42);
        else if (art.pins === 'cut') cutSpots(ctx, b, board.baseSpread, 0.46, color(seat), this.board.colors[seat]);
        else if (SPOTS[art.pins]) drawSpots(ctx, art.pins, b, board.baseSpread, 0.42, color(seat));
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
      if (art.center === 'jewel') {
        // Crystal: dark marble in the middle, each wedge's colour only as a glowing edge where
        // its home column comes in
        ctx.fillStyle = '#18181e';
        ctx.fill();
        const surf = texPattern(ctx, art.tex?.surface);
        if (surf) {
          ctx.save();
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = surf;
          ctx.fill();
          ctx.restore();
        }
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - Math.PI / n) * R, Math.sin(a - Math.PI / n) * R);
        ctx.lineTo(Math.cos(a + Math.PI / n) * R, Math.sin(a + Math.PI / n) * R);
        ctx.shadowColor = color(s);
        ctx.shadowBlur = 0.3 * k;
        ctx.lineWidth = 0.1;
        ctx.strokeStyle = color(s);
        ctx.stroke();
        ctx.restore();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a - Math.PI / n) * R, Math.sin(a - Math.PI / n) * R);
        ctx.lineTo(Math.cos(a + Math.PI / n) * R, Math.sin(a + Math.PI / n) * R);
        ctx.closePath();
      } else if (art.base === 'outline' || art.base === 'rock') {
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
    // The theme's emblem in the very middle, where the dice lands
    if (HUBS[art.hub]) {
      ctx.save();
      HUBS[art.hub](ctx, n === 4 ? board.hub * 0.56 : 1.12, theme);
      ctx.restore();
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
    this.backDirty = true;
  }

  // The board and its effect, each on its own clock. Called every frame from the game loop (and
  // by draw() for one-canvas previews); most calls do nothing at all.
  //  - the board is repainted only when it changes: once, or (boards whose surface moves) each
  //    time the surface has drifted about a pixel, a few times a second
  //  - the effect is repainted about 30 times a second, on a canvas of its own that holds
  //    nothing else
  // Neither looks at what the game is doing, so a roll or a move can't disturb them.
  // Scene lighting (scene.js) for themes that ask for it: the finished board, lit, with the
  // images its moving effect needs. null when the theme has none, lighting is switched off
  // (Settings), or the device is in lite mode.
  litScene() {
    const art = this.theme.art || {};
    if (!art.scene || art.under || !sceneSwitch.on || this.lite || !this.size || !this.layer.width) return null;
    if (!this.lit) {
      const flat = document.createElement('canvas');
      flat.width = flat.height = this.layer.width;
      const fg = flat.getContext('2d');
      fg.drawImage(this.under, 0, 0);
      fg.drawImage(this.layer, 0, 0);
      this.lit = litBoard(flat, this.dpr * this.cell, (this.dpr * this.size) / 2, this.span / 2);
    }
    return this.lit;
  }

  drawBackground(now) {
    if (!this.back) return;
    if (this.size === 0 && this.lastCss) this.resize(this.lastCss); // a texture arrived: redraw
    if (!this.size) return;
    const art = this.theme.art || {};
    const moved = art.under ? this.refreshUnder(art.under, now) : false;
    if (this.sceneVer !== sceneSwitch.version) {
      // lighting was switched on or off
      this.sceneVer = sceneSwitch.version;
      this.lit = null;
      this.backDirty = true;
    }
    if (this.backDirty) this.lit = null; // the board was repainted
    const lit = this.litScene();
    if (this.backDirty || moved) {
      this.backDirty = false;
      const b = this.back.getContext('2d');
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.clearRect(0, 0, this.back.width, this.back.height);
      if (lit) b.drawImage(lit.canvas, 0, 0);
      else {
        b.drawImage(art.under && this.animReady ? this.animFull : this.under, 0, 0);
        b.drawImage(this.layer, 0, 0);
      }
    }
    const live = art.fx && !this.lite;
    if (!live) {
      if (this.fxLive !== false) {
        this.fxLive = false;
        this.fx.getContext('2d').clearRect(0, 0, this.fx.width, this.fx.height);
      }
      return;
    }
    if (now - this.fxAt < 32 && now >= this.fxAt) return;
    this.fxAt = now;
    this.fxLive = true;
    const f = this.fx.getContext('2d');
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, this.fx.width, this.fx.height);
    if (lit) drawSceneFx(f, lit, this.fxScale * this.cell, this.fx.width / 2, this.span / 2, now, this.fx.width);
    else this.drawAmbience(f, this.fxScale * this.cell, this.fx.width / 2, art, now);
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
    this.fast = this.particles.length > 0 || this.taunts?.length > 0 || this.callouts?.length > 0; // set when something needs smooth frames (see main.js)
    // (in a game, a taunt's mark on someone's base lasts until it is their turn)
    if (this.marksFollowTurns && view.turn !== this.lastTurn) {
      if (view.turn == null) this.tauntMarks?.clear();
      else this.clearTauntMark(view.turn);
      this.lastTurn = view.turn;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.size === 0 && this.lastCss) this.resize(this.lastCss); // a texture arrived: redraw
    if (this.back) this.drawBackground(now); // (its own clocks decide whether anything is painted)
    else {
      // one canvas: the board, then its effect, then the pieces
      const art = this.theme.art || {};
      if (art.under) this.refreshUnder(art.under, now);
      if (this.sceneVer !== sceneSwitch.version || this.backDirty) {
        this.sceneVer = sceneSwitch.version;
        this.backDirty = false;
        this.lit = null;
      }
      const lit = this.litScene();
      if (lit) {
        ctx.drawImage(lit.canvas, 0, 0);
        drawSceneFx(ctx, lit, this.dpr * this.cell, (this.dpr * this.size) / 2, this.span / 2, now, this.canvas.width);
      } else {
        ctx.drawImage(art.under && this.animReady ? this.animFull : this.under, 0, 0);
        ctx.drawImage(this.layer, 0, 0);
        if (art.fx && !this.lite) this.drawAmbience(ctx, this.dpr * this.cell, (this.dpr * this.size) / 2, art, now);
      }
    }
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
    this.drawParty(now);
    this.drawParticles(now);
    this.drawTaunts(now);
    this.drawCallouts(now);
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
          fade: o?.alpha ?? 1,
          grow: o?.scale ?? 1,
          hl,
          moving: o ? 1 : 0,
          onBoard: !o && progress >= 0,
          safe: !o && isSafe(seat, progress),
          target: !o && view.target === seat && onTrack(seat, progress),
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
    const r = s * 0.4 * p.scale * (p.grow ?? 1) * (p.moving ? 1.1 : 1);
    if (r < 0.5 || p.fade <= 0.01) return; // (vanished for a moment: see TOKEN_SIGNATURES)
    if (p.target) {
      // a red crosshair turning slowly round the token of whoever last captured you
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(now / 1400);
      const R = s * 0.62;
      ctx.strokeStyle = 'rgba(255, 60, 70, 0.9)';
      ctx.lineWidth = Math.max(1.5, s * 0.07);
      ctx.setLineDash([R * 0.5, R * 0.28]);
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i * TAU) / 4;
        ctx.moveTo(Math.cos(a) * R * 0.75, Math.sin(a) * R * 0.75);
        ctx.lineTo(Math.cos(a) * R * 1.25, Math.sin(a) * R * 1.25);
      }
      ctx.stroke();
      ctx.restore();
    }
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
    if (p.fade < 1) ctx.globalAlpha = p.fade;
    if (this.lit && this.theme.art?.scene && sceneSwitch.on && !this.lite) pieceShadow(ctx, x, y - p.lift * s * 0.3, r); // lit boards: a long shadow, like the trees'
    drawToken(ctx, x, y, r, hex, p.skin, { lift: p.lift * s, squash: p.squash, sign: this.board.colors[p.seat], t: this.lite ? null : now });
    ctx.globalAlpha = 1;
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
  // Returns true when it repainted (so whoever shows it knows to copy it again).
  refreshUnder(spec, now) {
    const img = texture(spec.src, this);
    if (!img) {
      this.animReady = false;
      return false;
    }
    // It refreshes about when the drift has moved a pixel: smooth, and only a few times a second
    // (lava ~4, water ~6). Always at that pace: it never waits for, or hurries with, the game.
    // A surface that doesn't move (speed 0, or Low graphics) is blended just once.
    const still = this.lite || !spec.speed;
    const every = Math.min(250, Math.max(50, 1000 / ((spec.speed || 0.1) * this.cell * 1.35)));
    const due = !this.animReady || (!still && (now - this.animAt >= every || now < this.animAt));
    if (due) {
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
      this.animReady = true;
      return true;
    }
    return false;
  }

  // The theme's living layer, under the tokens: snow, embers, bubbles, fireflies, twinkles…
  // Every particle is worked out from the time alone, so there's nothing to keep track of.
  drawAmbience(ctx, k, mid, art, now) {
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
    if (kind === 'sheen') {
      // Royal: a band of golden light gliding corner to corner across the marble, then a pause
      const ph = (t % 7) / 3.2;
      if (ph < 1) {
        const d = (-1.25 + ph * 2.5) * this.span;
        const g = ctx.createLinearGradient(d - 1.6, d - 1.6, d + 1.6, d + 1.6);
        g.addColorStop(0, 'rgba(255, 226, 140, 0)');
        g.addColorStop(0.5, `rgba(255, 236, 170, ${(0.3 * Math.sin(ph * Math.PI)).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255, 226, 140, 0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.fillRect(-half, -half, this.span, this.span);
      }
      ctx.restore();
      return;
    }
    if (kind === 'mist') {
      // Midnight: a few wide, pale banks of mist wandering slowly across the slate
      const puff = glowSprite('mist', [[0, 'rgba(206, 214, 255, 0.5)'], [0.5, 'rgba(190, 200, 250, 0.2)'], [1, 'rgba(190, 200, 250, 0)']]);
      for (let i = 0; i < n; i++) {
        const c = rnd(i * 4 + 3);
        const w = 4.5 + c * 3.5;
        const x = wrap(-half + rnd(i * 4 + 1) * this.span + t * (0.1 + c * 0.14)) * 1.25;
        const y = -half + rnd(i * 4 + 2) * this.span + Math.sin(t * 0.12 + i * 1.7) * 0.6;
        ctx.globalAlpha = 0.16 + 0.1 * Math.sin(t * 0.25 + i * 2.3);
        ctx.drawImage(puff, x - w / 2, y - w * 0.28, w, w * 0.56);
      }
      ctx.restore();
      return;
    }
    if (kind === 'cosmos') {
      this.drawCosmos(ctx, t, half);
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
        // every flake goes into one path, filled once after the loop
        const y = wrap(y0 + t * (0.35 + c * 0.4));
        const x = x0 + Math.sin(t * (0.6 + c) + i) * 0.35;
        const fr = 0.05 + c * 0.07;
        if (i === 0) ctx.beginPath();
        ctx.moveTo(x + fr, y);
        ctx.arc(x, y, fr, 0, TAU);
        if (i === n - 1) {
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
      } else if (kind === 'embers') {
        const y = wrap(y0 - t * (0.5 + c * 0.6));
        const x = x0 + Math.sin(t * 1.3 + i) * 0.25;
        const life = (y + half) / this.span; // fade near the top
        ctx.globalAlpha = Math.min(1, life * 1.4) * (0.5 + 0.5 * Math.sin(t * 9 + i * 3));
        const er = 0.14 + c * 0.1;
        ctx.drawImage(glowSprite('ember', [[0, '#fff3b0'], [0.4, '#ff8a2a'], [1, 'rgba(255,60,20,0)']]), x - er, y - er, er * 2, er * 2);
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
        ctx.drawImage(glowSprite('firefly', [[0, '#f6ffb0'], [0.3, 'rgba(200, 255, 90, 0.6)'], [1, 'rgba(120, 200, 40, 0)']]), x - 0.28, y - 0.28, 0.56, 0.56);
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
      } else if (kind === 'wisps') {
        // Haunted: will-o'-the-wisps rising, swaying, fading as they go
        const p = (t * (0.05 + c * 0.05) + b) % 1;
        const x = x0 + Math.sin(t * 0.9 + i * 2.1) * 0.6;
        const y = half - p * this.span;
        const wr = 0.3 + c * 0.25;
        ctx.globalAlpha = Math.sin(p * Math.PI) * (0.5 + 0.3 * Math.sin(t * 3 + i));
        ctx.drawImage(glowSprite('wisp', [[0, 'rgba(235, 255, 240, 0.95)'], [0.35, 'rgba(150, 255, 200, 0.5)'], [1, 'rgba(120, 255, 190, 0)']]), x - wr, y - wr, wr * 2, wr * 2);
      } else if (kind === 'asteroids') {
        // Space: lumps of rock tumbling slowly across
        const x = wrap(x0 + t * (0.12 + c * 0.14));
        const y = wrap(y0 + t * (0.04 + a * 0.06));
        const ar = 0.14 + c * 0.2;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * (0.3 + c) + i);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = i % 3 ? '#6f6a80' : '#8f7a6a';
        path(ctx, [[-ar, -ar * 0.3], [-ar * 0.3, -ar], [ar * 0.7, -ar * 0.6], [ar, ar * 0.2], [ar * 0.2, ar], [-ar * 0.7, ar * 0.6]]);
        ctx.fill();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        circle(ctx, ar * 0.2, ar * 0.1, ar * 0.25);
        ctx.fill();
        ctx.restore();
      } else if (kind === 'petals') {
        // Sakura: blossom petals drifting down and across, turning as they fall
        const y = wrap(y0 + t * (0.3 + c * 0.35));
        const x = wrap(x0 + t * (0.18 + c * 0.2) + Math.sin(t * 0.8 + i) * 0.4);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = i % 3 ? '#ffc2d6' : '#ffffff';
        ctx.beginPath();
        ctx.ellipse(x, y, 0.13 + c * 0.05, 0.07, t * (0.8 + c) + i, 0, TAU);
        ctx.fill();
      } else if (kind === 'sand') {
        // Desert: grains streaking past on the wind, in gusts
        const gust = 0.5 + 0.5 * Math.sin(t * 0.5 + b * 6);
        const x = wrap(x0 + t * (1.4 + c * 1.6));
        const y = y0 + Math.sin(t * 0.7 + i) * 0.2;
        if (i === 0) ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - (0.25 + c * 0.5) * gust, y + 0.03);
        if (i === n - 1) {
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 0.035;
          ctx.lineCap = 'round';
          ctx.strokeStyle = '#fff2c8';
          ctx.stroke();
        }
      } else if (kind === 'blocks') {
        // Arcade: chunky pixels falling one row at a time
        const step = Math.floor(t * (2 + c * 3) + b * 30);
        const y = wrap(-half + ((step * 0.5) % this.span));
        const x = -half + Math.floor(a * this.span * 2) / 2;
        ctx.globalAlpha = 0.3 + 0.25 * c;
        ctx.fillStyle = ['#2ef2ff', '#ff2fd1', '#ffe04a', '#5cff8a'][i % 4];
        ctx.fillRect(x + 0.05, y + 0.05, 0.4, 0.4);
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
  drawCosmos(ctx, t, half) {
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
        ctx.globalAlpha = p;
        ctx.drawImage(glowSprite(`star-${color}`, [[0, hexA(color, 0.35)], [1, hexA(color, 0)]]), x - r, y - r, r * 2, r * 2);
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
    // Two dice (6-arm boards) sit side by side, a little smaller, each tumbling its own way.
    const draw = d.mode === 'spin' ? drawDiceCube : drawDice;
    const faces = d.values?.length > 1 ? d.values : [value];
    this.pairDice = faces.length > 1;
    const each = faces.length > 1 ? size * 0.78 : size;
    faces.forEach((face, i) => {
      const dx = faces.length > 1 ? (i - 0.5) * each * 1.3 : 0;
      let s = spin;
      if (i > 0 && d.mode === 'spin') {
        // the second dice tumbles the other way round
        const k = d.waiting ? 1 - (3 * d.t) / SPIN_MS : 1 - easeOutCubic(Math.min(1, d.t / SPIN_MS));
        const [ax, ay] = d.axes || [2.5, 1.5];
        s = mul(rotY(-ax * TAU * k), rotX(ay * TAU * k * 1.3));
      }
      draw(ctx, cx + dx, cy - hop, each * scale, d.mode === 'ready' ? null : face, d.style, {
        spin: s,
        tilt,
        alpha,
        glow: d.mode === 'ready' ? d.color : null,
        color: d.color,
        sign: d.sign,
      });
    });

    this.drawBank(d, size, cx, cy - hop);

    if (d.mode === 'ready' && d.mine) {
      ctx.font = `800 ${Math.max(11, size * 0.2)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      const tap = t('Tap to roll').toLocaleUpperCase(currentLanguage());
      ctx.strokeText(tap, cx, cy + size * 0.88);
      ctx.fillStyle = '#fff';
      ctx.fillText(tap, cx, cy + size * 0.88);
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

  // The winner takes a bow: their own token, big, in the middle of the board, in its own style
  // (TOKEN_SIGNATURES: the Rocket, UFO and Dragon fly a lap of the board first).
  celebrate(seat, skin) {
    this.party = { seat, skin: skin || 'token-classic', start: performance.now(), beat: -1 };
  }

  drawParty(now) {
    const p = this.party;
    if (!p) return;
    const MS = 4600;
    const e = now - p.start;
    if (e > MS || !this.board.colors[p.seat]) {
      this.party = null;
      return;
    }
    this.fast = true;
    const sig = TOKEN_SIGNATURES[p.skin] || {};
    const hex = this.seatColor(p.seat);
    const colors = sig.colors || [hex, '#ffffff', '#ffd23f'];
    const lapMs = sig.win === 'lap' ? 1900 : 0;
    const grow = easeOutBack(Math.min(1, e / 380)) * (1 - Math.max(0, (e - (MS - 300)) / 300));
    let x = 0;
    let y = 0.9;
    let lift = 0;
    let size = 2.3;
    if (e < lapMs) {
      // once round the board, banking, leaving a trail
      const k = e / lapMs;
      const a = -Math.PI / 2 + easeInOut(k) * TAU;
      const rad = this.span * 0.36;
      x = Math.cos(a) * rad;
      y = Math.sin(a) * rad * 0.8 + 0.9 * k;
      lift = 1.2 + Math.sin(k * Math.PI) * 1.5;
      size = 1.5;
      if (Math.random() < 0.7) this.burst(x, y - lift, colors, { count: 2, speed: 1.6, life: 600, size: 0.14 });
    } else {
      // jumping for joy: a burst every time it lands
      const j = (e - lapMs) / 520;
      const beat = Math.floor(j);
      lift = Math.abs(Math.sin(j * Math.PI)) * 1.6;
      if (beat !== p.beat) {
        p.beat = beat;
        this.burst(0, 0.9, colors, { count: 18, speed: 5.5, life: 900, size: 0.16 });
        this.ring(0, 0.9, colors[0], 1.8);
      }
    }
    const r = this.cell * 0.4 * size * Math.max(0.01, grow);
    const ctx = this.ctx;
    ctx.save();
    drawToken(ctx, this.px(x), this.px(y), r, hex, p.skin, { lift: lift * this.cell, squash: lift < 0.12 && !lapMs ? 0.86 : 1, sign: this.board.colors[p.seat], t: now });
    ctx.restore();
  }

  // A taunt (the capturer's equipped one) pops up over the square for a moment.
  // A taunt (taunts.js) where `seat` just captured: x, y in board units. `victim`: { seat, color, name }
  // of the token sent home, so the scene can chase it to their base and leave its mark there.
  taunt(x, y, id, color, victim = null) {
    if (!TAUNT_FX[id]) return;
    (this.taunts ||= []).push({ x, y, id, color, victim, born: performance.now(), fired: 0, shook: 0 });
  }

  // Big lettering across the board (Revenge!, Double!...): `row` stacks a second one under the
  // first, `sub` is a smaller line under it (whose it is).
  callout(text, color, row = 0, sub = '') {
    (this.callouts ||= []).push({ text, color, row, sub, born: performance.now() });
  }

  drawCallouts(now) {
    if (!this.callouts?.length) return;
    const MS = 1700;
    this.callouts = this.callouts.filter((c) => now - c.born < MS);
    const s = this.cell;
    for (const c of this.callouts) {
      const k = (now - c.born) / MS;
      const y = this.size * (0.22 + c.row * 0.13) - (k > 0.8 ? (k - 0.8) * s * 4 : 0);
      {
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha *= k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
        word(ctx, c.text.toLocaleUpperCase(), this.size / 2, y, s * 1.5, c.color, { pop: Math.min(1, k / 0.12), rot: -0.06, maxW: this.size - s * 2 });
        if (c.sub) word(ctx, c.sub, this.size / 2, y + s * 1.15, s * 0.62, '#ffffff', { pop: Math.min(1, (k - 0.06) / 0.12), rot: -0.06, maxW: this.size - s * 4 });
        ctx.restore();
      }
    }
  }

  // The marks a taunt leaves on someone's base go when it is their turn again
  clearTauntMark(seat) {
    this.tauntMarks?.delete(seat);
    for (const p of this.taunts || []) if (p.victim?.seat === seat) p.noMark = true;
  }
  clearTaunts() {
    this.taunts = [];
    this.tauntMarks?.clear();
  }

  // The middle of a seat's base, in pixels
  baseCenter(seat) {
    let x = 0;
    let y = 0;
    for (let i = 0; i < 4; i++) {
      const c = this.board.tokenCenter(seat, -1, i);
      x += c.x / 4;
      y += c.y / 4;
    }
    return { x: this.px(x), y: this.px(y) };
  }

  tauntGeom(p) {
    const base = p.victim ? this.baseCenter(p.victim.seat) : { x: this.px(p.x), y: this.px(p.y) };
    return { x: this.px(p.x), y: this.px(p.y), hx: base.x, hy: base.y, s: this.cell * TAUNT_SCALE, w: this.size, h: this.size, color: p.color, vcolor: p.victim?.color || '#888', name: p.victim?.name || '', px: (u) => this.px(u) };
  }

  // A short shake of the whole board (not for people who turn motion off)
  shake(strength = 1) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const el = this.canvas.parentElement;
    if (!el?.animate) return;
    const d = 7 * strength;
    el.animate(
      [{ transform: 'translate(0,0)' }, { transform: `translate(${-d}px,${d * 0.5}px)` }, { transform: `translate(${d * 0.8}px,${-d * 0.6}px)` }, { transform: `translate(${-d * 0.5}px,${d * 0.3}px)` }, { transform: 'translate(0,0)' }],
      { duration: 340, easing: 'ease-out' },
    );
  }

  drawTaunts(now) {
    const { ctx } = this;
    // marks left on someone's base, under everything else
    for (const m of this.tauntMarks?.values() || []) TAUNT_FX[m.id].mark(ctx, now - m.born, this.tauntGeom(m));
    if (!this.taunts?.length) return;
    const done = [];
    for (const p of this.taunts) {
      const fx = TAUNT_FX[p.id];
      const k = (now - p.born) / fx.ms;
      if (k >= 1) {
        done.push(p);
        continue;
      }
      fx.draw(ctx, k, this.tauntGeom(p));
      // the board shakes on the big hits, and fireworks really go off
      while (fx.shake && p.shook < fx.shake.length && k >= fx.shake[p.shook]) this.shake(p.shook++ ? 0.7 : 1);
      while (fx.bursts && p.fired < fx.bursts.length && k >= fx.bursts[p.fired][0]) {
        const [, bx, by] = fx.bursts[p.fired++];
        this.burst(bx, by, ['#ff5ca8', '#ffd23f', '#5cf2ff', '#ffffff'], { count: 28, speed: 5.5, life: 850 });
      }
    }
    for (const p of done) {
      if (TAUNT_FX[p.id].mark && p.victim && !p.noMark) (this.tauntMarks ||= new Map()).set(p.victim.seat, { ...p, born: now });
    }
    if (done.length) this.taunts = this.taunts.filter((p) => !done.includes(p));
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
    // Two dice side by side: a wider target
    if (this.pairDice) return Math.abs(x) < this.diceSize * 1.4 && Math.abs(y) < this.diceSize * 0.75;
    return Math.hypot(x, y) < this.diceSize * 0.75;
  }
}

// (the rest of the drawing lives in its own files now; everything is still reachable from here)
export { drawToken, pawnCache } from './draw-tokens.js';
export { drawDice, drawTumblingDice } from './draw-dice.js';
export { drawShape } from './draw-util.js';

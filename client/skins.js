// How the shop's board themes and dice look. Token skins are drawn in renderer.js.
//
// Each board theme has its own six player colours, tuned to sit well on that board.
// Pawns, bases, home columns, the dice glow and the side panel all use them, so
// everything on one board matches.

export const BOARD_THEMES = {
  // art.shield: what wraps a token standing on a safe square (renderer.js SHIELDS)
  'board-classic': {
    // Safe squares stand out: a warm gold tile, a darker ring and a big outlined star
    art: { mark: 'star', markSize: 0.34, markEdge: '#ffffff', safeRing: '#d39a1e',
      shield: { kind: 'orbit', motif: 'star', colors: ['#ffd54a', '#ffb52e'], glow: 'rgba(255, 220, 120, 0.5)' } },
    bg: '#e9e2d3', // shows between the squares
    cell: '#fbf8f1',
    safe: '#fbdc85',
    star: '#a8690a',
    baseInner: '#fbf8f1',
    players: { red: '#d24d47', green: '#2f9467', yellow: '#e2a92a', blue: '#3a68c8', purple: '#7e57bd', orange: '#dd7433' },
  },
  // The textured themes all work the same way (see art in renderer.js): a surface texture under
  // the board shows through the grout and through each base's "window", a second copy of it
  // drifts over that (art.under), and the squares and bases get their own textures (art.tex).
  'board-midnight': {
    // Night sky through every window, slate squares, stars twinkling
    art: {
      base: 'dusk', frame: ['#1b2250', '#c9b8ff', 0.32], panel: 'window',
      tex: {
        surface: { src: '/textures/midnight-sky.jpg', size: 8 },
        base: { src: '/textures/midnight-sky.jpg', size: 6, blend: 'soft-light', alpha: 0.5 },
        tile: { src: '/textures/midnight-slate.jpg', size: 3, blend: 'multiply', alpha: 0.9 },
      },
      under: { src: '/textures/midnight-sky.jpg', size: 11, alpha: 0.55, blend: 'screen', speed: 0.06 },
      pattern: 'stars', patternColor: 'rgba(255, 244, 200, 0.22)', patternSize: 0.2, tile: 'starry', mark: 'moon', markSize: 0.3,
      fx: 'twinkle', fxColor: '#fff3c4', fxCount: 30,
      shield: { kind: 'orbit', motif: 'sparkle', colors: ['#fff3c4', '#cfe0ff'], glow: 'rgba(170, 190, 255, 0.45)', n: 6 },
    },
    bg: '#0b0e24',
    cell: '#3a3f55',
    safe: '#5a5040',
    star: '#f0cf6a',
    baseInner: '#191a21',
    players: { red: '#ec6a64', green: '#43c98c', yellow: '#efc34e', blue: '#5c8be8', purple: '#a283ea', orange: '#ef9452' },
  },
  'board-wood': {
    // A walnut board with pale maple squares, inlaid bases
    art: {
      base: 'inlay', frame: ['#3a200c', '#8a5a2c', 0.4],
      tex: {
        surface: { src: '/textures/wood-walnut.jpg', size: 9 },
        base: { src: '/textures/wood-maple.jpg', size: 6, blend: 'multiply', alpha: 0.5 },
        tile: { src: '/textures/wood-maple.jpg', size: 4, blend: 'multiply', alpha: 0.9 },
        panel: { src: '/textures/wood-maple.jpg', size: 5 },
      },
      tile: 'gloss', mark: 'star', fx: 'dust', fxCount: 18,
      shield: { kind: 'orbit', motif: 'leaf', colors: ['#d9822b', '#b5541c', '#e8b23a'], glow: 'rgba(255, 190, 110, 0.45)' },
    },
    bg: '#4a2a12',
    cell: '#fff6e6',
    safe: '#f2cf8f',
    star: '#7f5220',
    baseInner: '#f5e7cd',
    players: { red: '#a8432f', green: '#4b7a3a', yellow: '#c48c22', blue: '#395c84', purple: '#6c4a7c', orange: '#b5622a' },
  },
  'board-candy': {
    // Pastel candy swirling through the windows, frosted bases with sprinkles
    art: {
      base: 'solid', frame: ['#ff8fb8', '#ffffff', 0.32], panel: 'window',
      tex: {
        surface: { src: '/textures/candy-swirl.jpg', size: 9 },
        base: { src: '/textures/candy-icing.jpg', size: 5, blend: 'soft-light', alpha: 0.7 },
      },
      under: { src: '/textures/candy-swirl.jpg', size: 9, alpha: 0.6, blend: 'overlay', speed: 0.14 },
      tile: 'gloss', mark: 'heart', fx: 'sprinkles', fxCount: 22,
      shield: 'candy',
    },
    bg: '#f6d7e5',
    cell: '#fffafc',
    safe: '#fde6b3',
    star: '#d97aa6',
    baseInner: '#fffafc',
    players: { red: '#ee7486', green: '#4fbf95', yellow: '#f2bf57', blue: '#6c98ee', purple: '#b087ec', orange: '#f3965f' },
  },
  'board-neon': {
    // A glowing grid scrolls under the board and through the windows
    art: {
      base: 'outline', frame: ['#ff2fd1', '#2ef2ff', 0.14], panel: 'window',
      tex: {
        surface: { src: '/textures/neon-grid.jpg', size: 4 },
        tile: { src: '/textures/neon-tarmac.jpg', size: 3, blend: 'multiply', alpha: 1 },
      },
      under: { src: '/textures/neon-grid.jpg', size: 4, alpha: 0.7, blend: 'screen', speed: 0.5, single: true },
      tile: 'neon', mark: 'star', fx: 'scan',
      shield: 'force',
    },
    bg: '#07070d',
    cell: '#24263a',
    safe: '#2c2860',
    star: '#8d84ff',
    baseInner: '#0c0d15',
    players: { red: '#ff4d6d', green: '#2ef29a', yellow: '#ffe04a', blue: '#3db2ff', purple: '#c35cff', orange: '#ff8e3a' },
  },
  // bg2 (optional): the board glows from this colour in the middle out to bg at the edges
  'board-ocean': {
    // Each base is a lagoon (a window onto moving water); sandy tiles; water-textured bases
    art: {
      base: 'solid', frame: ['#e9d3a1', '#fff2cf', 0.36], panel: 'window',
      tex: {
        surface: { src: '/textures/ocean-water.jpg', size: 7 },
        base: { src: '/textures/ocean-water.jpg', size: 5, blend: 'soft-light', alpha: 0.32 },
        tile: { src: '/textures/ocean-sand.jpg', size: 3.2, blend: 'multiply', alpha: 0.55 },
      },
      under: { src: '/textures/ocean-water.jpg', size: 7, alpha: 0.55, blend: 'overlay', speed: 0.22 },
      mark: 'starfish', markSize: 0.32, fx: 'bubbles', fxCount: 24,
      shield: 'bubble',
    },
    bg: '#0d4a6b',
    bg2: '#1f8db5',
    cell: '#f6ecd2',
    safe: '#bfeaf5',
    star: '#ff7a59',
    baseInner: '#eaf7fb',
    players: { red: '#f0605a', green: '#1fb38a', yellow: '#f5c33b', blue: '#2f6fd6', purple: '#8b6fe0', orange: '#f08a3e' },
  },
  'board-forest': {
    // A mossy clearing in each base, stepping-stone squares, sunlight drifting through the leaves
    art: {
      base: 'solid', frame: ['#3b2a16', '#8a6a3a', 0.38], panel: 'window',
      tex: {
        surface: { src: '/textures/forest-moss.jpg', size: 6 },
        base: { src: '/textures/forest-moss.jpg', size: 5, blend: 'soft-light', alpha: 0.5 },
        tile: { src: '/textures/forest-stone.jpg', size: 3.4, blend: 'multiply', alpha: 0.85 },
      },
      under: { src: '/textures/forest-light.jpg', size: 9, alpha: 0.5, blend: 'screen', speed: 0.1 },
      tile: 'moss', mark: 'leaf', fx: 'fireflies', fxCount: 16,
      shield: { kind: 'orbit', motif: 'leaf', colors: ['#5fbf3a', '#3d9a30', '#9ad84a'], glow: 'rgba(200, 255, 140, 0.4)', n: 6 },
    },
    bg: '#263f23',
    cell: '#f4f2e6',
    safe: '#dcebb0',
    star: '#5d7d22',
    baseInner: '#f3f7e6',
    players: { red: '#c94f3d', green: '#3a8a40', yellow: '#d6a425', blue: '#3d6ea8', purple: '#7a5aa6', orange: '#d07a32' },
  },
  'board-ice': {
    // Looking down into deep cracked ice; snowy squares; snow falling
    art: {
      base: 'frosted', frame: ['#ffffff', '#9fd4f0', 0.32], panel: 'window',
      tex: {
        surface: { src: '/textures/ice-deep.jpg', size: 7 },
        base: { src: '/textures/ice-snow.jpg', size: 5, blend: 'soft-light', alpha: 0.6 },
        tile: { src: '/textures/ice-snow.jpg', size: 3.2, blend: 'multiply', alpha: 0.8 },
      },
      under: { src: '/textures/ice-deep.jpg', size: 10, alpha: 0.45, blend: 'soft-light', speed: 0.05 },
      tile: 'frost', mark: 'snowflake', fx: 'snow', fxCount: 40,
      shield: 'frost',
    },
    bg: '#9ccfe8',
    cell: '#ffffff',
    safe: '#d4effa',
    star: '#4aa3cf',
    baseInner: '#fbfeff',
    players: { red: '#e2566a', green: '#25a585', yellow: '#e3ad1f', blue: '#3a74d8', purple: '#8a6be0', orange: '#ec8a46' },
  },
  'board-lava': {
    // Molten lava glowing between basalt squares and filling each base
    art: {
      base: 'rock', frame: ['#2a120a', '#ff7a2a', 0.3], panel: 'window',
      tex: {
        surface: { src: '/textures/lava-molten.jpg', size: 6 },
        base: { src: '/textures/lava-basalt.jpg', size: 4, blend: 'overlay', alpha: 0.8 },
        tile: { src: '/textures/lava-basalt.jpg', size: 3, blend: 'multiply', alpha: 1 },
      },
      under: { src: '/textures/lava-molten.jpg', size: 6, alpha: 0.6, blend: 'screen', speed: 0.12 },
      tile: 'stone', mark: 'flame', markSize: 0.3, fx: 'embers', fxCount: 28,
      shield: 'fire',
    },
    bg: '#2a0c05',
    cell: '#6a5d58',
    safe: '#8a5a3a',
    star: '#ffb347',
    baseInner: '#211310',
    players: { red: '#ff4a3d', green: '#48d18a', yellow: '#ffc83a', blue: '#4f8dff', purple: '#c06bff', orange: '#ff7b2a' },
  },
  // Warm and cosy: knitted squares whose stitches follow the route, felt bases with a fluffy
  // cushion for the pins, a paw print, a ball of yarn and claw scratches in the corners
  'board-cat': {
    art: {
      base: 'cushion', baseLight: 0.14, stitch: '#3a2010', frame: ['#b9784a', '#f3c79c', 0.3],
      panel: 'fluffy', pins: 'dents', decor: 'cat', center: 'stitched',
      tex: {
        base: { src: '/textures/cat-linen.jpg', size: 4, blend: 'multiply', alpha: 0.55 },
        panel: { src: '/textures/cat-linen.jpg', size: 3 },
      },
      tile: 'knit', mark: 'paw', fx: 'paws', fxColor: '#8a5a3c', fxCount: 18,
      shield: { kind: 'orbit', motif: 'paw', colors: ['#ffffff', '#ffd3e0'], glow: 'rgba(255, 190, 140, 0.55)', n: 4, size: 0.36 },
    },
    bg: '#b98a5e',
    cell: '#f2e6d4',
    safe: '#ecc9a2',
    star: '#a8683e',
    baseInner: '#f7ecdc',
    players: { red: '#d9665c', green: '#5fae7a', yellow: '#e8b84a', blue: '#6a8fd0', purple: '#a57fcc', orange: '#e88f55' },
  },
  'board-royal': {
    // Purple velvet and white marble, gold everywhere
    art: {
      base: 'frame', frame: ['#b8860b', '#ffe9a0', 0.32],
      tex: {
        surface: { src: '/textures/royal-velvet.jpg', size: 6 },
        base: { src: '/textures/royal-velvet.jpg', size: 5, blend: 'soft-light', alpha: 0.6 },
        tile: { src: '/textures/royal-marble.jpg', size: 4, blend: 'multiply', alpha: 1 },
        panel: { src: '/textures/royal-velvet.jpg', size: 5 },
      },
      pattern: 'damask', patternColor: 'rgba(255, 228, 150, 0.22)', patternSize: 0.2, patternSpin: 0,
      tile: 'gilded', mark: 'crown', emblem: 'crown', emblemAlpha: 0.3, emblemColor: '#e9c35a', fx: 'sparkle', fxColor: '#ffe08a', fxCount: 22,
      shield: { kind: 'orbit', motif: 'sparkle', colors: ['#ffe08a', '#fff6d0'], glow: 'rgba(255, 215, 110, 0.5)', n: 6, crown: true },
    },
    bg: '#25114a',
    cell: '#ffffff',
    safe: '#f3dc95',
    star: '#c9971c',
    baseInner: '#3a2068',
    players: { red: '#c8364a', green: '#23875f', yellow: '#dfa923', blue: '#3159b8', purple: '#7d3fb8', orange: '#d66a2a' },
  },
  // A night sky in gold lines. Each base is a window onto the stars holding its player's
  // constellation (Aries, Taurus, Cancer, Leo…), whose brightest stars are where the tokens wait.
  'board-constellation': {
    art: {
      base: 'celestial', frame: ['#8a6a24', '#f3d98a', 0.22], panel: 'window', windowRim: '#e2bf6a', pins: 'constellation',
      tex: { surface: { src: '/textures/constellation-sky.jpg', size: 9 } },
      under: { src: '/textures/constellation-sky.jpg', size: 12, alpha: 0.5, blend: 'screen', speed: 0.05 },
      tile: 'celestial', mark: 'sparkle', markSize: 0.3, fx: 'cosmos', fxColor: '#fff3c4', fxCount: 26,
      shield: 'constellation',
    },
    bg: '#070a26',
    cell: 'rgba(12, 16, 56, 0.62)',
    safe: 'rgba(120, 92, 30, 0.72)',
    star: '#ffe08a',
    baseInner: '#0b0f30',
    players: { red: '#e8475f', green: '#2fbf7a', yellow: '#f2c14e', blue: '#4f8ff0', purple: '#a674f0', orange: '#f08a3e' },
  },
};

// ---------- colour-blind mode ----------
// Each player can switch it on for themselves. Every board theme then uses the Okabe–Ito colours,
// which stay apart for the common kinds of colour blindness, and every player gets a shape
// too, so colour is never the only way to tell players apart.
export const CB_COLORS = {
  red: '#d55e00',
  green: '#009e73',
  yellow: '#f0e442',
  blue: '#0072b2',
  purple: '#cc79a7',
  orange: '#e69f00',
};
export const SHAPES = { red: 'triangle', green: 'square', yellow: 'circle', blue: 'diamond', purple: 'plus', orange: 'cross' };
export const SYMBOLS = { red: '▲', green: '■', yellow: '●', blue: '◆', purple: '✚', orange: '✖' };

const A11Y_KEY = 'ludo-a11y';
let colorBlind = false;
try {
  colorBlind = JSON.parse(localStorage.getItem(A11Y_KEY) || '{}').colorBlind === true;
} catch {
  // storage unavailable: off
}

export function isColorBlind() {
  return colorBlind;
}

export function setColorBlind(on) {
  colorBlind = on;
  try {
    localStorage.setItem(A11Y_KEY, JSON.stringify({ colorBlind: on }));
  } catch {
    // not saved: fine, it's only a preference
  }
}

// A player's colour on a board theme (e.g. 'red' on 'board-neon').
export function playerColor(themeId, name) {
  if (colorBlind) return CB_COLORS[name];
  return (BOARD_THEMES[themeId] || BOARD_THEMES['board-classic']).players[name];
}

// How each dice looks. face/edge/pip: the base colours; art: a painting on the face (renderer.js
// DICE_ART), pips: how the spots are drawn (PIP_STYLES), outline: a glowing border.
export const DICE_STYLES = {
  'dice-classic': { face: '#fbfaf6', edge: '#d3cdbf', pip: '#26262b' },
  'dice-midnight': { face: '#151a3d', edge: '#3b4580', pip: '#ffe9a8', art: 'night', pips: 'glow' },
  'dice-wood': { face: '#c8935a', edge: '#7f5226', pip: '#3d2208', art: 'grain', pips: 'inset' },
  'dice-ruby': { face: '#b3122a', edge: '#6b0614', pip: '#fff4f4', pipDark: '#c9b8bb', art: 'gem', facets: ['#ff6b7f', '#d42a42', '#8c0a1f', '#5e0413'], pips: 'pearl' },
  // Glows in the colour of whoever is rolling (green in shop previews), and pulses.
  'dice-neon': { face: '#0b0c14', edge: '#2ef29a', pip: '#2ef29a', outline: '#2ef29a', playerColor: true, pulse: true, art: 'grid', pips: 'glow' },
  'dice-gold': { face: '#e2b44a', edge: '#8c6512', pip: '#5a3c00', art: 'metal', pips: 'engraved' },
  'dice-ice': { face: '#dff3fc', edge: '#7fb8d8', pip: '#2b78ad', pipDark: '#123f63', art: 'frost', pips: 'pearl' },
  'dice-candy': { face: '#ffffff', edge: '#e4577f', pip: '#ff4f7b', pipColors: ['#ff5ca8', '#3fd8a4', '#ffd23f', '#5aa8ff', '#b07bff', '#ff8a3d'], art: 'peppermint', pips: 'candy' },
  'dice-emerald': { face: '#0f7a4c', edge: '#064a2c', pip: '#ffd86a', pipDark: '#9a6b00', art: 'stepcut', facets: ['#6ff0b0', '#1fae6e', '#08502f'], pips: 'pearl' },
  // The four corners of a Ludo board, in the Classic board's colours
  'dice-ludo': { face: '#ffffff', edge: '#cfc8b8', pip: '#ffffff', art: 'ludo', quads: ['#d24d47', '#2f9467', '#e2a92a', '#3a68c8'], pips: 'outlined' },
  'dice-lava': { face: '#1c0d0a', edge: '#ff6a2a', pip: '#ffb02e', outline: '#ff6a2a', pulse: true, art: 'magma', pips: 'magma' },
  'dice-galaxy': { face: '#0d0726', edge: '#5b3fb0', pip: '#ffffff', outline: '#8a5cff', art: 'nebula', pips: 'glow' },
  // Navy and gold; each face's pips are stars joined into a constellation
  'dice-constellation': { face: '#0b1034', edge: '#d9b25a', pip: '#fff1c2', outline: '#d9b25a', art: 'zodiac', pips: 'star', links: true },
  'dice-cat': { face: '#f5b26b', edge: '#b0641f', pip: '#5a2d0c', art: 'tabby', pips: 'paw' },
};

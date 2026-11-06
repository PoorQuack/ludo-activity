// How the shop's board themes and dice look. Token skins are drawn in renderer.js.
//
// Each board theme has its own six player colours, tuned to sit well on that board.
// Pawns, bases, home columns, the dice glow and the side panel all use them, so
// everything on one board matches.

export const BOARD_THEMES = {
  'board-classic': {
    // Safe squares stand out: a warm gold tile, a darker ring and a big outlined star
    art: { mark: 'star', markSize: 0.34, markEdge: '#ffffff', safeRing: '#d39a1e' },
    bg: '#e9e2d3', // shows between the squares
    cell: '#fbf8f1',
    safe: '#fbdc85',
    star: '#a8690a',
    baseInner: '#fbf8f1',
    players: { red: '#d24d47', green: '#2f9467', yellow: '#e2a92a', blue: '#3a68c8', purple: '#7e57bd', orange: '#dd7433' },
  },
  'board-midnight': {
    art: { base: 'dusk', frame: ['#2b3570', '#8fa0ff', 0.22], pattern: 'stars', patternColor: 'rgba(255, 244, 200, 0.28)', patternSize: 0.22, tile: 'starry', mark: 'moon', emblem: 'moon', emblemAlpha: 0.22, innerShade: 'rgba(0,0,20,0.35)', fx: 'twinkle', fxColor: '#fff3c4', fxCount: 30 },
    bg: '#121319',
    cell: '#22242d',
    safe: '#3a3424',
    star: '#e0bd57',
    baseInner: '#191a21',
    players: { red: '#ec6a64', green: '#43c98c', yellow: '#efc34e', blue: '#5c8be8', purple: '#a283ea', orange: '#ef9452' },
  },
  'board-wood': {
    art: { base: 'inlay', frame: ['#5a3412', '#a8743c', 0.4], pattern: 'grain', patternColor: 'rgba(40, 18, 4, 0.22)', tile: 'wood', mark: 'star', fx: 'dust', fxCount: 18 },
    bg: '#9a6f45',
    cell: '#f0dfc1',
    safe: '#e6c48a',
    star: '#7f5220',
    baseInner: '#f5e7cd',
    players: { red: '#a8432f', green: '#4b7a3a', yellow: '#c48c22', blue: '#395c84', purple: '#6c4a7c', orange: '#b5622a' },
  },
  'board-candy': {
    art: { base: 'solid', frame: ['#ff8fb8', '#ffffff', 0.3], pattern: 'stripes', patternColor: 'rgba(255, 255, 255, 0.26)', tile: 'gloss', mark: 'heart', emblem: 'candy', emblemAlpha: 0.2, fx: 'sprinkles', fxCount: 22 },
    bg: '#f6d7e5',
    cell: '#fffafc',
    safe: '#fde6b3',
    star: '#d97aa6',
    baseInner: '#fffafc',
    players: { red: '#ee7486', green: '#4fbf95', yellow: '#f2bf57', blue: '#6c98ee', purple: '#b087ec', orange: '#f3965f' },
  },
  'board-neon': {
    art: { base: 'outline', frame: ['#ff2fd1', '#2ef2ff', 0.14], pattern: 'grid', patternColor: 'rgba(255, 255, 255, 0.16)', tile: 'neon', mark: 'star', fx: 'scan', innerShade: 'rgba(0,0,0,0.5)' },
    bg: '#07070d',
    cell: '#12131d',
    safe: '#1c1a3d',
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
    art: { base: 'solid', frame: ['#1d3a1a', '#5f8f3a', 0.36], pattern: 'leaves', patternColor: 'rgba(255, 255, 255, 0.2)', patternSize: 0.24, tile: 'moss', mark: 'leaf', emblem: 'leaf', emblemAlpha: 0.2, fx: 'fireflies', fxCount: 16 },
    bg: '#263f23',
    bg2: '#4c7a40',
    cell: '#eef4dc',
    safe: '#d6e8a8',
    star: '#5d7d22',
    baseInner: '#f3f7e6',
    players: { red: '#c94f3d', green: '#3a8a40', yellow: '#d6a425', blue: '#3d6ea8', purple: '#7a5aa6', orange: '#d07a32' },
  },
  'board-ice': {
    art: { base: 'frosted', frame: ['#ffffff', '#bfe6fa', 0.3], pattern: 'snow', patternColor: 'rgba(255, 255, 255, 0.4)', patternSize: 0.2, tile: 'frost', mark: 'snowflake', emblem: 'snowflake', emblemAlpha: 0.25, fx: 'snow', fxCount: 40 },
    bg: '#9ccfe8',
    bg2: '#e6f6fd',
    cell: '#f8fdff',
    safe: '#d4effa',
    star: '#4aa3cf',
    baseInner: '#fbfeff',
    players: { red: '#e2566a', green: '#25a585', yellow: '#e3ad1f', blue: '#3a74d8', purple: '#8a6be0', orange: '#ec8a46' },
  },
  'board-lava': {
    art: { base: 'rock', frame: ['#ff5a1a', '#ffc04a', 0.18], pattern: 'flames', patternColor: 'rgba(255, 210, 90, 0.2)', patternSize: 0.22, patternSpin: 0.3, tile: 'stone', mark: 'flame', emblem: 'flame', emblemAlpha: 0.22, innerShade: 'rgba(60,10,0,0.45)', fx: 'embers', fxCount: 28 },
    bg: '#150806',
    bg2: '#5a1a0b',
    cell: '#2b1a16',
    safe: '#4d2b12',
    star: '#ff8a2a',
    baseInner: '#211310',
    players: { red: '#ff4a3d', green: '#48d18a', yellow: '#ffc83a', blue: '#4f8dff', purple: '#c06bff', orange: '#ff7b2a' },
  },
  // Warm and cosy, with paw prints everywhere
  'board-cat': {
    art: { base: 'cushion', frame: ['#c27a4a', '#ffd9b0', 0.32], pattern: 'paw', patternColor: 'rgba(255, 255, 255, 0.3)', patternSize: 0.2, tile: 'gloss', mark: 'paw', emblem: 'cat', emblemAlpha: 0.22, fx: 'paws', fxColor: '#8a5a3c', fxCount: 24 },
    bg: '#e9b98e',
    bg2: '#fbe3c8',
    cell: '#fffaf3',
    safe: '#ffe2c6',
    star: '#c27a4a',
    baseInner: '#fff6ec',
    players: { red: '#e86a6a', green: '#5dbb8a', yellow: '#f1b947', blue: '#6c8fe0', purple: '#a57ad8', orange: '#ee8a4a' },
  },
  'board-royal': {
    art: { base: 'frame', frame: ['#b8860b', '#ffe9a0', 0.3], pattern: 'damask', patternColor: 'rgba(255, 228, 150, 0.24)', patternSize: 0.2, patternSpin: 0, tile: 'gilded', mark: 'crown', emblem: 'crown', emblemAlpha: 0.4, emblemColor: '#e9c35a', fx: 'sparkle', fxColor: '#ffe08a', fxCount: 22 },
    bg: '#25114a',
    bg2: '#52309a',
    cell: '#fbf4e2',
    safe: '#f3dc95',
    star: '#c9971c',
    baseInner: '#3a2068',
    players: { red: '#c8364a', green: '#23875f', yellow: '#dfa923', blue: '#3159b8', purple: '#7d3fb8', orange: '#d66a2a' },
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
  'dice-cat': { face: '#f5b26b', edge: '#b0641f', pip: '#5a2d0c', art: 'tabby', pips: 'paw' },
};

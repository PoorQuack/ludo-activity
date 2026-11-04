// How the shop's board themes and dice look. Token skins are drawn in renderer.js.
//
// Each board theme has its own six player colours, tuned to sit well on that board.
// Pawns, bases, home columns, the dice glow and the side panel all use them, so
// everything on one board matches.

export const BOARD_THEMES = {
  'board-classic': {
    bg: '#e9e2d3', // shows between the squares
    cell: '#fbf8f1',
    safe: '#f3e3b5',
    star: '#b98a17',
    baseInner: '#fbf8f1',
    players: { red: '#d24d47', green: '#2f9467', yellow: '#e2a92a', blue: '#3a68c8', purple: '#7e57bd', orange: '#dd7433' },
  },
  'board-midnight': {
    bg: '#121319',
    cell: '#22242d',
    safe: '#3a3424',
    star: '#e0bd57',
    baseInner: '#191a21',
    players: { red: '#ec6a64', green: '#43c98c', yellow: '#efc34e', blue: '#5c8be8', purple: '#a283ea', orange: '#ef9452' },
  },
  'board-wood': {
    bg: '#9a6f45',
    cell: '#f0dfc1',
    safe: '#e6c48a',
    star: '#7f5220',
    baseInner: '#f5e7cd',
    players: { red: '#a8432f', green: '#4b7a3a', yellow: '#c48c22', blue: '#395c84', purple: '#6c4a7c', orange: '#b5622a' },
  },
  'board-candy': {
    bg: '#f6d7e5',
    cell: '#fffafc',
    safe: '#fde6b3',
    star: '#d97aa6',
    baseInner: '#fffafc',
    players: { red: '#ee7486', green: '#4fbf95', yellow: '#f2bf57', blue: '#6c98ee', purple: '#b087ec', orange: '#f3965f' },
  },
  'board-neon': {
    bg: '#07070d',
    cell: '#12131d',
    safe: '#1c1a3d',
    star: '#8d84ff',
    baseInner: '#0c0d15',
    players: { red: '#ff4d6d', green: '#2ef29a', yellow: '#ffe04a', blue: '#3db2ff', purple: '#c35cff', orange: '#ff8e3a' },
  },
  // bg2 (optional): the board glows from this colour in the middle out to bg at the edges
  'board-ocean': {
    bg: '#0d4a6b',
    bg2: '#1f8db5',
    cell: '#e8f7fb',
    safe: '#bfe7f2',
    star: '#0f7fa3',
    baseInner: '#eef9fc',
    players: { red: '#f0605a', green: '#1fb38a', yellow: '#f5c33b', blue: '#2f6fd6', purple: '#8b6fe0', orange: '#f08a3e' },
  },
  'board-forest': {
    bg: '#263f23',
    bg2: '#4c7a40',
    cell: '#f1f4e4',
    safe: '#dfe8b8',
    star: '#5d7d22',
    baseInner: '#f6f8ec',
    players: { red: '#c94f3d', green: '#3a8a40', yellow: '#d6a425', blue: '#3d6ea8', purple: '#7a5aa6', orange: '#d07a32' },
  },
  'board-ice': {
    bg: '#9ccfe8',
    bg2: '#e6f6fd',
    cell: '#f8fdff',
    safe: '#d4effa',
    star: '#4aa3cf',
    baseInner: '#fbfeff',
    players: { red: '#e2566a', green: '#25a585', yellow: '#e3ad1f', blue: '#3a74d8', purple: '#8a6be0', orange: '#ec8a46' },
  },
  'board-lava': {
    bg: '#150806',
    bg2: '#5a1a0b',
    cell: '#2b1a16',
    safe: '#4d2b12',
    star: '#ff8a2a',
    baseInner: '#211310',
    players: { red: '#ff4a3d', green: '#48d18a', yellow: '#ffc83a', blue: '#4f8dff', purple: '#c06bff', orange: '#ff7b2a' },
  },
  'board-royal': {
    bg: '#25114a',
    bg2: '#52309a',
    cell: '#f8f2e4',
    safe: '#f0dca0',
    star: '#c9971c',
    baseInner: '#fcf7ec',
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

export const DICE_STYLES = {
  'dice-classic': { face: '#fbfaf6', edge: '#d3cdbf', pip: '#26262b' },
  'dice-midnight': { face: '#2c2e38', edge: '#50535f', pip: '#f2efe6' },
  'dice-wood': { face: '#cf9f69', edge: '#8a5f37', pip: '#45290f' },
  'dice-ruby': { face: '#c43a46', edge: '#80222b', pip: '#fff4f2', shine: '#dc5f69' },
  // Glows in the colour of whoever is rolling (green in shop previews).
  'dice-neon': { face: '#0f1017', edge: '#2ef29a', pip: '#2ef29a', outline: '#2ef29a', playerColor: true },
  'dice-gold': { face: '#e2b44a', edge: '#9c771c', pip: '#5a3f00', shine: '#f3d585' },
  'dice-ice': { face: '#e3f5ff', edge: '#94c4de', pip: '#2b6c93', shine: '#ffffff' },
  'dice-emerald': { face: '#1f9c66', edge: '#0f5c3b', pip: '#effff6', shine: '#55d39b' },
  'dice-candy': { face: '#ffc9de', edge: '#e384ab', pip: '#c2185b', shine: '#fff0f6' },
  // Each pip in one of the four Ludo colours
  'dice-ludo': { face: '#fbfaf6', edge: '#d3cdbf', pip: '#26262b', pipColors: ['#e5483f', '#2fa86a', '#f2b425', '#3a6fd0'] },
  'dice-lava': { face: '#1c0d0a', edge: '#ff6a2a', pip: '#ffb02e', outline: '#ff6a2a' },
  'dice-galaxy': { face: '#1b1240', edge: '#5b3fb0', pip: '#ffffff', shine: '#3d2a8f', specks: true },
};

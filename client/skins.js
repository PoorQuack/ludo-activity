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
};

// A player's colour on a board theme (e.g. 'red' on 'board-neon').
export function playerColor(themeId, name) {
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
};

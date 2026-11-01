// How the shop's board themes and dice look. Token skins are drawn in renderer.js.
// `safe` fills the star squares so they stay visible with a pawn on them.

export const BOARD_THEMES = {
  'board-classic': { bg: '#fbf7ee', cell: '#ffffff', line: 'rgba(0,0,0,0.18)', safe: '#ffe8a6', star: '#d99a00', baseInner: '#ffffff' },
  'board-midnight': { bg: '#16171d', cell: '#2a2b34', line: 'rgba(255,255,255,0.09)', safe: '#4a4426', star: '#e8c547', baseInner: '#24252d' },
  'board-wood': { bg: '#b98552', cell: '#f0d9b5', line: 'rgba(90,50,15,0.35)', safe: '#f5c97a', star: '#a0611c', baseInner: '#f5e4c6' },
  'board-candy': { bg: '#ffd9ec', cell: '#fff6fb', line: 'rgba(214,92,152,0.3)', safe: '#ffc2df', star: '#e05a9b', baseInner: '#fff6fb' },
  'board-neon': { bg: '#07070f', cell: '#11111f', line: 'rgba(110,110,255,0.55)', safe: '#1f1f55', star: '#7a7aff', baseInner: '#0d0d18' },
};

export const DICE_STYLES = {
  'dice-classic': { face: '#ffffff', edge: '#b9b9c4', pip: '#222222' },
  'dice-midnight': { face: '#3a3b45', edge: '#5c5e6b', pip: '#f1f1f4' }, // light edge: visible on dark boards
  'dice-wood': { face: '#c8945a', edge: '#7a5230', pip: '#3b2412' },
  'dice-ruby': { face: '#e5484d', edge: '#8e1f2b', pip: '#ffffff', shine: '#ff9aa0' },
  // Glows in the colour of whoever is rolling (green in shop previews).
  'dice-neon': { face: '#101018', edge: '#39ff9c', pip: '#39ff9c', outline: '#39ff9c', playerColor: true },
  'dice-gold': { face: '#e9b632', edge: '#9a6f00', pip: '#5a3d00', shine: '#fff1b0' },
};

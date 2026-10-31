// How the shop's board themes and dice look. Token skins are drawn in renderer.js.

export const BOARD_THEMES = {
  'board-classic': { bg: '#fbf7ee', cell: '#ffffff', line: 'rgba(0,0,0,0.18)', star: '#c3bfb4', baseInner: '#ffffff' },
  'board-midnight': { bg: '#16171d', cell: '#2a2b34', line: 'rgba(255,255,255,0.09)', star: '#55566a', baseInner: '#24252d' },
  'board-wood': { bg: '#b98552', cell: '#f0d9b5', line: 'rgba(90,50,15,0.35)', star: '#b48452', baseInner: '#f5e4c6' },
  'board-candy': { bg: '#ffd9ec', cell: '#fff6fb', line: 'rgba(214,92,152,0.3)', star: '#f49ac4', baseInner: '#fff6fb' },
  'board-neon': { bg: '#07070f', cell: '#11111f', line: 'rgba(110,110,255,0.55)', star: '#4a4aff', baseInner: '#0d0d18' },
};

export const DICE_STYLES = {
  'dice-classic': { face: '#ffffff', edge: '#c9c9d1', pip: '#222222' },
  'dice-midnight': { face: '#2a2b33', edge: '#0f0f13', pip: '#f1f1f4' },
  'dice-wood': { face: '#c8945a', edge: '#7a5230', pip: '#3b2412' },
  'dice-ruby': { face: '#e5484d', edge: '#8e1f2b', pip: '#ffffff', shine: '#ff9aa0' },
  'dice-neon': { face: '#101018', edge: '#000000', pip: '#39ff9c', outline: '#39ff9c' },
  'dice-gold': { face: '#e9b632', edge: '#9a6f00', pip: '#5a3d00', shine: '#fff1b0' },
};

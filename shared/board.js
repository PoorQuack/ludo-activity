// Board geometry and rule constants shared by the server and the client.
//
// The board is a 15x15 grid, addressed as [row, col].
// Seat order is clockwise: red (top-left), green (top-right),
// yellow (bottom-right), blue (bottom-left).
//
// A token's position is its "progress" from its own start square:
//   -1        = in base
//   0..50     = on the shared 52-square track
//   51..55    = in its own coloured home column
//   56        = finished (centre)

export const COLORS = ['red', 'green', 'yellow', 'blue'];
export const COLOR_HEX = {
  red: '#e5484d',
  green: '#30a46c',
  yellow: '#f5b301',
  blue: '#3e63dd',
};

export const TRACK_LEN = 52;
export const LAST_TRACK = 50;
export const FINISHED = 56;
export const START_INDEX = [0, 13, 26, 39];
// Start squares + star squares are safe: no captures there.
export const SAFE_INDICES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

function segment(from, to) {
  const cells = [];
  const [r1, c1] = from;
  const [r2, c2] = to;
  const dr = Math.sign(r2 - r1);
  const dc = Math.sign(c2 - c1);
  let r = r1;
  let c = c1;
  cells.push([r, c]);
  while (r !== r2 || c !== c2) {
    r += dr;
    c += dc;
    cells.push([r, c]);
  }
  return cells;
}

// The 52 shared squares, clockwise, starting at red's start square.
export const TRACK = [
  ...segment([6, 1], [6, 5]),
  ...segment([5, 6], [0, 6]),
  [0, 7],
  ...segment([0, 8], [5, 8]),
  ...segment([6, 9], [6, 14]),
  [7, 14],
  ...segment([8, 14], [8, 9]),
  ...segment([9, 8], [14, 8]),
  [14, 7],
  ...segment([14, 6], [9, 6]),
  ...segment([8, 5], [8, 0]),
  [7, 0],
  [6, 0],
];

if (TRACK.length !== TRACK_LEN) throw new Error('Track must have 52 squares');

// Home columns (progress 51..55) for each seat.
export const HOME_COLUMNS = [
  segment([7, 1], [7, 5]),
  segment([1, 7], [5, 7]),
  segment([7, 13], [7, 9]),
  segment([13, 7], [9, 7]),
];

// Where each seat's finished tokens sit inside the centre triangle.
export const FINISH_CELLS = [
  [7, 6.35],
  [6.35, 7],
  [7, 7.65],
  [7.65, 7],
];

// Base quadrant top-left corners and the 4 parking spots within them.
export const BASE_ORIGIN = [
  [0, 0],
  [0, 9],
  [9, 9],
  [9, 0],
];
const BASE_SPOTS = [
  [1.5, 1.5],
  [1.5, 3.5],
  [3.5, 1.5],
  [3.5, 3.5],
];

export function trackIndex(seat, progress) {
  return (START_INDEX[seat] + progress) % TRACK_LEN;
}

// Centre point (in cell units, e.g. 6.5) of a token for drawing.
export function tokenCenter(seat, progress, tokenIdx) {
  if (progress < 0) {
    const [or, oc] = BASE_ORIGIN[seat];
    const [sr, sc] = BASE_SPOTS[tokenIdx];
    return [or + sr + 0.5, oc + sc + 0.5];
  }
  if (progress >= FINISHED) {
    const [r, c] = FINISH_CELLS[seat];
    return [r + 0.5, c + 0.5];
  }
  const [r, c] = progress <= LAST_TRACK ? TRACK[trackIndex(seat, progress)] : HOME_COLUMNS[seat][progress - 51];
  return [r + 0.5, c + 0.5];
}

// A stable key for "which square is this token on" (for stacking offsets).
export function cellKey(seat, progress, tokenIdx) {
  if (progress < 0) return `base-${seat}-${tokenIdx}`;
  if (progress >= FINISHED) return `finish-${seat}`;
  if (progress <= LAST_TRACK) return `t-${trackIndex(seat, progress)}`;
  return `h-${seat}-${progress}`;
}

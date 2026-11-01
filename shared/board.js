// Board geometry and rule constants shared by the server and the client.
//
// A board is n identical "arms" (3 squares wide, 6 long) around a central hub:
// 4 arms make the classic square board, 6 arms the hexagon board. Seats go
// clockwise, starting with the left arm. Coordinates are in square-sized units,
// with (0, 0) at the centre of the board and y pointing down.
//
// A token's position is its "progress" from its own start square:
//   -1                         = in base
//   0..board.lastTrack         = on the shared track (13 squares per arm)
//   lastTrack+1..lastTrack+5   = in its own coloured home column
//   board.finished             = done (centre)

export const COLOR_HEX = {
  red: '#e5484d',
  green: '#30a46c',
  yellow: '#f5b301',
  blue: '#3e63dd',
  purple: '#8e4ec6',
  orange: '#f76b15',
};

export const MODES = {
  '2p': { label: '2 Players', arms: 4, seats: [0, 2] },
  '4p': { label: '4 Players', arms: 4, seats: [0, 1, 2, 3] },
  '6p': { label: '6 Players', arms: 6, seats: [0, 1, 2, 3, 4, 5] },
};

const PALETTES = {
  4: ['red', 'green', 'yellow', 'blue'],
  6: ['red', 'green', 'purple', 'yellow', 'blue', 'orange'],
};
const ARM_SQUARES = 13; // shared track squares per arm
const START_OFFSET = 8; // where a seat's start square sits along its own arm
const QUAD = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

export function makeBoard(n) {
  const hub = 1.5 / Math.tan(Math.PI / n); // centre → inner end of each arm
  const armAngle = (arm) => Math.PI + (arm * 2 * Math.PI) / n;

  // Square `d` (1 = next to the hub … 6 = outer end) in lane `v` of an arm.
  // Lane -1 faces the previous seat's arm, lane +1 faces the next seat's arm.
  function square(arm, d, v) {
    const a = armAngle(arm);
    const r = hub + d - 0.5;
    return { x: Math.cos(a) * r - Math.sin(a) * v, y: Math.sin(a) * r + Math.cos(a) * v, angle: a };
  }

  // Around each arm: out along lane -1, across the end, back in along lane +1.
  const loop = [];
  for (let arm = 0; arm < n; arm++) {
    for (let d = 1; d <= 6; d++) loop.push(square(arm, d, -1));
    loop.push(square(arm, 6, 0));
    for (let d = 6; d >= 1; d--) loop.push(square(arm, d, 1));
  }
  // Index 0 of the track is seat 0's start square.
  const track = [...loop.slice(START_OFFSET), ...loop.slice(0, START_OFFSET)];
  const trackLen = track.length;
  const lastTrack = trackLen - 2;
  const finished = lastTrack + 6;

  const seats = [...Array(n).keys()];
  const startIndex = seats.map((s) => s * ARM_SQUARES);
  // Start squares + star squares are safe: no captures there.
  const safe = new Set(startIndex.flatMap((i) => [i, i + 8]));
  const homeColumns = seats.map((s) => [5, 4, 3, 2, 1].map((d) => square(s, d, 0)));
  // Finished pins stand near the outer edge of their triangle, clear of the dice in the middle.
  const finishSpots = seats.map((s) => ({
    x: Math.cos(armAngle(s)) * hub * 0.78,
    y: Math.sin(armAngle(s)) * hub * 0.78,
  }));

  // Bases sit in the gap between a seat's arm and the next one, beside its start square.
  const square4 = n === 4;
  const bases = seats.map((s) => {
    const a = armAngle(s) + Math.PI / n;
    const dist = square4 ? 4.5 * Math.SQRT2 : 6.7;
    return { x: Math.cos(a) * dist, y: Math.sin(a) * dist, size: square4 ? 3 : 1.75, square: square4 };
  });
  const baseSpread = square4 ? 1 : 0.72;

  const trackIndex = (seat, progress) => (startIndex[seat] + progress) % trackLen;

  // Centre point of a token for drawing.
  function tokenCenter(seat, progress, tokenIdx) {
    if (progress < 0) {
      const b = bases[seat];
      const [ox, oy] = QUAD[tokenIdx];
      return { x: b.x + ox * baseSpread, y: b.y + oy * baseSpread };
    }
    if (progress >= finished) return finishSpots[seat];
    const sq = progress <= lastTrack ? track[trackIndex(seat, progress)] : homeColumns[seat][progress - lastTrack - 1];
    return { x: sq.x, y: sq.y };
  }

  // A stable key for "which square is this token on" (for stacking offsets).
  function cellKey(seat, progress, tokenIdx) {
    if (progress < 0) return `base-${seat}-${tokenIdx}`;
    if (progress >= finished) return `finish-${seat}`;
    if (progress <= lastTrack) return `t-${trackIndex(seat, progress)}`;
    return `h-${seat}-${progress}`;
  }

  // Half-width of the board: the furthest corner of any square or base.
  let extent = 0;
  for (const sq of [...track, ...homeColumns.flat()]) {
    const c = Math.cos(sq.angle);
    const sn = Math.sin(sq.angle);
    for (const [du, dv] of QUAD) {
      const x = sq.x + (c * du - sn * dv) / 2;
      const y = sq.y + (sn * du + c * dv) / 2;
      extent = Math.max(extent, Math.abs(x), Math.abs(y));
    }
  }
  for (const b of bases) extent = Math.max(extent, Math.abs(b.x) + b.size, Math.abs(b.y) + b.size);

  return {
    arms: n,
    colors: PALETTES[n],
    hub,
    armAngle,
    track,
    trackLen,
    lastTrack,
    finished,
    startIndex,
    safe,
    homeColumns,
    finishSpots,
    bases,
    baseSpread,
    extent,
    trackIndex,
    tokenCenter,
    cellKey,
  };
}

export const BOARDS = { 4: makeBoard(4), 6: makeBoard(6) };
export const boardFor = (mode) => BOARDS[MODES[mode].arms];

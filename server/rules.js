// Pure Ludo rules. No networking, no timers — easy to test.
// Every function takes the board (see shared/board.js); it defaults to the 4-player board.
import { BOARDS } from '../shared/board.js';

const DEFAULT_BOARD = BOARDS[4];

export function newTokens(seats = 4) {
  return Array.from({ length: seats }, () => [-1, -1, -1, -1]);
}

// How far along a seat is: 0 with every token in base, 1 with all four home.
// Used to shrink payouts when a game ends before anyone finished.
export function progressShare(tokens, seat, board = DEFAULT_BOARD) {
  return tokens[seat].reduce((sum, p) => sum + Math.min(p + 1, board.finished), 0) / (4 * board.finished);
}

// Where token `t` of `seat` would end up with roll `dice`, or null if illegal.
export function targetProgress(tokens, seat, t, dice, board = DEFAULT_BOARD) {
  const p = tokens[seat][t];
  if (p === board.finished) return null;
  if (p < 0) return dice === 6 ? 0 : null;
  const next = p + dice;
  return next <= board.finished ? next : null;
}

export function legalMoves(tokens, seat, dice, board = DEFAULT_BOARD) {
  const moves = [];
  for (let t = 0; t < 4; t++) {
    if (targetProgress(tokens, seat, t, dice, board) !== null) moves.push(t);
  }
  return moves;
}

// The opponent tokens captured if `seat` lands on `progress`: one token of each colour on that
// square (2 greens and 2 blues there: one green and one blue go home). None on safe squares.
export function capturesAt(tokens, seat, progress, activeSeats, board = DEFAULT_BOARD) {
  if (progress < 0 || progress > board.lastTrack) return [];
  const idx = board.trackIndex(seat, progress);
  if (board.safe.has(idx)) return [];
  const captured = [];
  for (const other of activeSeats) {
    if (other === seat) continue;
    const t = tokens[other].findIndex((p) => p >= 0 && p <= board.lastTrack && board.trackIndex(other, p) === idx);
    if (t >= 0) captured.push({ seat: other, token: t });
  }
  return captured;
}

// Applies a move in place. Returns a description used for animation/logging.
export function applyMove(tokens, seat, t, dice, activeSeats, board = DEFAULT_BOARD) {
  const from = tokens[seat][t];
  const to = targetProgress(tokens, seat, t, dice, board);
  if (to === null) throw new Error('Illegal move');
  const captured = capturesAt(tokens, seat, to, activeSeats, board);
  tokens[seat][t] = to;
  for (const c of captured) tokens[c.seat][c.token] = -1;
  return {
    seat,
    token: t,
    from,
    to,
    captured,
    finishedToken: to === board.finished,
    allHome: tokens[seat].every((p) => p === board.finished),
  };
}

// Simple bot: prefer finishing, capturing, leaving base, reaching safety, then progress.
export function chooseBotMove(tokens, seat, dice, activeSeats, board = DEFAULT_BOARD) {
  const moves = legalMoves(tokens, seat, dice, board);
  if (moves.length === 0) return null;
  let best = moves[0];
  let bestScore = -Infinity;
  for (const t of moves) {
    const from = tokens[seat][t];
    const to = targetProgress(tokens, seat, t, dice, board);
    let score = Math.random(); // tie-breaker
    if (to === board.finished) score += 100;
    score += capturesAt(tokens, seat, to, activeSeats, board).length * 80;
    if (from < 0) score += 60;
    if (to > board.lastTrack && from <= board.lastTrack) score += 50;
    if (to <= board.lastTrack && board.safe.has(board.trackIndex(seat, to))) score += 25;
    if (danger(tokens, seat, from, activeSeats, board)) score += 30; // escape a threat
    if (to <= board.lastTrack && danger(tokens, seat, to, activeSeats, board)) score -= 40;
    score += to / 10;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

// Is a token at `progress` within 1–6 squares in front of an opponent?
function danger(tokens, seat, progress, activeSeats, board) {
  if (progress < 0 || progress > board.lastTrack) return false;
  const idx = board.trackIndex(seat, progress);
  if (board.safe.has(idx)) return false;
  for (const other of activeSeats) {
    if (other === seat) continue;
    for (const p of tokens[other]) {
      if (p < 0 || p > board.lastTrack) continue;
      const oIdx = board.trackIndex(other, p);
      const dist = (idx - oIdx + board.trackLen) % board.trackLen;
      // Opponent must still be on the track for those squares.
      if (dist >= 1 && dist <= 6 && p + dist <= board.lastTrack) return true;
    }
  }
  return false;
}

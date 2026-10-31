// Pure Ludo rules. No networking, no timers — easy to test.
import { FINISHED, LAST_TRACK, SAFE_INDICES, trackIndex } from '../shared/board.js';

export function newTokens() {
  return [0, 1, 2, 3].map(() => [-1, -1, -1, -1]);
}

// Where token `t` of `seat` would end up with roll `dice`, or null if illegal.
export function targetProgress(tokens, seat, t, dice) {
  const p = tokens[seat][t];
  if (p === FINISHED) return null;
  if (p < 0) return dice === 6 ? 0 : null;
  const next = p + dice;
  return next <= FINISHED ? next : null;
}

export function legalMoves(tokens, seat, dice) {
  const moves = [];
  for (let t = 0; t < 4; t++) {
    if (targetProgress(tokens, seat, t, dice) !== null) moves.push(t);
  }
  return moves;
}

// Opponent tokens that would be captured if `seat` lands on `progress`.
export function capturesAt(tokens, seat, progress, activeSeats) {
  if (progress < 0 || progress > LAST_TRACK) return [];
  const idx = trackIndex(seat, progress);
  if (SAFE_INDICES.has(idx)) return [];
  const hits = [];
  for (const other of activeSeats) {
    if (other === seat) continue;
    tokens[other].forEach((p, t) => {
      if (p >= 0 && p <= LAST_TRACK && trackIndex(other, p) === idx) hits.push({ seat: other, token: t });
    });
  }
  return hits;
}

// Applies a move in place. Returns a description used for animation/logging.
export function applyMove(tokens, seat, t, dice, activeSeats) {
  const from = tokens[seat][t];
  const to = targetProgress(tokens, seat, t, dice);
  if (to === null) throw new Error('Illegal move');
  const captured = capturesAt(tokens, seat, to, activeSeats);
  tokens[seat][t] = to;
  for (const c of captured) tokens[c.seat][c.token] = -1;
  return {
    seat,
    token: t,
    from,
    to,
    captured,
    finishedToken: to === FINISHED,
    allHome: tokens[seat].every((p) => p === FINISHED),
  };
}

// Simple bot: prefer finishing, capturing, leaving base, reaching safety, then progress.
export function chooseBotMove(tokens, seat, dice, activeSeats) {
  const moves = legalMoves(tokens, seat, dice);
  if (moves.length === 0) return null;
  let best = moves[0];
  let bestScore = -Infinity;
  for (const t of moves) {
    const from = tokens[seat][t];
    const to = targetProgress(tokens, seat, t, dice);
    let score = Math.random(); // tie-breaker
    if (to === FINISHED) score += 100;
    score += capturesAt(tokens, seat, to, activeSeats).length * 80;
    if (from < 0) score += 60;
    if (to > LAST_TRACK && from <= LAST_TRACK) score += 50;
    if (to <= LAST_TRACK && SAFE_INDICES.has(trackIndex(seat, to))) score += 25;
    if (danger(tokens, seat, from, activeSeats)) score += 30; // escape a threat
    if (to <= LAST_TRACK && danger(tokens, seat, to, activeSeats)) score -= 40;
    score += to / 10;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

// Is a token at `progress` within 1–6 squares in front of an opponent?
function danger(tokens, seat, progress, activeSeats) {
  if (progress < 0 || progress > LAST_TRACK) return false;
  const idx = trackIndex(seat, progress);
  if (SAFE_INDICES.has(idx)) return false;
  for (const other of activeSeats) {
    if (other === seat) continue;
    for (const p of tokens[other]) {
      if (p < 0 || p > LAST_TRACK) continue;
      const oIdx = trackIndex(other, p);
      const dist = (idx - oIdx + 52) % 52;
      // Opponent must still be on the track for those squares.
      if (dist >= 1 && dist <= 6 && p + dist <= LAST_TRACK) return true;
    }
  }
  return false;
}

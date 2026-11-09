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

// `team` (optional, everywhere below): seat -> team number (see teamsOf in shared/board.js).
// Without it every seat is its own team. Teammates never capture each other, and a teammate's
// token keeps yours company: two or more tokens of one team on a square are safe there.
const solo = (s) => s;
const teamFn = (team) => (team ? (s) => team[s] : solo);

// The tokens of `seat` standing on track square `idx` (a board index, not a progress).
export function tokensOnSquare(tokens, seat, idx, board = DEFAULT_BOARD) {
  const out = [];
  tokens[seat].forEach((p, t) => {
    if (p >= 0 && p <= board.lastTrack && board.trackIndex(seat, p) === idx) out.push(t);
  });
  return out;
}

// How many tokens of `seat`'s team stand on square `idx` (`seats`: the seats in the game).
function teamCount(tokens, seat, idx, seats, board, team) {
  const t = teamFn(team);
  return seats.filter((o) => t(o) === t(seat)).reduce((n, o) => n + tokensOnSquare(tokens, o, idx, board).length, 0);
}

// Two or more tokens of one colour (or, in team modes, of one team) on the same square make a
// pair: like a safe square, nobody can capture them there. Anyone can still pass over them or
// land beside them.
export function isPair(tokens, seat, idx, board = DEFAULT_BOARD, team = null, seats = null) {
  return teamCount(tokens, seat, idx, seats || [seat], board, team) >= 2;
}

// The tokens captured if `seat` lands on `progress`: every lone token of another team on that
// square. Nothing is captured on a safe square, teammates are never captured, and a team with a
// pair there is left alone (a green pair and a lone blue on the square: only the blue goes home).
export function capturesAt(tokens, seat, progress, activeSeats, board = DEFAULT_BOARD, team = null) {
  if (progress < 0 || progress > board.lastTrack) return [];
  const idx = board.trackIndex(seat, progress);
  if (board.safe.has(idx)) return [];
  const t = teamFn(team);
  const captured = [];
  for (const other of activeSeats) {
    if (t(other) === t(seat)) continue;
    const here = tokensOnSquare(tokens, other, idx, board);
    if (here.length === 1 && teamCount(tokens, other, idx, activeSeats, board, team) === 1) {
      captured.push({ seat: other, token: here[0] });
    }
  }
  return captured;
}

// Applies a move in place. Returns a description used for animation/logging.
export function applyMove(tokens, seat, t, dice, activeSeats, board = DEFAULT_BOARD, team = null) {
  const from = tokens[seat][t];
  const to = targetProgress(tokens, seat, t, dice, board);
  if (to === null) throw new Error('Illegal move');
  const captured = capturesAt(tokens, seat, to, activeSeats, board, team);
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

// Simple bot: prefer finishing, capturing, leaving base, reaching safety (a safe square or a
// pair), then progress; avoid breaking up a pair that would leave its partner in danger.
export function chooseBotMove(tokens, seat, dice, activeSeats, board = DEFAULT_BOARD, team = null) {
  const tm = teamFn(team);
  const mates = activeSeats.filter((o) => tm(o) === tm(seat));
  // tokens of my team on a square, not counting the token being moved
  const company = (idx, moving) => mates.reduce((n, o) => n + tokensOnSquare(tokens, o, idx, board).filter((k) => o !== seat || k !== moving).length, 0);
  const moves = legalMoves(tokens, seat, dice, board);
  if (moves.length === 0) return null;
  let best = moves[0];
  let bestScore = -Infinity;
  for (const t of moves) {
    const from = tokens[seat][t];
    const to = targetProgress(tokens, seat, t, dice, board);
    let score = Math.random(); // tie-breaker
    if (to === board.finished) score += 100;
    score += capturesAt(tokens, seat, to, activeSeats, board, team).length * 80;
    if (from < 0) score += 60;
    if (to > board.lastTrack && from <= board.lastTrack) score += 50;
    const toIdx = to <= board.lastTrack ? board.trackIndex(seat, to) : -1;
    const joinsPair = toIdx >= 0 && company(toIdx, t) > 0;
    if (toIdx >= 0 && (board.safe.has(toIdx) || joinsPair)) score += 25;
    if (danger(tokens, seat, from, activeSeats, board, t, team)) score += 30; // escape a threat
    if (toIdx >= 0 && !joinsPair && danger(tokens, seat, to, activeSeats, board, t, team)) score -= 40;
    // Leaving a pair of exactly two leaves the other token on its own: worse if it's threatened
    if (from >= 0 && from <= board.lastTrack) {
      const fromIdx = board.trackIndex(seat, from);
      if (company(fromIdx, t) === 1 && !board.safe.has(fromIdx) && threatened(tokens, seat, fromIdx, activeSeats, board, team)) score -= 35;
    }
    score += to / 10;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

// Would a lone token of `seat` at `progress` be within 1–6 squares in front of an opponent?
// (`moving`: the token being moved, which doesn't count as company; on a safe square or with
// another of its own tokens there it's safe.)
function danger(tokens, seat, progress, activeSeats, board, moving = -1, team = null) {
  if (progress < 0 || progress > board.lastTrack) return false;
  const idx = board.trackIndex(seat, progress);
  if (board.safe.has(idx)) return false;
  const tm = teamFn(team);
  for (const o of activeSeats) {
    if (tm(o) !== tm(seat)) continue;
    if (tokensOnSquare(tokens, o, idx, board).some((k) => o !== seat || k !== moving)) return false; // has company
  }
  return threatened(tokens, seat, idx, activeSeats, board, team);
}

// Is track square `idx` 1–6 squares in front of an opponent's token?
function threatened(tokens, seat, idx, activeSeats, board, team = null) {
  const tm = teamFn(team);
  for (const other of activeSeats) {
    if (tm(other) === tm(seat)) continue;
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

// Pairs: two or more tokens of one colour on a square can't be captured there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newTokens, legalMoves, applyMove, capturesAt, isPair, chooseBotMove } from '../server/rules.js';
import { BOARDS } from '../shared/board.js';

const B4 = BOARDS[4];
const B6 = BOARDS[6];
// Seat s's progress for board square idx (4-player board)
const at = (s, idx, board = B4) => (idx - board.startIndex[s] + board.trackLen) % board.trackLen;

test('a lone token is captured; a pair on the same square is not', () => {
  const t = newTokens();
  t[1][0] = at(1, 5);
  t[0][0] = 2;
  assert.equal(applyMove(t, 0, 0, 3, [0, 1]).captured.length, 1);
  assert.equal(t[1][0], -1);

  const p = newTokens();
  p[1][0] = at(1, 5);
  p[1][1] = at(1, 5);
  p[0][0] = 2;
  assert.ok(isPair(p, 1, 5));
  const res = applyMove(p, 0, 0, 3, [0, 1]);
  assert.deepEqual(res.captured, []);
  assert.equal(p[1][0], at(1, 5));
  assert.equal(p[1][1], at(1, 5));
  assert.equal(p[0][0], 5, 'the lander still lands there, beside the pair');
});

test('three of a colour are safe too', () => {
  const t = newTokens();
  for (const k of [0, 1, 2]) t[1][k] = at(1, 5);
  t[0][0] = 2;
  assert.deepEqual(applyMove(t, 0, 0, 3, [0, 1]).captured, []);
});

test('with a pair and a lone token of another colour, only the lone one goes home', () => {
  const t = newTokens();
  t[1][0] = at(1, 5);
  t[1][1] = at(1, 5); // green pair
  t[3][0] = at(3, 5); // lone blue
  t[0][0] = 2;
  const res = applyMove(t, 0, 0, 3, [0, 1, 3]);
  assert.deepEqual(res.captured, [{ seat: 3, token: 0 }]);
  assert.equal(t[1].filter((p) => p === at(1, 5)).length, 2);
});

test('two pairs of different colours on one square are both safe', () => {
  const t = newTokens();
  t[1][0] = t[1][1] = at(1, 5);
  t[3][0] = t[3][2] = at(3, 5);
  t[0][0] = 2;
  assert.deepEqual(capturesAt(t, 0, 5, [0, 1, 3]), []);
});

test('a pair does not block: others can pass over it or land on it', () => {
  const t = newTokens();
  t[1][0] = t[1][1] = at(1, 5);
  t[0][0] = 2;
  assert.deepEqual(legalMoves(t, 0, 3), [0]); // lands on the pair
  assert.ok(legalMoves(t, 0, 6).includes(0)); // jumps past it (a 6 could also bring out a token)
  applyMove(t, 0, 0, 6, [0, 1]);
  assert.equal(t[0][0], 8);
});

test('a token landing beside a pair is still fair game for that pair colour', () => {
  // Red lands beside the green pair; green then lands a third token there and captures red
  const t = newTokens();
  t[1][0] = t[1][1] = at(1, 5);
  t[1][2] = at(1, 5) - 4;
  t[0][0] = 2;
  applyMove(t, 0, 0, 3, [0, 1]);
  const res = applyMove(t, 1, 2, 4, [0, 1]);
  assert.deepEqual(res.captured, [{ seat: 0, token: 0 }]);
});

test('when a pair splits, the token left behind can be captured', () => {
  const t = newTokens();
  t[1][0] = t[1][1] = at(1, 5);
  t[0][0] = 2;
  applyMove(t, 1, 0, 1, [0, 1]); // one green moves on
  assert.equal(isPair(t, 1, 5), false);
  assert.deepEqual(capturesAt(t, 0, 5, [0, 1]), [{ seat: 1, token: 1 }]);
});

test('your own pair with an opponent pair beside it: a lone opponent there still goes', () => {
  // Landing on a square where you already have a token captures the lone opponent there too
  const t = newTokens();
  t[0][1] = 5;
  t[2][0] = at(2, 5);
  t[0][0] = 2;
  const res = applyMove(t, 0, 0, 3, [0, 2]);
  assert.deepEqual(res.captured, [{ seat: 2, token: 0 }]);
  assert.ok(isPair(t, 0, 5));
});

test('pairs work on the hexagon board', () => {
  const t = newTokens(6);
  const idx = 30;
  t[4][0] = t[4][3] = at(4, idx, B6);
  t[5][0] = at(5, idx, B6);
  t[2][0] = at(2, idx, B6) - 2;
  const res = applyMove(t, 2, 0, 2, [0, 1, 2, 3, 4, 5], B6);
  assert.deepEqual(res.captured, [{ seat: 5, token: 0 }]);
});

test('bots join a pair to escape a threat', () => {
  // Red's token 1 at 17 has green two squares behind it; moving it 3 joins token 0 at 20.
  let joined = 0;
  for (let i = 0; i < 40; i++) {
    const t = newTokens();
    t[0][0] = 20;
    t[0][1] = 17;
    t[1][0] = at(1, 15);
    if (chooseBotMove(t, 0, 3, [0, 1]) === 1) joined++;
  }
  assert.equal(joined, 40);
});

test("bots don't break up a pair that's under threat", () => {
  // Red's pair at 20 has green three squares behind; red's other token at 5 is safe to move.
  let kept = 0;
  for (let i = 0; i < 40; i++) {
    const t = newTokens();
    t[0][0] = t[0][1] = 20;
    t[0][2] = 30;
    t[1][0] = at(1, 17);
    if (chooseBotMove(t, 0, 2, [0, 1]) === 2) kept++;
  }
  assert.equal(kept, 40);
});

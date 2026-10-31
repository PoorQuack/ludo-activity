import test from 'node:test';
import assert from 'node:assert/strict';
import { newTokens, legalMoves, applyMove, capturesAt } from '../server/rules.js';
import { Room } from '../server/room.js';
import { TRACK, trackIndex } from '../shared/board.js';

test('track is 52 unique squares', () => {
  assert.equal(new Set(TRACK.map((c) => c.join())).size, 52);
});

test('need a 6 to leave base', () => {
  const t = newTokens();
  assert.deepEqual(legalMoves(t, 0, 5), []);
  assert.deepEqual(legalMoves(t, 0, 6), [0, 1, 2, 3]);
});

test('exact roll needed to finish', () => {
  const t = newTokens();
  t[0] = [54, -1, -1, -1];
  assert.deepEqual(legalMoves(t, 0, 3), []);
  assert.deepEqual(legalMoves(t, 0, 2), [0]);
});

test('capture sends opponent home, but not on safe squares', () => {
  const t = newTokens();
  // green token at red progress 5 (global index 5)
  const greenP = (5 - 13 + 52) % 52;
  t[1][0] = greenP;
  t[0][0] = 2;
  assert.equal(trackIndex(1, greenP), 5);
  const res = applyMove(t, 0, 0, 3, [0, 1]);
  assert.equal(res.captured.length, 1);
  assert.equal(t[1][0], -1);

  // star square (index 8) is safe
  const t2 = newTokens();
  t2[1][0] = (8 - 13 + 52) % 52;
  assert.deepEqual(capturesAt(t2, 0, 8, [0, 1]), []);
});

test('bots can play a full game to the end', async () => {
  let room;
  const done = new Promise((resolve) => {
    room = new Room('t', {
      delays: { bot: 0, noMove: 0, timeout: 0 },
      onChange: (r) => r.phase === 'finished' && resolve(),
    });
  });
  const human = { id: 'h', name: 'Human' };
  room.connect(human);
  room.sit(human, 0);
  room.addBot(human, 2);
  room.start(human);
  room.disconnect(human); // seat goes on autopilot
  await done;
  assert.equal(room.winners.length, 2);
  room.destroy();
});

// Testing switch (scripts/rig-dice.sh): two 6s to start every turn; the game pays nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';
import { rig, unrig, isRigged } from '../server/rig.js';

function room() {
  const r = new Room('t', { rng: () => 3, delays: { bot: 60_000, timeout: 60_000, noMove: 60_000, autoMove: 60_000 } });
  const a = { id: '111111', name: 'A' };
  const b = { id: '222222', name: 'B' };
  r.connect(a);
  r.connect(b);
  r.host(a);
  r.sit(a, 0);
  r.sit(b, 1);
  r.start(a);
  r.clearTimer();
  return { r, a, b };
}

test('a rigged player rolls 6, 6, then something else, every turn', () => {
  rig('111111', 5);
  const { r, a } = room();
  r.turn = 0;
  r.resetTurn();
  const rolls = [];
  for (let i = 0; i < 3; i++) {
    r.roll(a);
    rolls.push(r.lastRoll.value);
  }
  assert.deepEqual(rolls.slice(0, 2), [6, 6]);
  assert.ok(rolls[2] >= 1 && rolls[2] <= 5);
  assert.equal(r.rigged, true);
  unrig('111111');
  r.destroy();
});

test('the other player and expired / cleared rigs roll normally', () => {
  rig('111111', 5);
  const { r, b } = room();
  r.turn = 1;
  r.resetTurn();
  r.roll(b);
  assert.equal(r.lastRoll.value, 3); // the room's dice
  assert.equal(r.rigged, false);
  unrig('111111');
  assert.equal(isRigged('111111'), false);
  rig('333333', -1); // already run out
  assert.equal(isRigged('333333'), false);
  r.destroy();
});

test('a game with a rigged roll pays no coins or points', () => {
  const results = [];
  rig('111111', 5);
  const r = new Room('t', { onGameEnd: (x) => results.push(...x), delays: { bot: 60_000, timeout: 60_000, noMove: 60_000, autoMove: 60_000 } });
  const a = { id: '111111', name: 'A' };
  const b = { id: '222222', name: 'B' };
  r.connect(a);
  r.connect(b);
  r.host(a);
  r.sit(a, 0);
  r.sit(b, 1);
  r.start(a);
  r.turn = 0;
  r.resetTurn();
  r.roll(a);
  r.surrender(b);
  assert.equal(r.phase, 'finished');
  assert.equal(r.noCoins, 'test');
  assert.deepEqual(r.rewards, {});
  assert.deepEqual(results, []);
  // the next game is a normal one again
  unrig('111111');
  r.newGame(a);
  assert.equal(r.rigged, false);
  r.destroy();
});

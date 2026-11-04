// A dropped connection gets a few seconds' grace before the server plays that player's turns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';

const ann = { id: 'ann', name: 'Ann' };
const bob = { id: 'bob', name: 'Bob' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rooms = [];
test.afterEach(() => {
  for (const r of rooms.splice(0)) r.destroy();
});

// Ann and Bob playing, and it's Ann's turn.
function annsTurn(delays) {
  const room = new Room('t', { rng: () => 3, delays: { bot: 0, noMove: 60_000, autoMove: 60_000, timeout: 60_000, ...delays } });
  rooms.push(room);
  room.connect(ann);
  room.host(ann);
  room.connect(bob);
  room.join(bob);
  room.start(ann);
  room.turn = room.seatOf('ann');
  room.resetTurn();
  room.changed();
  return room;
}

test('a dropped player is not played for until their grace period is over', async () => {
  const room = annsTurn({ disconnectGrace: 60 });
  room.disconnect(ann);
  await wait(20);
  assert.equal(room.rolled, false); // still waiting for Ann
  assert.equal(room.snapshot().seats[room.seatOf('ann')].connected, false);
  await wait(80);
  assert.equal(room.rolled, true); // grace over: the server rolled for her
  assert.equal(room.timeouts[room.seatOf('ann')], 0); // and that doesn't count against her
});

test('coming back within the grace period: nothing was played for them', async () => {
  const room = annsTurn({ disconnectGrace: 60 });
  room.disconnect(ann);
  await wait(20);
  room.connect(ann);
  await wait(80);
  assert.equal(room.rolled, false);
  assert.equal(room.turn, room.seatOf('ann'));
  room.handle(ann, { action: 'roll' });
  assert.equal(room.dice, 3);
});

test('the turn clock keeps running during the grace period', async () => {
  const room = annsTurn({ disconnectGrace: 60_000, timeout: 30 });
  room.disconnect(ann);
  await wait(60);
  assert.equal(room.rolled, true); // the clock ran out first: played for her
  assert.equal(room.timeouts[room.seatOf('ann')], 0);
});

test('a connected player who lets the clock run out still gets a timeout', async () => {
  const room = annsTurn({ timeout: 20 });
  await wait(50);
  assert.equal(room.timeouts[room.seatOf('ann')], 1);
});

// ---------- everyone leaves: the game pauses, then ends with no coins ----------

test('when every player has left, the game pauses: nothing is played and the clock stops', async () => {
  const room = annsTurn({ disconnectGrace: 0, pause: 60_000 });
  room.disconnect(ann);
  room.disconnect(bob);
  await wait(30);
  assert.equal(room.rolled, false);
  assert.equal(room.turnDeadline, null);
  assert.equal(room.snapshot().paused, true);
  assert.match(room.log.at(-1), /Everyone left/);
});

test('watchers alone do not keep a paused game going', async () => {
  const room = annsTurn({ disconnectGrace: 0, pause: 60_000 });
  room.connect({ id: 'cat', name: 'Cat' }); // watching, not playing
  room.disconnect(ann);
  room.disconnect(bob);
  await wait(30);
  assert.equal(room.snapshot().paused, true);
  assert.equal(room.rolled, false);
});

test('a player coming back un-pauses the game with a fresh turn clock', async () => {
  const room = annsTurn({ disconnectGrace: 0, pause: 60_000 });
  room.disconnect(ann);
  room.disconnect(bob);
  await wait(10);
  room.connect(bob);
  assert.equal(room.snapshot().paused, false);
  assert.ok(room.turnDeadline > Date.now() + 50_000);
  assert.match(room.log.at(-1), /back/);
  await wait(30);
  assert.equal(room.rolled, true); // Ann is still away (grace 0): her turn is played for her
});

test('nobody back within the pause: the game ends and nobody is paid', async () => {
  const room = annsTurn({ disconnectGrace: 0, pause: 40 });
  room.disconnect(ann);
  room.disconnect(bob);
  await wait(80);
  assert.equal(room.phase, 'finished');
  assert.equal(room.noCoins, 'abandoned');
  assert.deepEqual(room.rewards, {});
  room.connect(ann); // too late: still over
  assert.equal(room.phase, 'finished');
});

test('one player leaving does not pause a game the others are still playing', async () => {
  const room = annsTurn({ disconnectGrace: 0 });
  room.disconnect(ann);
  await wait(30);
  assert.equal(room.snapshot().paused, false);
  assert.equal(room.rolled, true); // Ann's turn was played for her
});

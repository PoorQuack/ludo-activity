// Games survive a server restart: rooms are saved on shutdown and picked back up on start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomDirectory } from '../server/rooms.js';

const ann = { id: 'ann', name: 'Ann' };
const bob = { id: 'bob', name: 'Bob' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Slow bots and clocks so nothing moves on its own unless a test wants it to.
const slow = { bot: 60_000, noMove: 60_000, autoMove: 60_000, timeout: 60_000 };

// Every directory a test makes is closed afterwards, even when the test fails — otherwise a
// leftover game timer keeps the test run (and so a deploy) waiting.
const dirs = [];
const newDir = (options) => {
  const dir = new RoomDirectory(options);
  dirs.push(dir);
  return dir;
};
test.afterEach(() => {
  for (const dir of dirs.splice(0)) dir.destroy();
});

// A 2-player game between Ann and Bob, then the "server" stops: everything goes through JSON.
function gameThenRestart({ delays = slow, rng = () => 3, graceMs = 60_000, before } = {}) {
  const old = newDir({ roomOptions: { delays, rng } });
  const room = old.create(ann, { visibility: 'private', mode: '2p', instanceId: 'call-1' });
  old.join(room, bob, { withCode: true });
  room.handle(ann, { action: 'start' });
  room.handle(ann, { action: 'setChat', on: true });
  before?.(room);
  const saved = JSON.parse(JSON.stringify(old.save()));
  old.destroy();
  const fresh = newDir({ roomOptions: { delays, rng } });
  const n = fresh.restore(saved, { graceMs });
  return { old: room, fresh, n, room: fresh.findCode(room.code) };
}

test('a game in progress comes back after a restart, same code, same board', () => {
  const { old, fresh, n, room } = gameThenRestart({
    before: (r) => {
      r.tokens[0] = [5, -1, -1, -1];
      r.tokens[1] = [12, 3, -1, -1];
      r.chat.push({ id: 1, userId: 'ann', name: 'Ann', text: 'gl', at: 1 });
    },
  });
  assert.equal(n, 1);
  assert.ok(room);
  assert.equal(room.id, old.id);
  assert.equal(room.phase, 'playing');
  assert.equal(room.turn, old.turn);
  assert.deepEqual(room.tokens, [[5, -1, -1, -1], [12, 3, -1, -1], ...old.tokens.slice(2)]);
  assert.equal(room.chat.at(-1).text, 'gl');
  assert.equal(room.visibility, 'private');
  assert.equal(room.hostId, 'ann');
  assert.ok(room.turnDeadline > Date.now() + 50_000); // a fresh clock for whoever's turn it is
  fresh.destroy();
});

test('players reconnecting after a restart get their seats back and can keep playing', () => {
  const { fresh, room, old } = gameThenRestart();
  for (const u of [ann, bob]) fresh.join(room, u, { instanceId: 'call-1', withCode: true });
  assert.equal(room.seatOf('ann'), old.seatOf('ann'));
  assert.equal(room.seatOf('bob'), old.seatOf('bob'));
  assert.equal(room.connected.size, 2);
  const player = room.seats[room.turn].userId === 'ann' ? ann : bob;
  room.handle(player, { action: 'roll' });
  assert.equal(room.dice, 3);
  fresh.destroy();
});

test('players who never come back are treated as gone once the grace time runs out', async () => {
  const { fresh, room } = gameThenRestart({ graceMs: 20 });
  fresh.join(room, bob, { withCode: true });
  await wait(40);
  assert.equal(room.seats[room.seatOf('ann')].connected, false); // Ann: her turns are now played for her
  assert.equal(room.seats[room.seatOf('bob')].connected, true);
  assert.equal(room.hostId, 'bob'); // the host didn't come back, so Bob is in charge
  fresh.destroy();
});

test('a turn that was waiting on a timer (no moves → next player) carries on after a restart', async () => {
  const delays = { ...slow, noMove: 10 };
  const { fresh, room, old } = gameThenRestart({
    delays,
    before: (r) => r.handle(r.seats[r.turn].userId === 'ann' ? ann : bob, { action: 'roll' }), // a 3, all in base: no moves
  });
  assert.equal(room.rolled, true);
  const first = old.turn;
  await wait(40);
  assert.notEqual(room.turn, first);
  assert.equal(room.rolled, false);
  fresh.destroy();
});

test('lobbies, kicked players and settings survive too', () => {
  const old = newDir();
  const room = old.create(ann, { visibility: 'public', mode: '4p' });
  old.join(room, bob, {});
  room.handle(ann, { action: 'kick', userId: 'bob' });
  room.handle(ann, { action: 'setChat', on: false });
  const saved = JSON.parse(JSON.stringify(old.save()));
  old.destroy();
  const fresh = newDir();
  fresh.restore(saved, { graceMs: 60_000 });
  const back = fresh.findCode(room.code);
  assert.equal(back.phase, 'lobby');
  assert.equal(back.chatOn, false);
  assert.throws(() => fresh.join(back, bob, { withCode: true }), /removed you/);
  fresh.join(back, ann, {});
  assert.equal(back.seatOf('ann'), 0);
  fresh.destroy();
});

test('old or unreadable saves are ignored instead of crashing the server', () => {
  const dir = newDir();
  const room = dir.create(ann, {});
  const saved = JSON.parse(JSON.stringify(dir.save()));
  dir.destroy();

  const stale = newDir();
  assert.equal(stale.restore({ ...saved, savedAt: Date.now() - 60 * 60_000 }), 0);
  assert.equal(stale.restore({ ...saved, version: 999 }), 0);
  assert.equal(stale.restore(null), 0);
  const mixed = { ...saved, rooms: [{ id: 'x', mode: 'nonsense' }, ...saved.rooms] };
  const errors = console.error;
  console.error = () => {};
  try {
    assert.equal(stale.restore(mixed), 1); // the bad room is skipped, the good one comes back
  } finally {
    console.error = errors;
  }
  assert.ok(stale.findCode(room.code));
  stale.destroy();
});

test('a restored room nobody returns to closes after the idle time', async () => {
  const old = newDir();
  old.create(ann, {});
  const saved = JSON.parse(JSON.stringify(old.save()));
  old.destroy();
  const removed = [];
  const fresh = newDir({ idleMs: 20, onRemove: (r) => removed.push(r.id) });
  fresh.restore(saved, { graceMs: 10 });
  await wait(50);
  assert.equal(fresh.rooms.size, 0);
  assert.equal(removed.length, 1);
});

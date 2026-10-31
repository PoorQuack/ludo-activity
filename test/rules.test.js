import test from 'node:test';
import assert from 'node:assert/strict';
import { newTokens, legalMoves, applyMove, capturesAt } from '../server/rules.js';
import { Room } from '../server/room.js';
import { ProfileStore } from '../server/store.js';
import { BOARDS } from '../shared/board.js';

const B4 = BOARDS[4];
const B6 = BOARDS[6];
const key = (sq) => `${sq.x.toFixed(2)},${sq.y.toFixed(2)}`;

test('4-player track is 52 unique squares', () => {
  assert.equal(new Set(B4.track.map(key)).size, 52);
  assert.equal(B4.finished, 56);
});

test('6-player board: 78 unique track squares, home columns off the track', () => {
  assert.equal(B6.trackLen, 78);
  const track = new Set(B6.track.map(key));
  assert.equal(track.size, 78);
  for (const sq of B6.homeColumns.flat()) assert.ok(!track.has(key(sq)));
  // Neighbouring track squares are next to each other (1 apart, or diagonal across a corner).
  B6.track.forEach((sq, i) => {
    const next = B6.track[(i + 1) % B6.trackLen];
    assert.ok(Math.hypot(sq.x - next.x, sq.y - next.y) < 1.5, `gap after square ${i}`);
  });
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

  const t6 = newTokens(6);
  t6[0] = [80, -1, -1, -1];
  assert.deepEqual(legalMoves(t6, 0, 3, B6), []);
  assert.deepEqual(legalMoves(t6, 0, 2, B6), [0]);
});

test('capture sends opponent home, but not on safe squares', () => {
  const t = newTokens();
  // green token at red progress 5 (global index 5)
  const greenP = (5 - 13 + 52) % 52;
  t[1][0] = greenP;
  t[0][0] = 2;
  assert.equal(B4.trackIndex(1, greenP), 5);
  const res = applyMove(t, 0, 0, 3, [0, 1]);
  assert.equal(res.captured.length, 1);
  assert.equal(t[1][0], -1);

  // star square (index 8) is safe
  const t2 = newTokens();
  t2[1][0] = (8 - 13 + 52) % 52;
  assert.deepEqual(capturesAt(t2, 0, 8, [0, 1]), []);
});

function playToEnd(setup, options = {}) {
  let room;
  const done = new Promise((resolve) => {
    room = new Room('t', {
      delays: { bot: 0, noMove: 0, timeout: 0 },
      onChange: (r) => r.phase === 'finished' && resolve(),
      ...options,
    });
  });
  const human = { id: 'h', name: 'Human' };
  room.connect(human);
  setup(room, human);
  room.start(human);
  room.disconnect(human); // seat goes on autopilot
  return done.then(() => room);
}

test('bots can play a full 4-player game to the end', async () => {
  const room = await playToEnd((room, human) => {
    room.sit(human, 0);
    room.addBot(human, 2);
  });
  assert.equal(room.winners.length, 2);
  room.destroy();
});

test('bots can play a full 6-player game to the end', async () => {
  const room = await playToEnd((room, human) => {
    room.setMode(human, '6p');
    room.sit(human, 0);
    room.addBot(human, 3);
    room.addBot(human, 5);
  });
  assert.equal(room.winners.length, 3);
  room.destroy();
});

test('switching mode keeps humans seated and drops bots first', () => {
  const room = new Room('t');
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };
  room.connect(a);
  room.connect(b);
  room.sit(a, 1);
  room.sit(b, 3);
  room.addBot(a, 0);
  room.setMode(a, '2p');
  assert.deepEqual(room.seats.map((s) => s?.userId ?? null), ['a', null, 'b', null]);
  assert.throws(() => room.sit(a, 1), /Bad seat/);

  room.setMode(a, '6p');
  assert.equal(room.seats.length, 6);
  room.fillBots(a);
  assert.equal(room.activeSeats().length, 6);
  room.destroy();
});

test('finishing a game pays coins (half when you are the only human)', async () => {
  const store = new ProfileStore(null);
  const room = await playToEnd(
    (room, human) => {
      room.sit(human, 0);
      room.addBot(human, 2);
    },
    { profiles: store },
  );
  const place = room.winners.indexOf(0);
  assert.ok(room.rewards[0] >= [100, 60][place] / 2);
  assert.equal(store.peek('h').coins, 150 + room.rewards[0]);
  room.destroy();
});

test('shop: buying needs coins, equipping needs ownership', () => {
  const store = new ProfileStore(null);
  assert.equal(store.get('u').coins, 150);
  assert.throws(() => store.buy('u', 'token-gem'), /Not enough coins/);
  assert.throws(() => store.equip('u', 'dice-gold'), /don't own/);
  store.addCoins('u', 200);
  store.buy('u', 'token-gem');
  assert.equal(store.peek('u').coins, 100);
  assert.equal(store.peek('u').equipped.token, 'token-gem');
  assert.throws(() => store.buy('u', 'token-gem'), /already own/);
  store.equip('u', 'token-classic');
  assert.equal(store.peek('u').equipped.token, 'token-classic');
});

test('emotes need a seat and ownership', () => {
  const store = new ProfileStore(null);
  const room = new Room('t', { profiles: store });
  const u = { id: 'u', name: 'U' };
  store.get('u');
  room.connect(u);
  assert.throws(() => room.emote(u, 'emote-thumbs'), /Take a seat/);
  room.sit(u, 0);
  room.emote(u, 'emote-thumbs');
  assert.equal(room.emotes.length, 1);
  assert.throws(() => room.emote(u, 'emote-crown'), /don't own/);
  room.destroy();
});

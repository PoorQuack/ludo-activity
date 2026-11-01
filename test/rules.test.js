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

  // two tokens on one square: only one is captured
  const t3 = newTokens();
  t3[1][0] = greenP;
  t3[1][1] = greenP;
  t3[0][0] = 2;
  const res3 = applyMove(t3, 0, 0, 3, [0, 1]);
  assert.equal(res3.captured.length, 1);
  assert.equal(t3[1].filter((p) => p === greenP).length, 1);

  // star square (index 8) is safe
  const t2 = newTokens();
  t2[1][0] = (8 - 13 + 52) % 52;
  assert.deepEqual(capturesAt(t2, 0, 8, [0, 1]), []);
});

function playToEnd(setup, options = {}) {
  let room;
  const done = new Promise((resolve) => {
    room = new Room('t', {
      delays: { bot: 0, noMove: 0, autoMove: 0, timeout: 0 },
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

// A room with two connected humans in seats 0 and 2, game started, seat 0 to play.
function twoPlayerRoom(rolls = []) {
  const room = new Room('t', {
    rng: () => rolls.shift() ?? 1,
    delays: { bot: 10_000, noMove: 10_000, autoMove: 20, timeout: 60_000 },
  });
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };
  room.connect(a);
  room.connect(b);
  room.sit(a, 0);
  room.sit(b, 2);
  room.start(a);
  room.turn = 0;
  return { room, a, b };
}

test('the only possible move is made automatically', async () => {
  const { room, a } = twoPlayerRoom([6]);
  room.roll(a); // all four pawns in base: every choice is the same
  assert.equal(room.movable.length, 4);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(room.tokens[0].filter((p) => p === 0).length, 1);
  room.destroy();
});

test('rolling 6s keeps the turn, however many in a row', async () => {
  const { room, a } = twoPlayerRoom([6, 6, 6, 6]);
  room.tokens[0] = [5, 10, -1, -1];
  for (let i = 0; i < 4; i++) {
    room.roll(a);
    room.move(a, 0);
    assert.equal(room.turn, 0);
  }
  assert.equal(room.tokens[0][0], 29);
  room.destroy();
});

test('a real choice is left to the player', async () => {
  const { room, a } = twoPlayerRoom([3]);
  room.tokens[0] = [5, 10, -1, -1];
  room.roll(a);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(room.tokens[0], [5, 10, -1, -1]);
  room.move(a, 1);
  assert.deepEqual(room.tokens[0], [5, 13, -1, -1]);
  room.destroy();
});

test('surrendering ends a two-player game and pays the winner only', () => {
  const store = new ProfileStore(null);
  const { room, a } = twoPlayerRoom();
  room.profiles = store;
  room.surrender(a);
  assert.equal(room.phase, 'finished');
  assert.deepEqual(room.winners, [2, 0]);
  assert.equal(room.rewards[0], undefined);
  assert.equal(room.rewards[2], 100);
  room.destroy();
});

test('surrendering on your turn passes the turn; game goes on with the rest', () => {
  const { room, a } = twoPlayerRoom();
  room.seats[1] = { userId: 'c', name: 'C', bot: false, connected: true };
  room.surrender(a);
  assert.equal(room.phase, 'playing');
  assert.notEqual(room.turn, 0);
  assert.throws(() => room.surrender(a), /not playing/);
  room.destroy();
});

test('only the host can end a running game, anyone can reset a finished one', () => {
  const { room, a, b } = twoPlayerRoom();
  assert.throws(() => room.newGame(b), /Only the host/);
  room.surrender(b);
  assert.equal(room.phase, 'finished');
  room.newGame(b);
  assert.equal(room.phase, 'lobby');
  assert.ok(room.seats.filter(Boolean).every((s) => !s.surrendered));
  room.destroy();
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

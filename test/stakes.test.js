// Stakes rooms: an entry fee in Gold Coins, paid by every human at the start, and the pot to the
// winner (or split across the winning team).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';
import { RoomDirectory } from '../server/rooms.js';
import { ProfileStore } from '../server/store.js';
import { BOARDS } from '../shared/board.js';
import { STAKES } from '../shared/shop.js';

const B4 = BOARDS[4];
const done = [B4.finished, B4.finished, B4.finished, B4.finished];
const users = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase() }));
const [a, b, c, d] = users;

// (the house fee is off here, so the splits are easy to read; it has its own test below)
function stakeRoom(stake, { coins = 1000, mode = '4p', seat = [a, b], visibility = 'private', winnerTakeAll = false, onGameEnd, fee = () => 0 } = {}) {
  const store = new ProfileStore(null);
  for (const u of users) store.get(u.id).coins = coins;
  const room = new Room('s', { profiles: store, visibility, onGameEnd, fee, delays: { bot: 60_000, timeout: 60_000 } });
  for (const u of users) room.connect(u);
  room.host(a);
  if (mode !== '4p') room.setMode(a, mode);
  seat.forEach((u, i) => room.sit(u, i));
  room.setStake(a, stake);
  room.winnerTakeAll = !!winnerTakeAll && stake > 0;
  return { room, store };
}
const coins = (store, u) => store.get(u.id).coins;

test('only the host sets the stake, in the lobby, from the allowed amounts (coins only)', () => {
  const { room } = stakeRoom(0);
  assert.throws(() => room.handle(b, { action: 'setStake', stake: 100 }), /Only the host/);
  assert.throws(() => room.setStake(a, 250), /Unknown stake/);
  assert.deepEqual(STAKES, [
    0, 100, 500,
    1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000,
    5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000,
  ]);
  for (const s of STAKES) {
    room.handle(a, { action: 'setStake', stake: s });
    assert.equal(room.stake, s);
  }
  assert.deepEqual(room.snapshot().stakes, STAKES);
  room.destroy();
});

test('every human pays the stake at the start; when the others surrender, the winner takes it all', () => {
  const { room, store } = stakeRoom(500, { seat: [a, b, c] });
  room.addBot(a, 3); // bots never pay in
  room.start(a);
  for (const u of [a, b, c]) assert.equal(coins(store, u), 500);
  assert.deepEqual(room.snapshot().pot, { stake: 500, total: 1500 });
  room.tokens[1] = done;
  room.winners = [1];
  room.surrender(a);
  room.surrender(c); // b wins
  assert.equal(room.phase, 'finished');
  assert.equal(room.potWon[1], 1500);
  assert.equal(coins(store, b), 500 + 1500 + (room.rewards[1] || 0));
  assert.equal(coins(store, a), 500);
  assert.equal(coins(store, c), 500);
  assert.equal(room.pot, null);
  room.destroy();
});

test("nobody pays if someone can't afford it, and the game doesn't start", () => {
  const { room, store } = stakeRoom(2500, { coins: 3000 });
  store.get('b').coins = 2499;
  assert.throws(() => room.start(a), /B doesn't have 2500 coins/);
  assert.equal(room.phase, 'lobby');
  assert.equal(coins(store, a), 3000);
  assert.equal(coins(store, b), 2499);
  assert.equal(room.snapshot().seats[1].canPay, false);
  assert.equal(room.snapshot().seats[0].canPay, true);
  room.destroy();
});

test('stakes need two people: one human and bots is refused', () => {
  const { room } = stakeRoom(100, { seat: [a] });
  room.addBot(a, 1);
  assert.throws(() => room.start(a), /at least 2 people/);
  room.destroy();
});

test('a bot finishing first does not take the pot: the best-placed human who paid does', () => {
  const { room, store } = stakeRoom(100, { seat: [a, b] });
  room.addBot(a, 2);
  room.start(a);
  // bot first, then a, then b
  room.winners = [2, 0, 1];
  room.tokens = [done, done, done, room.tokens[3]];
  room.finish();
  assert.deepEqual(room.potWon, { 0: 200 });
  assert.equal(coins(store, a), 900 + 200 + (room.rewards[0] || 0));
  room.destroy();
});

test('team games: the winning team splits the pot (odd coins to the first)', () => {
  const { room, store } = stakeRoom(100, { mode: '2v2', seat: [a, b, c, d] });
  room.start(a);
  room.tokens[0] = done;
  room.tokens[2] = done;
  room.winners = [0, 2];
  assert.equal(room.endIfOver(), true);
  assert.deepEqual(room.potWon, { 0: 200, 2: 200 }); // a + c (team 0) split 400
  assert.equal(coins(store, b), 900 + (room.rewards[1] || 0));
  room.destroy();
});

test('stakes come back when the game is abandoned, called off by the host, or rigged', () => {
  const one = stakeRoom(500);
  one.room.start(a);
  one.room.abandon();
  assert.equal(coins(one.store, a), 1000);
  assert.equal(coins(one.store, b), 1000);
  one.room.destroy();

  const two = stakeRoom(500);
  two.room.start(a);
  two.room.newGame(a);
  assert.equal(coins(two.store, a), 1000);
  assert.equal(coins(two.store, b), 1000);
  assert.equal(two.room.phase, 'lobby');
  two.room.destroy();

  const three = stakeRoom(500);
  three.room.start(a);
  three.room.rigged = true;
  three.room.tokens[0] = done;
  three.room.winners = [0];
  three.room.surrender(b);
  assert.equal(coins(three.store, a), 1000);
  assert.equal(coins(three.store, b), 1000);
  three.room.destroy();
});

test('a stakes game survives a server restart with its pot', () => {
  const { room, store } = stakeRoom(100);
  room.start(a);
  const saved = JSON.parse(JSON.stringify(room.toSave()));
  const back = Room.fromSave(saved, { profiles: store, fee: () => 0, delays: { bot: 60_000, timeout: 60_000 } });
  assert.equal(back.stake, 100);
  assert.deepEqual(back.pot.total, 200);
  back.tokens[0] = done;
  back.winners = [0];
  back.surrender(b);
  assert.equal(back.potWon[0], 200);
  room.destroy();
  back.destroy();
});

test('room list shows the stake; "Play now" never puts you in a stakes room', () => {
  const dir = new RoomDirectory();
  const room = dir.create(a, { visibility: 'public', stake: 500 });
  assert.equal(room.stake, 500);
  assert.equal(dir.list(null).find((r) => r.id === room.id).stake, 500);
  assert.equal(dir.findOpen(b), null);
  assert.equal(dir.create(c, { stake: 123 }).stake, 0, 'unknown amounts are ignored');
  dir.destroy();
});

// ---- the leaderboard: Classic cash pots (split across places) vs Stakes Rooms (winner takes all, more points) ----
function chipsFor(stake, { coins = Math.max(1000, stake), seat = [a, b, c], mode = '4p', visibility = 'public', winnerTakeAll = false, winners, surrender, rig = false } = {}) {
  const ended = [];
  const { room } = stakeRoom(stake, { coins, seat, mode, visibility, winnerTakeAll, onGameEnd: (r) => ended.push(...r) });
  room.start(a);
  if (rig) room.rigged = true;
  if (surrender) {
    for (const u of surrender) room.surrender(u);
  } else {
    room.winners = winners;
    room.endIfOver();
    if (room.phase !== 'finished') room.finish();
  }
  room.destroy();
  return Object.fromEntries(ended.map((r) => [r.userId, r.points]));
}

test('Classic cash pot: shared across places except last (70/30 for 3p, 60/30/10 for 4p, 45/25/15/10/5 for 6p)', () => {
  // three players, 1500 in the pot: 70% / 30% / nothing
  assert.deepEqual(chipsFor(500, { winners: [1, 0, 2] }), { b: 550, a: -50, c: -500 });
  const { room, store } = stakeRoom(500, { seat: [a, b, c, d] });
  room.start(a);
  room.winners = [2, 0, 3, 1];
  room.finish();
  assert.deepEqual(room.potWon, { 2: 1200, 0: 600, 3: 200 });
  assert.ok(room.rewards[2] > 0 && room.rewards[1] > 0); // Classic rewards still paid
  assert.equal(coins(store, b), 500 + room.rewards[1]); // last gets no pot cut, still gets Classic reward
  room.destroy();
});

test('Stakes Rooms (winnerTakeAll): only 1st place wins 100% of the pot, no Classic coins, and more points than Classic', () => {
  const classicPts = chipsFor(500, { winners: [1, 0, 2] });
  const stakesPts = chipsFor(500, { winnerTakeAll: true, winners: [1, 0, 2] });
  // 1.5x both ways: the winner's +1000 profit scores 1500, each lost 500 stake scores -750
  assert.deepEqual(stakesPts, { b: 1500, a: -750, c: -750 });
  assert.ok(stakesPts.b > classicPts.b);
  const { room, store } = stakeRoom(500, { seat: [a, b, c, d], winnerTakeAll: true });
  room.start(a);
  room.winners = [2, 0, 3, 1];
  room.finish();
  assert.deepEqual(room.potWon, { 2: 2000 });
  assert.deepEqual(room.rewards, {});
  assert.equal(coins(store, c), 2500);
  assert.equal(coins(store, a), 500);
  assert.equal(coins(store, d), 500);
  assert.equal(coins(store, b), 500);
  room.destroy();
});

test('Classic cash pot: surrendered players place last and their cut goes to 1st; Stakes Room: best live wins all', () => {
  const { room: classic } = stakeRoom(100, { seat: [a, b, c, d] });
  classic.start(a);
  classic.forfeited.push(1, 3);
  classic.winners = [0, 2, 1, 3];
  classic.finish();
  assert.deepEqual(classic.potWon, { 0: 280, 2: 120 });
  classic.destroy();

  const { room: stakes } = stakeRoom(100, { seat: [a, b, c, d], winnerTakeAll: true });
  stakes.start(a);
  stakes.forfeited.push(1, 3);
  stakes.winners = [0, 2, 1, 3];
  stakes.finish();
  assert.deepEqual(stakes.potWon, { 0: 400 });
  stakes.destroy();
});

test('team stakes: the winning team splits the profit; losing team gets nothing', () => {
  assert.deepEqual(chipsFor(100, { mode: '2v2', seat: [a, b, c, d], winners: [0, 2, 1, 3] }), { a: 100, c: 100, b: -100, d: -100 });
  assert.deepEqual(chipsFor(100, { mode: '2v2', seat: [a, b, c, d], winnerTakeAll: true, winners: [0, 2, 1, 3] }), { a: 150, c: 150, b: -150, d: -150 });
});

test('a surrender still costs the stake on the board', () => {
  const r = chipsFor(100, { seat: [a, b], surrender: [b] });
  assert.deepEqual(r, { a: 100, b: -100 });
});

test('private rooms, test dice and games without a stake never score', () => {
  assert.deepEqual(chipsFor(500, { visibility: 'private', winners: [1, 0, 2] }), { b: 0, a: 0, c: 0 });
  assert.deepEqual(chipsFor(0, { winners: [1, 0, 2] }), { b: 0, a: 0, c: 0 });
  const rigged = chipsFor(500, { winners: [1, 0, 2], rig: true });
  assert.ok(Object.values(rigged).every((p) => p === 0));
});

test('six-player Classic cash pot splits 45/25/15/10/5, while Stakes Room gives 100% to 1st', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id.toUpperCase() }));
  const store = new ProfileStore(null);
  for (const u of six) store.get(u.id).coins = 1000;
  const classic = new Room('s', { profiles: store, fee: () => 0, delays: { bot: 60_000, timeout: 60_000 } });
  for (const u of six) classic.connect(u);
  classic.host(six[0]);
  classic.setMode(six[0], '6p');
  six.forEach((u, i) => classic.sit(u, i));
  classic.setStake(six[0], 500);
  classic.start(six[0]);
  classic.winners = [0, 1, 2, 3, 4, 5];
  classic.finish();
  assert.deepEqual(classic.potWon, { 0: 1350, 1: 750, 2: 450, 3: 300, 4: 150 });
  classic.destroy();

  const store2 = new ProfileStore(null);
  for (const u of six) store2.get(u.id).coins = 1000;
  const stakes = new Room('s2', { profiles: store2, fee: () => 0, delays: { bot: 60_000, timeout: 60_000 } });
  for (const u of six) stakes.connect(u);
  stakes.host(six[0]);
  stakes.setMode(six[0], '6p');
  six.forEach((u, i) => stakes.sit(u, i));
  stakes.setStake(six[0], 500);
  stakes.winnerTakeAll = true;
  stakes.start(six[0]);
  stakes.winners = [0, 1, 2, 3, 4, 5];
  stakes.finish();
  assert.deepEqual(stakes.potWon, { 0: 3000 });
  assert.deepEqual(stakes.rewards, {});
  stakes.destroy();
});

test('Stakes Rooms give higher v1 leaderboard points than Classic bets, and scale with stake size', () => {
  const run = (stake, winnerTakeAll) => {
    const ended = [];
    const { room } = stakeRoom(stake, { coins: 20000, seat: [a, b, c], visibility: 'public', winnerTakeAll, onGameEnd: (r) => ended.push(...r) });
    room.start(a);
    room.winners = [0, 1, 2];
    room.finish();
    room.destroy();
    return Object.fromEntries(ended.map((r) => [r.userId, r.placePoints]));
  };
  const classic500 = run(500, false);
  const stakes500 = run(500, true);
  const stakes10k = run(10000, true);
  assert.ok(classic500.b > 0); // Classic 2nd place still gets v1 placement points
  assert.equal(stakes500.b, 0); // Stakes losers get 0
  assert.ok(stakes500.a > classic500.a);
  assert.ok(stakes10k.a > stakes500.a);
});

test('RoomDirectory keeps Classic bets and Stakes Rooms separate', () => {
  const dir = new RoomDirectory();
  const classicBet = dir.create(a, { visibility: 'public', stake: 500 });
  const stakesRoom = dir.create(b, { visibility: 'public', stake: 500, winnerTakeAll: true });
  assert.equal(classicBet.winnerTakeAll, false);
  assert.equal(stakesRoom.winnerTakeAll, true);
  assert.throws(() => stakesRoom.setStake(b, 0), /require a stake/);
  dir.destroy();
});

test('the house keeps 5% of pots from 200 coins (at most 250); smaller pots are paid in full', async () => {
  const { potFee } = await import('../shared/shop.js');
  assert.equal(potFee(100), 0);
  assert.equal(potFee(200), 10);
  assert.equal(potFee(2000), 100);
  assert.equal(potFee(60_000), 250);
  // a real room, with the real fee: 4 x 500 in, the winner gets 2000 - 100
  const { room, store } = stakeRoom(500, { seat: [a, b, c, d], winnerTakeAll: true, fee: potFee });
  room.start(a);
  room.winners = [2, 0, 3, 1];
  room.finish();
  assert.deepEqual(room.potWon, { 2: 1900 });
  assert.equal(coins(store, c), 2400);
  assert.ok(room.log.some((l) => /House fee: 100 coins/.test(l.text || l)));
  room.destroy();
});

test("All In: trading wins between two players doesn't climb the leaderboard", () => {
  // A wins one, B wins one, same stake: both end where they started
  const one = chipsFor(500, { winnerTakeAll: true, seat: [a, b], winners: [0, 1] });
  const two = chipsFor(500, { winnerTakeAll: true, seat: [a, b], winners: [1, 0] });
  assert.equal(one.a + two.a, 0);
  assert.equal(one.b + two.b, 0);
});

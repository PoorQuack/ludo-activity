import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QuestBook, QUESTS, WEEKLY_QUESTS, ALL_DONE_BONUS, pickQuests } from '../server/quests.js';
import { Leaderboard } from '../server/leaderboard.js';
import { Room } from '../server/room.js';

const BY_ID = Object.fromEntries(QUESTS.map((q) => [q.id, q]));
const clock = (iso) => {
  const c = { t: Date.parse(iso), now: () => c.t };
  return c;
};

test('each player gets one easy, one medium and one hard quest, the same all day', () => {
  const picks = pickQuests('ann', '2026-11-05');
  assert.deepEqual(picks.map((id) => BY_ID[id].tier), [1, 2, 3]);
  assert.deepEqual(pickQuests('ann', '2026-11-05'), picks);
  const sets = new Set(Array.from({ length: 30 }, (_, i) => pickQuests(`user${i}`, '2026-11-05').join()));
  assert.ok(sets.size > 5); // players get different quests
});

test('progress adds up, a quest completes once, and all three earn the bonus', () => {
  const paid = [];
  const book = new QuestBook(null, { now: clock('2026-11-05T10:00Z').now, onCoins: (id, name, coins) => paid.push(coins) });
  const view = book.view('ann');
  const [easy, mid, hard] = view.quests.map((q) => BY_ID[q.id]);
  // the easy quest, in steps
  for (let i = 1; i < easy.goal; i++) assert.deepEqual(book.track('ann', 'Ann', easy.stat).completed.filter((c) => c.title === easy.title), []);
  let r = book.track('ann', 'Ann', easy.stat);
  assert.ok(r.completed.some((c) => c.title === easy.title && c.coins === easy.coins));
  r = book.track('ann', 'Ann', easy.stat); // already done: nothing more
  assert.ok(!r.completed.some((c) => c.title === easy.title));
  // the other two in one go each (n > 1 is capped at the goal)
  // (when both count the same thing, the first call finishes both and brings the bonus)
  const rest = [...book.track('ann', 'Ann', mid.stat, 99).completed, ...book.track('ann', 'Ann', hard.stat, 99).completed];
  assert.equal(rest.filter((c) => c.bonus && c.coins === ALL_DONE_BONUS).length, 1);
  const v = book.view('ann');
  assert.ok(v.quests.every((q) => q.done && q.progress === q.goal));
  assert.equal(v.bonus.done, true);
  // each quest's points paid exactly once, plus the bonus (stats shared between quests count for both)
  const total = paid.reduce((a, b) => a + b, 0);
  assert.equal(total, easy.coins + mid.coins + hard.coins + ALL_DONE_BONUS);
});

test('stats no quest needs change nothing', () => {
  const book = new QuestBook(null, { now: clock('2026-11-05T10:00Z').now });
  const stats = new Set(book.view('bob').quests.map((q) => BY_ID[q.id].stat));
  const unused = ['game', 'six', 'out', 'home', 'capture', 'top2', 'win'].find((s) => !stats.has(s));
  if (unused) assert.equal(book.track('bob', 'Bob', unused).changed, false);
});

test('quests reset at midnight UTC', () => {
  const c = clock('2026-11-05T23:59Z');
  const book = new QuestBook(null, { now: c.now });
  const q = book.view('ann').quests[0];
  book.track('ann', 'Ann', BY_ID[q.id].stat);
  assert.equal(book.view('ann').quests[0].progress, 1);
  assert.equal(book.view('ann').endsAt, Date.parse('2026-11-06T00:00Z'));
  c.t = Date.parse('2026-11-06T00:01Z');
  const v = book.view('ann');
  assert.equal(v.day, '2026-11-06');
  assert.ok(v.quests.every((x) => x.progress === 0 && !x.done));
});

test('progress is saved and read back the same day, and forgotten the next', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-q-'));
  const file = path.join(dir, 'quests.json');
  const c = clock('2026-11-05T10:00Z');
  const book = new QuestBook(file, { now: c.now });
  const q = book.view('ann').quests[0];
  book.track('ann', 'Ann', BY_ID[q.id].stat);
  book.track('guest-x', 'Guest', 'win'); // guests aren't saved
  book.flush();
  const again = new QuestBook(file, { now: c.now });
  assert.equal(again.view('ann').quests[0].progress, 1);
  assert.equal(again.users['guest-x'], undefined);
  c.t = Date.parse('2026-11-06T09:00Z');
  const tomorrow = new QuestBook(file, { now: c.now });
  assert.equal(tomorrow.view('ann').quests[0].progress, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quest coins are paid in full, outside the daily earning cap, and never reach the leaderboards', async () => {
  const { ProfileStore } = await import('../server/store.js');
  const store = new ProfileStore(null);
  const lb = new Leaderboard(null, { now: clock('2026-11-05T10:00Z').now });
  const book = new QuestBook(null, { now: clock('2026-11-05T10:00Z').now, onCoins: (id, name, coins) => store.rewardCoins(id, coins) });
  const start = store.get('ann').coins;
  store.addCoins('ann', 10_000); // daily cap reached by games
  const capped = store.get('ann').coins;
  const quest = BY_ID[book.view('ann').quests[0].id];
  book.track('ann', 'Ann', quest.stat, quest.goal);
  assert.equal(store.get('ann').coins, capped + quest.coins);
  assert.ok(capped > start);
  assert.equal(lb.view('ann').week.me, null);
  assert.equal(typeof lb.addPoints, 'undefined');
});

test('games against people report quest stats; games against bots alone do not', () => {
  const seen = [];
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };
  const vsPeople = new Room('t', { rng: () => 6, onStat: (id, name, stat) => seen.push(`${id}:${stat}`) });
  vsPeople.connect(a);
  vsPeople.host(a);
  vsPeople.connect(b);
  vsPeople.join(b);
  vsPeople.start(a);
  const turn = vsPeople.seats[vsPeople.turn].userId;
  vsPeople.handle(turn === 'a' ? a : b, { action: 'roll' }); // a 6
  assert.deepEqual(seen, [`${turn}:six`]);
  vsPeople.tokens[vsPeople.seatOf('b')] = [10, 20, -1, -1];
  vsPeople.surrender(a); // B wins: game, win, top2
  assert.deepEqual(seen.slice(1), ['b:game', 'b:win', 'b:clean', 'b:top2']); // (clean: won without being captured)
  vsPeople.destroy();

  seen.length = 0;
  const vsBots = new Room('s', { rng: () => 6, onStat: (id, name, stat) => seen.push(stat) });
  vsBots.connect(a);
  vsBots.host(a);
  vsBots.addBot(a, 2);
  vsBots.start(a);
  vsBots.turn = vsBots.seatOf('a');
  vsBots.resetTurn();
  vsBots.handle(a, { action: 'roll' });
  assert.deepEqual(seen, []);
  vsBots.destroy();
});

test('weekly quests: three from the weekly pool, reset on Monday, with their own bonus', async () => {
  const { QuestBook, WEEKLY_QUESTS, WEEKLY_BONUS } = await import('../server/quests.js');
  let now = Date.UTC(2026, 10, 11, 12); // Wednesday
  const paid = [];
  const book = new QuestBook(null, { period: 'week', now: () => now, onCoins: (id, name, c) => paid.push(c) });
  const v = book.view('u1');
  assert.equal(v.period, 'week');
  assert.equal(v.quests.length, 3);
  assert.ok(v.quests.every((q) => WEEKLY_QUESTS.some((w) => w.id === q.id)));
  assert.equal(v.endsAt, Date.UTC(2026, 10, 16)); // next Monday 00:00 UTC
  // finish them all
  for (const q of v.quests) book.track('u1', 'U', q.stat, q.goal);
  const after = book.view('u1');
  assert.ok(after.quests.every((q) => q.done));
  assert.equal(after.bonus.done, true);
  assert.equal(paid.at(-1), WEEKLY_BONUS);
  // Sunday is still the same week; Monday starts a new one
  now = Date.UTC(2026, 10, 15, 23);
  assert.ok(book.view('u1').quests.every((q) => q.done));
  now = Date.UTC(2026, 10, 16, 0, 1);
  assert.ok(book.view('u1').quests.every((q) => !q.done && q.progress === 0));
});

test('every tier pays the same, harder tiers pay more, and each tier has a few to pick from', () => {
  for (const pool of [QUESTS, WEEKLY_QUESTS]) {
    const live = pool.filter((q) => !q.retired);
    const pay = [1, 2, 3].map((tier) => {
      const coins = new Set(live.filter((q) => q.tier === tier).map((q) => q.coins));
      assert.equal(coins.size, 1, `tier ${tier} pays ${[...coins]}`);
      assert.ok(live.filter((q) => q.tier === tier).length >= 3);
      return [...coins][0];
    });
    assert.ok(pay[0] < pay[1] && pay[1] < pay[2]);
    assert.equal(new Set(pool.map((q) => q.id)).size, pool.length, 'ids are unique');
  }
});

test('a retired quest is never handed out, but one already in progress can still be finished', () => {
  const retired = QUESTS.filter((q) => q.retired).map((q) => q.id);
  assert.ok(retired.includes('win1'));
  for (let i = 0; i < 200; i++) assert.ok(!pickQuests(`u${i}`, '2026-11-05').some((id) => retired.includes(id)));
  const paid = [];
  const book = new QuestBook(null, { now: clock('2026-11-05T10:00Z').now, onCoins: (id, name, coins) => paid.push(coins) });
  book.users.ann = { picks: ['play3', 'capture5', 'win1'], progress: {}, done: [], bonus: false }; // saved before the change
  assert.equal(book.view('ann').quests[2].title, 'Win a game');
  assert.equal(book.track('ann', 'Ann', 'win').completed[0].title, 'Win a game');
  assert.equal(paid.length, 1);
});

test('bringing a token out of base counts for the "out of base" quests', () => {
  const seen = [];
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };
  const room = new Room('t', { rng: () => 6, onStat: (userId, name, stat, n) => seen.push([userId, stat, n]) });
  room.connect(a);
  room.host(a);
  room.connect(b);
  room.join(b);
  room.start(a);
  const seat = room.turn;
  room.rolls = [6];
  room.rolled = true;
  room.options = [[0, 1, 2, 3]];
  room.doMove(0, 0);
  assert.deepEqual(seen.filter(([, stat]) => stat === 'out'), [[room.seats[seat].userId, 'out', 1]]);
  room.destroy();
});

test('a quick game: two tokens each (the other two start home), and the finish card gets everyone\'s numbers', () => {
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };
  const room = new Room('q', { rng: () => 6 });
  room.connect(a);
  room.host(a);
  room.connect(b);
  room.join(b);
  assert.throws(() => room.setQuick(b, true), /host/i);
  room.setQuick(a, true);
  assert.equal(room.snapshot().quick, true);
  room.start(a);
  const home = room.board.finished;
  for (const seat of room.activeSeats()) assert.deepEqual(room.tokens[seat], [-1, -1, home, home]);
  assert.throws(() => room.setQuick(a, false), /./, 'not once the game is on');
  const seat = room.turn;
  room.rolls = [6];
  room.rolled = true;
  room.options = [[0, 1]];
  room.doMove(0, 0);
  assert.equal(room.snapshot().tally[seat].out, 1);
  room.destroy();
});

test('revenge: capture whoever last captured you; streaks count captures in a row', () => {
  const stats = [];
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };
  const room = new Room('rv', { rng: () => 3, onStat: (id, name, stat) => stats.push(`${id}:${stat}`) });
  room.connect(a);
  room.host(a);
  room.connect(b);
  room.join(b);
  room.start(a);
  const A = room.seatOf('a');
  const B = room.seatOf('b');
  const board = room.board;
  // `by` moves one square onto `victim`'s token (on some plain, unsafe track square)
  const capture = (by, victim) => {
    for (let p = 2; p < 40; p++) {
      const idx = board.trackIndex(victim, p);
      if (board.safe.has(idx)) continue;
      const q = [...Array(board.lastTrack).keys()].find((i) => board.trackIndex(by, i + 1) === idx);
      if (q === undefined) continue;
      room.tokens[by] = [q, -1, -1, -1];
      room.tokens[victim] = [p, -1, -1, -1];
      room.turn = by;
      room.rolled = true;
      room.rolls = [1];
      room.options = [[0]];
      room.extraTurns = 0;
      room.doMove(0, 0);
      return room.lastMove;
    }
    throw new Error('no square found');
  };
  let m = capture(A, B);
  assert.equal(m.captured.length, 1);
  assert.equal(m.revenge, false);
  assert.equal(m.streak, 1);
  assert.equal(room.feud[B], A, 'B now owes A one');
  m = capture(B, A);
  assert.equal(m.revenge, true, 'B got A back');
  assert.equal(room.revenges[B], 1);
  assert.equal(room.feud[B], undefined, 'settled');
  assert.equal(room.feud[A], B);
  assert.equal(room.streak[A], 0, "A's streak ended");
  m = capture(B, A);
  assert.equal(m.revenge, false, 'only once per capture');
  m = capture(B, A);
  assert.equal(m.streak, 3);
  assert.ok(stats.includes('b:revenge'));
  assert.equal(stats.filter((s) => s === 'b:rampage').length, 1, 'a rampage counts once, at three');
  assert.equal(room.snapshot().feud[A], B);
  room.destroy();
});

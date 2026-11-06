import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Leaderboard, periodId, periodEnd, PRIZES } from '../server/leaderboard.js';
import { ProfileStore } from '../server/store.js';
import { Room } from '../server/room.js';

const at = (iso) => Date.parse(iso);
const clock = (iso) => {
  const c = { t: at(iso), now: () => c.t };
  return c;
};
const game = (...rows) => rows.map(([userId, points, won = false]) => ({ userId, name: userId.toUpperCase(), points, won }));

test('weeks run Monday to Monday (ISO weeks, UTC); months by the calendar', () => {
  assert.equal(periodId('week', at('2026-11-05T12:00Z')), '2026-W45'); // a Thursday
  assert.equal(periodId('week', at('2026-11-09T00:00Z')), '2026-W46'); // Monday: a new week
  assert.equal(periodId('week', at('2026-11-08T23:59Z')), '2026-W45');
  assert.equal(periodId('week', at('2027-01-01T10:00Z')), '2026-W53'); // still 2026's last week
  assert.equal(periodId('month', at('2026-11-30T23:59Z')), '2026-11');
  assert.equal(periodEnd('week', at('2026-11-05T12:00Z')), at('2026-11-09T00:00Z'));
  assert.equal(periodEnd('month', at('2026-12-15T00:00Z')), at('2027-01-01T00:00Z'));
});

test('games add up points and wins; ties go to more wins, then whoever got there first', () => {
  const c = clock('2026-11-05T10:00Z');
  const lb = new Leaderboard(null, { now: c.now });
  lb.record(game(['ann', 27, true], ['bob', 15]));
  c.t += 60_000;
  lb.record(game(['bob', 12, true], ['cat', 27, true]));
  const v = lb.view('bob');
  // ann 27 (1 win, first), bob 27 (1 win, later), cat 27 (1 win, last)
  assert.deepEqual(v.week.top.map((e) => e.name), ['ANN', 'BOB', 'CAT']);
  assert.equal(v.week.me.rank, 2);
  assert.equal(v.week.top[1].you, true);
  assert.equal(v.month.top[0].points, 27);
  assert.deepEqual(v.week.prizes, PRIZES.week);
});

test('guests and games that paid nothing are not ranked', () => {
  const lb = new Leaderboard(null, { now: clock('2026-11-05T10:00Z').now });
  lb.record(game(['guest-abc', 25, true], ['ann', 0]));
  assert.equal(lb.view('ann').week.players, 0);
});

test('when the week ends, the top three are paid once and told once', () => {
  const c = clock('2026-11-05T10:00Z');
  const profiles = new ProfileStore(null, { now: c.now });
  const told = [];
  const lb = new Leaderboard(null, { profiles, now: c.now, onAward: (id) => told.push(id) });
  lb.record(game(['ann', 40, true], ['bob', 30], ['cat', 20], ['dan', 10]));
  c.t = at('2026-11-09T00:00:30Z'); // Monday
  lb.rollover();
  lb.rollover(); // a second check pays nothing more
  assert.equal(profiles.peek('ann').coins, 150 + PRIZES.week[0]);
  assert.equal(profiles.peek('bob').coins, 150 + PRIZES.week[1]);
  assert.equal(profiles.peek('cat').coins, 150 + PRIZES.week[2]);
  assert.equal(profiles.peek('dan'), null); // 4th: nothing
  assert.deepEqual(told.sort(), ['ann', 'bob', 'cat']);
  assert.deepEqual(lb.takeAwards('ann'), [{ kind: 'week', period: '2026-W45', place: 1, coins: PRIZES.week[0] }]);
  assert.deepEqual(lb.takeAwards('ann'), []); // only once
  const v = lb.view('ann');
  assert.equal(v.week.period, '2026-W46');
  assert.equal(v.week.players, 0); // a fresh week
  assert.deepEqual(v.week.last.podium.map((p) => p.name), ['ANN', 'BOB', 'CAT']);
  assert.equal(v.month.players, 4); // the month carries on
});

test('prizes ignore the daily earning cap', () => {
  const c = clock('2026-11-30T10:00Z');
  const profiles = new ProfileStore(null, { now: c.now });
  profiles.addCoins('ann', 1000); // hits today's cap
  const lb = new Leaderboard(null, { profiles, now: c.now });
  lb.record(game(['ann', 25, true]));
  c.t = at('2026-12-01T00:01Z'); // a new month (and a new week? no: Tuesday is mid-week)
  lb.rollover();
  assert.equal(profiles.peek('ann').coins, 150 + 120 + PRIZES.month[0]);
});

test('saved to disk and read back; an owed prize is paid on start', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-lb-'));
  const file = path.join(dir, 'leaderboard.json');
  const c = clock('2026-11-05T10:00Z');
  const lb = new Leaderboard(file, { now: c.now });
  lb.record(game(['ann', 40, true]));
  lb.awards.push({ userId: 'bob', kind: 'week', period: '2026-W44', place: 1, coins: 300, paid: false, seen: false }); // as if a crash hit mid-payout
  lb.flush();
  const profiles = new ProfileStore(null, { now: c.now });
  const again = new Leaderboard(file, { profiles, now: c.now });
  assert.equal(again.view('ann').week.top[0].points, 40);
  assert.equal(profiles.peek('bob').coins, 150 + 300);
  const third = new Leaderboard(file, { profiles, now: c.now });
  assert.equal(profiles.peek('bob').coins, 150 + 300); // not paid twice
  assert.ok(third);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a finished game against people reports its results; bots-only games do not', () => {
  const ended = [];
  const room = new Room('t', { onGameEnd: (r) => ended.push(r) });
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };
  room.connect(a);
  room.host(a);
  room.connect(b);
  room.join(b);
  room.start(a);
  room.tokens[room.seatOf('b')] = [10, 20, -1, -1];
  room.surrender(a); // B wins
  assert.equal(ended.length, 1);
  assert.deepEqual(ended[0].map((r) => [r.userId, r.won]), [['b', true]]);
  assert.ok(ended[0][0].points > 0);
  room.destroy();

  const solo = new Room('s', { onGameEnd: (r) => ended.push(r) });
  solo.connect(a);
  solo.host(a);
  solo.addBot(a, 2);
  solo.start(a);
  solo.surrender(a);
  assert.equal(ended.length, 1); // nothing new
  solo.destroy();
});

// A finished game's leaderboard points. `seats`: who sits where ('a', 'b'… are people, 'bot'
// a bot), in a 4-seat game; `order`: seat numbers in finishing order, first place first.
function pointsFor(seats, order, { early = false } = {}) {
  const ended = [];
  const room = new Room('t', { onGameEnd: (r) => ended.push(...r) });
  const users = {};
  seats.forEach((who, i) => {
    if (!who || who === 'bot') return; // null: an empty seat
    const u = (users[who] = { id: who, name: who.toUpperCase() });
    room.connect(u);
    if (!room.hostId) room.host(u);
    room.sit(u, i);
  });
  const host = users[seats.find((w) => w !== 'bot')];
  seats.forEach((who, i) => who === 'bot' && room.addBot(host, i));
  room.start(host);
  room.winners = order;
  room.endedEarly = early;
  room.giveRewards();
  room.destroy();
  return Object.fromEntries(ended.map((r) => [r.userId, [r.points, r.won]]));
}

test('leaderboard points: 10 per human you beat, +10 for beating them all', () => {
  // four people: 40 / 20 / 10 / 0
  assert.deepEqual(pointsFor(['a', 'b', 'c', 'd'], [0, 1, 2, 3]), { a: [40, true], b: [20, false], c: [10, false], d: [0, false] });
  // three people: 30 / 10 / 0
  assert.deepEqual(pointsFor(['a', 'b', 'c', null], [2, 0, 1]), { c: [30, true], a: [10, false], b: [0, false] });
});

test('bots neither add points nor take the win', () => {
  // two people and two bots, a bot first: A (2nd overall) beat B, so A wins with 20
  assert.deepEqual(pointsFor(['a', 'bot', 'b', 'bot'], [1, 0, 3, 2]), { a: [20, true], b: [0, false] });
});

test('a game cut short scales the points by how far you got', () => {
  const r = pointsFor(['a', null, 'b', null], [2, 0], { early: true });
  assert.equal(r.b[1], true);
  assert.ok(r.b[0] < 20); // tokens all still in base: a surrender this early is worth (almost) nothing
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Leaderboard, periodId, periodEnd, PRIZES, STAKES_FROM } from '../server/leaderboard.js';
import { ProfileStore } from '../server/store.js';
import { Room } from '../server/room.js';
import { REWARDS } from '../shared/shop.js';

const at = (iso) => Date.parse(iso);
const clock = (iso) => {
  const c = { t: at(iso), now: () => c.t };
  return c;
};
// A finished stakes game: everyone in it played everyone else
const game = (...rows) => rows.map(([userId, points, won = false]) => ({ userId, name: userId.toUpperCase(), points, won, opponents: rows.map((r) => r[0]).filter((id) => id !== userId) }));

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
  const lb = new Leaderboard(null, { now: c.now, stakesAt: 0 });
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
  const lb = new Leaderboard(null, { now: clock('2026-11-05T10:00Z').now, stakesAt: 0 });
  lb.record(game(['guest-abc', 25, true], ['ann', 0]));
  assert.equal(lb.view('ann').week.players, 0);
});

test('when the week ends, the top three are paid once and told once', () => {
  const c = clock('2026-11-05T10:00Z');
  const profiles = new ProfileStore(null, { now: c.now });
  const told = [];
  const lb = new Leaderboard(null, { profiles, now: c.now, onAward: (id) => told.push(id), stakesAt: 0 });
  lb.record(game(['ann', 40, true], ['bob', 30], ['cat', 20], ['dan', 10]));
  c.t = at('2026-11-09T00:00:30Z'); // Monday
  lb.rollover();
  lb.rollover(); // a second check pays nothing more
  assert.equal(profiles.peek('ann').coins, 150 + PRIZES.week[0]);
  assert.equal(profiles.peek('bob').coins, 150 + PRIZES.week[1]);
  assert.equal(profiles.peek('cat').coins, 150 + PRIZES.week[2]);
  assert.equal(profiles.peek('dan'), null); // 4th: nothing
  // the top three also win their place's frame, to keep
  assert.ok(profiles.peek('ann').owned.includes('frame-rank-1'));
  assert.ok(profiles.peek('bob').owned.includes('frame-rank-2'));
  assert.ok(profiles.peek('cat').owned.includes('frame-rank-3'));
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
  const lb = new Leaderboard(null, { profiles, now: c.now, stakesAt: 0 });
  lb.record(game(['ann', 25, true], ['bob', -25]));
  c.t = at('2026-12-01T00:01Z'); // a new month (and a new week? no: Tuesday is mid-week)
  lb.rollover();
  assert.equal(profiles.peek('ann').coins, 150 + 120 + PRIZES.month[0]);
});

test('saved to disk and read back; an owed prize is paid on start', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-lb-'));
  const file = path.join(dir, 'leaderboard.json');
  const c = clock('2026-11-05T10:00Z');
  const lb = new Leaderboard(file, { now: c.now, stakesAt: 0 });
  lb.record(game(['ann', 40, true], ['bob', -40]));
  lb.awards.push({ userId: 'bob', kind: 'week', period: '2026-W44', place: 1, coins: 300, paid: false, seen: false }); // as if a crash hit mid-payout
  lb.flush();
  const profiles = new ProfileStore(null, { now: c.now });
  const again = new Leaderboard(file, { profiles, now: c.now, stakesAt: 0 });
  assert.equal(again.view('ann').week.top[0].points, 40);
  assert.equal(profiles.peek('bob').coins, 150 + 300);
  const third = new Leaderboard(file, { profiles, now: c.now });
  assert.equal(profiles.peek('bob').coins, 150 + 300); // not paid twice
  assert.ok(third);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a surrender before anyone finishes still pays by progress', () => {
  const room = new Room('t');
  const [a, b] = ['a', 'b'].map((id) => ({ id, name: id.toUpperCase() }));
  room.connect(a);
  room.host(a);
  room.connect(b);
  room.join(b);
  room.start(a);
  room.tokens[room.seatOf('b')] = [10, -1, -1, -1];
  room.surrender(a);
  assert.equal(room.endedEarly, true);
  assert.deepEqual(room.rewardPartial, [room.seatOf('b')]);
  room.destroy();
});

test('friends on one team against bots: coins for the place, but no leaderboard points or win', () => {
  for (const botsWin of [true, false]) {
    const ended = [];
    const room = new Room('t', { onGameEnd: (r) => ended.push(...r) });
    const [a, b] = ['a', 'b'].map((id) => ({ id, name: id.toUpperCase() }));
    room.connect(a);
    room.host(a);
    room.connect(b);
    room.setMode(a, '2v2');
    room.sit(a, 0); // team 0: seats 0 and 2
    room.sit(b, 2);
    room.addBot(a, 1); // team 1: two bots
    room.addBot(a, 3);
    room.start(a);
    room.winners = botsWin ? [1, 3] : [0, 2];
    room.endIfOver();
    assert.equal(room.noPoints, 'coop');
    assert.deepEqual(Object.fromEntries(ended.map((r) => [r.userId, [r.points, r.won]])), { a: [0, false], b: [0, false] });
    assert.equal(room.rewards[0], REWARDS.place[botsWin ? 1 : 0]); // coins still follow the real place
    room.destroy();
  }
});

test('the all-time board keeps every point through week and month ends, and is saved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-lb-all-'));
  const file = path.join(dir, 'leaderboard.json');
  const c = clock('2026-11-05T10:00Z');
  const lb = new Leaderboard(file, { now: c.now, stakesAt: 0 });
  lb.record(game(['ann', 20, true], ['bob', 10]));
  c.t = at('2026-12-02T10:00Z'); // a new week and a new month
  lb.record(game(['bob', 30, true], ['ann', 5]));
  const v = lb.view('ann');
  assert.equal(v.month.top.find((e) => e.name === 'ANN').points, 5); // the month started over
  assert.deepEqual(v.all.top.map((e) => [e.name, e.points, e.wins, e.games]), [['BOB', 40, 1, 2], ['ANN', 25, 1, 2]]);
  assert.deepEqual(v.all.me, { rank: 2, points: 25, wins: 1, games: 2 });
  assert.equal(v.all.since, '2026-11');
  lb.flush();
  const again = new Leaderboard(file, { now: c.now, stakesAt: 0 });
  assert.equal(again.view('bob').all.top[0].points, 40);
});


test('an old save (places, not stakes) starts the boards again, keeping past winners', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-lb-v1-'));
  const file = path.join(dir, 'leaderboard.json');
  const c = clock('2026-11-20T10:00Z');
  const last = { period: '2026-W46', podium: [{ name: 'ANN', points: 40, place: 1, coins: 300 }] };
  fs.writeFileSync(file, JSON.stringify({ version: 1, boards: { week: { id: '2026-W47', scores: { ann: { name: 'ANN', points: 99, wins: 3, games: 5, at: 1 } } }, month: { id: '2026-11', scores: {} } }, last: { week: last, month: null }, awards: [] }));
  const lb = new Leaderboard(file, { now: c.now, stakesAt: 0 });
  const v = lb.view('ann');
  assert.equal(v.week.players, 0);
  assert.equal(v.all.players, 0);
  assert.equal(v.week.last.podium[0].name, 'ANN');
});

test('chips: a lost stake counts against you, and nobody in the red wins a prize', () => {
  const c = clock('2026-11-05T10:00Z');
  const profiles = new ProfileStore(null, { now: c.now });
  const lb = new Leaderboard(null, { profiles, now: c.now, stakesAt: 0 });
  lb.record(game(['ann', 1000, true], ['bob', -500], ['cat', -500]));
  c.t += 60_000;
  lb.record(game(['bob', 100, true], ['cat', -100]));
  const v = lb.view('cat');
  assert.deepEqual(v.week.top.map((e) => [e.name, e.points]), [['ANN', 1000], ['BOB', -400], ['CAT', -600]]);
  c.t = at('2026-11-09T00:00:30Z');
  lb.rollover();
  assert.equal(profiles.peek('ann').coins, 150 + PRIZES.week[0]);
  assert.equal(profiles.peek('bob'), null); // second, but in the red: no prize
});

test('the same people only count 3 times a day: farming a friend stops paying', () => {
  const c = clock('2026-11-05T10:00Z');
  const lb = new Leaderboard(null, { now: c.now, stakesAt: 0 });
  for (let i = 0; i < 5; i++) lb.record(game(['ann', 100, true], ['bob', -100]));
  assert.equal(lb.view('ann').week.top[0].points, 300);
  lb.record(game(['ann', 200, true], ['bob', -100], ['cat', -100])); // a new face: it counts
  assert.equal(lb.view('ann').week.top[0].points, 500);
  c.t = at('2026-11-06T10:00Z'); // the next day: counts again
  lb.record(game(['ann', 100, true], ['bob', -100]));
  assert.equal(lb.view('ann').week.top[0].points, 600);
});

test('November 2026 keeps v1 scores and pays monthly winners on Dec 1 before switching to stakes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-lb-nov-'));
  const file = path.join(dir, 'leaderboard.json');
  const c = clock('2026-11-25T11:00Z');
  const profiles = new ProfileStore(null, { now: c.now });
  // Restored v1 leaderboard from Nov 25
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    boards: {
      week: { id: '2026-W48', scores: { ann: { name: 'ANN', points: 100, wins: 3, games: 5, at: 1 } } },
      month: { id: '2026-11', scores: { ann: { name: 'ANN', points: 500, wins: 15, games: 25, at: 1 }, bob: { name: 'BOB', points: 400, wins: 12, games: 22, at: 2 } } },
    },
    last: { week: { period: '2026-W47', podium: [{ name: 'CAT', points: 80, place: 1, coins: 300 }] }, month: null },
    awards: [],
  }));
  const lb = new Leaderboard(file, { profiles, now: c.now, stakesAt: STAKES_FROM });
  assert.equal(lb.view('ann').week.mode, 'points');
  assert.equal(lb.view('ann').month.top[0].points, 500);
  // Games in late November add placePoints (even without a stake)
  lb.record([{ userId: 'bob', name: 'BOB', points: 0, placePoints: 20, won: true, opponents: ['ann'] }]);
  assert.equal(lb.view('bob').week.top.find((e) => e.name === 'BOB').points, 20);
  assert.equal(lb.view('bob').month.top.find((e) => e.name === 'BOB').points, 420);
  assert.equal(lb.view('bob').all.players, 0);
  // Week W48 ends Nov 30: pays weekly top 3, starts W49 in v1
  c.t = at('2026-11-30T00:01Z');
  lb.rollover();
  assert.equal(profiles.peek('ann').coins, 150 + PRIZES.week[0]);
  assert.equal(lb.view('ann').week.last.unit, 'pts');
  lb.record([{ userId: 'bob', name: 'BOB', points: 0, placePoints: 20, won: true, opponents: ['ann'] }]);
  assert.equal(lb.view('bob').week.top[0].points, 20);
  // Dec 1: pays November's monthly winners, clears Nov 30's W49 v1 points, switches to stakes v2
  c.t = at('2026-12-01T00:01Z');
  lb.rollover();
  assert.equal(profiles.peek('ann').coins, 150 + PRIZES.week[0] + PRIZES.month[0]);
  assert.equal(profiles.peek('bob').coins, 150 + PRIZES.week[1] + PRIZES.month[1]);
  assert.ok(profiles.peek('ann').owned.includes('frame-rank-1'));
  const dec = lb.view('ann');
  assert.equal(dec.month.mode, 'stakes');
  assert.equal(dec.month.period, '2026-12');
  assert.equal(dec.month.last.period, '2026-11');
  assert.equal(dec.month.last.unit, 'pts');
  assert.equal(dec.week.players, 0);
  assert.equal(dec.all.since, '2026-12');
  // Stakes games now score chips
  lb.record(game(['bob', 500, true], ['ann', -500]));
  assert.equal(lb.view('bob').month.top[0].points, 500);
  assert.equal(lb.view('bob').all.top[0].points, 500);
  fs.rmSync(dir, { recursive: true, force: true });
});

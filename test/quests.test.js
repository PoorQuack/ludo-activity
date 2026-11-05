import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QuestBook, QUESTS, ALL_DONE_BONUS, pickQuests } from '../server/quests.js';
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
  const book = new QuestBook(null, { now: clock('2026-11-05T10:00Z').now, onPoints: (id, name, pts) => paid.push(pts) });
  const view = book.view('ann');
  const [easy, mid, hard] = view.quests.map((q) => BY_ID[q.id]);
  // the easy quest, in steps
  for (let i = 1; i < easy.goal; i++) assert.deepEqual(book.track('ann', 'Ann', easy.stat).completed.filter((c) => c.title === easy.title), []);
  let r = book.track('ann', 'Ann', easy.stat);
  assert.ok(r.completed.some((c) => c.title === easy.title && c.points === easy.points));
  r = book.track('ann', 'Ann', easy.stat); // already done: nothing more
  assert.ok(!r.completed.some((c) => c.title === easy.title));
  // the other two in one go each (n > 1 is capped at the goal)
  book.track('ann', 'Ann', mid.stat, 99);
  r = book.track('ann', 'Ann', hard.stat, 99);
  assert.ok(r.completed.some((c) => c.bonus && c.points === ALL_DONE_BONUS));
  const v = book.view('ann');
  assert.ok(v.quests.every((q) => q.done && q.progress === q.goal));
  assert.equal(v.bonus.done, true);
  // each quest's points paid exactly once, plus the bonus (stats shared between quests count for both)
  const total = paid.reduce((a, b) => a + b, 0);
  assert.equal(total, easy.points + mid.points + hard.points + ALL_DONE_BONUS);
});

test('stats no quest needs change nothing', () => {
  const book = new QuestBook(null, { now: clock('2026-11-05T10:00Z').now });
  const stats = new Set(book.view('bob').quests.map((q) => BY_ID[q.id].stat));
  const unused = ['game', 'six', 'home', 'capture', 'top2', 'win'].find((s) => !stats.has(s));
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

test('quest points go onto both leaderboards without counting as a game', () => {
  const c = clock('2026-11-05T10:00Z');
  const lb = new Leaderboard(null, { now: c.now });
  lb.addPoints('ann', 'Ann', 30);
  lb.addPoints('guest-1', 'G', 30);
  const v = lb.view('ann');
  assert.deepEqual([v.week.me.points, v.week.me.games, v.week.me.wins, v.month.me.points], [30, 0, 0, 30]);
  assert.equal(v.week.players, 1);
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
  assert.deepEqual(seen.slice(1), ['b:game', 'b:win', 'b:top2']);
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SocialBook, sendDm } from '../server/social.js';
import { ProfileStore, DAILY_PER_PIP } from '../server/store.js';
import { Room } from '../server/room.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'soc-')), 'social.json');

test('a started game puts everyone on each other\'s "played with" list, newest first', () => {
  let now = 1000;
  const book = new SocialBook(null, { now: () => now });
  book.played([{ userId: '11111', name: 'Ann' }, { userId: '22222', name: 'Bob' }]);
  now = 2000;
  book.played([{ userId: '11111', name: 'Ann' }, { userId: '33333', name: 'Cat' }]);
  const v = book.view('11111');
  assert.deepEqual(v.met.map((m) => m.name), ['Cat', 'Bob']);
  assert.deepEqual(book.view('22222').met.map((m) => m.name), ['Ann']);
});

test('friends: only people you played with, no duplicates, removable, saved', () => {
  const file = tmp();
  const book = new SocialBook(file);
  book.played([{ userId: '11111', name: 'Ann' }, { userId: '22222', name: 'Bob' }]);
  assert.throws(() => book.addFriend('11111', '99999'), /played with/);
  assert.throws(() => book.addFriend('11111', '11111'), /you/);
  book.addFriend('11111', '22222');
  book.addFriend('11111', '22222');
  let v = book.view('11111', (id) => id === '22222');
  assert.deepEqual(v.friends.map((f) => [f.name, f.online]), [['Bob', true]]);
  assert.equal(v.met.length, 0); // friends aren't listed twice
  book.flush();
  const again = new SocialBook(file);
  assert.equal(again.isFriend('11111', '22222'), true);
  again.removeFriend('11111', '22222');
  v = again.view('11111');
  assert.equal(v.friends.length, 0);
  assert.equal(v.met.length, 1);
});

test('guests only meet guests, and are never saved', () => {
  const file = tmp();
  const book = new SocialBook(file);
  book.played([{ userId: 'guest-aaaaaaaa', name: 'G1' }, { userId: '11111', name: 'Ann' }, { userId: 'guest-bbbbbbbb', name: 'G2' }]);
  assert.deepEqual(book.view('guest-aaaaaaaa').met.map((m) => m.name), ['G2']);
  assert.equal(book.view('11111').met.length, 0);
  book.flush();
  assert.equal(new SocialBook(file).users.has('guest-aaaaaaaa'), false);
});

test('invites are rate limited', () => {
  let now = 0;
  const book = new SocialBook(null, { now: () => now });
  book.checkInvite('1', '2');
  assert.throws(() => book.checkInvite('1', '2'), /minute/);
  now += 61_000;
  book.checkInvite('1', '2');
  for (let i = 0; i < 18; i++) book.checkInvite('1', String(100 + i));
  assert.throws(() => book.checkInvite('1', '999'), /later/);
});

test('a DM goes through the bot: open the DM channel, then post', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push([url, JSON.parse(init.body)]);
    return { ok: true, json: async () => ({ id: 'chan1' }) };
  };
  await sendDm('tok', '22222', 'hi', fetch);
  assert.match(calls[0][0], /users\/@me\/channels$/);
  assert.equal(calls[0][1].recipient_id, '22222');
  assert.match(calls[1][0], /channels\/chan1\/messages$/);
  await assert.rejects(sendDm('', '22222', 'hi', fetch), /not set up/);
  await assert.rejects(sendDm('tok', '22222', 'hi', async () => ({ ok: false })), /reach/);
});

test('the daily d20: once a UTC day, 5 coins a pip, outside the earning cap', () => {
  let now = Date.parse('2026-11-14T10:00:00Z');
  const store = new ProfileStore(null, { now: () => now });
  const before = store.get('11111').coins;
  assert.equal(store.view('11111').dailyReady, true);
  assert.equal(store.view('11111').dailyNext, Date.parse('2026-11-15T00:00:00Z'));
  assert.deepEqual(store.rollDaily('11111', () => 20), { roll: 20, coins: 20 * DAILY_PER_PIP, day: 1, doubled: false });
  assert.equal(store.get('11111').coins, before + 100);
  assert.equal(store.view('11111').dailyReady, false);
  assert.equal('daily' in store.view('11111'), false);
  assert.throws(() => store.rollDaily('11111', () => 5), /Already rolled/);
  now = Date.parse('2026-11-15T00:00:01Z');
  assert.equal(store.rollDaily('11111', () => 1).coins, 5);
});

test('the real d20 rolls 1 to 20', () => {
  let day = 0;
  const store = new ProfileStore(null, { now: () => Date.parse('2026-01-01T00:00:00Z') + day++ * 86_400_000 });
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(store.rollDaily('1').roll);
  assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
});

test('starting a game reports its humans (not bots) for the friends lists', () => {
  const started = [];
  const room = new Room('r1', { onGameStart: (p) => started.push(p) });
  const a = { id: '11111', name: 'Ann' };
  const b = { id: '22222', name: 'Bob' };
  room.connect(a);
  room.host(a);
  room.connect(b);
  room.join(b);
  room.addBot(a, 2);
  room.start(a);
  assert.deepEqual(started, [[{ userId: '11111', name: 'Ann' }, { userId: '22222', name: 'Bob' }]]);
  room.destroy();

  const solo = new Room('s', { onGameStart: (p) => started.push(p) });
  solo.connect(a);
  solo.host(a);
  solo.addBot(a, 2);
  solo.start(a);
  assert.equal(started.length, 1); // you and bots: nobody to meet
  solo.destroy();
});

test('the daily streak: day 7 pays double, then starts over; a missed day resets it', async () => {
  const { STREAK_DAYS } = await import('../server/store.js');
  let now = Date.parse('2026-11-01T12:00:00Z');
  const store = new ProfileStore(null, { now: () => now });
  store.get('1');
  const next = (days = 1) => (now += days * 86_400_000);
  const days = [];
  for (let i = 0; i < STREAK_DAYS + 1; i++) {
    assert.equal(store.view('1').streakDay, days.length % STREAK_DAYS + 1);
    const r = store.rollDaily('1', () => 10);
    days.push([r.day, r.coins]);
    assert.equal(store.view('1').streakDay, r.day); // after rolling, today stays highlighted
    next();
  }
  assert.deepEqual(days, [[1, 50], [2, 50], [3, 50], [4, 50], [5, 50], [6, 50], [7, 100], [1, 50]]);
  next(); // skipped a day
  assert.equal(store.view('1').streakDay, 1);
  assert.equal(store.rollDaily('1', () => 10).day, 1);
});

test('players can turn friend invitations off', () => {
  const book = new SocialBook(null);
  assert.equal(book.acceptsInvites('1'), true);
  book.setInvites('1', false);
  assert.equal(book.acceptsInvites('1'), false);
  assert.equal(book.view('1').invitesOn, false);
  book.setInvites('1', true);
  assert.equal(book.acceptsInvites('1'), true);
});

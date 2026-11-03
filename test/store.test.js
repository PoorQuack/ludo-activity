import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/store.js';
import { STARTING_COINS, DAILY_COIN_CAP } from '../shared/shop.js';

const DAY1 = Date.parse('2026-01-01T12:00:00Z');
const DAY2 = Date.parse('2026-01-02T00:30:00Z');

test('addCoins grants the full amount under the daily cap', () => {
  const store = new ProfileStore(null, { now: () => DAY1 });
  assert.equal(store.addCoins('u', 50), 50);
  assert.equal(store.peek('u').coins, STARTING_COINS + 50);
  assert.deepEqual(store.peek('u').earned, { day: '2026-01-01', coins: 50 });
});

test('addCoins grants only what fits under the cap, then 0', () => {
  const store = new ProfileStore(null, { now: () => DAY1 });
  assert.equal(store.addCoins('u', 100), 100);
  assert.equal(store.addCoins('u', 50), DAILY_COIN_CAP - 100); // 20 granted of the 50 asked
  assert.equal(store.addCoins('u', 10), 0); // capped
  assert.equal(store.peek('u').coins, STARTING_COINS + DAILY_COIN_CAP);
});

test('the cap resets on the next UTC day', () => {
  let t = DAY1;
  const store = new ProfileStore(null, { now: () => t });
  store.addCoins('u', DAILY_COIN_CAP);
  assert.equal(store.addCoins('u', 10), 0);
  t = DAY2;
  assert.equal(store.addCoins('u', 10), 10);
  assert.deepEqual(store.peek('u').earned, { day: '2026-01-02', coins: 10 });
});

test('earned survives a save and reload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-store-'));
  const file = path.join(dir, 'profiles.json');
  const store = new ProfileStore(file, { now: () => DAY1 });
  store.addCoins('u', 70);
  store.flush();

  const reloaded = new ProfileStore(file, { now: () => DAY1 });
  assert.deepEqual(reloaded.peek('u').earned, { day: '2026-01-01', coins: 70 });
  // still capped on reload: only 50 of the next 70 lands
  assert.equal(reloaded.addCoins('u', 70), DAILY_COIN_CAP - 70);
  fs.rmSync(dir, { recursive: true });
});

test('a saved profile without earned loads with its coins untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-store-'));
  const file = path.join(dir, 'profiles.json');
  fs.writeFileSync(file, JSON.stringify({ u: { coins: 555, owned: [], equipped: {} } }));
  const store = new ProfileStore(file, { now: () => DAY1 });
  assert.equal(store.peek('u').coins, 555);
  assert.deepEqual(store.peek('u').earned, { day: '', coins: 0 });
  fs.rmSync(dir, { recursive: true });
});

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

// ---------- save-file format, migrations and corruption ----------

function tempStore(body, { fileContents } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-store-'));
  const file = path.join(dir, 'profiles.json');
  if (fileContents !== undefined) fs.writeFileSync(file, fileContents);
  else if (body !== undefined) fs.writeFileSync(file, JSON.stringify(body));
  return { dir, file };
}

test('a legacy v1 flat save loads and is written back as the current version (v3, with gems)', () => {
  const { dir, file } = tempStore({ u: { coins: 555, earned: { day: '2026-01-01', coins: 70 }, owned: ['token-gem'], equipped: {} } });
  const store = new ProfileStore(file, { now: () => DAY1 });
  assert.equal(store.peek('u').coins, 555);
  assert.deepEqual(store.peek('u').earned, { day: '2026-01-01', coins: 70 });
  assert.deepEqual(store.peek('u').owned, ['token-gem']);
  store.flush();
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.version, 3);
  assert.equal(doc.profiles.u.coins, 555);
  assert.equal(doc.profiles.u.gems, 0);
  fs.rmSync(dir, { recursive: true });
});

test('a v2 save migrates to v3: every profile gets 0 gems, coins and items untouched', () => {
  const { dir, file } = tempStore({ version: 2, profiles: { u: { coins: 900, owned: ['token-gem'], equipped: {} }, w: { coins: 5 } } });
  const store = new ProfileStore(file, { now: () => DAY1 });
  assert.equal(store.peek('u').gems, 0);
  assert.equal(store.peek('u').coins, 900);
  assert.equal(store.peek('w').gems, 0);
  store.peek('u').gems = 70;
  store.flush();
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.version, 3);
  assert.equal(doc.profiles.u.gems, 70);
  assert.equal(new ProfileStore(file, { now: () => DAY1 }).peek('u').gems, 70);
  fs.rmSync(dir, { recursive: true });
});

test('a v2 save round-trips', () => {
  const { dir, file } = tempStore({ version: 2, profiles: { u: { coins: 42, owned: ['dice-gold'], equipped: {} } } });
  const store = new ProfileStore(file, { now: () => DAY1 });
  assert.equal(store.peek('u').coins, 42);
  store.flush();
  const reloaded = new ProfileStore(file, { now: () => DAY1 });
  assert.equal(reloaded.peek('u').coins, 42);
  assert.deepEqual(reloaded.peek('u').owned, ['dice-gold']);
  fs.rmSync(dir, { recursive: true });
});

test('an owned item that no longer exists survives save and is hidden from view()', () => {
  const { dir, file } = tempStore({ u: { coins: 10, owned: ['token-retired', 'token-gem'], equipped: {} } });
  const store = new ProfileStore(file, { now: () => DAY1 });
  assert.deepEqual(store.peek('u').owned, ['token-retired', 'token-gem']); // ownership kept
  assert.deepEqual(store.view('u').owned, ['token-gem']); // but the client only sees live items
  store.flush();
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(doc.profiles.u.owned, ['token-retired', 'token-gem']);
  fs.rmSync(dir, { recursive: true });
});

test('an equipped item that no longer exists falls back to default, ownership kept', () => {
  const { dir, file } = tempStore({ u: { coins: 10, owned: ['token-retired'], equipped: { token: 'token-retired' } } });
  const store = new ProfileStore(file, { now: () => DAY1 });
  assert.equal(store.peek('u').equipped.token, 'token-classic');
  assert.deepEqual(store.peek('u').owned, ['token-retired']);
  fs.rmSync(dir, { recursive: true });
});

test('corrupt main file + valid .bak loads the backup and parks the bad file', () => {
  const { dir, file } = tempStore(undefined, { fileContents: '{ not json' });
  fs.writeFileSync(`${file}.bak`, JSON.stringify({ u: { coins: 777, owned: [], equipped: {} } }));
  const store = new ProfileStore(file, { now: () => DAY1 });
  assert.equal(store.peek('u').coins, 777);
  assert.equal(fs.existsSync(file), false);
  const corrupt = fs.readdirSync(dir).find((f) => f.startsWith('profiles.json.corrupt-'));
  assert.ok(corrupt, 'expected a .corrupt-* file');
  assert.equal(fs.readFileSync(path.join(dir, corrupt), 'utf8'), '{ not json');
  fs.rmSync(dir, { recursive: true });
});

test('corrupt main file with no .bak throws and keeps the corrupt data', () => {
  const { dir, file } = tempStore(undefined, { fileContents: '{ not json' });
  assert.throws(() => new ProfileStore(file), /corrupt|refusing/i);
  const corrupt = fs.readdirSync(dir).find((f) => f.startsWith('profiles.json.corrupt-'));
  assert.ok(corrupt, 'expected the bad file to be parked, not deleted');
  assert.equal(fs.readFileSync(path.join(dir, corrupt), 'utf8'), '{ not json');
  fs.rmSync(dir, { recursive: true });
});

test('a save file from a newer version refuses to load', () => {
  const { dir, file } = tempStore({ version: 99, profiles: {} });
  assert.throws(() => new ProfileStore(file), /version 99/);
  assert.ok(fs.existsSync(file), 'the file must not be touched');
  fs.rmSync(dir, { recursive: true });
});

test('flush keeps the previous file as .bak', () => {
  const { dir, file } = tempStore({ u: { coins: 1, owned: [], equipped: {} } });
  const store = new ProfileStore(file, { now: () => DAY1 });
  store.flush();
  assert.ok(fs.existsSync(`${file}.bak`));
  const bak = JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'));
  assert.equal(bak.u?.coins ?? bak.profiles?.u?.coins, 1); // the pre-flush content
  fs.rmSync(dir, { recursive: true });
});

test("today's deal: one item a day at 30% off, the same for everyone, and the server charges that price", async () => {
  const { dailyDeal, priceOf, ITEMS } = await import('../shared/shop.js');
  const day = '2026-11-15';
  const deal = dailyDeal(day);
  assert.ok(['token', 'dice', 'board', 'taunt'].includes(deal.type) && deal.price > 0);
  assert.equal(dailyDeal(day).id, deal.id, 'the same all day');
  assert.ok(new Set(Array.from({ length: 30 }, (_, i) => dailyDeal(`2026-12-${String(i + 1).padStart(2, '0')}`).id)).size > 10, 'it changes from day to day');
  assert.equal(priceOf(deal, day), Math.round((deal.price * 0.7) / 10) * 10);
  const other = Object.values(ITEMS).find((i) => i.type === 'token' && i.price > 0 && i.id !== deal.id);
  assert.equal(priceOf(other, day), other.price);
  const store = new ProfileStore(null, { now: () => Date.parse(`${day}T12:00:00Z`) });
  store.adminCoins('u', 5000);
  const before = store.get('u').coins;
  store.buy('u', deal.id);
  assert.equal(before - store.get('u').coins, priceOf(deal, day));
});

test('badges: lifetime stats reach levels that pay once; gold unlocks the title; pins need the badge', async () => {
  const { BADGES_BY_ID } = await import('../shared/badges.js');
  const told = [];
  const store = new ProfileStore(null, { onBadge: (id, r) => told.push(...r) });
  const start = store.get('ann').coins;
  store.addStat('ann', 'capture', 24);
  assert.deepEqual(told, []);
  store.addStat('ann', 'capture', 1); // 25: bronze
  assert.deepEqual(told, [{ badge: 'menace', level: 1, coins: 50 }]);
  assert.equal(store.get('ann').coins, start + 50);
  store.addStat('ann', 'capture', 1000); // straight past silver and gold: both pay
  assert.deepEqual(told.slice(1).map((r) => r.level), [2, 3]);
  assert.equal(store.get('ann').coins, start + 600);
  store.addStat('ann', 'capture', 1000);
  assert.equal(told.length, 3, 'each level pays once');
  store.addStat('ann', 'game', 5); // not a badge stat
  assert.equal(store.get('ann').stats.game, undefined);
  assert.throws(() => store.setTitle('ann', 'champion'), /gold/);
  store.setTitle('ann', 'menace');
  assert.equal(store.badgeLook('ann').title, 'menace');
  assert.throws(() => store.setPins('ann', ['menace', 'lucky']), /Bad pins/);
  store.setPins('ann', ['menace']);
  assert.deepEqual(store.badgeLook('ann').pins, [{ id: 'menace', level: 3 }]);
  assert.equal(BADGES_BY_ID.menace.goals[2], 500);
  // gifting is gone, and its Generous badge with it
  assert.equal(typeof store.gift, 'undefined');
  assert.equal(BADGES_BY_ID.generous, undefined);
  // and survives a save/load round trip
  const copy = new ProfileStore(null);
  copy.applySave(JSON.stringify({ version: 2, profiles: { ann: store.get('ann') } }));
  assert.equal(copy.get('ann').badges.menace, 3);
  assert.equal(copy.get('ann').title, 'menace');
});

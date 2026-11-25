import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETS, SETS_BY_ID, ITEMS, SHOP_ITEMS, RARITIES, rarityOf, setRarity, setPrice, currencyOf, dailyDeal } from '../shared/shop.js';
import { ProfileStore } from '../server/store.js';

test('every set is made of real, different kinds of items', () => {
  for (const set of SETS) {
    const types = set.items.map((id) => ITEMS[id]?.type);
    assert.ok(types.every(Boolean), set.id);
    assert.equal(new Set(types).size, types.length, `${set.id}: one of each kind`);
  }
});

test('a set costs 10% less than its items, and buying it owns and equips them all', () => {
  const store = new ProfileStore(null);
  const p = store.get('1');
  const set = SETS_BY_ID['set-constellation'];
  const full = set.items.reduce((s, id) => s + ITEMS[id].price, 0);
  // a Legendary set is paid in gems
  assert.deepEqual(setPrice(set, p), { full, price: Math.round(full * 0.9), missing: set.items, currency: 'gems' });
  p.coins = 10_000;
  assert.throws(() => store.buySet('1', 'set-constellation'), /Not enough gems/);
  p.gems = 5_000;
  store.buySet('1', 'set-constellation');
  assert.equal(p.gems, 5_000 - Math.round(full * 0.9));
  assert.equal(p.coins, 10_000, 'coins untouched');
  assert.ok(set.items.every((id) => p.owned.includes(id)));
  assert.deepEqual([p.equipped.token, p.equipped.dice, p.equipped.board], set.items);
  assert.throws(() => store.buySet('1', 'set-constellation'), /already own/);
});

test('owning part of a set: pay for the rest, still 10% off', () => {
  const store = new ProfileStore(null);
  const p = store.get('1');
  p.coins = 10_000;
  store.buy('1', 'board-candy');
  const before = p.coins;
  const { price, missing } = setPrice(SETS_BY_ID['set-candy'], p);
  assert.deepEqual(missing, ['token-candy', 'dice-candy']);
  assert.equal(price, Math.round((ITEMS['token-candy'].price + ITEMS['dice-candy'].price) * 0.9));
  store.buySet('1', 'set-candy');
  assert.equal(p.coins, before - price);
});

test('not enough coins (or gems) for a set: nothing changes', () => {
  const store = new ProfileStore(null);
  const p = store.get('1');
  p.coins = 10;
  assert.throws(() => store.buySet('1', 'set-candy'), /Not enough coins/);
  assert.throws(() => store.buySet('1', 'set-royal'), /Not enough gems/);
  assert.equal(p.coins, 10);
  assert.ok(!p.owned.includes('board-royal') && !p.owned.includes('board-candy'));
});

test('two currencies: Common and Rare cost coins, Epic and Legendary cost gems; a set uses one', () => {
  for (const item of SHOP_ITEMS) {
    if (item.award || item.pass || !(item.price > 0)) continue;
    assert.equal(currencyOf(item), ['epic', 'legendary'].includes(item.rarity) ? 'gems' : 'coins', item.id);
  }
  for (const set of SETS) assert.equal(new Set(set.items.map((id) => currencyOf(ITEMS[id]))).size, 1, set.id);
  assert.equal(currencyOf(dailyDeal('2026-11-23')), 'coins', 'the daily deal is never a gem item');
});

test('buying with gems, gifting with gems, and FREE_SHOP makes both free', () => {
  const store = new ProfileStore(null);
  const p = store.get('1');
  p.coins = 5000;
  assert.throws(() => store.buy('1', 'frame-gold'), /Not enough gems/);
  p.gems = ITEMS['frame-gold'].price;
  store.buy('1', 'frame-gold');
  assert.equal(p.gems, 0);
  assert.equal(p.coins, 5000);
  assert.equal(p.equipped.frame, 'frame-gold');
  p.gems = 1000;
  store.gift('1', '2', 'token-dragon');
  assert.equal(p.gems, 1000 - ITEMS['token-dragon'].price);
  assert.ok(store.get('2').owned.includes('token-dragon'));
  const free = new ProfileStore(null, { freeShop: true });
  const q = free.get('3');
  free.buy('3', 'frame-crown');
  free.buy('3', 'token-neon');
  free.buySet('3', 'set-royal');
  assert.equal(q.gems, 0);
  assert.ok(['frame-crown', 'token-neon', 'board-royal'].every((id) => q.owned.includes(id)));
});

test('every item has a rarity, and a price inside that rarity\'s band', () => {
  const ids = RARITIES.map((r) => r.id);
  for (const item of SHOP_ITEMS) {
    assert.ok(ids.includes(item.rarity), `${item.id} has no rarity`);
    const r = rarityOf(item);
    if (item.award || item.pass || item.starter) continue; // (won, earned on the Battle Pass or in the Starter Pack: never bought)
    const [min, max] = currencyOf(item) === 'gems' ? [r.gemMin, r.gemMax] : [r.min, r.max];
    assert.ok(item.price >= min && item.price <= max, `${item.id}: ${item.price} is outside ${r.id} (${min}-${max} ${currencyOf(item)})`);
  }
  // only the default look of each kind is free
  for (const item of SHOP_ITEMS) assert.equal(item.price === 0, /-classic$|^taunt-none$|^frame-none$/.test(item.id) || !!item.award || !!item.pass || !!item.starter, item.id);
});

test('everything in a set has the same rarity (a Legendary set is Legendary all through)', () => {
  for (const set of SETS) {
    const rarities = new Set(set.items.map((id) => ITEMS[id].rarity));
    assert.equal(rarities.size, 1, `${set.id}: ${[...rarities].join(', ')}`);
    assert.equal(setRarity(set).id, ITEMS[set.items[0]].rarity);
  }
  assert.equal(setRarity(SETS_BY_ID['set-constellation']).id, 'legendary');
  assert.equal(ITEMS['dice-constellation'].rarity, 'legendary');
});

test('rank frames are won on the leaderboard, never bought or given', () => {
  const store = new ProfileStore(null);
  const p = store.get('1');
  p.gems = 10_000;
  assert.ok(!p.owned.includes('frame-rank-1'));
  assert.throws(() => store.buy('1', 'frame-rank-1'), /won on the leaderboard/);
  assert.throws(() => store.gift('1', '2', 'frame-rank-2'), /Unknown item/);
  assert.throws(() => store.equip('1', 'frame-rank-1'), /don't own/);
  assert.equal(store.grantItem('1', 'frame-rank-1'), true);
  assert.equal(p.equipped.frame, 'frame-rank-1', 'put on, as nothing else was');
  store.buy('1', 'frame-neon');
  assert.equal(store.grantItem('1', 'frame-rank-2'), true);
  assert.equal(p.equipped.frame, 'frame-neon', "doesn't replace a frame they chose");
});

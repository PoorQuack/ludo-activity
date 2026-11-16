import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETS, SETS_BY_ID, ITEMS, SHOP_ITEMS, RARITIES, rarityOf, setRarity, setPrice } from '../shared/shop.js';
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
  assert.deepEqual(setPrice(set, p), { full, price: Math.round(full * 0.9), missing: set.items });
  p.coins = 10_000;
  store.buySet('1', 'set-constellation');
  assert.equal(p.coins, 10_000 - Math.round(full * 0.9));
  assert.ok(set.items.every((id) => p.owned.includes(id)));
  assert.deepEqual([p.equipped.token, p.equipped.dice, p.equipped.board], set.items);
  assert.throws(() => store.buySet('1', 'set-constellation'), /already own/);
});

test('owning part of a set: pay for the rest, still 10% off', () => {
  const store = new ProfileStore(null);
  const p = store.get('1');
  p.coins = 10_000;
  store.buy('1', 'board-neon');
  const before = p.coins;
  const { price, missing } = setPrice(SETS_BY_ID['set-neon'], p);
  assert.deepEqual(missing, ['token-neon', 'dice-neon']);
  assert.equal(price, Math.round((ITEMS['token-neon'].price + ITEMS['dice-neon'].price) * 0.9));
  store.buySet('1', 'set-neon');
  assert.equal(p.coins, before - price);
});

test('not enough coins for a set: nothing changes', () => {
  const store = new ProfileStore(null);
  const p = store.get('1');
  p.coins = 10;
  assert.throws(() => store.buySet('1', 'set-royal'), /Not enough coins/);
  assert.equal(p.coins, 10);
  assert.ok(!p.owned.includes('board-royal'));
});

test('every item has a rarity, and a price inside that rarity\'s band', () => {
  const ids = RARITIES.map((r) => r.id);
  for (const item of SHOP_ITEMS) {
    assert.ok(ids.includes(item.rarity), `${item.id} has no rarity`);
    const r = rarityOf(item);
    assert.ok(item.price >= r.min && item.price <= r.max, `${item.id}: ${item.price} is outside ${r.id} (${r.min}-${r.max})`);
  }
  // only the default look of each kind is free
  for (const item of SHOP_ITEMS) assert.equal(item.price === 0, /-classic$|^taunt-none$/.test(item.id), item.id);
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

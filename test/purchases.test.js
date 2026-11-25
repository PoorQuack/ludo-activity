import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Purchases, parseSkus } from '../server/purchases.js';
import { ProfileStore } from '../server/store.js';

const U = '111111111111111111';
const skus = parseSkus('pack-2:50000001,coffee-1:50000002');

// A pretend Discord: entitlements per user; consume marks them consumed (or fails when told to)
function fakeDiscord(entitlements, { consumeFails = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push([opts.method || 'GET', url]);
    if (url.includes('/consume')) {
      if (consumeFails) return { ok: false, status: 500 };
      const id = url.split('/').at(-2);
      entitlements.find((e) => e.id === id).consumed = true;
      return { ok: true, status: 204 };
    }
    const userId = new URL(url).searchParams.get('user_id');
    return { ok: true, status: 200, json: async () => entitlements.filter((e) => e.user_id === userId && !e.consumed) };
  };
  return { fetchImpl, calls };
}
const quiet = { log() {}, warn() {} };

test('a bought gem pack pays VIP Gems (never coins) once and is consumed', async () => {
  const store = new ProfileStore(null);
  const start = store.get(U).gems;
  const coins = store.get(U).coins;
  const ents = [{ id: '90000001', sku_id: '50000001', user_id: U, consumed: false }];
  const d = fakeDiscord(ents);
  const p = new Purchases({ appId: '1', token: 't', skus, store, fetchImpl: d.fetchImpl, log: quiet });
  assert.deepEqual(await p.claim(U), [{ id: 'pack-2', kind: 'gems', gems: 440, first: true }]); // a first pack: double
  assert.equal(store.get(U).gems, start + 440);
  assert.equal(store.get(U).coins, coins, 'real money never buys coins');
  assert.equal(ents[0].consumed, true);
  assert.deepEqual(await p.claim(U), []);
  assert.equal(store.get(U).gems, start + 440);
});

test('if consuming fails, the next claim does not pay again', async () => {
  const store = new ProfileStore(null);
  const start = store.get(U).gems;
  const ents = [{ id: '90000002', sku_id: '50000001', user_id: U, consumed: false }];
  const d = fakeDiscord(ents, { consumeFails: true });
  const p = new Purchases({ appId: '1', token: 't', skus, store, fetchImpl: d.fetchImpl, log: quiet });
  await p.claim(U);
  await p.claim(U);
  await Promise.all([p.claim(U), p.claim(U)]); // at the same time too
  assert.equal(store.get(U).gems, start + 440);
});

test('a coffee pays no gems or coins but is reported; unknown SKUs and other users are ignored', async () => {
  const store = new ProfileStore(null);
  const start = store.get(U).coins;
  const ents = [
    { id: '90000003', sku_id: '50000002', user_id: U, consumed: false },
    { id: '90000004', sku_id: '77777777', user_id: U, consumed: false },
  ];
  const d = fakeDiscord(ents);
  const p = new Purchases({ appId: '1', token: 't', skus, store, fetchImpl: d.fetchImpl, log: quiet });
  assert.deepEqual(await p.claim(U), [{ id: 'coffee-1', kind: 'tip', gems: 0 }]);
  assert.equal(store.get(U).coins, start);
  assert.equal(store.get(U).gems, 0);
  assert.deepEqual(await p.claim('guest-abc'), []);
});

test('turned off without SKUs or a bot token', () => {
  const store = new ProfileStore(null);
  assert.equal(new Purchases({ appId: '1', token: '', skus, store }).enabled, false);
  assert.equal(new Purchases({ appId: '1', token: 't', skus: parseSkus(''), store }).enabled, false);
});

test('the first gem pack is doubled, later ones are not; the Starter Pack pays once and is never consumed', async () => {
  const store = new ProfileStore(null);
  const ents = [
    { id: '91', sku_id: '70000000000000501', user_id: U },
    { id: '92', sku_id: '70000000000000501', user_id: U },
    { id: '93', sku_id: '70000000000000509', user_id: U },
  ];
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push([init.method || 'GET', url]);
    return { ok: true, json: async () => ents };
  };
  const p = new Purchases({ appId: '1', token: 't', skus: parseSkus('pack-1:70000000000000501,starter:70000000000000509'), store, fetchImpl, log: {} });
  const coins = store.get(U).coins;
  const got = await p.claim(U);
  assert.deepEqual(got.map((g) => g.gems), [200, 100, 300]);
  assert.equal(got[2].coins, 500);
  assert.equal(got[2].item, 'dice-jade');
  assert.ok(store.get(U).owned.includes('dice-jade'));
  assert.equal(store.get(U).coins, coins + 500);
  assert.ok(!calls.some(([m, url]) => m === 'POST' && url.includes('/93/')), 'a Durable SKU is never consumed');
  assert.deepEqual(await p.claim(U), []); // nothing twice
  assert.equal(store.view(U).firstPack, false);
});

// The Battle Pass: XP from logins and quests, a monthly track, free and premium lanes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfileStore } from '../server/store.js';
import { Purchases, parseSkus } from '../server/purchases.js';
import { PASS_TIERS, XP_PER_TIER, PASS_XP, passRewards, SEASONS } from '../shared/pass.js';
import { ITEMS, ownsItem } from '../shared/shop.js';

const clock = (iso) => {
  const c = { t: Date.parse(iso), now: () => c.t };
  return c;
};

test('every season item exists, is never sold, and only its earner owns it', () => {
  for (const s of SEASONS) {
    for (const id of [...Object.values(s.items), ...Object.values(s.freeItems || {})]) {
      assert.ok(ITEMS[id], id);
      assert.equal(ITEMS[id].price, 0, id);
      assert.ok(ITEMS[id].pass, id);
      assert.equal(ownsItem({ owned: [] }, id), false, id);
      assert.equal(ownsItem({ owned: [id] }, id), true, id);
    }
  }
  const { tiers } = passRewards('2026-11');
  assert.equal(tiers.length, PASS_TIERS);
  assert.ok(tiers.every((x) => x.free && x.premium));
});

test('login XP once a day; tiers by XP; a new month starts a new track', () => {
  const c = clock('2026-11-25T10:00Z');
  const store = new ProfileStore(null, { now: c.now });
  assert.equal(store.passLogin('1').xp, PASS_XP.login);
  assert.equal(store.passLogin('1'), null); // again today: nothing
  c.t += 86_400_000;
  store.passLogin('1');
  const r = store.addPassXp('1', XP_PER_TIER * 2);
  assert.equal(r.tier, 3);
  assert.equal(store.view('1').pass.tier, 3);
  c.t = Date.parse('2026-12-01T09:00Z');
  assert.equal(store.view('1').pass.xp, 0); // December: a fresh track
  store.passLogin('1');
  assert.equal(store.view('1').pass.xp, PASS_XP.login);
});

test('claiming: free for everyone, premium for holders, each tier once, only once reached', () => {
  const c = clock('2026-11-25T10:00Z');
  const store = new ProfileStore(null, { now: c.now });
  const p = store.get('1');
  const coins = p.coins;
  store.addPassXp('1', XP_PER_TIER * 8); // tier 8: the Samurai tokens on the premium lane
  assert.deepEqual(store.claimPass('1', 'free', 1), { coins: passRewards('2026-11').tiers[0].free.coins });
  assert.throws(() => store.claimPass('1', 'free', 1), /Already claimed/);
  assert.throws(() => store.claimPass('1', 'free', 9), /Reach that tier first/);
  assert.throws(() => store.claimPass('1', 'premium', 1), /Battle Pass holders/);
  store.setPassUntil('1', c.t + 10 * 86_400_000);
  assert.deepEqual(store.claimPass('1', 'premium', 8), { item: 'token-samurai' });
  assert.ok(ownsItem(p, 'token-samurai'));
  const all = store.claimAllPass('1');
  assert.equal(all.filter((g) => g.lane === 'free').length, 7);
  assert.equal(all.filter((g) => g.lane === 'premium').length, 7);
  assert.ok(p.coins > coins);
  assert.ok(p.gems >= 100);
  assert.deepEqual(store.claimAllPass('1'), []); // nothing left
  c.t += 11 * 86_400_000;
  assert.equal(store.view('1').pass.active, false); // the subscription ran out
});

test('the subscription comes from Discord: never consumed, open until its period ends', async () => {
  const store = new ProfileStore(null);
  const ends = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push([init.method || 'GET', url]);
    return { ok: true, json: async () => [{ id: '90000001', sku_id: '70000001', user_id: '123456789', ends_at: ends }] };
  };
  const p = new Purchases({ appId: '1', token: 't', skus: parseSkus('pass:70000001'), store, fetchImpl, log: {} });
  const got = await p.claim('123456789');
  assert.equal(got[0].kind, 'pass');
  assert.equal(store.get('123456789').passUntil, Date.parse(ends));
  assert.ok(!calls.some(([m]) => m === 'POST'), 'a subscription is never consumed');
  assert.deepEqual(await p.claim('123456789'), []); // nothing new
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/store.js';
import { parseStripePrices, StripeStore } from '../server/stripe.js';

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-stripe-')), 'profiles.json');

test('parseStripePrices accepts valid paid item and price ids only', () => {
  const m = parseStripePrices('pack-1:price_abc123,pass:price_sub1,bogus:price_x,pack-2:not_a_price');
  assert.equal(m.size, 2);
  assert.equal(m.get('pack-1').priceId, 'price_abc123');
  assert.equal(m.get('pass').item.kind, 'pass');
});

test('checkout tokens verify Discord users, reject expired/tampered tokens and guests', () => {
  let clock = 1_700_000_000_000;
  const s = new StripeStore({
    secretKey: 'sk_test_1',
    signingSecret: 'secret-key',
    publicUrl: 'https://ludo.commontern.com',
    prices: parseStripePrices('pack-1:price_1'),
    store: new ProfileStore(tempFile()),
    now: () => clock,
  });
  const token = s.signToken({ userId: '1234567890', name: 'Alice', itemId: 'pack-1' }, 60_000);
  const decoded = s.verifyToken(token);
  assert.equal(decoded.userId, '1234567890');
  assert.equal(decoded.itemId, 'pack-1');

  assert.equal(s.verifyToken(token.slice(0, -2) + 'zz'), null);
  assert.equal(s.verifyToken(s.signToken({ userId: 'guest-12345678', itemId: 'pack-1' }, 60_000)), null);
  clock += 61_000;
  assert.equal(s.verifyToken(token), null);
});

test('Stripe Checkout confirms once and ignores duplicate webhook + confirmation calls', async () => {
  const store = new ProfileStore(tempFile());
  store.get('11111111111111111');
  const webhookSecret = 'whsec_test_secret';
  const fulfilled = [];
  let postedBody = '';

  const s = new StripeStore({
    secretKey: 'sk_test_1',
    webhookSecret,
    signingSecret: 's',
    publicUrl: 'https://ludo.commontern.com',
    prices: parseStripePrices('pack-2:price_2,pass:price_pass'),
    store,
    onFulfill: (uid, granted) => fulfilled.push({ uid, granted }),
    fetchImpl: async (url, init) => {
      if (url.endsWith('/checkout/sessions') && init.method === 'POST') {
        postedBody = init.body;
        return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), { status: 200 });
      }
      if (url.includes('/checkout/sessions/cs_test_1')) {
        return new Response(
          JSON.stringify({
            id: 'cs_test_1',
            payment_status: 'paid',
            client_reference_id: '11111111111111111',
            metadata: { userId: '11111111111111111', itemId: 'pack-2' },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    },
  });

  const created = await s.createCheckoutSession({ userId: '11111111111111111', itemId: 'pack-2' });
  assert.equal(created.url, 'https://checkout.stripe.com/c/pay/cs_test_1');
  assert.match(postedBody, /mode=payment/);

  const first = await s.confirmSession('cs_test_1');
  assert.equal(first.paid, true);
  assert.equal(store.peek('11111111111111111').gems, 440); // a first pack: double
  assert.equal(fulfilled.length, 1);

  // Duplicate signed webhook for the exact same session must NOT double-pay.
  const payload = JSON.stringify({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        payment_status: 'paid',
        metadata: { userId: '11111111111111111', itemId: 'pack-2' },
      },
    },
  });
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', webhookSecret).update(`${ts}.${payload}`).digest('hex');
  const event = s.verifyWebhook(Buffer.from(payload), `t=${ts},v1=${sig}`);
  await s.handleWebhook(event);
  assert.equal(store.peek('11111111111111111').gems, 440); // a first pack: double
  assert.equal(fulfilled.length, 1);

  assert.throws(() => s.verifyWebhook(Buffer.from(payload), `t=${ts},v1=${'0'.repeat(64)}`), /mismatch/);
});

test('Stripe Battle Pass subscription activates, renews on invoice.paid, and cancels cleanly', async () => {
  let clock = 1_700_000_000_000;
  const store = new ProfileStore(tempFile(), { now: () => clock });
  store.get('22222222222222222');
  const fulfilled = [];

  const s = new StripeStore({
    secretKey: 'sk_test_1',
    webhookSecret: 'whsec_1',
    signingSecret: 's',
    publicUrl: 'https://ludo.commontern.com',
    prices: parseStripePrices('pass:price_pass'),
    store,
    now: () => clock,
    onFulfill: (uid, granted) => fulfilled.push({ uid, granted }),
    fetchImpl: async () => new Response('{}', { status: 404 }),
  });

  const end1Sec = Math.floor((clock + 30 * 86_400_000) / 1000);
  await s.handleWebhook({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_pass_1',
        payment_status: 'paid',
        metadata: { userId: '22222222222222222', itemId: 'pass' },
        subscription: { id: 'sub_1', current_period_end: end1Sec },
      },
    },
  });
  assert.equal(store.passActive(store.peek('22222222222222222')), true);
  assert.equal(fulfilled.length, 1);

  // Next month's invoice extends passUntil without re-triggering the unlock notification.
  const end2Sec = Math.floor((clock + 61 * 86_400_000) / 1000);
  await s.handleWebhook({
    type: 'invoice.paid',
    data: {
      object: {
        subscription: 'sub_1',
        parent: { subscription_details: { metadata: { userId: '22222222222222222', itemId: 'pass' } } },
        lines: { data: [{ period: { end: end2Sec } }] },
      },
    },
  });
  assert.equal(store.peek('22222222222222222').passUntil, end2Sec * 1000);
  assert.equal(fulfilled.length, 1);

  // Subscription canceled -> passUntil no longer extends past end.
  await s.handleWebhook({
    type: 'customer.subscription.deleted',
    data: {
      object: {
        status: 'canceled',
        ended_at: Math.floor(clock / 1000),
        metadata: { userId: '22222222222222222', itemId: 'pass' },
      },
    },
  });
  assert.equal(store.passActive(store.peek('22222222222222222')), false);
});

test('Stripe refund and dispute claw back Die Gems, remove bought gem items, and revoke Battle Pass', async () => {
  const file = tempFile();
  let store = new ProfileStore(file);
  store.get('33333333333333333');

  // 220 + 300 gems, then the Dragon's Lair board (500): 20 left
  store.grantPurchase('33333333333333333', 'stripe:cs_pack_1', 220);
  store.grantPurchase('33333333333333333', 'stripe:cs_pack_0', 300);
  store.buy('33333333333333333', 'board-lair');
  assert.equal(store.peek('33333333333333333').gems, 20);
  assert.equal(store.peek('33333333333333333').equipped.board, 'board-lair');

  // Reload from disk to confirm stripe: bought ids survive restart
  store = new ProfileStore(file);
  assert.ok(store.peek('33333333333333333').bought.includes('stripe:cs_pack_1'));

  const s = new StripeStore({
    secretKey: 'sk_test_1',
    webhookSecret: 'whsec_1',
    signingSecret: 's',
    publicUrl: 'https://ludo.commontern.com',
    prices: parseStripePrices('pack-2:price_2,pass:price_pass'),
    store,
    fetchImpl: async (url) => {
      if (url.includes('/checkout/sessions?payment_intent=pi_refund')) {
        return new Response(
          JSON.stringify({ data: [{ metadata: { userId: '33333333333333333', itemId: 'pack-2' } }] }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    },
  });

  // Refunding 220 gems with 20 left: the board (500) goes, and 300 comes back as change
  await s.handleWebhook({
    type: 'charge.refunded',
    data: { object: { id: 'ch_1', payment_intent: 'pi_refund', refunded: true, amount: 199, amount_refunded: 199, metadata: {} } },
  });
  const after = store.peek('33333333333333333');
  assert.equal(after.owned.includes('board-lair'), false);
  assert.equal(after.equipped.board, 'board-classic');
  assert.equal(after.gems, 300);

  // Duplicate refund webhook is ignored (idempotent)
  await s.handleWebhook({
    type: 'charge.refunded',
    data: { object: { id: 'ch_1', payment_intent: 'pi_refund', refunded: true, amount: 199, amount_refunded: 199, metadata: {} } },
  });
  assert.equal(store.peek('33333333333333333').gems, 300);

  // Dispute on Battle Pass charge revokes pass immediately
  store.setPassUntil('33333333333333333', Date.now() + 20 * 86_400_000);
  await s.handleWebhook({
    type: 'charge.dispute.created',
    data: { object: { id: 'dp_1', charge: { id: 'ch_2', metadata: { userId: '33333333333333333', itemId: 'pass' } }, metadata: { userId: '33333333333333333', itemId: 'pass' } } },
  });
  assert.equal(store.passActive(store.peek('33333333333333333')), false);
});

test('the Starter Pack can only be bought once on the web', async () => {
  const store = new ProfileStore(tempFile());
  const uid = '22222222222222222';
  store.get(uid);
  const s = new StripeStore({
    secretKey: 'sk_test_1',
    signingSecret: 's',
    publicUrl: 'https://ludo.commontern.com',
    prices: parseStripePrices('starter:price_starter'),
    store,
    fetchImpl: async () => new Response(JSON.stringify({ id: 'cs_s', url: 'https://checkout.stripe.com/c/pay/cs_s' }), { status: 200 }),
  });
  assert.ok((await s.createCheckoutSession({ userId: uid, itemId: 'starter' })).url);
  store.grantPaid(uid, 'stripe:cs_s', { id: 'starter', kind: 'starter', gems: 300, coins: 500, item: 'dice-jade' });
  await assert.rejects(s.createCheckoutSession({ userId: uid, itemId: 'starter' }), /already have the Starter Pack/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileStore, REFERRAL_COINS } from '../server/store.js';

const A = '111111111111111111';
const B = '222222222222222222';
const C = '333333333333333333';

function store() {
  const s = new ProfileStore(null);
  s.get(A); // the inviter has played before
  return s;
}

test('an invited new player pays their inviter once, after their first game', () => {
  const s = store();
  s.get(B);
  assert.equal(s.setReferrer(B, A), true);
  const before = s.get(A).coins;
  assert.deepEqual(s.gameFinished(B), { to: A, coins: REFERRAL_COINS });
  assert.equal(s.get(A).coins, before + REFERRAL_COINS);
  assert.equal(s.view(A).referrals.count, 1);
  assert.equal(s.gameFinished(B), null, 'only the first game pays');
  assert.equal(s.get(A).coins, before + REFERRAL_COINS);
});

test('no referral for yourself, guests, unknown inviters, or a second inviter', () => {
  const s = store();
  s.get(B);
  assert.equal(s.setReferrer(B, B), false);
  assert.equal(s.setReferrer(B, C), false, 'inviter never played');
  assert.equal(s.setReferrer(B, 'not-an-id'), false);
  s.get('guest-x');
  assert.equal(s.setReferrer('guest-x', A), false);
  assert.equal(s.setReferrer(B, A), true);
  s.get(C);
  assert.equal(s.setReferrer(B, C), false, 'the first inviter keeps it');
  assert.equal(s.gameFinished(C), null, 'not invited: nothing to pay');
});

test('referral data survives a save and reload', () => {
  const s = store();
  s.get(B);
  s.setReferrer(B, A);
  s.gameFinished(B);
  const t = new ProfileStore(null);
  t.applySave(JSON.stringify({ version: 2, profiles: Object.fromEntries(s.profiles) }));
  assert.equal(t.get(A).ref.count, 1);
  assert.equal(t.get(B).ref.paid, true);
  assert.equal(t.gameFinished(B), null);
});

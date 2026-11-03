import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket, KeyedLimiter } from '../server/limits.js';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

test('TokenBucket allows a burst up to capacity, then blocks', () => {
  const c = clock();
  const b = new TokenBucket({ capacity: 20, refillPerSec: 8, now: c.now });
  for (let i = 0; i < 20; i++) assert.ok(b.take());
  assert.equal(b.take(), false);
});

test('TokenBucket refills over time', () => {
  const c = clock();
  const b = new TokenBucket({ capacity: 20, refillPerSec: 8, now: c.now });
  for (let i = 0; i < 20; i++) b.take();
  c.advance(1000); // +8 tokens
  for (let i = 0; i < 8; i++) assert.ok(b.take());
  assert.equal(b.take(), false);
  // refilling never exceeds capacity
  c.advance(60_000);
  for (let i = 0; i < 20; i++) assert.ok(b.take());
  assert.equal(b.take(), false);
});

test('KeyedLimiter allows `max` hits per window per key', () => {
  const c = clock();
  const l = new KeyedLimiter({ max: 3, windowMs: 60_000, now: c.now });
  assert.ok(l.hit('a'));
  assert.ok(l.hit('a'));
  assert.ok(l.hit('a'));
  assert.equal(l.hit('a'), false);
});

test('KeyedLimiter keys are independent', () => {
  const c = clock();
  const l = new KeyedLimiter({ max: 2, windowMs: 60_000, now: c.now });
  l.hit('a');
  l.hit('a');
  assert.equal(l.hit('a'), false);
  assert.ok(l.hit('b'));
});

test('KeyedLimiter resets after the window', () => {
  const c = clock();
  const l = new KeyedLimiter({ max: 1, windowMs: 1000, now: c.now });
  assert.ok(l.hit('a'));
  assert.equal(l.hit('a'), false);
  c.advance(1001);
  assert.ok(l.hit('a'));
});

test('KeyedLimiter prune drops expired keys only', () => {
  const c = clock();
  const l = new KeyedLimiter({ max: 5, windowMs: 1000, now: c.now });
  l.hit('old');
  c.advance(1500);
  l.hit('fresh');
  l.prune();
  assert.equal(l.windows.has('old'), false);
  assert.equal(l.windows.has('fresh'), true);
});

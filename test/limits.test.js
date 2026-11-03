import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket, KeyedLimiter, TtlCache } from '../server/limits.js';

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

test('TtlCache returns values within the TTL, misses after', () => {
  const c = clock();
  const cache = new TtlCache({ ttlMs: 1000, maxEntries: 10, now: c.now });
  cache.set('k', 'v');
  assert.equal(cache.get('k'), 'v');
  c.advance(999);
  assert.equal(cache.get('k'), 'v');
  c.advance(2);
  assert.equal(cache.get('k'), undefined);
});

test('TtlCache evicts the oldest entry when full', () => {
  const c = clock();
  const cache = new TtlCache({ ttlMs: 60_000, maxEntries: 3, now: c.now });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  cache.set('d', 4);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('d'), 4);
  assert.equal(cache.entries.size, 3);
});

test('TtlCache prune drops expired entries', () => {
  const c = clock();
  const cache = new TtlCache({ ttlMs: 1000, maxEntries: 10, now: c.now });
  cache.set('old', 1);
  c.advance(1500);
  cache.set('fresh', 2);
  cache.prune();
  assert.equal(cache.entries.has('old'), false);
  assert.equal(cache.entries.has('fresh'), true);
});

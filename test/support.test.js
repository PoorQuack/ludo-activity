// Support requests: bugs DM'd at once, feedback in a digest, limits so nobody floods the owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SupportDesk } from '../server/support.js';

function desk({ ok = true } = {}) {
  const calls = [];
  let now = 1_000_000;
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    if (!ok) return { ok: false, status: 500, text: async () => 'nope' };
    return { ok: true, json: async () => ({ id: 'dm1' }), text: async () => '' };
  };
  const d = new SupportDesk(null, { token: 't', ownerId: '42', fetchImpl, now: () => now, log: { log() {}, error() {} } });
  return { d, calls, tick: (ms) => (now += ms) };
}
const msgs = (calls) => calls.filter((c) => c.url.endsWith('/messages'));

test('a bug report is DMed straight away, with context, and mentions are defused', async () => {
  const { d, calls } = desk();
  const r = await d.submit({ userId: 'u1', name: 'Ann', kind: 'bug', text: 'dice froze @everyone after a 6', context: { room: 'K7QX', mode: '2v2', phase: 'playing', device: 'iPhone' } });
  assert.equal(r.when, 'now');
  assert.equal(calls[0].body.recipient_id, '42');
  const m = msgs(calls)[0].body;
  assert.deepEqual(m.allowed_mentions, { parse: [] });
  assert.match(m.embeds[0].title, /Bug report #1/);
  assert.ok(!m.embeds[0].description.includes('@everyone'));
  assert.ok(m.embeds[0].fields.some((f) => f.value.includes('K7QX')));
  d.stop();
});

test('feedback waits for the daily digest, sent as one message', async () => {
  const { d, calls, tick } = desk();
  await d.submit({ userId: 'u1', name: 'Ann', kind: 'feedback', text: 'more boards please!' });
  await d.submit({ userId: 'u2', name: 'Bob', kind: 'feedback', text: 'love the stickers lol' });
  assert.equal(msgs(calls).length, 0);
  await d.maybeDigest(); // not a day yet
  assert.equal(msgs(calls).length, 0);
  tick(24 * 3_600_000);
  await d.maybeDigest();
  assert.equal(msgs(calls).length, 1);
  const c = msgs(calls)[0].body.content;
  assert.match(c, /2 feedback/);
  assert.match(c, /more boards please/);
  assert.match(c, /love the stickers/);
  await d.submit({ userId: 'u3', name: 'Cy', kind: 'feedback', text: 'a third one here' });
  await d.maybeDigest(); // the next day's
  assert.equal(msgs(calls).length, 1);
  tick(24 * 3_600_000);
  await d.maybeDigest();
  assert.equal(msgs(calls).length, 2);
  d.stop();
});

test('limits: 3 bugs an hour and 3 feedback notes a day per player; too short is refused', async () => {
  const { d, tick } = desk();
  for (let i = 0; i < 3; i++) await d.submit({ userId: 'u1', name: 'A', kind: 'bug', text: `bug number ${i} here` });
  await assert.rejects(d.submit({ userId: 'u1', name: 'A', kind: 'bug', text: 'one more bug here' }), /hour/);
  await d.submit({ userId: 'u2', name: 'B', kind: 'bug', text: 'someone else is fine' });
  tick(3_600_001);
  await d.submit({ userId: 'u1', name: 'A', kind: 'bug', text: 'an hour later is fine' });
  for (let i = 0; i < 3; i++) await d.submit({ userId: 'u1', name: 'A', kind: 'feedback', text: `feedback ${i} here` });
  await assert.rejects(d.submit({ userId: 'u1', name: 'A', kind: 'feedback', text: 'and another one' }), /tomorrow/);
  await assert.rejects(d.submit({ userId: 'u3', name: 'C', kind: 'bug', text: 'short' }), /at least 10/);
  await assert.rejects(d.submit({ userId: 'u3', name: 'C', kind: 'spam', text: 'what is this kind' }), /bug or feedback/);
  d.stop();
});

test('if Discord is unreachable a bug report is kept for the next digest', async () => {
  const { d } = desk({ ok: false });
  await d.submit({ userId: 'u1', name: 'Ann', kind: 'bug', text: 'it broke somehow' });
  assert.equal(d.data.queue.length, 1);
  assert.equal(d.data.requests.length, 1);
  d.stop();
});

// Support requests: set questions, optional picture/video, bugs DMed at once, feedback in a
// digest, limits so nobody floods the owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SupportDesk, checkAnswers, sniffFile } from '../server/support.js';

function desk({ ok = true } = {}) {
  const calls = [];
  let now = 1_000_000;
  const fetchImpl = async (url, opts) => {
    const isForm = opts.body instanceof FormData;
    const body = isForm ? JSON.parse(opts.body.get('payload_json')) : JSON.parse(opts.body);
    calls.push({ url, body, files: isForm ? [...opts.body.keys()].filter((k) => k.startsWith('files')) : [] });
    if (!ok) return { ok: false, status: 403, text: async () => '{"code": 50007}' };
    return { ok: true, json: async () => ({ id: 'dm1' }), text: async () => '' };
  };
  const d = new SupportDesk(null, { token: 't', ownerId: '42', fetchImpl, now: () => now, log: { log() {}, error() {} } });
  return { d, calls, tick: (ms) => (now += ms) };
}
const msgs = (calls) => calls.filter((c) => c.url.endsWith('/messages'));
const BUG = { what: 'the dice froze @everyone after a 6', before: 'rolled a six', often: 'sometimes', where: 'game' };
const FB = (text) => ({ topic: 'idea', text, stars: 5 });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);

test('the questions are checked', () => {
  assert.deepEqual(checkAnswers('bug', BUG), BUG);
  assert.throws(() => checkAnswers('bug', { ...BUG, what: 'short' }), /what happened/);
  assert.throws(() => checkAnswers('bug', { ...BUG, before: '' }), /just before/);
  assert.throws(() => checkAnswers('bug', { ...BUG, often: 'never' }), /How often/);
  assert.throws(() => checkAnswers('bug', { ...BUG, where: 'moon' }), /Where/);
  assert.equal(checkAnswers('feedback', { topic: 'boards', text: 'more boards please', stars: 9 }).stars, null);
  assert.throws(() => checkAnswers('feedback', { topic: 'x', text: 'more boards please' }), /about/);
  assert.throws(() => checkAnswers('spam', {}), /bug or feedback/);
});

test('a bug report is DMed straight away, with its answers and context; mentions are defused', async () => {
  const { d, calls } = desk();
  const r = await d.submit({ userId: 'u1', name: 'Ann', kind: 'bug', answers: BUG, context: { room: 'K7QX', mode: '2v2', phase: 'playing', device: 'iPhone' } });
  assert.equal(r.when, 'now');
  assert.equal(r.ticket, undefined);
  assert.equal(calls[0].body.recipient_id, '42');
  const m = msgs(calls)[0].body;
  assert.deepEqual(m.allowed_mentions, { parse: [] });
  const e = m.embeds[0];
  assert.match(e.title, /Bug report #1/);
  assert.ok(!e.description.includes('@everyone'));
  const v = e.fields.map((f) => f.value).join(' | ');
  assert.match(v, /rolled a six/);
  assert.match(v, /Sometimes/);
  assert.match(v, /During a game/);
  assert.match(v, /K7QX/);
  d.stop();
});

test('a bug report with a screenshot waits for the upload, then arrives with the picture', async () => {
  const { d, calls } = desk();
  const r = await d.submit({ userId: 'u1', name: 'Ann', kind: 'bug', answers: BUG, attach: { size: PNG.length } });
  assert.ok(r.ticket);
  assert.equal(msgs(calls).length, 0);
  await d.uploadFile(r.ticket, PNG);
  const m = msgs(calls)[0];
  assert.deepEqual(m.files, ['files[0]']);
  assert.equal(m.body.embeds[0].image.url, 'attachment://1.png');
  await assert.rejects(d.uploadFile(r.ticket, PNG), /expired/); // tickets are one-time
  d.stop();
});

test('files: only pictures and videos, 10 MB at most', async () => {
  assert.equal(sniffFile(PNG).ext, 'png');
  assert.equal(sniffFile(Buffer.from('\x00\x00\x00\x18ftypqt  ' + ' '.repeat(20), 'latin1')).ext, 'mov');
  assert.equal(sniffFile(Buffer.from('\x00\x00\x00\x18ftypisom' + ' '.repeat(20), 'latin1')).ext, 'mp4');
  assert.equal(sniffFile(Buffer.from('MZ this is an exe file')), null);
  const { d, calls } = desk();
  await assert.rejects(d.submit({ userId: 'u1', name: 'A', kind: 'bug', answers: BUG, attach: { size: 11 * 1024 * 1024 } }), /too big/);
  const r = await d.submit({ userId: 'u1', name: 'A', kind: 'bug', answers: BUG, attach: { size: 30 } });
  await assert.rejects(d.uploadFile(r.ticket, Buffer.from('MZ this is an exe file, honest')), /Only pictures/);
  // the report still went, without the file
  assert.equal(msgs(calls).length, 1);
  assert.match(msgs(calls)[0].body.embeds[0].fields.map((f) => f.value).join(' '), /not an image or video/);
  d.stop();
});

test('feedback waits for the daily digest, sent as one message', async () => {
  const { d, calls, tick } = desk();
  await d.submit({ userId: 'u1', name: 'Ann', kind: 'feedback', answers: FB('more boards please!') });
  await d.submit({ userId: 'u2', name: 'Bob', kind: 'feedback', answers: { topic: 'stickers', text: 'love the stickers lol' } });
  assert.equal(msgs(calls).length, 0);
  await d.maybeDigest(); // not a day yet
  assert.equal(msgs(calls).length, 0);
  tick(24 * 3_600_000);
  await d.maybeDigest();
  assert.equal(msgs(calls).length, 1);
  const c = msgs(calls)[0].body.content;
  assert.match(c, /2 feedback/);
  assert.match(c, /New idea · ★★★★★/);
  assert.match(c, /love the stickers/);
  d.stop();
});

test('limits: 3 bugs an hour and 3 feedback notes a day per player', async () => {
  const { d, tick } = desk();
  for (let i = 0; i < 3; i++) await d.submit({ userId: 'u1', name: 'A', kind: 'bug', answers: BUG });
  await assert.rejects(d.submit({ userId: 'u1', name: 'A', kind: 'bug', answers: BUG }), /hour/);
  await d.submit({ userId: 'u2', name: 'B', kind: 'bug', answers: BUG });
  tick(3_600_001);
  await d.submit({ userId: 'u1', name: 'A', kind: 'bug', answers: BUG });
  for (let i = 0; i < 3; i++) await d.submit({ userId: 'u1', name: 'A', kind: 'feedback', answers: FB(`feedback ${i} here`) });
  await assert.rejects(d.submit({ userId: 'u1', name: 'A', kind: 'feedback', answers: FB('and another one') }), /tomorrow/);
  d.stop();
});

test('if Discord says no, the report is kept, and the reason is recorded', async () => {
  const { d } = desk({ ok: false });
  await d.submit({ userId: 'u1', name: 'Ann', kind: 'bug', answers: BUG });
  assert.equal(d.data.queue.length, 1);
  assert.match(d.lastError, /50007/);
  d.stop();
});

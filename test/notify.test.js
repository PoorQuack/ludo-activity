import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscordNotifier, NOTIFY_GAP_MS, NOTIFY_PER_DAY } from '../server/notify.js';
import { SocialBook } from '../server/social.js';

function make(opts = {}) {
  let t = 1_000_000;
  const sent = [];
  const n = new DiscordNotifier({
    token: 'x',
    now: () => t,
    log: { warn() {} },
    send: async (token, id, content) => {
      if (opts.refuse) throw new Error('no');
      sent.push({ id, content });
    },
    ...opts,
  });
  return { n, sent, tick: (ms) => (t += ms) };
}

test('a mention while away sends one Discord DM, and a burst is one notice', async () => {
  const { n, sent, tick } = make();
  assert.equal(await n.mention('123456', { fromId: '999999', from: 'Ana', text: 'hi @Bo', where: 'world' }), true);
  assert.equal(await n.mention('123456', { fromId: '999999', from: 'Ana', text: 'again', where: 'world' }), false);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /Ana\*\* mentioned you in the Ludo world chat/);
  // someone else, or a DM, is its own notice
  assert.equal(await n.message('123456', { fromId: '999999', from: 'Ana', text: 'yo' }), true);
  tick(NOTIFY_GAP_MS);
  assert.equal(await n.mention('123456', { fromId: '999999', from: 'Ana', text: 'later', where: 'room' }), true);
  assert.equal(sent.length, 3);
});

test('daily cap, guests, the off switch and refusals', async () => {
  const { n, sent } = make();
  for (let i = 0; i < NOTIFY_PER_DAY + 3; i++) await n.message('123456', { fromId: String(100000 + i), from: 'F', text: 'x' });
  assert.equal(sent.length, NOTIFY_PER_DAY);
  assert.equal(await n.message('guest-abc', { fromId: '100000', from: 'F', text: 'x' }), false);
  const off = make({ allowed: () => false });
  assert.equal(await off.n.message('123456', { fromId: '100000', from: 'F', text: 'x' }), false);
  const no = make({ refuse: true });
  assert.equal(await no.n.message('123456', { fromId: '100000', from: 'F', text: 'x' }), false);
  assert.equal(await no.n.message('123456', { fromId: '100001', from: 'G', text: 'x' }), false); // left alone for a while
  assert.equal(no.n.failed, 1);
});

test('names and text cannot ping everyone or break the formatting', async () => {
  const { n, sent } = make();
  await n.message('123456', { fromId: '100000', from: '**@everyone**', text: '`code` @here' });
  assert.doesNotMatch(sent[0].content, /@everyone|@here|`/);
});

test('the notifications switch and the blocked list are kept across a restart', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pings-')), 'social.json');
  const a = new SocialBook(file);
  a.setPings('111111', false);
  a.block('111111', '222222');
  a.flush();
  const b = new SocialBook(file);
  assert.equal(b.acceptsPings('111111'), false);
  assert.equal(b.view('111111').pingsOn, false);
  assert.equal(b.isBlocked('111111', '222222'), true);
  b.setPings('111111', true);
  assert.equal(b.acceptsPings('111111'), true);
});

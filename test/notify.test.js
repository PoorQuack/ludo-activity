import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscordNotifier } from '../server/notify.js';
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

test('every ping while away is sent, in order, with no cap', async () => {
  const { n, sent } = make();
  const all = [];
  for (let i = 0; i < 40; i++) all.push(n.mention('123456', { from: 'Ana', text: `ping ${i}`, where: i % 2 ? 'lang' : 'global' }));
  all.push(n.message('123456', { from: 'Ana', text: 'dm' }));
  assert.deepEqual(new Set(await Promise.all(all)), new Set([true]));
  assert.equal(sent.length, 41);
  assert.match(sent[0].content, /Ana\*\* mentioned you in the Ludo world chat:\n> ping 0/);
  assert.match(sent[1].content, /language chat/);
  assert.match(sent[40].content, /sent you a message/);
});

test('guests, the off switch, and people Discord refuses', async () => {
  const { n } = make();
  assert.equal(await n.message('guest-abc', { from: 'F', text: 'x' }), false);
  const off = make({ allowed: () => false });
  assert.equal(await off.n.message('123456', { from: 'F', text: 'x' }), false);
  const no = make({ refuse: true });
  assert.equal(await no.n.message('123456', { from: 'F', text: 'x' }), false);
  assert.equal(await no.n.message('123456', { from: 'G', text: 'x' }), false); // skipped for an hour
  assert.equal(no.n.failed, 1);
  no.tick(60 * 60_000);
  assert.equal(await no.n.message('123456', { from: 'G', text: 'x' }), false);
  assert.equal(no.n.failed, 2); // tried again after the hour
});

test('Discord "slow down" answers are waited out, and the DM channel is reused', async () => {
  const calls = [];
  let limited = 2;
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/users/@me/channels')) return { ok: true, status: 200, json: async () => ({ id: 'ch1' }) };
    if (limited-- > 0) return { ok: false, status: 429, json: async () => ({ retry_after: 0.01 }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const waits = [];
  const n = new DiscordNotifier({ token: 'x', fetchImpl, wait: async (ms) => waits.push(ms), log: { warn() {} } });
  assert.equal(await n.message('123456', { from: 'A', text: '1' }), true);
  assert.equal(await n.message('123456', { from: 'A', text: '2' }), true);
  assert.equal(calls.filter((u) => u.endsWith('/users/@me/channels')).length, 1);
  assert.equal(calls.filter((u) => u.includes('/channels/ch1/messages')).length, 4);
  assert.equal(waits.length, 2);
});

test('names and text cannot ping everyone or break the formatting', async () => {
  const { n, sent } = make();
  await n.message('123456', { from: '**@everyone**', text: '`code` @here' });
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

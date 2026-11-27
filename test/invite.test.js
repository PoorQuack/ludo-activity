import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileStore } from '../server/store.js';
import { ServerInvite, SNOOZE_MS } from '../server/invite.js';

test('players are asked until they join or tick "Don\'t ask again"; "No thanks" waits a week', () => {
  let now = 1_000_000;
  const store = new ProfileStore(null, { now: () => now });
  assert.equal(store.wantsInvite('1'), true);
  store.answerInvite('1', 'later', SNOOZE_MS);
  assert.equal(store.wantsInvite('1'), false);
  now += SNOOZE_MS - 1;
  assert.equal(store.wantsInvite('1'), false);
  now += 1;
  assert.equal(store.wantsInvite('1'), true);
  store.answerInvite('1', 'never');
  now += SNOOZE_MS * 100;
  assert.equal(store.wantsInvite('1'), false);
  store.answerInvite('2', 'join');
  assert.equal(store.wantsInvite('2'), false);
  store.answerInvite('3', 'bogus');
  assert.equal(store.wantsInvite('3'), true);
  assert.equal('invite' in store.view('1'), false); // not sent to the client
});

test('the invite answer survives a save and reload', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inv-')), 'p.json');
  const a = new ProfileStore(file);
  a.answerInvite('42', 'never');
  a.flush();
  assert.equal(new ProfileStore(file).wantsInvite('42'), false);
});

function fakeDiscord(members) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/invites/dX7KtUVZm9')) return { ok: true, status: 200, json: async () => ({ guild: { id: '999' } }) };
    const m = url.match(/guilds\/999\/members\/(\d+)$/);
    if (m && members.includes(m[1])) return { ok: true, status: 200, json: async () => ({}) };
    if (m) return { ok: false, status: 404, json: async () => ({ code: 10007 }) };
    return { ok: false, status: 403, json: async () => ({ code: 50001 }) };
  };
  return { fetch, calls };
}

test('the bot can tell who is already in the server, and caches it', async () => {
  const d = fakeDiscord(['111']);
  const inv = new ServerInvite({ url: 'https://discord.gg/dX7KtUVZm9', token: 't', fetch: d.fetch });
  assert.equal(await inv.isMember('111'), true);
  assert.equal(await inv.isMember('222'), false);
  const n = d.calls.length;
  assert.equal(await inv.isMember('111'), true);
  assert.equal(d.calls.length, n); // cached
});

test('without a bot, or for guests, membership is unknown (so they are just asked)', async () => {
  const d = fakeDiscord(['111']);
  assert.equal(await new ServerInvite({ url: 'https://discord.gg/dX7KtUVZm9', fetch: d.fetch }).isMember('111'), null);
  const inv = new ServerInvite({ url: 'https://discord.gg/dX7KtUVZm9', token: 't', fetch: d.fetch });
  assert.equal(await inv.isMember('guest-abc12345'), null);
  assert.equal(new ServerInvite({ url: '' }).enabled, false);
});

test('the thank-you for joining is paid once per account, never to guests', () => {
  const store = new ProfileStore(null);
  const before = store.get('123456').coins;
  assert.equal(store.joinReward('123456'), 100);
  assert.equal(store.get('123456').coins, before + 100);
  assert.equal(store.get('123456').invite.status, 'joined');
  assert.equal(store.joinReward('123456'), 0); // left and joined again: no second payout
  assert.equal(store.joinReward('guest-abc'), 0);
});

test('one-tap join: the bot adds them with their guilds.join token', async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/invites/')) return { ok: true, status: 200, json: async () => ({ guild: { id: '42' } }) };
    if (url.endsWith('/guilds/42/members/123456') && init.method === 'PUT') return { ok: true, status: 201, text: async () => '' };
    if (url.endsWith('/guilds/42/members/999999') && init.method === 'PUT') return { ok: true, status: 204, text: async () => '' };
    return { ok: false, status: 403, text: async () => 'Missing Permissions' };
  };
  const inv = new ServerInvite({ url: 'https://discord.gg/abc', token: 'bot', fetch });
  assert.equal(await inv.addMember('123456', 'user-token'), 'added');
  assert.equal(JSON.parse(calls.at(-1).init.body).access_token, 'user-token');
  assert.equal(calls.at(-1).init.headers.Authorization, 'Bot bot');
  assert.equal(await inv.isMember('123456'), true); // (remembered, no extra call)
  assert.equal(await inv.addMember('999999', 'user-token'), 'already');
  assert.equal(await inv.addMember('555555', 'user-token'), null);
  assert.match(inv.lastError, /403/);
});

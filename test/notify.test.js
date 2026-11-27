import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DiscordNotifier, GROUP_MS } from '../server/notify.js';
import { SocialBook, cleanQuiet } from '../server/social.js';

// A notifier with a fake clock and fake timers: run() fires what's due
function make(opts = {}) {
  let t = 1_000_000;
  const sent = [];
  const due = new Set();
  const state = { online: new Set(), quiet: false };
  const n = new DiscordNotifier({
    token: 'x',
    now: () => t,
    log: { warn() {} },
    isOnline: (id) => state.online.has(id),
    quietNow: () => state.quiet,
    timers: { set: (fn, ms) => { const h = { fn, at: t + ms }; due.add(h); return h; }, clear: (h) => due.delete(h) },
    send: async (token, id, content) => {
      if (opts.refuse) throw new Error('no');
      sent.push({ id, content });
    },
    ...opts,
  });
  const run = async (ms) => {
    t += ms;
    for (const h of [...due]) if (h.at <= t) { due.delete(h); await h.fn(); }
    await new Promise((r) => setImmediate(r));
  };
  return { n, sent, state, run };
}

test('a burst of pings while away arrives as one DM after a minute, every ping counted', async () => {
  const { n, sent, run } = make();
  for (let i = 0; i < 6; i++) assert.equal(n.mention('123456', { fromId: '900001', from: 'Ana', text: `ping ${i}`, where: 'global' }), true);
  n.mention('123456', { fromId: '900002', from: 'Cy', text: 'hola', where: 'lang' });
  n.message('123456', { fromId: '900003', from: 'Bo', text: 'one' });
  n.message('123456', { fromId: '900003', from: 'Bo', text: 'two' });
  await run(GROUP_MS - 1);
  assert.equal(sent.length, 0);
  await run(1);
  assert.equal(sent.length, 1);
  const c = sent[0].content;
  assert.match(c.content, /You have 9 new pings in Ludo/);
  const by = Object.fromEntries(c.embeds.map((e) => [e.author.name, e.description]));
  assert.equal(by['Ana mentioned you 6 times in the Ludo world chat'], 'ping 5');
  assert.equal(by['Cy mentioned you in the Ludo language chat'], 'hola');
  assert.equal(by['Bo sent you 2 messages'], 'two');
  // the next ping starts a new wait
  n.mention('123456', { fromId: '900001', from: 'Ana', text: 'again', where: 'room' });
  await run(GROUP_MS);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].content.content, '🔔 **Ana** mentioned you in Ludo');
  assert.equal(sent[1].content.embeds[0].author.name, 'Ana mentioned you in your Ludo room');
});

test('back in the game within the minute: nothing is sent', async () => {
  const { n, sent, state, run } = make();
  n.message('123456', { fromId: '900003', from: 'Bo', text: 'hi' });
  state.online.add('123456');
  n.cancel('123456');
  await run(GROUP_MS);
  assert.equal(sent.length, 0);
  // or still connected when the wait ends
  state.online.delete('123456');
  n.message('123456', { fromId: '900003', from: 'Bo', text: 'hi' });
  state.online.add('123456');
  await run(GROUP_MS);
  assert.equal(sent.length, 0);
});

test('quiet hours keep the pings and send one summary when they end', async () => {
  const { n, sent, state, run } = make();
  state.quiet = true;
  n.mention('123456', { fromId: '900001', from: 'Ana', text: 'a', where: 'global' });
  await run(GROUP_MS);
  n.mention('123456', { fromId: '900001', from: 'Ana', text: 'b', where: 'global' });
  await run(60 * 60_000);
  assert.equal(sent.length, 0);
  state.quiet = false;
  await run(10 * 60_000);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content.content, /mentioned you 2 times/);
});

test('guests, switched-off kinds, and people Discord refuses', async () => {
  const { n, run } = make({ allowed: (id, kind) => kind !== 'dm' });
  assert.equal(n.message('guest-abc', { fromId: '1', from: 'F', text: 'x' }), false);
  assert.equal(n.message('123456', { fromId: '900001', from: 'F', text: 'x' }), false);
  assert.equal(n.mention('123456', { fromId: '900001', from: 'F', text: 'x', where: 'global' }), true);
  const no = make({ refuse: true });
  no.n.message('123456', { fromId: '900001', from: 'F', text: 'x' });
  await no.run(GROUP_MS);
  assert.equal(no.n.failed, 1);
  assert.equal(no.n.message('123456', { fromId: '900001', from: 'F', text: 'x' }), false); // skipped for an hour
  await run(0);
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
  assert.equal(await n.notify('123456', 'one'), true);
  assert.equal(await n.notify('123456', 'two'), true);
  assert.equal(calls.filter((u) => u.endsWith('/users/@me/channels')).length, 1);
  assert.equal(calls.filter((u) => u.includes('/channels/ch1/messages')).length, 4);
  assert.equal(waits.length, 2);
});

test('names and text cannot ping everyone or break the formatting', async () => {
  const { n, sent, run } = make();
  n.message('123456', { fromId: '900001', from: '**@everyone**', text: '`code` @here' });
  await run(GROUP_MS);
  assert.doesNotMatch(JSON.stringify(sent[0].content), /@everyone|@here|`/);
});

test('settings are kept across a restart: switches, quiet hours, blocked list', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pings-')), 'social.json');
  const a = new SocialBook(file);
  a.setPings('111111', 'dm', false);
  a.setQuiet('111111', { from: 22, to: 7, tz: 'Europe/London' });
  a.block('111111', '222222');
  a.flush();
  const b = new SocialBook(file);
  assert.equal(b.acceptsPings('111111', 'dm'), false);
  assert.equal(b.acceptsPings('111111', 'mention'), true);
  assert.deepEqual(b.view('111111').pings, { mention: true, dm: false });
  assert.deepEqual(b.view('111111').quiet, { from: 22, to: 7, tz: 'Europe/London' });
  assert.equal(b.isBlocked('111111', '222222'), true);
});

test('quiet hours follow the player\'s time zone, across midnight', () => {
  const s = new SocialBook(null);
  s.setQuiet('1', { from: 23, to: 8, tz: 'Asia/Tokyo' });
  assert.equal(s.quietNow('1', Date.UTC(2026, 0, 1, 15)), true); // 00:00 in Tokyo
  assert.equal(s.quietNow('1', Date.UTC(2026, 0, 1, 3)), false); // 12:00 in Tokyo
  s.setQuiet('1', { from: 1, to: 6, tz: 'UTC' });
  assert.equal(s.quietNow('1', Date.UTC(2026, 0, 1, 3)), true);
  assert.equal(s.quietNow('1', Date.UTC(2026, 0, 1, 7)), false);
  assert.equal(cleanQuiet({ from: 5, to: 5, tz: 'UTC' }), null);
  assert.equal(cleanQuiet({ from: 1, to: 6, tz: 'Not/AZone' }), null);
  s.setQuiet('1', null);
  assert.equal(s.quietNow('1'), false);
});

test('old saved "noPings" turns both kinds off', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pings-')), 'social.json');
  fs.writeFileSync(file, JSON.stringify({ users: { 111111: { met: [], friends: [], in: [], out: [], noPings: true } } }));
  const b = new SocialBook(file);
  assert.equal(b.acceptsPings('111111', 'dm'), false);
  assert.equal(b.acceptsPings('111111', 'mention'), false);
});

test('the card shows the sender like a Discord message: picture, name, Open Ludo', async () => {
  const profiles = { 900001: { name: 'Ana', avatar: 'abc123', level: 12, wins: 30, games: 71 } };
  const { n, sent, run } = make({ appId: '777', profileOf: (id) => profiles[id] });
  n.message('123456', { fromId: '900001', from: 'Ana', text: 'yes' });
  await run(GROUP_MS);
  const m = sent[0].content;
  assert.equal(m.content, '💬 **Ana** sent you a message in Ludo');
  const e = m.embeds[0];
  assert.equal(e.author.name, 'Ana sent you a message');
  assert.equal(e.author.icon_url, 'https://cdn.discordapp.com/avatars/900001/abc123.png?size=128');
  assert.equal(e.description, 'yes');
  assert.equal(e.fields, undefined); // no stats in a DM
  assert.equal(m.components[0].components[0].url, 'https://discord.com/activities/777?custom_id=dm-900001');
  // no picture: Discord's default one
  n.mention('123456', { fromId: '4194304', from: 'Zed', text: 'hi', where: 'lang' });
  await run(GROUP_MS);
  assert.match(sent[1].content.embeds[0].author.icon_url, /embed\/avatars\/1\.png$/);
  assert.match(sent[1].content.components[0].components[0].url, /custom_id=chat-lang$/);
});

test('a sticker shows as the picture, not its :code:', async () => {
  const { n, sent, run } = make({ publicUrl: 'https://ludo.example' });
  n.message('123456', { fromId: '900001', from: 'Ana', text: ':cathappy:' });
  await run(GROUP_MS);
  const m = sent[0].content;
  assert.equal(m.content, '💬 **Ana** sent you a sticker in Ludo');
  assert.equal(m.embeds[0].author.name, 'Ana sent you a sticker');
  assert.equal(m.embeds[0].image.url, 'https://ludo.example/emotes/cats/cathappy.gif');
  assert.equal(m.embeds[0].description, undefined);
  // with words too: the words, and the sticker as the picture
  n.message('123456', { fromId: '900002', from: 'Bo', text: 'gg :cathappy: lol' });
  await run(GROUP_MS);
  assert.equal(sent[1].content.embeds[0].description, 'gg lol');
  assert.match(sent[1].content.embeds[0].image.url, /cathappy\.gif$/);
  // not a real sticker: left as typed
  n.message('123456', { fromId: '900003', from: 'Cy', text: ':nope:' });
  await run(GROUP_MS);
  assert.equal(sent[2].content.embeds[0].description, ':nope:');
});

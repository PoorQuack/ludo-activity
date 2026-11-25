import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LobbyChat, channelId, KEEP, COOLDOWN_MS } from '../server/lobbychat.js';
import { Translator } from '../server/translate.js';

const ann = { id: 'ann', name: 'Ann' };
const bob = { id: 'bob', name: 'Bob' };

test('channels: Global, and one per game language; anything else is refused', () => {
  assert.equal(channelId('global', 'fr'), 'global');
  assert.equal(channelId('lang', 'fr'), 'lang:fr');
  assert.throws(() => channelId('lang', 'xx'));
  assert.throws(() => channelId('secret', 'en'));
});

test('messages are cleaned, rate limited, and only the last ones kept', () => {
  const c = { t: 1_000_000 };
  const chat = new LobbyChat(null, { now: () => c.t });
  const m = chat.say(ann, 'global', '  hello   shit  ');
  assert.equal(m.text, 'hello   ****');
  assert.equal(m.name, 'Ann');
  assert.throws(() => chat.say(ann, 'global', 'again'), /Slow down/);
  assert.ok(chat.say(bob, 'global', 'hi ann')); // someone else isn't slowed by Ann
  assert.equal(chat.say(bob, 'lang:fr', '   '), null); // nothing to say
  for (let i = 0; i < KEEP + 5; i++) {
    c.t += COOLDOWN_MS;
    chat.say(ann, 'lang:fr', `msg ${i}`);
  }
  assert.equal(chat.history('lang:fr').length, KEEP);
  assert.equal(chat.history('lang:fr').at(-1).text, `msg ${KEEP + 4}`);
  assert.equal(chat.history('global').length, 2); // channels are separate
});

test("stickers only show for their owners; others' codes stay words", () => {
  const profiles = { peek: () => ({ owned: [] }) };
  const chat = new LobbyChat(null, { profiles });
  assert.equal(chat.say(ann, 'global', 'gg :buffcat:').text, 'gg buffcat');
});

test('saved and read back; the owner can remove a message', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-lchat-'));
  const file = path.join(dir, 'lobby-chat.json');
  const chat = new LobbyChat(file);
  const m = chat.say(ann, 'global', 'hello world');
  chat.say(bob, 'lang:es', 'hola');
  chat.flush();
  const again = new LobbyChat(file);
  assert.equal(again.history('global')[0].text, 'hello world');
  assert.equal(again.history('lang:es')[0].text, 'hola');
  assert.ok(again.remove('global', m.id));
  assert.equal(again.history('global').length, 0);
  assert.equal(again.say(bob, 'global', 'next').id, 2); // ids keep counting
});

// A stand-in for Google's endpoint: "translates" by upper-casing, says it was Spanish
function fakeGoogle(calls) {
  return async (url) => {
    const u = new URL(url);
    const qs = u.searchParams.getAll('q');
    calls.push({ qs, tl: u.searchParams.get('tl') });
    return { ok: true, json: async () => qs.map((q) => [q.toUpperCase(), 'es']) };
  };
}

test('translation keeps stickers, is cached, and is capped per player', async () => {
  const calls = [];
  const tr = new Translator({ fetch: fakeGoogle(calls), perUser: 2 });
  const r = await tr.translate('ann', 'hola :buffcat: amigo', 'en');
  assert.deepEqual(r, { text: 'HOLA :buffcat: AMIGO', from: 'es' });
  assert.deepEqual(calls[0].qs, ['hola', 'amigo']); // the sticker code never goes out
  await tr.translate('ann', 'hola :buffcat: amigo', 'en'); // cached: no new request
  assert.equal(calls.length, 1);
  assert.equal((await tr.translate('ann', ':buffcat:', 'en')).text, ':buffcat:'); // nothing to translate
  assert.equal(calls.length, 1);
  await tr.translate('ann', 'uno', 'zh');
  assert.equal(calls[1].tl, 'zh-CN');
  await assert.rejects(tr.translate('ann', 'dos', 'en'), /Too many translations/);
  await assert.rejects(tr.translate('bob', 'dos', 'xx'), /Unknown language/);
});

test('when Google says no, MyMemory is asked instead', async () => {
  const fetch = async (url) => {
    if (url.includes('google')) return { ok: false, status: 429 };
    const q = new URL(url).searchParams.get('q');
    return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: `[${q}]`, detectedLanguage: 'fr-FR' } }) };
  };
  const tr = new Translator({ fetch });
  const err = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await tr.translate('ann', 'bonjour', 'en'), { text: '[bonjour]', from: 'fr' });
  } finally {
    console.error = err;
  }
});

test('a failed translation says so plainly', async () => {
  const tr = new Translator({ fetch: async () => ({ ok: false, status: 429 }) });
  const err = console.error;
  console.error = () => {};
  try {
    await assert.rejects(tr.translate('ann', 'hola', 'en'), /Couldn't translate/);
  } finally {
    console.error = err;
  }
});

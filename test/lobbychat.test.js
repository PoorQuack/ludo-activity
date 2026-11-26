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

// A stand-in for NVIDIA's endpoint: the language check answers from `langs` (text -> code, or
// 'fail'); Riva answers "<pair>: <text>". Google is the fallback.
function fakeNvidia(calls, { fail = false, langs = {} } = {}) {
  return async (url, init = {}) => {
    if (url.includes('nvidia')) {
      const body = JSON.parse(init.body);
      const text = body.messages[1].content;
      if (body.model.includes('lightning')) {
        calls.push({ detect: text });
        if (langs[text] === 'fail') return { ok: false, status: 429 };
        return { ok: true, json: async () => ({ choices: [{ message: { content: langs[text] ?? 'und' } }] }) };
      }
      const last = body.messages.at(-1).content;
      calls.push({ pair: body.messages[0].content, text: last, shots: body.messages.length - 2, auth: init.headers.authorization });
      if (fail) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ choices: [{ message: { content: `${body.messages[0].content}: ${last}` } }] }) };
    }
    calls.push({ google: true });
    const qs = new URL(url).searchParams.getAll('q');
    // (English lines come back as they are, detected as English; anything else as Spanish)
    return { ok: true, json: async () => qs.map((q) => (langs[q] === 'en' ? [q, 'en'] : [q.toUpperCase(), 'es'])) };
  };
}
const quiet = async (fn) => {
  const err = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = err;
  }
};

test('with a key, the language check tells Riva Translate the pair', async () => {
  const calls = [];
  const langs = { 'hola amigo': 'es', 'hej på dig': 'sv', 'jeg vil spille igen': 'no', 'Callate ik u aint': 'es', 'hello there': 'en', 'ok': 'und' };
  const tr = new Translator({ fetch: fakeNvidia(calls, { langs }), nvidiaKey: 'k' });
  assert.deepEqual(await tr.translate('ann', 'hola amigo', 'en', 'fr'), { text: 'es-es-en: hola amigo', from: 'es' });
  assert.equal(calls.find((c) => c.pair).auth, 'Bearer k');
  assert.ok(calls.find((c) => c.pair).shots >= 8); // at least four worked examples, Spanish -> English
  // the writer's setting picks between neighbours (Spain / Latin America, Danish / Norwegian)
  assert.equal((await tr.translate('ann', 'hola amigo', 'fr', 'es-419')).text, 'en-fr: es-us-en: hola amigo');
  assert.equal((await tr.translate('ann', 'jeg vil spille igen', 'en', 'da')).from, 'da');
  // 37 languages: Swedish to Brazilian Portuguese goes through English
  assert.equal((await tr.translate('ann', 'hej på dig', 'pt', 'en')).text, 'en-pt-br: sv-en: hej på dig');
  // mixed Spanish and English
  assert.equal((await tr.translate('ann', 'Callate ik u aint', 'en', '')).text, 'es-es-en: Callate ik u aint');
  // already in their language: nothing translated, nothing more asked
  const before = calls.length;
  assert.deepEqual(await tr.translate('ann', 'hello there', 'en', 'es'), { text: 'hello there', from: 'en' });
  assert.equal(calls.length, before + 2); // the check, and Google's second opinion
  // the check said "und" and nothing else gives a clue: Google detects it
  await tr.translate('ann', 'ok', 'fr', '');
  assert.ok(calls.at(-1).google);
});

test('when the language check is busy, the writer and the alphabet decide; when Riva fails, Google', async () => {
  const calls = [];
  const langs = { '안녕하세요': 'fail', 'hola': 'fail' };
  const tr = new Translator({ fetch: fakeNvidia(calls, { langs }), nvidiaKey: 'k' });
  await quiet(() => tr.translate('ann', '안녕하세요', 'en', 'es'));
  assert.equal(calls.at(-1).pair, 'ko-en');
  const broken = new Translator({ fetch: fakeNvidia(calls, { fail: true, langs: { hola: 'es' } }), nvidiaKey: 'k' });
  assert.deepEqual(await quiet(() => broken.translate('ann', 'hola', 'en', 'es')), { text: 'HOLA', from: 'es' });
  assert.ok(calls.at(-1).google);
});

test('chat languages: locales map onto the 37, each with its Ludo examples', async () => {
  const { matchChatLanguage, CHAT_LANGUAGES } = await import('../shared/chatlangs.js');
  const { LUDO_PHRASES } = await import('../shared/ludo-phrases.js');
  assert.equal(CHAT_LANGUAGES.length, 37);
  for (const l of CHAT_LANGUAGES) assert.equal(LUDO_PHRASES[l.code]?.length, LUDO_PHRASES.en.length, l.code);
  // every line is written in the language's own alphabet (no English left in by mistake, beyond "gg")
  const { scriptOf } = await import('../server/translate.js');
  for (const l of CHAT_LANGUAGES)
    for (const line of LUDO_PHRASES[l.code]) {
      const s = scriptOf(line.replace(/\b(gg|Maghrib|xD|lol|brb|lag)\b/gi, ''));
      if (s) assert.ok(s === l.script || (l.script === 'japanese' && s === 'han'), `${l.code}: ${line}`); // (Japanese can be all kanji)
    }
  for (const [loc, code] of [['sv-SE', 'sv'], ['pt-PT', 'pt-PT'], ['pt-BR', 'pt'], ['es-ES', 'es'], ['es-419', 'es-419'], ['zh-TW', 'zh-TW'], ['zh-CN', 'zh'], ['nb', 'no'], ['xx', null]])
    assert.equal(matchChatLanguage(loc), code, loc);
});

test('"Already in English" gets a second opinion: a wrong language check ("Maghrib woy" as English) is caught', async () => {
  const calls = [];
  // the check says English; Google knows better (Indonesian), so Riva translates from Indonesian
  const base = fakeNvidia(calls, { langs: { 'Maghrib woy': 'en', 'hello there': 'en' } });
  const fetch = async (url, init) => {
    if (url.includes('translate')) {
      calls.push({ google: true });
      const q = new URL(url).searchParams.getAll('q');
      return { ok: true, json: async () => q.map((t) => (t === 'hello there' ? [t, 'en'] : [`(${t})`, 'id'])) };
    }
    return base(url, init);
  };
  const tr = new Translator({ fetch, nvidiaKey: 'k' });
  assert.deepEqual(await tr.translate('ann', 'Maghrib woy', 'en', 'en'), { text: 'id-en: Maghrib woy', from: 'id' });
  // really English: Google agrees, so it's "already in English"
  assert.deepEqual(await tr.translate('ann', 'hello there', 'en', 'en'), { text: 'hello there', from: 'en' });
});

test('a language check in the wrong alphabet is ignored ("Maghrib woy" is not Arabic)', async () => {
  const calls = [];
  const tr = new Translator({ fetch: fakeNvidia(calls, { langs: { 'Maghrib woy': 'ar' } }), nvidiaKey: 'k' });
  await tr.translate('ann', 'Maghrib woy', 'en', '');
  assert.ok(!calls.some((c) => c.pair?.startsWith('ar-')));
});

test('Riva sees the Ludo lines most like the message', async () => {
  const { closestLines, LUDO_PHRASES } = await import('../shared/ludo-phrases.js');
  const pick = (t, l) => closestLines(t, l).map((i) => LUDO_PHRASES.en[i]);
  assert.ok(pick('woy, udah Maghrib, aku pergi bentar', 'id').includes("hey, it's Maghrib, brb"));
  assert.ok(pick('el dado me odia', 'es').includes('the dice hate me'));
  assert.ok(pick('我网卡了', 'zh').includes('my internet is lagging'));
  // nothing alike: the four Ludo basics
  assert.deepEqual(closestLines('xyzzy', 'en'), [0, 1, 2, 3]);
});

// A stand-in for DeepL and Azure. `detect`: text -> [language, score] (Azure's detector);
// DeepL answers "<SOURCE>><TARGET>: text", or "fails" with `deeplDown` (e.g. out of characters).
function fakeDeeplAzure(calls, { detect = {}, deeplDown = false } = {}) {
  return async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if (url.includes('/detect')) {
      calls.push({ detect: body[0].Text });
      const [language, score] = detect[body[0].Text] || ['en', 0.3];
      return { ok: true, json: async () => [{ language, score }] };
    }
    if (url.includes('deepl.com')) {
      calls.push({ deepl: body, key: init.headers.authorization, host: new URL(url).host });
      if (deeplDown) return { ok: false, status: 456 };
      const src = body.source_lang || 'EN';
      return { ok: true, json: async () => ({ translations: body.text.map((t) => ({ text: body.source_lang ? `${src}>${body.target_lang}: ${t}` : t, detected_source_language: src })) }) };
    }
    if (url.includes('microsofttranslator')) {
      calls.push({ azure: url, region: init.headers['Ocp-Apim-Subscription-Region'] });
      const to = new URL(url).searchParams.get('to');
      return { ok: true, json: async () => body.map((x) => ({ translations: [{ text: `azure>${to}: ${x.Text}` }] })) };
    }
    calls.push({ other: url });
    return { ok: false, status: 500 };
  };
}

test('DeepL translates first, told the language Azure found and that it is Ludo chat', async () => {
  const calls = [];
  const detect = { 'hola amigo': ['es', 0.99], 'Callate ik u aint': ['en', 1], 'bhai mera internet lag kar raha hai': ['hi-Latn', 1] };
  const tr = new Translator({ fetch: fakeDeeplAzure(calls, { detect }), deeplKey: 'k:fx', azureKey: 'a', azureRegion: 'uksouth' });
  assert.deepEqual(await tr.translate('ann', 'hola amigo', 'en', 'fr'), { text: 'ES>EN-GB: hola amigo', from: 'es' });
  const d = calls.find((c) => c.deepl);
  assert.equal(d.host, 'api-free.deepl.com');
  assert.match(d.deepl.context, /Ludo/);
  assert.equal(calls.find((c) => c.detect) && calls.find((c) => c.azure), undefined); // Azure only detected
  // gamer English isn't sent to Azure's detector ("gg ez" reads as Hungarian there)
  await tr.translate('ann', 'gg ez, revenge?', 'es', 'en');
  assert.equal(calls.at(-1).deepl.source_lang, 'EN');
  assert.ok(!calls.some((c) => c.detect === 'gg ez, revenge?'));
  // mixed Spanish and English from a Spanish player: Spanish
  await tr.translate('ann', 'Callate ik u aint', 'en', 'es');
  assert.equal(calls.at(-1).deepl.source_lang, 'ES');
  // Hindi in Latin letters
  await tr.translate('ann', 'bhai mera internet lag kar raha hai', 'en', 'en');
  assert.equal(calls.at(-1).deepl.source_lang, 'HI');
  // already in their language: DeepL's own check agrees, so nothing changes
  assert.deepEqual(await tr.translate('ann', 'hello there my friend', 'en', 'en'), { text: 'hello there my friend', from: 'en' });
});

test('when DeepL is out of characters, Azure translates', async () => {
  const calls = [];
  const tr = new Translator({ fetch: fakeDeeplAzure(calls, { deeplDown: true, detect: { 'hola amigo': ['es', 0.99] } }), deeplKey: 'k:fx', azureKey: 'a', azureRegion: 'uksouth' });
  const r = await quiet(() => tr.translate('ann', 'hola amigo', 'zh-TW', ''));
  assert.deepEqual(r, { text: 'azure>zh-Hant: hola amigo', from: 'es' });
  assert.equal(calls.at(-1).region, 'uksouth');
  assert.match(calls.at(-1).azure, /from=es/);
});

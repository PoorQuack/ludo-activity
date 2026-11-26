// Chat translation: a player taps "Translate" under a message and gets it in their chat language
// (one of the 37 in shared/chatlangs.js). In order, with whichever keys are set:
//  1. what it's written in: Azure's language detector (AZURE_TRANSLATOR_KEY), checked against the
//     alphabet, common English/gamer words and the writer's chat language; NVIDIA's Lightning model
//     when Azure isn't sure (NVIDIA_API_KEY)
//  2. DeepL (DEEPL_API_KEY; the free plan's monthly characters), told the language and that it's
//     Ludo chat: the most natural translations in tests
//  3. Azure Translator, when DeepL is out of characters or down
//  4. NVIDIA's Riva Translate, with Ludo example lines (shared/ludo-phrases.js)
//  5. Google's free web endpoint (no key, unofficial, so it could be limited at any time), then
//     MyMemory's free API. The server asks, never the client, so
// the Discord sandbox doesn't need them allowed. (Google's usual translate_a/single address
// refuses cloud servers like ours; this one, used by its browser extension, doesn't.)
// Answers are cached, and there's a cap per player and for the whole server, so a busy chat
// can't run up requests.

import { CHAT_CODES, CHAT_LANG, normalizeDetected } from '../shared/chatlangs.js';
import { LUDO_PHRASES, closestLines } from '../shared/ludo-phrases.js';

const GOOGLE = 'https://clients5.google.com/translate_a/t';
const MYMEMORY = 'https://api.mymemory.translated.net/get';
const NVIDIA = 'https://integrate.api.nvidia.com/v1/chat/completions';
const AZURE = 'https://api.cognitive.microsofttranslator.com';
// what DeepL is told about every message (not counted as characters)
const DEEPL_CONTEXT = 'Casual chat between players of an online Ludo board game: dice, sixes, tokens, captures, gamer slang.';
// What chat slang means, per language, added to DeepL's note when the message is in it. DeepL
// reads Indonesian chat well once told ("bocil nub" was "novice", "mampus" was "I'm done for").
const DEEPL_SLANG = {
  id:
    'Indonesian chat slang: gw/gue = I; lu/lo = you; gak/ga/gk/kagak = not; bgt = very; mulu = all the time; udh = already; ' +
    "blm = not yet; jgn = don't; yg = that/who; bntr/bentar = a moment; anjir/anjay/jir/anjim = damn (mild swear); " +
    'wkwk/aowkwk = laughing (lol); mabar = play together; kuy = come on, let us; cuy/ngab/bang/bro = bro; gaskeun/gas = let us go; ' +
    'mampus = serves you right; makan/dimakan/kena = capture/get captured (a token); bagi = give (bagi enam = give me a six); ' +
    'settingan = rigged; bocil = little kid; nub = noob; ez = easy; kocak = hilarious; hoki = lucky; cabut = leave; afk = away; ' +
    'males = cannot be bothered; mantap/mantap jiwa = awesome; kasian deh lu = too bad for you; santuy = chill; baper = get emotional; ' +
    'ampas = trash; mager = too lazy to move; otw = on the way.',
};
const RIVA_MODEL = 'nvidia/riva-translate-4b-instruct-v2';
// Riva has to be told what it's translating from, so a fast general model reads the message first
// (tested on chat lines: 20 of 23 right in about 0.2s; its misses were Danish/Norwegian-type
// neighbours, which Riva translates fine anyway).
const DETECT_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
const DETECT_PROMPT =
  'You identify the language of a chat message from an online board game. Reply with ONLY one code from this list: ' +
  `${[...CHAT_CODES].join(', ')}. Players write casually: slang, typos, no accents, gamer words (gg, lol, wp, ez). ` +
  'If the message mixes English with another language, even one word of it (callate, bhai, kurwa), reply with the other language. ' +
  'Portuguese from Portugal (pá, estás a, fixe) is pt-PT; from Brazil is pt. Serbian or Bosnian counts as hr; Malay counts as id. ' +
  'If it is only laughter, emoji or a word used in every language (ok, haha, gg), reply: und';
// what the detector might say that isn't one of ours
const DETECT_ALIAS = { ms: 'id', sr: 'hr', bs: 'hr', sh: 'hr', mk: 'bg', be: 'ru', nb: 'no', nn: 'no', 'pt-br': 'pt', 'zh-cn': 'zh', 'zh-hans': 'zh', 'zh-hant': 'zh-TW', 'zh-tw': 'zh-TW', 'es-es': 'es', 'es-us': 'es-419', 'es-mx': 'es-419', 'pt-pt': 'pt-PT' };
// languages close enough that the writer's own setting is the better pick between them
const FAMILY = [['es', 'es-419'], ['pt', 'pt-PT'], ['zh', 'zh-TW'], ['no', 'da', 'sv'], ['cs', 'sk']];
const sameFamily = (a, b) => a === b || FAMILY.some((f) => f.includes(a) && f.includes(b));
export const LANGS = CHAT_CODES;
const googleCode = (code) => CHAT_LANG[code]?.google || code;
const CACHE_MAX = 3000;
const TIMEOUT_MS = 6000;

// :slug: sticker codes are kept out of what's sent, and put back afterwards.
const STICKER = /(:[a-z0-9-]+:)/g;

export class Translator {
  /**
   * @param {object} options
   *  fetch: injectable for tests
   *  perUser: requests a player may make per minute; perServer: for everyone together
   *  nvidiaKey: NVIDIA's API key (build.nvidia.com); deeplKey: DeepL's (free keys end in ":fx");
   *  azureKey / azureRegion: Azure Translator's. Without any, Google and MyMemory only.
   */
  constructor({ fetch: f = globalThis.fetch, now = Date.now, perUser = 20, perServer = 400, nvidiaKey = '', deeplKey = '', azureKey = '', azureRegion = '', feedback = null } = {}) {
    this.fetch = f;
    this.feedback = feedback; // players' approved translations (server/tr-feedback.js)
    this.nvidiaKey = String(nvidiaKey || '').trim();
    this.deeplKey = String(deeplKey || '').trim();
    this.azureKey = String(azureKey || '').trim();
    this.azureRegion = String(azureRegion || '').trim();
    this.now = now;
    this.perUser = perUser;
    this.perServer = perServer;
    this.cache = new Map(); // `${to}|${text}` -> { text, from }
    this.detected = new Map(); // text -> language code, or 'und'
    this.windows = new Map(); // userId -> { start, count }
    this.server = { start: 0, count: 0 };
  }

  allowed(userId) {
    const t = this.now();
    if (t - this.server.start >= 60_000) this.server = { start: t, count: 0 };
    let w = this.windows.get(userId);
    if (!w || t - w.start >= 60_000) this.windows.set(userId, (w = { start: t, count: 0 }));
    if (this.windows.size > 5000) this.windows.clear(); // stale minutes, from players long gone
    if (w.count >= this.perUser) throw new Error('Too many translations: wait a minute');
    if (this.server.count >= this.perServer) throw new Error('Translation is busy right now: try again in a minute');
    w.count += 1;
    this.server.count += 1;
  }

  /** Translates `text` into `to` (a game language code). Resolves to { text, from } ("from": the
   *  detected language; text is unchanged when it was already in `to`). `hint`: the language the
   *  writer chats in, a guess at what it's written in (Riva has to be told). */
  async translate(userId, text, to, hint = '') {
    if (!LANGS.has(to)) throw new Error('Unknown language');
    const parts = String(text).split(STICKER);
    const words = parts.map((p, i) => (i % 2 === 0 ? p : null));
    const sendable = words.filter((p) => p && p.trim());
    if (!sendable.length) return { text, from: to };
    // the players' own translation, once enough of them agreed on it, beats any machine
    const players = this.feedback?.approvedFor(to, text);
    if (players) return { text: players.text, from: players.from || hint || '', approved: true };
    const key = `${to}|${text}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key); // most recently used goes to the back
      this.cache.set(key, hit);
      return hit;
    }
    this.allowed(userId);
    const pieces = sendable.map((p) => p.replace(/\s+/g, ' ').trim());
    let got = null;
    const joined = pieces.join(' ');
    const smart = this.nvidiaKey || this.azureKey;
    const source = smart ? await this.sourceOf(joined, hint) : null;
    if (source === to) {
      // Looks like it's already in their language. The check can be wrong on short lines ("Maghrib
      // woy" came back as English), so a translator that detects for itself gets a say first.
      // (Only an answer in one of our languages counts: DeepL calls "gg wp" Wolof.)
      const opinion = async (ask) => {
        try {
          const g = await ask();
          const said = normalizeDetected(g.from);
          return CHAT_CODES.has(said) && !sameFamily(said, to) && g.texts.join('') !== pieces.join('') ? g : null;
        } catch (err) {
          console.error(`Translation (second opinion) failed: ${err.message}`);
          return null;
        }
      };
      const byDeepl = this.deeplKey && (await opinion(() => this.deepl(pieces, null, to)));
      got = byDeepl || (await opinion(() => this.google(pieces, to)));
      if (got) got.done = !!byDeepl; // DeepL's is a finished translation; Google only found the language
      if (!got) {
        const result = { text, from: to };
        this.cache.set(key, result);
        return result;
      }
    }
    // the translators, best first; each one skipped without its key, or when it fails
    const lang = got ? normalizeDetected(got.from) : source;
    // Indonesian chat slang, rewritten into the Indonesian translators know
    const plain = lang === 'id' ? pieces.map(plainIndonesian) : pieces;
    const chain = [
      ['DeepL', () => this.deeplKey && this.deepl(plain, lang, to)],
      ['Azure', () => this.azureKey && this.azure(plain, lang, to)],
      ['Riva', () => this.nvidiaKey && lang && CHAT_CODES.has(lang) && this.riva(plain, lang, to)],
      ['Google', () => this.google(pieces, to)],
      ['MyMemory', () => this.myMemory(pieces, to)],
    ];
    // (DeepL's own second opinion already is a DeepL translation; Google's gets redone by the best)
    if (!got?.done) {
      got = null;
      for (const [name, run] of chain) {
        try {
          const r = await run();
          if (r) {
            got = r;
            break;
          }
        } catch (err) {
          console.error(`Translation (${name}) failed: ${err.message}`);
        }
      }
    }
    if (!got) throw new Error("Couldn't translate that right now");
    const from = normalizeDetected(got.from) || lang || '';
    let n = 0;
    const rebuilt = parts
      .map((p, i) => {
        if (i % 2 === 1) return p; // a sticker
        if (!p || !p.trim()) return p;
        const lead = /^\s*/.exec(p)[0];
        const trail = /\s*$/.exec(p)[0];
        return lead + (got.texts[n++] ?? p).trim() + trail;
      })
      .join('');
    const result = { text: rebuilt || text, from };
    this.cache.set(key, result);
    if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
    return result;
  }

  async get(url, init = {}, timeout = TIMEOUT_MS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await this.fetch(url, { ...init, signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // [["translated", "es"], ...]: one pair per q
  async google(pieces, to) {
    const q = pieces.map((p) => `&q=${encodeURIComponent(p)}`).join('');
    const body = await this.get(`${GOOGLE}?client=dict-chrome-ex&sl=auto&tl=${googleCode(to)}${q}`);
    if (!Array.isArray(body) || body.length !== pieces.length) throw new Error('Unexpected answer');
    const pairs = body.map((x) => (Array.isArray(x) ? x : [x, '']));
    return { texts: pairs.map((x) => String(x[0] ?? '')), from: pairs[0][1] };
  }

  async myMemory(pieces, to) {
    const texts = [];
    let from = '';
    for (const p of pieces) {
      const body = await this.get(`${MYMEMORY}?q=${encodeURIComponent(p)}&langpair=Autodetect|${googleCode(to)}`);
      if (body?.responseStatus !== 200 || body?.quotaFinished) throw new Error(body?.responseDetails || 'refused');
      texts.push(String(body.responseData?.translatedText ?? p));
      from ||= body.responseData?.detectedLanguage || '';
    }
    return { texts, from };
  }

  /** What `text` is written in, for Riva: the detector model, with the writer's chat language to
   *  choose between near neighbours and the alphabet checks when the detector can't help (busy,
   *  down, or "und"). null: no good guess (Google, which detects, does it). */
  async sourceOf(text, hint) {
    const key = `${hint}|${text}`;
    if (this.detected.has(key)) return this.detected.get(key);
    const found = this.azureKey ? await this.sourceByAzure(text, hint) : await this.sourceByModel(text, hint);
    this.detected.set(key, found);
    if (this.detected.size > CACHE_MAX) this.detected.delete(this.detected.keys().next().value);
    return found;
  }

  /** With Azure's detector: the alphabet first, then common English and gamer words, then Azure
   *  (when sure), then NVIDIA's model, then the writer's own chat language. */
  async sourceByAzure(text, hint) {
    const script = scriptOf(text);
    if (!script) return null;
    const h = CHAT_LANG[hint] ? hint : '';
    const ask = async () => {
      try {
        return await this.azureDetect(text);
      } catch (err) {
        console.error(`Language check (Azure) failed: ${err.message}`);
        return null;
      }
    };
    if (script !== 'latin') {
      const az = await ask();
      const code = az && CHAT_LANG[az.code]?.script === script ? az.code : guessSource(text, hint);
      return code && h && sameFamily(code, h) ? h : code;
    }
    if (looksIndonesian(text) && !looksEnglish(text)) return h && sameFamily('id', h) ? h : 'id';
    if (looksEnglish(text)) return 'en';
    const az = await ask();
    // Azure reads romanised Hindi as "hi-Latn": that's Hindi, in Latin letters
    if (az && az.score >= 0.8 && (CHAT_LANG[az.code]?.script === 'latin' || az.latn)) {
      // "Callate ik u aint…" reads as English to Azure; a Spanish player wrote it, so it's Spanish
      if (az.code === 'en' && h && h !== 'en' && CHAT_LANG[h].script === 'latin') return h;
      return h && sameFamily(az.code, h) ? h : az.code;
    }
    if (this.nvidiaKey) {
      const d = await this.sourceByModel(text, '');
      if (d) return h && sameFamily(d, h) ? h : d;
    }
    return h && CHAT_LANG[h].script === 'latin' ? h : null;
  }

  async azureDetect(text) {
    const body = await this.get(
      `${AZURE}/detect?api-version=3.0`,
      { method: 'POST', headers: this.azureHeaders(), body: JSON.stringify([{ Text: text.slice(0, 500) }]) },
      2500,
    );
    const d = Array.isArray(body) ? body[0] : null;
    if (!d?.language) return null;
    const raw = String(d.language).toLowerCase();
    const code = DETECT_ALIAS[raw] || DETECT_ALIAS[raw.split('-')[0]] || normalizeDetected(raw.replace(/-latn$/, ''));
    return CHAT_CODES.has(code) ? { code, score: Number(d.score) || 0, latn: raw.endsWith('-latn') } : null;
  }

  azureHeaders() {
    return { 'content-type': 'application/json', 'Ocp-Apim-Subscription-Key': this.azureKey, ...(this.azureRegion ? { 'Ocp-Apim-Subscription-Region': this.azureRegion } : {}) };
  }

  /** NVIDIA's model reading the message, with the alphabet checks when it can't help. */
  async sourceByModel(text, hint) {
    let d = null;
    if (this.nvidiaKey) {
      try {
        d = await this.detect(text);
      } catch (err) {
        console.error(`Language check failed: ${err.message}`);
      }
    }
    // a language written in another alphabet than the message can't be it ("Maghrib" is an Arabic
    // word, but "Maghrib woy" in Latin letters isn't Arabic)
    if (d && d !== 'und' && CHAT_LANG[d] && CHAT_LANG[d].script !== scriptOf(text)) d = null;
    if (d && d !== 'und') return CHAT_CODES.has(hint) && sameFamily(d, hint) ? hint : d;
    return guessSource(text, hint);
  }

  async detect(text) {
    const body = await this.get(
      NVIDIA,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${this.nvidiaKey}` },
        body: JSON.stringify({
          model: DETECT_MODEL,
          messages: [
            { role: 'system', content: DETECT_PROMPT },
            { role: 'user', content: text.slice(0, 500) },
          ],
          temperature: 0,
          max_tokens: 8,
          chat_template_kwargs: { enable_thinking: false },
          stream: false,
        }),
      },
      2500,
    );
    const raw = String(body?.choices?.[0]?.message?.content ?? '').trim().toLowerCase().replace(/[^a-z-]/g, '');
    const code = DETECT_ALIAS[raw] || [...CHAT_CODES].find((c) => c.toLowerCase() === raw) || 'und';
    return code;
  }

  // DeepL: told the language when we know it (its own guess goes wrong on short slang: "gg ez" read
  // as Hungarian), and that this is Ludo chat. Free keys (ending ":fx") use the free address.
  async deepl(pieces, from, to) {
    const host = this.deeplKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const body = await this.get(
      `${host}/v2/translate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `DeepL-Auth-Key ${this.deeplKey}` },
        body: JSON.stringify({
          text: pieces,
          target_lang: DEEPL_TARGET[to] || to.toUpperCase(),
          ...(from ? { source_lang: deeplSource(from) } : {}),
          context: from && DEEPL_SLANG[from] ? `${DEEPL_CONTEXT} ${DEEPL_SLANG[from]}` : DEEPL_CONTEXT,
        }),
      },
      4000,
    );
    const tr = body?.translations;
    if (!Array.isArray(tr) || tr.length !== pieces.length) throw new Error('Unexpected answer');
    return { texts: tr.map((x) => String(x.text ?? '')), from: from || String(tr[0].detected_source_language || '').toLowerCase() };
  }

  // Azure Translator: also detects for itself when we don't know the language
  async azure(pieces, from, to) {
    const tgt = AZURE_CODE[to] || to;
    // (romanised Hindi and the like: let Azure work out the "-Latn" itself)
    const src = from && CHAT_LANG[from]?.script === scriptOf(pieces.join(' ')) ? `&from=${AZURE_CODE[from] || from}` : '';
    const body = await this.get(
      `${AZURE}/translate?api-version=3.0&to=${tgt}${src}`,
      { method: 'POST', headers: this.azureHeaders(), body: JSON.stringify(pieces.map((p) => ({ Text: p }))) },
      4000,
    );
    if (!Array.isArray(body) || body.length !== pieces.length) throw new Error('Unexpected answer');
    return { texts: body.map((x) => String(x?.translations?.[0]?.text ?? '')), from: from || String(body[0]?.detectedLanguage?.language || '').toLowerCase() };
  }

  // NVIDIA Riva Translate: the language pair goes in the system message ("fr-de"). It's documented
  // to and from English, so other pairs go through English (two short calls).
  async riva(pieces, from, to) {
    const steps = from === 'en' || to === 'en' ? [[from, to]] : [[from, 'en'], ['en', to]];
    let texts = pieces;
    for (const [a, b] of steps) texts = await Promise.all(texts.map((p) => this.rivaOne(p, a, b)));
    return { texts, from };
  }

  async rivaOne(text, from, to) {
    const body = await this.get(
      NVIDIA,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${this.nvidiaKey}` },
        body: JSON.stringify({
          model: RIVA_MODEL,
          messages: [
            { role: 'system', content: `${CHAT_LANG[from].riva}-${CHAT_LANG[to].riva}` },
                        // the Ludo chat lines most like this message (shared/ludo-phrases.js)
            ...closestLines(text, from).flatMap((i) => [
              { role: 'user', content: LUDO_PHRASES[from][i] },
              { role: 'assistant', content: LUDO_PHRASES[to][i] },
            ]),
            // and translations the players corrected and agreed on, for this pair
            ...(this.feedback?.examples(from, to) || []).flatMap(([a, b]) => [
              { role: 'user', content: a },
              { role: 'assistant', content: b },
            ]),
            { role: 'user', content: text.slice(0, 1900) },
          ],
          temperature: 0,
          max_tokens: 400,
          stream: false,
        }),
      },
      4000, // then Google gets its turn
    );
    let out = String(body?.choices?.[0]?.message?.content ?? '').trim();
    if (!out) throw new Error('Empty answer');
    // the odd answer comes back quoted, or with a label in front
    out = out.replace(/^(translation|traducción|traduction)\s*:\s*/i, '');
    if (/^["“«].*["”»]$/s.test(out) && !/^["“«].*["”»]$/s.test(text)) out = out.slice(1, -1).trim();
    return out;
  }
}

// ---- which language a chat line is in ----
// Riva has to be told. The writer's chat language is the best guess, checked against the alphabet
// (a Russian player writing in Latin letters is probably writing English; anyone writing in hangul
// is writing Korean). null: no good guess, so Google (which detects) does it instead.
const SCRIPTS = [
  ['hangul', /[\uac00-\ud7af\u1100-\u11ff]/g],
  ['japanese', /[\u3040-\u30ff]/g],
  ['han', /[\u4e00-\u9fff]/g],
  ['arabic', /[\u0600-\u06ff]/g],
  ['devanagari', /[\u0900-\u097f]/g],
  ['thai', /[\u0e00-\u0e7f]/g],
  ['greek', /[\u0370-\u03ff]/g],
  ['cyrillic', /[\u0400-\u04ff]/g],
  ['latin', /[a-zA-Z\u00c0-\u024f]/g],
];
const ENGLISH = new Set('the you your are is was and not but this that what why how have just its it\'s i\'m im dont don\'t cant can\'t lol gg wp nice good game play win lost lose my me we they hi hello thanks thank please yes no anyone who ez revenge bro lucky so with again one more'.split(' '));

// ---- Indonesian chat slang ----
// Translators read standard Indonesian well and chat slang badly, so slang is rewritten first
// ("gw udh nunggu lama bgt" -> "aku sudah nunggu lama banget"). Whole words only.
const ID_SLANG = {
  gw: 'aku', gue: 'aku', gua: 'aku', w: 'aku', lu: 'kamu', lo: 'kamu', elu: 'kamu', loe: 'kamu',
  bgt: 'banget', bngt: 'banget', gak: 'tidak', ga: 'tidak', gk: 'tidak', kagak: 'tidak', nggak: 'tidak', engga: 'tidak', enggak: 'tidak',
  mulu: 'terus', udh: 'sudah', udah: 'sudah', dah: 'sudah', blm: 'belum', jgn: 'jangan', yg: 'yang', bntr: 'sebentar', bentar: 'sebentar',
  lg: 'lagi', tp: 'tapi', krn: 'karena', sm: 'sama', dgn: 'dengan', aja: 'saja', gmn: 'bagaimana', gimana: 'bagaimana', knp: 'kenapa',
  emg: 'memang', emang: 'memang', bener: 'benar', banget: 'banget', kuy: 'ayo', yuk: 'ayo', gaskeun: 'ayo gas', cuy: 'bro', ngab: 'bro',
  bocil: 'anak kecil', nub: 'noob', ez: 'gampang', hoki: 'beruntung', settingan: 'dicurangi', mager: 'malas gerak', santuy: 'santai',
  baper: 'terbawa perasaan', ampas: 'sampah', mampus: 'rasain', males: 'malas', cabut: 'pergi', kocak: 'lucu banget',
  dimakan: 'ditangkap', anjir: 'sial', anjay: 'wah', jir: 'sial', anjim: 'sial', sumpah: 'serius',
};
// phrases first (makan = capturing a token in Ludo)
const ID_PHRASES = [
  [/\bkena makan\b/gi, 'kena tangkap'],
  [/\bmakan (bidak|pion|biji)/gi, 'tangkap $1'],
  [/\bbagi (enam|6)\b/gi, 'kasih angka enam'],
  [/\bkasian deh (lu|lo|loe|elu)\b/gi, 'kasihan kamu'],
  [/\bmantap jiwa\b/gi, 'keren sekali'],
  [/\b[ao]*w*k(wk)+w?k*\b|\bwk(wk)*\b|\baowk\w*/gi, 'haha'],
];
export function plainIndonesian(text) {
  let out = String(text);
  for (const [re, to] of ID_PHRASES) out = out.replace(re, to);
  return out.replace(/[A-Za-z]+/g, (w) => {
    const to = ID_SLANG[w.toLowerCase()];
    if (!to) return w;
    return w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() ? to[0].toUpperCase() + to.slice(1) : to;
  });
}
// words only Indonesian chat uses: any one of these, or two of the common short ones, means Indonesian
const ID_STRONG = new Set('gw gue bgt wkwk wkwkwk aowkwk anjir anjay mabar gaskeun ngab cuy kuy bocil mulu santuy mager baper udh jgn yg kagak nggak'.split(' '));
const ID_WEAK = new Set('lu lo gak ga aja udah dong sih deh nih tuh kok lagi enam main sama banget'.split(' '));
export function looksIndonesian(text) {
  const words = String(text).toLowerCase().match(/[a-z]+/g) || [];
  if (words.some((w) => ID_STRONG.has(w) || /^w?k(wk)+w?k*$/.test(w))) return true;
  return words.filter((w) => ID_WEAK.has(w)).length >= 2;
}

// DeepL's and Azure's names for our languages, where they differ
const DEEPL_TARGET = { en: 'EN-US', pt: 'PT-BR', 'pt-PT': 'PT-PT', es: 'ES-ES', 'es-419': 'ES-419', zh: 'ZH-HANS', 'zh-TW': 'ZH-HANT', no: 'NB' };
const deeplSource = (code) => ({ no: 'NB' })[code] || code.split('-')[0].toUpperCase();
const AZURE_CODE = { zh: 'zh-Hans', 'zh-TW': 'zh-Hant', 'pt-PT': 'pt-pt', no: 'nb', 'es-419': 'es' };

// Mostly common English and gamer words ("gg nice game", "lol you are so lucky")
export function looksEnglish(text) {
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  return words.length > 0 && words.filter((w) => ENGLISH.has(w)).length / words.length >= 0.3;
}

export function scriptOf(text) {
  let best = null;
  let most = 0;
  for (const [name, re] of SCRIPTS) {
    const n = (text.match(re) || []).length;
    // Japanese is kana *and* kanji: any kana makes it Japanese
    if (name === 'japanese' && n) return 'japanese';
    if (n > most) [best, most] = [name, n];
  }
  return best;
}

export function guessSource(text, hint) {
  const script = scriptOf(text);
  if (!script) return null;
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  const english = words.length && words.filter((w) => ENGLISH.has(w)).length / words.length >= 0.3;
  const h = CHAT_LANG[hint];
  // letters only Ukrainian / Bulgarian use beat the hint
  if (script === 'cyrillic' && /[іїєґ]/i.test(text)) return 'uk';
  if (h && h.script === script) {
    // a Spanish player's "gg nice game" is English
    if (script === 'latin' && hint !== 'en' && english) return 'en';
    return hint;
  }
  if (script === 'latin') return english ? 'en' : null;
  if (script === 'cyrillic') return /[іїєґ]/i.test(text) ? 'uk' : /ъ/i.test(text) && !/[ыэё]/i.test(text) ? 'bg' : 'ru';
  return { hangul: 'ko', japanese: 'ja', han: 'zh', arabic: 'ar', devanagari: 'hi', thai: 'th', greek: 'el' }[script] || null;
}

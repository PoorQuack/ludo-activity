// Chat translation: a player taps "Translate" under a message and gets it in their chat language
// (one of the 37 in shared/chatlangs.js). With NVIDIA_API_KEY set, NVIDIA's Riva Translate model
// does it (built for translation, and better with chat-speak); otherwise, or when it's slow, busy
// or down, Google's free web endpoint (no key, unofficial, so it could be limited at any time),
// then MyMemory's free API. The server asks, never the client, so
// the Discord sandbox doesn't need them allowed. (Google's usual translate_a/single address
// refuses cloud servers like ours; this one, used by its browser extension, doesn't.)
// Answers are cached, and there's a cap per player and for the whole server, so a busy chat
// can't run up requests.

import { CHAT_CODES, CHAT_LANG, normalizeDetected } from '../shared/chatlangs.js';
import { LUDO_PHRASES, closestLines } from '../shared/ludo-phrases.js';

const GOOGLE = 'https://clients5.google.com/translate_a/t';
const MYMEMORY = 'https://api.mymemory.translated.net/get';
const NVIDIA = 'https://integrate.api.nvidia.com/v1/chat/completions';
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
   *  nvidiaKey: NVIDIA's API key (build.nvidia.com); without one, Google and MyMemory only
   */
  constructor({ fetch: f = globalThis.fetch, now = Date.now, perUser = 20, perServer = 400, nvidiaKey = '' } = {}) {
    this.fetch = f;
    this.nvidiaKey = String(nvidiaKey || '').trim();
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
    const source = this.nvidiaKey ? await this.sourceOf(pieces.join(' '), hint) : null;
    let skipRiva = false;
    if (source === to) {
      // Looks like it's already in their language. The check can be wrong on short lines ("Maghrib
      // woy" came back as English), so Google, which detects too, gets a say before "Already in".
      try {
        const g = await this.google(pieces, to);
        if (normalizeDetected(g.from) !== to && g.texts.join('') !== pieces.join('')) got = g;
      } catch (err) {
        console.error(`Translation (Google check) failed: ${err.message}`);
      }
      if (!got) {
        const result = { text, from: to };
        this.cache.set(key, result);
        return result;
      }
      skipRiva = true;
      // Google knows what it really is: Riva translates it better, when it's one of the 37
      const real = normalizeDetected(got.from);
      if (CHAT_CODES.has(real)) {
        try {
          got = await this.riva(pieces, real, to);
        } catch (err) {
          console.error(`Translation (Riva) failed: ${err.message}`);
        }
      }
    }
    if (source && !skipRiva) {
      try {
        got = await this.riva(pieces, source, to);
      } catch (err) {
        console.error(`Translation (Riva) failed: ${err.message}`);
      }
    }
    if (!got) try {
      got = await this.google(pieces, to);
    } catch (err) {
      console.error(`Translation (Google) failed: ${err.message}`);
      try {
        got = await this.myMemory(pieces, to);
      } catch (err2) {
        console.error(`Translation (MyMemory) failed: ${err2.message}`);
        throw new Error("Couldn't translate that right now");
      }
    }
    const from = normalizeDetected(got.from);
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
    let d = this.detected.get(text);
    if (d === undefined) {
      try {
        d = await this.detect(text);
        this.detected.set(text, d);
        if (this.detected.size > CACHE_MAX) this.detected.delete(this.detected.keys().next().value);
      } catch (err) {
        console.error(`Language check failed: ${err.message}`);
        d = null; // not cached: next time it may work
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
const ENGLISH = new Set('the you your are is was and not but this that what why how have just its it\'s i\'m im dont don\'t cant can\'t lol gg wp nice good game play win lost lose my me we they hi hello thanks thank please yes no anyone who'.split(' '));

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

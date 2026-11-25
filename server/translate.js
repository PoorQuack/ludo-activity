// Chat translation: a player taps "Translate" under a message and gets it in the language their
// game is set to. Uses Google's free web endpoint (no key, unofficial, so it could be limited at
// any time), and MyMemory's free API if Google says no. The server asks, never the client, so
// the Discord sandbox doesn't need them allowed. (Google's usual translate_a/single address
// refuses cloud servers like ours; this one, used by its browser extension, doesn't.)
// Answers are cached, and there's a cap per player and for the whole server, so a busy chat
// can't run up requests.

const GOOGLE = 'https://clients5.google.com/translate_a/t';
const MYMEMORY = 'https://api.mymemory.translated.net/get';
export const LANGS = new Set(['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'tr', 'ru', 'uk', 'ar', 'hi', 'ja', 'ko', 'zh']);
const GOOGLE_CODE = { zh: 'zh-CN' };
const CACHE_MAX = 3000;
const TIMEOUT_MS = 6000;

// :slug: sticker codes are kept out of what's sent, and put back afterwards.
const STICKER = /(:[a-z0-9-]+:)/g;

export class Translator {
  /**
   * @param {object} options
   *  fetch: injectable for tests
   *  perUser: requests a player may make per minute; perServer: for everyone together
   */
  constructor({ fetch: f = globalThis.fetch, now = Date.now, perUser = 20, perServer = 400 } = {}) {
    this.fetch = f;
    this.now = now;
    this.perUser = perUser;
    this.perServer = perServer;
    this.cache = new Map(); // `${to}|${text}` -> { text, from }
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
   *  detected language; text is unchanged when it was already in `to`). */
  async translate(userId, text, to) {
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
    let got;
    try {
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
    let from = String(got.from || '').toLowerCase();
    if (from.startsWith('zh')) from = 'zh';
    from = from.split('-')[0];
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

  async get(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await this.fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // [["translated", "es"], ...]: one pair per q
  async google(pieces, to) {
    const q = pieces.map((p) => `&q=${encodeURIComponent(p)}`).join('');
    const body = await this.get(`${GOOGLE}?client=dict-chrome-ex&sl=auto&tl=${GOOGLE_CODE[to] || to}${q}`);
    if (!Array.isArray(body) || body.length !== pieces.length) throw new Error('Unexpected answer');
    const pairs = body.map((x) => (Array.isArray(x) ? x : [x, '']));
    return { texts: pairs.map((x) => String(x[0] ?? '')), from: pairs[0][1] };
  }

  async myMemory(pieces, to) {
    const texts = [];
    let from = '';
    for (const p of pieces) {
      const body = await this.get(`${MYMEMORY}?q=${encodeURIComponent(p)}&langpair=Autodetect|${GOOGLE_CODE[to] || to}`);
      if (body?.responseStatus !== 200 || body?.quotaFinished) throw new Error(body?.responseDetails || 'refused');
      texts.push(String(body.responseData?.translatedText ?? p));
      from ||= body.responseData?.detectedLanguage || '';
    }
    return { texts, from };
  }
}

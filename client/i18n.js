// Translations. English text is the key: t('Create room') looks it up in the current language's
// file (client/locales/<code>.json) and falls back to the English. {name}-style placeholders are
// filled from `vars`. HTML marked data-i18n is translated in place (its English is kept so the
// language can change again), and data-i18n-attr="title,placeholder" does the same for attributes.
// Text from the server (errors, game log lines) goes through translateServer(), which also matches
// keys with placeholders, e.g. "{name} rolled a {n}".

import { CHAT_CODES, matchChatLanguage } from '../shared/chatlangs.js';

export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'ar', name: 'Arabic', native: 'العربية', rtl: true },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'zh', name: 'Chinese (Simplified)', native: '简体中文' },
];
const CODES = new Set(LANGUAGES.map((l) => l.code));
const loaders = import.meta.glob('./locales/*.json', { import: 'default' });
const LANG_KEY = 'ludo-lang';

let lang = 'en';
let dict = {};
let patterns = []; // [regex, key, varNames] for keys with placeholders

const norm = (s) => s.replace(/\s+/g, ' ').trim();

export function t(key, vars) {
  let s = dict[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return s;
}

export function currentLanguage() {
  return lang;
}

// 'auto' (follow Discord / the browser) or a language code
export function languagePref() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v && (v === 'auto' || CODES.has(v)) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

// 'pt-BR' -> 'pt', 'zh-TW' -> 'zh', 'es-419' -> 'es'; unknown -> null
export function matchLanguage(locale) {
  const base = String(locale || '').toLowerCase().split(/[-_]/)[0];
  return CODES.has(base) ? base : null;
}

let autoLocale = null; // Discord's language, once known
export function autoLanguage() {
  for (const l of [autoLocale, ...(navigator.languages || [navigator.language])]) {
    const m = matchLanguage(l);
    if (m) return m;
  }
  return 'en';
}

export async function setLanguage(pref, { save = true } = {}) {
  if (save) {
    try {
      localStorage.setItem(LANG_KEY, pref);
    } catch {
      // only a preference
    }
  }
  const code = pref === 'auto' ? autoLanguage() : pref;
  let next = {};
  if (code !== 'en') {
    try {
      next = await loaders[`./locales/${code}.json`]();
    } catch (err) {
      console.error(`Couldn't load ${code} translations`, err);
      return;
    }
  }
  lang = code;
  dict = next;
  patterns = Object.keys(dict)
    .filter((k) => /\{\w+\}/.test(k))
    .map((k) => {
      const names = [...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const re = new RegExp(`^${k.split(/\{\w+\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)')}$`);
      return [re, k, names];
    });
  const info = LANGUAGES.find((l) => l.code === code);
  document.documentElement.lang = code;
  document.documentElement.dir = info?.rtl ? 'rtl' : 'ltr';
  applyI18n(document);
  window.dispatchEvent(new Event('ludo-lang'));
}

// ---- the chat language: what Translate puts messages into, and which language channel you're in.
// Any of the 37 in shared/chatlangs.js, so a Swedish player whose game is in English (no Swedish
// screens yet) still chats and translates in Swedish. 'auto': the game's language, unless the
// game is on automatic and Discord's language is one the game can't be shown in.
const CHAT_KEY = 'ludo-chat-lang';
export function chatLanguagePref() {
  try {
    const v = localStorage.getItem(CHAT_KEY);
    return v && (v === 'auto' || CHAT_CODES.has(v)) ? v : 'auto';
  } catch {
    return 'auto';
  }
}
export function chatLanguage() {
  const pref = chatLanguagePref();
  if (pref !== 'auto') return pref;
  if (languagePref() === 'auto') {
    for (const l of [autoLocale, ...(navigator.languages || [navigator.language])]) {
      const m = matchChatLanguage(l);
      if (!m) continue;
      const base = m.split('-')[0];
      if (base === lang) return m; // the game's language, or its regional kind (pt-PT, es-419, zh-TW)
      return CODES.has(base) ? lang : m; // one the game can't be shown in (Swedish...): chat in it anyway
    }
  }
  return lang;
}
export function setChatLanguage(pref) {
  try {
    localStorage.setItem(CHAT_KEY, pref);
  } catch {
    // only a preference
  }
  window.dispatchEvent(new Event('ludo-chat-lang'));
}

// Discord told us its language: follow it if the player hasn't picked one.
export function setAutoLocale(locale) {
  autoLocale = locale;
  if (languagePref() === 'auto' && autoLanguage() !== lang) setLanguage('auto', { save: false });
}

export function applyI18n(root) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    if (el.dataset.i18nKey === undefined) el.dataset.i18nKey = norm(el.innerHTML);
    const key = el.dataset.i18nKey;
    const html = t(key);
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const attr of el.dataset.i18nAttr.split(',')) {
      const store = `i18n_${attr.replace(/-/g, '_')}`;
      if (el.dataset[store] === undefined) el.dataset[store] = el.getAttribute(attr) || '';
      el.setAttribute(attr, t(el.dataset[store]));
    }
  }
}

// Text the server wrote in English: an exact match, or a key with placeholders.
export function translateServer(text) {
  if (!text || lang === 'en') return text;
  if (dict[text] !== undefined) return dict[text];
  for (const [re, key, names] of patterns) {
    const m = re.exec(text);
    if (m) return t(key, Object.fromEntries(names.map((n, i) => [n, translateServer(m[i + 1])])));
  }
  return text;
}

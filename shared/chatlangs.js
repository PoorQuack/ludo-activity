// The languages chat can be translated into, and the language channels in the menu's chat: the
// 37 that NVIDIA's Riva Translate model knows. The game itself is shown in fewer (client/i18n.js);
// a player can chat in any of these whatever the game is shown in.
//  code: ours (the game's own codes where they overlap: 'es' Spain, 'pt' Brazil, 'zh' Simplified)
//  riva: the model's code; google: Google Translate's (also used for MyMemory)
//  script: the alphabet it's written in, used to tell who wrote what
export const CHAT_LANGUAGES = [
  { code: 'en', native: 'English', riva: 'en', script: 'latin' },
  { code: 'ar', native: 'العربية', riva: 'ar', script: 'arabic', rtl: true },
  { code: 'bg', native: 'Български', riva: 'bg', script: 'cyrillic' },
  { code: 'cs', native: 'Čeština', riva: 'cs', script: 'latin' },
  { code: 'da', native: 'Dansk', riva: 'da', script: 'latin' },
  { code: 'de', native: 'Deutsch', riva: 'de', script: 'latin' },
  { code: 'el', native: 'Ελληνικά', riva: 'el', script: 'greek' },
  { code: 'es', native: 'Español (España)', riva: 'es-es', script: 'latin' },
  { code: 'es-419', native: 'Español (Latinoamérica)', riva: 'es-us', google: 'es', script: 'latin' },
  { code: 'et', native: 'Eesti', riva: 'et', script: 'latin' },
  { code: 'fi', native: 'Suomi', riva: 'fi', script: 'latin' },
  { code: 'fr', native: 'Français', riva: 'fr', script: 'latin' },
  { code: 'hi', native: 'हिन्दी', riva: 'hi', script: 'devanagari' },
  { code: 'hr', native: 'Hrvatski', riva: 'hr', script: 'latin' },
  { code: 'hu', native: 'Magyar', riva: 'hu', script: 'latin' },
  { code: 'id', native: 'Bahasa Indonesia', riva: 'id', script: 'latin' },
  { code: 'it', native: 'Italiano', riva: 'it', script: 'latin' },
  { code: 'ja', native: '日本語', riva: 'ja', script: 'japanese' },
  { code: 'ko', native: '한국어', riva: 'ko', script: 'hangul' },
  { code: 'lt', native: 'Lietuvių', riva: 'lt', script: 'latin' },
  { code: 'lv', native: 'Latviešu', riva: 'lv', script: 'latin' },
  { code: 'nl', native: 'Nederlands', riva: 'nl', script: 'latin' },
  { code: 'no', native: 'Norsk', riva: 'no', script: 'latin' },
  { code: 'pl', native: 'Polski', riva: 'pl', script: 'latin' },
  { code: 'pt', native: 'Português (Brasil)', riva: 'pt-br', script: 'latin' },
  { code: 'pt-PT', native: 'Português (Portugal)', riva: 'pt-pt', google: 'pt-PT', script: 'latin' },
  { code: 'ro', native: 'Română', riva: 'ro', script: 'latin' },
  { code: 'ru', native: 'Русский', riva: 'ru', script: 'cyrillic' },
  { code: 'sk', native: 'Slovenčina', riva: 'sk', script: 'latin' },
  { code: 'sl', native: 'Slovenščina', riva: 'sl', script: 'latin' },
  { code: 'sv', native: 'Svenska', riva: 'sv', script: 'latin' },
  { code: 'th', native: 'ไทย', riva: 'th', script: 'thai' },
  { code: 'tr', native: 'Türkçe', riva: 'tr', script: 'latin' },
  { code: 'uk', native: 'Українська', riva: 'uk', script: 'cyrillic' },
  { code: 'vi', native: 'Tiếng Việt', riva: 'vi', script: 'latin' },
  { code: 'zh', native: '简体中文', riva: 'zh-cn', google: 'zh-CN', script: 'han' },
  { code: 'zh-TW', native: '繁體中文', riva: 'zh-tw', google: 'zh-TW', script: 'han' },
];

export const CHAT_LANG = Object.fromEntries(CHAT_LANGUAGES.map((l) => [l.code, l]));
export const CHAT_CODES = new Set(CHAT_LANGUAGES.map((l) => l.code));

// A locale ('sv-SE', 'pt-PT', 'es-MX', 'zh-Hant-TW', 'nb') -> one of ours, or null
export function matchChatLanguage(locale) {
  const s = String(locale || '').replace(/_/g, '-').toLowerCase();
  if (!s) return null;
  const [base, ...rest] = s.split('-');
  if (base === 'zh') return rest.some((r) => r === 'tw' || r === 'hk' || r === 'mo' || r === 'hant') ? 'zh-TW' : 'zh';
  if (base === 'pt') return rest.includes('pt') ? 'pt-PT' : 'pt';
  if (base === 'es') return rest.length && !rest.includes('es') ? 'es-419' : 'es';
  if (base === 'nb' || base === 'nn') return 'no';
  return CHAT_CODES.has(base) ? base : null;
}

// What someone's translated-from answer ('zh-CN', 'pt', 'iw'...) is in our codes, or its base
export function normalizeDetected(code) {
  const m = matchChatLanguage(code);
  if (m) return m;
  return String(code || '').toLowerCase().split('-')[0];
}

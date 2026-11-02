// A simple swear filter for chat: rooms can be public, so strangers may be talking.
// Whole words only (with common endings like -s, -ed, -ing), so innocent words that
// merely contain one ("class", "Scunthorpe", "cocktail") are left alone. Common
// letter swaps (sh1t, f@ck, $hit) and stretched letters (fuuuck) are caught too.

const ROOTS = [
  'fuck', 'fuk', 'fck', 'fack', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'asshole', 'arsehole',
  'bastard', 'slut', 'whore', 'twat', 'wank', 'wanker', 'prick', 'motherfucker', 'bollocks',
  'fag', 'faggot', 'nigger', 'nigga', 'retard', 'tranny', 'spic', 'chink', 'kike',
];
const ENDINGS = ['', 's', 'es', 'ed', 'er', 'ers', 'ing', 'in', 'y', 'ies', 'head', 'heads', 'face'];
const BAD = new Set(ROOTS.flatMap((r) => ENDINGS.map((e) => r + e)));

const SWAPS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i', '|': 'i' };

function normalise(word) {
  const swapped = [...word.toLowerCase()].map((c) => SWAPS[c] ?? c).join('');
  return swapped.replace(/[^a-z]/g, '').replace(/(.)\1{2,}/g, '$1$1'); // "fuuuuck" -> "fuuck"
}

function isBad(word) {
  const w = normalise(word);
  if (!w) return false;
  // Also try with doubled letters squeezed, so "fuuck" and "shiit" are caught
  return BAD.has(w) || BAD.has(w.replace(/(.)\1/g, '$1'));
}

// Replaces each bad word with asterisks of the same length.
export function cleanText(text) {
  return text.replace(/[\p{L}\p{N}@$!|]+/gu, (word) => (isBad(word) ? '*'.repeat(word.length) : word));
}

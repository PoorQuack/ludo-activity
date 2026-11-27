// @mentions in chat. The client sends the ids it picked from its @ list; the server keeps only
// the ones whose '@Name' really is in the message (so a mention can't be faked or hidden).
export const MAX_MENTIONS = 5;

// [{ id, name }] for each id that `text` mentions as '@Name' (any letter case).
// nameOf(id) -> the name to look for, or a falsy value if that id can't be mentioned here.
export function resolveMentions(text, ids, nameOf) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const low = String(text || '').toLowerCase();
  const out = [];
  for (const id of [...new Set(ids.slice(0, 10).map(String))]) {
    const name = String(nameOf(id) || '').slice(0, 32);
    if (name && low.includes(`@${name.toLowerCase()}`)) out.push({ id, name });
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

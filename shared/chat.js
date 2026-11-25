// Shared chat reply & reaction helpers used by LobbyChat, DirectMessages, Room, and the client UI.
export const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍', '👎', '🔥', '👑', '🎉'];
export const REACTION_SET = new Set(REACTION_EMOJIS);
export const MAX_REACTIONS_PER_MSG = 8;
export const MAX_USERS_PER_REACTION = 50;

export function makeReplySnapshot(target) {
  if (!target || target.system) return null;
  const preview = String(target.text || '').replace(/\s+/g, ' ').trim();
  return {
    id: target.id,
    name: String(target.name || 'Player').slice(0, 32),
    text: preview.length > 80 ? `${preview.slice(0, 77)}…` : preview,
  };
}

export function toggleReaction(msg, userId, emoji) {
  if (!msg || msg.system) throw new Error('Cannot react to that message');
  const uid = String(userId || '');
  if (!uid) return false;
  if (!REACTION_SET.has(emoji)) throw new Error('Unknown reaction');
  const map = (msg.reactions ||= {});
  const list = map[emoji];
  if (Array.isArray(list)) {
    const idx = list.indexOf(uid);
    if (idx >= 0) {
      list.splice(idx, 1);
      if (!list.length) delete map[emoji];
      if (!Object.keys(map).length) delete msg.reactions;
      return true;
    }
    if (list.length >= MAX_USERS_PER_REACTION) return false;
    list.push(uid);
    return true;
  }
  if (Object.keys(map).length >= MAX_REACTIONS_PER_MSG) throw new Error('Too many reactions on this message');
  map[emoji] = [uid];
  return true;
}

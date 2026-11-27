// The menu's chat: one Global channel for everyone, and one per language (everyone whose game is
// set to the same language). Rooms keep their own chat (room.js). The last messages of each
// channel are kept, and saved, so the chat isn't empty after an update.
import { resolveMentions } from '../shared/mentions.js';
import fs from 'node:fs';
import path from 'node:path';
import { cleanText } from './filter.js';
import { EMOTE_SLUGS, ownsItem } from '../shared/shop.js';
import { LANGS } from './translate.js';
import { makeReplySnapshot, toggleReaction } from '../shared/chat.js';

export const KEEP = 60; // messages kept per channel
export const MAX_LEN = 200;
export const COOLDOWN_MS = 2500;
const SAVE_DELAY_MS = 3000;

// 'global', or 'lang:fr' for a language channel; anything else is refused
export function channelId(channel, lang) {
  if (channel === 'global') return 'global';
  if (channel === 'lang' && LANGS.has(lang)) return `lang:${lang}`;
  throw new Error('Unknown chat channel');
}

export class LobbyChat {
  /**
   * @param {string|null} file  where it's saved (null: memory only, for tests)
   * @param {object} options  profiles: to check sticker ownership; now: the clock
   */
  constructor(file, { profiles = null, now = Date.now } = {}) {
    this.file = file;
    this.profiles = profiles;
    this.now = now;
    this.channels = {}; // id -> { seq, msgs: [{ id, userId, name, text, at }] }
    this.last = new Map(); // userId -> when they last spoke
    this.saveTimer = null;
    if (file) this.load();
  }

  channel(id) {
    return (this.channels[id] ||= { seq: 0, msgs: [] });
  }

  history(id) {
    return this.channel(id).msgs.map((m) => {
      const p = this.profiles?.peek?.(m.userId);
      if (!p) return m;
      const vip = !!this.profiles?.passActive?.(p);
      const frame = p.equipped?.frame && p.equipped.frame !== 'frame-none' ? p.equipped.frame : '';
      return { ...m, ...(vip ? { vip: true } : {}), ...(frame ? { frame } : {}) };
    });
  }

  find(id, msgId) {
    return this.channels[id]?.msgs.find((m) => m.id === msgId) || null;
  }

  /** Adds a message; returns it (or null when nothing was left to say). Throws when too fast. */
  // mentions: ids the player picked from their @ list; nameOf(id) says who can be mentioned
  say(user, id, text, { replyId, mentions = null, nameOf = null } = {}) {
    let clean = cleanText(
      String(text ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, MAX_LEN),
    );
    // Stickers only for their owners; anyone else's code stays a plain word (as in room chat)
    clean = clean
      .replace(/:([a-z0-9-]+):/g, (m, slug) => (EMOTE_SLUGS[slug] && !ownsItem(this.profiles?.peek(user.id), EMOTE_SLUGS[slug].item) ? slug : m))
      .trim();
    if (!clean) return null;
    const t = this.now();
    if (t - (this.last.get(user.id) || 0) < COOLDOWN_MS) throw new Error('Slow down a little');
    this.last.set(user.id, t);
    if (this.last.size > 10_000) this.last.clear();
    const ch = this.channel(id);
    const prof = this.profiles?.peek?.(user.id);
    const msg = { id: ++ch.seq, userId: user.id, name: String(user.name || 'Player').slice(0, 32), text: clean, at: t };
    if (this.profiles?.passActive?.(prof)) msg.vip = true; // Battle Pass: a gold name with a crown
    if (prof?.equipped?.frame && prof.equipped.frame !== 'frame-none') msg.frame = prof.equipped.frame;
    const replyTo = replyId ? makeReplySnapshot(this.find(id, Number(replyId))) : null;
    if (replyTo) msg.replyTo = replyTo;
    const named = nameOf ? resolveMentions(clean, mentions, (mid) => mid !== user.id && nameOf(mid)) : [];
    if (named.length) msg.mentions = named;
    ch.msgs.push(msg);
    if (ch.msgs.length > KEEP) ch.msgs.splice(0, ch.msgs.length - KEEP);
    this.save();
    return msg;
  }

  react(userId, id, msgId, emoji) {
    const msg = this.find(id, Number(msgId));
    if (!msg) return null;
    if (!toggleReaction(msg, userId, emoji)) return null;
    this.save();
    return { id: msg.id, reactions: msg.reactions || {} };
  }

  /** The game's owner can take a message down. Returns whether it was there. */
  remove(id, msgId) {
    const ch = this.channels[id];
    const i = ch ? ch.msgs.findIndex((m) => m.id === msgId) : -1;
    if (i < 0) return false;
    ch.msgs.splice(i, 1);
    this.save();
    return true;
  }

  load() {
    for (const f of [this.file, `${this.file}.bak`]) {
      if (!fs.existsSync(f)) continue;
      try {
        const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
        for (const [id, ch] of Object.entries(doc.channels || {})) {
          if ((id === 'global' || /^lang:[a-z]{2}(-[A-Za-z0-9]{2,3})?$/.test(id)) && Array.isArray(ch.msgs)) this.channels[id] = { seq: Number(ch.seq) || 0, msgs: ch.msgs.slice(-KEEP) };
        }
        return;
      } catch (err) {
        console.error(`Lobby chat file ${f} is unreadable (${err.message})`);
      }
    }
  }

  save() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, channels: this.channels }));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.renameSync(tmp, this.file);
  }
}

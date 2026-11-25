// Friends-only Direct Messages (stored in data/dms.json). Bounded to KEEP messages per friend
// pair and MAX_THREADS total so disk and RAM stay tiny on a shared VM.
import fs from 'node:fs';
import path from 'node:path';
import { cleanText } from './filter.js';
import { EMOTE_SLUGS, ownsItem } from '../shared/shop.js';

export const DM_KEEP = 50;
export const DM_MAX_LEN = 200;
export const DM_COOLDOWN_MS = 1200;
export const DM_MAX_THREADS = 2000;
const SAVE_DELAY_MS = 3000;

export const pairKey = (a, b) => (String(a) < String(b) ? `${a}:${b}` : `${b}:${a}`);
const otherOf = (key, me) => {
  const [a, b] = key.split(':');
  return a === me ? b : a;
};

export class DirectMessages {
  constructor(file, { profiles = null, social = null, now = Date.now } = {}) {
    this.file = file;
    this.profiles = profiles;
    this.social = social;
    this.now = now;
    this.threads = {}; // pairKey -> { seq, users: [a, b], msgs: [...], read: { [id]: lastReadId }, updatedAt }
    this.last = new Map(); // userId -> last send timestamp
    this.saveTimer = null;
    if (file) this.load();
  }

  #enrichUser(id) {
    const p = this.profiles?.peek?.(id);
    const frame = p?.equipped?.frame && p.equipped.frame !== 'frame-none' ? p.equipped.frame : '';
    const vip = !!this.profiles?.passActive?.(p);
    const name = this.social?.names?.get(id) || 'Player';
    const avatar = !String(id).startsWith('guest-') && !!this.social?.avatars?.has?.(id);
    return { id, name, avatar, vip, ...(frame ? { frame } : {}) };
  }

  #enrichMsg(m) {
    const p = this.profiles?.peek?.(m.from);
    if (!p) return m;
    const vip = !!this.profiles?.passActive?.(p);
    const frame = p.equipped?.frame && p.equipped.frame !== 'frame-none' ? p.equipped.frame : '';
    return { ...m, ...(vip ? { vip: true } : {}), ...(frame ? { frame } : {}) };
  }

  send(fromUser, toId, text) {
    const fromId = String(fromUser?.id || '');
    const targetId = String(toId || '');
    if (!fromId || !targetId || fromId === targetId) throw new Error('Pick someone to message');
    if (fromId.startsWith('guest-') || targetId.startsWith('guest-')) throw new Error('Sign in with Discord to send DMs');
    if (this.social?.isBlocked?.(fromId, targetId)) throw new Error('Unblock this player to message them');
    if (this.social?.isBlocked?.(targetId, fromId)) throw new Error('You cannot message this player');
    let clean = cleanText(
      String(text ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, DM_MAX_LEN),
    );
    clean = clean
      .replace(/:([a-z0-9-]+):/g, (m, slug) => (EMOTE_SLUGS[slug] && !ownsItem(this.profiles?.peek(fromId), EMOTE_SLUGS[slug].item) ? slug : m))
      .trim();
    if (!clean) return null;

    const t = this.now();
    if (t - (this.last.get(fromId) || 0) < DM_COOLDOWN_MS) throw new Error('Slow down a little');
    this.last.set(fromId, t);
    if (this.last.size > 10_000) this.last.clear();

    const key = pairKey(fromId, targetId);
    const th = (this.threads[key] ||= { seq: 0, users: [fromId, targetId].sort(), msgs: [], read: {}, updatedAt: t });
    const prof = this.profiles?.peek?.(fromId);
    const msg = {
      id: ++th.seq,
      from: fromId,
      name: String(fromUser.name || this.social?.names?.get(fromId) || 'Player').slice(0, 32),
      text: clean,
      at: t,
    };
    if (this.profiles?.passActive?.(prof)) msg.vip = true;
    if (prof?.equipped?.frame && prof.equipped.frame !== 'frame-none') msg.frame = prof.equipped.frame;

    th.msgs.push(msg);
    if (th.msgs.length > DM_KEEP) th.msgs.splice(0, th.msgs.length - DM_KEEP);
    th.read[fromId] = msg.id;
    th.updatedAt = t;

    const keys = Object.keys(this.threads);
    if (keys.length > DM_MAX_THREADS) {
      keys.sort((a, b) => (this.threads[a].updatedAt || 0) - (this.threads[b].updatedAt || 0));
      for (const k of keys.slice(0, keys.length - DM_MAX_THREADS)) delete this.threads[k];
    }

    this.save();
    return { msg: this.#enrichMsg(msg), key };
  }

  unreadForThread(th, userId) {
    const readId = th.read?.[userId] || 0;
    let n = 0;
    for (let i = th.msgs.length - 1; i >= 0; i--) {
      const m = th.msgs[i];
      if (m.id <= readId) break;
      if (m.from !== userId) n++;
    }
    return n;
  }

  unreadCount(userId) {
    let total = 0;
    for (const [key, th] of Object.entries(this.threads)) {
      if (!th.users?.includes(userId)) continue;
      if (this.social?.isBlocked?.(userId, otherOf(key, userId))) continue;
      total += this.unreadForThread(th, userId);
    }
    return total;
  }

  threadsFor(userId) {
    const out = [];
    for (const [key, th] of Object.entries(this.threads)) {
      if (!th.users?.includes(userId) || !th.msgs.length) continue;
      const friendId = otherOf(key, userId);
      if (this.social?.isBlocked?.(userId, friendId)) continue;
      const last = th.msgs[th.msgs.length - 1];
      out.push({
        ...this.#enrichUser(friendId),
        unread: this.unreadForThread(th, userId),
        last: { id: last.id, from: last.from, text: last.text, at: last.at },
      });
    }
    out.sort((a, b) => (b.last?.at || 0) - (a.last?.at || 0));
    return out;
  }

  history(userId, friendId) {
    const key = pairKey(userId, friendId);
    const th = this.threads[key];
    const msgs = th ? th.msgs.map((m) => this.#enrichMsg(m)) : [];
    if (th?.msgs.length) {
      const latest = th.msgs[th.msgs.length - 1].id;
      if ((th.read[userId] || 0) < latest) {
        th.read[userId] = latest;
        this.save();
      }
    }
    return { friend: this.#enrichUser(friendId), msgs };
  }

  markRead(userId, friendId) {
    const th = this.threads[pairKey(userId, friendId)];
    if (!th?.msgs.length) return false;
    const latest = th.msgs[th.msgs.length - 1].id;
    if ((th.read[userId] || 0) >= latest) return false;
    th.read[userId] = latest;
    this.save();
    return true;
  }

  load() {
    for (const f of [this.file, `${this.file}.bak`]) {
      if (!fs.existsSync(f)) continue;
      try {
        const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
        for (const [k, th] of Object.entries(doc.threads || {})) {
          if (!Array.isArray(th.users) || th.users.length !== 2 || !Array.isArray(th.msgs)) continue;
          this.threads[k] = {
            seq: Number(th.seq) || 0,
            users: th.users.map(String),
            msgs: th.msgs.slice(-DM_KEEP),
            read: th.read && typeof th.read === 'object' ? th.read : {},
            updatedAt: Number(th.updatedAt) || 0,
          };
        }
        return;
      } catch (err) {
        console.error(`DM file ${f} is unreadable (${err.message})`);
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
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, threads: this.threads }));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.renameSync(tmp, this.file);
  }
}

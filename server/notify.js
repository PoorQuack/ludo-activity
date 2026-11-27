// Discord notifications: when a player is away from the game (no open connection) and someone
// @mentions them or a friend sends them a message, the app's bot DMs them on Discord.
//  - Only real Discord accounts (not guests), and only people who haven't turned it off
//    (⚙ Settings → General → Discord notifications).
//  - One DM per sender and kind every 30 minutes (a burst of messages is one notice),
//    at most 8 a day per player, and at most 1500 a day for the whole server.
//  - Bots can only DM people who share a server with them. When Discord refuses, that player is
//    left alone for 12 hours instead of being retried on every message.
// Kept in memory only: a restart just resets the counters.
import { sendDm } from './social.js';

const MIN = 60_000;
export const NOTIFY_GAP_MS = 30 * MIN;
export const NOTIFY_PER_DAY = 8;
export const NOTIFY_ALL_PER_DAY = 1500;
const REFUSED_MS = 12 * 60 * MIN;
const DAY = 24 * 60 * MIN;

const plain = (s, max) =>
  String(s ?? '')
    .replace(/[*_~`|>\\]/g, '')
    .replace(/@(everyone|here)/gi, '@​$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export class DiscordNotifier {
  constructor({ token = '', allowed = () => true, send = sendDm, now = () => Date.now(), log = console } = {}) {
    this.token = token;
    this.allowed = allowed; // (userId) => false when they turned notifications off
    this.send = send;
    this.now = now;
    this.log = log;
    this.last = new Map(); // `${userId}|${key}` -> time of the last notice
    this.day = new Map(); // userId -> [times]
    this.all = []; // times, for the whole server
    this.refused = new Map(); // userId -> time Discord refused a DM
    this.sent = 0;
    this.failed = 0;
  }

  get enabled() {
    return !!this.token;
  }

  // Whether a notice may go now (and books it if so)
  take(userId, key) {
    const t = this.now();
    if (t - (this.refused.get(userId) ?? -Infinity) < REFUSED_MS) return false;
    const k = `${userId}|${key}`;
    if (t - (this.last.get(k) ?? -Infinity) < NOTIFY_GAP_MS) return false;
    const mine = (this.day.get(userId) || []).filter((at) => t - at < DAY);
    if (mine.length >= NOTIFY_PER_DAY) return false;
    this.all = this.all.filter((at) => t - at < DAY);
    if (this.all.length >= NOTIFY_ALL_PER_DAY) return false;
    this.last.set(k, t);
    this.day.set(userId, [...mine, t]);
    this.all.push(t);
    if (this.last.size > 20000) for (const [key2, at] of this.last) if (t - at >= NOTIFY_GAP_MS) this.last.delete(key2);
    return true;
  }

  // Fire and forget. Returns a promise (for tests) that never rejects.
  async notify(userId, key, content) {
    if (!this.enabled || !/^\d{5,25}$/.test(String(userId)) || !this.allowed(userId)) return false;
    if (!this.take(userId, key)) return false;
    try {
      await this.send(this.token, userId, content);
      this.sent++;
      return true;
    } catch (err) {
      this.failed++;
      this.refused.set(userId, this.now());
      this.log.warn?.(`Discord notice to ${userId} not sent: ${err.message}`);
      return false;
    }
  }

  mention(userId, { fromId, from, text, where }) {
    const place = where === 'room' ? 'your Ludo room' : 'the Ludo world chat';
    return this.notify(userId, `mention:${fromId}`, `🔔 **${plain(from, 40) || 'Someone'}** mentioned you in ${place}:\n> ${plain(text, 180)}\n\nOpen the Ludo activity in Discord to reply.`);
  }

  message(userId, { fromId, from, text }) {
    return this.notify(userId, `dm:${fromId}`, `💬 **${plain(from, 40) || 'A friend'}** sent you a message in Ludo:\n> ${plain(text, 180)}\n\nOpen the Ludo activity in Discord to reply.`);
  }
}

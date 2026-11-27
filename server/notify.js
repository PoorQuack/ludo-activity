// Discord notifications: when a player is away from the game (no open connection) and someone
// @mentions them (world chat, language chat, room chat) or a friend messages them, the app's
// bot DMs them on Discord. Every ping is sent: there's no cap on how often people can ping.
//  - Only real Discord accounts (not guests), and only people who haven't turned it off
//    (⚙ Settings → General → Discord notifications).
//  - Each player's notices go out one at a time, in order. When Discord says "slow down" (429),
//    we wait the time it asks and carry on, so nothing is dropped.
//  - The DM channel with each player is remembered, so a notice is one call to Discord, not two.
//  - Bots can only DM people who share a server with them. When Discord refuses, that player is
//    skipped for an hour (they may join the server) instead of being retried on every message.
// Kept in memory only: a restart forgets the remembered channels and refusals.

const API = 'https://discord.com/api/v10';
const REFUSED_MS = 60 * 60_000;
const MAX_WAITS = 5; // "slow down" answers in a row before a notice is given up
const MAX_QUEUED = 200; // notices waiting for one player (past that, the oldest are dropped)

const plain = (s, max) =>
  String(s ?? '')
    .replace(/[*_~`|>\\]/g, '')
    .replace(/@(everyone|here)/gi, '@​$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref?.());

export class DiscordNotifier {
  constructor({ token = '', allowed = () => true, send = null, fetchImpl = globalThis.fetch, now = () => Date.now(), wait = sleep, log = console } = {}) {
    this.token = token;
    this.allowed = allowed; // (userId) => false when they turned notifications off
    this.fetch = fetchImpl;
    this.send = send || ((token2, userId, content) => this.botDm(userId, content));
    this.now = now;
    this.wait = wait;
    this.log = log;
    this.channels = new Map(); // userId -> DM channel id
    this.refused = new Map(); // userId -> time Discord refused a DM
    this.queues = new Map(); // userId -> { items: [content], running }
    this.sent = 0;
    this.failed = 0;
  }

  get enabled() {
    return !!this.token;
  }

  // A call to Discord, waiting out "slow down" answers
  async call(url, body) {
    for (let i = 0; ; i++) {
      const r = await this.fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bot ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.status !== 429 || i >= MAX_WAITS) return r;
      const j = await r.json().catch(() => ({}));
      await this.wait(Math.min(30_000, Math.max(250, (Number(j.retry_after) || 1) * 1000)));
    }
  }

  async botDm(userId, content) {
    let ch = this.channels.get(userId);
    if (!ch) {
      const r = await this.call(`${API}/users/@me/channels`, { recipient_id: userId });
      if (!r.ok) throw new Error(`no DM channel (${r.status})`);
      ch = (await r.json()).id;
      this.channels.set(userId, ch);
      if (this.channels.size > 50_000) this.channels.delete(this.channels.keys().next().value);
    }
    const r = await this.call(`${API}/channels/${ch}/messages`, { content, allowed_mentions: { parse: [] } });
    if (!r.ok) {
      if (r.status === 404) this.channels.delete(userId);
      throw new Error(`DM refused (${r.status})`);
    }
  }

  // Queues a notice. Returns a promise (for tests) that never rejects: true once it's sent.
  notify(userId, content) {
    if (!this.enabled || !/^\d{5,25}$/.test(String(userId)) || !this.allowed(userId)) return Promise.resolve(false);
    if (this.now() - (this.refused.get(userId) ?? -Infinity) < REFUSED_MS) return Promise.resolve(false);
    let q = this.queues.get(userId);
    if (!q) this.queues.set(userId, (q = { items: [], running: null }));
    return new Promise((resolve) => {
      q.items.push({ content, resolve });
      if (q.items.length > MAX_QUEUED) q.items.shift().resolve(false);
      if (!q.running) q.running = this.drain(userId, q);
    });
  }

  async drain(userId, q) {
    while (q.items.length) {
      const { content, resolve } = q.items.shift();
      if (this.now() - (this.refused.get(userId) ?? -Infinity) < REFUSED_MS) {
        resolve(false);
        continue;
      }
      try {
        await this.send(this.token, userId, content);
        this.sent++;
        resolve(true);
      } catch (err) {
        this.failed++;
        this.refused.set(userId, this.now());
        this.log.warn?.(`Discord notice to ${userId} not sent: ${err.message}`);
        resolve(false);
      }
    }
    q.running = null;
    this.queues.delete(userId);
  }

  mention(userId, { from, text, where }) {
    const place = where === 'room' ? 'your Ludo room' : where === 'lang' ? 'the Ludo language chat' : 'the Ludo world chat';
    return this.notify(userId, `🔔 **${plain(from, 40) || 'Someone'}** mentioned you in ${place}:\n> ${plain(text, 180)}\n\nOpen the Ludo activity in Discord to reply.`);
  }

  message(userId, { from, text }) {
    return this.notify(userId, `💬 **${plain(from, 40) || 'A friend'}** sent you a message in Ludo:\n> ${plain(text, 180)}\n\nOpen the Ludo activity in Discord to reply.`);
  }
}

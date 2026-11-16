// "Join our Discord server" invite. Players see it in the menu until they join, or until they
// tick "Don't ask again". A plain "No thanks" snoozes it for a week.
// With the app's bot in that server (DISCORD_BOT_TOKEN), players who are already members are
// never asked; without it, everyone who hasn't answered yet is asked.

const API = 'https://discord.com/api/v10';
const MEMBER_CACHE_MS = 10 * 60 * 1000;
const GUILD_RETRY_MS = 10 * 60 * 1000;

export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export class ServerInvite {
  constructor({ url, token = '', fetch = globalThis.fetch, now = Date.now } = {}) {
    this.url = url || '';
    this.code = (this.url.match(/(?:discord\.gg|discord(?:app)?\.com\/invite)\/([\w-]+)/i) || [])[1] || '';
    this.token = token;
    this.fetch = fetch;
    this.now = now;
    this.guildId = null;
    this.guildTried = 0;
    this.members = new Map(); // userId -> { member, at }
  }

  get enabled() {
    return !!this.code;
  }

  async guild() {
    if (this.guildId || !this.code || this.now() - this.guildTried < GUILD_RETRY_MS) return this.guildId;
    this.guildTried = this.now();
    try {
      const r = await this.fetch(`${API}/invites/${this.code}`, this.token ? { headers: { Authorization: `Bot ${this.token}` } } : {});
      if (r.ok) this.guildId = (await r.json())?.guild?.id || null;
    } catch {}
    return this.guildId;
  }

  // true / false, or null when we can't tell (no bot, bot not in the server, Discord down).
  async isMember(userId) {
    if (!this.token || !/^\d+$/.test(userId)) return null;
    const hit = this.members.get(userId);
    if (hit && this.now() - hit.at < MEMBER_CACHE_MS) return hit.member;
    const guildId = await this.guild();
    if (!guildId) return null;
    try {
      const r = await this.fetch(`${API}/guilds/${guildId}/members/${userId}`, { headers: { Authorization: `Bot ${this.token}` } });
      let member = null;
      if (r.ok) member = true;
      else if (r.status === 404) member = (await r.json().catch(() => ({})))?.code === 10007 ? false : null; // 10007 = unknown member
      if (member !== null) this.members.set(userId, { member, at: this.now() });
      return member;
    } catch {
      return null;
    }
  }
}

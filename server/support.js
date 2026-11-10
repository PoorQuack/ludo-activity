// Players contact the owner from the game (⚙ Settings → Contact the developer). Nothing reaches
// them directly: the server forwards each request to the owner's Discord DMs through the app's
// bot (DISCORD_BOT_TOKEN, SUPPORT_USER_ID in .env).
//  - Bug reports go straight away, with the context that helps fix them.
//  - Feedback is collected and sent as one digest a day (or once 15 pile up), so it can't flood.
//  - Limits per player: 3 bug reports an hour, 3 feedback notes a day; and 40 bug DMs a day
//    overall (past that, bugs wait for the digest too).
// Everything is also kept in data/support.json, so nothing is lost if Discord can't be reached.
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://discord.com/api/v10';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const SUPPORT_KINDS = ['bug', 'feedback'];
const LIMITS = { bug: { max: 3, windowMs: HOUR }, feedback: { max: 3, windowMs: DAY } };
const BUG_DMS_PER_DAY = 40;
const DIGEST_AT = 15; // feedback notes that trigger an early digest
const KEEP = 500; // requests kept in the file
export const SUPPORT_MAX_LEN = 1000;

export class SupportDesk {
  constructor(file, { token = '', ownerId = '', fetchImpl = fetch, now = () => Date.now(), log = console } = {}) {
    this.file = file;
    this.token = token;
    this.ownerId = ownerId;
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
    this.sent = new Map(); // `${userId}:${kind}` -> times sent (for the limits)
    this.bugDms = []; // times bug DMs went out today
    this.dmChannel = null;
    this.data = { requests: [], queue: [], lastDigest: 0, seq: 0 };
    try {
      if (file && fs.existsSync(file)) Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (err) {
      log.error(`Couldn't read ${file}: ${err.message}`);
    }
    if (!this.data.lastDigest) this.data.lastDigest = now(); // the first digest a day from now
    // The digest goes out once a day; checked every 10 minutes
    this.timer = setInterval(() => this.maybeDigest(), 10 * 60_000);
    this.timer.unref?.();
  }

  get enabled() {
    return !!(this.token && this.ownerId);
  }

  // A player's request. Returns { id, when: 'now' | 'digest' } or throws a message for them.
  async submit({ userId, name, kind, text, context = {} }) {
    if (!SUPPORT_KINDS.includes(kind)) throw new Error('Pick bug or feedback');
    const clean = String(text || '')
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, SUPPORT_MAX_LEN);
    if (clean.length < 10) throw new Error('Tell us a bit more (at least 10 characters)');
    const key = `${userId}:${kind}`;
    const { max, windowMs } = LIMITS[kind];
    const now = this.now();
    const recent = (this.sent.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      throw new Error(kind === 'bug' ? "You've sent a few bug reports already, thanks! Try again in an hour." : "Thanks for all the feedback! You can send more tomorrow.");
    }
    recent.push(now);
    this.sent.set(key, recent);

    const req = { id: ++this.data.seq, kind, userId, name: String(name || '?').slice(0, 64), text: clean, context, at: now };
    this.data.requests.push(req);
    if (this.data.requests.length > KEEP) this.data.requests.splice(0, this.data.requests.length - KEEP);

    this.bugDms = this.bugDms.filter((t) => now - t < DAY);
    let when = 'digest';
    if (kind === 'bug' && this.bugDms.length < BUG_DMS_PER_DAY) {
      this.bugDms.push(now);
      when = 'now';
      const ok = await this.dm(bugMessage(req));
      if (!ok) this.data.queue.push(req); // Discord unreachable: it goes with the next digest
    } else this.data.queue.push(req);
    this.save();
    if (this.data.queue.length >= DIGEST_AT) this.digest();
    return { id: req.id, when };
  }

  // Once a day (and whenever 15 have piled up): everything waiting, in one or a few messages
  async maybeDigest() {
    if (this.data.queue.length && this.now() - (this.data.lastDigest || 0) >= DAY) await this.digest();
  }

  async digest() {
    if (!this.data.queue.length || this.digesting) return;
    this.digesting = true;
    try {
      const items = [...this.data.queue];
      const bugs = items.filter((r) => r.kind === 'bug');
      const notes = items.filter((r) => r.kind !== 'bug');
      const lines = [
        ...bugs.map((r) => `🐞 **#${r.id} ${esc(r.name)}** (${r.userId}): ${esc(r.text)}`),
        ...notes.map((r) => `💬 **#${r.id} ${esc(r.name)}**: ${esc(r.text)}`),
      ];
      const head = `📬 **Ludo feedback digest**: ${notes.length} feedback${bugs.length ? `, ${bugs.length} bug report${bugs.length > 1 ? 's' : ''} that waited` : ''}`;
      // Discord messages hold 2000 characters: split into as many as needed
      const msgs = [];
      let cur = head;
      for (const l of lines) {
        const line = l.length > 1900 ? `${l.slice(0, 1897)}…` : l;
        if (cur.length + line.length + 2 > 1950) {
          msgs.push(cur);
          cur = '';
        }
        cur += `${cur ? '\n\n' : ''}${line}`;
      }
      if (cur) msgs.push(cur);
      for (const content of msgs) if (!(await this.dm({ content }))) return; // try again later
      this.data.queue = this.data.queue.filter((r) => !items.includes(r));
      this.data.lastDigest = this.now();
      this.save();
    } finally {
      this.digesting = false;
    }
  }

  // A DM to the owner; false if it couldn't be sent (not set up, or Discord said no)
  async dm(body) {
    if (!this.enabled) {
      this.log.log(`Support (no bot set up, kept in ${this.file}): ${body.content || body.embeds?.[0]?.title}`);
      return false;
    }
    const headers = { Authorization: `Bot ${this.token}`, 'Content-Type': 'application/json' };
    try {
      if (!this.dmChannel) {
        const r = await this.fetch(`${API}/users/@me/channels`, { method: 'POST', headers, body: JSON.stringify({ recipient_id: this.ownerId }) });
        if (!r.ok) throw new Error(`open DM: ${r.status} ${await r.text()}`);
        this.dmChannel = (await r.json()).id;
      }
      const r = await this.fetch(`${API}/channels/${this.dmChannel}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, allowed_mentions: { parse: [] } }),
      });
      if (!r.ok) throw new Error(`send: ${r.status} ${await r.text()}`);
      return true;
    } catch (err) {
      this.log.error(`Support DM failed (${err.message}); kept for the next digest`);
      return false;
    }
  }

  save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.log.error(`Couldn't save ${this.file}: ${err.message}`);
    }
  }

  stop() {
    clearInterval(this.timer);
  }
}

// Keep players' text from pinging anyone or breaking the formatting
const esc = (s) => String(s).replace(/@/g, '@​').replace(/([*_~`|>])/g, '\\$1');

function bugMessage(r) {
  const c = r.context || {};
  const fields = [
    { name: 'From', value: `${esc(r.name)} (\`${r.userId}\`)`, inline: true },
    c.room && { name: 'Room', value: `\`${esc(c.room)}\` · ${esc(c.mode || '?')} · ${esc(c.phase || '?')}`, inline: true },
    c.device && { name: 'Device', value: esc(c.device).slice(0, 200) },
    c.version && { name: 'Page', value: esc(c.version).slice(0, 100), inline: true },
  ].filter(Boolean);
  return {
    embeds: [
      {
        title: `🐞 Bug report #${r.id}`,
        description: esc(r.text),
        color: 0xff4d6d,
        fields,
        timestamp: new Date(r.at).toISOString(),
      },
    ],
  };
}

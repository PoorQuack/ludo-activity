// Players contact the owner from the game (⚙ Settings → Report a bug / send feedback). Nothing
// reaches them directly: the server forwards each request to the owner's Discord DMs through the
// app's bot (DISCORD_BOT_TOKEN, SUPPORT_USER_ID in .env; check with scripts/support-test.sh).
//  - The form asks set questions (bug: what happened, what you did before, how often, where;
//    feedback: topic, the feedback, an optional star rating), plus an optional screenshot or
//    short video, uploaded separately (POST /api/support/upload with a one-time ticket).
//  - Bug reports go straight away, with the context that helps fix them.
//  - Feedback is collected and sent as one digest a day (or once 15 pile up), so it can't flood.
//  - Limits per player: 3 bug reports an hour, 3 feedback notes a day; and 40 bug DMs a day
//    overall (past that, bugs wait for the digest too).
// Everything is also kept in data/support.json (files in data/support-files/), so nothing is lost
// if Discord can't be reached.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const API = 'https://discord.com/api/v10';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const SUPPORT_KINDS = ['bug', 'feedback'];
const LIMITS = { bug: { max: 3, windowMs: HOUR }, feedback: { max: 3, windowMs: DAY } };
const BUG_DMS_PER_DAY = 40;
const DIGEST_AT = 15; // feedback notes that trigger an early digest
const KEEP = 500; // requests kept in the file
const KEEP_FILES = 200; // attachments kept on disk
export const SUPPORT_MAX_LEN = 1000;
export const SUPPORT_MAX_FILE = 10 * 1024 * 1024; // Discord's upload limit for a free account
const UPLOAD_WAIT_MS = 90_000; // a promised file that hasn't arrived by then: send without it

// The questions, and how each answer is checked. (The page shows the same questions.)
const OFTEN = { once: 'Once', sometimes: 'Sometimes', always: 'Every time' };
const WHERE = { menu: 'Main menu', lobby: 'Lobby', game: 'During a game', shop: 'Shop', other: 'Somewhere else' };
const TOPIC = { idea: 'New idea', boards: 'Boards & skins', stickers: 'Stickers', gameplay: 'Gameplay & rules', other: 'Something else' };

// The file types accepted, recognised by their first bytes (not the name the browser gives)
const FILE_TYPES = [
  { ext: 'png', mime: 'image/png', image: true, test: (b) => b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  { ext: 'jpg', mime: 'image/jpeg', image: true, test: (b) => b[0] === 0xff && b[1] === 0xd8 },
  { ext: 'gif', mime: 'image/gif', image: true, test: (b) => b.slice(0, 3).toString() === 'GIF' },
  { ext: 'webp', mime: 'image/webp', image: true, test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
  { ext: 'mov', mime: 'video/quicktime', test: (b) => b.slice(4, 8).toString() === 'ftyp' && b.slice(8, 10).toString() === 'qt' },
  { ext: 'mp4', mime: 'video/mp4', test: (b) => b.slice(4, 8).toString() === 'ftyp' },
  { ext: 'webm', mime: 'video/webm', test: (b) => b.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
];
export function sniffFile(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  return FILE_TYPES.find((t) => t.test(buf)) || null;
}

const clean = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);

// The answers for a kind, checked and tidied; throws a message for the player
export function checkAnswers(kind, a = {}) {
  if (kind === 'bug') {
    const what = clean(a.what, SUPPORT_MAX_LEN);
    const before = clean(a.before, 300);
    if (what.length < 10) throw new Error('Tell us what happened (at least 10 characters)');
    if (before.length < 3) throw new Error('Tell us what you were doing just before');
    if (!OFTEN[a.often]) throw new Error('How often does it happen?');
    if (!WHERE[a.where]) throw new Error('Where did it happen?');
    return { what, before, often: a.often, where: a.where };
  }
  if (kind === 'feedback') {
    const text = clean(a.text, SUPPORT_MAX_LEN);
    if (!TOPIC[a.topic]) throw new Error('What is your feedback about?');
    if (text.length < 10) throw new Error('Tell us a bit more (at least 10 characters)');
    const stars = Number(a.stars);
    return { topic: a.topic, text, stars: Number.isInteger(stars) && stars >= 1 && stars <= 5 ? stars : null };
  }
  throw new Error('Pick bug or feedback');
}

export class SupportDesk {
  constructor(file, { token = '', ownerId = '', fetchImpl = fetch, now = () => Date.now(), log = console } = {}) {
    this.file = file;
    this.filesDir = file ? path.join(path.dirname(file), 'support-files') : null;
    this.token = token;
    this.ownerId = ownerId;
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
    this.sent = new Map(); // `${userId}:${kind}` -> times sent (for the limits)
    this.bugDms = []; // times bug DMs went out today
    this.pending = new Map(); // upload ticket -> { req, timer }
    this.dmChannel = null;
    this.lastError = null;
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

  // A player's request: { kind, answers, attach: { size } | null }. Returns { id, when, ticket? }:
  // with `attach`, it waits for the file (uploadFile with the ticket) before being sent.
  async submit({ userId, name, kind, answers, attach = null, context = {} }) {
    const checked = checkAnswers(kind, answers);
    if (attach) {
      const size = Number(attach.size);
      if (!(size > 0)) throw new Error("That file couldn't be read");
      if (size > SUPPORT_MAX_FILE) throw new Error('That file is too big (10 MB at most): try a shorter clip or a screenshot');
    }
    const key = `${userId}:${kind}`;
    const { max, windowMs } = LIMITS[kind];
    const now = this.now();
    const recent = (this.sent.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      throw new Error(kind === 'bug' ? "You've sent a few bug reports already, thanks! Try again in an hour." : 'Thanks for all the feedback! You can send more tomorrow.');
    }
    recent.push(now);
    this.sent.set(key, recent);

    const req = { id: ++this.data.seq, kind, userId, name: String(name || '?').slice(0, 64), answers: checked, context, at: now, file: null };
    this.data.requests.push(req);
    if (this.data.requests.length > KEEP) this.data.requests.splice(0, this.data.requests.length - KEEP);
    this.save();

    this.bugDms = this.bugDms.filter((t) => now - t < DAY);
    const when = kind === 'bug' && this.bugDms.length < BUG_DMS_PER_DAY ? 'now' : 'digest';
    if (when === 'now') this.bugDms.push(now);
    req.when = when;
    if (attach) {
      const ticket = randomBytes(18).toString('hex');
      const timer = setTimeout(() => this.release(ticket, 'the attachment never arrived'), UPLOAD_WAIT_MS);
      timer.unref?.();
      this.pending.set(ticket, { req, timer, userId });
      return { id: req.id, when, ticket };
    }
    await this.deliver(req);
    return { id: req.id, when };
  }

  // The file for a request that promised one. Returns { ok } or throws a message for the player.
  async uploadFile(ticket, buf) {
    const p = this.pending.get(String(ticket || ''));
    if (!p) throw new Error('This upload has expired: send the report again');
    if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('The file was empty');
    if (buf.length > SUPPORT_MAX_FILE) throw new Error('That file is too big (10 MB at most)');
    const type = sniffFile(buf);
    if (!type) {
      await this.release(ticket, 'the attachment was not an image or video');
      throw new Error('Only pictures (PNG, JPG, GIF, WebP) and videos (MP4, MOV, WebM) can be attached');
    }
    const fname = `${p.req.id}.${type.ext}`;
    p.req.file = { name: fname, mime: type.mime, image: !!type.image, size: buf.length };
    p.buf = buf;
    if (this.filesDir) {
      try {
        fs.mkdirSync(this.filesDir, { recursive: true });
        fs.writeFileSync(path.join(this.filesDir, fname), buf);
        this.pruneFiles();
      } catch (err) {
        this.log.error(`Couldn't save ${fname}: ${err.message}`);
      }
    }
    await this.release(ticket);
    return { ok: true };
  }

  // Stop waiting for a file and send the request (with the file if it came)
  async release(ticket, note = null) {
    const p = this.pending.get(ticket);
    if (!p) return;
    this.pending.delete(ticket);
    clearTimeout(p.timer);
    if (note) p.req.note = note;
    this.save();
    await this.deliver(p.req, p.buf);
  }

  async deliver(req, buf = null) {
    if (req.when === 'now') {
      const ok = await this.dm(bugMessage(req), buf && req.file ? [{ buf, ...req.file }] : []);
      if (!ok) this.data.queue.push(req); // Discord unreachable: it goes with the next digest
    } else this.data.queue.push(req);
    this.save();
    if (this.data.queue.length >= DIGEST_AT) await this.digest();
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
      const lines = [...bugs.map(digestLine), ...notes.map(digestLine)];
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
      // then the pictures and videos, one message each
      for (const r of items.filter((x) => x.file)) {
        const buf = this.readFile(r.file.name);
        if (buf) await this.dm({ content: `📎 #${r.id} from ${esc(r.name)}` }, [{ buf, ...r.file }]);
      }
      this.data.queue = this.data.queue.filter((r) => !items.includes(r));
      this.data.lastDigest = this.now();
      this.save();
    } finally {
      this.digesting = false;
    }
  }

  readFile(name) {
    try {
      return this.filesDir ? fs.readFileSync(path.join(this.filesDir, name)) : null;
    } catch {
      return null;
    }
  }

  pruneFiles() {
    const files = fs.readdirSync(this.filesDir).map((f) => ({ f, t: fs.statSync(path.join(this.filesDir, f)).mtimeMs }));
    files.sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(KEEP_FILES)) fs.rmSync(path.join(this.filesDir, f), { force: true });
  }

  // A DM to the owner, with files; false if it couldn't be sent (this.lastError says why)
  async dm(body, files = []) {
    this.lastError = null;
    if (!this.enabled) {
      this.lastError = `not set up: ${!this.token ? 'DISCORD_BOT_TOKEN' : ''}${!this.token && !this.ownerId ? ' and ' : ''}${!this.ownerId ? 'SUPPORT_USER_ID' : ''} missing in .env`;
      this.log.log(`Support (${this.lastError}; kept in ${this.file}): ${body.content || body.embeds?.[0]?.title}`);
      return false;
    }
    const auth = { Authorization: `Bot ${this.token}` };
    try {
      if (!this.dmChannel) {
        const r = await this.fetch(`${API}/users/@me/channels`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient_id: this.ownerId }) });
        if (!r.ok) throw new Error(`opening the DM: ${r.status} ${await r.text()}`);
        this.dmChannel = (await r.json()).id;
      }
      const payload = { ...body, allowed_mentions: { parse: [] } };
      let init;
      if (files.length) {
        const form = new FormData();
        payload.attachments = files.map((f, i) => ({ id: i, filename: f.name }));
        form.append('payload_json', JSON.stringify(payload));
        files.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.buf], { type: f.mime }), f.name));
        init = { method: 'POST', headers: auth, body: form };
      } else init = { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
      const r = await this.fetch(`${API}/channels/${this.dmChannel}/messages`, init);
      if (!r.ok) throw new Error(`sending: ${r.status} ${await r.text()}`);
      return true;
    } catch (err) {
      this.lastError = err.message;
      this.dmChannel = null; // open the DM again next time
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
    for (const p of this.pending.values()) clearTimeout(p.timer);
  }
}

// Keep players' text from pinging anyone or breaking the formatting
const esc = (s) => String(s).replace(/@/g, '@​').replace(/([*_~`|>])/g, '\\$1');
const starsText = (n) => (n ? `${'★'.repeat(n)}${'☆'.repeat(5 - n)}` : '');

function digestLine(r) {
  const a = r.answers || {};
  const clip = r.file ? ' 📎' : '';
  if (r.kind === 'bug') return `🐞 **#${r.id} ${esc(r.name)}** (${r.userId}) · ${WHERE[a.where] || '?'} · ${OFTEN[a.often] || '?'}${clip}\n${esc(a.what || r.text || '')}\n*Before:* ${esc(a.before || '')}`;
  return `💬 **#${r.id} ${esc(r.name)}** · ${TOPIC[a.topic] || 'Feedback'}${a.stars ? ` · ${starsText(a.stars)}` : ''}${clip}\n${esc(a.text || r.text || '')}`;
}

function bugMessage(r) {
  const a = r.answers || {};
  const c = r.context || {};
  const fields = [
    { name: 'What they were doing', value: esc(a.before || '?').slice(0, 1000) },
    { name: 'How often', value: OFTEN[a.often] || '?', inline: true },
    { name: 'Where', value: WHERE[a.where] || '?', inline: true },
    { name: 'From', value: `${esc(r.name)} (\`${r.userId}\`)`, inline: true },
    c.room && { name: 'Room', value: `\`${esc(c.room)}\` · ${esc(c.mode || '?')} · ${esc(c.phase || '?')}`, inline: true },
    c.device && { name: 'Device', value: esc(c.device).slice(0, 200) },
    r.note && { name: 'Note', value: r.note },
  ].filter(Boolean);
  const embed = {
    title: `🐞 Bug report #${r.id}`,
    description: esc(a.what || r.text || ''),
    color: 0xff4d6d,
    fields,
    timestamp: new Date(r.at).toISOString(),
  };
  if (r.file?.image) embed.image = { url: `attachment://${r.file.name}` };
  return { embeds: [embed] };
}

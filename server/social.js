// Friends. "Played with" is everyone you've started a game with (newest first); from there you
// can add people as friends, see who's online, and invite them to your room. An invite pops up
// in their game if they're on, and otherwise arrives as a Discord DM from the app's bot.
// Kept in data/social.json. Guests (browser testing) are kept in memory only.

import fs from 'node:fs';
import path from 'node:path';

const MAX_MET = 30;
const MAX_FRIENDS = 100;
const SAVE_DELAY_MS = 2000;
const INVITE_GAP_MS = 60 * 1000; // the same friend once a minute
const INVITES_PER_HOUR = 20;
const API = 'https://discord.com/api/v10';

const isGuest = (id) => String(id).startsWith('guest-');

export class SocialBook {
  constructor(file, { now = Date.now } = {}) {
    this.file = file;
    this.now = now;
    this.users = new Map(); // id -> { met: [{ id, at }], friends: [id] }
    this.names = new Map(); // id -> latest display name
    this.avatars = new Map(); // id -> Discord avatar hash ('' for the default avatar)
    this.sent = new Map(); // `${from}>${to}` -> time; and from -> [times] for the hourly cap
    this.saveTimer = null;
    if (file && fs.existsSync(file)) {
      try {
        const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const [id, u] of Object.entries(doc.users || {})) {
          this.users.set(id, {
            met: (u.met || []).filter((m) => m && typeof m.id === 'string').slice(0, MAX_MET),
            friends: (u.friends || []).filter((f) => typeof f === 'string').slice(0, MAX_FRIENDS),
            ...(u.noInvites ? { noInvites: true } : {}),
          });
        }
        for (const [id, n] of Object.entries(doc.names || {})) this.names.set(id, String(n));
        for (const [id, a] of Object.entries(doc.avatars || {})) this.avatars.set(id, String(a));
      } catch (err) {
        const bad = `${file}.corrupt-${Date.now()}`;
        console.error(`Friends file unreadable (${err.message}) — moved to ${bad}`);
        fs.renameSync(file, bad);
      }
    }
  }

  user(id) {
    let u = this.users.get(id);
    if (!u) this.users.set(id, (u = { met: [], friends: [] }));
    return u;
  }

  // Seen on login: keep their name and avatar fresh for everyone's lists.
  seen(id, name, avatar) {
    if (this.names.get(id) === name && (avatar === undefined || this.avatars.get(id) === avatar)) return;
    this.names.set(id, name);
    if (avatar !== undefined) this.avatars.set(id, avatar || '');
    this.save();
  }

  // A game started with these humans: each has now played with the others.
  played(players) {
    const t = this.now();
    for (const p of players) this.names.set(p.userId, p.name);
    for (const a of players) {
      const u = this.user(a.userId);
      for (const b of players) {
        if (a.userId === b.userId || isGuest(a.userId) !== isGuest(b.userId)) continue; // guests only meet guests
        u.met = [{ id: b.userId, at: t }, ...u.met.filter((m) => m.id !== b.userId)].slice(0, MAX_MET);
      }
    }
    this.save();
  }

  addFriend(id, friendId) {
    if (id === friendId) throw new Error("That's you!");
    const u = this.user(id);
    if (!u.met.some((m) => m.id === friendId)) throw new Error('You can add people you have played with');
    if (u.friends.includes(friendId)) return;
    if (u.friends.length >= MAX_FRIENDS) throw new Error(`You can have up to ${MAX_FRIENDS} friends`);
    u.friends.unshift(friendId);
    this.save();
  }

  removeFriend(id, friendId) {
    const u = this.user(id);
    u.friends = u.friends.filter((f) => f !== friendId);
    this.save();
  }

  // ⚙ Settings → General → "Receive invitations from my friends"
  setInvites(id, on) {
    const u = this.user(id);
    if (on) delete u.noInvites;
    else u.noInvites = true;
    this.save();
  }

  acceptsInvites(id) {
    return !this.users.get(id)?.noInvites;
  }

  isFriend(id, friendId) {
    return this.users.get(id)?.friends.includes(friendId) || false;
  }

  // The friends card: friends first, then people played with who aren't friends yet.
  view(id, isOnline = () => false) {
    const u = this.users.get(id) || { met: [], friends: [] };
    const person = (pid, extra = {}) => ({ id: pid, name: this.names.get(pid) || 'Player', avatar: !isGuest(pid), online: isOnline(pid), ...extra });
    return {
      invitesOn: !u.noInvites,
      friends: u.friends.map((f) => person(f)),
      met: u.met.filter((m) => !u.friends.includes(m.id)).map((m) => person(m.id, { at: m.at })),
    };
  }

  // Rate limits for invites. Throws with a message for the sender.
  checkInvite(from, to) {
    const t = this.now();
    const key = `${from}>${to}`;
    if (t - (this.sent.get(key) ?? -Infinity) < INVITE_GAP_MS) throw new Error('You just invited them, give them a minute');
    const recent = (this.sent.get(from) || []).filter((at) => t - at < 3600_000);
    if (recent.length >= INVITES_PER_HOUR) throw new Error('That\'s a lot of invites, try again later');
    this.sent.set(key, t);
    this.sent.set(from, [...recent, t]);
  }

  save() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    this.saveTimer.unref?.();
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    const doc = { users: {}, names: {}, avatars: {} };
    for (const [id, u] of this.users) if (!isGuest(id)) doc.users[id] = u;
    for (const [id, n] of this.names) if (!isGuest(id)) doc.names[id] = n;
    for (const [id, a] of this.avatars) if (!isGuest(id)) doc.avatars[id] = a;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc));
    fs.renameSync(tmp, this.file);
  }
}

// A Discord DM from the app's bot. Bots can only DM people who share a server with them.
export async function sendDm(token, userId, content, fetchFn = globalThis.fetch) {
  if (!token) throw new Error('DMs are not set up on this server');
  const auth = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };
  const ch = await fetchFn(`${API}/users/@me/channels`, { method: 'POST', headers: auth, body: JSON.stringify({ recipient_id: userId }) });
  if (!ch.ok) throw new Error("Couldn't reach them on Discord");
  const { id } = await ch.json();
  const r = await fetchFn(`${API}/channels/${id}/messages`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
  if (!r.ok) throw new Error("Couldn't DM them: they need to share a server with the Ludo bot, and allow DMs from it");
}

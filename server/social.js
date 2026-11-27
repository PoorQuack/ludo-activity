// Friends. "Played with" is everyone you've started a game with (newest first); from there you
// can send someone a friend request. Friendship is two-way: it starts when they accept, and
// ends for both when either removes the other. Friends see each other online and can invite
// each other to their room. An invite pops up in their game if they're on, and otherwise
// arrives as a Discord DM from the app's bot.
// Kept in data/social.json. Guests (browser testing) are kept in memory only.

import fs from 'node:fs';
import path from 'node:path';

const MAX_MET = 30;
const MAX_FRIENDS = 100;
const MAX_REQUESTS = 50; // waiting requests, each way
const SAVE_DELAY_MS = 2000;
const INVITE_GAP_MS = 60 * 1000; // the same friend once a minute
const INVITES_PER_HOUR = 20;
const API = 'https://discord.com/api/v10';

const isGuest = (id) => String(id).startsWith('guest-');

export class SocialBook {
  constructor(file, { now = Date.now } = {}) {
    this.file = file;
    this.now = now;
    this.users = new Map(); // id -> { met: [{ id, at }], friends: [id], in: [{ id, at }], out: [{ id, at }] }
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
            in: (u.in || []).filter((r) => r && typeof r.id === 'string').slice(0, MAX_REQUESTS),
            out: (u.out || []).filter((r) => r && typeof r.id === 'string').slice(0, MAX_REQUESTS),
            blocked: (u.blocked || []).filter((b) => typeof b === 'string'),
            ...(u.noInvites ? { noInvites: true } : {}),
            ...(u.noPings ? { noPings: true } : {}),
          });
        }
        this.migrateOneWay();
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
    if (!u) this.users.set(id, (u = { met: [], friends: [], in: [], out: [], blocked: [] }));
    u.in ||= [];
    u.out ||= [];
    u.blocked ||= [];
    return u;
  }

  // Before requests, adding a friend was one-way: A could list B without B ever knowing. Each
  // one-way friendship becomes a request from A to B (B gets it in their inbox); both-way ones
  // stay friends.
  migrateOneWay() {
    const t = this.now();
    let changed = false;
    for (const [id, u] of this.users) {
      for (const f of [...u.friends]) {
        if (this.users.get(f)?.friends.includes(id)) continue;
        u.friends = u.friends.filter((x) => x !== f);
        this.user(id);
        if (!u.out.some((r) => r.id === f)) u.out.push({ id: f, at: t });
        const v = this.user(f);
        if (!v.in.some((r) => r.id === id)) v.in.push({ id, at: t });
        changed = true;
      }
    }
    if (changed) this.save();
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

  // A friend request. Returns what happened: 'sent', 'accepted' (they had already asked you, so
  // you're friends now), 'pending' (already asked) or 'friends' (already friends).
  request(id, other) {
    if (id === other) throw new Error("That's you!");
    if (this.isBlockedEither(id, other)) throw new Error('Cannot send a friend request to this user');
    const u = this.user(id);
    if (u.friends.includes(other)) return 'friends';
    if (u.in.some((r) => r.id === other)) {
      this.accept(id, other);
      return 'accepted';
    }
    if (u.out.some((r) => r.id === other)) return 'pending';
    if (!u.met.some((m) => m.id === other) && (isGuest(other) || !this.names.has(other))) throw new Error('You can add people you have played with');
    if (u.friends.length >= MAX_FRIENDS) throw new Error(`You can have up to ${MAX_FRIENDS} friends`);
    if (u.out.length >= MAX_REQUESTS) throw new Error('You have a lot of requests waiting: give people time to answer');
    const v = this.user(other);
    if (v.in.length >= MAX_REQUESTS) throw new Error("They have a lot of requests waiting, try again later");
    const t = this.now();
    u.out.unshift({ id: other, at: t });
    v.in.unshift({ id, at: t });
    this.save();
    return 'sent';
  }

  // Accept someone's request: friends both ways.
  accept(id, from) {
    const u = this.user(id);
    if (!u.in.some((r) => r.id === from)) throw new Error('That request is gone');
    const v = this.user(from);
    if (u.friends.length >= MAX_FRIENDS) throw new Error(`You can have up to ${MAX_FRIENDS} friends`);
    this.dropRequest(from, id);
    if (!u.friends.includes(from)) u.friends.unshift(from);
    if (!v.friends.includes(id)) v.friends.unshift(id);
    this.save();
  }

  // Say no to a request (they aren't told), or take back one you sent
  decline(id, from) {
    this.dropRequest(from, id);
    this.save();
  }

  cancel(id, to) {
    this.dropRequest(id, to);
    this.save();
  }

  dropRequest(from, to) {
    const a = this.user(from);
    const b = this.user(to);
    a.out = a.out.filter((r) => r.id !== to);
    b.in = b.in.filter((r) => r.id !== from);
  }

  // Unfriend: gone from both lists
  removeFriend(id, friendId) {
    const u = this.user(id);
    u.friends = u.friends.filter((f) => f !== friendId);
    const v = this.users.get(friendId);
    if (v) v.friends = v.friends.filter((f) => f !== id);
    this.save();
  }

  // Requests waiting for this player's answer, newest first
  requests(id) {
    return (this.users.get(id)?.in || []).map((r) => ({ id: r.id, name: this.names.get(r.id) || 'Player', avatar: !isGuest(r.id), at: r.at }));
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

  // ⚙ Settings → General → "Discord notifications": a DM from the bot when you're away and
  // someone @mentions you or a friend messages you
  setPings(id, on) {
    const u = this.user(id);
    if (on) delete u.noPings;
    else u.noPings = true;
    this.save();
  }

  acceptsPings(id) {
    return !this.users.get(id)?.noPings;
  }

  isFriend(id, friendId) {
    return this.users.get(id)?.friends.includes(friendId) || false;
  }

  isBlocked(id, other) {
    return this.users.get(id)?.blocked?.includes(other) || false;
  }

  isBlockedEither(a, b) {
    return this.isBlocked(a, b) || this.isBlocked(b, a);
  }

  block(id, targetId) {
    if (!id || !targetId || id === targetId) throw new Error("That's you!");
    const u = this.user(id);
    if (!u.blocked.includes(targetId)) {
      u.blocked.unshift(targetId);
      if (u.blocked.length > 200) u.blocked.length = 200;
    }
    u.friends = u.friends.filter((f) => f !== targetId);
    const v = this.users.get(targetId);
    if (v) v.friends = v.friends.filter((f) => f !== id);
    this.dropRequest(id, targetId);
    this.dropRequest(targetId, id);
    this.save();
  }

  unblock(id, targetId) {
    const u = this.user(id);
    u.blocked = u.blocked.filter((b) => b !== targetId);
    this.save();
  }

  // The friends card: friends first, then people played with who aren't friends yet.
  view(id, isOnline = () => false) {
    const u = this.users.get(id) || { met: [], friends: [], in: [], out: [], blocked: [] };
    const person = (pid, extra = {}) => ({ id: pid, name: this.names.get(pid) || 'Player', avatar: !isGuest(pid), online: isOnline(pid), ...extra });
    const sent = new Set((u.out || []).map((r) => r.id));
    const asked = new Set((u.in || []).map((r) => r.id));
    return {
      invitesOn: !u.noInvites,
      pingsOn: !u.noPings,
      friends: u.friends.map((f) => person(f)),
      blocked: u.blocked || [],
      // requests waiting for your answer (shown in the inbox and on the Friends card)
      requests: (u.in || []).map((r) => person(r.id, { at: r.at })),
      // people played with: "sent" = you asked them, "asked" = they asked you
      met: u.met.filter((m) => !u.friends.includes(m.id)).map((m) => person(m.id, { at: m.at, ...(sent.has(m.id) ? { sent: true } : {}), ...(asked.has(m.id) ? { asked: true } : {}) })),
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

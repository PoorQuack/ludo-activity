// The inbox: what's new for a player. Two kinds of thing land here:
//  - personal notices ("Ann accepted your friend request"), kept per player, newest first;
//  - announcements from the game's owner, the same for everyone.
// Friend requests waiting for an answer are shown in the inbox too, but they live in the
// friends book (social.js), not here.
// Kept in data/inbox.json. Guests (browser testing) are kept in memory only.

import fs from 'node:fs';
import path from 'node:path';

const MAX_NOTES = 50; // per player
const MAX_NEWS = 30;
const NEWS_DAYS = 60; // older announcements drop out of the inbox
const TITLE_MAX = 80;
const BODY_MAX = 600;
const SAVE_DELAY_MS = 2000;

const isGuest = (id) => String(id).startsWith('guest-');
const clean = (s, max) => String(s || '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max);

export class Inbox {
  constructor(file, { now = Date.now } = {}) {
    this.file = file;
    this.now = now;
    this.notes = new Map(); // id -> [{ id, kind, from?, name?, at, read }]
    this.news = []; // [{ id, title, body, at }], newest first
    this.newsRead = new Map(); // id -> time they last opened the inbox
    this.seq = 0;
    this.saveTimer = null;
    if (file && fs.existsSync(file)) {
      try {
        const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const [id, list] of Object.entries(doc.notes || {})) this.notes.set(id, (list || []).filter((n) => n && n.id && n.kind).slice(0, MAX_NOTES));
        this.news = (doc.news || []).filter((n) => n && n.id && n.title).slice(0, MAX_NEWS);
        for (const [id, at] of Object.entries(doc.newsRead || {})) this.newsRead.set(id, Number(at) || 0);
        this.seq = Number(doc.seq) || 0;
      } catch (err) {
        const bad = `${file}.corrupt-${Date.now()}`;
        console.error(`Inbox file unreadable (${err.message}) — moved to ${bad}`);
        fs.renameSync(file, bad);
      }
    }
  }

  nextId(prefix) {
    this.seq += 1;
    return `${prefix}${this.now().toString(36)}${this.seq.toString(36)}`;
  }

  // A personal notice: { kind, from?, name? }
  add(userId, note) {
    const list = this.notes.get(userId) || [];
    list.unshift({ id: this.nextId('n'), at: this.now(), read: false, ...note });
    this.notes.set(userId, list.slice(0, MAX_NOTES));
    this.save();
  }

  // An announcement to everyone. Returns it.
  announce(title, body) {
    const t = clean(title, TITLE_MAX);
    const b = clean(body, BODY_MAX);
    if (!t) throw new Error('An announcement needs a title');
    const item = { id: this.nextId('a'), title: t, body: b, at: this.now() };
    this.news = [item, ...this.news].slice(0, MAX_NEWS);
    this.save();
    return item;
  }

  unannounce(id) {
    const before = this.news.length;
    this.news = this.news.filter((n) => n.id !== id);
    if (this.news.length !== before) this.save();
    return this.news.length !== before;
  }

  // Everything for this player, newest first, and how many they haven't seen
  view(userId) {
    const since = this.now() - NEWS_DAYS * 86_400_000;
    const readUpTo = this.newsRead.get(userId) || 0;
    const news = this.news.filter((n) => n.at >= since).map((n) => ({ ...n, kind: 'news', read: n.at <= readUpTo }));
    const notes = this.notes.get(userId) || [];
    const items = [...news, ...notes].sort((a, b) => b.at - a.at);
    return { items, unread: items.filter((i) => !i.read).length };
  }

  // They opened the inbox: everything in it is seen
  markRead(userId) {
    const list = this.notes.get(userId);
    let changed = false;
    if (list) for (const n of list) if (!n.read) (n.read = true), (changed = true);
    const t = this.now();
    if ((this.newsRead.get(userId) || 0) < t) {
      this.newsRead.set(userId, t);
      changed = true;
    }
    if (changed) this.save();
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
    const doc = { seq: this.seq, news: this.news, notes: {}, newsRead: {} };
    for (const [id, list] of this.notes) if (!isGuest(id) && list.length) doc.notes[id] = list;
    for (const [id, at] of this.newsRead) if (!isGuest(id)) doc.newsRead[id] = at;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc));
    fs.renameSync(tmp, this.file);
  }
}

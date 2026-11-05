// Daily quests. Every player gets three a day (UTC): one easy, one medium, one hard, picked
// from the pools below by player and day, so friends get different ones. Progress only counts
// in games against other people (like the leaderboards), and finishing a quest adds its points
// to the weekly and monthly leaderboards straight away; all three earns a bonus on top.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// `stat`: what the game reports (see Room.stat). ⚠ ids are saved in data/quests.json.
export const QUESTS = [
  { id: 'play3', tier: 1, stat: 'game', goal: 3, points: 20, title: 'Finish 3 games' },
  { id: 'six10', tier: 1, stat: 'six', goal: 10, points: 15, title: 'Roll 10 sixes' },
  { id: 'home3', tier: 1, stat: 'home', goal: 3, points: 10, title: 'Bring 3 tokens home' },
  { id: 'capture5', tier: 2, stat: 'capture', goal: 5, points: 25, title: 'Capture 5 tokens' },
  { id: 'home6', tier: 2, stat: 'home', goal: 6, points: 20, title: 'Bring 6 tokens home' },
  { id: 'top2x2', tier: 2, stat: 'top2', goal: 2, points: 25, title: 'Finish 1st or 2nd twice' },
  { id: 'win1', tier: 3, stat: 'win', goal: 1, points: 30, title: 'Win a game' },
  { id: 'win3', tier: 3, stat: 'win', goal: 3, points: 60, title: 'Win 3 games' },
  { id: 'capture12', tier: 3, stat: 'capture', goal: 12, points: 45, title: 'Capture 12 tokens' },
];
export const ALL_DONE_BONUS = 25;
const BY_ID = Object.fromEntries(QUESTS.map((q) => [q.id, q]));
const SAVE_DELAY_MS = 2000;

const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const nextMidnight = (t) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

// Today's three quests for a player: the same all day, different for each player and day.
export function pickQuests(userId, day) {
  return [1, 2, 3].map((tier) => {
    const pool = QUESTS.filter((q) => q.tier === tier);
    const h = createHash('sha256').update(`${userId}|${day}|${tier}`).digest();
    return pool[h.readUInt32BE(0) % pool.length].id;
  });
}

export class QuestBook {
  /**
   * @param {string|null} file  where progress is saved (null: memory only, for tests)
   * @param {object} options
   *  onPoints(userId, name, points): a quest (or the bonus) was completed
   */
  constructor(file, { now = Date.now, onPoints = () => {} } = {}) {
    this.file = file;
    this.now = now;
    this.onPoints = onPoints;
    this.day = dayKey(now());
    this.users = {}; // userId -> { picks, progress: { questId: n }, done: [questId], bonus }
    this.saveTimer = null;
    if (file) this.load();
  }

  // A new UTC day: everyone starts fresh.
  checkDay() {
    const day = dayKey(this.now());
    if (day === this.day) return;
    this.day = day;
    this.users = {};
    this.save();
  }

  entry(userId) {
    this.checkDay();
    return (this.users[userId] ||= { picks: pickQuests(userId, this.day), progress: {}, done: [], bonus: false });
  }

  // Something happened in a game against people. Returns what it completed:
  // [{ title, points }] (the all-three bonus is its own entry), so the player can be told.
  track(userId, name, stat, n = 1) {
    const u = this.entry(userId);
    const completed = [];
    let moved = false;
    for (const id of u.picks) {
      const q = BY_ID[id];
      if (!q || q.stat !== stat || u.done.includes(id)) continue;
      u.progress[id] = Math.min(q.goal, (u.progress[id] || 0) + n);
      moved = true;
      if (u.progress[id] >= q.goal) {
        u.done.push(id);
        completed.push({ title: q.title, points: q.points });
        this.onPoints(userId, name, q.points);
      }
    }
    if (!u.bonus && u.picks.every((id) => u.done.includes(id))) {
      u.bonus = true;
      completed.push({ title: 'All three daily quests', points: ALL_DONE_BONUS, bonus: true });
      this.onPoints(userId, name, ALL_DONE_BONUS);
    }
    if (moved) this.save();
    return { changed: moved, completed };
  }

  // What the player sees.
  view(userId) {
    const u = this.entry(userId);
    return {
      day: this.day,
      endsAt: nextMidnight(this.now()),
      quests: u.picks.map((id) => {
        const q = BY_ID[id];
        return { id, tier: q.tier, title: q.title, goal: q.goal, progress: u.progress[id] || 0, points: q.points, done: u.done.includes(id) };
      }),
      bonus: { points: ALL_DONE_BONUS, done: u.bonus },
    };
  }

  load() {
    for (const f of [this.file, `${this.file}.bak`]) {
      if (!fs.existsSync(f)) continue;
      try {
        const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (doc.day === this.day && doc.users && typeof doc.users === 'object') this.users = doc.users;
        return;
      } catch (err) {
        console.error(`Quest file ${f} is unreadable (${err.message})`);
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
    const users = Object.fromEntries(Object.entries(this.users).filter(([id]) => !id.startsWith('guest-')));
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, day: this.day, users }));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.renameSync(tmp, this.file);
  }
}

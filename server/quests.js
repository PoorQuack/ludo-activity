// Daily and weekly quests. Every player gets three a day (UTC) and three a week (from Monday,
// UTC): one easy, one medium, one hard, picked
// from the pools below by player and day, so friends get different ones. Progress only counts
// in games against other people (like the leaderboards). Finishing a quest pays its coins
// straight away, outside the daily earning cap; all three earns a bonus on top. Quests don't
// add leaderboard points: the leaderboards only count games.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { periodId } from './leaderboard.js';

// `stat`: what the game reports (see Room.stat): game (finished one), six, out (a token left
// base), home, capture, top2, win.
// `tier`: 1 easy, 2 medium, 3 hard. Every quest of a tier pays the same, so nobody's day is worth
// less than a friend's.
// ⚠ ids are saved in data/quests.json. To drop a quest, mark it `retired` instead of deleting it:
// it is no longer handed out, but anyone already on it can still finish it.
const DAILY_COINS = { 1: 15, 2: 25, 3: 50 };
const WEEKLY_COINS = { 1: 100, 2: 150, 3: 250 };
const pay = (table) => (q) => ({ ...q, coins: table[q.tier] });
export const QUESTS = [
  { id: 'play3', tier: 1, stat: 'game', goal: 3, title: 'Finish 3 games' },
  { id: 'six8', tier: 1, stat: 'six', goal: 8, title: 'Roll 8 sixes' },
  { id: 'out5', tier: 1, stat: 'out', goal: 5, title: 'Bring 5 tokens out of base' },
  { id: 'home3', tier: 1, stat: 'home', goal: 3, title: 'Bring 3 tokens home' },
  { id: 'play4', tier: 2, stat: 'game', goal: 4, title: 'Finish 4 games' },
  { id: 'capture5', tier: 2, stat: 'capture', goal: 5, title: 'Capture 5 tokens' },
  { id: 'home6', tier: 2, stat: 'home', goal: 6, title: 'Bring 6 tokens home' },
  { id: 'top2x2', tier: 2, stat: 'top2', goal: 2, title: 'Finish 1st or 2nd twice' },
  { id: 'win2', tier: 3, stat: 'win', goal: 2, title: 'Win 2 games' },
  { id: 'capture10', tier: 3, stat: 'capture', goal: 10, title: 'Capture 10 tokens' },
  { id: 'home10', tier: 3, stat: 'home', goal: 10, title: 'Bring 10 tokens home' },
  // no longer handed out
  { id: 'six10', tier: 1, stat: 'six', goal: 10, title: 'Roll 10 sixes', retired: true },
  { id: 'win1', tier: 3, stat: 'win', goal: 1, title: 'Win a game', retired: true },
  { id: 'win3', tier: 3, stat: 'win', goal: 3, title: 'Win 3 games', retired: true },
  { id: 'capture12', tier: 3, stat: 'capture', goal: 12, title: 'Capture 12 tokens', retired: true },
].map(pay(DAILY_COINS));
// Weekly: bigger goals, bigger pay. Same stats as the daily ones, so one game moves both.
export const WEEKLY_QUESTS = [
  { id: 'w-play12', tier: 1, stat: 'game', goal: 12, title: 'Finish 12 games' },
  { id: 'w-six40', tier: 1, stat: 'six', goal: 40, title: 'Roll 40 sixes' },
  { id: 'w-out30', tier: 1, stat: 'out', goal: 30, title: 'Bring 30 tokens out of base' },
  { id: 'w-home20', tier: 1, stat: 'home', goal: 20, title: 'Bring 20 tokens home' },
  { id: 'w-play20', tier: 2, stat: 'game', goal: 20, title: 'Finish 20 games' },
  { id: 'w-capture25', tier: 2, stat: 'capture', goal: 25, title: 'Capture 25 tokens' },
  { id: 'w-top2x8', tier: 2, stat: 'top2', goal: 8, title: 'Finish 1st or 2nd 8 times' },
  { id: 'w-home40', tier: 2, stat: 'home', goal: 40, title: 'Bring 40 tokens home' },
  { id: 'w-win5', tier: 3, stat: 'win', goal: 5, title: 'Win 5 games' },
  { id: 'w-capture50', tier: 3, stat: 'capture', goal: 50, title: 'Capture 50 tokens' },
  { id: 'w-top2x12', tier: 3, stat: 'top2', goal: 12, title: 'Finish 1st or 2nd 12 times' },
  { id: 'w-home60', tier: 3, stat: 'home', goal: 60, title: 'Bring 60 tokens home' },
  // no longer handed out
  { id: 'w-play15', tier: 1, stat: 'game', goal: 15, title: 'Finish 15 games', retired: true },
  { id: 'w-six50', tier: 1, stat: 'six', goal: 50, title: 'Roll 50 sixes', retired: true },
  { id: 'w-win10', tier: 3, stat: 'win', goal: 10, title: 'Win 10 games', retired: true },
].map(pay(WEEKLY_COINS));
export const ALL_DONE_BONUS = 25; // coins for finishing all three
export const WEEKLY_BONUS = 150; // coins for finishing all three weekly ones
const BY_ID = Object.fromEntries([...QUESTS, ...WEEKLY_QUESTS].map((q) => [q.id, q]));
const SAVE_DELAY_MS = 2000;

const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const nextMidnight = (t) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};
// The next Monday, 00:00 UTC
const nextMonday = (t) => {
  const d = new Date(t);
  const daysLeft = 7 - ((d.getUTCDay() + 6) % 7);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysLeft);
};
const PERIODS = {
  day: { key: dayKey, endsAt: nextMidnight, quests: QUESTS, bonus: ALL_DONE_BONUS, bonusTitle: 'All three daily quests' },
  week: { key: (t) => periodId('week', t), endsAt: nextMonday, quests: WEEKLY_QUESTS, bonus: WEEKLY_BONUS, bonusTitle: 'All three weekly quests' },
};

// Today's three quests for a player: the same all day, different for each player and day.
export function pickQuests(userId, day, quests = QUESTS) {
  return [1, 2, 3].map((tier) => {
    const pool = quests.filter((q) => q.tier === tier && !q.retired);
    const h = createHash('sha256').update(`${userId}|${day}|${tier}`).digest();
    return pool[h.readUInt32BE(0) % pool.length].id;
  });
}

export class QuestBook {
  /**
   * @param {string|null} file  where progress is saved (null: memory only, for tests)
   * @param {object} options
   *  onCoins(userId, name, coins): a quest (or the bonus) was completed: pay its coins
   *  period: 'day' (daily quests) or 'week' (weekly, from Monday)
   */
  constructor(file, { now = Date.now, onCoins = () => {}, period = 'day' } = {}) {
    this.file = file;
    this.now = now;
    this.onCoins = onCoins;
    this.period = PERIODS[period];
    this.kind = period;
    this.day = this.period.key(now()); // the current day, or week ("2026-W46")
    this.users = {}; // userId -> { picks, progress: { questId: n }, done: [questId], bonus }
    this.saveTimer = null;
    if (file) this.load();
  }

  // A new UTC day (or week): everyone starts fresh.
  checkDay() {
    const day = this.period.key(this.now());
    if (day === this.day) return;
    this.day = day;
    this.users = {};
    this.save();
  }

  entry(userId) {
    this.checkDay();
    return (this.users[userId] ||= { picks: pickQuests(userId, this.day, this.period.quests), progress: {}, done: [], bonus: false });
  }

  // Something happened in a game against people. Returns what it completed:
  // [{ title, coins }] (the all-three bonus is its own entry), so the player can be told.
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
        completed.push({ title: q.title, coins: q.coins, period: this.kind });
        this.onCoins(userId, name, q.coins);
      }
    }
    if (!u.bonus && u.picks.every((id) => u.done.includes(id))) {
      u.bonus = true;
      completed.push({ title: this.period.bonusTitle, coins: this.period.bonus, bonus: true });
      this.onCoins(userId, name, this.period.bonus);
    }
    if (moved) this.save();
    return { changed: moved, completed };
  }

  // What the player sees.
  view(userId) {
    const u = this.entry(userId);
    return {
      day: this.day,
      period: this.kind,
      endsAt: this.period.endsAt(this.now()),
      quests: u.picks.map((id) => {
        const q = BY_ID[id];
        return { id, tier: q.tier, stat: q.stat, title: q.title, goal: q.goal, progress: u.progress[id] || 0, coins: q.coins, done: u.done.includes(id) };
      }),
      bonus: { coins: this.period.bonus, done: u.bonus },
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

// Weekly and monthly leaderboards. Every game against at least one other person scores each
// player the coins it pays them before the daily cap (placement + captures). Games against
// bots only, and games everyone abandoned, score nothing. When a week (Monday 00:00 UTC) or a
// month ends, its top three win coin prizes, paid straight into their balance.
import fs from 'node:fs';
import path from 'node:path';

export const PRIZES = { week: [300, 200, 100], month: [1000, 600, 300] };
export const KINDS = ['week', 'month'];
const SAVE_DELAY_MS = 2000;
const TOP = 10;
const KEEP_AWARDS = 300;

// The period `t` falls in: '2026-W45' (ISO week, UTC) or '2026-11'.
export function periodId(kind, t) {
  const d = new Date(t);
  if (kind === 'month') return d.toISOString().slice(0, 7);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const week = 1 + Math.floor((thursday - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / (7 * 86_400_000));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// When the period containing `t` ends.
export function periodEnd(kind, t) {
  const d = new Date(t);
  if (kind === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 7);
}

export class Leaderboard {
  /**
   * @param {string|null} file  where it's saved (null: memory only, for tests)
   * @param {object} options
   *  profiles: the ProfileStore prizes are paid into
   *  onAward(userId): a prize was just paid to them (to tell them if they're online)
   */
  constructor(file, { profiles = null, now = Date.now, onAward = () => {} } = {}) {
    this.file = file;
    this.profiles = profiles;
    this.now = now;
    this.onAward = onAward;
    this.boards = { week: this.fresh('week'), month: this.fresh('month') };
    this.last = { week: null, month: null }; // the last finished period's podium
    this.awards = []; // { userId, kind, period, place, coins, paid, seen }
    this.saveTimer = null;
    if (file) this.load();
    this.payOwed();
    this.rollover();
  }

  fresh(kind) {
    return { id: periodId(kind, this.now()), scores: {} };
  }

  // One finished game: [{ userId, name, points, won }]. Guests aren't ranked.
  record(results) {
    this.rollover();
    const t = this.now();
    for (const r of results) {
      if (!r.userId || r.userId.startsWith('guest-') || !(r.points > 0)) continue;
      for (const kind of KINDS) {
        const s = (this.boards[kind].scores[r.userId] ||= { name: r.name, points: 0, wins: 0, games: 0, at: t });
        s.name = r.name;
        s.points += Math.round(r.points);
        s.wins += r.won ? 1 : 0;
        s.games += 1;
        s.at = t; // ties go to whoever got there first
      }
    }
    this.save();
  }

  // Ends any board whose week or month is over: pays its top three and starts a new one.
  // Called on every game and once a minute.
  rollover() {
    let ended = false;
    for (const kind of KINDS) {
      if (this.boards[kind].id === periodId(kind, this.now())) continue;
      const board = this.boards[kind];
      const podium = this.ranked(board).filter((e) => e.points > 0).slice(0, 3);
      podium.forEach((e, i) => {
        this.awards.push({ userId: e.userId, kind, period: board.id, place: i + 1, coins: PRIZES[kind][i], paid: false, seen: false });
      });
      this.last[kind] = {
        period: board.id,
        podium: podium.map((e, i) => ({ name: e.name, points: e.points, place: i + 1, coins: PRIZES[kind][i] })),
      };
      this.boards[kind] = this.fresh(kind);
      ended = true;
    }
    if (!ended) return;
    // Written down (as owed) before paying, so a crash can't lose or double a prize
    if (this.awards.length > KEEP_AWARDS) this.awards = this.awards.slice(-KEEP_AWARDS);
    this.flush();
    this.payOwed();
  }

  payOwed() {
    const owed = this.awards.filter((a) => !a.paid);
    if (!owed.length) return;
    for (const a of owed) this.profiles?.grantPrize(a.userId, a.coins);
    this.profiles?.flush();
    for (const a of owed) a.paid = true;
    this.flush();
    for (const a of owed) this.onAward(a.userId);
  }

  ranked(board) {
    return Object.entries(board.scores)
      .map(([userId, s]) => ({ userId, ...s }))
      .sort((a, b) => b.points - a.points || b.wins - a.wins || a.at - b.at);
  }

  // What one player sees: both boards' top 10, their own place, prizes, time left, last winners.
  view(userId) {
    this.rollover();
    const out = {};
    for (const kind of KINDS) {
      const ranked = this.ranked(this.boards[kind]);
      const mine = ranked.findIndex((e) => e.userId === userId);
      out[kind] = {
        period: this.boards[kind].id,
        endsAt: periodEnd(kind, this.now()),
        prizes: PRIZES[kind],
        top: ranked.slice(0, TOP).map((e, i) => ({ rank: i + 1, name: e.name, points: e.points, wins: e.wins, games: e.games, you: e.userId === userId })),
        me: mine >= 0 ? { rank: mine + 1, points: ranked[mine].points, wins: ranked[mine].wins, games: ranked[mine].games } : null,
        players: ranked.length,
        last: this.last[kind],
      };
    }
    return out;
  }

  // Prizes this player hasn't been told about yet (each is only returned once).
  takeAwards(userId) {
    const mine = this.awards.filter((a) => a.userId === userId && a.paid && !a.seen);
    if (!mine.length) return [];
    for (const a of mine) a.seen = true;
    this.save();
    return mine.map(({ kind, period, place, coins }) => ({ kind, period, place, coins }));
  }

  load() {
    for (const f of [this.file, `${this.file}.bak`]) {
      if (!fs.existsSync(f)) continue;
      try {
        const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
        for (const kind of KINDS) {
          if (doc.boards?.[kind]?.id && doc.boards[kind].scores) this.boards[kind] = doc.boards[kind];
          if (doc.last?.[kind]) this.last[kind] = doc.last[kind];
        }
        if (Array.isArray(doc.awards)) this.awards = doc.awards;
        return;
      } catch (err) {
        console.error(`Leaderboard file ${f} is unreadable (${err.message})`);
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
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, boards: this.boards, last: this.last, awards: this.awards }));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.renameSync(tmp, this.file);
  }
}

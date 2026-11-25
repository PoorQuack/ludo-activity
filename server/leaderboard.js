// Weekly, monthly and all-time leaderboards, ranked like poker chip counts: only PUBLIC stakes
// games score, and each player scores what they won minus their stake (+1500 for taking a
// four-player 500 pot, -500 for losing one). Bots, private rooms, games without a stake and
// anything bought in the shop never count (gems never turn into coins). To stop two accounts
// feeding each other, a player's game only counts while they've played fewer than
// MAX_VS_SAME games that UTC day against at least one of the people in it.
// When a week (Monday 00:00 UTC) or a month ends, its top three win coin prizes, paid straight
// into their balance. The all-time board never resets and has no prizes.
import fs from 'node:fs';
import path from 'node:path';

export const PRIZES = { week: [300, 200, 100], month: [1000, 600, 300] };
export const KINDS = ['week', 'month'];
// Keep the November 2026 v1 points leaderboard intact until December 1, 00:00 UTC, so November's
// weekly & monthly winners are paid out on the old system before stakes scoring takes over.
export const STAKES_FROM = Date.UTC(2026, 11, 1);
const SAVE_DELAY_MS = 2000;
const TOP = 10;
const KEEP_AWARDS = 300;
export const MAX_VS_SAME = 3; // counted games a day against the same person

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
  constructor(file, { profiles = null, now = Date.now, onAward = () => {}, rankGuests = false, stakesAt = STAKES_FROM } = {}) {
    this.rankGuests = rankGuests; // a local test copy (browser guests only): guests are ranked too
    this.file = file;
    this.profiles = profiles;
    this.now = now;
    this.onAward = onAward;
    this.stakesAt = stakesAt;
    this.version = this.isStakes() ? 2 : 1;
    this.boards = { week: this.fresh('week'), month: this.fresh('month') };
    this.allTime = null; // { since, scores }: set by load(), or started below
    this.vs = { day: '', counts: {} }; // today's counted games per pair of players ('a|b' -> n)
    this.last = { week: null, month: null }; // the last finished period's podium
    this.awards = []; // { userId, kind, period, place, coins, paid, seen }
    this.saveTimer = null;
    if (file) this.load();
    this.allTime ||= { since: this.isStakes() ? this.boards.month.id : periodId('month', this.stakesAt), scores: {} };
    this.payOwed();
    this.rollover();
  }

  isStakes(t = this.now()) {
    return t >= this.stakesAt;
  }

  fresh(kind) {
    return { id: periodId(kind, this.now()), scores: {} };
  }

  // How many counted games `a` and `b` have played against each other today
  pairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  // One finished game: [{ userId, name, points, placePoints?, won, opponents }].
  // Until `stakesAt` (Dec 2026), scores v1 placement points (`placePoints ?? points`); from
  // `stakesAt` onward, scores v2 public stakes chips (`points`) with the daily per-pair cap.
  record(results) {
    this.rollover();
    const t = this.now();
    const guest = (id) => !this.rankGuests && id.startsWith('guest-');
    if (!this.isStakes(t)) {
      let any = false;
      for (const r of results) {
        const pts = Math.round(r.placePoints ?? r.points ?? 0);
        if (!r.userId || guest(r.userId) || !(pts > 0)) continue;
        any = true;
        for (const kind of KINDS) {
          const s = (this.boards[kind].scores[r.userId] ||= { name: r.name, points: 0, wins: 0, games: 0, at: t });
          s.name = r.name;
          s.points += pts;
          s.wins += r.won ? 1 : 0;
          s.games += 1;
          s.at = t;
        }
      }
      if (any) this.save();
      return;
    }
    const day = new Date(t).toISOString().slice(0, 10);
    if (this.vs.day !== day) this.vs = { day, counts: {} };
    const counted = results.filter((r) => {
      if (!r.userId || guest(r.userId) || !Number.isFinite(r.points) || r.points === 0) return false;
      const opp = (r.opponents || []).filter((o) => !guest(o));
      if (!opp.length) return false;
      return opp.some((o) => (this.vs.counts[this.pairKey(r.userId, o)] || 0) < MAX_VS_SAME);
    });
    // the pairs that played: one more counted game each
    const pairs = new Set();
    for (const r of counted) for (const o of r.opponents) pairs.add(this.pairKey(r.userId, o));
    for (const k of pairs) this.vs.counts[k] = (this.vs.counts[k] || 0) + 1;
    for (const r of counted) {
      for (const kind of KINDS) {
        const s = (this.boards[kind].scores[r.userId] ||= { name: r.name, points: 0, wins: 0, games: 0, at: t });
        s.name = r.name;
        s.points += Math.round(r.points);
        s.wins += r.won ? 1 : 0;
        s.games += 1;
        s.at = t; // ties go to whoever got there first
      }
      const a = (this.allTime.scores[r.userId] ||= { name: r.name, points: 0, wins: 0, games: 0, at: t });
      // (a board only shows players who've scored: see ranked())
      a.name = r.name;
      a.points += Math.round(r.points);
      a.wins += r.won ? 1 : 0;
      a.games += 1;
      a.at = t;
    }
    this.save();
  }

  // Ends any board whose week or month is over: pays its top three and starts a new one.
  // When crossing `stakesAt`, pays the ended v1 month first, then upgrades to v2 stakes boards.
  // Called on every game and once a minute.
  rollover() {
    let ended = false;
    const t = this.now();
    for (const kind of KINDS) {
      if (this.boards[kind].id === periodId(kind, t)) continue;
      const board = this.boards[kind];
      const podium = this.ranked(board).filter((e) => e.points > 0).slice(0, 3); // (nobody in the red wins a prize)
      podium.forEach((e, i) => {
        this.awards.push({ userId: e.userId, kind, period: board.id, place: i + 1, coins: PRIZES[kind][i], paid: false, seen: false });
      });
      this.last[kind] = {
        period: board.id,
        ...(this.version < 2 ? { unit: 'pts' } : {}),
        podium: podium.map((e, i) => ({ name: e.name, points: e.points, place: i + 1, coins: PRIZES[kind][i] })),
      };
      this.boards[kind] = this.fresh(kind);
      ended = true;
    }
    if (this.isStakes(t) && this.version < 2) {
      this.version = 2;
      // Start both week & month cleanly on stakes (clears any overlap days in the transition week)
      this.boards = { week: this.fresh('week'), month: this.fresh('month') };
      this.allTime = { since: this.boards.month.id, scores: {} };
      this.vs = { day: '', counts: {} };
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
    for (const a of owed) {
      this.profiles?.grantPrize(a.userId, a.coins);
      this.profiles?.grantItem?.(a.userId, `frame-rank-${a.place}`); // and the place's frame, to keep
    }
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
    const mode = this.isStakes() ? 'stakes' : 'points';
    const out = {};
    for (const kind of KINDS) {
      const ranked = this.ranked(this.boards[kind]);
      const mine = ranked.findIndex((e) => e.userId === userId);
      out[kind] = {
        mode,
        period: this.boards[kind].id,
        endsAt: periodEnd(kind, this.now()),
        prizes: PRIZES[kind],
        top: ranked.slice(0, TOP).map((e, i) => ({ rank: i + 1, name: e.name, points: e.points, wins: e.wins, games: e.games, you: e.userId === userId })),
        me: mine >= 0 ? { rank: mine + 1, points: ranked[mine].points, wins: ranked[mine].wins, games: ranked[mine].games } : null,
        players: ranked.length,
        last: this.last[kind],
      };
    }
    const ranked = this.ranked(this.allTime);
    const mine = ranked.findIndex((e) => e.userId === userId);
    out.all = {
      mode: 'stakes',
      ...(mode === 'points' ? { startsAt: this.stakesAt } : {}),
      since: this.allTime.since,
      top: ranked.slice(0, TOP).map((e, i) => ({ rank: i + 1, name: e.name, points: e.points, wins: e.wins, games: e.games, you: e.userId === userId })),
      me: mine >= 0 ? { rank: mine + 1, points: ranked[mine].points, wins: ranked[mine].wins, games: ranked[mine].games } : null,
      players: ranked.length,
    };
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
        const docVersion = doc.version || 1;
        const stakesNow = this.isStakes();
        this.version = stakesNow && docVersion >= 2 ? docVersion : Math.min(docVersion, 1);
        if (!stakesNow) {
          for (const kind of KINDS) {
            if (doc.boards?.[kind]?.id && doc.boards[kind].scores) this.boards[kind] = doc.boards[kind];
            if (doc.last?.[kind]) this.last[kind] = doc.last[kind];
          }
          if (Array.isArray(doc.awards)) this.awards = doc.awards;
          return;
        }
        // In stakes mode: a v2 file loads in full; a v1 file only keeps any *ended* board
        // (e.g. November if the server was offline across Dec 1) so rollover() pays it first.
        const fresh = docVersion < 2;
        for (const kind of KINDS) {
          const b = doc.boards?.[kind];
          if (b?.id && b.scores && (!fresh || b.id !== periodId(kind, this.now()))) this.boards[kind] = b;
          if (doc.last?.[kind]) this.last[kind] = doc.last[kind];
        }
        if (Array.isArray(doc.awards)) this.awards = doc.awards;
        if (!fresh && doc.allTime?.scores) this.allTime = doc.allTime;
        if (doc.vs?.counts) this.vs = doc.vs;
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
    fs.writeFileSync(tmp, JSON.stringify({ version: this.version, boards: this.boards, last: this.last, awards: this.awards, allTime: this.allTime, vs: this.vs }));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.renameSync(tmp, this.file);
  }
}

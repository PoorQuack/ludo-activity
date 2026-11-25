// Player profiles (Gold Coins, VIP Gems and shop items), kept in memory and saved to a JSON file.
// Guests (plain-browser testing) are never written to disk.
import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { BADGES, BADGES_BY_ID, BADGE_STATS, LEVELS, MAX_PINS, badgeValue, levelFor } from '../shared/badges.js';
import { PASS_TIERS, PASS_XP, passRewards, seasonMonth, seasonEnd, tierFor, XP_PER_TIER } from '../shared/pass.js';
import { FIRST_PACK_BONUS, ITEMS, STARTING_COINS, DEFAULT_EQUIPPED, DAILY_COIN_CAP, ownsItem, SETS_BY_ID, setPrice, priceOf, currencyOf, inShop } from '../shared/shop.js';

const SAVE_DELAY_MS = 1000;
// The daily chest: a d20, 5 coins a pip
export const DAILY_DIE = 20;
export const DAILY_PER_PIP = 5;
export const STREAK_DAYS = 7; // roll 7 days in a row: day 7 pays double

// Referrals: invite someone new and you get this many coins once they've finished their first game
export const REFERRAL_COINS = 50;

export const CURRENT_VERSION = 3;

// Ordered list: MIGRATIONS[v - 1] upgrades a whole parsed save document from
// version v to version v + 1. To change the format, bump CURRENT_VERSION and
// append one function — old files then upgrade in order.
// v1 -> v2: the save file gained its { version, profiles } wrapper; the data didn't change.
// v2 -> v3: two currencies. Every profile gains `gems` (VIP Gems, bought with real money), starting
//   at 0; `coins` (Gold Coins) are unchanged.
const MIGRATIONS = [
  (v1) => ({ version: 2, profiles: v1 }),
  (v2) => ({
    version: 3,
    profiles: Object.fromEntries(Object.entries(v2.profiles || {}).map(([id, p]) => [id, { ...p, gems: Number.isFinite(p?.gems) ? p.gems : 0 }])),
  }),
];

export class ProfileStore {
  constructor(file, { onChange, onBadge, freeShop = false, now = Date.now } = {}) {
    this.file = file;
    this.onChange = onChange || (() => {});
    this.onBadge = onBadge || (() => {}); // (id, [{ badge, level, coins }]) when badge levels are reached
    this.freeShop = freeShop; // testing: everything costs 0
    this.now = now;
    this.profiles = new Map();
    this.saveTimer = null;
    if (file) this.load();
  }

  load() {
    const bak = `${this.file}.bak`;
    if (fs.existsSync(this.file)) {
      try {
        return this.applySave(fs.readFileSync(this.file, 'utf8'));
      } catch (err) {
        if (err.code === 'SAVE_TOO_NEW') throw err;
        // Never overwrite data we couldn't read: park the bad file and fall back to .bak.
        const corrupt = `${this.file}.corrupt-${Date.now()}`;
        console.error(`Profile file ${this.file} is unreadable (${err.message}) — moving it to ${corrupt}`);
        fs.renameSync(this.file, corrupt);
        if (fs.existsSync(bak)) {
          try {
            return this.applySave(fs.readFileSync(bak, 'utf8'));
          } catch (bakErr) {
            throw new Error(`Profile file is corrupt and the backup is unreadable too: ${bakErr.message}`);
          }
        }
        throw new Error('Profile file is corrupt and no .bak backup exists — refusing to start with empty data');
      }
    }
    if (fs.existsSync(bak)) {
      try {
        return this.applySave(fs.readFileSync(bak, 'utf8'));
      } catch (err) {
        throw new Error(`Only a profile backup exists and it is unreadable: ${err.message}`);
      }
    }
    // No save and no backup: a fresh start.
  }

  applySave(text) {
    const doc = migrate(JSON.parse(text));
    for (const [id, p] of Object.entries(doc.profiles)) this.profiles.set(id, normalize(p));
  }

  // Returns the profile, creating it on a player's first visit.
  get(id) {
    let p = this.profiles.get(id);
    if (!p) {
      p = normalize({});
      this.profiles.set(id, p);
      this.save();
    }
    return p;
  }

  peek(id) {
    return this.profiles.get(id) || null;
  }

  // The profile as the client should see it: owned items that no longer exist
  // in the shop are kept in the save file but hidden here.
  view(id) {
    const p = this.profiles.get(id);
    if (!p) return null;
    const { invite, daily, streak, ref, bought, pass, passUntil, packs, ...rest } = p; // the server-invite answer isn't the client's business
    return {
      ...rest,
      pass: this.passView(p),
      owned: p.owned.filter((itemId) => ITEMS[itemId]),
      dailyReady: daily !== this.dayKey(),
      streakDay: this.streakDay(p), // today's place in the 7-day strip (1–7)
      dailyNext: Date.parse(`${this.dayKey()}T00:00:00Z`) + 86_400_000, // next UTC midnight
      referrals: { count: ref.count, coins: ref.count * REFERRAL_COINS, per: REFERRAL_COINS },
      firstPack: !packs, // their first gem pack gives double gems
    };
  }

  // Where today sits in the 7-day streak: rolled today -> that day; rolled yesterday -> the next
  // day (after day 7, day 1 again); a missed day starts over at day 1.
  streakDay(p) {
    const today = this.dayKey();
    if (p.daily === today) return p.streak || 1;
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    return p.daily === yesterday ? (p.streak % STREAK_DAYS) + 1 : 1;
  }

  // The daily chest: a d20 once a UTC day, DAILY_PER_PIP coins per pip (5–100), doubled on day 7
  // of a streak. Paid outside the daily earning cap. Returns { roll, coins, day, doubled }.
  rollDaily(id, rng = () => randomInt(1, DAILY_DIE + 1)) {
    const p = this.get(id);
    if (p.daily === this.dayKey()) throw new Error('Already rolled today: come back after midnight UTC');
    const day = this.streakDay(p);
    const roll = rng();
    const doubled = day === STREAK_DAYS;
    const coins = roll * DAILY_PER_PIP * (doubled ? 2 : 1);
    p.daily = this.dayKey();
    p.streak = day;
    p.coins += coins;
    if (doubled) p.stats.week = (p.stats.week || 0) + 1; // a whole 7-day streak (the Regular badge)
    this.changed(id);
    this.checkBadges(id);
    return { roll, coins, day, doubled };
  }

  // Should this player be asked to join the Discord server now?
  wantsInvite(id) {
    const p = this.get(id);
    return !p.invite.status && this.now() >= p.invite.until;
  }

  // answer: 'join' (opened the invite), 'never' (ticked "Don't ask again"), 'later' (plain "No thanks": a week)
  answerInvite(id, answer, snoozeMs) {
    const p = this.get(id);
    if (answer === 'join') p.invite = { status: 'joined', until: 0 };
    else if (answer === 'never') p.invite = { status: 'never', until: 0 };
    else if (answer === 'later') p.invite = { status: '', until: this.now() + snoozeMs };
    else return;
    this.save();
  }

  // Grants up to what's left under the daily earning cap and returns the granted amount.
  addCoins(id, coins) {
    const p = this.get(id);
    const day = this.dayKey();
    if (p.earned.day !== day) p.earned = { day, coins: 0 };
    const granted = Math.max(0, Math.min(coins, DAILY_COIN_CAP - p.earned.coins));
    p.coins += granted;
    p.earned.coins += granted;
    this.changed(id);
    return granted;
  }

  // A brand-new player came in through someone's invite: remember who, to pay them later.
  // Only real Discord accounts on both sides, an inviter who has played before, never yourself.
  setReferrer(id, by) {
    const p = this.profiles.get(id);
    by = String(by || '');
    if (!p || p.ref.by || !/^\d{5,25}$/.test(by) || by === id || id.startsWith('guest-') || !this.profiles.has(by)) return false;
    p.ref.by = by;
    this.changed(id);
    return true;
  }

  // A player finished a game. If it's the first since someone invited them, that someone gets
  // REFERRAL_COINS (outside the daily cap). Returns { to, coins } when a payout was made.
  gameFinished(id) {
    const p = this.profiles.get(id);
    if (!p?.ref.by || p.ref.paid) return null;
    p.ref.paid = true;
    this.changed(id);
    const inviter = this.profiles.get(p.ref.by);
    if (!inviter) return null;
    inviter.coins += REFERRAL_COINS;
    inviter.ref.count += 1;
    this.changed(p.ref.by);
    return { to: p.ref.by, coins: REFERRAL_COINS };
  }

  // A real-money purchase (a Discord entitlement): pays its gems once. Real money only ever buys
  // VIP Gems, never Gold Coins. The entitlement id is kept so the same purchase can never pay
  // twice. Returns whether it paid now.
  // A real-money purchase (Discord entitlement or Stripe payment `key`, paid once): gem packs
  // (a player's first one gives FIRST_PACK_BONUS times the gems), the Starter Pack (gems, coins
  // and its exclusive item), or a tip. Returns what was given, or null when `key` was paid before.
  grantPaid(id, key, item) {
    const p = this.get(id);
    if (p.bought.includes(key)) return null;
    p.bought.push(key);
    const given = { id: item.id, kind: item.kind, gems: 0 };
    if (item.kind === 'gems') {
      given.gems = item.gems * (p.packs ? 1 : FIRST_PACK_BONUS);
      if (!p.packs) {
        given.first = true;
        p.bought.push(`${key}:x${FIRST_PACK_BONUS}`); // so a refund takes the doubled amount back
      }
      p.packs += 1;
    } else if (item.kind === 'starter') {
      given.gems = item.gems;
      if (!p.starter) {
        p.starter = true;
        given.coins = item.coins;
        p.coins += item.coins;
        if (!p.owned.includes(item.item)) {
          p.owned.push(item.item);
          given.item = item.item;
        }
      }
    }
    p.gems += given.gems;
    this.changed(id);
    this.flush(); // money: write it now
    return given;
  }

  grantPurchase(id, entitlementId, gems) {
    const p = this.get(id);
    if (p.bought.includes(entitlementId)) return false;
    p.bought.push(entitlementId);
    p.gems += gems;
    this.changed(id);
    this.flush(); // money: write it now, not in a second
    return true;
  }

  // Refund / chargeback clawback: idempotent via `revokeId` in `p.bought`. Deducts Die Gems first,
  // then removes recently bought gem-priced shop items (and unequips them) to cover any shortfall.
  revokePurchase(id, revokeId, gems) {
    const p = this.get(id);
    if (p.bought.includes(revokeId)) return { revoked: false, removedItems: [] };
    p.bought.push(revokeId);
    const removedItems = [];
    let deficit = Math.max(0, Math.floor(gems || 0));
    const fromBal = Math.min(p.gems, deficit);
    p.gems -= fromBal;
    deficit -= fromBal;
    if (deficit > 0) {
      for (let i = p.owned.length - 1; i >= 0 && deficit > 0; i--) {
        const itemId = p.owned[i];
        const item = ITEMS[itemId];
        if (!item || item.award || item.pass || currencyOf(item) !== 'gems' || !(item.price > 0)) continue;
        p.owned.splice(i, 1);
        removedItems.push(itemId);
        if (p.equipped[item.type] === itemId) p.equipped[item.type] = DEFAULT_EQUIPPED[item.type];
        deficit -= item.price;
      }
      if (deficit < 0) {
        p.gems += -deficit; // give back change if a removed item cost more than the refunded pack
        deficit = 0;
      }
    }
    this.changed(id);
    this.flush();
    return { revoked: true, removedItems, remainingDeficit: deficit };
  }

  // An item won (the leaderboard's rank frames): owned from now on, put on if nothing else is
  grantItem(id, itemId) {
    const item = ITEMS[itemId];
    if (!item || id.startsWith('guest-')) return false;
    const p = this.get(id);
    if (p.owned.includes(itemId)) return false;
    p.owned.push(itemId);
    if (item.type === 'frame' && (!p.equipped.frame || p.equipped.frame === 'frame-none')) p.equipped.frame = itemId;
    this.changed(id);
    return true;
  }

  // Leaderboard prizes: paid in full, outside the daily earning cap.
  grantPrize(id, coins) {
    if (id.startsWith('guest-')) return 0;
    const p = this.get(id);
    p.coins += coins;
    this.changed(id);
    return coins;
  }

  // Daily quest rewards: paid in full, outside the daily earning cap (guests too, for testing).
  rewardCoins(id, coins) {
    const p = this.get(id);
    p.coins += coins;
    this.changed(id);
    return coins;
  }

  // Admin: add (or, with a negative amount, take away) coins. Never below 0. Returns the new balance.
  adminCoins(id, amount) {
    const p = this.get(id);
    p.coins = Math.max(0, p.coins + amount);
    this.changed(id);
    return p.coins;
  }

  // Admin: the same for gems. Never below 0. Returns the new balance.
  adminGems(id, amount) {
    const p = this.get(id);
    p.gems = Math.max(0, p.gems + amount);
    this.changed(id);
    return p.gems;
  }

  // ---------- stakes rooms (server/room.js) ----------
  // Entry fees are Gold Coins only (never gems), and they skip the daily earning cap both ways:
  // it's the players' own coins going into the pot and coming back out of it.

  // Can this player put `coins` into a pot?
  canStake(id, coins) {
    return (this.peek(id)?.coins ?? STARTING_COINS) >= coins;
  }

  // Takes a stake (the caller checked it can be paid). Returns what was taken.
  takeStake(id, coins) {
    const p = this.get(id);
    if (p.coins < coins) throw new Error('Not enough coins for the stake');
    p.coins -= coins;
    this.changed(id);
    return coins;
  }

  // Pays winnings (or a refund) out of a pot
  payStake(id, coins) {
    if (!(coins > 0)) return 0;
    const p = this.get(id);
    p.coins += coins;
    this.changed(id);
    return coins;
  }

  // Takes `price` of `currency` from a profile, or says which one is short
  charge(p, currency, price) {
    if (this.freeShop) return; // testing: everything (coins and gems) is free
    if (p[currency] < price) throw new Error(currency === 'gems' ? 'Not enough gems' : 'Not enough coins');
    p[currency] -= price;
  }

  dayKey() {
    return new Date(this.now()).toISOString().slice(0, 10); // the UTC day, 'YYYY-MM-DD'
  }

  // ---------- the Battle Pass (shared/pass.js) ----------

  // Holding the pass: a Discord subscription running (or FREE_SHOP, for testing)
  passActive(p) {
    return this.freeShop || (p?.passUntil || 0) > this.now();
  }

  // This month's track: a new month starts a new one (XP and claims go back to nothing)
  passTrack(p) {
    const month = seasonMonth(this.now());
    if (p.pass.month !== month) p.pass = { month, xp: 0, free: [], premium: [], login: p.pass.login };
    return p.pass;
  }

  /** Adds XP; returns { xp, tier, before } (before: the tier they were on). */
  addPassXp(id, n) {
    const p = this.get(id);
    const track = this.passTrack(p);
    const before = tierFor(track.xp);
    track.xp = Math.min(track.xp + n, PASS_TIERS * XP_PER_TIER);
    this.changed(id);
    return { xp: track.xp, tier: tierFor(track.xp), before };
  }

  /** The first visit of each UTC day gives login XP. Returns the addPassXp result, or null. */
  passLogin(id) {
    const p = this.get(id);
    const today = this.dayKey();
    this.passTrack(p);
    if (p.pass.login === today) return null;
    p.pass.login = today;
    return this.addPassXp(id, PASS_XP.login);
  }

  // Discord says their subscription runs until `until` (ms)
  setPassUntil(id, until) {
    const p = this.get(id);
    if (p.passUntil === until) return false;
    p.passUntil = until;
    this.changed(id);
    this.flush();
    return true;
  }

  /** Claims one tier's reward in one lane ('free' or 'premium'). Returns what was given. */
  claimPass(id, lane, tier) {
    if (lane !== 'free' && lane !== 'premium') throw new Error('Unknown lane');
    const p = this.get(id);
    const track = this.passTrack(p);
    if (!Number.isInteger(tier) || tier < 1 || tier > PASS_TIERS) throw new Error('Unknown tier');
    if (tier > tierFor(track.xp)) throw new Error('Reach that tier first');
    if (lane === 'premium' && !this.passActive(p)) throw new Error('That reward is for Battle Pass holders');
    if (track[lane].includes(tier)) throw new Error('Already claimed');
    const reward = passRewards(track.month).tiers[tier - 1][lane];
    const given = this.givePassReward(id, p, reward);
    track[lane].push(tier);
    this.changed(id);
    this.flush(); // gems and exclusive items: written now
    return given;
  }

  /** Claims everything reached and not claimed yet, in both lanes (premium only for holders). */
  claimAllPass(id) {
    const p = this.get(id);
    const track = this.passTrack(p);
    const reached = tierFor(track.xp);
    const out = [];
    for (const lane of ['free', 'premium']) {
      if (lane === 'premium' && !this.passActive(p)) continue;
      for (let t = 1; t <= reached; t++) if (!track[lane].includes(t)) out.push({ lane, tier: t, ...this.claimPass(id, lane, t) });
    }
    return out;
  }

  // Coins (outside the daily earning cap: the pass is played for), gems, or an item. An item they
  // already have turns into 50 gems instead, so nothing is wasted.
  givePassReward(id, p, reward) {
    if (reward.coins) {
      p.coins += reward.coins;
      return { coins: reward.coins };
    }
    if (reward.gems) {
      p.gems += reward.gems;
      return { gems: reward.gems };
    }
    if (reward.item) {
      if (p.owned.includes(reward.item)) {
        p.gems += 50;
        return { gems: 50, had: reward.item };
      }
      p.owned.push(reward.item);
      return { item: reward.item };
    }
    return {};
  }

  // What the client shows for the pass
  passView(p) {
    const track = p.pass.month === seasonMonth(this.now()) ? p.pass : { month: seasonMonth(this.now()), xp: 0, free: [], premium: [] };
    return { month: track.month, xp: track.xp, tier: tierFor(track.xp), free: track.free, premium: track.premium, active: this.passActive(p), until: p.passUntil || 0, endsAt: seasonEnd(this.now()) };
  }

  buy(id, itemId) {
    const item = ITEMS[itemId];
    if (!item) throw new Error('Unknown item');
    const p = this.get(id);
    if (ownsItem(p, itemId)) throw new Error('You already own that');
    if (item.award) throw new Error("That can't be bought: it's won on the leaderboard");
    if (!inShop(item, this.dayKey())) throw new Error("That isn't in the shop right now");
    this.charge(p, currencyOf(item), priceOf(item, this.dayKey())); // (today's deals are 30% off)
    p.owned.push(itemId);
    if (!['emote', 'emote-pack'].includes(item.type)) p.equipped[item.type] = itemId;
    this.changed(id);
    this.checkBadges(id); // (Collector)
  }

  // A gift: `id` pays today's price and `toId` gets the item (not put on: that's theirs to do).
  // Free items and things they already own can't be given.
  gift(id, toId, itemId) {
    const item = ITEMS[itemId];
    if (!item || !item.price || item.award) throw new Error('Unknown item');
    if (!inShop(item, this.dayKey())) throw new Error("That isn't in the shop right now");
    if (!toId || toId === id) throw new Error("You can't gift that to yourself");
    const to = this.get(toId);
    if (ownsItem(to, itemId)) throw new Error('They already own that');
    const p = this.get(id);
    this.charge(p, currencyOf(item), priceOf(item, this.dayKey()));
    to.owned.push(itemId);
    p.stats.gift = (p.stats.gift || 0) + 1;
    this.changed(id);
    this.changed(toId);
    this.checkBadges(id);
    this.checkBadges(toId);
  }

  // A whole set: the missing items at 10% off, and the whole look put on.
  buySet(id, setId) {
    const set = SETS_BY_ID[setId];
    if (!set) throw new Error('Unknown item');
    const p = this.get(id);
    const { price, missing, currency } = setPrice(set, p);
    if (!missing.every((m) => inShop(ITEMS[m], this.dayKey()))) throw new Error("That isn't in the shop right now");
    if (!missing.length) throw new Error('You already own that');
    this.charge(p, currency, price);
    p.owned.push(...missing);
    for (const itemId of set.items) p.equipped[ITEMS[itemId].type] = itemId;
    this.changed(id);
    this.checkBadges(id);
  }

  equip(id, itemId) {
    const item = ITEMS[itemId];
    if (!item || ['emote', 'emote-pack'].includes(item.type)) throw new Error("That can't be equipped");
    const p = this.get(id);
    if (!ownsItem(p, itemId)) throw new Error("You don't own that yet");
    p.equipped[item.type] = itemId;
    this.changed(id);
  }

  // Record every finished non-rigged game (both against people and against bots) for player profile totals.
  recordGame(id, { won = false, vsBotsOnly = false, captures = 0, sixes = 0 } = {}) {
    if (!id || String(id).startsWith('guest-')) return;
    const p = this.peek(id);
    if (!p) return;
    p.played.games += 1;
    if (won) p.played.wins += 1;
    if (vsBotsOnly) {
      p.played.botGames += 1;
      if (won) p.played.botWins += 1;
      p.played.botCaptures += Math.max(0, Number(captures) || 0);
      p.played.botSixes += Math.max(0, Number(sixes) || 0);
    }
    this.changed(id);
  }

  // ---------- badges (shared/badges.js) ----------

  // A stat from a game against people (captures, wins…): lifetime totals for the badges
  addStat(id, stat, n = 1) {
    if (!BADGE_STATS.includes(stat) || !(n > 0)) return [];
    const p = this.get(id);
    p.stats[stat] = (p.stats[stat] || 0) + n;
    this.changed(id);
    return this.checkBadges(id);
  }

  // Pays for any badge levels newly reached (each level once, ever) and says so
  checkBadges(id) {
    const p = this.get(id);
    const reached = [];
    for (const b of BADGES) {
      const level = levelFor(b, badgeValue(b, p));
      for (let l = (p.badges[b.id] || 0) + 1; l <= level; l++) reached.push({ badge: b.id, level: l, coins: LEVELS[l - 1].coins });
      if (level > (p.badges[b.id] || 0)) p.badges[b.id] = level;
    }
    if (!reached.length) return reached;
    for (const r of reached) p.coins += r.coins; // (outside the daily earning limit, like quests)
    this.changed(id);
    this.onBadge(id, reached);
    return reached;
  }

  // The title worn under your name: a gold badge's title, or none ('')
  setTitle(id, badgeId) {
    const p = this.get(id);
    if (badgeId && (!BADGES_BY_ID[badgeId] || (p.badges[badgeId] || 0) < LEVELS.length)) throw new Error('Get that badge to gold first');
    p.title = badgeId || '';
    this.changed(id);
  }

  // Up to three badges shown beside your name
  setPins(id, pins) {
    const p = this.get(id);
    if (!Array.isArray(pins)) throw new Error('Bad pins');
    const ok = [...new Set(pins)].filter((b) => BADGES_BY_ID[b] && (p.badges[b] || 0) > 0);
    if (ok.length !== pins.length || ok.length > MAX_PINS) throw new Error('Bad pins');
    p.pins = ok;
    this.changed(id);
  }

  // What other players see of someone's badges: their title and pinned badges (with levels)
  badgeLook(id) {
    const p = this.peek(id);
    if (!p) return null;
    return { title: p.title || '', pins: p.pins.map((b) => ({ id: b, level: p.badges[b] || 0 })) };
  }

  changed(id) {
    this.save();
    this.onChange(id);
  }

  save() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  // Writes a temp file first so a crash mid-write can't corrupt the save, and
  // keeps the previous good file as .bak so a bad save is always recoverable.
  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    const doc = { version: CURRENT_VERSION, profiles: {} };
    for (const [id, p] of this.profiles) if (!id.startsWith('guest-')) doc.profiles[id] = p;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.renameSync(tmp, this.file);
  }
}

// Upgrades a parsed save document to CURRENT_VERSION. A flat { id: profile }
// object is a legacy v1 file. A file newer than us means older code would be
// running against newer data — refuse to start.
function migrate(data) {
  let version = Number.isInteger(data?.version) ? data.version : 1;
  if (version > CURRENT_VERSION) {
    const err = new Error(`Profile file is version ${version} but this server only understands up to ${CURRENT_VERSION} — update the server first`);
    err.code = 'SAVE_TOO_NEW';
    throw err;
  }
  while (version < CURRENT_VERSION) {
    data = MIGRATIONS[version - 1](data);
    version += 1;
  }
  if (!data.profiles || typeof data.profiles !== 'object') throw new Error('profile file has no profiles object');
  return data;
}

function normalize(p) {
  // Owned ids are kept as bought, even ones no longer in the shop — dropping
  // them would delete purchases on the next save. Unknown ones are just hidden
  // from the client (see view()).
  const owned = [];
  if (Array.isArray(p.owned)) {
    for (const id of p.owned) {
      if (typeof id === 'string' && id.length >= 1 && id.length <= 64 && !owned.includes(id)) owned.push(id);
      if (owned.length >= 500) break;
    }
  }
  const earned = /^\d{4}-\d{2}-\d{2}$/.test(p.earned?.day || '') && Number.isFinite(p.earned.coins) && p.earned.coins >= 0
    ? { day: p.earned.day, coins: p.earned.coins }
    : { day: '', coins: 0 };
  const invite = {
    status: ['joined', 'never'].includes(p.invite?.status) ? p.invite.status : '',
    until: Number.isFinite(p.invite?.until) ? p.invite.until : 0,
  };
  const daily = /^\d{4}-\d{2}-\d{2}$/.test(p.daily || '') ? p.daily : ''; // the UTC day the daily d20 was last rolled
  const streak = Number.isInteger(p.streak) && p.streak >= 0 && p.streak <= STREAK_DAYS ? p.streak : 0; // days in a row, ending on `daily`
  // Referrals: who brought this player in (paid once they finish a game), and how many players
  // this one has brought in
  const ref = {
    by: typeof p.ref?.by === 'string' && /^\d{5,25}$/.test(p.ref.by) ? p.ref.by : '',
    paid: p.ref?.paid === true,
    count: Number.isInteger(p.ref?.count) && p.ref.count >= 0 ? p.ref.count : 0,
  };
  // Discord entitlement ids and Stripe payment/refund ids already processed (see grantPurchase / revokePurchase).
  const bought = Array.isArray(p.bought)
    ? p.bought.filter((e) => typeof e === 'string' && /^(?:\d{5,25}|stripe:[A-Za-z0-9_:-]{6,120})(?::x\d)?$/.test(e))
    : [];
  // Badges: lifetime stat totals, the level reached on each badge (0-3), the title worn, the pins
  const stats = {};
  for (const k of BADGE_STATS) if (Number.isInteger(p.stats?.[k]) && p.stats[k] > 0) stats[k] = p.stats[k];
  const badges = {};
  for (const b of BADGES) if (Number.isInteger(p.badges?.[b.id]) && p.badges[b.id] > 0) badges[b.id] = Math.min(LEVELS.length, p.badges[b.id]);
  const title = BADGES_BY_ID[p.title] && badges[p.title] === LEVELS.length ? p.title : '';
  const pins = Array.isArray(p.pins) ? [...new Set(p.pins)].filter((b) => badges[b]).slice(0, MAX_PINS) : [];
  // VIP Gems: bought with real money only (see grantPurchase)
  const gems = Number.isFinite(p.gems) && p.gems >= 0 ? Math.floor(p.gems) : 0;
  // Battle Pass: this month's track (XP, the tiers claimed in each lane, the last day the login
  // XP was given), and until when their subscription runs (0: not a holder)
  const tiers = (a) => (Array.isArray(a) ? [...new Set(a.filter((n) => Number.isInteger(n) && n >= 1 && n <= PASS_TIERS))] : []);
  const pass = {
    month: /^\d{4}-\d{2}$/.test(p.pass?.month || '') ? p.pass.month : '',
    xp: Number.isInteger(p.pass?.xp) && p.pass.xp >= 0 ? p.pass.xp : 0,
    free: tiers(p.pass?.free),
    premium: tiers(p.pass?.premium),
    login: /^\d{4}-\d{2}-\d{2}$/.test(p.pass?.login || '') ? p.pass.login : '',
  };
  const passUntil = Number.isFinite(p.passUntil) && p.passUntil > 0 ? p.passUntil : 0;
  // Real-money gem packs bought so far (the first one is doubled), and the once-only Starter Pack
  const packs = Number.isInteger(p.packs) && p.packs > 0 ? p.packs : 0;
  const starter = p.starter === true;
  const nonNeg = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const played = {
    games: nonNeg(p.played?.games),
    wins: nonNeg(p.played?.wins),
    botGames: nonNeg(p.played?.botGames),
    botWins: nonNeg(p.played?.botWins),
    botCaptures: nonNeg(p.played?.botCaptures),
    botSixes: nonNeg(p.played?.botSixes),
  };
  const profile = { coins: Number.isFinite(p.coins) ? p.coins : STARTING_COINS, gems, earned, owned, equipped: { ...DEFAULT_EQUIPPED }, invite, daily, streak, ref, bought, stats, played, badges, title, pins, pass, passUntil, packs, starter };
  for (const [type, id] of Object.entries(p.equipped || {})) {
    if (ITEMS[id]?.type === type && ownsItem(profile, id)) profile.equipped[type] = id;
  }
  return profile;
}

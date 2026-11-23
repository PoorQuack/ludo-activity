// Badges: lifetime achievements, each with three levels (bronze, silver, gold). Every level pays
// coins once, the moment you reach it. Gold unlocks the badge's TITLE, which you can wear under
// your name; you can also pin up to three badges for others to see.
//
// Most badges count a stat that games against other people report (see Room.stat). A few are
// worked out from the profile instead (`value`), like Collector from the shop items you own.
import { SHOP_ITEMS, rarityOf } from './shop.js';

export const LEVELS = [
  { id: 'bronze', coins: 50 },
  { id: 'silver', coins: 150 },
  { id: 'gold', coins: 400 },
];

// The stats a profile keeps lifetime totals of (everything else a room reports is ignored here)
export const BADGE_STATS = ['capture', 'win', 'six', 'home', 'revenge', 'rampage', 'clean', 'comeback', 'gift', 'week', 'quickwin'];

// Shop tiers you can complete: every priced item of one type and one rarity
const TIER_TYPES = ['token', 'dice', 'board', 'taunt'];
export function completedTiers(owned) {
  const have = new Set(owned);
  let n = 0;
  for (const type of TIER_TYPES) {
    for (const rarity of ['rare', 'epic', 'legendary']) {
      const tier = SHOP_ITEMS.filter((i) => i.type === type && i.price > 0 && rarityOf(i).id === rarity);
      if (tier.length && tier.every((i) => have.has(i.id))) n++;
    }
  }
  return n;
}

export const BADGES = [
  { id: 'menace', name: 'Menace', title: 'Menace', icon: '⚔️', stat: 'capture', goals: [25, 100, 500], desc: 'Capture {n} tokens' },
  { id: 'champion', name: 'Champion', title: 'Champion', icon: '🏆', stat: 'win', goals: [5, 25, 100], desc: 'Win {n} games' },
  { id: 'lucky', name: 'Lucky', title: 'Lucky Roller', icon: '🎲', stat: 'six', goals: [50, 250, 1000], desc: 'Roll {n} sixes' },
  { id: 'homebody', name: 'Homebody', title: 'Homebody', icon: '🏠', stat: 'home', goals: [25, 150, 600], desc: 'Bring {n} tokens home' },
  { id: 'avenger', name: 'Avenger', title: 'Avenger', icon: '🗡️', stat: 'revenge', goals: [5, 25, 100], desc: 'Revenges: {n}' },
  { id: 'rampage', name: 'Rampage', title: 'Unstoppable', icon: '🔥', stat: 'rampage', goals: [1, 10, 40], desc: 'Rampages (3 captures in a row): {n}' },
  { id: 'untouchable', name: 'Untouchable', title: 'Untouchable', icon: '🛡️', stat: 'clean', goals: [1, 5, 20], desc: 'Wins without being captured: {n}' },
  { id: 'comeback', name: 'Comeback', title: 'Comeback Kid', icon: '📈', stat: 'comeback', goals: [1, 5, 15], desc: 'Wins after being last: {n}' },
  { id: 'collector', name: 'Collector', title: 'Collector', icon: '💎', value: (p) => completedTiers(p.owned || []), goals: [1, 3, 6], desc: 'Shop rarity tiers completed: {n}' },
  { id: 'generous', name: 'Generous', title: 'Big Spender', icon: '🎁', stat: 'gift', goals: [1, 10, 30], desc: 'Gifts given: {n}' },
  { id: 'regular', name: 'Regular', title: 'Regular', icon: '📅', stat: 'week', goals: [1, 4, 12], desc: '7-day daily-roll streaks: {n}' },
  { id: 'speedster', name: 'Speedster', title: 'Speedster', icon: '⚡', stat: 'quickwin', goals: [3, 15, 50], desc: 'Quick games won: {n}' },
];
export const BADGES_BY_ID = Object.fromEntries(BADGES.map((b) => [b.id, b]));
export const MAX_PINS = 3;

// How far a profile is on a badge (its stat total, or its worked-out value)
export const badgeValue = (badge, profile) => (badge.value ? badge.value(profile) : profile.stats?.[badge.stat] || 0);

// The level (0 = none yet, 3 = gold) that value reaches
export const levelFor = (badge, value) => badge.goals.filter((g) => value >= g).length;

// All coins badges can ever pay (for the record: 12 badges × 600)
export const ALL_BADGE_COINS = BADGES.length * LEVELS.reduce((n, l) => n + l.coins, 0);

// A player's level, shown on their picture in the menu: 1, plus one for every badge medal earned
// (bronze, silver and gold each count). It only ever goes up.
export function playerLevel(profile) {
  return 1 + Object.values(profile?.badges || {}).reduce((sum, l) => sum + (Number.isInteger(l) ? l : 0), 0);
}

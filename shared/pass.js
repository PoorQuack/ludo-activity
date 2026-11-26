// The Battle Pass: a track of 30 tiers that starts again every month (UTC). Everyone climbs it
// with XP from logging in each day and finishing quests; it can't be bought with gems or coins.
//   free lane     everyone: Gold Coins, and a sticker pack at the top
//   premium lane  Battle Pass holders (a monthly Discord subscription): VIP Gems, and that
//                 season's exclusive items, which are never sold in the shop
// Holders also get a gold name with a crown in chat while their subscription runs.
// Joining the pass mid-month unlocks the premium rewards of every tier already reached.

export const PASS_TIERS = 30;
export const XP_PER_TIER = 120;
export const PASS_XP = { login: 60, daily: 40, weekly: 100 }; // the first visit of a UTC day; each daily quest; each weekly quest

// Season items: ⚠ ids are permanent (they're saved in profiles), like every shop item. Each
// season names its own; a month with no season of its own reuses the last one listed.
// (The items themselves are in shared/shop.js, with `pass` set to the season they come from.)
export const SEASONS = [
  {
    id: 1,
    from: '2026-11',
    name: 'Season 1: Way of the Warrior',
    items: { 8: 'token-samurai', 15: 'token-football', 22: 'board-dojo', 30: 'board-pitch' },
    freeItems: { 30: 'emote-pack-mascot' },
  },
];

export const seasonMonth = (ms) => new Date(ms).toISOString().slice(0, 7);
export function seasonFor(month) {
  let s = SEASONS[0];
  for (const x of SEASONS) if (x.from <= month) s = x;
  return s;
}
// When the month containing `ms` ends
export const seasonEnd = (ms) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
};

// Tier reached with `xp` (0 to PASS_TIERS)
export const tierFor = (xp) => Math.min(PASS_TIERS, Math.floor(xp / XP_PER_TIER));

// What each tier gives, in each lane: { coins } / { gems } / { item }
export function passRewards(month) {
  const season = seasonFor(month);
  const tiers = [];
  for (let n = 1; n <= PASS_TIERS; n++) {
    const free = season.freeItems?.[n] ? { item: season.freeItems[n] } : { coins: n % 5 === 0 ? 75 : 30 };
    let premium;
    if (season.items[n]) premium = { item: season.items[n] };
    else if (n === 1) premium = { gems: 50 };
    else if (n % 5 === 0) premium = { gems: 30 };
    else premium = { gems: 10 };
    tiers.push({ tier: n, free, premium });
  }
  return { season, tiers };
}

// Where a seasonal exclusive item lives on the Battle Pass track (or null).
export function passItemInfo(itemId, month = seasonMonth(Date.now())) {
  if (!itemId) return null;
  const { season, tiers } = passRewards(month);
  for (const t of tiers) {
    if (t.free?.item === itemId) return { tier: t.tier, lane: 'free', season };
    if (t.premium?.item === itemId) return { tier: t.tier, lane: 'premium', season };
  }
  return null;
}

// Everything in the shop. Prices are in coins, which players earn by finishing games.

export const STARTING_COINS = 150;

// Coins by finishing place (1st, 2nd, …) plus a bonus per capture.
// A game with only one human pays `soloFactor` of that, so farming bots is slower.
export const REWARDS = { place: [25, 15, 10, 8, 6, 5], capture: 2, soloFactor: 0.5 };

// The most coins one player can earn in a single UTC day.
export const DAILY_COIN_CAP = 120;

// ⚠ Item ids are PERMANENT save-file keys: they are stored in every owning player's
// profile. Never rename, reuse or delete an id — change `name`/`price` freely, and
// retire an item by removing it from this list's visibility (players keep ownership).
export const SHOP_ITEMS = [
  { id: 'token-classic', type: 'token', name: 'Classic', price: 0 },
  { id: 'token-star', type: 'token', name: 'Star', price: 200 },
  { id: 'token-gem', type: 'token', name: 'Gem', price: 250 },
  { id: 'token-neon', type: 'token', name: 'Neon', price: 300 },
  { id: 'token-candy', type: 'token', name: 'Candy', price: 350 },
  { id: 'token-crown', type: 'token', name: 'Royal', price: 800 },

  { id: 'dice-classic', type: 'dice', name: 'Classic', price: 0 },
  { id: 'dice-midnight', type: 'dice', name: 'Midnight', price: 150 },
  { id: 'dice-wood', type: 'dice', name: 'Wood', price: 200 },
  { id: 'dice-ruby', type: 'dice', name: 'Ruby', price: 250 },
  { id: 'dice-neon', type: 'dice', name: 'Neon', price: 350 },
  { id: 'dice-gold', type: 'dice', name: 'Gold', price: 600 },

  { id: 'board-classic', type: 'board', name: 'Classic', price: 0 },
  { id: 'board-midnight', type: 'board', name: 'Midnight', price: 300 },
  { id: 'board-wood', type: 'board', name: 'Wood', price: 350 },
  { id: 'board-candy', type: 'board', name: 'Candy', price: 350 },
  { id: 'board-neon', type: 'board', name: 'Neon', price: 500 },

  // Emotes are pack stickers now: big in chat, and a solo sticker floats over your base.
  // Emote packs: one purchase unlocks a set of image emotes, served from /emotes/.
  // Sending one carries the pack id plus the entry index.
  {
    id: 'emote-pack-hamster',
    type: 'emote-pack',
    name: 'Hamster pack',
    emoji: '🐹',
    price: 600,
    emotes: [
      { img: '/emotes/hamster/thumbsuphamster.png', slug: 'thumbsup', name: 'Thumbs up' },
      { img: '/emotes/hamster/bonkhamster.png', slug: 'bonk', name: 'Bonk' },
      { img: '/emotes/hamster/celebrationhamster.png', slug: 'celebrate', name: 'Celebration' },
      { img: '/emotes/hamster/chefhamster.png', slug: 'chef', name: 'Chef' },
      { img: '/emotes/hamster/goodnight.png', slug: 'goodnight', name: 'Goodnight' },
      { img: '/emotes/hamster/hamsterdespair.png', slug: 'despair', name: 'Despair' },
      { img: '/emotes/hamster/hamsterdrool.png', slug: 'drool', name: 'Drool' },
      { img: '/emotes/hamster/hamster-shock.gif', slug: 'shock', name: 'Shock' },
      { img: '/emotes/hamster/happyhamsta.gif', slug: 'happy', name: 'Happy' },
      { img: '/emotes/hamster/oxygenhamster.png', slug: 'oxygen', name: 'Oxygen' },
      { img: '/emotes/hamster/princesshamster.png', slug: 'princess', name: 'Princess' },
      { img: '/emotes/hamster/shockedhamster.png', slug: 'shocked', name: 'Shocked' },
      { img: '/emotes/hamster/skeletonhamster.png', slug: 'skeleton', name: 'Skeleton' },
      { img: '/emotes/hamster/zzzhamster.png', slug: 'sleepy', name: 'Sleepy' },
    ],
  },
];

export const ITEMS = Object.fromEntries(SHOP_ITEMS.map((item) => [item.id, item]));

// :slug: codes usable in chat. slug -> { item, idx } so the server can check the sender owns the pack.
export const EMOTE_SLUGS = {};
for (const item of SHOP_ITEMS) {
  if (item.type !== 'emote-pack') continue;
  item.emotes.forEach((e, idx) => {
    if (e.slug) EMOTE_SLUGS[e.slug] = { item: item.id, idx, img: e.img, name: e.name };
  });
}

export const DEFAULT_EQUIPPED = { token: 'token-classic', dice: 'dice-classic', board: 'board-classic' };

// Free items are owned by everyone.
export function ownsItem(profile, id) {
  const item = ITEMS[id];
  return !!item && (item.price === 0 || !!profile?.owned.includes(id));
}

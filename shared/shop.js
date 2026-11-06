// Everything in the shop. Prices are in coins, which players earn by finishing games.

export const STARTING_COINS = 150;

// Coins by finishing place (1st, 2nd, …) plus a bonus per capture.
// A game with only one human (everyone else a bot) pays nothing, so bots can't be farmed.
export const REWARDS = { place: [25, 15, 10, 8, 6, 5], capture: 2 };

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
  { id: 'token-checker', type: 'token', name: 'Checker', price: 250 },
  { id: 'token-ghost', type: 'token', name: 'Ghost', price: 400 },
  { id: 'token-slime', type: 'token', name: 'Slime', price: 450 },
  { id: 'token-rocket', type: 'token', name: 'Rocket', price: 500 },
  { id: 'token-duck', type: 'token', name: 'Rubber Duck', price: 650 },
  { id: 'token-cat', type: 'token', name: 'Cat', price: 450 },
  // Your zodiac sign by colour: ram (red), bull (green), crab (blue), lion (yellow), scorpion (purple), archer (orange)
  { id: 'token-constellation', type: 'token', name: 'Constellation', price: 600 },

  { id: 'dice-classic', type: 'dice', name: 'Classic', price: 0 },
  { id: 'dice-midnight', type: 'dice', name: 'Midnight', price: 150 },
  { id: 'dice-wood', type: 'dice', name: 'Wood', price: 200 },
  { id: 'dice-ruby', type: 'dice', name: 'Ruby', price: 250 },
  { id: 'dice-neon', type: 'dice', name: 'Neon', price: 350 },
  { id: 'dice-gold', type: 'dice', name: 'Gold', price: 600 },
  { id: 'dice-ice', type: 'dice', name: 'Ice', price: 250 },
  { id: 'dice-candy', type: 'dice', name: 'Candy', price: 250 },
  { id: 'dice-emerald', type: 'dice', name: 'Emerald', price: 300 },
  { id: 'dice-ludo', type: 'dice', name: 'Ludo', price: 400 },
  { id: 'dice-lava', type: 'dice', name: 'Lava', price: 450 },
  { id: 'dice-galaxy', type: 'dice', name: 'Galaxy', price: 500 },
  { id: 'dice-cat', type: 'dice', name: 'Cat', price: 350 },
  { id: 'dice-constellation', type: 'dice', name: 'Constellation', price: 450 },

  { id: 'board-classic', type: 'board', name: 'Classic', price: 0 },
  { id: 'board-midnight', type: 'board', name: 'Midnight', price: 300 },
  { id: 'board-wood', type: 'board', name: 'Wood', price: 350 },
  { id: 'board-candy', type: 'board', name: 'Candy', price: 350 },
  { id: 'board-neon', type: 'board', name: 'Neon', price: 500 },
  { id: 'board-ocean', type: 'board', name: 'Ocean', price: 400 },
  { id: 'board-forest', type: 'board', name: 'Forest', price: 400 },
  { id: 'board-ice', type: 'board', name: 'Ice', price: 450 },
  { id: 'board-lava', type: 'board', name: 'Lava', price: 550 },
  { id: 'board-royal', type: 'board', name: 'Royal', price: 700 },
  { id: 'board-cat', type: 'board', name: 'Cat', price: 500 },
  { id: 'board-constellation', type: 'board', name: 'Constellation', price: 800 },

  // Emotes are pack stickers now: big in chat, and a solo sticker floats over your base.
  // Single stickers (type 'emote' with an img + slug) work the same way, just sold one at a time.
  { id: 'emote-cathappy', type: 'emote', name: 'Happy cat', img: '/emotes/cats/cathappy.gif', slug: 'cathappy', price: 150 },
  { id: 'emote-dancekitten', type: 'emote', name: 'Dancing kitten', img: '/emotes/cats/dancekitten.webp', slug: 'dancekitten', price: 150 },
  { id: 'emote-angrycat', type: 'emote', name: 'Angry cat', img: '/emotes/cats/angrycat.png', slug: 'angrycat', price: 150 },
  // Was in the Hamster pack by mistake: anyone with that pack keeps it for free
  { id: 'emote-nervouscat', type: 'emote', name: 'Nervous cat', img: '/emotes/cats/nervouscat.png', slug: 'nervouscat', price: 150, freeWith: 'emote-pack-hamster' },
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
      { img: '/emotes/hamster/happyhamsta.png', slug: 'happy', name: 'Happy' },
      { img: '/emotes/hamster/oxygenhamster.png', slug: 'oxygen', name: 'Oxygen' },
      { img: '/emotes/hamster/princesshamster.png', slug: 'princess', name: 'Princess' },
      { img: '/emotes/hamster/shockedhamster.png', slug: 'shocked', name: 'Shocked' },
      { img: '/emotes/hamster/skeletonhamster.png', slug: 'skeleton', name: 'Skeleton' },
      { img: '/emotes/hamster/zzzhamster.png', slug: 'sleepy', name: 'Sleepy' },
    ],
  },
  // Laughing and teasing stickers (art from the Toshi and kitty packs, see client/public/emotes/CREDITS.md).
  {
    id: 'emote-pack-laugh',
    type: 'emote-pack',
    name: 'Laugh pack',
    emoji: '😂',
    price: 500,
    emotes: [
      { img: '/emotes/toshi/laugh-hard.png', slug: 'rofl', name: 'ROFL' },
      { img: '/emotes/toshi/laugh-tears.png', slug: 'lol', name: 'Crying laughing' },
      { img: '/emotes/toshi/lol.png', slug: 'haha', name: 'LOL' },
      { img: '/emotes/toshi/giggle.png', slug: 'hehe', name: 'Giggle' },
      { img: '/emotes/kitty/lol-moos.png', slug: 'pbbt', name: 'Bleh' },
      { img: '/emotes/kitty/catevil.png', slug: 'mwahaha', name: 'Evil grin' },
      { img: '/emotes/toshi/smug.png', slug: 'smug', name: 'Smug' },
      { img: '/emotes/kitty/party-moos.png', slug: 'party', name: 'Party' },
      { img: '/emotes/meme/dumb.png', slug: 'dumb', name: 'Dumb' },
    ],
  },
  // Toshi, the blue fox-cat: every mood.
  {
    id: 'emote-pack-toshi',
    type: 'emote-pack',
    name: 'Toshi pack',
    emoji: '🦊',
    price: 600,
    emotes: [
      { img: '/emotes/toshi/happy.png', slug: 'toshi-happy', name: 'Happy' },
      { img: '/emotes/toshi/grin.png', slug: 'toshi-grin', name: 'Grin' },
      { img: '/emotes/toshi/wink.png', slug: 'toshi-wink', name: 'Wink' },
      { img: '/emotes/toshi/bleh.png', slug: 'toshi-bleh', name: 'Bleh' },
      { img: '/emotes/toshi/wide-eyed.png', slug: 'toshi-wide-eyed', name: 'Wide-eyed' },
      { img: '/emotes/toshi/surprised.png', slug: 'toshi-surprised', name: 'Surprised' },
      { img: '/emotes/toshi/pleading.png', slug: 'toshi-pleading', name: 'Pleading' },
      { img: '/emotes/toshi/hungry.png', slug: 'toshi-hungry', name: 'Hungry' },
      { img: '/emotes/toshi/yawn.png', slug: 'toshi-yawn', name: 'Yawn' },
      { img: '/emotes/toshi/exhausted.png', slug: 'toshi-exhausted', name: 'Exhausted' },
      { img: '/emotes/toshi/squint.png', slug: 'toshi-squint', name: 'Squint' },
      { img: '/emotes/toshi/unimpressed.png', slug: 'toshi-unimpressed', name: 'Unimpressed' },
      { img: '/emotes/toshi/nervous.png', slug: 'toshi-nervous', name: 'Nervous' },
      { img: '/emotes/toshi/worried.png', slug: 'toshi-worried', name: 'Worried' },
      { img: '/emotes/toshi/wince.png', slug: 'toshi-wince', name: 'Wince' },
      { img: '/emotes/toshi/sad.png', slug: 'toshi-sad', name: 'Sad' },
      { img: '/emotes/toshi/cry.png', slug: 'toshi-cry', name: 'Cry' },
      { img: '/emotes/toshi/shout.png', slug: 'toshi-shout', name: 'Shout' },
      { img: '/emotes/toshi/angry.png', slug: 'toshi-angry', name: 'Angry' },
    ],
  },
  // Round white kitties.
  {
    id: 'emote-pack-kitty',
    type: 'emote-pack',
    name: 'Kitty pack',
    emoji: '🐱',
    price: 550,
    emotes: [
      { img: '/emotes/kitty/cathappy.png', slug: 'kitty-happy', name: 'Happy' },
      { img: '/emotes/kitty/cat-smile.png', slug: 'kitty-smile', name: 'Smile' },
      { img: '/emotes/kitty/catexcited.png', slug: 'kitty-excited', name: 'Excited' },
      { img: '/emotes/kitty/catwink.png', slug: 'kitty-wink', name: 'Wink' },
      { img: '/emotes/kitty/catrelaxed.png', slug: 'kitty-relaxed', name: 'Relaxed' },
      { img: '/emotes/kitty/catstare.png', slug: 'kitty-stare', name: 'Stare' },
      { img: '/emotes/kitty/catpaw.png', slug: 'kitty-paw', name: 'Paw' },
      { img: '/emotes/kitty/cute-moos.png', slug: 'kitty-cute', name: 'Cute' },
      { img: '/emotes/kitty/kiss-moos.png', slug: 'kitty-kiss', name: 'Kiss' },
      { img: '/emotes/kitty/huh-moos.png', slug: 'kitty-huh', name: 'Huh?' },
      { img: '/emotes/kitty/shocked-moos.png', slug: 'kitty-shocked', name: 'Shocked' },
      { img: '/emotes/kitty/ew-moos.png', slug: 'kitty-ew', name: 'Ew' },
      { img: '/emotes/kitty/sad-moos.png', slug: 'kitty-sad', name: 'Sad' },
      { img: '/emotes/kitty/mad-moos.png', slug: 'kitty-mad', name: 'Mad' },
    ],
  },
  // Tiny animated pixel pals (the Aliaa pack from emoji.gg).
  {
    id: 'emote-pack-aliaa',
    type: 'emote-pack',
    name: 'Aliaa pack',
    emoji: '🦇',
    price: 300,
    emotes: [
      { img: '/emotes/aliaa/nuko-astonished.gif', slug: 'nuko-wow', name: 'Nuko wow' },
      { img: '/emotes/aliaa/nuko-astonished2.gif', slug: 'nuko-shock', name: 'Nuko shock' },
      { img: '/emotes/aliaa/nuko-handstand2.gif', slug: 'nuko-flip', name: 'Nuko handstand' },
      { img: '/emotes/aliaa/cutebat.gif', slug: 'bat', name: 'Cute bat' },
    ],
  },
];

export const ITEMS = Object.fromEntries(SHOP_ITEMS.map((item) => [item.id, item]));

// :slug: codes usable in chat. slug -> { item, idx } so the server can check the sender owns the pack.
export const EMOTE_SLUGS = {};
for (const item of SHOP_ITEMS) {
  if (item.type === 'emote-pack') {
    item.emotes.forEach((e, idx) => {
      if (e.slug) EMOTE_SLUGS[e.slug] = { item: item.id, idx, img: e.img, name: e.name };
    });
  } else if (item.type === 'emote' && item.slug && item.img) {
    EMOTE_SLUGS[item.slug] = { item: item.id, idx: 0, img: item.img, name: item.name };
  }
}


export const DEFAULT_EQUIPPED = { token: 'token-classic', dice: 'dice-classic', board: 'board-classic' };

// Free items are owned by everyone.
export function ownsItem(profile, id) {
  const item = ITEMS[id];
  if (!item) return false;
  if (item.price === 0 || !!profile?.owned.includes(id)) return true;
  // some items come free with another one you own (see `freeWith`)
  return !!item.freeWith && !!profile?.owned.includes(item.freeWith);
}

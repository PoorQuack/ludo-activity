// Everything in the shop. Two currencies:
//   coins (Gold Coins)  earned by playing: games, quests, the daily d20, badges, stakes rooms
//   gems  (VIP Gems)    bought with real money (the packs below, through Discord), never earned
// Common and Rare items are paid in coins; Epic and Legendary items in gems (they say
// priceCurrency: 'gems'; test/sets.test.js checks every item follows the rule). Gems never turn
// into coins anywhere, so stakes and the leaderboard can't be bought. Use currencyOf(item).

export const STARTING_COINS = 150;

// Coins by finishing place (1st, 2nd, …) plus a bonus per capture.
// A game with only one human (everyone else a bot) pays nothing, so bots can't be farmed.
export const REWARDS = { place: [25, 15, 10, 8, 6, 5], capture: 2, revenge: 5 };

// The most coins one player can earn in a single UTC day.
export const DAILY_COIN_CAP = 120;

// Stakes rooms: the host can set an entry fee in Gold Coins (never gems). Every human pays it
// when the game starts, and winner takes all: only 1st place (or the winning team) wins the pot,
// with no Classic placement/capture coin rewards.
export const STAKES = [
  0, 100, 500,
  1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000,
  5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000,
];
export const POT_SPLIT = { 1: [100], 2: [100], 3: [100], 4: [100], 5: [100], 6: [100] };

// RARITY says how far an item goes from the plain one, and sets its price band (see RARITIES):
//   common     the default, basic look (free), and single stickers
//   rare       the basic model with a small change: a new material or colour, an emblem
//   epic       a big change: a whole new shape, its own face art, a textured board that moves
//   legendary  a full figure with an effect that moves: sparkles, orbiting stars, glints
// Everything in a set shares one rarity, so a Legendary set is Legendary all through.
// `perk` (Legendary items): what it does that no other item does, shown in place of the usual
// description when you open it in the shop.
//
// ⚠ Item ids are PERMANENT save-file keys: they are stored in every owning player's
// profile. Never rename, reuse or delete an id — change `name`/`price` freely, and
// retire an item by removing it from this list's visibility (players keep ownership).
export const SHOP_ITEMS = [
  { id: 'token-classic', type: 'token', name: 'Classic', rarity: 'common', price: 0 },
  { id: 'token-star', type: 'token', name: 'Star', rarity: 'rare', price: 200 },
  { id: 'token-gem', type: 'token', name: 'Gem', rarity: 'rare', price: 250 },
  { id: 'token-neon', type: 'token', name: 'Neon', rarity: 'epic', price: 130, priceCurrency: 'gems' },
  { id: 'token-candy', type: 'token', name: 'Candy', rarity: 'rare', price: 350 },
  { id: 'token-crown', type: 'token', name: 'Royal', rarity: 'legendary', price: 250, priceCurrency: 'gems', perk: 'When captured, it bursts into gold and re-forms on its base.' },
  { id: 'token-checker', type: 'token', name: 'Checker', rarity: 'epic', price: 130, priceCurrency: 'gems' },
  { id: 'token-ghost', type: 'token', name: 'Ghost', rarity: 'epic', price: 130, priceCurrency: 'gems' },
  { id: 'token-slime', type: 'token', name: 'Slime', rarity: 'epic', price: 150, priceCurrency: 'gems' },
  { id: 'token-rocket', type: 'token', name: 'Rocket', rarity: 'legendary', price: 200, priceCurrency: 'gems', perk: 'When captured, it blasts off and lands back on its base.' },
  { id: 'token-duck', type: 'token', name: 'Rubber Duck', rarity: 'epic', price: 180, priceCurrency: 'gems' },
  { id: 'token-cat', type: 'token', name: 'Cat', rarity: 'epic', price: 150, priceCurrency: 'gems' },
  // Your zodiac sign by colour: ram (red), bull (green), crab (blue), lion (yellow), scorpion (purple), archer (orange)
  { id: 'token-constellation', type: 'token', name: 'Constellation', rarity: 'legendary', price: 200, priceCurrency: 'gems', perk: 'When captured, it folds into starlight and reappears on its base.' },
  { id: 'token-robot', type: 'token', name: 'Robot', rarity: 'epic', price: 150, priceCurrency: 'gems' },
  { id: 'token-penguin', type: 'token', name: 'Penguin', rarity: 'epic', price: 150, priceCurrency: 'gems' },
  { id: 'token-sakura', type: 'token', name: 'Sakura', rarity: 'epic', price: 150, priceCurrency: 'gems' },
  { id: 'token-dino', type: 'token', name: 'Dino', rarity: 'epic', price: 150, priceCurrency: 'gems' },
  { id: 'token-ufo', type: 'token', name: 'UFO', rarity: 'legendary', price: 250, priceCurrency: 'gems', perk: 'When captured, a beam of light carries it back to its base.' },
  { id: 'token-dragon', type: 'token', name: 'Dragon', rarity: 'legendary', price: 250, priceCurrency: 'gems', perk: 'When captured, it flies home on its own wings.' },

  { id: 'dice-classic', type: 'dice', name: 'Classic', rarity: 'common', price: 0 },
  { id: 'dice-midnight', type: 'dice', name: 'Midnight', rarity: 'rare', price: 200 },
  { id: 'dice-wood', type: 'dice', name: 'Wood', rarity: 'rare', price: 200 },
  { id: 'dice-ruby', type: 'dice', name: 'Ruby', rarity: 'rare', price: 250 },
  { id: 'dice-neon', type: 'dice', name: 'Neon', rarity: 'epic', price: 130, priceCurrency: 'gems' },
  { id: 'dice-gold', type: 'dice', name: 'Gold', rarity: 'legendary', price: 200, priceCurrency: 'gems', perk: 'Crowned and jewelled, with rays of light turning behind it.' },
  { id: 'dice-ice', type: 'dice', name: 'Ice', rarity: 'rare', price: 250 },
  { id: 'dice-candy', type: 'dice', name: 'Candy', rarity: 'rare', price: 250 },
  { id: 'dice-emerald', type: 'dice', name: 'Emerald', rarity: 'rare', price: 300 },
  { id: 'dice-ludo', type: 'dice', name: 'Ludo', rarity: 'epic', price: 130, priceCurrency: 'gems' },
  { id: 'dice-lava', type: 'dice', name: 'Lava', rarity: 'epic', price: 150, priceCurrency: 'gems' },
  { id: 'dice-galaxy', type: 'dice', name: 'Galaxy', rarity: 'epic', price: 170, priceCurrency: 'gems' },
  { id: 'dice-cat', type: 'dice', name: 'Cat', rarity: 'epic', price: 130, priceCurrency: 'gems' },
  { id: 'dice-bubble', type: 'dice', name: 'Bubble', rarity: 'rare', price: 300 },
  { id: 'dice-slime', type: 'dice', name: 'Slime', rarity: 'epic', price: 150, priceCurrency: 'gems' },
  { id: 'dice-robot', type: 'dice', name: 'Robot', rarity: 'epic', price: 170, priceCurrency: 'gems' },
  { id: 'dice-ghost', type: 'dice', name: 'Ghost', rarity: 'epic', price: 130, priceCurrency: 'gems' },
  { id: 'dice-duck', type: 'dice', name: 'Rubber Duck', rarity: 'epic', price: 150, priceCurrency: 'gems' },
  { id: 'dice-snowball', type: 'dice', name: 'Snowball', rarity: 'epic', price: 130, priceCurrency: 'gems' },
  { id: 'dice-sakura', type: 'dice', name: 'Sakura', rarity: 'epic', price: 150, priceCurrency: 'gems' },
  { id: 'dice-comet', type: 'dice', name: 'Comet', rarity: 'legendary', price: 200, priceCurrency: 'gems', perk: 'A lump of burning rock, a tail of fire streaming behind it.' },
  { id: 'dice-alien', type: 'dice', name: 'Alien', rarity: 'legendary', price: 200, priceCurrency: 'gems', perk: 'Eyes on stalks that look about and blink, rings of light beneath it.' },
  { id: 'dice-dragon', type: 'dice', name: 'Dragon', rarity: 'legendary', price: 250, priceCurrency: 'gems', perk: 'Horns, beating wings, and sparks on every roll.' },
  { id: 'dice-constellation', type: 'dice', name: 'Constellation', rarity: 'legendary', price: 200, priceCurrency: 'gems', perk: 'A ring of stars circles it, and sparks fly when it rolls.' },

  // Taunts: what pops up over the square when you capture someone. Everyone in the room sees it.
  { id: 'taunt-none', type: 'taunt', name: 'No taunt', rarity: 'common', price: 0 },
  { id: 'taunt-bonk', type: 'taunt', name: 'Bonk!', rarity: 'rare', price: 250, desc: 'A squeaky hammer flattens the square. They stay dizzy until their next turn.' },
  { id: 'taunt-bye', type: 'taunt', name: 'Bye!', rarity: 'rare', price: 250, desc: 'A glove waves their token all the way back to its base, to a slide whistle.' },
  { id: 'taunt-chicken', type: 'taunt', name: 'Rubber chicken', rarity: 'rare', price: 300, desc: 'A rubber chicken flops onto the square and lets out the longest squeak.' },
  { id: 'taunt-violin', type: 'taunt', name: 'Sad violin', rarity: 'rare', price: 300, desc: 'A tiny violin plays the saddest tune over their base. A rain cloud stays there until their next turn.' },
  { id: 'taunt-clown', type: 'taunt', name: 'Clown', rarity: 'epic', price: 150, priceCurrency: 'gems', desc: 'HONK. They wear a clown nose until their next turn.' },
  { id: 'taunt-l', type: 'taunt', name: 'L', rarity: 'epic', price: 150, priceCurrency: 'gems', desc: 'A giant L lands on their base, to a wah-wah trombone. It stays until their next turn.' },
  { id: 'taunt-ggez', type: 'taunt', name: 'GG EZ', rarity: 'epic', price: 170, priceCurrency: 'gems', desc: 'Sunglasses drop onto your token. GG EZ.' },
  { id: 'taunt-skill', type: 'taunt', name: 'Skill issue', rarity: 'epic', price: 170, priceCurrency: 'gems', desc: 'A rubber stamp slams SKILL ISSUE across their base, and the ink stays until their next turn.' },
  { id: 'taunt-cackle', type: 'taunt', name: 'Cackle', rarity: 'epic', price: 180, priceCurrency: 'gems', desc: 'A laughing skull bounces to their base and keeps giggling there until their next turn.' },
  { id: 'taunt-fireworks', type: 'taunt', name: 'Fireworks', rarity: 'legendary', price: 200, priceCurrency: 'gems', perk: 'Fireworks over the whole board, three airhorn blasts, and their name up in lights.' },
  { id: 'board-classic', type: 'board', name: 'Classic', rarity: 'common', price: 0 },
  { id: 'board-midnight', type: 'board', name: 'Midnight', rarity: 'rare', price: 300 },
  { id: 'board-wood', type: 'board', name: 'Wood', rarity: 'rare', price: 350 },
  { id: 'board-candy', type: 'board', name: 'Candy', rarity: 'rare', price: 350 },
  { id: 'board-neon', type: 'board', name: 'Neon', rarity: 'epic', price: 170, priceCurrency: 'gems' },
  { id: 'board-ocean', type: 'board', name: 'Ocean', rarity: 'epic', price: 130, priceCurrency: 'gems' },
  { id: 'board-forest', type: 'board', name: 'Forest', rarity: 'epic', price: 130, priceCurrency: 'gems' },
  { id: 'board-ice', type: 'board', name: 'Ice', rarity: 'rare', price: 350 },
  { id: 'board-lava', type: 'board', name: 'Lava', rarity: 'epic', price: 180, priceCurrency: 'gems' },
  { id: 'board-desert', type: 'board', name: 'Desert', rarity: 'rare', price: 350 },
  { id: 'board-sakura', type: 'board', name: 'Sakura', rarity: 'epic', price: 150, priceCurrency: 'gems' },
  { id: 'board-crystal', type: 'board', name: 'Crystal', rarity: 'epic', price: 150, priceCurrency: 'gems' },
  { id: 'board-arcade', type: 'board', name: 'Arcade', rarity: 'epic', price: 170, priceCurrency: 'gems' },
  { id: 'board-haunted', type: 'board', name: 'Haunted', rarity: 'epic', price: 170, priceCurrency: 'gems' },
  { id: 'board-swamp', type: 'board', name: 'Swamp', rarity: 'epic', price: 150, priceCurrency: 'gems' },
  { id: 'board-factory', type: 'board', name: 'Factory', rarity: 'epic', price: 170, priceCurrency: 'gems' },
  { id: 'board-space', type: 'board', name: 'Space', rarity: 'legendary', price: 250, priceCurrency: 'gems' },
  { id: 'board-lair', type: 'board', name: "Dragon's lair", rarity: 'legendary', price: 250, priceCurrency: 'gems' },
  { id: 'board-royal', type: 'board', name: 'Royal', rarity: 'legendary', price: 250, priceCurrency: 'gems' },
  { id: 'board-cat', type: 'board', name: 'Cat', rarity: 'epic', price: 170, priceCurrency: 'gems' },
  { id: 'board-constellation', type: 'board', name: 'Constellation', rarity: 'legendary', price: 250, priceCurrency: 'gems' },

  // Emotes are pack stickers now: big in chat, and a solo sticker floats over your base.
  // Single stickers (type 'emote' with an img + slug) work the same way, just sold one at a time.
  { id: 'emote-cathappy', type: 'emote', name: 'Happy cat', rarity: 'common', img: '/emotes/cats/cathappy.gif', slug: 'cathappy', price: 150 },
  { id: 'emote-dancekitten', type: 'emote', name: 'Dancing kitten', rarity: 'common', img: '/emotes/cats/dancekitten.webp', slug: 'dancekitten', price: 150 },
  { id: 'emote-angrycat', type: 'emote', name: 'Angry cat', rarity: 'common', img: '/emotes/cats/angrycat.png', slug: 'angrycat', price: 150 },
  { id: 'emote-shooshoo', type: 'emote', name: 'Shoo shoo cat', rarity: 'common', img: '/emotes/cats/shooshoo.webp', slug: 'shooshoo', price: 150 },
  { id: 'emote-rudecat', type: 'emote', name: 'Rude cat', rarity: 'common', img: '/emotes/cats/rudecat.png', slug: 'rudecat', price: 150 },
  { id: 'emote-sadkitten', type: 'emote', name: 'Sad kitten', rarity: 'common', img: '/emotes/cats/sadkitten.png', slug: 'sadkitten', price: 150 },
  { id: 'emote-blepcat', type: 'emote', name: 'Blep cat', rarity: 'common', img: '/emotes/cats/blepcat.png', slug: 'blepcat', price: 150 },
  { id: 'emote-cathello', type: 'emote', name: 'Hello cat', rarity: 'common', img: '/emotes/cats/cathello.webp', slug: 'cathello', price: 150 },
  { id: 'emote-cozykitten', type: 'emote', name: 'Cozy kitten', rarity: 'common', img: '/emotes/cats/cozykitten.png', slug: 'cozykitten', price: 150 },
  { id: 'emote-buffcat', type: 'emote', name: 'Buff cat', rarity: 'common', img: '/emotes/cats/buffcat.png', slug: 'buffcat', price: 150 },
  { id: 'emote-dontjoke', type: 'emote', name: "Don't even joke lad", rarity: 'common', img: '/emotes/meme/dontjoke.webp', slug: 'dontjoke', price: 150 },
  { id: 'emote-wadafak', type: 'emote', name: 'Wadafak', rarity: 'common', img: '/emotes/meme/wadafak.png', slug: 'wadafak', price: 150 },
  { id: 'emote-eatingchips', type: 'emote', name: 'Eating chips', rarity: 'common', img: '/emotes/meme/eating-chips.gif', slug: 'eatingchips', price: 150 },
  // Was in the Hamster pack by mistake: anyone with that pack keeps it for free
  { id: 'emote-nervouscat', type: 'emote', name: 'Nervous cat', rarity: 'common', img: '/emotes/cats/nervouscat.png', slug: 'nervouscat', price: 150, freeWith: 'emote-pack-hamster' },
  // Was in the Laugh pack by mistake: anyone with that pack keeps it for free
  { id: 'emote-dumb', type: 'emote', name: 'Dumb', rarity: 'common', img: '/emotes/meme/dumb.png', slug: 'dumb', price: 150, freeWith: 'emote-pack-laugh' },
  // Emote packs: one purchase unlocks a set of image emotes, served from /emotes/.
  // Every pack is our own art, drawn in tools/stickers/ (see client/public/emotes/CREDITS.md):
  // never add a pack made from someone else's emoji.
  // Sending one carries the pack id plus the entry index.
  {
    id: 'emote-pack-hamster',
    type: 'emote-pack',
    name: 'Hamster pack',
    rarity: 'epic',
    emoji: '🐹',
    price: 200, priceCurrency: 'gems',
    emotes: [
      { img: '/emotes/hamster/thumbsup.png', slug: 'thumbsup', name: 'Thumbs up' },
      { img: '/emotes/hamster/bonk.png', slug: 'bonk', name: 'Bonk' },
      { img: '/emotes/hamster/celebrate.webp', slug: 'celebrate', name: 'Celebration' },
      { img: '/emotes/hamster/chef.png', slug: 'chef', name: 'Chef' },
      { img: '/emotes/hamster/goodnight.png', slug: 'goodnight', name: 'Goodnight' },
      { img: '/emotes/hamster/despair.png', slug: 'despair', name: 'Despair' },
      { img: '/emotes/hamster/drool.png', slug: 'drool', name: 'Drool' },
      { img: '/emotes/hamster/shock.webp', slug: 'shock', name: 'Shock' },
      { img: '/emotes/hamster/happy.png', slug: 'happy', name: 'Happy' },
      { img: '/emotes/hamster/oxygen.png', slug: 'oxygen', name: 'Oxygen' },
      { img: '/emotes/hamster/princess.png', slug: 'princess', name: 'Princess' },
      { img: '/emotes/hamster/shocked.png', slug: 'shocked', name: 'Shocked' },
      { img: '/emotes/hamster/skeleton.png', slug: 'skeleton', name: 'Skeleton' },
      { img: '/emotes/hamster/sleepy.webp', slug: 'sleepy', name: 'Sleepy' },
    ],
  },
  // Laughing and teasing stickers: our fox and kitty again (tools/stickers/pals.mjs).
  {
    id: 'emote-pack-laugh',
    type: 'emote-pack',
    name: 'Laugh pack',
    rarity: 'epic',
    emoji: '😂',
    price: 170, priceCurrency: 'gems',
    emotes: [
      { img: '/emotes/fox/rofl.webp', slug: 'rofl', name: 'ROFL' },
      { img: '/emotes/fox/lol.png', slug: 'lol', name: 'Crying laughing' },
      { img: '/emotes/fox/haha.webp', slug: 'haha', name: 'LOL' },
      { img: '/emotes/fox/hehe.png', slug: 'hehe', name: 'Giggle' },
      { img: '/emotes/kitty/pbbt.png', slug: 'pbbt', name: 'Bleh' },
      { img: '/emotes/kitty/mwahaha.png', slug: 'mwahaha', name: 'Evil grin' },
      { img: '/emotes/fox/smug.png', slug: 'smug', name: 'Smug' },
      { img: '/emotes/kitty/party.webp', slug: 'party', name: 'Party' },
    ],
  },
  // Our fox, in every mood. (The id says 'toshi' because ids are permanent; that art is gone.)
  {
    id: 'emote-pack-toshi',
    type: 'emote-pack',
    name: 'Fox pack',
    rarity: 'epic',
    emoji: '🦊',
    price: 200, priceCurrency: 'gems',
    emotes: [
      { img: '/emotes/fox/happy.png', slug: 'fox-happy', name: 'Happy' },
      { img: '/emotes/fox/grin.png', slug: 'fox-grin', name: 'Grin' },
      { img: '/emotes/fox/wink.png', slug: 'fox-wink', name: 'Wink' },
      { img: '/emotes/fox/bleh.png', slug: 'fox-bleh', name: 'Bleh' },
      { img: '/emotes/fox/wide-eyed.png', slug: 'fox-wide-eyed', name: 'Wide-eyed' },
      { img: '/emotes/fox/surprised.png', slug: 'fox-surprised', name: 'Surprised' },
      { img: '/emotes/fox/pleading.png', slug: 'fox-pleading', name: 'Pleading' },
      { img: '/emotes/fox/hungry.png', slug: 'fox-hungry', name: 'Hungry' },
      { img: '/emotes/fox/yawn.png', slug: 'fox-yawn', name: 'Yawn' },
      { img: '/emotes/fox/exhausted.png', slug: 'fox-exhausted', name: 'Exhausted' },
      { img: '/emotes/fox/squint.png', slug: 'fox-squint', name: 'Squint' },
      { img: '/emotes/fox/unimpressed.png', slug: 'fox-unimpressed', name: 'Unimpressed' },
      { img: '/emotes/fox/nervous.png', slug: 'fox-nervous', name: 'Nervous' },
      { img: '/emotes/fox/worried.png', slug: 'fox-worried', name: 'Worried' },
      { img: '/emotes/fox/wince.png', slug: 'fox-wince', name: 'Wince' },
      { img: '/emotes/fox/sad.png', slug: 'fox-sad', name: 'Sad' },
      { img: '/emotes/fox/cry.png', slug: 'fox-cry', name: 'Cry' },
      { img: '/emotes/fox/shout.png', slug: 'fox-shout', name: 'Shout' },
      { img: '/emotes/fox/angry.png', slug: 'fox-angry', name: 'Angry' },
    ],
  },
  // Our grey tabby kitty.
  {
    id: 'emote-pack-kitty',
    type: 'emote-pack',
    name: 'Kitty pack',
    rarity: 'epic',
    emoji: '🐱',
    price: 180, priceCurrency: 'gems',
    emotes: [
      { img: '/emotes/kitty/happy.png', slug: 'kitty-happy', name: 'Happy' },
      { img: '/emotes/kitty/smile.png', slug: 'kitty-smile', name: 'Smile' },
      { img: '/emotes/kitty/excited.png', slug: 'kitty-excited', name: 'Excited' },
      { img: '/emotes/kitty/wink.png', slug: 'kitty-wink', name: 'Wink' },
      { img: '/emotes/kitty/relaxed.png', slug: 'kitty-relaxed', name: 'Relaxed' },
      { img: '/emotes/kitty/stare.png', slug: 'kitty-stare', name: 'Stare' },
      { img: '/emotes/kitty/paw.png', slug: 'kitty-paw', name: 'Paw' },
      { img: '/emotes/kitty/cute.png', slug: 'kitty-cute', name: 'Cute' },
      { img: '/emotes/kitty/kiss.png', slug: 'kitty-kiss', name: 'Kiss' },
      { img: '/emotes/kitty/huh.png', slug: 'kitty-huh', name: 'Huh?' },
      { img: '/emotes/kitty/shocked.png', slug: 'kitty-shocked', name: 'Shocked' },
      { img: '/emotes/kitty/ew.png', slug: 'kitty-ew', name: 'Ew' },
      { img: '/emotes/kitty/sad.png', slug: 'kitty-sad', name: 'Sad' },
      { img: '/emotes/kitty/mad.png', slug: 'kitty-mad', name: 'Mad' },
    ],
  },
  // Tiny animated pixel pals: our own pixel cat and bat (tools/stickers/pixel.py).
  // (The id says 'aliaa' because ids are permanent; the art that name came from is gone.)
  {
    id: 'emote-pack-aliaa',
    type: 'emote-pack',
    name: 'Pixel pals pack',
    rarity: 'rare',
    emoji: '👾',
    price: 300,
    emotes: [
      { img: '/emotes/pixel/cat-wow.webp', slug: 'pixel-wow', name: 'Pixel cat wow' },
      { img: '/emotes/pixel/cat-shock.webp', slug: 'pixel-shock', name: 'Pixel cat shock' },
      { img: '/emotes/pixel/cat-handstand.webp', slug: 'pixel-flip', name: 'Pixel cat handstand' },
      { img: '/emotes/pixel/bat.webp', slug: 'pixel-bat', name: 'Pixel bat' },
    ],
  },
  // Our own art (tools/stickers/brainrot.mjs): the Ludo pawn mascot and the dice character
  {
    id: 'emote-pack-brainrot',
    type: 'emote-pack',
    name: 'Brainrot pack',
    rarity: 'epic',
    emoji: '🧠',
    price: 200, priceCurrency: 'gems',
    emotes: [
      { img: '/emotes/brainrot/aura-plus.webp', slug: 'aura-plus', name: '+1000 aura' },
      { img: '/emotes/brainrot/aura-minus.png', slug: 'aura-minus', name: '-1000 aura' },
      { img: '/emotes/brainrot/cooked.webp', slug: 'cooked', name: 'Bro is cooked' },
      { img: '/emotes/brainrot/skill-issue.png', slug: 'skill-issue', name: 'Skill issue' },
      { img: '/emotes/brainrot/w.webp', slug: 'big-w', name: 'W' },
      { img: '/emotes/brainrot/l.png', slug: 'big-l', name: 'L' },
      { img: '/emotes/brainrot/no-cap.png', slug: 'no-cap', name: 'No cap' },
      { img: '/emotes/brainrot/sigma.png', slug: 'sigma', name: 'Sigma' },
    ],
  },
  {
    id: 'emote-pack-dicerot',
    type: 'emote-pack',
    name: 'Dice brainrot pack',
    rarity: 'epic',
    emoji: '🎲',
    price: 200, priceCurrency: 'gems',
    emotes: [
      { img: '/emotes/dicerot/rigged.webp', slug: 'rigged', name: 'Rigged' },
      { img: '/emotes/dicerot/six-seven.webp', slug: 'six-seven', name: '6 7' },
      { img: '/emotes/dicerot/sus.webp', slug: 'sus', name: 'Sus' },
      { img: '/emotes/dicerot/touch-grass.png', slug: 'touch-grass', name: 'Touch grass' },
      { img: '/emotes/dicerot/its-giving.webp', slug: 'its-giving', name: "It's giving" },
      { img: '/emotes/dicerot/gg-ez.png', slug: 'gg-ez', name: 'GG EZ' },
      { img: '/emotes/dicerot/rizz.webp', slug: 'rizz', name: 'Rizz' },
      { img: '/emotes/dicerot/npc.png', slug: 'npc', name: 'NPC' },
    ],
  },
  // Profile frames (VIP): a ring around your avatar wherever people see it (the menu, the
  // seats, the players' list). Gems only.
  // Battle Pass exclusives (`pass`: the season they come from, shared/pass.js). Never sold: earned
  // on the pass's track only, so `price` is 0 and only whoever earned one owns it.
  { id: 'token-samurai', type: 'token', name: 'Samurai', rarity: 'legendary', price: 0, pass: 1, perk: 'An armoured samurai helmet in your colour, on a steel pedestal. Battle Pass Season 1 only.' },
  { id: 'token-football', type: 'token', name: 'Football', rarity: 'epic', price: 0, pass: 1, desc: 'Gloves, boots, a whistle, the flag and the cup: each colour its own piece of the match. Battle Pass Season 1 only.' },
  { id: 'board-dojo', type: 'board', name: 'Cyber Dojo', rarity: 'legendary', price: 0, pass: 1, perk: 'Woven carbon and glowing circuit tiles. Battle Pass Season 1 only.' },
  { id: 'board-pitch', type: 'board', name: 'Pitch', rarity: 'epic', price: 0, pass: 1, desc: 'A striped football pitch with chalk lines. Battle Pass Season 1 only.' },
  {
    id: 'emote-pack-mascot',
    type: 'emote-pack',
    name: 'Dice & Pawn pack',
    rarity: 'epic',
    emoji: '🎲',
    price: 0,
    pass: 1,
    emotes: [
      { img: '/emotes/mascot/dice-king.webp', slug: 'diceking', name: 'Dice king' },
      { img: '/emotes/mascot/dice-rage.webp', slug: 'dicerage', name: 'Dice rage' },
      { img: '/emotes/mascot/dice-rofl.webp', slug: 'dicerofl', name: 'Dice ROFL' },
      { img: '/emotes/mascot/dice-thumbsup.webp', slug: 'dicethumbs', name: 'Dice thumbs up' },
      { img: '/emotes/mascot/pawn-cool.webp', slug: 'pawncool', name: 'Cool pawn' },
      { img: '/emotes/mascot/pawn-dizzy.webp', slug: 'pawndizzy', name: 'Dizzy pawn' },
      { img: '/emotes/mascot/pawn-facepalm.webp', slug: 'pawnfacepalm', name: 'Facepalm pawn' },
      { img: '/emotes/mascot/pawn-panic.webp', slug: 'pawnpanic', name: 'Panicking pawn' },
      { img: '/emotes/mascot/pawn-party.webp', slug: 'pawnparty', name: 'Party pawn' },
    ],
  },
  { id: 'frame-none', type: 'frame', name: 'No frame', rarity: 'common', price: 0 },
  { id: 'frame-bronze', type: 'frame', name: 'Walnut', rarity: 'rare', price: 250, img: '/frames/frame-walnut.webp', desc: 'A turned walnut ring with a deep, polished grain.' },
  { id: 'frame-gold', type: 'frame', name: 'Gold', rarity: 'epic', price: 120, priceCurrency: 'gems', img: '/frames/frame-gold.webp', desc: 'Ornate gold scrollwork set with little jewels, catching the light.' },
  { id: 'frame-flame', type: 'frame', name: 'Flame', rarity: 'legendary', price: 250, priceCurrency: 'gems', img: '/frames/frame-flame.webp', perk: 'Real flames curl round your picture, flickering and breathing.' },
  { id: 'frame-crown', type: 'frame', name: 'Crown', rarity: 'legendary', price: 300, priceCurrency: 'gems', img: '/frames/frame-crown.webp', perk: 'A royal gold crown sits on top of your picture, glinting.' },
  { id: 'frame-neon', type: 'frame', name: 'Cyber Neon', rarity: 'legendary', price: 280, priceCurrency: 'gems', vip: true, img: '/frames/frame-cyber-neon.webp', perk: 'Neon circuits in cyan and magenta, softly pulsing.' },
  // Won, never bought: the top three of a weekly or monthly leaderboard get these (award: how to win)
  { id: 'frame-rank-1', type: 'frame', name: 'Champion', rarity: 'legendary', price: 0, award: 'Finish 1st on a weekly or monthly leaderboard', img: '/frames/frame-rank-1.webp' },
  { id: 'frame-rank-2', type: 'frame', name: 'Runner-up', rarity: 'epic', price: 0, award: 'Finish 2nd on a weekly or monthly leaderboard', img: '/frames/frame-rank-2.webp' },
  { id: 'frame-rank-3', type: 'frame', name: 'Gladiator', rarity: 'rare', price: 0, award: 'Finish 3rd on a weekly or monthly leaderboard', img: '/frames/frame-rank-3.webp' },
];

export const ITEMS = Object.fromEntries(SHOP_ITEMS.map((item) => [item.id, item]));

// Rarity: set on each item (not worked out from its price), shown on every item and used to
// group the shop. `min`/`max` is the price band its items must stay in (test/sets.test.js).
// gemMin/gemMax: the band for items priced in gems.
export const RARITIES = [
  { id: 'legendary', label: 'Legendary', min: 1000, max: 1500, gemMin: 200, gemMax: 350 },
  { id: 'epic', label: 'Epic', min: 400, max: 600, gemMin: 100, gemMax: 200 },
  { id: 'rare', label: 'Rare', min: 200, max: 350, gemMin: 40, gemMax: 100 },
  { id: 'common', label: 'Common', min: 0, max: 150, gemMin: 0, gemMax: 0 },
];
// What an item (or a set) is paid in: 'coins' or 'gems'
export const currencyOf = (item) => (item?.priceCurrency === 'gems' ? 'gems' : 'coins');
// A set is paid in gems when anything in it is (Legendary sets are Legendary all through)
export const setCurrency = (set) => (set.items.some((id) => currencyOf(ITEMS[id]) === 'gems') ? 'gems' : 'coins');
const RARITY_BY_ID = Object.fromEntries(RARITIES.map((r) => [r.id, r]));
export const rarityOf = (item) => RARITY_BY_ID[item.rarity] || RARITY_BY_ID.common;
// A set is as rare as the rarest thing in it (they all match: see the note at the top).
export const setRarity = (set) => RARITIES.find((r) => set.items.some((id) => ITEMS[id].rarity === r.id));

// Today's deal: one token, dice, board or taunt (priced in coins) a day at 30% off, the same one for everybody. It is
// picked from the date (the UTC day, like the quests), so the server and every client agree
// without anything being stored. Sets and stickers are never the deal.
export const DEAL_DISCOUNT = 0.3;
export const dayKeyOf = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
export function dailyDeal(day = dayKeyOf()) {
  const pool = SHOP_ITEMS.filter((i) => ['token', 'dice', 'board', 'taunt'].includes(i.type) && i.price > 0 && currencyOf(i) === 'coins');
  let h = 2166136261;
  for (const ch of `deal-${day}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return pool[(h >>> 0) % pool.length];
}
// What an item costs today (rounded to the nearest 10 when it is the deal)
export const priceOf = (item, day = dayKeyOf()) => (dailyDeal(day).id === item.id ? Math.round((item.price * (1 - DEAL_DISCOUNT)) / 10) * 10 : item.price);

// Sets: a matching token, dice and board (or two of them), 10% off what they cost apart. Already
// own some of a set? You pay for the rest, still 10% off.
export const SET_DISCOUNT = 0.1;
export const SETS = [
  { id: 'set-constellation', name: 'Constellation set', items: ['token-constellation', 'dice-constellation', 'board-constellation'] },
  { id: 'set-royal', name: 'Royal set', items: ['token-crown', 'dice-gold', 'board-royal'] },
  { id: 'set-dragon', name: 'Dragon set', items: ['token-dragon', 'dice-dragon', 'board-lair'] },
  { id: 'set-rocket', name: 'Rocket set', items: ['token-rocket', 'dice-comet', 'board-space'] },
  // (the Space board is in both space sets: whoever has one pays only for what's missing of the other)
  { id: 'set-ufo', name: 'UFO set', items: ['token-ufo', 'dice-alien', 'board-space'] },
  { id: 'set-neon', name: 'Neon set', items: ['token-neon', 'dice-neon', 'board-neon'] },
  { id: 'set-cat', name: 'Cat set', items: ['token-cat', 'dice-cat', 'board-cat'] },
  { id: 'set-ghost', name: 'Ghost set', items: ['token-ghost', 'dice-ghost', 'board-haunted'] },
  { id: 'set-robot', name: 'Robot set', items: ['token-robot', 'dice-robot', 'board-factory'] },
  { id: 'set-slime', name: 'Slime set', items: ['token-slime', 'dice-slime', 'board-swamp'] },
  { id: 'set-duck', name: 'Rubber Duck set', items: ['token-duck', 'dice-duck', 'board-ocean'] },
  { id: 'set-penguin', name: 'Penguin set', items: ['token-penguin', 'dice-snowball'] },
  { id: 'set-checker', name: 'Checker set', items: ['token-checker', 'dice-ludo'] },
  { id: 'set-candy', name: 'Candy set', items: ['token-candy', 'dice-candy', 'board-candy'] },
  { id: 'set-sakura', name: 'Sakura set', items: ['token-sakura', 'dice-sakura', 'board-sakura'] },
  { id: 'set-crystal', name: 'Crystal set', items: ['token-dino', 'board-crystal'] },
  { id: 'set-lava', name: 'Lava set', items: ['dice-lava', 'board-lava'] },
  { id: 'set-ice', name: 'Ice set', items: ['dice-ice', 'board-ice'] },
  { id: 'set-wood', name: 'Wood set', items: ['dice-wood', 'board-wood'] },
  { id: 'set-midnight', name: 'Midnight set', items: ['dice-midnight', 'board-midnight'] },
];
export const SETS_BY_ID = Object.fromEntries(SETS.map((set) => [set.id, set]));

// What a set costs this player: { full, price, missing, currency } (price 0 and no missing items:
// owned). Every item in a set is paid in the same currency (test/sets.test.js checks).
export function setPrice(set, profile) {
  const missing = set.items.filter((id) => !ownsItem(profile, id));
  const full = missing.reduce((sum, id) => sum + ITEMS[id].price, 0);
  return { full, price: Math.round(full * (1 - SET_DISCOUNT)), missing, currency: setCurrency(set) };
}

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


export const DEFAULT_EQUIPPED = { token: 'token-classic', dice: 'dice-classic', board: 'board-classic', taunt: 'taunt-none', frame: 'frame-none' };

// Free items are owned by everyone.
export function ownsItem(profile, id) {
  const item = ITEMS[id];
  if (!item) return false;
  if (item.award || item.pass) return !!profile?.owned.includes(id); // won or earned on the Battle Pass, not free
  if (item.price === 0 || !!profile?.owned.includes(id)) return true;
  // some items come free with another one you own (see `freeWith`)
  return !!item.freeWith && !!profile?.owned.includes(item.freeWith);
}

// ---------- real-money gem packs and tips (paid through Discord) ----------
// The prices live in the Discord Developer Portal (one consumable SKU each); SHOP_SKUS in .env
// links each id here to its SKU. Real money buys VIP Gems only, never Gold Coins (coins are
// earned, and are what stakes rooms are played for). Bigger packs give more gems per pound/dollar
// (suggested prices £0.99 / £2.49 / £4.99 / £9.99). The ids stay pack-1..4 so the SKUs carry over.
export const COIN_PACKS = [
  { id: 'pack-1', gems: 100, name: 'Pouch of gems' },
  { id: 'pack-2', gems: 220, name: 'Bag of gems', bonus: 10 },
  { id: 'pack-3', gems: 600, name: 'Chest of gems', bonus: 20 },
  { id: 'pack-4', gems: 1300, name: 'Vault of gems', bonus: 30 },
];
export const GEM_PACKS = COIN_PACKS;
// "Buy me a coffee": fixed tips through Discord (any amount goes through TIP_URL instead).
export const TIPS = [
  { id: 'coffee-1', name: 'Small coffee', icon: '☕' },
];
// (coffee-2 and coffee-3, a large coffee and coffee and cake, were planned; their ids stay free)
// The Battle Pass: a monthly subscription SKU (shared/pass.js). Never consumed: the server reads
// when the current period ends, and the premium lane is open until then.
export const PASS_SKU_ID = 'pass';
export const PAID_ITEMS = Object.fromEntries([
  ...COIN_PACKS.map((p) => [p.id, { ...p, kind: 'gems' }]),
  ...TIPS.map((t) => [t.id, { ...t, kind: 'tip' }]),
  [PASS_SKU_ID, { id: PASS_SKU_ID, name: 'Battle Pass', kind: 'pass' }],
]);

// Shop items new in the latest update: tagged "New" in the shop until the player has looked at
// them (on each device). Change this list with each update that adds items; items added later
// than a player's first visit are tagged automatically anyway.
export const NEW_ITEMS = new Set(['frame-neon', 'frame-rank-1', 'frame-rank-2', 'frame-rank-3', 'frame-bronze', 'frame-gold', 'frame-flame', 'frame-crown', 'emote-buffcat', 'emote-eatingchips', 'emote-cozykitten', 'emote-wadafak', 'emote-cathello', 'token-dino', 'board-crystal', 'emote-blepcat', 'token-sakura', 'dice-sakura', 'token-robot', 'token-penguin', 'token-ufo', 'token-dragon', 'dice-bubble', 'dice-slime', 'dice-robot', 'dice-ghost', 'dice-duck', 'dice-snowball', 'dice-comet', 'dice-alien', 'dice-dragon', 'taunt-bonk', 'taunt-bye', 'taunt-chicken', 'taunt-violin', 'taunt-clown', 'taunt-l', 'taunt-ggez', 'taunt-skill', 'taunt-cackle', 'taunt-fireworks', 'board-desert', 'board-sakura', 'board-arcade', 'board-haunted', 'board-swamp', 'board-factory', 'board-space', 'board-lair']);

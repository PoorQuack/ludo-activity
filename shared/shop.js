// Everything in the shop. Prices are in coins, which players earn by finishing games.

export const STARTING_COINS = 150;

// Coins by finishing place (1st, 2nd, …) plus a bonus per capture.
// A game with only one human pays `soloFactor` of that, so farming bots is slower.
export const REWARDS = { place: [100, 60, 40, 30, 25, 20], capture: 10, soloFactor: 0.5 };

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

  { id: 'emote-thumbs', type: 'emote', name: 'Thumbs up', emoji: '👍', price: 0 },
  { id: 'emote-laugh', type: 'emote', name: 'Laugh', emoji: '😂', price: 0 },
  { id: 'emote-wow', type: 'emote', name: 'Wow', emoji: '😮', price: 0 },
  { id: 'emote-fire', type: 'emote', name: 'Fire', emoji: '🔥', price: 100 },
  { id: 'emote-cool', type: 'emote', name: 'Cool', emoji: '😎', price: 100 },
  { id: 'emote-cry', type: 'emote', name: 'Cry', emoji: '😭', price: 100 },
  { id: 'emote-party', type: 'emote', name: 'Party', emoji: '🎉', price: 150 },
  { id: 'emote-skull', type: 'emote', name: 'Skull', emoji: '💀', price: 150 },
  { id: 'emote-clown', type: 'emote', name: 'Clown', emoji: '🤡', price: 200 },
  { id: 'emote-crown', type: 'emote', name: 'Crown', emoji: '👑', price: 300 },
];

export const ITEMS = Object.fromEntries(SHOP_ITEMS.map((item) => [item.id, item]));

export const DEFAULT_EQUIPPED = { token: 'token-classic', dice: 'dice-classic', board: 'board-classic' };

// Free items are owned by everyone.
export function ownsItem(profile, id) {
  const item = ITEMS[id];
  return !!item && (item.price === 0 || !!profile?.owned.includes(id));
}

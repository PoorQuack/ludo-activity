// Every dice and board sold in the shop has a look defined (a missing one would draw as Classic).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SHOP_ITEMS } from '../shared/shop.js';
import { DICE_STYLES, BOARD_THEMES } from '../client/skins.js';

test('every shop dice and board has a style', () => {
  for (const item of SHOP_ITEMS) {
    if (item.type === 'dice') assert.ok(DICE_STYLES[item.id], `${item.id} has no dice style`);
    if (item.type === 'board') {
      const theme = BOARD_THEMES[item.id];
      assert.ok(theme, `${item.id} has no board theme`);
      for (const c of ['red', 'green', 'yellow', 'blue', 'purple', 'orange']) assert.match(theme.players[c], /^#[0-9a-f]{6}$/i, `${item.id} ${c}`);
    }
  }
});

test('every board has a safe-square shield and its textures exist', async () => {
  const { existsSync } = await import('node:fs');
  const shields = ['bubble', 'fire', 'frost', 'force', 'candy', 'orbit', 'constellation'];
  for (const [id, theme] of Object.entries(BOARD_THEMES)) {
    const s = theme.art?.shield;
    assert.ok(shields.includes(typeof s === 'string' ? s : s?.kind), `${id} has no shield`);
    const specs = [...Object.values(theme.art.tex || {}), theme.art.under].filter(Boolean);
    for (const spec of specs) assert.ok(existsSync(new URL(`../client/public${spec.src}`, import.meta.url)), `${id}: ${spec.src} missing`);
  }
});

test('the Nervous cat comes free with the Hamster pack, and the pack has no cat in it', async () => {
  const { ownsItem, ITEMS } = await import('../shared/shop.js');
  assert.equal(ownsItem({ owned: ['emote-pack-hamster'] }, 'emote-nervouscat'), true);
  assert.equal(ownsItem({ owned: [] }, 'emote-nervouscat'), false);
  assert.equal(ownsItem({ owned: ['emote-nervouscat'] }, 'emote-nervouscat'), true);
  assert.ok(ITEMS['emote-pack-hamster'].emotes.every((e) => e.img.startsWith('/emotes/hamster/') && !/cat/.test(e.img)));
});

test('every sticker pack is our own art: its files exist and live in our own folders', () => {
  const ours = ['hamster', 'fox', 'kitty', 'pixel', 'brainrot', 'dicerot'];
  const slugs = new Set();
  for (const pack of SHOP_ITEMS.filter((i) => i.type === 'emote-pack')) {
    for (const e of pack.emotes) {
      assert.ok(ours.includes(e.img.split('/')[2]), `${pack.id}: ${e.img} is not in one of our folders`);
      assert.ok(fs.existsSync(new URL(`../client/public${e.img}`, import.meta.url)), `${e.img} is missing`);
      assert.ok(!slugs.has(e.slug), `two stickers share the code :${e.slug}:`);
      slugs.add(e.slug);
    }
  }
});

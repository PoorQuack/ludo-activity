// Every dice and board sold in the shop has a look defined (a missing one would draw as Classic).
import test from 'node:test';
import assert from 'node:assert/strict';
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

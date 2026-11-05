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

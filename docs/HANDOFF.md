# Where things stand (25 November 2026, evening)

## Live on ludo.commontern.com (branch `main`)
- Chat translation: NVIDIA Nemotron 3.5 Lightning checks the language, Riva Translate translates
  (with four Ludo example phrases in each of 37 languages), Google then MyMemory if NVIDIA is busy.
  Key: `NVIDIA_API_KEY` in the VM's `.env` (same key as Scottbott).
- Chat language setting (Settings → Language → Chat language): 37 languages.
- Phones: pop-ups start below Discord's bar; Settings tabs fit narrow phones.
- Chats (in game, Global, language, DMs): beige, picture + name above a bubble in the player's
  colour, Translate chip outside the bubble, times between gaps, Arabic reads right to left.

## Ready but NOT live (branch `shop-v3`)
Everything above, plus:
- **New gem prices**: Epic 150–250, Legendary 400–600 gems; Battle Pass premium lane 380 gems.
- **Shop front page (Featured tab)**: featured Legendary (changes every 3 days), Starter Pack card,
  today's 3 deals (−30%), limited items this week, two bundles.
- **Limited items**: in the shop one week at a time ("⏳ Back soon" otherwise; the server refuses).
- **Starter Pack** (£1.99, once per player): 300 gems, 500 coins, Jade dice (only in the pack).
- **First gem pack doubled**, shown in the gem store and the web store.
- **Can't afford something**: the gem store opens and highlights the pack that covers it.
- **"≈ £…" under gem prices**, from Discord's prices (only shows inside Discord).
- **All In** scores 1.5× for losses as well as wins (trading wins no longer farms the board).
- **House fee**: 5% of stakes pots from 200 coins, at most 250 per game (coins leave the game).
- **Leaderboard footer** warns that from 1 December it ranks coins won in public stakes rooms.
- **DM safety** (from the audit): DMs only to real players, at most 10 new chats with strangers a day.
- 262 tests pass; checked on PC and phones, in English, German and Arabic.

## Before deploying `shop-v3`
1. Discord Developer Portal → Monetization → new **Durable** SKU "Starter Pack", £1.99.
   Add `starter:<SKU id>` to `SHOP_SKUS` in the VM's `.env`. (Until then the Starter Pack card
   simply doesn't show.)
2. Optional, for the web store: a £1.99 Stripe price, added as `starter:price_…` to `STRIPE_PRICES`.
3. Deploy: merge `shop-v3` into `main` (it is `main` plus the commits above), push, then on the VM
   `cd ~/ludo-activity && bash scripts/deploy.sh`. The server restarts; open games carry over.

## Numbers worth knowing
- Pot split by place: 2p 100 · 3p 70/30 · 4p 60/30/10 · 5p 50/25/15/10 · 6p 45/25/15/10/5.
- The fee lives in `shared/shop.js` (`POT_FEE`, `POT_FEE_MIN`, `POT_FEE_MAX`); set `POT_FEE = 0`
  to turn it off.

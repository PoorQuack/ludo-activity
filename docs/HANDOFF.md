# Handover notes

Newest entry first. Whoever finishes a piece of work adds an entry: date, who, branch, what
changed (item ids), and anything half-done. Rules for agents: see `AGENTS.md`.

## 26 Nov 2026, Claude: state of `main` (live on ludo.commontern.com)
- Translation: DeepL → Azure → NVIDIA Riva → Google → MyMemory, with Indonesian slang rewriting
  and player ratings ("Rate" on a translation; 3 matching suggestions become the translation).
  Keys live only in the VM's `.env`.
- Every purchase goes through the Stripe checkout link (web store); Discord's own purchase
  window is only a fallback if Stripe is switched off. Gifting is removed.
- All In rooms show in the main room list with an ALL IN tag.
- Design pass: crown Pass icon, line icons in buttons (`client/icons.js`), rarity rings on shop
  cards, calmer chat, toasts clear of buttons, phone game screen with a player strip under the
  board and the tutorial docked at the bottom.
- Antigravity (merged): redrawn taunt cards, painted icons (crown/gift/pass/scroll/trophy),
  monthly leaderboard frames (`frame-month-1..3`), 10 new bundles (token/dice/board/set each:
  woodland-grove, street-playground, space-odyssey, pharaohs-oasis, mystic-alchemy,
  christmas-holiday, turtle-lotus, pirates-cove, celestial-olympus, steampunk-workshop).
- To do (art): the shop previews for the Woodland Grove, Street Playground, Space Odyssey and
  Pharaoh's Oasis tokens are small and dark; redraw them bigger and brighter.
- To do (owner): Starter Pack needs a Discord Durable SKU (`starter:<id>` in `SHOP_SKUS`) and a
  Stripe price (`starter:price_…` in `STRIPE_PRICES`).

---

## Older notes (25 Nov 2026)

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

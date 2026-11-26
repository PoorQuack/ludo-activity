# Rules for AI agents working on this repo

Two agents work here: **Antigravity (Gemini)** and **Claude**. The owner gives each one tasks.
Read this whole file before every task. If a task from the owner clashes with a rule here,
ask the owner first and don't guess.

## Who does what

| | Antigravity (Gemini) | Claude |
|---|---|---|
| Art: item pictures, icons, frames, boards, dice, tokens, banners | **yes** | wires it in |
| Drawing code: `client/draw-*.js`, `client/taunts.js`, `client/skins.js`, visual CSS | yes | yes |
| New shop items in `shared/shop.js` (inside the price bands below) | yes | yes |
| Server (`server/`), payments, Stripe/Discord SKUs, translation, security | **no** | yes |
| Prices of existing items, coin/gem amounts, rewards, the economy | **no** (ask the owner) | with the owner |
| Tests, merging into `main`, **deploying** | **no** | **yes** |

## How to hand work over (Antigravity)

1. Start from the latest main: `git fetch origin && git checkout -b antigravity/<topic> origin/main`.
2. Work on that branch only. **Never commit to `main` and never deploy.** Don't ssh into
   the server and don't run `scripts/deploy.sh`.
3. Before pushing, run `npm run build` and `npm test`. Both must pass.
4. Push the branch: `git push origin antigravity/<topic>`.
5. Add a short entry at the top of `docs/HANDOFF.md`: the branch name, what changed, which
   item ids, and anything half-done.
6. Tell the owner "pushed antigravity/<topic>". Claude reviews it, checks it on phone and
   desktop, merges it into `main` and deploys it.

Art only, no code? Put the files in `art/incoming/<type>/` with a line for each one in
`art/incoming/NOTES.md` (file → what it is → item id). Claude wires them in.

## Never

- Commit `.env` or any key or token, or print them. Don't edit `.env` or `ecosystem.config.cjs`.
- Touch `server/`, `scripts/deploy.sh`, or anything about payments, SKUs or Stripe.
- Change the price, rarity or currency of an item that already exists.
- Remove or rename an item id that players may own (it would vanish from their collection).
- Force-push, rewrite history, or delete branches that aren't yours.
- Bake words into images. The game is in 15 languages, so put text in code and translate it.
- Use real brands, logos, or copyrighted characters.

## Price bands (new items must fit)

| Rarity | Currency | Tokens / Dice | Boards |
|---|---|---|---|
| Common | coins | 100–150 | 120–180 |
| Rare | coins | 200–350 | 300–350 |
| Epic | gems | 150–220 | 160–250 |
| Legendary | gems | 400–500 | 500–600 |

Taunts: Rare 250–300 coins, Epic about 100 gems. Frames follow the same rarity bands.
Anything outside these bands needs the owner's OK.

## Art rules

- Match `client/public/icons/coin.webp`, `client/public/icons/gem.webp` and the Dragon's lair
  board: painted, glossy, light from the top-left, soft shadow, a clear outline that still reads
  at about 40 px.
- Palette: background `#18130f` / `#241d17`, cream `#f7efe6`, Ludo red `#d9573b`, green,
  gold `#f2bf3f`, blue. Gems are jade `#37c8b0`.
- `.webp` with a transparent background unless the item needs one, sRGB, under ~120 KB a file.
- Shop previews must **fill their card**. A token set should be as big and bright as Candy
  or Neon, not small and dark in the middle.
- Sizes: icons 128×128; frames 384×384; taunt/preview cards 480×320; tokens about 150×220
  each; board textures 512×512 or larger.

## Text and translations

- Every string the player sees goes through `t('…')` (or `data-i18n` in HTML).
- After adding or changing text, run `python3 tools/i18n/extract.py` and add the
  translation to all 15 files in `client/locales/`. `npm test` fails if one is missing or unused.
- Locale files: `json.dumps(…, ensure_ascii=False, indent=2)` plus a final newline.

## Checks before you say it's done

- `npm run build` and `npm test` pass.
- Look at it on a narrow phone (390 px wide) and on a desktop window.
- No console errors when opening the shop, an item, "Try it" and a game.

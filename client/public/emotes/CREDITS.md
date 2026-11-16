# Sticker credits

## Our own stickers (every pack)

All the sticker **packs** are original art made for this game. Nothing in them is copied or
traced from anyone else's emoji, so they belong to the game and can be sold.

| Folder | Pack | Drawn in |
| --- | --- | --- |
| `hamster/` | Hamster pack | `tools/stickers/pals.mjs` (our round golden hamster) |
| `fox/` | Fox pack, Laugh pack | `tools/stickers/pals.mjs` (our fox) |
| `kitty/` | Kitty pack, Laugh pack | `tools/stickers/pals.mjs` (our grey tabby kitty) |
| `pixel/` | Pixel pals pack | `tools/stickers/pixel.py` (our pixel cat and bat) |
| `brainrot/` | Brainrot pack | `tools/stickers/brainrot.mjs` (the Ludo pawn mascot) |
| `dicerot/` | Dice brainrot pack | `tools/stickers/brainrot.mjs` (the dice character) |

To redraw them: `node tools/stickers/render.mjs <frames dir> ./pals.mjs`, then
`python3 tools/stickers/pack.py <frames dir> client/public/emotes`, and
`python3 tools/stickers/pixel.py client/public/emotes` for the pixel pals.

These packs used to be made from emoji packs shared on emoji.gg (Hamster, Toshi Reactions,
Kitty Emotions, White kitties, Aliaa). That art has been removed from the game.

## Single stickers (not ours)

The stickers sold one at a time still use art from elsewhere. The artists keep the rights to
their work. If you made one of these and want it credited differently or taken down, open an
issue and it will be removed.

| File | Source | Used in |
| --- | --- | --- |
| `cats/` | emoji.gg (Happy cat); stickers the owner supplied (Dancing kitten; Angry cat, white background removed; Shoo shoo cat, from a Klipy clip; Rude cat, background removed; Sad kitten, background removed; Nervous cat) | Happy cat, Dancing kitten, Angry cat, Shoo shoo cat, Rude cat, Sad kitten, Nervous cat stickers |
| `meme/dumb.png` | [dumb](https://emoji.gg/emoji/399151-dumb) (background removed) | Dumb sticker (free with the Laugh pack) |
| `meme/dontjoke.webp` | the "don't even joke lad" chick meme, supplied by the owner (framed, background kept) | Don't even joke lad sticker |

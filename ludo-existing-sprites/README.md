# Ludo Existing Sprites Bundle for Gemini Carbon

This folder contains all existing game artwork prior to Carbon reworks, split into:

1. `raster/` — Existing raster files currently in `client/public/`:
   - `tokens/` — `dino-*`, `dragon-*`, `football-*`, `samurai-*` (`.webp`)
   - `textures/` — 22 board surface & tile textures (`.jpg`)
   - `frames/` — All 14 avatar frames (weekly `frame-rank-1..3`, monthly `frame-month-1..3`, all-time `frame-all-1..3`, shop frames)
   - `icons/` — 7 painted UI HUD icons (`coin`, `gem`, `trophy`, `crown`, `gift`, `pass`, `scroll`)
   - `emotes/` — All existing sticker packs

2. `procedural/` — High-resolution PNG exports rendered directly from our Canvas code so Carbon has exact visual references for every procedural skin:
   - `tokens/<id>/token_{red,green,yellow,blue}.png` (156x220 transparent)
   - `dice/<id>/die_{1..6}.png` (128x128 transparent)
   - `boards/<id>.png` (512x512 rendered 4-player board)

3. `manifest.json` — Exact item IDs, rarities, names, existing sets, and Carbon output format specs (`tokenSpec`, `tileSpec`, `boardBgSpec`, `dieFaceSpec`, `dieIsoSpec`, `dieGlowSpec`, `tokenGlowSpec`).

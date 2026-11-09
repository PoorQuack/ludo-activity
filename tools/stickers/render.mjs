// Renders the stickers in brainrot.mjs: node render.mjs <out dir>
// Writes <out>/<pack>/<slug>-<frame>.png for every frame (frame 0 only for still stickers),
// then pack.py turns those into the game's PNG / animated WebP files.
import fs from 'node:fs';
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
import { PACKS, svgFor } from './brainrot.mjs';

const out = process.argv[2] || '/tmp/stickers';
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const p = await b.newPage({ viewport: { width: 192, height: 192 }, deviceScaleFactor: 1 });
for (const [pack, { stickers }] of Object.entries(PACKS)) {
  fs.mkdirSync(`${out}/${pack}`, { recursive: true });
  for (const s of stickers) {
    const n = s.frames || 1;
    for (let f = 0; f < n; f++) {
      await p.setContent(`<html><body style="margin:0;background:transparent">${svgFor(s, f / n)}</body></html>`);
      await p.locator('svg').screenshot({ path: `${out}/${pack}/${s.slug}-${String(f).padStart(2, '0')}.png`, omitBackground: true });
    }
    console.log(pack, s.slug, n);
  }
}
await b.close();

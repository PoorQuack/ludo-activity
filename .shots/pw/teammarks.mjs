import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const S = process.env.HOME + '/mnt/ludo-activity/.shots/';
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
for (const mode of (process.argv[2] ? [process.argv[2]] : ['2 vs 2', '3 vs 3'])) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:3990/?name=Ann', { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
  await p.click('#create-btn'); await p.waitForTimeout(500);
  await p.click(`#mode-picker button:has-text("${mode}")`); await p.waitForTimeout(400);
  if (await p.isVisible('#fill-btn')) await p.click('#fill-btn'); await p.waitForTimeout(400);
  await p.click('#start-btn'); await p.waitForTimeout(1500);
  for (let i = 0; i < 25; i++) { const c = await p.$('#board'); const bb = await c.boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2).catch(() => {}); await p.waitForTimeout(500); const d = await p.evaluate(() => window.__dbg?.()); if (d?.pin) { await p.mouse.click(d.pin.x, d.pin.y); const ch = await p.$('#roll-chooser:not(.hidden) button'); if (ch) await ch.click(); } }
  await p.waitForTimeout(1500);
  const c = await p.$('#board');
  const bb = await c.boundingBox(); await p.screenshot({ path: S + `teammarks-${mode[0]}.png`, clip: bb });
  console.log(mode, 'errors:', errs.join(' / ') || 'none');
  await p.close();
}
await b.close();

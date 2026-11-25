import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const S = process.env.HOME + '/mnt/ludo-activity/.shots/';
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
for (const [w, h] of [[390, 700], [360, 600]]) {
  await p.setViewportSize({ width: w, height: h });
  await p.goto('http://localhost:3990/?name=Ann', { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
  await p.click('.menu-tools [data-player-btn]'); await p.waitForTimeout(300);
  await p.screenshot({ path: `/tmp/look-${w}-a.png` });
  await p.click('#support-open'); await p.waitForTimeout(300);
  await p.screenshot({ path: `/tmp/look-${w}-b.png` });
  await p.click('#support [data-kind="feedback"]'); await p.waitForTimeout(200);
  await p.screenshot({ path: `/tmp/look-${w}-c.png` });
  await p.keyboard.press('Escape');
}
await b.close();

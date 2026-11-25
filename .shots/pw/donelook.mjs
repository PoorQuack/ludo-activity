import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
const shots = [];
for (const [w, h] of [[1280, 760], [390, 700]]) {
  await p.setViewportSize({ width: w, height: h });
  await p.goto('http://localhost:3990/?name=Ann', { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
  await p.click('.menu-tools [data-player-btn]'); await p.click('#support-open'); await p.click('#support [data-kind="feedback"]');
  await p.click('[data-q="topic"] [data-v="boards"]'); await p.fill('[data-for="feedback"] [data-q="text"]', 'A space board would be sick');
  await p.click('#support-send'); await p.waitForTimeout(1200);
  const box = await p.$eval('#support-done', (e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; });
  console.log(w, 'done card size', box);
  await p.screenshot({ path: `/tmp/done-${w}.png` });
}
await b.close();

import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const S = process.env.HOME + '/mnt/ludo-activity/.shots/';
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
p.on('dialog', (d) => d.accept());
await p.goto('http://localhost:3990/?name=Ann', { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
await p.click('#create-btn'); await p.waitForTimeout(500);
await p.click('#mode-picker button:has-text("3 vs 3")'); await p.waitForTimeout(400);
await p.click('#fill-btn'); await p.waitForTimeout(400);
await p.screenshot({ path: S + 'team-lobby6.png', fullPage: true });
await p.click('#mode-picker button:has-text("2 vs 2")'); await p.waitForTimeout(400);
if (await p.isVisible('#fill-btn')) { await p.click('#fill-btn'); await p.waitForTimeout(400); }
await p.screenshot({ path: S + 'team-lobby4.png', fullPage: true });
await p.click('#start-btn'); await p.waitForTimeout(12000);
console.log('turn text samples:');
const seen = new Set();
for (let i = 0; i < 24; i++) {
  seen.add(await p.textContent('#turn-text'));
  const c = await p.$('#board'); const bb = await c.boundingBox();
  await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2).catch(() => {});
  await p.waitForTimeout(700);
}
console.log([...seen].map((x) => '   ' + x).join('\n'));
await p.screenshot({ path: S + 'team-game.png' });
await p.evaluate(() => document.getElementById('surrender-btn').click()); await p.waitForTimeout(300);
await p.evaluate(() => document.getElementById('surrender-btn').click()); await p.waitForTimeout(600);
const btns = await p.$$eval('button:visible', (bs) => bs.map((b) => b.textContent.trim()).filter((t) => /surrender|yes|give up/i.test(t)));
console.log('confirm buttons:', btns);
const yes = await p.$('button:visible:has-text("Yes")') || await p.$('.modal button:visible:has-text("Surrender")');
if (yes) await yes.click();
await p.waitForTimeout(1500);
console.log('banner:', (await p.textContent('#banner').catch(() => '')).replace(/\s+/g, ' '));
await p.screenshot({ path: S + 'team-end.png' });
console.log('errors:', errors.join(' / ') || 'none');
await b.close();

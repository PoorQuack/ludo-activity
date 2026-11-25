// Frames per second the page actually manages (GPU included) during a bot game, per mode/board.
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const [mode = '4', theme = '', strip = ''] = process.argv.slice(2);
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
if (process.env.SMOOTH) await p.addInitScript(() => localStorage.setItem('ludo-smooth', 'on'));
if (theme) await p.addInitScript((t) => (window.__theme = t), theme);
await p.goto('http://localhost:3990/?name=Ann', { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
await p.click('#create-btn'); await p.waitForTimeout(500);
if (mode !== '4') await p.click(`#mode-picker button:has-text("${mode}")`); await p.waitForTimeout(400);
if (await p.isVisible('#fill-btn')) await p.click('#fill-btn'); await p.waitForTimeout(400);
await p.click('#start-btn'); await p.waitForTimeout(1000);
if (strip) await p.evaluate((s) => { const a = window.__r.theme.art; for (const k of s.split(',')) delete a[k]; window.__r.size = 0; }, strip);
const fps = () => p.evaluate(() => new Promise((r) => { let n = 0; setTimeout(() => r(n), 1000); const g = () => { n++; requestAnimationFrame(g); }; requestAnimationFrame(g); }));
const out = [];
for (let i = 0; i < 8; i++) {
  const d = await p.evaluate(() => window.__dbg().pin);
  if (d) { await p.mouse.click(d.x, d.y); const ch = await p.$('#roll-chooser:not(.hidden) button'); if (ch) await ch.click(); }
  else { const c = await p.$('#board'); const bb = await c.boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); }
  out.push(await fps());
}
console.log(`${mode} ${theme || 'classic'} -${strip}: rAF/s ${out.join(' ')}`, errs.slice(0, 2).join(' / '));
await b.close();

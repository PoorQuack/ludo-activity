import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:3990/?name=Ann', { waitUntil: 'networkidle' }); await p.waitForTimeout(700);
await p.click('#create-btn'); await p.waitForTimeout(500);
await p.click('#fill-btn'); await p.waitForTimeout(300);
await p.click('#start-btn'); await p.waitForTimeout(1200);
const kb = () => p.evaluate(() => document.documentElement.classList.contains('kb-open'));
const input = await p.$('.chat-form input:visible');
// 1. leaving the app while typing
await input.tap(); await p.waitForTimeout(200);
console.log('typing:', await kb());
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
await p.waitForTimeout(200);
console.log('after leaving the app: kb-open =', await kb(), ', box focused =', await p.evaluate(() => document.activeElement?.matches('.chat-form input')));
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
await p.waitForTimeout(500);
console.log('board redrawn on return:', await p.evaluate(() => ({ px: document.getElementById('board').width, css: document.getElementById('board').style.width })));
// 2. a keyboard that never shows up (this test browser has none): back to normal on its own
await input.tap(); await p.waitForTimeout(300);
console.log('typing again:', await kb());
await p.waitForTimeout(1800);
console.log('no keyboard after 2s: kb-open =', await kb());
// 3. keyboard comes up, then is swiped away while the box keeps focus (iPhone)
await input.tap(); await p.waitForTimeout(100);
await p.setViewportSize({ width: 390, height: 500 }); await p.waitForTimeout(400);
console.log('keyboard up: kb-open =', await kb());
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
console.log('keyboard swiped away: kb-open =', await kb(), ', board', await p.evaluate(() => document.getElementById('board').style.width));
console.log('errors:', errs.join(' / ') || 'none');
await b.close();

import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:3990/?name=Ann', { waitUntil: 'networkidle' }); await p.waitForTimeout(700);
await p.click('#create-btn'); await p.waitForTimeout(500);
await p.click('#fill-btn'); await p.waitForTimeout(500);
await p.evaluate(() => { const s = document.querySelector('.bot-level'); s.__mine = 1; s.focus(); });
// room updates while the list is open: a second player joins and chats
const code = await p.evaluate(() => window.__dbg().state.code);
const q = await b.newPage({ viewport: { width: 390, height: 844 } });
await q.goto('http://localhost:3990/?name=Bob', { waitUntil: 'networkidle' }); await q.waitForTimeout(600);
await q.fill('#code-input', code); await q.click('#code-form button'); await q.waitForTimeout(800);
for (const t of ['one', 'two']) { await q.fill('.chat-form input:visible', t); await q.keyboard.press('Enter'); await q.waitForTimeout(400); }
await p.waitForTimeout(800);
console.log('chat lines Ann saw:', await p.$$eval('.chat-log li', (l) => l.length));
console.log('same list after updates:', await p.evaluate(() => !!document.querySelector('.bot-level').__mine && document.activeElement?.matches('.bot-level')));
await p.selectOption('.bot-level >> nth=0', 'hard'); await p.waitForTimeout(600);
await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(400);
console.log('after picking + closing:', await p.$$eval('.bot-level', (s) => s.map((x) => `${x.value}/${x.className}`)));
console.log('errors:', errs.join(' / ') || 'none');
await b.close();

import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:3990/?name=Ann', { waitUntil: 'networkidle' }); await p.waitForTimeout(700);
await p.click('#create-btn'); await p.waitForTimeout(500);
await p.click('#fill-btn'); await p.waitForTimeout(300);
await p.click('#start-btn'); await p.waitForTimeout(1200);
const chat = '#game .chat:not(.hidden)';
const input = await p.$(`${chat} .chat-form input`) || await p.$('.chat-form input:visible');
const say = async (t) => { await input.fill(t); await p.keyboard.press('Enter'); await p.waitForTimeout(1300); };
await say('first');
await p.evaluate(() => { for (const l of document.querySelectorAll('.chat-log')) if (l.firstElementChild) l.firstElementChild.__mark = 1; });
await say('second'); await say('third');
console.log('chat kept old lines:', await p.evaluate(() => [...document.querySelectorAll('.chat-log')].map((l) => `${l.children.length} lines, first kept: ${!!l.firstElementChild?.__mark}, texts: ${[...l.children].map((c) => c.textContent).join(' / ')}`)));
// focus stays in the box when using the sticker button
await input.tap(); await p.waitForTimeout(300);
console.log('kb-open after focusing:', await p.evaluate(() => document.documentElement.classList.contains('kb-open')));
const btn = await p.$('.chat-form [data-emoji-btn]:visible') || await p.$('[data-emoji-btn]:visible');
await btn.tap(); await p.waitForTimeout(300);
console.log('after sticker button: focus in box =', await p.evaluate(() => document.activeElement?.matches('.chat-form input')), 'picker open =', await p.evaluate(() => !!document.querySelector('.emoji-pop:not(.hidden)')));
const st = await p.$('.emoji-pop:not(.hidden) .emoji-grid button');
if (st) { await st.tap(); await p.waitForTimeout(300); console.log('after sticker: focus in box =', await p.evaluate(() => document.activeElement?.matches('.chat-form input')), 'value =', await input.inputValue()); }
else console.log('(no stickers owned to tap)');
// the visible area shrinks like a keyboard sliding up, in steps
const sizes = [];
for (const h of [800, 700, 600, 500, 450, 430]) { await p.setViewportSize({ width: 390, height: h }); await p.waitForTimeout(40); sizes.push(await p.evaluate(() => document.getElementById('board').style.width)); }
await p.waitForTimeout(500);
const settled = await p.evaluate(() => ({ css: document.getElementById('board').style.width, px: document.getElementById('board').width }));
console.log('board css during slide:', sizes.join(' '), '| settled:', JSON.stringify(settled));
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(600);
console.log('back:', await p.evaluate(() => ({ css: document.getElementById('board').style.width, px: document.getElementById('board').width })));
console.log('errors:', errs.join(' / ') || 'none');
await b.close();

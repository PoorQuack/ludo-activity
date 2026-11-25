// A forced 3-3 tie in 2 vs 2: what the decider looks like, and that you can play it.
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const S = process.env.HOME + '/mnt/ludo-activity/.shots/';
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
await p.goto('http://localhost:3990/?name=Ann', { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
await p.click('#create-btn'); await p.waitForTimeout(500);
await p.click('#mode-picker button:has-text("2 vs 2")'); await p.waitForTimeout(400);
if (await p.isVisible('#fill-btn')) await p.click('#fill-btn'); await p.waitForTimeout(400);
await p.click('#start-btn'); await p.waitForTimeout(1200);
const info = () => p.evaluate(() => ({
  toast: document.getElementById('toast').className.includes('hidden') ? '' : document.getElementById('toast').textContent,
  tag: document.getElementById('phase-tag')?.textContent,
  turn: document.getElementById('turn-text').textContent,
  seats: [...document.querySelectorAll('.seat')].map((c) => c.querySelector('.seat-name').textContent + ': ' + c.querySelector('.seat-sub').textContent + (c.classList.contains('turn') ? ' [turn]' : '')),
}));
console.log(JSON.stringify(await info(), null, 1));
const bb = await (await p.$('#board')).boundingBox();
await p.screenshot({ path: S + 'decider-1.png' });
const turns = new Set(); let myRolls = 0, myMoves = 0;
const T0 = Date.now();
while (Date.now() - T0 < 60000) {
  const d = await p.evaluate(() => { const d = window.__dbg(); return { pin: d.pin, phase: d.state.phase, myGo: d.myGo, rolled: d.state.rolled, dice: d.dice.mode, idle: d.idle }; });
  if (d.phase !== 'playing') break;
  turns.add(await p.textContent('#turn-text'));
  if (d.pin) { await p.mouse.click(d.pin.x, d.pin.y); const ch = await p.$('#roll-chooser:not(.hidden) button'); if (ch) await ch.click(); myMoves++; }
  else if (d.myGo && !d.rolled && d.dice === 'ready' && d.idle) { await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); myRolls++; }
  await p.waitForTimeout(250);
}
console.log('turn texts seen:', [...turns].slice(0, 14).join(' | '));
console.log('my rolls', myRolls, 'my moves', myMoves);
console.log(JSON.stringify(await info(), null, 1));
await p.screenshot({ path: S + 'decider-2.png' });
console.log('errors:', errs.join(' / ') || 'none');
await b.close();

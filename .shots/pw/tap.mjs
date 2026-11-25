// Tap-to-feedback with a slow connection: the dice should spin and pins hop right away,
// and the board must always end up where the server says.
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const DELAY = Number(process.argv[2] || 300);
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.addInitScript((delay) => {
  const W = window.WebSocket;
  window.WebSocket = class extends W { set onmessage(f) { super.onmessage = (e) => setTimeout(() => f(e), delay); } };
}, DELAY);
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
await p.goto('http://localhost:3990/?name=Ann', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
await p.click('#create-btn'); await p.waitForTimeout(900);
await p.click('#fill-btn'); await p.waitForTimeout(900);
await p.click('#start-btn'); await p.waitForTimeout(1500);
const dbg = () => p.evaluate(() => { const d = window.__dbg(); return { ...d, state: { phase: d.state.phase, turn: d.state.turn, rolled: d.state.rolled, seats: d.state.seats.map((s) => s && { bot: s.bot, name: s.name }), tokens: d.state.tokens } }; });
let rolls = 0, moves = 0, bad = 0, checks = 0;
const diceAfter = [], moveAfter = [];
const until = async (f, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { const d = await dbg(); if (f(d)) return d; await p.waitForTimeout(40); } return null; };
const T0 = Date.now();
for (let loop = 0; loop < 3000 && moves < 12 && Date.now() - T0 < 125000; loop++) {
  const d = await dbg();
  if (d.state.phase !== 'playing') break;
  if (d.idle) { checks++; if (JSON.stringify(d.shown) !== JSON.stringify(d.latest)) { bad++; console.log('MISMATCH', JSON.stringify(d.shown), JSON.stringify(d.latest)); } }
  const mine = d.state.seats[d.state.turn]?.name === 'Ann';
  if (mine && !d.state.rolled && d.dice.mode === 'ready' && d.idle) {
    const c = await p.$('#board'); const bb = await c.boundingBox();
    await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    const a = await dbg(); diceAfter.push(`${a.dice.mode}${a.dice.waiting ? '(waiting)' : ''}`); rolls++;
    continue;
  }
  if (d.pin) {
    await p.mouse.click(d.pin.x, d.pin.y);
    const ch = await p.$('#roll-chooser:not(.hidden) button');
    if (ch) { await p.waitForTimeout(200); await ch.click(); }
    await p.waitForTimeout(60);
    const a = await dbg(); moveAfter.push(a.cur ? `${a.cur.predicted ? 'hopping-early' : 'hopping'} ${Math.round(a.cur.el)}ms` : 'still'); moves++;
    continue;
  }
  await p.waitForTimeout(80);
}
console.log(`delay ${DELAY}ms · rolls ${rolls}: dice ~1 frame after tap → ${[...new Set(diceAfter)].join(', ')}`);
console.log(`moves ${moves}: 60ms after tap → ${moveAfter.join(' | ')}`);
console.log(`board vs server: ${bad} mismatches in ${checks} quiet moments`);
console.log('errors:', errs.join(' / ') || 'none');
await b.close();

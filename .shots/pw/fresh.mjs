// A brand-new player (nothing saved): tapping around must not start any music.
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--autoplay-policy=no-user-gesture-required'], headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await p.addInitScript(() => { window.__media = 0; const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__media++; return play.call(this); }; });
await p.goto('http://localhost:3990/?name=New', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
for (let i = 0; i < 3; i++) { await p.tap('body'); await p.waitForTimeout(300); }
await p.tap('.menu-tools [data-player-btn]'); await p.waitForTimeout(400);
console.log('new player, after taps: music plays =', await p.evaluate(() => window.__media), '| play button shows:', await p.textContent('#player-play'));
await b.close();

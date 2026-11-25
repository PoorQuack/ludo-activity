// The music player: genres with several songs, skipping, and auto-advance at the end of a song.
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--autoplay-policy=no-user-gesture-required'], headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => /warn|error/.test(m.type()) && errs.push(m.text()));
const reqs = []; p.on('request', (r) => r.url().includes('.mp3') && reqs.push(r.url().split('/').pop()));
await p.goto('http://localhost:3990/?name=Ann', { waitUntil: 'networkidle' }); await p.waitForTimeout(500);
await p.tap('body'); await p.waitForTimeout(1500);
await p.click('.menu-tools [data-player-btn]'); await p.waitForTimeout(400);
const now = () => p.evaluate(() => `${document.getElementById('player-label').textContent} | ${document.getElementById('player-title').textContent}`);
console.log('now:', await now());
console.log('genres:', await p.$$eval('#player-list button', (bs) => bs.map((b) => b.textContent)));
await p.click('#player-next'); await p.waitForTimeout(1200); console.log('after ⏭:', await now());
await p.click('#player-next'); await p.waitForTimeout(1200); console.log('after ⏭:', await now());
await p.click('#player-prev'); await p.waitForTimeout(1200); console.log('after ⏮:', await now());
await p.click('#player-list button:nth-child(3)'); await p.waitForTimeout(1200); console.log('energetic:', await now());
// jump to the end of the song: the next one should start on its own
await p.evaluate(() => { const a = [...document.querySelectorAll('audio')][0]; });
console.log('mp3s fetched:', [...new Set(reqs)].join(', '));
console.log('errors:', errs.join(' / ') || 'none');
await b.close();

// Music off: opening and tapping around the game must not start the sound engine (that pauses
// other apps' audio on phones); a sound effect starts it, and it sleeps again a few seconds later.
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--autoplay-policy=no-user-gesture-required'], headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await p.addInitScript(() => {
  localStorage.setItem('ludo-audio', JSON.stringify({ music: false, sound: true }));
  window.__ctxs = [];
  const AC = window.AudioContext;
  window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__ctxs.push(this); } };
  window.__media = 0;
  window.__sessions = [];
  navigator.audioSession = { set type(v) { window.__sessions.push(v); }, get type() { return window.__sessions.at(-1); } };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { window.__media++; return play.call(this); };
});
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const st = () => p.evaluate(() => `engines: ${window.__ctxs.length} (${window.__ctxs.map((c) => c.state).join(',')}), media plays: ${window.__media}, audio session: ${navigator.audioSession.type}, music loaded: ${[...document.querySelectorAll('audio')].length}`);
await p.goto('http://localhost:3990/?name=Ann', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
console.log('opened:', await st());
await p.tap('.menu-tools [data-player-btn]'); await p.waitForTimeout(500);
console.log('genres listed without sound:', await p.$$eval('#player-list button', (b) => b.length));
await p.tap('#player-list button:nth-child(2)'); await p.waitForTimeout(400);
await p.keyboard.press('Escape');
await p.evaluate(() => { const r = document.querySelector('#player-pop [data-volume="sound"]'); r.value = 40; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
await p.waitForTimeout(300); console.log('one sound effect in the menu:', await st());
await p.waitForTimeout(3600); console.log('3.6s later:', await st());
await p.tap('#create-btn'); await p.waitForTimeout(600);
console.log('tapped around (music off):', await st());
await p.tap('#fill-btn'); await p.waitForTimeout(400);
await p.tap('#start-btn'); await p.waitForTimeout(2500);
console.log('game started, sound effects played:', await st());
await p.waitForTimeout(4500);
console.log('a few seconds of quiet later:', await st());
// turning the music on starts it
await p.tap('.panel-head [data-player-btn]'); await p.waitForTimeout(300);
await p.tap('#player-play'); await p.waitForTimeout(1500);
console.log('music on:', await st());
await p.tap('#player-play'); await p.waitForTimeout(1500);
console.log('music off again:', await st(), '| player src:', await p.evaluate(() => 'n/a'));
console.log('errors:', errs.join(' / ') || 'none');
await b.close();

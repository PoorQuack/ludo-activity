// Profile a live bot game at phone size with CPU throttling: where does the main thread go?
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
import fs from 'node:fs';
const rate = Number(process.argv[2] || 4), secs = Number(process.argv[3] || 20), board = process.argv[4] || '';
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.addInitScript(() => {
  window.__msg = []; window.__raf = [];
  const W = window.WebSocket;
  window.WebSocket = class extends W { set onmessage(f) { super.onmessage = (e) => { const t = performance.now(); f(e); let ty = '?'; try { ty = JSON.parse(e.data).type; } catch {} window.__msg.push([ty, performance.now() - t, e.data.length]); }; } };
  const r = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => r((t) => { const a = performance.now(); cb(t); const d = performance.now() - a; if (d > 0.5) window.__raf.push(d); });
});
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
await p.goto('http://localhost:3990/?name=Ann', { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
if (board) {
  await p.click('[data-go="shop"]').catch(() => {}); await p.waitForTimeout(400);
  await p.click('[data-shop-tab="board"]').catch(() => {}); await p.waitForTimeout(300);
  const card = p.locator(`[data-item="${board}"]`);
  for (let i = 0; i < 2; i++) { await card.locator('button').first().click().catch((e) => console.log('shop', e.message.slice(0, 80))); await p.waitForTimeout(400); }
  await p.click('[data-go="menu"]').catch(() => {}); await p.waitForTimeout(300);
}
await p.click('#create-btn'); await p.waitForTimeout(500);
await p.click('#fill-btn'); await p.waitForTimeout(400);
await p.click('#start-btn'); await p.waitForTimeout(1500);
// auto-play my turns
await p.evaluate(() => { window.__auto = setInterval(() => { const c = document.getElementById('board'); const r = c.getBoundingClientRect(); for (const [x, y] of [[0.5, 0.5]]) c.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.x + r.width * x, clientY: r.y + r.height * y, bubbles: true })); c.click(); }, 900); });
const cdp = await ctx.newCDPSession(p);
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
await cdp.send('Performance.enable');
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
await p.evaluate(() => { window.__fr = []; let l = performance.now(); const f = (t) => { window.__fr.push(t - l); l = t; requestAnimationFrame(f); }; requestAnimationFrame(f); });
await cdp.send('Profiler.start');
await p.waitForTimeout(secs * 1000);
const { profile } = await cdp.send('Profiler.stop');
const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const fr = await p.evaluate(() => window.__fr);
const { msg, raf } = await p.evaluate(() => ({ msg: window.__msg, raf: window.__raf }));
const by = {}; for (const [t, d, n] of msg) { (by[t] ||= []).push(d); }
for (const [t, ds] of Object.entries(by)) { ds.sort((a, b) => a - b); console.log(`  msg ${t}: n=${ds.length} median ${ds[ds.length >> 1].toFixed(1)}ms max ${ds.at(-1).toFixed(1)}ms`); }
raf.sort((a, b) => a - b); console.log(`  rAF work (draw frames): n=${raf.length} median ${raf[raf.length >> 1].toFixed(1)} p90 ${raf[Math.floor(raf.length * .9)].toFixed(1)} max ${raf.at(-1).toFixed(1)}ms`);
const d = (k) => ((m1[k] - m0[k]) / secs * 100).toFixed(1) + '%';
console.log(`board=${board || 'classic'} rate=${rate}x  per wall-second: script ${d('ScriptDuration')} layout ${d('LayoutDuration')} style ${d('RecalcStyleDuration')} task ${d('TaskDuration')}  layouts ${((m1.LayoutCount - m0.LayoutCount) / secs).toFixed(0)}/s styles ${((m1.RecalcStyleCount - m0.RecalcStyleCount) / secs).toFixed(0)}/s`);
fr.sort((a, b) => a - b);
console.log(`frames ${fr.length} (${(fr.length / secs).toFixed(0)} fps) median ${fr[fr.length >> 1].toFixed(1)}ms p90 ${fr[Math.floor(fr.length * 0.9)].toFixed(1)} p99 ${fr[Math.floor(fr.length * 0.99)].toFixed(1)} max ${fr.at(-1).toFixed(0)}`);
// self time by function
const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas; const total = dt.reduce((a, b) => a + b, 0);
profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 22).map(([k, v]) => `  ${(v / total * 100).toFixed(1).padStart(5)}%  ${k}`).join('\n'));
// Long busy stretches: what was on the stack (inclusive) during them
const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
const idle = (id) => /^\((idle|program|garbage collector)\)$/.test(byId.get(id).callFrame.functionName) && byId.get(id).callFrame.functionName !== '(garbage collector)';
let runs = [], cur = null;
profile.samples.forEach((id, i) => { if (byId.get(id).callFrame.functionName === '(idle)') { if (cur) runs.push(cur); cur = null; } else { (cur ||= { t: 0, s: [] }).t += dt[i] || 0; cur.s.push([id, dt[i] || 0]); } });
if (cur) runs.push(cur);
runs = runs.filter((r) => r.t > 100000).sort((a, b) => b.t - a.t);
console.log(`busy stretches >100ms: ${runs.length}, longest ${runs.slice(0, 6).map((r) => (r.t / 1000).toFixed(0) + 'ms').join(', ')}`);
const inc = new Map(); let tot = 0;
for (const r of runs) for (const [id, t] of r.s) { tot += t; const seen = new Set(); for (let n = id; n; n = parent.get(n)) { const f = byId.get(n).callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber}`; if (seen.has(k)) continue; seen.add(k); inc.set(k, (inc.get(k) || 0) + t); } }
console.log([...inc].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `  ${(v / tot * 100).toFixed(1).padStart(5)}%  ${k}`).join('\n'));
console.log('errors:', errs.join(' / ') || 'none');
await b.close();

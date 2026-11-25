// sheet.mjs <query> <out.png> [width]
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const [, , query, out, width = '1300'] = process.argv;
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const p = await b.newPage({ viewport: { width: Number(width), height: 600 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(`http://localhost:3991/gallery.html?${query}`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__done, null, { timeout: 15000 });
await p.screenshot({ path: out, fullPage: true });
console.log(out, errs.length ? 'ERRORS: ' + errs.join(' / ') : 'ok');
await b.close();

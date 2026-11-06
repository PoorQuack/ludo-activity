// shoot.mjs <html> <outdir> : screenshots every top-level <svg id> as <id>.jpg
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const [, , html, out] = process.argv;
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const p = await b.newPage({ viewport: { width: 1200, height: 1200 } });
await p.goto('file://' + html);
await p.waitForTimeout(400);
for (const id of await p.$$eval('body > svg[id]', (e) => e.map((x) => x.id))) {
  await p.locator('#' + id).screenshot({ path: `${out}/${id}.jpg`, type: 'jpeg', quality: 82 });
  console.log(id);
}
await b.close();

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const keys = JSON.parse(fs.readFileSync(new URL('../tools/i18n/keys.json', import.meta.url)));
const dir = new URL('../client/locales/', import.meta.url);
const locales = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const tags = (s) => [...s.matchAll(/<\/?(\w+)/g)].map((m) => m[0]).sort().join(',');

test('there are 15 translations', () => {
  assert.equal(locales.length, 15, locales.join(' '));
});

for (const file of locales) {
  test(`${file}: every text is translated, with the same placeholders and formatting`, () => {
    const dict = JSON.parse(fs.readFileSync(new URL(file, dir)));
    const missing = keys.filter((k) => typeof dict[k] !== 'string' || !dict[k].trim());
    assert.deepEqual(missing, [], `${missing.length} missing`);
    const extra = Object.keys(dict).filter((k) => !keys.includes(k));
    assert.deepEqual(extra, [], 'texts the game no longer uses');
    for (const k of keys) {
      assert.equal(placeholders(dict[k]), placeholders(k), `placeholders differ: ${k}`);
      assert.equal(tags(dict[k]), tags(k), `formatting differs: ${k}`);
    }
  });
}

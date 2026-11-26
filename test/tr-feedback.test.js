// Players' 👍 / 👎 on chat translations, and their better ones taking over once enough agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TranslationFeedback, APPROVE_AT } from '../server/tr-feedback.js';
import { Translator } from '../server/translate.js';

const msg = { to: 'en', text: 'gg ez, revancha?', from: 'es', shown: 'gg ez, vengeful?' };

test(`a better translation takes over once ${APPROVE_AT} players agree on it`, () => {
  const fb = new TranslationFeedback(null);
  fb.vote('a', { ...msg, up: false });
  assert.equal(fb.approvedFor('en', msg.text), null);
  fb.suggest('a', { ...msg, suggestion: 'gg ez, rematch?' });
  fb.suggest('b', { ...msg, suggestion: 'GG EZ,  rematch?' }); // the same, written a bit differently
  assert.equal(fb.approvedFor('en', msg.text), null);
  // a 👍 on the suggestion (shown to someone) backs it
  const r = fb.vote('c', { ...msg, shown: 'gg ez, rematch?', up: true });
  assert.equal(r.approved, true);
  assert.deepEqual(fb.approvedFor('en', msg.text), { text: 'gg ez, rematch?', from: 'es' });
  assert.deepEqual(fb.examples('es', 'en'), [['gg ez, revancha?', 'gg ez, rematch?']]);
});

test('one voice per player: suggesting again replaces their old suggestion; votes flip', () => {
  const fb = new TranslationFeedback(null);
  for (const s of ['one', 'two', 'three']) fb.suggest('a', { ...msg, suggestion: s });
  const r = fb.records.get(fb.key('en', msg.text));
  assert.deepEqual(r.suggestions.map((x) => [x.text, x.by]), [['three', ['a']]]);
  fb.vote('b', { ...msg, up: true });
  fb.vote('b', { ...msg, up: false });
  assert.deepEqual([r.up, r.down.includes('b')], [[], true]);
  assert.throws(() => fb.suggest('a', { ...msg, suggestion: '   ' }), /Write the better translation/);
  assert.throws(() => fb.suggest('a', { ...msg, suggestion: msg.text }), /same as the message/);
});

test('feedback is capped per player, kept on disk, and the worst are listed', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trfb-')), 'f.json');
  const fb = new TranslationFeedback(file);
  for (let i = 0; i < 40; i++) fb.vote('spammer', { ...msg, text: `m${i}`, up: false });
  assert.throws(() => fb.vote('spammer', { ...msg, up: false }), /enough feedback/);
  fb.flush();
  const back = new TranslationFeedback(file);
  assert.equal(back.records.size, 40);
  assert.equal(back.worst(3).length, 3);
  assert.equal(back.worst(1)[0].down, 1);
});

test("the translator answers with the players' approved translation, and teaches it to Riva", async () => {
  const fb = new TranslationFeedback(null);
  for (const u of ['a', 'b', 'c']) fb.suggest(u, { ...msg, suggestion: 'gg ez, rematch?' });
  const tr = new Translator({ feedback: fb, fetch: async () => ({ ok: false, status: 500 }) });
  assert.deepEqual(await tr.translate('z', msg.text, 'en', 'es'), { text: 'gg ez, rematch?', from: 'es', approved: true });
  // Riva sees it as an example for Spanish -> English
  let sent = null;
  const riva = new Translator({
    feedback: fb,
    nvidiaKey: 'k',
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.model.includes('lightning')) return { ok: true, json: async () => ({ choices: [{ message: { content: 'es' } }] }) };
      sent = body.messages;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    },
  });
  await riva.translate('z', 'otra partida?', 'en', 'es');
  assert.ok(sent.some((m) => m.content === 'gg ez, rematch?'));
});

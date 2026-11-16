import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Inbox } from '../server/inbox.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-')), 'inbox.json');

test('notices are personal, newest first, and count as unread until the inbox is opened', () => {
  let now = 1000;
  const box = new Inbox(null, { now: () => now });
  box.add('1', { kind: 'friendAccepted', from: '2', name: 'Bob' });
  now = 2000;
  box.add('1', { kind: 'friendAccepted', from: '3', name: 'Cat' });
  let v = box.view('1');
  assert.deepEqual(v.items.map((i) => i.name), ['Cat', 'Bob']);
  assert.equal(v.unread, 2);
  assert.equal(box.view('2').items.length, 0);
  box.markRead('1');
  assert.equal(box.view('1').unread, 0);
});

test('announcements reach everyone, are read per player, can be taken down, and are saved', () => {
  const file = tmp();
  let now = 5000;
  const box = new Inbox(file, { now: () => now });
  assert.throws(() => box.announce('  ', 'x'), /title/);
  const a = box.announce('New boards!', 'Crystal and Dino are in the shop.');
  assert.equal(box.view('1').unread, 1);
  assert.equal(box.view('2').items[0].title, 'New boards!');
  now = 6000;
  box.markRead('1');
  assert.equal(box.view('1').unread, 0);
  assert.equal(box.view('2').unread, 1);
  box.flush();
  const again = new Inbox(file, { now: () => now });
  assert.equal(again.view('1').unread, 0);
  assert.equal(again.view('2').items[0].body, 'Crystal and Dino are in the shop.');
  assert.equal(again.unannounce(a.id), true);
  assert.equal(again.view('2').items.length, 0);
});

test('old announcements drop out after 60 days; guests are never saved', () => {
  const file = tmp();
  let now = 0;
  const box = new Inbox(file, { now: () => now });
  box.announce('Old news');
  box.add('guest-abcdefgh', { kind: 'friendAccepted', name: 'G' });
  now = 61 * 86_400_000;
  assert.equal(box.view('1').items.length, 0);
  box.flush();
  assert.equal(new Inbox(file).notes.has('guest-abcdefgh'), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DirectMessages, DM_KEEP } from '../server/dms.js';
import { SocialBook } from '../server/social.js';
import { ProfileStore } from '../server/store.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-dm-'));

test('DirectMessages: allows non-friend DMs, enforces block, tracks unread counts, and saves/reloads cleanly', () => {
  let clock = 1_700_000_000_000;
  const dir = tempDir();
  const social = new SocialBook(null, { now: () => clock });
  const profiles = new ProfileStore(path.join(dir, 'profiles.json'), { now: () => clock });
  const alice = { id: '100000000000000001', name: 'Alice' };
  const bob = { id: '100000000000000002', name: 'Bob' };
  const eve = { id: '100000000000000003', name: 'Eve' };
  social.seen(alice.id, alice.name, 'a');
  social.seen(bob.id, bob.name, 'b');
  social.seen(eve.id, eve.name, 'e');

  const dmFile = path.join(dir, 'dms.json');
  const dms = new DirectMessages(dmFile, { profiles, social, now: () => clock });

  // Anyone signed in with Discord can DM even if not friends yet
  dms.send(alice, bob.id, 'Hello Bob :cathello:'); // unowned sticker slug stays plain text
  assert.equal(dms.unreadCount(bob.id), 1);
  assert.equal(dms.unreadCount(alice.id), 0);

  // Blocking prevents DMs in both directions and hides unread/threads for blocker
  social.block(eve.id, alice.id);
  assert.throws(() => dms.send(alice, eve.id, 'hi'), /cannot message/i);
  assert.throws(() => dms.send(eve, alice.id, 'hi'), /unblock/i);
  social.unblock(eve.id, alice.id);
  dms.send(eve, alice.id, 'Unblocked hi');
  assert.equal(dms.unreadCount(alice.id), 1);
  dms.history(alice.id, eve.id);
  assert.equal(dms.unreadCount(alice.id), 0);

  clock += 2000;
  const res = dms.send(alice, bob.id, 'How are you?');
  assert.equal(res.msg.text, 'How are you?');
  assert.equal(dms.unreadCount(bob.id), 2);

  // Opening history marks messages read for Bob
  const h = dms.history(bob.id, alice.id);
  assert.equal(h.msgs.length, 2);
  assert.equal(h.msgs[0].text, 'Hello Bob cathello');
  assert.equal(dms.unreadCount(bob.id), 0);

  // Cap per thread & flush reload
  for (let i = 0; i < DM_KEEP + 5; i++) {
    clock += 2000;
    dms.send(bob, alice.id, `msg ${i}`);
  }
  dms.flush();

  const reloaded = new DirectMessages(dmFile, { profiles, social, now: () => clock });
  assert.equal(reloaded.unreadCount(alice.id), DM_KEEP);
  const threads = reloaded.threadsFor(alice.id);
  assert.equal(threads.length, 2);
  assert.equal(threads.find((t) => t.id === bob.id).unread, DM_KEEP);
});

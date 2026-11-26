import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DirectMessages, DM_KEEP } from '../server/dms.js';
import { LobbyChat } from '../server/lobbychat.js';
import { Room } from '../server/room.js';
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

  // Recording games tracks both human-vs-human and solo/bot games cleanly across reload
  profiles.get(alice.id);
  profiles.recordGame(alice.id, { won: true, vsBotsOnly: true, captures: 3, sixes: 5 });
  profiles.recordGame(alice.id, { won: false, vsBotsOnly: false, captures: 2, sixes: 4 });
  profiles.flush();
  const profReloaded = new ProfileStore(path.join(dir, 'profiles.json'), { now: () => clock });
  const ap = profReloaded.peek(alice.id);
  assert.equal(ap.played.games, 2);
  assert.equal(ap.played.wins, 1);
  assert.equal(ap.played.botGames, 1);
  assert.equal(ap.played.botWins, 1);
  assert.equal(ap.played.botCaptures, 3);
  assert.equal(ap.played.botSixes, 5);

  // Reply quotes and reactions across LobbyChat, DirectMessages, and Room
  const lchat = new LobbyChat(null, { profiles, now: () => clock });
  const m1 = lchat.say(alice, 'global', 'Hello world!');
  clock += 3000;
  const m2 = lchat.say(bob, 'global', 'Hey Alice!', { replyId: m1.id });
  assert.deepEqual(m2.replyTo, { id: m1.id, name: 'Alice', text: 'Hello world!' });
  const r1 = lchat.react(bob.id, 'global', m1.id, '❤️');
  assert.deepEqual(r1.reactions, { '❤️': [bob.id] });
  const r2 = lchat.react(bob.id, 'global', m1.id, '❤️');
  assert.deepEqual(r2.reactions, {});

  clock += 3000;
  const targetDmId = reloaded.history(bob.id, alice.id).msgs.at(-1).id;
  const dmRep = reloaded.send(alice, bob.id, 'Replying to DM', { replyId: targetDmId });
  assert.equal(dmRep.msg.replyTo.id, targetDmId);
  const dmReact = reloaded.react(bob.id, alice.id, dmRep.msg.id, '😂');
  assert.deepEqual(dmReact.reactions, { '😂': [bob.id] });

  const room = new Room('TEST', { profiles });
  room.host(alice);
  room.join(bob);
  room.say(alice, 'Good luck!');
  const rMsgId = room.chat.at(-1).id;
  room.react(bob, rMsgId, '🔥');
  assert.deepEqual(room.chat.at(-1).reactions, { '🔥': [bob.id] });
  room.destroy();
});

test('DirectMessages: only real players, and a few new chats with strangers a day', async () => {
  const { DM_NEW_PER_DAY, DM_COOLDOWN_MS } = await import('../server/dms.js');
  let clock = Date.parse('2026-11-25T10:00Z');
  const social = new SocialBook(null, { now: () => clock });
  const spammer = { id: '200000000000000001', name: 'Spam' };
  social.seen(spammer.id, spammer.name, 's');
  const ids = Array.from({ length: DM_NEW_PER_DAY + 2 }, (_, i) => String(300000000000000000n + BigInt(i)));
  for (const id of ids) social.seen(id, `P${id.slice(-2)}`, '');
  const dms = new DirectMessages(null, { social, now: () => clock });
  assert.throws(() => dms.send(spammer, '999999999999999999', 'hi'), /Pick someone/); // never played
  for (let i = 0; i < DM_NEW_PER_DAY; i++) {
    dms.send(spammer, ids[i], 'hi');
    clock += DM_COOLDOWN_MS;
  }
  assert.throws(() => dms.send(spammer, ids[DM_NEW_PER_DAY], 'hi'), /enough new chats/);
  clock += DM_COOLDOWN_MS;
  dms.send(spammer, ids[0], 'still fine in an existing chat');
  clock += 86_400_000;
  dms.send(spammer, ids[DM_NEW_PER_DAY], 'a new day'); // tomorrow: allowed again
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMentions } from '../shared/mentions.js';
import { LobbyChat, channelId } from '../server/lobbychat.js';
import { RoomDirectory } from '../server/rooms.js';

const names = new Map([['1', 'Gigi'], ['2', 'Bot Mila'], ['3', 'Ann']]);
const nameOf = (id) => names.get(id);

test('resolveMentions keeps only ids whose @Name is in the text (any case), max 5', () => {
  assert.deepEqual(resolveMentions('gg @gigi nice', ['1', '2'], nameOf), [{ id: '1', name: 'Gigi' }]);
  assert.deepEqual(resolveMentions('hey @Bot Mila!', ['2'], nameOf), [{ id: '2', name: 'Bot Mila' }]);
  assert.deepEqual(resolveMentions('no at sign Gigi', ['1'], nameOf), []); // not "@Gigi"
  assert.deepEqual(resolveMentions('@Gigi', ['9'], nameOf), []); // unknown id
  assert.deepEqual(resolveMentions('@Gigi', 'nope', nameOf), []); // not a list
  assert.deepEqual(resolveMentions('@Gigi @Gigi', ['1', '1'], nameOf).length, 1);
  const many = new Map(Array.from({ length: 8 }, (_, i) => [`u${i}`, `P${i}`]));
  const text = [...many.values()].map((n) => `@${n}`).join(' ');
  assert.equal(resolveMentions(text, [...many.keys()], (id) => many.get(id)).length, 5);
});

test('lobby chat stores real mentions, never the sender themself', () => {
  const chat = new LobbyChat(null, { now: () => 1_000_000 });
  const id = channelId('global', 'en');
  const m = chat.say({ id: '3', name: 'Ann' }, id, 'hi @Gigi and @Ann and @Nobody', { mentions: ['1', '3', '9'], nameOf });
  assert.deepEqual(m.mentions, [{ id: '1', name: 'Gigi' }]);
  const plain = new LobbyChat(null, { now: () => 2_000_000 }).say({ id: '3', name: 'Ann' }, id, 'hello @Gigi', { mentions: ['1'] });
  assert.equal(plain.mentions, undefined); // nothing to check names against: no mentions
});

test('room chat mentions only people in the room', () => {
  const dir = new RoomDirectory();
  const ann = { id: 'ann', name: 'Ann' };
  const bob = { id: 'bob', name: 'Bob' };
  const room = dir.create(ann, { visibility: 'public', mode: '2p' });
  dir.join(room, bob, {});
  room.handle(ann, { action: 'chat', text: 'your turn @Bob, not @Zed', mentions: ['bob', 'zed', 'ann'] });
  assert.deepEqual(room.chat.at(-1).mentions, [{ id: 'bob', name: 'Bob' }]);
  dir.destroy();
});

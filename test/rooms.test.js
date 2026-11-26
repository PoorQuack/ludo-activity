import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomDirectory } from '../server/rooms.js';
import { cleanText } from '../server/filter.js';

const ann = { id: 'ann', name: 'Ann' };
const bob = { id: 'bob', name: 'Bob' };
const cat = { id: 'cat', name: 'Cat' };

test('swear filter: bad words are starred, innocent words left alone', () => {
  assert.equal(cleanText('what the fuck'), 'what the ****');
  assert.equal(cleanText('sh1t and f@cking'), '**** and *******');
  assert.equal(cleanText('FUUUCK yes'), '****** yes');
  assert.equal(cleanText('class act in Scunthorpe, cocktails by Dickens'), 'class act in Scunthorpe, cocktails by Dickens');
  assert.equal(cleanText('good game gg'), 'good game gg');
});

test('creating a room: host is seated, the room gets a code and a name', () => {
  const dir = new RoomDirectory();
  const room = dir.create(ann, { visibility: 'public', mode: '2p', instanceId: 'call-1' });
  assert.equal(room.hostId, 'ann');
  assert.equal(room.seatOf('ann'), 0);
  assert.equal(room.mode, '2p');
  assert.match(room.code, /^[A-Z2-9]{4}$/);
  assert.equal(dir.findCode(room.code.toLowerCase()), room);
  assert.equal(room.name, "Ann's room");
  dir.destroy();
});

test('room list: public rooms for everyone, private ones only for the same Discord call', () => {
  const dir = new RoomDirectory();
  const pub = dir.create(ann, { visibility: 'public', instanceId: 'call-1' });
  const priv = dir.create(bob, { visibility: 'private', instanceId: 'call-2' });
  assert.deepEqual(dir.list('call-1').map((r) => r.id), [pub.id]);
  const fromCall2 = dir.list('call-2');
  assert.equal(fromCall2[0].id, priv.id); // your own call's rooms come first
  assert.equal(fromCall2[0].sameCall, true);
  assert.equal(fromCall2.length, 2);
  dir.destroy();
});

test('private rooms need the code unless you are in the same call', () => {
  const dir = new RoomDirectory();
  const room = dir.create(ann, { visibility: 'private', instanceId: 'call-1' });
  assert.throws(() => dir.join(room, bob, { instanceId: 'call-9' }), /private/);
  dir.join(room, bob, { instanceId: 'call-9', withCode: true });
  assert.equal(room.seatOf('bob'), 1); // joining a lobby with a free seat sits you down
  dir.join(room, cat, { instanceId: 'call-1' });
  assert.ok(room.seatOf('cat') >= 0);
  dir.destroy();
});

test('the host can switch public/private (but not turn chat off)', () => {
  const dir = new RoomDirectory();
  const room = dir.create(ann, { visibility: 'public' });
  dir.join(room, bob, {});
  assert.throws(() => room.handle(bob, { action: 'setVisibility', visibility: 'private' }), /Only the host/);
  room.handle(ann, { action: 'setVisibility', visibility: 'private' });
  assert.equal(room.visibility, 'private');
  // chat is each player's own choice now: an old client asking to turn it off changes nothing
  room.handle(ann, { action: 'setChat', on: false });
  assert.equal(room.chatOn, true);
  room.say(bob, 'hello you shit');
  assert.equal(room.chat.at(-1).text, 'hello you ****');
  dir.destroy();
});

test('kicking someone frees their seat and keeps them out', () => {
  const kicked = [];
  const dir = new RoomDirectory();
  const room = dir.create(ann, { visibility: 'public', extra: { onKick: (id) => kicked.push(id) } });
  dir.join(room, bob, {});
  assert.throws(() => room.handle(bob, { action: 'kick', userId: 'ann' }), /Only the host/);
  room.handle(ann, { action: 'kick', userId: 'bob' });
  assert.deepEqual(kicked, ['bob']);
  assert.equal(room.seatOf('bob'), -1);
  assert.throws(() => dir.join(room, bob, { withCode: true }), /removed you/);
  dir.destroy();
});

test('mid-game, connected players and watchers cannot be kicked', () => {
  const dir = new RoomDirectory();
  const room = dir.create(ann, { visibility: 'public', extra: { onKick: () => {} } });
  dir.join(room, bob, {});
  room.fillBots(ann);
  room.start(ann);
  dir.join(room, cat, {}); // watching
  assert.throws(() => room.handle(ann, { action: 'kick', userId: 'bob' }), /before the game starts/);
  assert.throws(() => room.handle(ann, { action: 'kick', userId: 'cat' }), /before the game starts/);
  assert.deepEqual(room.forfeited, []);
  assert.equal(room.banned.size, 0);
  dir.destroy();
});

test('mid-game, a player who left can be kicked once their reconnect grace is over', () => {
  const dir = new RoomDirectory();
  const room = dir.create(ann, { visibility: 'public', extra: { onKick: () => {} } });
  dir.join(room, bob, {});
  room.fillBots(ann);
  room.start(ann);
  room.disconnect(bob);
  assert.throws(() => room.handle(ann, { action: 'kick', userId: 'bob' }), /only just disconnected/);
  room.seats[1].disconnectedAt = Date.now() - 60_000; // long gone
  room.handle(ann, { action: 'kick', userId: 'bob' });
  assert.deepEqual(room.forfeited, [1]); // Bob's seat: out of the game
  assert.equal(room.seats[1].surrendered, true);
  assert.ok(room.banned.has('bob'));
  assert.equal(room.phase, 'playing'); // Ann and the bots carry on
  dir.destroy();
});

test('after the game, a winner who is still there cannot be kicked either', () => {
  const dir = new RoomDirectory();
  const room = dir.create(ann, { visibility: 'public', extra: { onKick: () => {} } });
  dir.join(room, bob, {});
  room.start(ann);
  room.tokens[room.seatOf('bob')] = [10, 20, -1, -1];
  room.surrender(ann);
  assert.equal(room.phase, 'finished');
  assert.throws(() => room.handle(ann, { action: 'kick', userId: 'bob' }), /before the game starts/);
  dir.destroy();
});

test('when the host leaves, someone else takes over; an empty room closes', async () => {
  const removed = [];
  const dir = new RoomDirectory({ idleMs: 20, onRemove: (r) => removed.push(r.id) });
  const room = dir.create(ann, { visibility: 'public' });
  dir.join(room, bob, {});
  room.disconnect(ann);
  assert.equal(room.hostId, 'bob');
  room.disconnect(bob);
  dir.left(room);
  assert.deepEqual(dir.list(null), []); // empty rooms aren't listed
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(removed, [room.id]);
  assert.equal(dir.get(room.id), null);
});

test('roll retries with a stale seq are ignored safely even when the roll was a 6', () => {
  const dir = new RoomDirectory();
  let nextRoll = 6;
  const room = dir.create(ann, { visibility: 'public', mode: '2p' });
  room.rng = () => nextRoll;
  dir.join(room, bob, {});
  room.start(ann);
  const roller = room.turn === 0 ? ann : bob;
  const seqBefore = room.seq;
  room.handle(roller, { action: 'roll', seq: seqBefore });
  assert.deepEqual(room.rolls, [6]);
  assert.equal(room.rolled, false); // still same player's roll after a 6
  nextRoll = 3;
  // Duplicate retry carrying the old seq must not roll again
  room.handle(roller, { action: 'roll', seq: seqBefore });
  assert.deepEqual(room.rolls, [6]);
  // Fresh roll with current seq proceeds normally
  room.handle(roller, { action: 'roll', seq: room.seq });
  assert.deepEqual(room.rolls, [6, 3]);
  // Move and stale move retry are also idempotent by seq
  const moveSeq = room.seq;
  room.handle(roller, { action: 'move', token: 0, roll: 0, seq: moveSeq });
  assert.equal(room.tokens[room.turn][0], 0);
  room.handle(roller, { action: 'move', token: 0, roll: 0, seq: moveSeq });
  assert.equal(room.tokens[room.turn][0], 0);
  dir.destroy();
});

test('play now: the fullest open lobby (your call first), never a full, private, started or banned one', () => {
  const dir = new RoomDirectory();
  const dan = { id: 'dan', name: 'Dan' };
  const eve = { id: 'eve', name: 'Eve' };
  assert.equal(dir.findOpen(eve, 'call-9'), null);
  const quiet = dir.create(ann, { visibility: 'public', instanceId: 'call-1' });
  const busy = dir.create(bob, { visibility: 'public', instanceId: 'call-2' });
  dir.join(busy, cat, { instanceId: 'call-2' });
  const secret = dir.create(dan, { visibility: 'private', instanceId: 'call-3' });
  assert.equal(dir.findOpen(eve, 'call-9'), busy, 'the fuller public room');
  assert.equal(dir.findOpen(eve, 'call-1'), quiet, 'your own call comes first');
  assert.equal(dir.findOpen(eve, 'call-3'), secret, 'a private room in your own call is fine');
  busy.banned.add('eve');
  assert.equal(dir.findOpen(eve, 'call-9'), quiet);
  assert.equal(dir.findOpen(ann, 'call-9'), busy, 'not the room you are already sitting in');
  dir.destroy();
});

test('a turn with two moves: the second move goes through even when sent before the first move\'s update', () => {
  const dir = new RoomDirectory();
  let nextRoll = 6;
  const room = dir.create(ann, { visibility: 'public', mode: '2p' });
  room.rng = () => nextRoll;
  dir.join(room, bob, {});
  room.start(ann);
  const roller = room.turn === 0 ? ann : bob;
  const seat = room.turn;
  room.handle(roller, { action: 'roll', seq: room.seq });
  nextRoll = 3;
  room.handle(roller, { action: 'roll', seq: room.seq });
  assert.deepEqual(room.rolls, [6, 3]);
  // what the client sends now: the first send of a move carries no seq
  room.handle(roller, { action: 'move', token: 0, roll: 0 });
  assert.equal(room.tokens[seat][0], 0);
  room.handle(roller, { action: 'move', token: 0 }); // the 3, tapped before the first move's update
  assert.equal(room.tokens[seat][0], 3);
  dir.destroy();
});

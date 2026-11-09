// Team modes: 2 vs 2 on the square board, 3 vs 3 on the hexagon board.
// Teammates sit opposite each other, never capture each other, and keep each other safe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newTokens, applyMove, capturesAt, isPair } from '../server/rules.js';
import { Room } from '../server/room.js';
import { ProfileStore } from '../server/store.js';
import { BOARDS, MODES, teamsOf } from '../shared/board.js';
import { REWARDS } from '../shared/shop.js';

const B4 = BOARDS[4];
const B6 = BOARDS[6];
const T4 = teamsOf('2v2');
const T6 = teamsOf('3v3');
// Seat s's progress for board square idx
const at = (s, idx, board = B4) => (idx - board.startIndex[s] + board.trackLen) % board.trackLen;

test('teams sit opposite each other', () => {
  assert.deepEqual(T4, [0, 1, 0, 1]); // red + yellow, green + blue
  assert.deepEqual(B4.colors.filter((_, s) => T4[s] === 0), ['red', 'yellow']);
  assert.deepEqual(T6, [0, 1, 0, 1, 0, 1]);
  assert.deepEqual(teamsOf('4p'), [0, 1, 2, 3]); // no teams: everyone on their own
  assert.equal(MODES['2v2'].arms, 4);
  assert.equal(MODES['3v3'].arms, 6);
});

test('teammates never capture each other', () => {
  const t = newTokens();
  t[2][0] = at(2, 5); // yellow, red's teammate
  t[0][0] = 2;
  const res = applyMove(t, 0, 0, 3, [0, 1, 2, 3], B4, T4);
  assert.deepEqual(res.captured, []);
  assert.equal(t[2][0], at(2, 5));
  // without teams (4 players) the same landing captures
  const u = newTokens();
  u[2][0] = at(2, 5);
  u[0][0] = 2;
  assert.equal(applyMove(u, 0, 0, 3, [0, 1, 2, 3], B4).captured.length, 1);
});

test("a teammate's token keeps yours safe", () => {
  // red and yellow (teammates) share a square: green landing there captures neither
  const t = newTokens();
  t[0][0] = 5;
  t[2][0] = at(2, 5);
  t[1][0] = at(1, 5) - 2;
  assert.ok(isPair(t, 0, 5, B4, T4, [0, 1, 2, 3]));
  assert.deepEqual(applyMove(t, 1, 0, 2, [0, 1, 2, 3], B4, T4).captured, []);
});

test('a lone opponent is still captured, beside a safe enemy team', () => {
  // green lands where red+yellow are together and a lone blue... blue is green's teammate,
  // so use 3 vs 3: red(0)+purple... teams are every other seat: 0,2,4 vs 1,3,5
  const t = newTokens(6);
  const idx = 30;
  t[0][0] = at(0, idx, B6); // team 0
  t[2][0] = at(2, idx, B6); // team 0: keeps seat 0 company
  t[3][0] = at(3, idx, B6) - 2; // team 1 lands there
  const res = applyMove(t, 3, 0, 2, [0, 1, 2, 3, 4, 5], B6, T6);
  assert.deepEqual(res.captured, []);
  // a single token of team 0 alone is captured
  const u = newTokens(6);
  u[4][1] = at(4, idx, B6);
  u[3][0] = at(3, idx, B6) - 2;
  assert.deepEqual(applyMove(u, 3, 0, 2, [0, 1, 2, 3, 4, 5], B6, T6).captured, [{ seat: 4, token: 1 }]);
});

test('teams can pass and land on each other freely', () => {
  const t = newTokens();
  t[1][0] = t[3][0] = 0; // nothing in the way of the rule: just a sanity check of capturesAt
  t[0][0] = 4;
  t[2][1] = at(2, 6);
  assert.deepEqual(capturesAt(t, 0, 6, [0, 1, 2, 3], B4, T4), []);
});

// Plays a whole game: the human plays their own turns (first possible move), bots the rest.
function playToEnd(setup, options = {}) {
  let room;
  const human = { id: 'h', name: 'Human' };
  const play = () => {
    if (room.phase !== 'playing' || room.seatOf('h') !== room.actorSeat() || room.pending) return;
    try {
      if (!room.rolled) room.roll(human);
      else {
        const idx = room.options.findIndex((o) => o.length > 0);
        if (idx >= 0) room.move(human, room.options[idx][0], idx);
      }
    } catch {
      // the server moved first
    }
  };
  const done = new Promise((resolve) => {
    room = new Room('t', {
      delays: { bot: 0, noMove: 0, autoMove: 0, timeout: 60_000 },
      onChange: (r) => (r.phase === 'finished' ? resolve() : setImmediate(play)),
      ...options,
    });
  });
  room.connect(human);
  room.host(human);
  setup(room, human);
  room.start(human);
  return done.then(() => room);
}

test('team games need every seat filled', () => {
  const room = new Room('t');
  const h = { id: 'h', name: 'H' };
  room.connect(h);
  room.host(h);
  room.setMode(h, '2v2');
  room.sit(h, 0);
  room.addBot(h, 1);
  assert.throws(() => room.start(h), /every seat/);
  room.fillBots(h);
  room.start(h);
  assert.equal(room.phase, 'playing');
  room.destroy();
});

test('a full 2 vs 2 game plays to the end and ranks the teams', async () => {
  const room = await playToEnd((room, human) => {
    room.setMode(human, '2v2');
    room.sit(human, 0);
    room.fillBots(human);
  });
  assert.equal(room.teamOrder.length, 2);
  assert.deepEqual([...room.teamOrder].sort(), [0, 1]);
  assert.equal(room.winners.length, 4);
  // won on points, or in the decider after a tie
  assert.ok(room.log.some((l) => /Team .* wins/.test(l.text ?? l)));
  if (!room.decider) assert.ok(room.racePoints[room.teamOrder[0]] > room.racePoints[room.teamOrder[1]]);
  room.destroy();
});

test('a full 3 vs 3 game plays to the end', async () => {
  const room = await playToEnd((room, human) => {
    room.setMode(human, '3v3');
    room.sit(human, 0);
    room.fillBots(human);
  });
  assert.equal(room.teamOrder.length, 2);
  assert.equal(room.winners.length, 6);
  room.destroy();
});

test('teammates share their place: coins and leaderboard points', () => {
  const store = new ProfileStore(null);
  const results = [];
  const room = new Room('t', { profiles: store, onGameEnd: (r) => results.push(...r), delays: { bot: 60_000, timeout: 60_000 } });
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };
  const c = { id: 'c', name: 'C' };
  for (const u of [a, b, c]) room.connect(u);
  room.host(a);
  room.setMode(a, '2v2');
  room.sit(a, 0); // team 0 with a bot in seat 2
  room.sit(b, 1); // team 1 ...
  room.sit(c, 3); // ... with c
  room.addBot(a, 2);
  room.start(a);
  // red and yellow get everything home: their team wins
  room.tokens[0] = [B4.finished, B4.finished, B4.finished, B4.finished];
  room.tokens[2] = [B4.finished, B4.finished, B4.finished, B4.finished];
  room.winners = [0, 2];
  assert.equal(room.endIfOver(), true);
  assert.deepEqual(room.teamOrder, [0, 1]);
  assert.equal(room.phase, 'finished');
  assert.equal(room.rewards[0], REWARDS.place[0]);
  assert.equal(room.rewards[1], REWARDS.place[1]);
  assert.equal(room.rewards[3], REWARDS.place[1]); // teammates share the place
  assert.equal(room.rewards[2], undefined); // bots aren't paid
  const pts = Object.fromEntries(results.map((r) => [r.userId, r]));
  assert.equal(pts.a.points, 2 * 10 + 10); // beat two humans, and won
  assert.equal(pts.a.won, true);
  assert.equal(pts.b.points, 0);
  assert.equal(pts.c.points, 0);
  room.destroy();
});

test("a finished player sits out: turns skip them until their team's done", () => {
  const room = new Room('t', { delays: { bot: 60_000, timeout: 60_000 } });
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };
  room.connect(a);
  room.connect(b);
  room.host(a);
  room.setMode(a, '2v2');
  room.sit(a, 0);
  room.sit(b, 1);
  room.fillBots(a);
  room.start(a);
  room.winners = [0]; // red is home, yellow (its teammate) isn't
  assert.equal(room.endIfOver(), false); // the team isn't done yet
  room.turn = 3;
  room.nextTurn();
  assert.equal(room.turn, 1); // past red, to green
  room.destroy();
});

test('when a whole team surrenders, the other team wins', () => {
  const room = new Room('t', { delays: { bot: 60_000, timeout: 60_000 } });
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };
  const c = { id: 'c', name: 'C' };
  const d = { id: 'd', name: 'D' };
  for (const u of [a, b, c, d]) room.connect(u);
  room.host(a);
  room.setMode(a, '2v2');
  room.sit(a, 0);
  room.sit(b, 1);
  room.sit(c, 2);
  room.sit(d, 3);
  room.start(a);
  room.surrender(b);
  assert.equal(room.phase, 'playing'); // d is still playing for green + blue
  room.surrender(d);
  assert.equal(room.phase, 'finished');
  assert.deepEqual(room.teamOrder, [0, 1]);
  room.destroy();
});

// ---------- points and the decider ----------

function teamRoom() {
  const room = new Room('t', { delays: { bot: 60_000, timeout: 60_000 } });
  const users = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase() }));
  for (const u of users) room.connect(u);
  room.host(users[0]);
  room.setMode(users[0], '2v2');
  users.forEach((u, i) => room.sit(u, i)); // a + c are team 0 (red + yellow), b + d team 1
  room.start(users[0]);
  return { room, users };
}

test('places score 3 / 2 / 1 / 0 for the team', () => {
  const { room } = teamRoom();
  assert.deepEqual(room.snapshot().pointsFor, [3, 2, 1, 0]);
  room.winners = [0, 1];
  assert.deepEqual(room.teamPoints(), [3, 2]);
  room.destroy();
});

test('1st and 2nd for one team: settled at once, they win 5 to 1', () => {
  const { room } = teamRoom();
  room.winners = [0, 2];
  assert.equal(room.endIfOver(), true);
  assert.equal(room.phase, 'finished');
  assert.deepEqual(room.teamOrder, [0, 1]);
  assert.deepEqual(room.racePoints, [5, 1]);
  assert.ok(room.log.some((l) => /wins, 5 to 1 points/.test(l.text ?? l)));
  room.destroy();
});

test('1st and 3rd beat 2nd and 4th, 4 to 2', () => {
  const { room } = teamRoom();
  room.winners = [0, 1];
  assert.equal(room.endIfOver(), false); // 3rd place decides: a win or a tie
  room.winners = [0, 1, 2];
  assert.equal(room.endIfOver(), true);
  assert.deepEqual(room.teamOrder, [0, 1]);
  assert.deepEqual(room.racePoints, [4, 2]);
  room.destroy();
});

test('1st and last against 2nd and 3rd is a tie: the decider starts', () => {
  const { room } = teamRoom();
  room.tokens[0] = [B4.finished, B4.finished, B4.finished, B4.finished];
  room.winners = [0, 1, 3]; // red 1st, green 2nd, blue 3rd: yellow will be last
  assert.equal(room.endIfOver(), true);
  assert.equal(room.phase, 'playing');
  assert.deepEqual(room.racePoints, [3, 3]);
  assert.deepEqual(room.decider.colors, [0, 1]); // red for team 0, green for team 1
  assert.deepEqual(room.decider.players, [[0, 2], [1, 3]]);
  assert.deepEqual(room.tokens, newTokens(4)); // everything back in base
  assert.deepEqual(room.winners, []);
  assert.deepEqual(room.raceSeats(), [0, 1]);
  assert.ok(room.log.some((l) => /draw, 3 points each/.test(l.text ?? l)));
  room.destroy();
});

test('in the decider the colours alternate and teammates take turns rolling', () => {
  const { room, users } = teamRoom();
  room.winners = [0, 1, 3];
  room.endIfOver();
  const turns = [];
  for (let i = 0; i < 8; i++) {
    turns.push(`${room.turn}:${room.actorSeat()}`);
    room.nextTurn();
  }
  // colours alternate; each colour's players take turns
  const red = turns.filter((t) => t.startsWith('0:')).map((t) => t.split(':')[1]);
  const green = turns.filter((t) => t.startsWith('1:')).map((t) => t.split(':')[1]);
  assert.equal(red.length, 4);
  assert.equal(green.length, 4);
  for (const seq of [red, green]) for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1]);
  // only the player whose go it is can roll; their teammate is told to wait
  const actor = room.actorSeat();
  const mate = room.decider.players[room.decider.colors.indexOf(room.turn)].find((s) => s !== actor);
  assert.throws(() => room.roll(users[mate]), /teammate's go/);
  room.roll(users[actor]);
  assert.equal(room.lastRoll.seat, room.turn);
  room.destroy();
});

test('the first colour home wins the decider, and both teammates share the win', () => {
  const store = new ProfileStore(null);
  const room = new Room('t', { profiles: store, delays: { bot: 60_000, timeout: 60_000 } });
  const users = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase() }));
  for (const u of users) room.connect(u);
  room.host(users[0]);
  room.setMode(users[0], '2v2');
  users.forEach((u, i) => room.sit(u, i));
  room.start(users[0]);
  room.winners = [0, 1, 3];
  room.endIfOver();
  // green (team 1) is one step from home with its last token, and it's green's go
  room.tokens[1] = [B4.finished, B4.finished, B4.finished, B4.finished - 1];
  room.turn = 1;
  room.actor = 3;
  room.rolled = true;
  room.rolls = [1];
  room.options = [[3]];
  room.move(users[3], 3, 0);
  assert.equal(room.phase, 'finished');
  assert.deepEqual(room.teamOrder, [1, 0]);
  assert.equal(room.rewards[1], REWARDS.place[0]);
  assert.equal(room.rewards[3], REWARDS.place[0]);
  assert.equal(room.rewards[0], REWARDS.place[1]);
  assert.ok(room.log.some((l) => /wins the decider/.test(l.text ?? l)));
  room.destroy();
});

test('surrendering in the decider: the colour plays on with the teammate; nobody left loses', () => {
  const { room, users } = teamRoom();
  room.winners = [0, 1, 3];
  room.endIfOver();
  room.surrender(users[2]); // yellow's player, rolling for red
  assert.equal(room.phase, 'playing');
  assert.deepEqual(room.decider.players[0], [0]);
  assert.equal(room.tokens[0].length, 4); // red's tokens stay on the board for its teammate
  room.surrender(users[0]);
  assert.equal(room.phase, 'finished');
  assert.deepEqual(room.teamOrder, [1, 0]);
  room.destroy();
});

test('a decider survives a server restart', () => {
  const { room } = teamRoom();
  room.winners = [0, 1, 3];
  room.endIfOver();
  const saved = JSON.parse(JSON.stringify(room.toSave()));
  const back = Room.fromSave(saved, { delays: { bot: 60_000, timeout: 60_000 } });
  assert.deepEqual(back.decider, room.decider);
  assert.equal(back.actor, room.actor);
  assert.deepEqual(back.racePoints, [3, 3]);
  back.destroy();
  room.destroy();
});

test('a decider plays to the end with a human and bots taking turns', async () => {
  let room;
  const human = { id: 'h', name: 'Human' };
  const play = () => {
    if (room.phase !== 'playing' || room.seatOf('h') !== room.actorSeat() || room.pending) return;
    try {
      if (!room.rolled) room.roll(human);
      else {
        const idx = room.options.findIndex((o) => o.length > 0);
        if (idx >= 0) room.move(human, room.options[idx][0], idx);
      }
    } catch {
      // the server moved first
    }
  };
  let humanTurns = 0;
  const done = new Promise((resolve) => {
    room = new Room('t', {
      delays: { bot: 0, noMove: 0, autoMove: 0, timeout: 60_000 },
      onChange: (r) => {
        if (r.decider && r.actor === 0 && !r.rolled) humanTurns++;
        return r.phase === 'finished' ? resolve() : setImmediate(play);
      },
    });
  });
  room.connect(human);
  room.host(human);
  room.setMode(human, '2v2');
  room.sit(human, 0);
  room.fillBots(human);
  room.start(human);
  room.clearTimer();
  room.winners = [0, 1, 3]; // a tie: into the decider
  room.endIfOver();
  await done;
  assert.ok(room.log.some((l) => /wins the decider/.test(l.text ?? l)));
  assert.ok(room.decider.colors.some((c) => room.tokens[c].every((p) => p === B4.finished)));
  assert.ok(humanTurns > 0, 'the human rolled for red in the decider');
  assert.equal(room.winners.length, 4);
  room.destroy();
});

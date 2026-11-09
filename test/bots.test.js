// Bot difficulty: Easy / Medium / Hard / Impossible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newTokens, chooseBotMove, BOT_LEVELS } from '../server/rules.js';
import { Room } from '../server/room.js';
import { BOARDS } from '../shared/board.js';

const B4 = BOARDS[4];

// Red can capture green's token 3 squares ahead with token 0, or just move token 1 along.
function captureChance() {
  const t = newTokens();
  t[0][0] = 10;
  t[0][1] = 30;
  t[1][0] = (B4.startIndex[0] + 13 - B4.startIndex[1] + B4.trackLen) % B4.trackLen;
  return t;
}

test('hard always takes the capture; easy often does not', () => {
  const count = (level) => {
    let n = 0;
    for (let i = 0; i < 400; i++) if (chooseBotMove(captureChance(), 0, 3, [0, 1], B4, null, level) === 0) n++;
    return n;
  };
  assert.equal(count('hard'), 400);
  assert.equal(count('impossible'), 400);
  const easy = count('easy');
  assert.ok(easy < 340, `easy captured ${easy}/400`);
  assert.ok(count('medium') > easy);
});

function lobby() {
  const room = new Room('t', { delays: { bot: 60_000, timeout: 60_000 } });
  const host = { id: 'h', name: 'H' };
  const guest = { id: 'g', name: 'G' };
  room.connect(host);
  room.connect(guest);
  room.host(host);
  room.sit(host, 0);
  room.addBot(host, 1);
  return { room, host, guest };
}

test('new bots are Medium; the host can change it in the lobby', () => {
  const { room, host, guest } = lobby();
  assert.equal(room.seats[1].level, 'medium');
  room.handle(host, { action: 'botLevel', seat: 1, level: 'impossible' });
  assert.equal(room.seats[1].level, 'impossible');
  assert.throws(() => room.handle(guest, { action: 'botLevel', seat: 1, level: 'easy' }), /host/);
  assert.throws(() => room.setBotLevel(host, 0, 'easy'), /not a bot/);
  assert.throws(() => room.setBotLevel(host, 1, 'godlike'), /Unknown/);
  assert.deepEqual(BOT_LEVELS, ['easy', 'medium', 'hard', 'impossible']);
  room.start(host);
  assert.throws(() => room.setBotLevel(host, 1, 'easy'), /Not allowed/);
  room.destroy();
});

test('a bot keeps its difficulty when the mode changes', () => {
  const { room, host } = lobby();
  room.setBotLevel(host, 1, 'hard');
  room.setMode(host, '4p');
  const bot = room.seats.find((s) => s?.bot);
  assert.equal(bot.level, 'hard');
  room.destroy();
});

test('Impossible gets a little luck with the dice, the others none', () => {
  const sixes = (level) => {
    const { room, host } = lobby();
    room.setBotLevel(host, 1, level);
    room.start(host);
    room.clearTimer();
    room.turn = 1; // all tokens in base: only a 6 helps
    let n = 0;
    const N = 6000;
    for (let i = 0; i < N; i++) if (room.luckyRoll() === 6) n++;
    room.destroy();
    return n / N;
  };
  const fair = sixes('medium');
  const lucky = sixes('impossible');
  assert.ok(Math.abs(fair - 1 / 6) < 0.025, `medium 6s: ${fair}`);
  assert.ok(lucky > fair + 0.025, `impossible 6s: ${lucky} vs ${fair}`);
  assert.ok(lucky < 0.3, 'only a slight edge');
});

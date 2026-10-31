// One game room per Discord Activity instance.
import { randomInt } from 'node:crypto';
import { COLORS } from '../shared/board.js';
import { newTokens, legalMoves, applyMove, chooseBotMove } from './rules.js';

const BOT_DELAY_MS = 900;
const NO_MOVE_DELAY_MS = 1400;
const TURN_TIMEOUT_MS = 30_000;
const BOT_NAMES = ['Bot Rocky', 'Bot Pixel', 'Bot Mango', 'Bot Nova'];

export class Room {
  constructor(id, { onChange, rng = () => randomInt(1, 7), delays = {} } = {}) {
    this.id = id;
    this.onChange = onChange || (() => {});
    this.rng = rng;
    this.delays = { bot: BOT_DELAY_MS, noMove: NO_MOVE_DELAY_MS, timeout: TURN_TIMEOUT_MS, ...delays };
    this.clients = new Set(); // sockets
    this.connected = new Map(); // userId -> connection count
    this.seats = [null, null, null, null]; // { userId, name, bot, connected }
    this.hostId = null;
    this.phase = 'lobby';
    this.tokens = newTokens();
    this.turn = 0;
    this.dice = null;
    this.rolled = false;
    this.movable = [];
    this.sixCount = 0;
    this.winners = [];
    this.lastMove = null;
    this.seq = 0;
    this.log = [];
    this.turnDeadline = null;
    this.timer = null;
  }

  // ---------- connections ----------

  connect(user) {
    this.connected.set(user.id, (this.connected.get(user.id) || 0) + 1);
    if (!this.hostId) this.hostId = user.id;
    const seat = this.seatOf(user.id);
    if (seat >= 0) {
      this.seats[seat].connected = true;
      this.seats[seat].name = user.name;
    }
    this.changed();
  }

  disconnect(user) {
    const n = (this.connected.get(user.id) || 1) - 1;
    if (n > 0) {
      this.connected.set(user.id, n);
      return;
    }
    this.connected.delete(user.id);
    const seat = this.seatOf(user.id);
    if (seat >= 0) {
      if (this.phase === 'lobby') this.seats[seat] = null;
      else this.seats[seat].connected = false;
    }
    if (this.hostId === user.id) {
      this.hostId = this.connected.keys().next().value ?? null;
    }
    this.changed();
  }

  get empty() {
    return this.connected.size === 0;
  }

  seatOf(userId) {
    return this.seats.findIndex((s) => s && !s.bot && s.userId === userId);
  }

  activeSeats() {
    return this.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  }

  // ---------- actions (validated) ----------

  handle(user, msg) {
    switch (msg.action) {
      case 'sit': return this.sit(user, msg.seat);
      case 'stand': return this.stand(user);
      case 'addBot': return this.addBot(user, msg.seat);
      case 'removeSeat': return this.removeSeat(user, msg.seat);
      case 'start': return this.start(user);
      case 'roll': return this.roll(user);
      case 'move': return this.move(user, msg.token);
      case 'newGame': return this.newGame(user);
      default: throw new Error('Unknown action');
    }
  }

  sit(user, seat) {
    this.requirePhase('lobby');
    if (!validSeat(seat)) throw new Error('Bad seat');
    if (this.seats[seat]) throw new Error('That seat is taken');
    const current = this.seatOf(user.id);
    if (current >= 0) this.seats[current] = null;
    this.seats[seat] = { userId: user.id, name: user.name, bot: false, connected: true };
    this.changed();
  }

  stand(user) {
    this.requirePhase('lobby');
    const current = this.seatOf(user.id);
    if (current >= 0) this.seats[current] = null;
    this.changed();
  }

  addBot(user, seat) {
    this.requirePhase('lobby');
    this.requireHost(user);
    if (!validSeat(seat) || this.seats[seat]) throw new Error('That seat is taken');
    this.seats[seat] = { userId: `bot-${seat}`, name: BOT_NAMES[seat], bot: true, connected: true };
    this.changed();
  }

  removeSeat(user, seat) {
    this.requirePhase('lobby');
    this.requireHost(user);
    if (!validSeat(seat)) throw new Error('Bad seat');
    this.seats[seat] = null;
    this.changed();
  }

  start(user) {
    this.requirePhase('lobby');
    this.requireHost(user);
    const active = this.activeSeats();
    if (active.length < 2) throw new Error('Need at least 2 players (add a bot!)');
    if (!active.some((i) => !this.seats[i].bot)) throw new Error('At least one human must play');
    this.phase = 'playing';
    this.tokens = newTokens();
    this.winners = [];
    this.lastMove = null;
    this.log = [];
    this.turn = active[randomInt(active.length)];
    this.resetTurn();
    this.addLog(`Game started! ${this.seats[this.turn].name} goes first.`);
    this.changed();
  }

  roll(user) {
    this.requireTurn(user);
    this.doRoll();
  }

  move(user, token) {
    this.requireTurn(user);
    this.doMove(token);
  }

  newGame(user) {
    this.requireHost(user);
    if (this.phase === 'lobby') return;
    this.clearTimer();
    this.phase = 'lobby';
    // Drop disconnected humans, keep everyone else seated.
    this.seats = this.seats.map((s) => (s && (s.bot || s.connected) ? s : null));
    this.tokens = newTokens();
    this.dice = null;
    this.rolled = false;
    this.movable = [];
    this.lastMove = null;
    this.winners = [];
    this.turnDeadline = null;
    this.changed();
  }

  // ---------- game flow ----------

  doRoll() {
    if (this.rolled) throw new Error('Already rolled');
    const seat = this.turn;
    const dice = this.rng();
    this.dice = dice;
    this.rolled = true;
    this.seq++;
    this.lastMove = null;
    const name = this.seats[seat].name;

    if (dice === 6) this.sixCount++;
    else this.sixCount = 0;

    if (this.sixCount === 3) {
      this.addLog(`${name} rolled three 6s in a row — turn lost!`);
      this.movable = [];
      this.changed();
      this.schedule(this.delays.noMove, () => this.nextTurn());
      return;
    }

    this.movable = legalMoves(this.tokens, seat, dice);
    if (this.movable.length === 0) {
      this.addLog(`${name} rolled a ${dice} — no moves.`);
      this.changed();
      this.schedule(this.delays.noMove, () => this.nextTurn());
      return;
    }
    this.changed();
  }

  doMove(token) {
    if (!this.rolled) throw new Error('Roll first');
    if (!this.movable.includes(token)) throw new Error("That token can't move");
    const seat = this.turn;
    const name = this.seats[seat].name;
    const result = applyMove(this.tokens, seat, token, this.dice, this.activeSeats());
    this.seq++;
    this.lastMove = { ...result, seq: this.seq };
    this.movable = [];

    for (const c of result.captured) {
      this.addLog(`${name} captured ${this.seats[c.seat].name}'s token!`);
    }
    if (result.finishedToken) this.addLog(`${name} brought a token home!`);

    if (result.allHome) {
      this.winners.push(seat);
      const place = ['1st', '2nd', '3rd', '4th'][this.winners.length - 1];
      this.addLog(`🏆 ${name} finished ${place}!`);
      const left = this.activeSeats().filter((s) => !this.winners.includes(s));
      if (left.length <= 1) {
        this.winners.push(...left);
        this.phase = 'finished';
        this.rolled = false;
        this.turnDeadline = null;
        this.clearTimer();
        this.changed();
        return;
      }
      this.nextTurn();
      return;
    }

    const bonus = this.dice === 6 || result.captured.length > 0 || result.finishedToken;
    if (bonus) {
      this.rolled = false;
      if (this.dice !== 6) this.sixCount = 0;
      this.turnDeadline = Date.now() + this.delays.timeout;
      this.changed();
    } else {
      this.nextTurn();
    }
  }

  nextTurn() {
    if (this.phase !== 'playing') return;
    const order = [0, 1, 2, 3];
    for (let i = 1; i <= 4; i++) {
      const s = order[(this.turn + i) % 4];
      if (this.seats[s] && !this.winners.includes(s)) {
        this.turn = s;
        break;
      }
    }
    this.resetTurn();
    this.changed();
  }

  resetTurn() {
    this.rolled = false;
    this.movable = [];
    this.sixCount = 0;
    this.turnDeadline = Date.now() + this.delays.timeout;
  }

  // Bots, disconnected players and AFK timeouts act automatically.
  automate() {
    this.clearTimer();
    if (this.phase !== 'playing') return;
    const seat = this.seats[this.turn];
    const auto = seat.bot || !seat.connected;
    const delay = auto ? this.delays.bot : Math.max(0, this.turnDeadline - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        if (!this.rolled) this.doRoll();
        else {
          const t = chooseBotMove(this.tokens, this.turn, this.dice, this.activeSeats());
          if (t !== null) this.doMove(t);
        }
      } catch (err) {
        console.error('automation error', err);
      }
    }, delay);
  }

  schedule(delay, fn) {
    this.clearTimer();
    this.pending = true;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pending = false;
      fn();
    }, delay);
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
  }

  destroy() {
    this.clearTimer();
  }

  // ---------- helpers ----------

  changed() {
    // Don't override a scheduled "no moves → next turn" pass.
    if (!this.pending) this.automate();
    this.onChange(this);
  }

  addLog(text) {
    this.log.push(text);
    if (this.log.length > 30) this.log.shift();
  }

  requirePhase(phase) {
    if (this.phase !== phase) throw new Error(`Not allowed right now`);
  }

  requireHost(user) {
    if (user.id !== this.hostId) throw new Error('Only the host can do that');
  }

  requireTurn(user) {
    this.requirePhase('playing');
    if (this.seatOf(user.id) !== this.turn) throw new Error("It's not your turn");
  }

  snapshot() {
    return {
      phase: this.phase,
      hostId: this.hostId,
      seats: this.seats.map((s, i) => (s ? { ...s, color: COLORS[i] } : null)),
      tokens: this.tokens,
      turn: this.turn,
      dice: this.dice,
      rolled: this.rolled,
      movable: this.movable,
      winners: this.winners,
      lastMove: this.lastMove,
      seq: this.seq,
      log: this.log.slice(-8),
      turnDeadline: this.turnDeadline,
      turnTimeout: this.delays.timeout,
      serverNow: Date.now(),
      spectators: this.connected.size,
    };
  }
}

function validSeat(seat) {
  return Number.isInteger(seat) && seat >= 0 && seat < 4;
}

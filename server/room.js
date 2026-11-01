// One game room per Discord Activity instance.
import { randomInt } from 'node:crypto';
import { MODES, boardFor } from '../shared/board.js';
import { DEFAULT_EQUIPPED, ITEMS, REWARDS, ownsItem } from '../shared/shop.js';
import { newTokens, legalMoves, applyMove, chooseBotMove } from './rules.js';

const BOT_DELAY_MS = 900;
const NO_MOVE_DELAY_MS = 1400;
const AUTO_MOVE_MS = 1100; // lets the dice finish spinning before the forced move
const TURN_TIMEOUT_MS = 30_000;
const EMOTE_COOLDOWN_MS = 1200;
const EMOTE_TTL_MS = 3000;
const BOT_NAMES = ['Bot Rocky', 'Bot Pixel', 'Bot Mango', 'Bot Nova', 'Bot Ziggy', 'Bot Lumi'];
const PLACES = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

export class Room {
  constructor(id, { onChange, rng = () => randomInt(1, 7), delays = {}, profiles = null } = {}) {
    this.id = id;
    this.onChange = onChange || (() => {});
    this.rng = rng;
    this.delays = {
      bot: BOT_DELAY_MS,
      noMove: NO_MOVE_DELAY_MS,
      autoMove: AUTO_MOVE_MS,
      timeout: TURN_TIMEOUT_MS,
      ...delays,
    };
    this.profiles = profiles; // ProfileStore (optional): skins, emotes and coin rewards
    this.clients = new Set(); // sockets
    this.connected = new Map(); // userId -> connection count
    this.mode = '4p';
    this.board = boardFor(this.mode);
    this.seats = Array(this.board.arms).fill(null); // { userId, name, bot, connected }
    this.hostId = null;
    this.phase = 'lobby';
    this.tokens = newTokens(this.board.arms);
    this.turn = 0;
    this.dice = null;
    this.rolled = false;
    this.movable = [];
    this.sixCount = 0;
    this.winners = [];
    this.forfeited = []; // seats that surrendered, in order
    this.captures = [];
    this.rewards = null; // seat -> coins, once a game is over
    this.lastMove = null;
    this.seq = 0;
    this.log = [];
    this.emotes = [];
    this.emoteSeq = 0;
    this.lastEmote = new Map(); // userId -> time
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
      case 'fillBots': return this.fillBots(user);
      case 'removeSeat': return this.removeSeat(user, msg.seat);
      case 'setMode': return this.setMode(user, msg.mode);
      case 'start': return this.start(user);
      case 'roll': return this.roll(user);
      case 'move': return this.move(user, msg.token);
      case 'emote': return this.emote(user, msg.item);
      case 'surrender': return this.surrender(user);
      case 'newGame': return this.newGame(user);
      default: throw new Error('Unknown action');
    }
  }

  sit(user, seat) {
    this.requirePhase('lobby');
    if (!this.validSeat(seat)) throw new Error('Bad seat');
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
    if (!this.validSeat(seat) || this.seats[seat]) throw new Error('That seat is taken');
    this.seats[seat] = newBot(seat);
    this.changed();
  }

  fillBots(user) {
    this.requirePhase('lobby');
    this.requireHost(user);
    for (const i of MODES[this.mode].seats) if (!this.seats[i]) this.seats[i] = newBot(i);
    this.changed();
  }

  removeSeat(user, seat) {
    this.requirePhase('lobby');
    this.requireHost(user);
    if (!this.validSeat(seat)) throw new Error('Bad seat');
    this.seats[seat] = null;
    this.changed();
  }

  setMode(user, mode) {
    this.requirePhase('lobby');
    this.requireHost(user);
    if (!MODES[mode]) throw new Error('Unknown mode');
    if (mode === this.mode) return;
    const old = this.seats.map((s, i) => s && { s, i }).filter(Boolean);
    const allowed = MODES[mode].seats;
    this.mode = mode;
    this.board = boardFor(mode);
    this.seats = Array(this.board.arms).fill(null);
    this.tokens = newTokens(this.board.arms);

    // Humans keep their seat if it still exists, then the rest fill free seats.
    // Bots go last, so they are the ones dropped when the new mode has fewer seats.
    const free = () => allowed.find((i) => !this.seats[i]);
    const humans = old.filter((o) => !o.s.bot);
    const moved = [];
    for (const o of humans) {
      if (allowed.includes(o.i)) this.seats[o.i] = o.s;
      else moved.push(o);
    }
    for (const o of moved) {
      const i = free();
      if (i !== undefined) this.seats[i] = o.s;
    }
    for (const o of old.filter((o) => o.s.bot)) {
      const i = allowed.includes(o.i) && !this.seats[o.i] ? o.i : free();
      if (i !== undefined) this.seats[i] = newBot(i);
    }
    this.changed();
  }

  start(user) {
    this.requirePhase('lobby');
    this.requireHost(user);
    const active = this.activeSeats();
    if (active.length < 2) throw new Error('Need at least 2 players (add a bot!)');
    if (!active.some((i) => !this.seats[i].bot)) throw new Error('At least one human must play');
    this.phase = 'playing';
    this.tokens = newTokens(this.board.arms);
    this.winners = [];
    this.forfeited = [];
    for (const i of active) delete this.seats[i].surrendered;
    this.captures = Array(this.board.arms).fill(0);
    this.rewards = null;
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
    if (!this.rolled) throw new Error('Roll first');
    if (!this.movable.includes(token)) throw new Error("That token can't move");
    this.clearTimer(); // cancels a pending auto-move
    this.doMove(token);
  }

  surrender(user) {
    this.requirePhase('playing');
    const seat = this.seatOf(user.id);
    if (seat < 0 || !this.inPlay().includes(seat)) throw new Error("You're not playing in this game");
    this.forfeited.push(seat);
    this.seats[seat].surrendered = true;
    this.tokens[seat] = [-1, -1, -1, -1];
    this.addLog(`🏳️ ${this.seats[seat].name} surrendered.`);
    if (this.endIfOver()) return;
    if (this.turn === seat) {
      this.clearTimer();
      this.nextTurn();
    } else {
      this.changed();
    }
  }

  emote(user, itemId) {
    const item = ITEMS[itemId];
    if (!item || item.type !== 'emote') throw new Error('Unknown emote');
    const seat = this.seatOf(user.id);
    if (seat < 0) throw new Error('Take a seat to send emotes');
    if (!ownsItem(this.profiles?.peek(user.id), itemId)) throw new Error("You don't own that emote");
    const now = Date.now();
    if (now - (this.lastEmote.get(user.id) || 0) < EMOTE_COOLDOWN_MS) return;
    this.lastEmote.set(user.id, now);
    this.emotes = this.emotes.filter((e) => now - e.at < EMOTE_TTL_MS);
    this.emotes.push({ id: ++this.emoteSeq, seat, emoji: item.emoji, at: now });
    this.onChange(this); // nothing in the game changed, so skip automate()
  }

  // The host can end a game at any time; once a game is over, anyone can start the next one.
  newGame(user) {
    if (this.phase === 'lobby') return;
    if (this.phase === 'playing') this.requireHost(user);
    this.clearTimer();
    this.phase = 'lobby';
    // Drop disconnected humans, keep everyone else seated.
    this.seats = this.seats.map((s) => (s && (s.bot || s.connected) ? s : null));
    this.tokens = newTokens(this.board.arms);
    this.dice = null;
    this.rolled = false;
    this.movable = [];
    this.lastMove = null;
    this.winners = [];
    this.forfeited = [];
    for (const s of this.seats) if (s) delete s.surrendered;
    this.rewards = null;
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

    this.movable = legalMoves(this.tokens, seat, dice, this.board);
    if (this.movable.length === 0) {
      this.addLog(`${name} rolled a ${dice} — no moves.`);
      this.changed();
      this.schedule(this.delays.noMove, () => this.nextTurn());
      return;
    }
    // Only one real choice (one token, or tokens that would all end up in the same place)?
    // Make the move for the player once the dice has landed.
    if (new Set(this.movable.map((t) => this.tokens[seat][t])).size === 1) {
      this.changed();
      this.schedule(this.delays.autoMove, () => {
        if (this.phase === 'playing' && this.rolled) this.doMove(this.movable[0]);
      });
      return;
    }
    this.changed();
  }

  doMove(token) {
    if (!this.rolled) throw new Error('Roll first');
    if (!this.movable.includes(token)) throw new Error("That token can't move");
    const seat = this.turn;
    const name = this.seats[seat].name;
    const result = applyMove(this.tokens, seat, token, this.dice, this.activeSeats(), this.board);
    this.seq++;
    this.lastMove = { ...result, seq: this.seq };
    this.movable = [];
    this.captures[seat] += result.captured.length;

    for (const c of result.captured) {
      this.addLog(`${name} captured ${this.seats[c.seat].name}'s token!`);
    }
    if (result.finishedToken) this.addLog(`${name} brought a token home!`);

    if (result.allHome) {
      this.winners.push(seat);
      this.addLog(`🏆 ${name} finished ${PLACES[this.winners.length - 1]}!`);
      if (!this.endIfOver()) this.nextTurn();
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

  // Seats still racing: not finished and not surrendered.
  inPlay() {
    return this.activeSeats().filter((s) => !this.winners.includes(s) && !this.forfeited.includes(s));
  }

  // The game ends when at most one player is left racing, or only bots are.
  // Anyone left is ranked by how far their tokens got; those who surrendered come last.
  endIfOver() {
    const left = this.inPlay();
    if (left.length > 1 && left.some((s) => !this.seats[s].bot)) return false;
    const progress = (s) => this.tokens[s].reduce((sum, p) => sum + p + 1, 0);
    left.sort((a, b) => progress(b) - progress(a));
    this.winners.push(...left, ...[...this.forfeited].reverse());
    this.finish();
    return true;
  }

  finish() {
    this.phase = 'finished';
    this.rolled = false;
    this.turnDeadline = null;
    this.clearTimer();
    this.giveRewards();
    this.changed();
  }

  // Coins for every human who didn't surrender: by finishing place, plus a bonus per capture.
  giveRewards() {
    const humans = this.winners.filter((s) => !this.seats[s].bot);
    const factor = humans.length >= 2 ? 1 : REWARDS.soloFactor;
    this.rewards = {};
    this.winners.forEach((s, place) => {
      const seat = this.seats[s];
      if (seat.bot || this.forfeited.includes(s)) return;
      const coins = Math.round((REWARDS.place[place] + this.captures[s] * REWARDS.capture) * factor);
      this.rewards[s] = coins;
      this.profiles?.addCoins(seat.userId, coins);
    });
  }

  nextTurn() {
    if (this.phase !== 'playing') return;
    const n = this.seats.length;
    for (let i = 1; i <= n; i++) {
      const s = (this.turn + i) % n;
      if (this.seats[s] && !this.winners.includes(s) && !this.forfeited.includes(s)) {
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
          const t = chooseBotMove(this.tokens, this.turn, this.dice, this.activeSeats(), this.board);
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

  validSeat(seat) {
    return Number.isInteger(seat) && MODES[this.mode].seats.includes(seat);
  }

  equipped(userId) {
    return this.profiles?.peek(userId)?.equipped || DEFAULT_EQUIPPED;
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
    const now = Date.now();
    return {
      mode: this.mode,
      seatsAllowed: MODES[this.mode].seats,
      phase: this.phase,
      hostId: this.hostId,
      // Everyone sees the host's board theme.
      theme: this.equipped(this.hostId).board,
      seats: this.seats.map(
        (s, i) =>
          s && {
            ...s,
            color: this.board.colors[i],
            skins: s.bot ? DEFAULT_EQUIPPED : this.equipped(s.userId),
          },
      ),
      tokens: this.tokens,
      turn: this.turn,
      dice: this.dice,
      rolled: this.rolled,
      movable: this.movable,
      winners: this.winners,
      rewards: this.rewards,
      lastMove: this.lastMove,
      seq: this.seq,
      log: this.log.slice(-8),
      emotes: this.emotes.filter((e) => now - e.at < EMOTE_TTL_MS),
      turnDeadline: this.turnDeadline,
      turnTimeout: this.delays.timeout,
      serverNow: now,
      spectators: this.connected.size,
    };
  }
}

function newBot(seat) {
  return { userId: `bot-${seat}`, name: BOT_NAMES[seat], bot: true, connected: true };
}

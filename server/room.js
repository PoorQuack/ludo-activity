// One game room: its lobby, the game, its chat. Rooms are created and listed by rooms.js.
import { randomInt } from 'node:crypto';
import { MODES, boardFor } from '../shared/board.js';
import { DEFAULT_EQUIPPED, EMOTE_SLUGS, ITEMS, REWARDS, ownsItem } from '../shared/shop.js';
import { newTokens, legalMoves, applyMove, chooseBotMove, progressShare } from './rules.js';
import { cleanText } from './filter.js';

const BOT_DELAY_MS = 900;
const NO_MOVE_DELAY_MS = 1400;
const AUTO_MOVE_MS = 950; // the dice spins, then stays readable, before a bot or forced move
const TURN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUTS = 3; // turns in a row a player can let run out before they're surrendered
const MAX_SIXES = 3; // this many 6s in a row loses the turn
const STUCK_TURNS = 5; // dead turns (no 6) with every token in base before the next roll is a free 6
const EMOTE_COOLDOWN_MS = 1200;
const CHAT_COOLDOWN_MS = 700;
const CHAT_KEEP = 40; // messages kept (and sent) per room
const CHAT_MAX_LEN = 100;
const EMOTE_TTL_MS = 3000;
const BOT_NAMES = ['Bot Rocky', 'Bot Pixel', 'Bot Mango', 'Bot Nova', 'Bot Ziggy', 'Bot Lumi'];
const PLACES = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

export class Room {
  constructor(
    id,
    { onChange, onKick, rng = () => randomInt(1, 7), delays = {}, profiles = null, code = null, visibility = 'private', instanceId = null } = {},
  ) {
    this.id = id;
    this.code = code; // short code anyone can join with, e.g. "K7QX"
    this.visibility = visibility; // 'public': listed for everyone; 'private': your Discord call or the code
    this.instanceId = instanceId; // the Discord call it was created in
    this.chatOn = true; // the host can turn typed chat off (emotes still work)
    this.banned = new Set(); // userIds the host kicked: they can't come back
    this.onKick = onKick || (() => {}); // the server takes a kicked player out of the room
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
    this.people = new Map(); // userId -> name, everyone in the room (players and watchers)
    this.mode = '4p';
    this.board = boardFor(this.mode);
    this.seats = Array(this.board.arms).fill(null); // { userId, name, bot, connected }
    this.hostId = null;
    this.phase = 'lobby';
    this.tokens = newTokens(this.board.arms);
    this.turn = 0;
    this.dice = null; // the latest roll
    this.rolled = false; // true once the rolling is done and the rolls are being played
    this.rolls = []; // rolls still to play this turn (a 6 is kept and rolled again)
    this.options = []; // for each roll: the tokens it can move
    this.movable = []; // every token at least one roll can move
    this.extraTurns = 0; // turns earned by captures and tokens reaching home
    this.skipped = false; // three 6s in a row: the turn is lost
    this.lastRoll = null;
    this.winners = [];
    this.forfeited = []; // seats that surrendered, in order
    this.captures = [];
    this.timeouts = []; // seat -> turns in a row that ran out
    this.stuck = []; // seat -> turns in a row with every token in base and no 6
    this.turnTimedOut = false;
    this.rewards = null; // seat -> coins, once a game is over
    this.endedEarly = false;
    this.rewardCapped = []; // seats whose payout was cut by the daily coin cap
    this.rewardPartial = []; // seats whose payout was cut by an early end
    this.lastMove = null;
    this.seq = 0;
    this.log = [];
    this.emotes = [];
    this.emoteSeq = 0;
    this.lastEmote = new Map(); // userId -> time
    this.chat = []; // { id, userId, name, text, at }
    this.chatSeq = 0;
    this.lastChat = new Map(); // userId -> time
    this.turnDeadline = null;
    this.timer = null;
  }

  // ---------- connections ----------

  connect(user) {
    this.connected.set(user.id, (this.connected.get(user.id) || 0) + 1);
    this.people.set(user.id, user.name);
    // Nobody hosts until someone asks to, except a game already running needs someone in charge.
    if (!this.hostId && this.phase !== 'lobby') this.hostId = user.id;
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
    this.people.delete(user.id);
    const seat = this.seatOf(user.id);
    if (seat >= 0) {
      if (this.phase === 'lobby') this.seats[seat] = null;
      else this.seats[seat].connected = false;
    }
    if (this.hostId === user.id) this.hostId = this.nextHost();
    this.changed();
  }

  // When the host leaves: another player takes over, or failing that anyone still watching.
  // A room nobody is in has no host (and the server soon closes it).
  nextHost() {
    const seated = this.seats.find((s) => s && !s.bot && this.connected.has(s.userId));
    if (seated) return seated.userId;
    return this.connected.keys().next().value ?? null;
  }

  // "Mr.Quack's room"
  get name() {
    const host = this.people.get(this.hostId) || this.seats.find((s) => s && !s.bot)?.name;
    return host ? `${host}'s room` : 'Open room';
  }

  // One line in the room list.
  summary(instanceId) {
    const taken = MODES[this.mode].seats.filter((i) => this.seats[i]).length;
    return {
      id: this.id,
      name: this.name,
      mode: this.mode,
      label: MODES[this.mode].label,
      players: taken,
      seats: MODES[this.mode].seats.length,
      people: this.connected.size,
      phase: this.phase,
      visibility: this.visibility,
      sameCall: !!instanceId && instanceId === this.instanceId,
    };
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
      case 'host': return this.host(user);
      case 'join': return this.join(user);
      case 'sit': return this.sit(user, msg.seat);
      case 'stand': return this.stand(user);
      case 'addBot': return this.addBot(user, msg.seat);
      case 'fillBots': return this.fillBots(user);
      case 'removeSeat': return this.removeSeat(user, msg.seat);
      case 'setMode': return this.setMode(user, msg.mode);
      case 'start': return this.start(user);
      case 'roll': return this.roll(user);
      case 'move': return this.move(user, msg.token, msg.roll);
      case 'emote': return this.emote(user, msg.item, msg.idx);
      case 'chat': return this.say(user, msg.text);
      case 'surrender': return this.surrender(user);
      case 'newGame': return this.newGame(user);
      case 'setVisibility': return this.setVisibility(user, msg.visibility);
      case 'setChat': return this.setChat(user, msg.on);
      case 'kick': return this.kick(user, msg.userId);
      default: throw new Error('Unknown action');
    }
  }

  // Opens a game: the host takes the first free seat and others can join.
  host(user) {
    this.requirePhase('lobby');
    if (this.hostId && this.hostId !== user.id) {
      throw new Error(`${this.people.get(this.hostId) || 'Someone'} is already hosting — join their game`);
    }
    this.hostId = user.id;
    if (this.seatOf(user.id) < 0) this.takeFreeSeat(user);
    this.changed();
  }

  join(user) {
    this.requirePhase('lobby');
    if (!this.hostId) throw new Error('Nobody is hosting yet');
    if (this.seatOf(user.id) >= 0) return;
    this.takeFreeSeat(user);
    this.changed();
  }

  takeFreeSeat(user) {
    const free = MODES[this.mode].seats.find((i) => !this.seats[i]);
    if (free === undefined) throw new Error('The game is full');
    this.seats[free] = { userId: user.id, name: user.name, bot: false, connected: true };
  }

  sit(user, seat) {
    this.requirePhase('lobby');
    if (!this.hostId) throw new Error('Nobody is hosting yet');
    if (!this.validSeat(seat)) throw new Error('Bad seat');
    if (this.seatOf(user.id) === seat) return;
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
    this.timeouts = Array(this.board.arms).fill(0);
    this.stuck = Array(this.board.arms).fill(0);
    this.rewards = null;
    this.endedEarly = false;
    this.rewardCapped = [];
    this.rewardPartial = [];
    this.lastMove = null;
    this.log = [];
    this.turn = active[randomInt(active.length)];
    this.resetTurn();
    this.addLog(`Game started! ${this.seats[this.turn].name} goes first.`);
    this.changed();
  }

  roll(user) {
    this.requireTurn(user);
    // A second tap that crossed the first in flight (or the timer rolling for them at the
    // same moment): the roll already happened, so there's nothing to complain about.
    if (this.rolled) return;
    this.timeouts[this.turn] = 0; // they're here: forget earlier timeouts
    this.doRoll();
  }

  // `roll` is which of the turn's rolls to use; without it, the first one that can move the token.
  move(user, token, roll) {
    this.requireTurn(user);
    if (!this.rolled) throw new Error('Roll first');
    const idx = Number.isInteger(roll) ? roll : this.options.findIndex((o) => o.includes(token));
    if (!this.options[idx]?.includes(token)) throw new Error("That token can't move");
    this.timeouts[this.turn] = 0;
    this.clearTimer(); // cancels a pending auto-move
    this.doMove(token, idx);
  }

  surrender(user) {
    this.requirePhase('playing');
    const seat = this.seatOf(user.id);
    if (seat < 0 || !this.inPlay().includes(seat)) throw new Error("You're not playing in this game");
    this.forfeit(seat, `🏳️ ${this.seats[seat].name} surrendered.`);
  }

  // Takes a seat out of the game: its pawns leave the board and it places last.
  forfeit(seat, message) {
    this.forfeited.push(seat);
    this.seats[seat].surrendered = true;
    this.tokens[seat] = [-1, -1, -1, -1];
    this.addLog(message);
    // A game that ends here was cut short: survivors get progress-scaled pay.
    // If the game continues, it wasn't ended by this — put the flag back.
    this.endedEarly = true;
    if (this.endIfOver()) return;
    this.endedEarly = false;
    if (this.turn === seat) {
      this.clearTimer();
      this.nextTurn();
    } else {
      this.changed();
    }
  }

  emote(user, itemId, idx = 0) {
    const item = ITEMS[itemId];
    if (!item || !['emote', 'emote-pack'].includes(item.type)) throw new Error('Unknown emote');
    const seat = this.seatOf(user.id);
    if (seat < 0) throw new Error('Take a seat to send emotes');
    if (!ownsItem(this.profiles?.peek(user.id), itemId)) throw new Error("You don't own that emote");
    const entry = item.type === 'emote' ? { emoji: item.emoji, img: item.img } : item.emotes?.[idx];
    if (!entry) throw new Error('Unknown emote');
    const now = Date.now();
    if (now - (this.lastEmote.get(user.id) || 0) < EMOTE_COOLDOWN_MS) return;
    this.lastEmote.set(user.id, now);
    this.emotes = this.emotes.filter((e) => now - e.at < EMOTE_TTL_MS);
    this.emotes.push({ id: ++this.emoteSeq, seat, emoji: entry.emoji, img: entry.img, at: now });
    this.onChange(this); // nothing in the game changed, so skip automate()
  }

  // The host can end a game at any time; once a game is over, anyone can start the next one.
  // Chat is open to everyone in the Activity, players and watchers alike.
  say(user, text) {
    if (!this.chatOn) throw new Error('The host turned chat off in this room');
    let clean = cleanText(
      String(text ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, CHAT_MAX_LEN),
    );
    // :slug: codes render as image emotes only when the sender owns the pack —
    // otherwise they fall back to the plain word so nobody can fake them.
    clean = clean
      .replace(/:([a-z0-9-]+):/g, (m, slug) =>
        EMOTE_SLUGS[slug] && !ownsItem(this.profiles?.peek(user.id), EMOTE_SLUGS[slug].item) ? slug : m,
      )
      .trim();
    if (!clean) return;
    const now = Date.now();
    if (now - (this.lastChat.get(user.id) || 0) < CHAT_COOLDOWN_MS) throw new Error('Slow down a little');
    this.lastChat.set(user.id, now);
    this.chat.push({ id: ++this.chatSeq, userId: user.id, name: this.people.get(user.id) || user.name, text: clean, at: now });
    if (this.chat.length > CHAT_KEEP) this.chat.shift();
    // A message that's just a sticker also floats over the sender's base, like a board reaction.
    const solo = /^:([a-z0-9-]+):$/.exec(clean);
    const seat = solo && this.seatOf(user.id);
    if (solo && EMOTE_SLUGS[solo[1]] && seat >= 0) {
      this.emotes = this.emotes.filter((e) => now - e.at < EMOTE_TTL_MS);
      this.emotes.push({ id: ++this.emoteSeq, seat, img: EMOTE_SLUGS[solo[1]].img, at: now });
    }
    this.onChange(this); // nothing in the game changed, so skip automate()
  }

  // ---------- room settings (host only) ----------

  setVisibility(user, visibility) {
    this.requireHost(user);
    if (visibility !== 'public' && visibility !== 'private') throw new Error('Unknown setting');
    this.visibility = visibility;
    this.changed();
  }

  setChat(user, on) {
    this.requireHost(user);
    this.chatOn = !!on;
    this.changed();
  }

  // Removes someone from the room for good: their seat is freed (or, mid-game, they're
  // surrendered) and they can't rejoin. The server closes their connection to the room.
  kick(user, userId) {
    this.requireHost(user);
    if (userId === user.id) throw new Error("You can't kick yourself");
    if (!this.people.has(userId) && this.seatOf(userId) < 0) throw new Error("They're not in this room");
    const name = this.people.get(userId) || this.seats[this.seatOf(userId)]?.name || 'Someone';
    this.banned.add(userId);
    const seat = this.seatOf(userId);
    this.addLog(`🚫 ${name} was removed by the host.`);
    if (seat >= 0) {
      if (this.phase === 'lobby') this.seats[seat] = null;
      else if (this.phase === 'playing' && this.inPlay().includes(seat)) {
        this.onKick(userId);
        this.forfeit(seat, `🏳️ ${name} is out of the game.`);
        return;
      }
    }
    this.onKick(userId);
    this.changed();
  }

  newGame(user) {
    if (this.phase === 'lobby') return;
    if (this.phase === 'playing') this.requireHost(user);
    this.clearTimer();
    this.phase = 'lobby';
    // Drop disconnected humans, keep everyone else seated.
    this.seats = this.seats.map((s) => (s && (s.bot || s.connected) ? s : null));
    this.tokens = newTokens(this.board.arms);
    this.dice = null;
    this.lastRoll = null;
    this.resetTurn();
    this.lastMove = null;
    this.winners = [];
    this.forfeited = [];
    for (const s of this.seats) if (s) delete s.surrendered;
    this.rewards = null;
    this.endedEarly = false;
    this.rewardCapped = [];
    this.rewardPartial = [];
    this.stuck = Array(this.board.arms).fill(0);
    this.turnDeadline = null;
    this.changed();
  }

  // ---------- game flow ----------

  // A 6 is kept and you roll again; once you roll something else, you play all the rolls.
  // Every token still in base?
  allInBase(seat) {
    return this.tokens[seat].every((p) => p === -1);
  }

  doRoll() {
    if (this.rolled) throw new Error('Already rolled');
    const seat = this.turn;
    // Stuck in base for STUCK_TURNS dead turns: this roll is a guaranteed 6.
    // Random rolls are untouched — only the first roll of such a turn is forced.
    const pity = this.rolls.length === 0 && this.allInBase(seat) && this.stuck[seat] >= STUCK_TURNS;
    const dice = pity ? 6 : this.rng();
    if (dice === 6) this.stuck[seat] = 0; // any 6 ends the drought, forced or not
    this.dice = dice;
    this.rolls.push(dice);
    this.seq++;
    this.lastRoll = { seq: this.seq, seat, value: dice };
    this.lastMove = null;
    // Three 6s in a row: the whole turn is lost, kept 6s and earned extra turns included.
    if (dice === 6 && this.rolls.length >= MAX_SIXES) {
      this.addLog(`${this.seats[seat].name} rolled three 6s — turn skipped!`);
      this.rolled = true;
      this.skipped = true;
      this.rolls = [];
      this.options = [];
      this.movable = [];
      this.changed();
      this.schedule(this.delays.noMove, () => this.nextTurn());
      return;
    }
    if (dice === 6) {
      this.addLog(`${this.seats[seat].name} rolled a 6 — rolls again`);
      this.turnDeadline = Date.now() + this.delays.timeout;
      this.changed();
      return;
    }
    this.rolled = true;
    this.playRolls();
  }

  // Works out what the rolls left can do, and moves for the player when there's no real choice.
  playRolls() {
    const seat = this.turn;
    const name = this.seats[seat].name;
    this.options = this.rolls.map((v) => legalMoves(this.tokens, seat, v, this.board));
    this.movable = [...new Set(this.options.flat())];
    if (this.movable.length === 0) {
      const left = this.rolls.join(' and ');
      this.addLog(this.lastMove ? `${name} can't use the ${left}.` : `${name} rolled a ${left} — no moves.`);
      // After a move the board is animating anyway; with nothing moved, give people time to read the dice.
      const wait = this.lastMove ? this.delays.autoMove : this.delays.noMove;
      this.rolls = [];
      this.options = [];
      this.changed();
      this.schedule(wait, () => this.endRolls());
      return;
    }
    // Only one real choice (one roll value, and tokens that would all end up in the same place)?
    // Make the move for the player once the dice has landed.
    const choices = new Set();
    this.options.forEach((tokens, i) => {
      for (const t of tokens) choices.add(`${this.rolls[i]}:${this.tokens[seat][t]}`);
    });
    if (choices.size === 1) {
      const idx = this.options.findIndex((o) => o.length > 0);
      this.changed();
      this.schedule(this.delays.autoMove, () => {
        if (this.phase === 'playing' && this.rolled) this.doMove(this.options[idx][0], idx);
      });
      return;
    }
    this.changed();
  }

  // Every roll is played: take an earned extra turn, or pass the dice on.
  endRolls() {
    if (this.phase !== 'playing') return;
    if (this.extraTurns === 0) return this.nextTurn();
    this.extraTurns--;
    this.rolled = false;
    this.rolls = [];
    this.options = [];
    this.movable = [];
    this.turnDeadline = Date.now() + this.delays.timeout;
    this.changed();
  }

  doMove(token, idx) {
    if (!this.rolled) throw new Error('Roll first');
    if (!this.options[idx]?.includes(token)) throw new Error("That token can't move");
    const seat = this.turn;
    const name = this.seats[seat].name;
    const value = this.rolls[idx];
    const result = applyMove(this.tokens, seat, token, value, this.activeSeats(), this.board);
    this.rolls.splice(idx, 1);
    this.seq++;
    this.lastMove = { ...result, dice: value, seq: this.seq };
    this.options = [];
    this.movable = [];
    this.captures[seat] += result.captured.length;

    // One line for every move, then any capture.
    if (result.finishedToken) this.addLog(`${name} used a ${value} and brought a token home!`);
    else if (result.from < 0) this.addLog(`${name} used a 6 to bring a token out`);
    else this.addLog(`${name} moved a token ${value}`);
    for (const c of result.captured) {
      this.addLog(`${name} captured ${this.seats[c.seat].name}'s token!`);
    }

    if (result.allHome) {
      this.winners.push(seat);
      this.addLog(`🏆 ${name} finished ${PLACES[this.winners.length - 1]}!`);
      if (!this.endIfOver()) this.nextTurn();
      return;
    }

    // Each capture and each token home earns a turn of its own, on top of the 6s already rolled.
    const earned = result.captured.length + (result.finishedToken ? 1 : 0);
    if (earned) {
      this.extraTurns += earned;
      this.addLog(`${name} earned ${earned === 1 ? 'an extra turn' : `${earned} extra turns`}`);
    }
    if (this.rolls.length) this.playRolls();
    else this.endRolls();
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
    this.rewardCapped = [];
    this.rewardPartial = []; // seats whose placement payout was cut by an early end
    this.winners.forEach((s, place) => {
      const seat = this.seats[s];
      if (seat.bot || this.forfeited.includes(s)) return;
      // A game cut short by a surrender pays for how far you got; a game that ran
      // its course pays the full placement even if the last-placed seat didn't finish.
      const share = this.endedEarly ? progressShare(this.tokens, s, this.board) : 1;
      if (share < 1) this.rewardPartial.push(s);
      const coins = Math.round((REWARDS.place[place] * share + this.captures[s] * REWARDS.capture) * factor);
      const granted = this.profiles ? this.profiles.addCoins(seat.userId, coins) : coins;
      this.rewards[s] = granted;
      if (granted < coins) this.rewardCapped.push(s);
    });
  }

  nextTurn() {
    if (this.phase !== 'playing') return;
    // Count the ending seat's drought: still all in base means another dead turn.
    const ended = this.turn;
    if (this.seats[ended]) {
      this.stuck[ended] = this.allInBase(ended) ? this.stuck[ended] + 1 : 0;
    }
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
    this.rolls = [];
    this.options = [];
    this.movable = [];
    this.extraTurns = 0;
    this.skipped = false;
    this.turnTimedOut = false;
    this.turnDeadline = Date.now() + this.delays.timeout;
  }

  // Bots, disconnected players and AFK timeouts act automatically.
  automate() {
    this.clearTimer();
    if (this.phase !== 'playing') return;
    const seat = this.seats[this.turn];
    const auto = seat.bot || !seat.connected;
    // Bots roll after a short pause, and move once everyone has seen the dice.
    const botDelay = this.rolled ? this.delays.autoMove : this.delays.bot;
    const delay = auto ? botDelay : Math.max(0, this.turnDeadline - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      // A connected player let the clock run out: count it once per turn, and
      // take them out of the game after too many turns in a row.
      if (!auto && !this.turnTimedOut) {
        this.turnTimedOut = true;
        const s = this.turn;
        this.timeouts[s] = (this.timeouts[s] || 0) + 1;
        if (this.timeouts[s] >= MAX_TIMEOUTS) {
          this.forfeit(s, `⏰ ${this.seats[s].name} ran out of time ${MAX_TIMEOUTS} turns in a row and was removed.`);
          return;
        }
      }
      try {
        if (!this.rolled) this.doRoll();
        else {
          // Plays the rolls in order, each on its best token.
          const idx = this.options.findIndex((o) => o.length > 0);
          const t = idx < 0 ? null : chooseBotMove(this.tokens, this.turn, this.rolls[idx], this.activeSeats(), this.board);
          if (t !== null) this.doMove(t, idx);
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
      roomId: this.id,
      roomName: this.name,
      code: this.code,
      visibility: this.visibility,
      chatOn: this.chatOn,
      mode: this.mode,
      seatsAllowed: MODES[this.mode].seats,
      phase: this.phase,
      hostId: this.hostId,
      // Players see their own board theme; this is the fallback for watchers who haven't picked one.
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
      rolls: this.rolls,
      options: this.options,
      movable: this.movable,
      extraTurns: this.extraTurns,
      skipped: this.skipped,
      lastRoll: this.lastRoll,
      winners: this.winners,
      rewards: this.rewards,
      rewardCapped: this.rewardCapped,
      rewardPartial: this.rewardPartial,
      timeouts: this.timeouts,
      maxTimeouts: MAX_TIMEOUTS,
      lastMove: this.lastMove,
      seq: this.seq,
      log: this.log.slice(-8),
      emotes: this.emotes.filter((e) => now - e.at < EMOTE_TTL_MS),
      turnDeadline: this.turnDeadline,
      turnTimeout: this.delays.timeout,
      serverNow: now,
      spectators: this.connected.size,
      people: [...this.people].map(([id, name]) => ({ id, name })),
      chat: this.chat,
    };
  }
}

function newBot(seat) {
  return { userId: `bot-${seat}`, name: BOT_NAMES[seat], bot: true, connected: true };
}

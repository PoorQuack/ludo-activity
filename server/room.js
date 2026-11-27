// One game room: its lobby, the game, its chat. Rooms are created and listed by rooms.js.
import { resolveMentions } from '../shared/mentions.js';
import { randomInt } from 'node:crypto';
import { MODES, boardFor, teamsOf } from '../shared/board.js';
import { DEFAULT_EQUIPPED, EMOTE_SLUGS, ITEMS, POT_SPLIT, REWARDS, STAKES, ownsItem, potFee } from '../shared/shop.js';
import { newTokens, legalMoves, applyMove, chooseBotMove, bestBotScore, progressShare, BOT_LEVELS } from './rules.js';
import { makeReplySnapshot, toggleReaction } from '../shared/chat.js';
import { cleanText } from './filter.js';
import { isRigged } from './rig.js';

const BOT_DELAY_MS = 900;
const NO_MOVE_DELAY_MS = 1800;
const AUTO_MOVE_MS = 1150; // the dice spins, then stays readable, before a bot or forced move
const TURN_TIMEOUT_MS = 30_000;
// A player whose connection drops gets this long to come back (phone blip, refresh) before
// their turns are played for them. Their turn clock keeps running meanwhile.
const DISCONNECT_GRACE_MS = 12_000;
// Every player still racing has left: the game pauses this long, then ends with no coins.
const PAUSE_MS = 60_000;
const MAX_TIMEOUTS = 3; // turns in a row a player can let run out before they're surrendered
const MAX_SIXES = 3; // this many throws with a 6 in a row loses the turn
// 6-arm boards (6 players, 3 vs 3) roll two dice per throw: one dice made those games drag.
const diceFor = (arms) => (arms === 6 ? 2 : 1);

// The decider's two colours: the first team's first colour and the colour straight across the
// board, so the race starts from opposite sides. In 2v2 the opposite colour is a teammate's
// seat, so the second team races that colour for the decider.
export function deciderColors(teams, arms) {
  const first = teams[0][0];
  return [first, (first + arms / 2) % arms];
}
const STUCK_TURNS = 5; // dead turns (no 6) with every token in base before the next roll is a free 6
const EMOTE_COOLDOWN_MS = 1200;
const CHAT_COOLDOWN_MS = 700;
const CHAT_KEEP = 40; // messages kept (and sent) per room
const CHAT_MAX_LEN = 100;
const EMOTE_TTL_MS = 3000;
const LB_PER_BEATEN = 10; // v1 leaderboard points for each human finished ahead of (until Dec 2026)
const LB_WIN_BONUS = 10; // …and for finishing ahead of every other human
const TYPING_MS = 2500; // "is typing…" lasts this long after the last ping (clients ping every second)
const BOT_NAMES = ['Bot Neko', 'Bot Mila', 'Bot Gigi', 'Bot Lizzy', 'Bot SamSam', 'Bot Coco'];
const PLACES = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

// What toSave() keeps of a room (see "surviving a server restart" below).
const SAVED_FIELDS = [
  'id', 'code', 'visibility', 'quick', 'tally', 'instanceId', 'mode', 'seats', 'hostId', 'phase',
  'tokens', 'turn', 'dice', 'diceValues', 'sixThrows', 'rolled', 'rolls', 'options', 'movable', 'extraTurns', 'skipped',
  'lastRoll', 'winners', 'teamOrder', 'forfeited', 'feud', 'streak', 'revenges', 'hits', 'wasLast', 'captures', 'timeouts', 'stuck', 'turnTimedOut',
  'rewards', 'endedEarly', 'rewardCapped', 'rewardPartial', 'lastMove', 'seq', 'log',
  'emoteSeq', 'chat', 'chatSeq', 'noCoins', 'noPoints', 'decider', 'actor', 'racePoints', 'rigged',
  'stake', 'winnerTakeAll', 'pot', 'potWon',
];

export class Room {
  constructor(
    id,
    { onChange, onKick, onGameEnd, onGameStart, onStat, rng = () => randomInt(1, 7), delays = {}, profiles = null, code = null, visibility = 'private', instanceId = null, fee = potFee } = {},
  ) {
    this.id = id;
    this.fee = fee; // the house's cut of a pot (shared/shop.js potFee; tests can turn it off)
    this.code = code; // short code anyone can join with, e.g. "K7QX"
    this.visibility = visibility; // 'public': listed for everyone; 'private': your Discord call or the code
    this.quick = false; // quick game: two tokens each instead of four (the host's choice, in the lobby)
    // Cash bets: `stake` is the Gold Coin entry fee (0 = free). In Classic (`winnerTakeAll: false`),
    // the pot splits across all places except last; in Stakes Rooms (`winnerTakeAll: true`), only
    // 1st place (or winning team) wins 100% of the pot and earns extra leaderboard points.
    this.stake = 0;
    this.winnerTakeAll = false;
    this.pot = null;
    this.potWon = null;
    this.instanceId = instanceId; // the Discord call it was created in
    this.chatOn = true; // (always on: each player turns typed chat off for themselves in ⚙ Settings)
    this.banned = new Set(); // userIds the host kicked: they can't come back
    this.onKick = onKick || (() => {}); // the server takes a kicked player out of the room
    this.onChange = onChange || (() => {});
    this.onGameEnd = onGameEnd || (() => {}); // results of a game that paid out (for the leaderboards)
    this.onGameStart = onGameStart || (() => {}); // the humans in a game that just started (for friends lists)
    this.onStat = onStat || (() => {}); // things players did, for daily quests: (userId, name, stat, n)
    this.rng = rng;
    this.delays = {
      bot: BOT_DELAY_MS,
      noMove: NO_MOVE_DELAY_MS,
      autoMove: AUTO_MOVE_MS,
      timeout: TURN_TIMEOUT_MS,
      disconnectGrace: DISCONNECT_GRACE_MS,
      pause: PAUSE_MS,
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
    this.diceValues = []; // every dice of the latest throw (two on 6-arm boards)
    this.sixThrows = 0; // throws in a row this turn that had a 6
    this.options = []; // for each roll: the tokens it can move
    this.movable = []; // every token at least one roll can move
    this.extraTurns = 0; // turns earned by captures and tokens reaching home
    this.skipped = false; // three 6s in a row: the turn is lost
    this.lastRoll = null;
    this.winners = [];
    this.tally = {}; // seat -> { six, capture, home, out }: this game's numbers, for the finish card
    this.feud = {}; // seat -> the seat that last captured it: capture them back for revenge
    this.streak = {}; // seat -> captures in a row without being captured
    this.revenges = {}; // seat -> revenges taken this game (each pays REWARDS.revenge)
    this.hits = {}; // seat -> times its tokens were captured this game (the Untouchable badge)
    this.wasLast = {}; // seat -> true once it has been last in the race (the Comeback badge)
    this.teamOrder = null; // team games, once over: team numbers from first to last
    // Team games score places (2v2: 3/2/1/0 points). A tie goes to a decider round: one colour per
    // team, teammates taking turns with it ({ colors: team -> seat, players: team -> seats, next }).
    this.decider = null;
    this.actor = null; // in the decider: the player rolling for the colour whose turn it is
    this.racePoints = null; // team -> points from the main race, once it's settled
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
    this.typingAt = new Map(); // userId -> { name, at }
    this.turnDeadline = null;
    this.timer = null;
    this.pausedAt = null; // set while the game waits for its players to come back
    this.pauseTimer = null;
    this.noCoins = null; // why a finished game paid nothing: 'bots' (no other human), 'abandoned' or 'test'
    this.noPoints = null; // 'coop': coins paid, but no leaderboard points (every human on one team against bots)
    this.rigged = false; // a rigged roll happened (scripts/rig-dice.sh): the game pays nothing
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
      delete this.seats[seat].disconnectedAt;
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
      else {
        this.seats[seat].connected = false;
        this.seats[seat].disconnectedAt = Date.now(); // starts their grace period
      }
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
      quick: this.quick,
      stake: this.stake,
      winnerTakeAll: this.winnerTakeAll,
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
      case 'botLevel': return this.setBotLevel(user, msg.seat, msg.level);
      case 'fillBots': return this.fillBots(user);
      case 'removeSeat': return this.removeSeat(user, msg.seat);
      case 'setMode': return this.setMode(user, msg.mode);
      case 'start': return this.start(user);
      case 'roll': return this.roll(user, msg.seq);
      case 'move': return this.move(user, msg.token, msg.roll, msg.seq);
      case 'emote': return this.emote(user, msg.item, msg.idx);
      case 'typing': return this.typing(user, msg.on !== false);
      case 'chat': return this.say(user, msg.text, msg.replyId, msg.mentions);
      case 'react': return this.react(user, msg.id, msg.emoji);
      case 'surrender': return this.surrender(user);
      case 'newGame': return this.newGame(user);
      case 'setVisibility': return this.setVisibility(user, msg.visibility);
      case 'setQuick': return this.setQuick(user, msg.quick);
      case 'setStake': return this.setStake(user, msg.stake);
      case 'setChat': return; // gone: chat is each player's own choice now (old clients may still send it)
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
    this.seats[seat] = newBot(seat, 'medium', this.seats);
    this.changed();
  }

  // Lobby, host only: how well a bot plays (Easy / Medium / Hard / Impossible)
  setBotLevel(user, seat, level) {
    this.requirePhase('lobby');
    this.requireHost(user);
    if (!this.seats[seat]?.bot) throw new Error("That's not a bot");
    if (!BOT_LEVELS.includes(level)) throw new Error('Unknown difficulty');
    this.seats[seat].level = level;
    this.changed();
  }

  fillBots(user) {
    this.requirePhase('lobby');
    this.requireHost(user);
    for (const i of MODES[this.mode].seats) if (!this.seats[i]) this.seats[i] = newBot(i, 'medium', this.seats);
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
      if (i !== undefined) this.seats[i] = newBot(i, o.s.level, this.seats);
    }
    this.changed();
  }

  start(user) {
    this.requirePhase('lobby');
    this.requireHost(user);
    const active = this.activeSeats();
    if (active.length < 2) throw new Error('Need at least 2 players (add a bot!)');
    if (this.teams && active.length < MODES[this.mode].seats.length) throw new Error('Team games need every seat filled (add bots!)');
    if (!active.some((i) => !this.seats[i].bot)) throw new Error('At least one human must play');
    this.collectStakes(active); // (throws, taking nothing, if someone can't pay)
    this.phase = 'playing';
    this.tokens = newTokens(this.board.arms);
    if (this.quick) for (const seat of this.tokens) seat[2] = seat[3] = this.board.finished;
    this.winners = [];
    this.tally = {}; // seat -> { six, capture, home, out }: this game's numbers, for the finish card
    this.feud = {}; // seat -> the seat that last captured it: capture them back for revenge
    this.streak = {}; // seat -> captures in a row without being captured
    this.revenges = {}; // seat -> revenges taken this game (each pays REWARDS.revenge)
    this.hits = {}; // seat -> times its tokens were captured this game (the Untouchable badge)
    this.wasLast = {}; // seat -> true once it has been last in the race (the Comeback badge)
    this.teamOrder = null;
    this.decider = null;
    this.actor = null;
    this.racePoints = null;
    this.forfeited = [];
    for (const i of active) delete this.seats[i].surrendered;
    this.captures = Array(this.board.arms).fill(0);
    this.timeouts = Array(this.board.arms).fill(0);
    this.stuck = Array(this.board.arms).fill(0);
    this.rewards = null;
    this.endedEarly = false;
    this.rewardCapped = [];
    this.rewardPartial = [];
    this.noCoins = null;
    this.noPoints = null;
    this.rigged = false;
    this.clearPause();
    this.lastMove = null;
    this.log = [];
    this.turn = active[randomInt(active.length)];
    this.resetTurn();
    this.addLog(`Game started! ${this.seats[this.turn].name} goes first.`);
    this.changed();
    const humans = active.filter((i) => !this.seats[i].bot).map((i) => ({ userId: this.seats[i].userId, name: this.seats[i].name }));
    if (humans.length > 1) this.onGameStart(humans);
  }

  roll(user, expectedSeq) {
    this.requireTurn(user);
    // Ignore a stale retry whose state has already moved on (even after a 6, where rolled stays false).
    if (expectedSeq !== undefined && expectedSeq !== null && this.seq !== expectedSeq) return;
    // A second tap that crossed the first in flight (or the timer rolling for them at the
    // same moment): the roll already happened, so there's nothing to complain about.
    if (this.rolled) return;
    this.timeouts[this.actorSeat()] = 0; // they're here: forget earlier timeouts
    this.doRoll();
  }

  // `roll` is which of the turn's rolls to use; without it, the first one that can move the token.
  move(user, token, roll, expectedSeq) {
    this.requireTurn(user);
    // Ignore a stale retry whose move already went through on the server.
    if (expectedSeq !== undefined && expectedSeq !== null && this.seq !== expectedSeq) return;
    if (!this.rolled) throw new Error('Roll first');
    const idx = Number.isInteger(roll) ? roll : this.options.findIndex((o) => o.includes(token));
    if (!this.options[idx]?.includes(token)) throw new Error("That token can't move");
    this.timeouts[this.actorSeat()] = 0;
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
    const wasActing = this.actorSeat() === seat;
    if (this.decider) {
      // the colour stays on the board for their teammates; they just stop taking turns with it
      this.decider.players = this.decider.players.map((ps) => ps.filter((s) => s !== seat));
    } else this.tokens[seat] = [-1, -1, -1, -1];
    this.addLog(message);
    // A game that ends here before anyone got all their tokens home was cut short: the
    // survivors get progress-scaled pay (a game handed over isn't worth full price). Once
    // someone has finished, the race had a real winner and everyone is paid in full.
    // If the game continues, it wasn't ended by this — put the flag back.
    this.endedEarly = !this.winners.some((s) => !this.forfeited.includes(s));
    if (this.endIfOver()) return;
    this.endedEarly = false;
    if (wasActing) {
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
  say(user, text, replyId = null, mentions = null) {
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
    const msg = { id: ++this.chatSeq, userId: user.id, name: this.people.get(user.id) || user.name, text: clean, at: now };
    const prof = this.profiles?.peek(user.id);
    if (this.profiles?.passActive?.(prof)) msg.vip = true; // Battle Pass: a gold name with a crown
    if (prof?.equipped?.frame && prof.equipped.frame !== 'frame-none') msg.frame = prof.equipped.frame; // round their picture in the chat
    const replyTo = replyId ? makeReplySnapshot(this.chat.find((m) => m.id === Number(replyId))) : null;
    if (replyTo) msg.replyTo = replyTo;
    // @mentions: only people in this room (not yourself)
    const named = resolveMentions(clean, mentions, (id) => id !== user.id && this.people.get(id));
    if (named.length) msg.mentions = named;
    this.chat.push(msg);
    this.typingAt.delete(user.id); // they sent it: no longer typing
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

  react(user, msgId, emoji) {
    if (!user?.id || (!this.people.has(user.id) && this.seatOf(user.id) < 0)) return;
    const msg = this.chat.find((m) => m.id === Number(msgId));
    if (!msg) return;
    if (toggleReaction(msg, user.id, emoji)) this.onChange(this);
  }

  // A line from the game itself (e.g. "updating, back in a few seconds"), shown in everyone's chat.
  systemChat(text) {
    this.chat.push({ id: ++this.chatSeq, userId: 'system', name: '', text, at: Date.now(), system: true });
    if (this.chat.length > CHAT_KEEP) this.chat.shift();
    this.onChange(this);
  }

  // A "still typing" ping (throttled server-side so a keymashing client can't flood), or
  // `on` false: they stopped (emptied the box, left it), so the line goes at once.
  typing(user, on = true) {
    if (!on) {
      if (this.typingAt.delete(user.id)) this.onChange(this);
      return;
    }
    const now = Date.now();
    const prev = this.typingAt.get(user.id)?.at || 0;
    if (now - prev < 800) return;
    this.typingAt.set(user.id, { name: this.people.get(user.id) || user.name, at: now });
    this.onChange(this);
  }

  // ---------- room settings (host only) ----------

  setVisibility(user, visibility) {
    this.requireHost(user);
    if (visibility !== 'public' && visibility !== 'private') throw new Error('Unknown setting');
    this.visibility = visibility;
    this.changed();
  }

  // Quick game: everyone races two tokens instead of four, so a game takes about half as long.
  // (The other two start already home: the rules, the win and the payout are all unchanged.)
  setQuick(user, quick) {
    this.requireHost(user);
    this.requirePhase('lobby');
    this.quick = !!quick;
    this.changed();
  }

  // Stakes / Classic bet: Gold Coins entry fee. Stakes Rooms keep `winnerTakeAll` and require > 0.
  setStake(user, stake) {
    this.requireHost(user);
    this.requirePhase('lobby');
    stake = Number(stake);
    if (!STAKES.includes(stake)) throw new Error('Unknown stake');
    if (this.winnerTakeAll && !stake) throw new Error('All In rooms require a stake');
    this.stake = stake;
    this.changed();
  }

  // Can this seat's player pay the stake? (bots never pay in)
  canPayStake(seat) {
    const s = this.seats[seat];
    if (!s || s.bot || !this.stake) return true;
    return !this.profiles || this.profiles.canStake(s.userId, this.stake);
  }

  // At the start: everyone pays in, or nobody does.
  collectStakes(active) {
    this.pot = null;
    this.potWon = null;
    if (!this.stake) return;
    const humans = active.filter((i) => !this.seats[i].bot);
    if (humans.length < 2) throw new Error('Stakes games need at least 2 people (bots don\'t pay in)');
    const broke = humans.filter((i) => !this.canPayStake(i));
    if (broke.length) {
      const names = broke.map((i) => this.seats[i].name).join(', ');
      throw new Error(`${names} ${broke.length > 1 ? "don't" : "doesn't"} have ${this.stake} coins for the stake`);
    }
    const paid = humans.map((seat) => ({ seat, userId: this.seats[seat].userId }));
    for (const p of paid) this.profiles?.takeStake(p.userId, this.stake);
    this.pot = { stake: this.stake, total: this.stake * paid.length, paid };
  }

  // Gives every stake back (a game that was abandoned, called off by the host, or rigged).
  refundPot(why) {
    if (!this.pot) return;
    for (const p of this.pot.paid) this.profiles?.payStake(p.userId, this.pot.stake);
    if (why) this.addLog(why);
    this.pot = null;
  }

  // The game is over:
  // - Stakes Rooms (`winnerTakeAll: true`): 100% of the pot goes to 1st place (or winning team).
  // - Classic (`winnerTakeAll: false`): split across all finishing places except last (POT_SPLIT).
  // Anyone who surrendered places last and gets nothing; bots never paid in.
  payPot() {
    const pot = this.pot;
    this.potWon = null;
    if (!pot) return;
    if (this.rigged) return this.refundPot('🎲 Test dice were used: everyone got their stake back.');
    const groups = this.teamOrder ? this.teamOrder.map((t) => this.teams[t].filter((s) => this.seats[s])) : this.winners.map((s) => [s]);
    const paid = (s) => pot.paid.some((p) => p.seat === s && this.seats[s]?.userId === p.userId);
    // the places, best first: every group with someone who paid in (for teams, the whole team)
    const places = groups.map((g) => g.filter(paid)).filter((g) => g.length);
    const placed = new Set(places.flat());
    for (const p of pot.paid) if (!placed.has(p.seat) && this.seats[p.seat]?.userId === p.userId) places.push([p.seat]); // (anyone missing: last)
    const live = (g) => g.some((s) => !this.forfeited.includes(s));
    const first = places.findIndex(live);
    if (first < 0) return this.refundPot('Nobody who paid in finished: everyone got their stake back.');
    this.potWon = {};
    const split = this.winnerTakeAll ? [100] : (POT_SPLIT[Math.min(places.length, 6)] || [100]);
    const cuts = places.map((g, i) => (live(g) ? split[i] || 0 : 0));
    if (this.winnerTakeAll) {
      cuts.fill(0);
      cuts[first] = 100;
    } else {
      cuts[first] += 100 - cuts.reduce((a, b) => a + b, 0); // surrendered places' cuts go to 1st
    }
    // the house's small cut first (shared/shop.js potFee), then the rest by place
    const fee = this.fee(pot.total);
    const prize = pot.total - fee;
    const shares = places.map((g, i) => Math.floor((prize * cuts[i]) / 100));
    shares[first] += prize - shares.reduce((a, b) => a + b, 0); // rounding: to 1st
    const lines = [];
    places.forEach((g, i) => {
      if (!shares[i]) return;
      const members = g.filter((s) => !this.forfeited.includes(s));
      const each = Math.floor(shares[i] / members.length);
      let odd = shares[i] - each * members.length;
      for (const s of members) {
        const coins = each + (odd-- > 0 ? 1 : 0);
        this.profiles?.payStake(this.seats[s].userId, coins);
        this.potWon[s] = coins;
        lines.push(`${this.seats[s].name} +${coins}`);
      }
    });
    const winners = Object.keys(this.potWon);
    if (winners.length === 1) this.addLog(`💰 ${this.seats[winners[0]].name} takes the pot: ${prize} coins!`);
    else if (places.filter((g, i) => shares[i]).length === 1) this.addLog(`💰 ${winners.map((s) => this.seats[s].name).join(' & ')} split the pot: ${prize} coins!`);
    else this.addLog(`💰 The pot is shared by place: ${lines.join(' · ')}`);
    if (fee) this.addLog(`🏦 House fee: ${fee} coins`);
    this.pot = null;
  }

  // Removes someone from the room for good: their seat is freed (or, mid-game, they're
  // surrendered) and they can't rejoin. The server closes their connection to the room.
  kick(user, userId) {
    this.requireHost(user);
    if (userId === user.id) throw new Error("You can't kick yourself");
    if (!this.people.has(userId) && this.seatOf(userId) < 0) throw new Error("They're not in this room");
    const why = this.kickBlocked(userId);
    if (why) throw new Error(why);
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

  // Kicking is for the lobby. Once a game starts, a host could kick whoever is about to beat
  // them, so the only players who can be removed are ones who have left (disconnected for
  // longer than their reconnect grace). Returns why not, or null if they can be kicked.
  kickBlocked(userId) {
    if (this.phase === 'lobby') return null;
    const seat = this.seatOf(userId);
    if (seat < 0 || this.seats[seat].connected) return 'Players can only be removed before the game starts, or once they have disconnected';
    const backBy = (this.seats[seat].disconnectedAt ?? 0) + this.delays.disconnectGrace;
    if (Date.now() < backBy) return 'They only just disconnected: give them a few seconds to come back';
    return null;
  }

  newGame(user) {
    if (this.phase === 'lobby') return;
    if (this.phase === 'playing') this.requireHost(user);
    if (this.phase === 'playing') this.refundPot(); // called off by the host: stakes go back
    this.potWon = null;
    this.clearTimer();
    this.clearPause();
    this.noCoins = null;
    this.noPoints = null;
    this.rigged = false;
    this.phase = 'lobby';
    // Drop disconnected humans, keep everyone else seated.
    this.seats = this.seats.map((s) => (s && (s.bot || s.connected) ? s : null));
    this.tokens = newTokens(this.board.arms);
    this.dice = null;
    this.lastRoll = null;
    this.resetTurn();
    this.lastMove = null;
    this.winners = [];
    this.tally = {}; // seat -> { six, capture, home, out }: this game's numbers, for the finish card
    this.feud = {}; // seat -> the seat that last captured it: capture them back for revenge
    this.streak = {}; // seat -> captures in a row without being captured
    this.revenges = {}; // seat -> revenges taken this game (each pays REWARDS.revenge)
    this.hits = {}; // seat -> times its tokens were captured this game (the Untouchable badge)
    this.wasLast = {}; // seat -> true once it has been last in the race (the Comeback badge)
    this.teamOrder = null;
    this.decider = null;
    this.actor = null;
    this.racePoints = null;
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
  // The dice for this roll. An Impossible bot gets a little luck: about a third of the time it
  // rolls twice and keeps the roll that helps it more (a 6 counts for its extra roll, and a third
  // 6 in a row, which loses the turn, counts against it).
  luckyRoll() {
    const actor = this.seats[this.actorSeat()];
    // Testing (scripts/rig-dice.sh): two 6s to start every turn, then a roll that isn't a 6
    if (actor && !actor.bot && isRigged(actor.userId)) {
      this.rigged = true;
      return this.sixThrows < MAX_SIXES - 1 ? 6 : randomInt(1, 6);
    }
    const first = this.rng();
    if (!actor?.bot || actor.level !== 'impossible' || Math.random() >= 0.35) return first;
    const second = this.rng();
    const worth = (v) => {
      if (v === 6 && this.sixThrows >= MAX_SIXES - 1) return -1000;
      const s = bestBotScore(this.tokens, this.turn, v, this.raceSeats(), this.board, this.teamMap);
      return (s === -Infinity ? -50 : s) + (v === 6 ? 20 : 0);
    };
    return worth(second) > worth(first) ? second : first;
  }

  // Every token still in base?
  allInBase(seat) {
    return this.tokens[seat].every((p) => p === -1);
  }

  doRoll() {
    if (this.rolled) throw new Error('Already rolled');
    const seat = this.turn;
    // Stuck in base for STUCK_TURNS dead turns: this throw has a guaranteed 6.
    // Random rolls are untouched — only the first throw of such a turn is forced.
    const pity = this.sixThrows === 0 && this.rolls.length === 0 && this.allInBase(seat) && this.stuck[seat] >= STUCK_TURNS;
    // One dice, or two on 6-arm boards: each dice is its own roll to play.
    const values = [];
    for (let i = 0; i < diceFor(this.board.arms); i++) values.push(pity && i === 0 ? 6 : this.luckyRoll());
    const sixes = values.filter((v) => v === 6).length;
    if (sixes) this.stat(this.actorSeat(), 'six', sixes);
    if (sixes) this.stuck[seat] = 0; // any 6 ends the drought, forced or not
    this.dice = values.at(-1);
    this.diceValues = values;
    this.rolls.push(...values);
    this.seq++;
    this.lastRoll = { seq: this.seq, seat, value: values.at(-1), values };
    this.lastMove = null;
    const what = values.length > 1 ? values.join(' and ') : `a ${values[0]}`;
    if (sixes) this.sixThrows++;
    // Three throws in a row with a 6: the whole turn is lost, kept rolls and earned extra turns included.
    if (sixes && this.sixThrows >= MAX_SIXES) {
      this.addLog(`${this.turnName()} rolled ${values.length > 1 ? 'a 6 three times in a row' : 'three 6s'} — turn skipped!`);
      this.rolled = true;
      this.skipped = true;
      this.rolls = [];
      this.options = [];
      this.movable = [];
      this.changed();
      this.schedule(this.delays.noMove, () => this.nextTurn());
      return;
    }
    if (sixes) {
      this.addLog(`${this.turnName()} rolled ${what} — rolls again`);
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
    const name = this.turnName();
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
    this.sixThrows = 0;
    this.options = [];
    this.movable = [];
    this.turnDeadline = Date.now() + this.delays.timeout;
    this.changed();
  }

  doMove(token, idx) {
    if (!this.rolled) throw new Error('Roll first');
    if (!this.options[idx]?.includes(token)) throw new Error("That token can't move");
    const seat = this.turn;
    const by = this.actorSeat(); // who gets the credit (in the decider: whoever rolled for the colour)
    const name = this.turnName();
    const value = this.rolls[idx];
    const result = applyMove(this.tokens, seat, token, value, this.raceSeats(), this.board, this.teamMap);
    this.rolls.splice(idx, 1);
    this.seq++;
    this.lastMove = { ...result, dice: value, seq: this.seq };
    this.options = [];
    this.movable = [];
    this.captures[by] += result.captured.length;
    if (result.captured.length) {
      this.stat(by, 'capture', result.captured.length);
      // Revenge: capturing whoever last captured you. Then every seat captured now owes `by` one.
      const revenge = this.feud[by] !== undefined && result.captured.some((c) => c.seat === this.feud[by]);
      if (revenge) {
        delete this.feud[by];
        this.revenges[by] = (this.revenges[by] || 0) + 1;
        this.stat(by, 'revenge');
      }
      const streak = (this.streak[by] || 0) + result.captured.length;
      this.streak[by] = streak;
      if (streak >= 3 && streak - result.captured.length < 3) this.stat(by, 'rampage');
      for (const c of result.captured) {
        this.streak[c.seat] = 0;
        this.feud[c.seat] = by;
        this.hits[c.seat] = (this.hits[c.seat] || 0) + 1;
      }
      // Whoever is now furthest behind in the race has been last (a win from there is a comeback)
      const racing = this.inPlay();
      if (racing.length > 1) {
        const got = (seat) => this.tokens[seat].reduce((n, p) => n + Math.max(0, p), 0);
        const least = Math.min(...racing.map(got));
        const last = racing.filter((seat) => got(seat) === least);
        if (last.length === 1) this.wasLast[last[0]] = true;
      }
      this.lastMove.revenge = revenge;
      this.lastMove.streak = streak;
    }
    if (result.finishedToken) this.stat(by, 'home');
    if (result.from < 0) this.stat(by, 'out');

    // One line for every move, then any capture.
    if (result.finishedToken) this.addLog(`${name} used a ${value} and brought a token home!`);
    else if (result.from < 0) this.addLog(`${name} used a 6 to bring a token out`);
    else this.addLog(`${name} moved a token ${value}`);
    for (const c of result.captured) {
      this.addLog(`${name} captured ${this.seats[c.seat].name}'s token!`);
    }

    if (result.allHome && this.decider) {
      this.finishDecider(this.decider.colors.indexOf(seat));
      return;
    }
    if (result.allHome) {
      this.winners.push(seat);
      // In a team game a player who's finished sits out until their whole team is home
      if (this.teams) this.addLog(`🏠 ${name} finished ${PLACES[this.winners.length - 1]}: +${this.placePoints(this.winners.length - 1)} points for Team ${this.teamName(this.teamMap[seat])}!`);
      else this.addLog(`🏆 ${name} finished ${PLACES[this.winners.length - 1]}!`);
      if (!this.endIfOver()) this.nextTurn();
      return;
    }

    // Each capture and each token home earns a turn of its own, on top of the 6s already rolled.
    const earned = result.captured.length + (result.finishedToken ? 1 : 0);
    if (earned) {
      this.extraTurns += earned;
      this.addLog(`${name} earned ${earned === 1 ? 'an extra turn' : `${earned} extra turns`}`);
    }
    if (this.rolls.length) {
      if (this.turnDeadline) this.turnDeadline = Math.max(this.turnDeadline, Date.now() + 10_000);
      this.playRolls();
    } else this.endRolls();
  }

  // Seats still racing: not finished and not surrendered.
  inPlay() {
    if (this.decider) return this.decider.players.flat();
    return this.activeSeats().filter((s) => !this.winners.includes(s) && !this.forfeited.includes(s));
  }

  // The seats whose tokens are on the board (in the decider, just the two colours).
  raceSeats() {
    return this.decider ? this.decider.colors : this.activeSeats();
  }

  // Who plays this turn: the seat itself, or in the decider the teammate rolling for the colour.
  actorSeat() {
    return this.decider ? this.actor : this.turn;
  }

  // "Ann" (or in the decider "Ann (Red)", the colour they're rolling for)
  turnName() {
    const name = this.seats[this.actorSeat()]?.name || '?';
    return this.decider ? `${name} (${this.colorName(this.turn)})` : name;
  }

  colorName(seat) {
    return this.board.colors[seat][0].toUpperCase() + this.board.colors[seat].slice(1);
  }

  // The game ends when at most one player is left racing, or only bots are.
  // Anyone left is ranked by how far their tokens got; those who surrendered come last.
  endIfOver() {
    if (this.teams) return this.endTeamGameIfOver();
    const left = this.inPlay();
    if (left.length > 1 && left.some((s) => !this.seats[s].bot)) return false;
    const progress = (s) => this.tokens[s].reduce((sum, p) => sum + p + 1, 0);
    left.sort((a, b) => progress(b) - progress(a));
    this.winners.push(...left, ...[...this.forfeited].reverse());
    this.finish();
    return true;
  }

  // Team modes: [[seats of team 0], [seats of team 1], …], or null.
  get teams() {
    return MODES[this.mode].teams || null;
  }

  // Seat -> team number for the rules, or null when every seat plays for itself.
  // In the decider a colour belongs to the team racing it (in 2v2 that's not its usual team),
  // and the colours left out belong to nobody.
  get teamMap() {
    if (!this.teams) return null;
    if (this.decider) return Array.from({ length: this.board.arms }, (_, s) => (this.decider.colors.includes(s) ? this.decider.colors.indexOf(s) : 100 + s));
    return teamsOf(this.mode, this.board.arms);
  }

  teamName(t) {
    return this.teams[t].map((s) => this.colorName(s)).join(' & ');
  }

  // Points for a finishing place: last place 0, one more for each place above (2v2: 3/2/1/0).
  placePoints(place) {
    return this.activeSeats().length - 1 - place;
  }

  // Team -> points so far: finished players score their place, surrendered players nothing.
  teamPoints(order = this.winners) {
    const pts = this.teams.map(() => 0);
    order.forEach((s, i) => (pts[this.teamMap[s]] += this.placePoints(i)));
    return pts;
  }

  // Is the result settled? Tries every order the players still racing could finish in:
  // { team } when the same team comes out on top every time, { draw: true } when it's a tie
  // every time, null while it could still go more than one way.
  teamOutcome() {
    const racing = this.inPlay();
    const result = (order) => {
      const pts = this.teamPoints(order);
      const best = Math.max(...pts);
      const top = pts.flatMap((p, t) => (p === best ? [t] : []));
      return top.length > 1 ? 'draw' : top[0];
    };
    let seen;
    const tryOrders = (left, order) => {
      if (!left.length) {
        const r = result(order);
        if (seen === undefined) seen = r;
        return seen === r;
      }
      return left.every((s, i) => tryOrders([...left.slice(0, i), ...left.slice(i + 1)], [...order, s]));
    };
    if (!tryOrders(racing, [...this.winners])) return null;
    return seen === 'draw' ? { draw: true } : { team: seen };
  }

  // Team games: every finishing place scores points for its team, and the game ends as soon as
  // the points settle it (players who finish sit out and wait). The team with more points wins;
  // a tie goes to the decider round. When only bots are still racing they're ranked by how far
  // their tokens got.
  endTeamGameIfOver() {
    if (this.decider) {
      // The decider ends when a team has nobody left to play its colour
      const left = this.decider.players.map((ps, t) => (ps.length ? t : -1)).filter((t) => t >= 0);
      if (left.length > 1) return false;
      this.finishDecider(left[0] ?? 0);
      return true;
    }
    let racing = this.inPlay();
    if (racing.length && racing.every((s) => this.seats[s].bot)) {
      const progress = (s) => this.tokens[s].reduce((sum, p) => sum + p + 1, 0);
      this.winners.push(...racing.sort((a, b) => progress(b) - progress(a)));
      racing = [];
    }
    const outcome = this.teamOutcome();
    if (!outcome) return false;
    if (outcome.draw) {
      this.startDecider();
      return true;
    }
    // Settled: whoever is still racing takes the places left, by how far they got
    const progress = (s) => this.tokens[s].reduce((sum, p) => sum + p + 1, 0);
    this.winners.push(...this.inPlay().sort((a, b) => progress(b) - progress(a)));
    this.racePoints = this.teamPoints();
    const win = outcome.team;
    this.teamOrder = [win, ...this.teams.map((_, t) => t).filter((t) => t !== win).sort((a, b) => this.racePoints[b] - this.racePoints[a])];
    this.winners = this.teamOrder.flatMap((t) => [
      ...this.winners.filter((s) => this.teamMap[s] === t),
      ...this.forfeited.filter((s) => this.teamMap[s] === t).reverse(),
    ]).filter((s, i, a) => this.seats[s] && a.indexOf(s) === i);
    const score = this.teamOrder.map((t) => this.racePoints[t]).join(' to ');
    this.addLog(`🏆 Team ${this.teamName(win)} wins, ${score} points!`);
    this.finish();
    return true;
  }

  // A tie on points: one colour per team, on OPPOSITE sides of the board, every token back in
  // base, and teammates take turns rolling for it. First colour with all four home wins.
  startDecider() {
    this.racePoints = this.teamPoints();
    const players = this.teams.map((members) => members.filter((s) => this.seats[s] && !this.forfeited.includes(s)));
    const colors = deciderColors(this.teams, this.board.arms);
    const first = randomInt(colors.length);
    this.decider = { colors, players, next: players.map((ps, t) => (t === first ? 1 % ps.length : 0)) };
    this.tokens = newTokens(this.board.arms);
    this.stuck = Array(this.board.arms).fill(0);
    this.winners = [];
    this.tally = {}; // seat -> { six, capture, home, out }: this game's numbers, for the finish card
    this.feud = {}; // seat -> the seat that last captured it: capture them back for revenge
    this.streak = {}; // seat -> captures in a row without being captured
    this.revenges = {}; // seat -> revenges taken this game (each pays REWARDS.revenge)
    this.hits = {}; // seat -> times its tokens were captured this game (the Untouchable badge)
    this.wasLast = {}; // seat -> true once it has been last in the race (the Comeback badge)
    this.lastMove = null;
    this.clearTimer();
    this.turn = colors[first];
    this.actor = players[first][0];
    this.resetTurn();
    this.addLog(`🤝 A draw, ${this.racePoints[0]} points each! Decider: one colour per team, teammates take turns rolling it. First colour home wins!`);
    this.addLog(`${this.turnName()} goes first.`);
    this.changed();
  }

  finishDecider(win) {
    const order = [win, ...this.teams.map((_, t) => t).filter((t) => t !== win)];
    this.teamOrder = order;
    this.winners = order.flatMap((t) => this.teams[t].filter((s) => this.seats[s]));
    this.endedEarly = false; // they played a whole race and a decider: full pay
    this.addLog(`🏆 Team ${this.teamName(win)} wins the decider!`);
    this.finish();
  }

  finish() {
    this.phase = 'finished';
    this.rolled = false;
    this.turnDeadline = null;
    this.clearTimer();
    const pot = this.pot; // (payPot settles and clears it)
    const results = this.giveRewards();
    if (!this.rigged && this.profiles?.recordGame) {
      const humans = this.activeSeats().filter((s) => !this.seats[s].bot);
      const vsBotsOnly = humans.length < 2;
      const winTeam = this.teamOrder ? this.teamOrder[0] : -1;
      for (const s of humans) {
        const won = !this.forfeited.includes(s) && (winTeam >= 0 ? this.teams[winTeam].includes(s) : this.winners[0] === s);
        this.profiles.recordGame(this.seats[s].userId, {
          won,
          vsBotsOnly,
          captures: this.captures[s] || 0,
          sixes: this.tally[s]?.six || 0,
        });
      }
    }
    this.payPot();
    this.reportResults(results, pot);
    this.changed();
  }

  // For the leaderboards, which rank stakes like poker chips: in a PUBLIC stakes room, everyone
  // who paid in scores what they won minus their stake (a 500 stake won in a four-player game is
  // +1500; losing it is -500). Everything else (games without a stake, private rooms, test dice,
  // a pot that was handed back) scores 0, and bots never count. Each result carries who else was
  // in it, so the leaderboard can cap games against the same people.
  reportResults(results, pot) {
    if (!results) return;
    const ranked = !!pot && this.visibility === 'public' && !this.rigged && this.noPoints !== 'coop';
    const paid = ranked ? pot.paid.filter((p) => this.seats[p.seat]?.userId === p.userId) : [];
    const byUser = new Map(results.map((r) => [r.userId, r]));
    // surrendered players paid in too: they're not in the results (no coins), but they lost the stake
    for (const p of paid) if (!byUser.has(p.userId)) byUser.set(p.userId, { userId: p.userId, name: this.seats[p.seat].name, won: false, placePoints: 0 });
    const humans = paid.map((p) => p.userId);
    for (const r of byUser.values()) {
      const p = paid.find((x) => x.userId === r.userId);
      if (!p) {
        r.points = 0;
        if (pot) r.placePoints = 0;
        continue;
      }
      const won = this.potWon?.[p.seat] || 0;
      const net = won - pot.stake;
      r.won = won > 0;
      if (this.winnerTakeAll) {
        // Stakes Rooms: bigger swings, 1.5x leaderboard points for winning *and* losing. (Wins only
        // used to count 1.5x: two friends trading wins both climbed, losing nothing.)
        r.points = Math.round(net * 1.5);
        r.placePoints = won > 0 ? (r.placePoints || 0) + Math.max(5, Math.round(pot.stake / 50)) : 0;
      } else {
        // Classic bet: shared pot across places, 1x profit in v2 and smaller bet bonus in v1.
        r.points = net;
        if (net > 0) r.placePoints = (r.placePoints || 0) + Math.max(1, Math.round(pot.stake / 200));
      }
      r.opponents = humans.filter((id) => id !== r.userId);
    }
    this.onGameEnd([...byUser.values()]);
  }

  // Classic rewards for every human who didn't surrender: by finishing place, plus a bonus per
  // capture. Stakes Rooms (`winnerTakeAll`) are a separate mode with no Classic coin rewards.
  // Only games against other people pay: playing bots on your own earns nothing.
  giveRewards() {
    this.rewards = {};
    this.rewardCapped = [];
    this.rewardPartial = []; // seats whose placement payout was cut by an early end
    const humans = this.activeSeats().filter((s) => !this.seats[s].bot);
    if (humans.length < 2) {
      this.noCoins = 'bots';
      return;
    }
    if (this.rigged) {
      this.noCoins = 'test'; // someone's dice were rigged for testing: nothing counts
      return;
    }
    const results = [];
    // Places: one seat each, or in team games one whole team each (teammates share the place).
    const groups = this.teamOrder ? this.teamOrder.map((t) => this.teams[t].filter((s) => this.seats[s])) : this.winners.map((s) => [s]);
    const placeOf = (s) => groups.findIndex((g) => g.includes(s));
    // The humans' places (anyone who surrendered comes last): leaderboard points only count the
    // people you beat, so bots neither add to them nor take the win.
    const humanGroups = groups.map((g) => g.filter((s) => !this.seats[s].bot)).filter((g) => g.length);
    // Every human on the same team against bots: nobody beat anybody. Coins are paid for the
    // real place, but no leaderboard points and no win (else two friends could farm points
    // by teaming up against easy bots).
    const coop = !!this.teamOrder && humanGroups.length === 1;
    if (coop) this.noPoints = 'coop';
    const noClassicCoins = this.winnerTakeAll;
    this.winners.forEach((s) => {
      const place = placeOf(s);
      const seat = this.seats[s];
      if (seat.bot || this.forfeited.includes(s)) return;
      // A game cut short by a surrender pays for how far you got; a game that ran
      // its course pays the full placement even if the last-placed seat didn't finish.
      const share = this.endedEarly ? progressShare(this.tokens, s, this.board) : 1;
      if (!noClassicCoins) {
        if (share < 1) this.rewardPartial.push(s);
        const coins = Math.round(REWARDS.place[place] * share + this.captures[s] * REWARDS.capture + (this.revenges[s] || 0) * REWARDS.revenge);
        const granted = this.profiles ? this.profiles.addCoins(seat.userId, coins) : coins;
        this.rewards[s] = granted;
        if (granted < coins) this.rewardCapped.push(s);
      }
      // (leaderboard points come from the pot in v2, or finishing places in v1 until Dec 2026)
      const humanPlace = humanGroups.findIndex((g) => g.includes(s));
      const beaten = humanGroups.slice(humanPlace + 1).reduce((n, g) => n + g.length, 0);
      const won = !coop && humanPlace === 0;
      const placePoints = coop ? 0 : Math.round((beaten * LB_PER_BEATEN + (won ? LB_WIN_BONUS : 0)) * share);
      results.push({ userId: seat.userId, name: seat.name, points: 0, placePoints, won });
      this.stat(s, 'game');
      if (won) {
        this.stat(s, 'win');
        if (!this.hits[s]) this.stat(s, 'clean');
        if (this.wasLast[s]) this.stat(s, 'comeback');
        if (this.quick) this.stat(s, 'quickwin');
      }
      if (!coop && place <= (this.teamOrder ? 0 : 1)) this.stat(s, 'top2');
    });
    return results;
  }

  nextTurn() {
    if (this.phase !== 'playing') return;
    if (this.decider) {
      // The other team's colour, rolled by whichever of them is next in line
      const d = this.decider;
      const team = (d.colors.indexOf(this.turn) + 1) % d.colors.length;
      const ps = d.players[team];
      this.turn = d.colors[team];
      this.actor = ps[d.next[team] % ps.length];
      d.next[team] = (d.next[team] + 1) % ps.length;
      this.resetTurn();
      this.changed();
      return;
    }
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
    this.sixThrows = 0;
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
    // Nobody still racing is here: wait for them rather than play on for an empty room.
    if (!this.inPlay().some((s) => !this.seats[s].bot && this.seats[s].connected)) return this.pause();
    if (this.pausedAt) this.unpause();
    const seat = this.seats[this.actorSeat()];
    // A player who dropped out is waited for until their grace period (or the turn clock) runs
    // out; after that their turns are played for them, like a bot's.
    const away = !seat.bot && !seat.connected;
    const graceLeft = away ? (seat.disconnectedAt ?? 0) + this.delays.disconnectGrace - Date.now() : 0;
    const auto = seat.bot || (away && graceLeft <= 0);
    // Bots roll after a short pause, and move once everyone has seen the dice.
    const botDelay = this.rolled ? this.delays.autoMove : this.delays.bot;
    const untilDeadline = Math.max(0, this.turnDeadline - Date.now());
    const delay = auto ? botDelay : away ? Math.min(graceLeft, untilDeadline) : untilDeadline;
    this.timer = setTimeout(() => {
      this.timer = null;
      // A connected player let the clock run out: count it once per turn, and
      // take them out of the game after too many turns in a row. (Not someone who
      // dropped out: their grace ran out, so they're simply played for.)
      if (!auto && !away && !this.turnTimedOut) {
        this.turnTimedOut = true;
        const s = this.actorSeat();
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
          // Bots play at their difficulty; someone who dropped out is played for as well as possible
          const level = seat.bot ? seat.level || 'medium' : 'hard';
          const t = idx < 0 ? null : chooseBotMove(this.tokens, this.turn, this.rolls[idx], this.raceSeats(), this.board, this.teamMap, level);
          if (t !== null) this.doMove(t, idx);
        }
      } catch (err) {
        console.error('automation error', err);
      }
    }, delay);
  }

  // Every player still in the game has left: nothing moves (the turn clock stops too), and if
  // none of them is back within delays.pause the game ends with no coins for anyone.
  pause() {
    this.turnDeadline = null;
    if (this.pausedAt) return;
    this.pausedAt = Date.now();
    this.addLog(`⏸️ Everyone left — the game waits ${Math.round(this.delays.pause / 1000)}s for someone to come back`);
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null;
      this.abandon();
    }, this.delays.pause);
  }

  unpause() {
    this.clearPause();
    this.turnDeadline = Date.now() + this.delays.timeout; // a fresh clock for whoever's turn it is
    this.addLog('▶️ A player is back — game on!');
  }

  clearPause() {
    clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    this.pausedAt = null;
  }

  // Nobody came back in time: the game is over and nobody is paid.
  abandon() {
    if (this.phase !== 'playing') return;
    this.clearPause();
    this.clearTimer();
    this.addLog('Nobody came back — game over, no coins this time.');
    this.refundPot('Everyone got their stake back.');
    this.phase = 'finished';
    this.rolled = false;
    this.turnDeadline = null;
    this.rewards = {};
    this.rewardCapped = [];
    this.rewardPartial = [];
    this.noCoins = 'abandoned';
    this.changed();
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
    this.clearPause();
    clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }

  // ---------- surviving a server restart ----------

  // Everything needed to carry on this room after the server restarts: plain data only.
  // Left out on purpose: sockets and who's connected (players reconnect), timers (restarted
  // by resume()), floating emotes and typing (they only last a few seconds anyway).
  toSave() {
    const keep = {};
    for (const k of SAVED_FIELDS) keep[k] = this[k];
    keep.banned = [...this.banned];
    return keep;
  }

  // A room rebuilt from toSave(), with the given Room options (onChange, profiles, …).
  static fromSave(data, options = {}) {
    if (!data?.id || !MODES[data.mode]) throw new Error('Bad saved room');
    const room = new Room(data.id, options);
    for (const k of SAVED_FIELDS) if (data[k] !== undefined) room[k] = data[k];
    room.banned = new Set(data.banned || []);
    room.board = boardFor(room.mode);
    // Saved before two-dice boards: one dice per throw, so the kept 6s are the throws so far.
    room.diceValues ??= room.dice ? [room.dice] : [];
    room.sixThrows ??= room.rolled ? 0 : (room.rolls || []).length;
    return room;
  }

  // Starts a restored room again. Nobody is connected yet: players get `graceMs` to come back
  // before they count as gone (bots take their turns, lobby seats are freed), and whoever's turn
  // it is gets a fresh turn clock so the restart doesn't eat their time.
  resume(graceMs = 20_000) {
    this.turnDeadline = Date.now() + this.delays.timeout;
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      this.dropAbsent();
    }, graceMs);
    if (this.phase !== 'playing') return this.onChange(this);
    // The server may have stopped between steps that run on a timer: pick the turn back up.
    if (this.rolled) {
      if (this.skipped) return this.schedule(this.delays.noMove, () => this.nextTurn());
      if (this.rolls.length === 0 || this.movable.length === 0) {
        this.rolls = [];
        this.options = [];
        this.movable = [];
        this.onChange(this);
        return this.schedule(this.delays.noMove, () => this.endRolls());
      }
      return this.playRolls(); // re-checks the moves, and auto-moves a forced one
    }
    this.changed();
  }

  // After a restart: everyone who didn't come back is treated as having left.
  dropAbsent() {
    let changed = false;
    this.seats.forEach((s, i) => {
      if (!s || s.bot || this.connected.has(s.userId)) return;
      if (this.phase === 'lobby') this.seats[i] = null;
      else {
        s.connected = false;
        s.disconnectedAt = 0; // they already had the restart's grace period
      }
      changed = true;
    });
    if (this.hostId && !this.connected.has(this.hostId)) {
      this.hostId = this.nextHost();
      changed = true;
    }
    if (changed) this.changed();
  }

  // Daily quests count what humans do in games against other people (never against bots alone).
  stat(seat, stat, n = 1) {
    // (every seat's numbers are kept for the finish card, bots' too; only people earn quests)
    const mine = (this.tally[seat] ||= {});
    mine[stat] = (mine[stat] || 0) + n;
    const s = this.seats[seat];
    if (!s || s.bot || this.rigged || this.activeSeats().filter((i) => !this.seats[i].bot).length < 2) return;
    this.onStat(s.userId, s.name, stat, n);
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
    if (this.seatOf(user.id) !== this.actorSeat()) throw new Error(this.decider && this.inPlay().includes(this.seatOf(user.id)) ? "It's your teammate's go" : "It's not your turn");
  }

  snapshot() {
    const now = Date.now();
    return {
      roomId: this.id,
      roomName: this.name,
      code: this.code,
      visibility: this.visibility,
      quick: this.quick,
      stake: this.stake,
      winnerTakeAll: this.winnerTakeAll,
      stakes: STAKES,
      pot: this.pot && { stake: this.pot.stake, total: this.pot.total },
      potWon: this.potWon,
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
            look: s.bot ? null : this.profiles?.badgeLook(s.userId) || null, // title and pinned badges
            canPay: this.phase === 'lobby' ? this.canPayStake(i) : true, // enough coins for the stake?
          },
      ),
      tokens: this.tokens,
      turn: this.turn,
      dice: this.dice,
      diceValues: this.diceValues,
      diceCount: diceFor(this.board.arms),
      rolled: this.rolled,
      rolls: this.rolls,
      options: this.options,
      movable: this.movable,
      extraTurns: this.extraTurns,
      skipped: this.skipped,
      lastRoll: this.lastRoll,
      winners: this.winners,
      tally: this.tally,
      feud: this.feud,
      streak: this.streak,
      teams: this.teams,
      teamOrder: this.teamOrder,
      // team games: points so far (or the race's final points once it's settled), and the decider
      teamPoints: this.teams ? this.racePoints || this.teamPoints() : null,
      pointsFor: this.teams ? this.activeSeats().map((_, i) => this.placePoints(i)) : null,
      decider: this.decider && { colors: this.decider.colors, players: this.decider.players },
      actor: this.decider ? this.actor : null,
      rewards: this.rewards,
      rewardCapped: this.rewardCapped,
      rewardPartial: this.rewardPartial,
      timeouts: this.timeouts,
      maxTimeouts: MAX_TIMEOUTS,
      lastMove: this.lastMove,
      seq: this.seq,
      log: this.log.slice(-8),
      emotes: this.emotes.filter((e) => now - e.at < EMOTE_TTL_MS),
      // `until`: server time it expires, so clients can drop it exactly then
      typing: [...this.typingAt].filter(([, t]) => now - t.at < TYPING_MS).map(([id, t]) => ({ id, name: t.name, until: t.at + TYPING_MS })),
      turnDeadline: this.turnDeadline,
      turnTimeout: this.delays.timeout,
      disconnectGrace: this.delays.disconnectGrace,
      paused: !!this.pausedAt,
      pauseMs: this.delays.pause,
      noCoins: this.noCoins,
      serverNow: now,
      spectators: this.connected.size,
      people: [...this.people].map(([id, name]) => ({ id, name })),
      chat: this.chat,
    };
  }
}

function newBot(seat, level = 'medium', seats = []) {
  const taken = new Set(seats.filter((s) => s?.bot).map((s) => s.name));
  const preferred = BOT_NAMES[seat % BOT_NAMES.length];
  const name = !taken.has(preferred) ? preferred : BOT_NAMES.find((n) => !taken.has(n)) || preferred;
  return { userId: `bot-${seat}`, name, bot: true, connected: true, level };
}

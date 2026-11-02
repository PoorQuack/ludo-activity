// Every open room on the server: creating them, finding them by id or code, the room
// list each player sees, and closing rooms once everyone has left.
import { randomInt, randomUUID } from 'node:crypto';
import { MODES } from '../shared/board.js';
import { Room } from './room.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, easy to read out
const CODE_LENGTH = 4;
const MAX_ROOMS = 500; // plenty for a 1 GB VM: a room is a few KB
const MAX_LISTED = 50;

export class RoomDirectory {
  /**
   * @param {object} options
   *  roomOptions: passed to every new Room (onChange, profiles, …)
   *  idleMs: how long an empty room is kept (so a refresh can rejoin it) before it's closed
   *  onRemove: called with a room once it's closed
   */
  constructor({ roomOptions = {}, idleMs = 60_000, onRemove = () => {} } = {}) {
    this.roomOptions = roomOptions;
    this.idleMs = idleMs;
    this.onRemove = onRemove;
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    this.byCode = new Map();
    this.idleTimers = new Map();
  }

  // A new room with `user` as host, in the lobby with them seated.
  create(user, { visibility = 'public', mode = '4p', instanceId = null, extra = {} } = {}) {
    if (this.rooms.size >= MAX_ROOMS) throw new Error('The server is full right now, try again in a bit');
    const id = randomUUID();
    const code = this.newCode();
    const room = new Room(id, {
      ...this.roomOptions,
      ...extra,
      code,
      instanceId,
      visibility: visibility === 'private' ? 'private' : 'public',
    });
    this.rooms.set(id, room);
    this.byCode.set(code, room);
    room.connect(user);
    room.host(user);
    if (MODES[mode] && mode !== room.mode) room.setMode(user, mode);
    return room;
  }

  newCode() {
    for (;;) {
      const code = Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
      if (!this.byCode.has(code)) return code;
    }
  }

  get(id) {
    return this.rooms.get(id) || null;
  }

  findCode(code) {
    return this.byCode.get(String(code || '').trim().toUpperCase()) || null;
  }

  // Throws if `user` may not come in. Private rooms: people from the same Discord call can
  // join from the list (and players can always come back to their seat); others need the code.
  check(room, user, { instanceId = null, withCode = false } = {}) {
    if (room.banned.has(user.id)) throw new Error('The host removed you from this room');
    if (room.visibility === 'private' && !withCode && room.instanceId !== instanceId && room.seatOf(user.id) < 0) {
      throw new Error('That room is private: ask for its code');
    }
  }

  // Connects `user` to the room. In a lobby with a free seat, they sit down.
  join(room, user, options = {}) {
    this.check(room, user, options);
    this.keep(room);
    room.connect(user);
    const free = MODES[room.mode].seats.some((i) => !room.seats[i]);
    if (room.phase === 'lobby' && room.hostId && free && room.seatOf(user.id) < 0) room.join(user);
    return room;
  }

  // Someone's last connection to the room went away: close it once it has been empty a while.
  left(room) {
    if (!room.empty || this.idleTimers.has(room.id)) return;
    this.idleTimers.set(
      room.id,
      setTimeout(() => this.remove(room), this.idleMs),
    );
  }

  keep(room) {
    clearTimeout(this.idleTimers.get(room.id));
    this.idleTimers.delete(room.id);
  }

  remove(room) {
    this.keep(room);
    room.destroy();
    this.rooms.delete(room.id);
    this.byCode.delete(room.code);
    this.onRemove(room);
  }

  // The rooms someone sees in the menu: everything from their Discord call (public or private),
  // then public rooms from anywhere. Lobbies with free seats come first, then games to watch.
  list(instanceId) {
    const rank = (s) => (s.sameCall ? 0 : 2) + (s.phase === 'lobby' && s.players < s.seats ? 0 : 1);
    return [...this.rooms.values()]
      .filter((r) => !r.empty && (r.visibility === 'public' || (instanceId && r.instanceId === instanceId)))
      .map((r) => r.summary(instanceId))
      .sort((a, b) => rank(a) - rank(b) || b.people - a.people)
      .slice(0, MAX_LISTED);
  }

  destroy() {
    for (const room of this.rooms.values()) this.remove(room);
  }
}

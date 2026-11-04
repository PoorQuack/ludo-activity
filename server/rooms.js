// Every open room on the server: creating them, finding them by id or code, the room
// list each player sees, and closing rooms once everyone has left.
import { randomInt, randomUUID } from 'node:crypto';
import { MODES } from '../shared/board.js';
import { Room } from './room.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, easy to read out
const CODE_LENGTH = 4;
const MAX_ROOMS = 500; // plenty for a 1 GB VM: a room is a few KB
const MAX_LISTED = 50;
const SAVE_VERSION = 1; // bump if a change makes old saved rooms unreadable

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

  // ---------- surviving a server restart ----------

  // Every open room as plain data, ready to be written to disk on shutdown.
  save() {
    return { version: SAVE_VERSION, savedAt: Date.now(), rooms: [...this.rooms.values()].map((r) => r.toSave()) };
  }

  // Brings back rooms from save(). Rooms that can't be read are skipped (and logged), and a
  // save older than `maxAgeMs` is ignored: its players have long gone. Restored rooms start
  // empty, so each one closes after the usual idle time if nobody comes back to it.
  // `extra(id)`: more Room options for the room with that id (e.g. its onKick).
  restore(doc, { extra = () => ({}), graceMs = 20_000, maxAgeMs = 10 * 60_000 } = {}) {
    if (doc?.version !== SAVE_VERSION || !Array.isArray(doc.rooms)) return 0;
    if (Date.now() - (doc.savedAt || 0) > maxAgeMs) return 0;
    let restored = 0;
    for (const data of doc.rooms) {
      if (this.rooms.size >= MAX_ROOMS) break;
      if (this.rooms.has(data?.id) || this.byCode.has(data?.code)) continue;
      let room = null;
      try {
        room = Room.fromSave(data, { ...this.roomOptions, ...extra(data.id) });
        this.rooms.set(room.id, room);
        this.byCode.set(room.code, room);
        room.resume(graceMs);
        this.left(room);
        restored++;
      } catch (err) {
        console.error(`Couldn't restore room ${data?.code || '?'}:`, err.message);
        if (room && this.rooms.get(room.id) === room) {
          this.keep(room);
          room.destroy();
          this.rooms.delete(room.id);
          this.byCode.delete(room.code);
        }
      }
    }
    return restored;
  }

  destroy() {
    for (const room of this.rooms.values()) this.remove(room);
  }
}

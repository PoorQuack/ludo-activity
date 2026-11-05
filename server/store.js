// Player profiles (coins and shop items), kept in memory and saved to a JSON file.
// Guests (plain-browser testing) are never written to disk.
import fs from 'node:fs';
import path from 'node:path';
import { ITEMS, STARTING_COINS, DEFAULT_EQUIPPED, DAILY_COIN_CAP, ownsItem } from '../shared/shop.js';

const SAVE_DELAY_MS = 1000;

export const CURRENT_VERSION = 2;

// Ordered list: MIGRATIONS[v - 1] upgrades a whole parsed save document from
// version v to version v + 1. To change the format, bump CURRENT_VERSION and
// append one function — old files then upgrade in order.
// v1 -> v2: the save file gained its { version, profiles } wrapper; the data didn't change.
const MIGRATIONS = [(v1) => ({ version: 2, profiles: v1 })];

export class ProfileStore {
  constructor(file, { onChange, freeShop = false, now = Date.now } = {}) {
    this.file = file;
    this.onChange = onChange || (() => {});
    this.freeShop = freeShop; // testing: everything costs 0
    this.now = now;
    this.profiles = new Map();
    this.saveTimer = null;
    if (file) this.load();
  }

  load() {
    const bak = `${this.file}.bak`;
    if (fs.existsSync(this.file)) {
      try {
        return this.applySave(fs.readFileSync(this.file, 'utf8'));
      } catch (err) {
        if (err.code === 'SAVE_TOO_NEW') throw err;
        // Never overwrite data we couldn't read: park the bad file and fall back to .bak.
        const corrupt = `${this.file}.corrupt-${Date.now()}`;
        console.error(`Profile file ${this.file} is unreadable (${err.message}) — moving it to ${corrupt}`);
        fs.renameSync(this.file, corrupt);
        if (fs.existsSync(bak)) {
          try {
            return this.applySave(fs.readFileSync(bak, 'utf8'));
          } catch (bakErr) {
            throw new Error(`Profile file is corrupt and the backup is unreadable too: ${bakErr.message}`);
          }
        }
        throw new Error('Profile file is corrupt and no .bak backup exists — refusing to start with empty data');
      }
    }
    if (fs.existsSync(bak)) {
      try {
        return this.applySave(fs.readFileSync(bak, 'utf8'));
      } catch (err) {
        throw new Error(`Only a profile backup exists and it is unreadable: ${err.message}`);
      }
    }
    // No save and no backup: a fresh start.
  }

  applySave(text) {
    const doc = migrate(JSON.parse(text));
    for (const [id, p] of Object.entries(doc.profiles)) this.profiles.set(id, normalize(p));
  }

  // Returns the profile, creating it on a player's first visit.
  get(id) {
    let p = this.profiles.get(id);
    if (!p) {
      p = normalize({});
      this.profiles.set(id, p);
      this.save();
    }
    return p;
  }

  peek(id) {
    return this.profiles.get(id) || null;
  }

  // The profile as the client should see it: owned items that no longer exist
  // in the shop are kept in the save file but hidden here.
  view(id) {
    const p = this.profiles.get(id);
    return p ? { ...p, owned: p.owned.filter((itemId) => ITEMS[itemId]) } : null;
  }

  // Grants up to what's left under the daily earning cap and returns the granted amount.
  addCoins(id, coins) {
    const p = this.get(id);
    const day = this.dayKey();
    if (p.earned.day !== day) p.earned = { day, coins: 0 };
    const granted = Math.max(0, Math.min(coins, DAILY_COIN_CAP - p.earned.coins));
    p.coins += granted;
    p.earned.coins += granted;
    this.changed(id);
    return granted;
  }

  // Leaderboard prizes: paid in full, outside the daily earning cap.
  grantPrize(id, coins) {
    if (id.startsWith('guest-')) return 0;
    const p = this.get(id);
    p.coins += coins;
    this.changed(id);
    return coins;
  }

  // Admin: add (or, with a negative amount, take away) coins. Never below 0. Returns the new balance.
  adminCoins(id, amount) {
    const p = this.get(id);
    p.coins = Math.max(0, p.coins + amount);
    this.changed(id);
    return p.coins;
  }

  dayKey() {
    return new Date(this.now()).toISOString().slice(0, 10); // the UTC day, 'YYYY-MM-DD'
  }

  buy(id, itemId) {
    const item = ITEMS[itemId];
    if (!item) throw new Error('Unknown item');
    const p = this.get(id);
    if (ownsItem(p, itemId)) throw new Error('You already own that');
    const price = this.freeShop ? 0 : item.price;
    if (p.coins < price) throw new Error('Not enough coins');
    p.coins -= price;
    p.owned.push(itemId);
    if (!['emote', 'emote-pack'].includes(item.type)) p.equipped[item.type] = itemId;
    this.changed(id);
  }

  equip(id, itemId) {
    const item = ITEMS[itemId];
    if (!item || ['emote', 'emote-pack'].includes(item.type)) throw new Error("That can't be equipped");
    const p = this.get(id);
    if (!ownsItem(p, itemId)) throw new Error("You don't own that yet");
    p.equipped[item.type] = itemId;
    this.changed(id);
  }

  changed(id) {
    this.save();
    this.onChange(id);
  }

  save() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  // Writes a temp file first so a crash mid-write can't corrupt the save, and
  // keeps the previous good file as .bak so a bad save is always recoverable.
  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    const doc = { version: CURRENT_VERSION, profiles: {} };
    for (const [id, p] of this.profiles) if (!id.startsWith('guest-')) doc.profiles[id] = p;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.renameSync(tmp, this.file);
  }
}

// Upgrades a parsed save document to CURRENT_VERSION. A flat { id: profile }
// object is a legacy v1 file. A file newer than us means older code would be
// running against newer data — refuse to start.
function migrate(data) {
  let version = Number.isInteger(data?.version) ? data.version : 1;
  if (version > CURRENT_VERSION) {
    const err = new Error(`Profile file is version ${version} but this server only understands up to ${CURRENT_VERSION} — update the server first`);
    err.code = 'SAVE_TOO_NEW';
    throw err;
  }
  while (version < CURRENT_VERSION) {
    data = MIGRATIONS[version - 1](data);
    version += 1;
  }
  if (!data.profiles || typeof data.profiles !== 'object') throw new Error('profile file has no profiles object');
  return data;
}

function normalize(p) {
  // Owned ids are kept as bought, even ones no longer in the shop — dropping
  // them would delete purchases on the next save. Unknown ones are just hidden
  // from the client (see view()).
  const owned = [];
  if (Array.isArray(p.owned)) {
    for (const id of p.owned) {
      if (typeof id === 'string' && id.length >= 1 && id.length <= 64 && !owned.includes(id)) owned.push(id);
      if (owned.length >= 500) break;
    }
  }
  const earned = /^\d{4}-\d{2}-\d{2}$/.test(p.earned?.day || '') && Number.isFinite(p.earned.coins) && p.earned.coins >= 0
    ? { day: p.earned.day, coins: p.earned.coins }
    : { day: '', coins: 0 };
  const profile = { coins: Number.isFinite(p.coins) ? p.coins : STARTING_COINS, earned, owned, equipped: { ...DEFAULT_EQUIPPED } };
  for (const [type, id] of Object.entries(p.equipped || {})) {
    if (ITEMS[id]?.type === type && ownsItem(profile, id)) profile.equipped[type] = id;
  }
  return profile;
}

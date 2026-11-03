// Player profiles (coins and shop items), kept in memory and saved to a JSON file.
// Guests (plain-browser testing) are never written to disk.
import fs from 'node:fs';
import path from 'node:path';
import { ITEMS, STARTING_COINS, DEFAULT_EQUIPPED, DAILY_COIN_CAP, ownsItem } from '../shared/shop.js';

const SAVE_DELAY_MS = 1000;

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
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [id, p] of Object.entries(data)) this.profiles.set(id, normalize(p));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Could not read profiles', err);
    }
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
    if (item.type !== 'emote') p.equipped[item.type] = itemId;
    this.changed(id);
  }

  equip(id, itemId) {
    const item = ITEMS[itemId];
    if (!item || item.type === 'emote') throw new Error("That can't be equipped");
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

  // Writes a temp file first, so a crash mid-write can't corrupt the save.
  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    const data = {};
    for (const [id, p] of this.profiles) if (!id.startsWith('guest-')) data[id] = p;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.file);
  }
}

function normalize(p) {
  const owned = Array.isArray(p.owned) ? p.owned.filter((id) => ITEMS[id]) : [];
  const earned = /^\d{4}-\d{2}-\d{2}$/.test(p.earned?.day || '') && Number.isFinite(p.earned.coins) && p.earned.coins >= 0
    ? { day: p.earned.day, coins: p.earned.coins }
    : { day: '', coins: 0 };
  const profile = { coins: Number.isFinite(p.coins) ? p.coins : STARTING_COINS, earned, owned, equipped: { ...DEFAULT_EQUIPPED } };
  for (const [type, id] of Object.entries(p.equipped || {})) {
    if (ITEMS[id]?.type === type && ownsItem(profile, id)) profile.equipped[type] = id;
  }
  return profile;
}

// What players think of chat translations: a 👍 or 👎 under each one, and "Suggest a better one" for
// players who speak both languages. A suggestion takes over (for everyone, from then on) once
// APPROVE_AT different players have suggested the same thing, or backed it with a 👍; approved
// ones also become worked examples for NVIDIA's Riva (server/translate.js), so the fallback learns
// how players here really talk. The most 👎'd translations can be listed (scripts/tr-report.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { cleanText } from './filter.js';

export const APPROVE_AT = 3;
const KEEP = 5000; // records; the oldest go first
const PER_HOUR = 40; // votes and suggestions a player may send an hour
const MAX_LEN = 300;
const SAVE_DELAY_MS = 3000;

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();

export class TranslationFeedback {
  constructor(file, { now = Date.now } = {}) {
    this.file = file;
    this.now = now;
    this.records = new Map(); // `${to}|${text}` -> record
    this.windows = new Map(); // userId -> { start, count }
    this.saveTimer = null;
    if (file) this.load();
  }

  key(to, text) {
    return `${to}|${norm(text)}`;
  }

  record(to, text, { from = '', shown = '' } = {}) {
    const k = this.key(to, text);
    let r = this.records.get(k);
    if (!r) {
      r = { to, text: norm(text), from, shown: norm(shown), up: [], down: [], suggestions: [], approved: null, at: this.now() };
      this.records.set(k, r);
      if (this.records.size > KEEP) this.records.delete(this.records.keys().next().value);
    }
    if (from) r.from = from;
    if (shown && !r.approved) r.shown = norm(shown);
    return r;
  }

  allowed(userId) {
    const t = this.now();
    let w = this.windows.get(userId);
    if (!w || t - w.start >= 3_600_000) this.windows.set(userId, (w = { start: t, count: 0 }));
    if (w.count >= PER_HOUR) throw new Error('Thanks! That is enough feedback for now');
    w.count += 1;
  }

  /** A 👍 or 👎 on what was shown. A 👍 on an approved or suggested text backs that one. */
  vote(userId, { to, text, from, shown, up }) {
    this.allowed(userId);
    const r = this.record(to, text, { from, shown });
    r.up = r.up.filter((u) => u !== userId);
    r.down = r.down.filter((u) => u !== userId);
    (up ? r.up : r.down).push(userId);
    // a 👍 on a suggestion someone made counts as backing it
    if (up && shown) {
      const s = r.suggestions.find((x) => same(x.text, shown));
      if (s && !s.by.includes(userId)) s.by.push(userId);
      this.approve(r);
    }
    this.save();
    return this.view(r);
  }

  /** "Suggest a better one": the player's own translation. */
  suggest(userId, { to, text, from, shown, suggestion }) {
    this.allowed(userId);
    const clean = cleanText(norm(suggestion).slice(0, MAX_LEN));
    if (!clean) throw new Error('Write the better translation first');
    if (same(clean, text)) throw new Error("That's the same as the message");
    const r = this.record(to, text, { from, shown });
    // one suggestion per player per message: a new one replaces their old one
    for (const s of r.suggestions) s.by = s.by.filter((u) => u !== userId);
    let s = r.suggestions.find((x) => same(x.text, clean));
    if (!s) r.suggestions.push((s = { text: clean, by: [], at: this.now() }));
    s.by.push(userId);
    r.suggestions = r.suggestions.filter((x) => x.by.length).slice(-10);
    if (!r.down.includes(userId) && !same(clean, r.shown)) r.down.push(userId); // they didn't like what they saw
    r.up = r.up.filter((u) => u !== userId);
    this.approve(r);
    this.save();
    return this.view(r);
  }

  approve(r) {
    const best = [...r.suggestions].sort((a, b) => b.by.length - a.by.length)[0];
    if (best && best.by.length >= APPROVE_AT) {
      r.approved = best.text;
      r.approvedAt ||= this.now();
    }
  }

  /** The players' translation of `text` into `to`, once approved, or null. */
  approvedFor(to, text) {
    const r = this.records.get(this.key(to, text));
    return r?.approved ? { text: r.approved, from: r.from } : null;
  }

  /** Approved translations from `from` into `to`, newest first: worked examples for Riva. */
  examples(from, to, max = 4) {
    const out = [];
    for (const r of [...this.records.values()].reverse()) {
      if (r.approved && r.from === from && r.to === to && r.text.length <= 120) out.push([r.text, r.approved]);
      if (out.length >= max) break;
    }
    return out;
  }

  view(r) {
    return { up: r.up.length, down: r.down.length, approved: !!r.approved };
  }

  /** The most 👎'd translations (for the owner to look at). */
  worst(n = 20) {
    return [...this.records.values()]
      .filter((r) => r.down.length)
      .sort((a, b) => b.down.length - b.up.length - (a.down.length - a.up.length))
      .slice(0, n)
      .map((r) => ({ to: r.to, from: r.from, text: r.text, shown: r.shown, up: r.up.length, down: r.down.length, approved: r.approved, suggestions: r.suggestions.map((s) => `${s.text} (${s.by.length})`) }));
  }

  load() {
    for (const f of [this.file, `${this.file}.bak`]) {
      if (!fs.existsSync(f)) continue;
      try {
        const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
        for (const r of doc.records || []) if (r?.to && r?.text) this.records.set(this.key(r.to, r.text), r);
        return;
      } catch (err) {
        console.error(`Translation feedback file ${f} is unreadable (${err.message})`);
      }
    }
  }

  save() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    this.saveTimer.unref?.();
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, records: [...this.records.values()] }));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.renameSync(tmp, this.file);
  }
}

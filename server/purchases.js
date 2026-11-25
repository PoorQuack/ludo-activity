// Real-money purchases through Discord (coin packs and tips). Each one is a consumable SKU set up
// in the Discord Developer Portal. After the player pays in Discord's own checkout, Discord holds an
// "entitlement" for it; we read the player's unclaimed ones with the bot token, pay out, and mark
// them consumed. Every entitlement id is also written into the player's profile before it is
// consumed, so a payout can never happen twice, even if consuming fails and is retried later.
import { PAID_ITEMS } from '../shared/shop.js';

const API = 'https://discord.com/api/v10';

// "pack-1:1234,pack-2:5678,coffee-1:9999" -> Map(sku -> item)
export function parseSkus(text) {
  const bySku = new Map();
  for (const part of String(text || '').split(',')) {
    const [id, sku] = part.split(':').map((s) => s?.trim());
    if (PAID_ITEMS[id] && /^\d{5,25}$/.test(sku || '')) bySku.set(sku, PAID_ITEMS[id]);
  }
  return bySku;
}

export class Purchases {
  constructor({ appId, token, skus, store, fetchImpl = fetch, log = console }) {
    this.appId = appId;
    this.token = token;
    this.bySku = skus;
    this.store = store;
    this.fetch = fetchImpl;
    this.log = log;
    this.busy = new Map(); // userId -> the claim in progress (one at a time per player)
  }

  get enabled() {
    return !!(this.appId && this.token && this.bySku.size);
  }

  // What the client may show: the items that have a SKU, with it.
  list() {
    return [...this.bySku].map(([sku, item]) => ({ id: item.id, sku }));
  }

  // Pay out everything this player has bought and not been paid for yet.
  // Returns [{ id, kind, gems }] for what was granted now (packs pay VIP Gems; tips pay nothing).
  claim(userId) {
    if (!this.enabled || !/^\d{5,25}$/.test(userId)) return Promise.resolve([]);
    const prev = this.busy.get(userId) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => this.#claim(userId));
    this.busy.set(userId, next);
    next.finally(() => this.busy.get(userId) === next && this.busy.delete(userId)).catch(() => {});
    return next;
  }

  async #claim(userId) {
    const q = new URLSearchParams({ user_id: userId, sku_ids: [...this.bySku.keys()].join(','), exclude_ended: 'true', exclude_deleted: 'true', limit: '100' });
    const res = await this.fetch(`${API}/applications/${this.appId}/entitlements?${q}`, { headers: { Authorization: `Bot ${this.token}` } });
    if (!res.ok) throw new Error(`Discord entitlements: HTTP ${res.status}`);
    const list = await res.json();
    const granted = [];
    for (const e of Array.isArray(list) ? list : []) {
      const item = this.bySku.get(String(e.sku_id));
      if (!item || e.consumed || String(e.user_id) !== userId) continue;
      // The Battle Pass subscription: never consumed; its period end opens the premium lane until
      // then (a test purchase has no end: a month from now). Cancelling keeps it until the end.
      if (item.kind === 'pass') {
        const cur = this.store.peek(userId);
        const now = this.store.now?.() || Date.now();
        const active = !!(cur?.passUntil && cur.passUntil > now);
        // Test subscriptions arrive with no ends_at: once active, keep the expiry instead of
        // minting a new timestamp on every login and re-triggering the unlock toast.
        const until = e.ends_at ? Date.parse(e.ends_at) : (active ? cur.passUntil : now + 31 * 86_400_000);
        if (Number.isFinite(until) && this.store.setPassUntil(userId, until)) {
          if (!active) granted.push({ id: item.id, kind: 'pass', until });
          this.log.log?.(`🎟️ ${userId} has the Battle Pass until ${new Date(until).toISOString()}`);
        }
        continue;
      }
      const given = this.store.grantPaid(userId, String(e.id), item);
      if (given) {
        granted.push(given);
        this.log.log?.(`💳 ${userId} bought ${item.id}${given.gems ? ` (+${given.gems} gems)` : ''}`);
      }
      // The Starter Pack is a Durable SKU: it can't be consumed (and the id stops a second payout)
      if (item.kind === 'starter') continue;
      // Paid out (now or before): consume it so it stops showing up. Failing is fine, the id
      // in the profile stops a second payout, and it's retried on the next claim.
      try {
        const r = await this.fetch(`${API}/applications/${this.appId}/entitlements/${e.id}/consume`, { method: 'POST', headers: { Authorization: `Bot ${this.token}` } });
        if (!r.ok && r.status !== 404) this.log.warn?.(`Could not consume entitlement ${e.id}: HTTP ${r.status}`);
      } catch (err) {
        this.log.warn?.(`Could not consume entitlement ${e.id}: ${err.message}`);
      }
    }
    return granted;
  }
}

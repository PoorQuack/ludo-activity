// Web Store & Stripe Checkout (for Safari / Apple Pay on iOS, and direct browser purchases).
// Works alongside Discord SKUs: both fulfill into the exact same ProfileStore (`grantPurchase` /
// `setPassUntil`) with `stripe:<id>` idempotency keys so a payment can never pay out twice.
import crypto from 'node:crypto';
import { COIN_PACKS, PAID_ITEMS, TIPS, STARTER, FIRST_PACK_BONUS, ITEMS } from '../shared/shop.js';
import { passRewards, seasonMonth } from '../shared/pass.js';
const PASS_GEMS = passRewards(seasonMonth(Date.now())).tiers.reduce((n, x) => n + (x.premium.gems || 0), 0);

const STRIPE_API = 'https://api.stripe.com/v1';

// "pack-1:price_xxx,pack-2:price_yyy,pass:price_zzz" -> Map<id, { id, item, priceId }>
export function parseStripePrices(text) {
  const byId = new Map();
  for (const part of String(text || '').split(',')) {
    const [id, priceId] = part.split(':').map((s) => s?.trim());
    if (PAID_ITEMS[id] && /^price_[A-Za-z0-9_]+$/.test(priceId || '')) {
      byId.set(id, { id, item: PAID_ITEMS[id], priceId });
    }
  }
  return byId;
}

export function formatStripeAmount(unitAmount, currency, locale = 'en') {
  if (!Number.isFinite(unitAmount) || !currency) return '';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: String(currency).toUpperCase(),
    }).format(unitAmount / 100);
  } catch {
    return '';
  }
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (str) => Buffer.from(String(str || ''), 'base64url');

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export class StripeStore {
  constructor({
    secretKey = '',
    webhookSecret = '',
    signingSecret = '',
    publicUrl = '',
    prices = new Map(),
    store,
    fetchImpl = fetch,
    onFulfill = null,
    log = console,
    now = () => Date.now(),
  }) {
    this.secretKey = String(secretKey || '').trim();
    this.webhookSecret = String(webhookSecret || '').trim();
    this.signingKey = signingSecret
      ? crypto.createHash('sha256').update(String(signingSecret)).digest()
      : crypto.randomBytes(32);
    this.publicUrl = String(publicUrl || '').trim().replace(/\/+$/, '');
    this.prices = prices; // Map<itemId, { id, item, priceId }>
    this.store = store;
    this.fetch = fetchImpl;
    this.onFulfill = onFulfill;
    this.log = log;
    this.now = now;
    this.priceCache = { at: 0, values: {} };
    this.pricePromise = null;
  }

  get enabled() {
    return !!(this.secretKey && this.publicUrl && this.prices.size);
  }

  hasPrice(itemId) {
    return this.prices.has(itemId);
  }

  // Sign short-lived checkout tokens (for `?t=`) and store session cookies (`ludo_store`).
  signToken(payload, ttlMs = 30 * 60_000) {
    const body = b64u(JSON.stringify({ ...payload, exp: this.now() + ttlMs }));
    const sig = crypto.createHmac('sha256', this.signingKey).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  verifyToken(token) {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', this.signingKey).update(body).digest();
    let got;
    try {
      got = unb64u(sig);
    } catch {
      return null;
    }
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
    try {
      const data = JSON.parse(unb64u(body).toString('utf8'));
      if (!data || typeof data !== 'object') return null;
      if (!Number.isFinite(data.exp) || data.exp <= this.now()) return null;
      if (data.userId && !/^\d{5,25}$/.test(String(data.userId))) return null;
      return data;
    } catch {
      return null;
    }
  }

  async #stripe(method, endpoint, params = null) {
    if (!this.secretKey) throw new Error('Stripe is not configured');
    const headers = { Authorization: `Bearer ${this.secretKey}` };
    const init = { method, headers };
    if (params) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = params.toString();
    }
    const res = await this.fetch(`${STRIPE_API}${endpoint}`, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `Stripe HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  // Fetch human-readable prices from Stripe (cached for 1 hour) so Safari & mobile show exact pricing.
  async listPrices() {
    if (!this.enabled) return {};
    if (this.priceCache.at && this.now() - this.priceCache.at < 3600_000) return this.priceCache.values;
    if (this.pricePromise) return this.pricePromise;
    this.pricePromise = (async () => {
      const out = {};
      await Promise.all(
        [...this.prices.values()].map(async ({ id, priceId }) => {
          try {
            const p = await this.#stripe('GET', `/prices/${encodeURIComponent(priceId)}`);
            const formatted = formatStripeAmount(p.unit_amount, p.currency);
            if (formatted) out[id] = formatted;
          } catch (err) {
            this.log.warn?.(`Stripe price ${id} (${priceId}): ${err.message}`);
          }
        }),
      );
      this.priceCache = { at: this.now(), values: out };
      return out;
    })().finally(() => {
      this.pricePromise = null;
    });
    return this.pricePromise;
  }

  cachedPrices() {
    return { ...this.priceCache.values };
  }

  async createCheckoutSession({ userId, itemId }) {
    if (!this.enabled) throw new Error('Web checkout is not available right now');
    if (!/^\d{5,25}$/.test(String(userId || ''))) throw new Error('Sign in with Discord first');
    const entry = this.prices.get(itemId);
    if (!entry) throw new Error('That item is not available in the Web Store');
    // the Starter Pack is once per player
    if (entry.item.kind === 'starter' && this.store?.peek?.(userId)?.starter) throw new Error('You already have the Starter Pack');
    const isPass = entry.item.kind === 'pass';
    const body = new URLSearchParams();
    body.set('mode', isPass ? 'subscription' : 'payment');
    body.set('line_items[0][price]', entry.priceId);
    body.set('line_items[0][quantity]', '1');
    body.set('client_reference_id', userId);
    body.set('metadata[userId]', userId);
    body.set('metadata[itemId]', itemId);
    body.set('success_url', `${this.publicUrl}/pay/success?session_id={CHECKOUT_SESSION_ID}`);
    body.set('cancel_url', `${this.publicUrl}/store?cancelled=1`);
    body.set('allow_promotion_codes', 'true');
    if (isPass) {
      body.set('subscription_data[metadata][userId]', userId);
      body.set('subscription_data[metadata][itemId]', itemId);
    } else {
      body.set('payment_intent_data[metadata][userId]', userId);
      body.set('payment_intent_data[metadata][itemId]', itemId);
    }
    const session = await this.#stripe('POST', '/checkout/sessions', body);
    if (!session?.url) throw new Error('Stripe did not return a checkout URL');
    return { id: session.id, url: session.url };
  }

  // Verify a finished Checkout Session with Stripe and fulfill it immediately (safe to call twice).
  async confirmSession(sessionId) {
    if (!/^cs_[A-Za-z0-9_]+$/.test(String(sessionId || ''))) throw new Error('Invalid session id');
    const session = await this.#stripe(
      'GET',
      `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`,
    );
    return this.fulfillCheckoutSession(session);
  }

  async fulfillCheckoutSession(session) {
    if (!session) return { paid: false, granted: [] };
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      return { paid: false, granted: [] };
    }
    const userId = String(session.metadata?.userId || session.client_reference_id || '');
    const itemId = String(session.metadata?.itemId || '');
    const item = PAID_ITEMS[itemId];
    if (!/^\d{5,25}$/.test(userId) || !item) return { paid: false, granted: [] };

    const granted = [];
    if (item.kind === 'pass') {
      let sub = typeof session.subscription === 'object' ? session.subscription : null;
      if (!sub && typeof session.subscription === 'string') {
        sub = await this.#stripe('GET', `/subscriptions/${encodeURIComponent(session.subscription)}`);
      }
      const periodEndSec = Number(sub?.current_period_end);
      const until = Number.isFinite(periodEndSec) && periodEndSec > 0 ? periodEndSec * 1000 : this.now() + 31 * 86_400_000;
      const cur = this.store.peek(userId);
      const active = !!(cur?.passUntil && cur.passUntil > this.now());
      if (this.store.setPassUntil(userId, until)) {
        const g = { id: item.id, kind: 'pass', until };
        if (!active) granted.push(g);
        this.log.log?.(`🎟️ [Stripe] ${userId} Battle Pass until ${new Date(until).toISOString()}`);
      }
    } else {
      const given = this.store.grantPaid(userId, `stripe:${session.id}`, item);
      if (given) {
        granted.push(given);
        this.log.log?.(`💳 [Stripe] ${userId} bought ${item.id}${given.gems ? ` (+${given.gems} gems)` : ''}`);
      }
    }
    if (granted.length && this.onFulfill) this.onFulfill(userId, granted);
    return { paid: true, userId, item, granted };
  }

  // Verify `Stripe-Signature` header against raw request Buffer. Returns parsed event JSON.
  verifyWebhook(rawBody, sigHeader) {
    if (!this.webhookSecret) throw new Error('Stripe webhook secret is not configured');
    const parts = String(sigHeader || '')
      .split(',')
      .map((s) => s.trim().split('='));
    const t = parts.find(([k]) => k === 't')?.[1];
    const sigs = parts.filter(([k, v]) => k === 'v1' && v).map(([, v]) => v);
    const ts = Number(t);
    if (!Number.isFinite(ts) || !sigs.length) throw new Error('Invalid Stripe signature');
    if (Math.abs(Math.floor(this.now() / 1000) - ts) > 300) throw new Error('Expired Stripe signature');

    const bodyText = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(`${t}.${bodyText}`)
      .digest();
    const match = sigs.some((s) => {
      try {
        const buf = Buffer.from(s, 'hex');
        return buf.length === expected.length && crypto.timingSafeEqual(buf, expected);
      } catch {
        return false;
      }
    });
    if (!match) throw new Error('Stripe signature mismatch');
    return JSON.parse(bodyText);
  }

  async handleWebhook(event) {
    const obj = event?.data?.object;
    if (!obj) return { handled: false };
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      return { handled: true, ...(await this.fulfillCheckoutSession(obj)) };
    }
    if (event.type === 'invoice.paid' && obj.subscription) {
      let sub = null;
      const meta = obj.parent?.subscription_details?.metadata || obj.subscription_details?.metadata || {};
      let userId = String(meta.userId || '');
      let itemId = String(meta.itemId || '');
      if (!userId) {
        sub = await this.#stripe('GET', `/subscriptions/${encodeURIComponent(String(obj.subscription))}`);
        userId = String(sub?.metadata?.userId || '');
        itemId = String(sub?.metadata?.itemId || 'pass');
      }
      if (/^\d{5,25}$/.test(userId) && itemId === 'pass') {
        const lineEnd = Number(obj.lines?.data?.[0]?.period?.end || sub?.current_period_end);
        const until = Number.isFinite(lineEnd) && lineEnd > 0 ? lineEnd * 1000 : this.now() + 31 * 86_400_000;
        const cur = this.store.peek(userId);
        const wasActive = !!(cur?.passUntil && cur.passUntil > this.now());
        if (this.store.setPassUntil(userId, until)) {
          const granted = !wasActive ? [{ id: 'pass', kind: 'pass', until }] : [];
          if (granted.length && this.onFulfill) this.onFulfill(userId, granted);
          this.log.log?.(`🎟️ [Stripe renewal] ${userId} Battle Pass until ${new Date(until).toISOString()}`);
          return { handled: true, userId, granted };
        }
      }
    }
    if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.updated') {
      const userId = String(obj.metadata?.userId || '');
      if (/^\d{5,25}$/.test(userId) && obj.metadata?.itemId === 'pass') {
        const end = obj.status === 'canceled' ? Math.min(this.now(), Number(obj.ended_at || 0) * 1000 || this.now()) : Number(obj.current_period_end || 0) * 1000;
        if (Number.isFinite(end) && end >= 0) this.store.setPassUntil(userId, end);
        return { handled: true, userId };
      }
    }
    if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
      const chargeObj = event.type === 'charge.dispute.created' && typeof obj.charge === 'string'
        ? await this.#stripe('GET', `/charges/${encodeURIComponent(obj.charge)}`).catch(() => obj)
        : obj;
      if (event.type === 'charge.refunded' && !chargeObj.refunded && !(Number(chargeObj.amount_refunded) > 0 && Number(chargeObj.amount_refunded) >= Number(chargeObj.amount))) {
        return { handled: false };
      }
      const target = await this.#resolveChargeTarget(chargeObj);
      if (!target?.userId || !target?.itemId) return { handled: false };
      const item = PAID_ITEMS[target.itemId];
      if (!item) return { handled: false };
      const revokeId = `stripe:rev:${chargeObj.payment_intent || chargeObj.id || obj.id}`;
      if (item.kind === 'pass') {
        this.store.setPassUntil(target.userId, 0);
        this.log.log?.(`↩️ [Stripe] Revoked Battle Pass for ${target.userId} (${event.type})`);
        return { handled: true, userId: target.userId, revoked: 'pass' };
      }
      if (item.kind === 'gems' || item.kind === 'starter') {
        // a first pack paid double: take back what was actually given
        const doubled = target.sessionId && this.store.peek(target.userId)?.bought.includes(`stripe:${target.sessionId}:x2`);
        const gems = item.gems * (doubled ? 2 : 1);
        const res = this.store.revokePurchase(target.userId, revokeId, gems);
        this.log.log?.(`↩️ [Stripe] Clawed back ${gems} gems from ${target.userId} (${event.type}, removed items: ${res.removedItems.join(',') || 'none'})`);
        return { handled: true, userId: target.userId, ...res };
      }
      return { handled: true, userId: target.userId };
    }
    return { handled: false };
  }

  async #resolveChargeTarget(charge) {
    if (!charge) return null;
    const directUid = String(charge.metadata?.userId || '');
    const directItem = String(charge.metadata?.itemId || '');
    if (/^\d{5,25}$/.test(directUid) && directItem) return { userId: directUid, itemId: directItem };
    if (charge.payment_intent) {
      const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent.id;
      if (pi) {
        const list = await this.#stripe('GET', `/checkout/sessions?payment_intent=${encodeURIComponent(pi)}&limit=1`).catch(() => null);
        const sess = list?.data?.[0];
        const uid = String(sess?.metadata?.userId || sess?.client_reference_id || '');
        const itemId = String(sess?.metadata?.itemId || '');
        if (/^\d{5,25}$/.test(uid) && itemId) return { userId: uid, itemId, sessionId: sess.id };
      }
    }
    if (charge.invoice) {
      const invId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice.id;
      if (invId) {
        const inv = await this.#stripe('GET', `/invoices/${encodeURIComponent(invId)}?expand[]=subscription`).catch(() => null);
        const subMeta = inv?.subscription?.metadata || inv?.parent?.subscription_details?.metadata || {};
        const uid = String(subMeta.userId || '');
        const itemId = String(subMeta.itemId || '');
        if (/^\d{5,25}$/.test(uid) && itemId) return { userId: uid, itemId };
      }
    }
    return null;
  }
}

export function renderStorePage({ user, profile, prices, enabled, notice = '', authUrl = '' }) {
  const passActive = !!(profile?.passUntil && profile.passUntil > Date.now());
  const gems = profile?.gems ?? 0;
  const priceFor = (id, fallback) => prices[id] || fallback;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Ludo Store — Die Gems & Battle Pass</title>
<style>
  :root { color-scheme: dark; --bg: #18130f; --card: #241d17; --panel: #2f261f; --text: #f7efe6; --muted: #b7a796; --accent: #ff6b4a; --gold: #ffc84a; --gem: #4ee2d4; --good: #4cc38a; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: radial-gradient(80% 50% at 50% 0%, #31251b, var(--bg)); color: var(--text); padding: 20px 16px 40px; }
  .wrap { max-width: 680px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .brand { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; }
  .pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 99px; background: var(--card); border: 1px solid rgba(255,255,255,0.08); font-size: 13.5px; }
  .gem-dot { width: 12px; height: 12px; border-radius: 3px; background: linear-gradient(135deg, #98fff4, #1fb8aa); display: inline-block; transform: rotate(45deg); }
  .card { background: var(--card); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 16px; }
  .notice { background: rgba(76, 195, 138, 0.14); border: 1px solid rgba(76, 195, 138, 0.35); color: #bff2d8; border-radius: 12px; padding: 12px 14px; font-size: 14px; }
  .notice.warn { background: rgba(255, 194, 46, 0.12); border-color: rgba(255, 194, 46, 0.3); color: #ffe39a; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  @media (max-width: 480px) { .grid { grid-template-columns: 1fr; } }
  .pack { position: relative; background: var(--panel); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .bonus { position: absolute; top: 10px; right: 10px; background: #269162; color: #fff; font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 99px; }
  .pack b { font-size: 18px; display: inline-flex; align-items: center; gap: 7px; }
  .pack small { color: var(--muted); font-size: 13px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 12px; padding: 11px 16px; font: inherit; font-weight: 800; cursor: pointer; text-decoration: none; background: var(--accent); color: #fff; width: 100%; }
  .btn.gold { background: linear-gradient(90deg, #f5a91c, #ffc84a); color: #311d00; }
  .btn.discord { background: #5865F2; color: #fff; width: auto; }
  .btn.ghost { background: rgba(255,255,255,0.08); color: var(--text); width: auto; font-size: 13px; padding: 7px 12px; }
  .btn[disabled], .btn.disabled { opacity: 0.45; pointer-events: none; }
  .pass { background: linear-gradient(135deg, rgba(255, 200, 74, 0.16), var(--card)); border-color: rgba(255, 200, 74, 0.35); display: flex; flex-direction: column; gap: 10px; }
  .pass h2 { margin: 0; font-size: 19px; }
  .pass ul { margin: 0; padding-left: 18px; color: var(--muted); font-size: 14px; display: flex; flex-direction: column; gap: 4px; }
  .sub { margin: 0; color: var(--muted); font-size: 13.5px; line-height: 1.45; }
  form { margin: 0; width: 100%; }
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <div class="brand">🎲 Ludo Store</div>
    ${
      user
        ? `<div class="pill"><span class="gem-dot"></span><b>${gems.toLocaleString('en')}</b><span>·</span><span>${esc(user.name)}</span><form method="post" action="/store/logout" style="width:auto"><button type="submit" class="btn ghost">Sign out</button></form></div>`
        : authUrl
          ? `<a class="btn discord" href="${esc(authUrl)}">Sign in with Discord</a>`
          : ''
    }
  </div>

  ${notice ? `<div class="notice">${esc(notice)}</div>` : ''}
  ${!enabled ? `<div class="notice warn">Web checkout is not enabled on this server yet.</div>` : ''}
  ${
    !user
      ? `<div class="card">
          <p class="sub">Sign in with Discord so any <strong>Die Gems</strong> or <strong>Battle Pass</strong> you buy go straight to your Ludo profile (Apple Pay &amp; cards supported in Safari).</p>
          ${authUrl ? `<p style="margin:12px 0 0"><a class="btn discord" href="${esc(authUrl)}">Sign in with Discord</a></p>` : ''}
        </div>`
      : ''
  }

  <div class="card pass">
    <h2>👑 Battle Pass</h2>
    <ul>
      <li>Up to ${PASS_GEMS} Die Gems over the season</li>
      <li>Exclusive boards, tokens &amp; sticker pack</li>
      <li>Gold name with crown in chat &amp; instant unlock of reached tiers</li>
    </ul>
    ${
      passActive
        ? `<div class="notice">✓ Your Battle Pass is active until ${esc(new Date(profile.passUntil).toLocaleDateString('en', { day: 'numeric', month: 'short' }))}.</div>`
        : user && enabled && prices.pass
          ? `<a class="btn gold" href="/pay?item=pass">Subscribe · ${esc(priceFor('pass', ''))}</a>`
          : `<span class="btn gold disabled">${enabled ? (user ? 'Unavailable' : 'Sign in above to subscribe') : 'Coming soon'}</span>`
    }
  </div>

  ${
    !profile?.starter && prices[STARTER.id]
      ? `<div class="card starter">
    <h2 style="margin:0 0 6px;font-size:18px">🎁 ${esc(STARTER.name)} <span class="bonus">Once only</span></h2>
    <p class="sub" style="margin-bottom:12px">${STARTER.gems} Die Gems, ${STARTER.coins} coins and the ${esc(ITEMS[STARTER.item]?.name || '')} dice: only in this pack.</p>
    ${user && enabled ? `<a class="btn gold" href="/pay?item=${esc(STARTER.id)}">${esc(prices[STARTER.id])}</a>` : `<span class="btn gold disabled">${enabled ? 'Sign in above to buy' : 'Coming soon'}</span>`}
  </div>`
      : ''
  }

  <div class="card">
    <h2 style="margin:0 0 6px;font-size:18px">💎 Die Gems</h2>
    <p class="sub" style="margin-bottom:12px">Secure Stripe Checkout — Apple Pay &amp; cards work right in Safari.</p>
    ${user && profile && !profile.packs ? `<div class="notice">✨ First purchase: your first gem pack gives ×${FIRST_PACK_BONUS} the gems.</div>` : ''}
    <div class="grid">
      ${COIN_PACKS.map(
        (p) => `
        <div class="pack">
          ${p.bonus ? `<span class="bonus">+${p.bonus}% extra</span>` : ''}
          <b><span class="gem-dot"></span> ${p.gems.toLocaleString('en')}</b>
          <small>${esc(p.name)}</small>
          ${
            user && enabled && prices[p.id]
              ? `<a class="btn" href="/pay?item=${esc(p.id)}">${esc(prices[p.id])}</a>`
              : `<span class="btn disabled">${enabled ? (prices[p.id] ? esc(prices[p.id]) : 'Soon') : 'Soon'}</span>`
          }
        </div>`,
      ).join('')}
    </div>
  </div>

  <div class="card">
    <h2 style="margin:0 0 6px;font-size:18px">☕ Buy me a coffee</h2>
    <p class="sub" style="margin-bottom:12px">Enjoying Ludo? Support new boards, dice and server hosting.</p>
    <div class="grid">
      ${TIPS.map(
        (tip) => `
        <div class="pack">
          <b>${esc(tip.icon)} ${esc(tip.name)}</b>
          ${
            user && enabled && prices[tip.id]
              ? `<a class="btn" href="/pay?item=${esc(tip.id)}">${esc(prices[tip.id])}</a>`
              : `<span class="btn disabled">${enabled ? (prices[tip.id] ? esc(prices[tip.id]) : 'Soon') : 'Soon'}</span>`
          }
        </div>`,
      ).join('')}
    </div>
  </div>
</div>
</body>
</html>`;
}

export function renderResultPage({ ok, title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)} — Ludo</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 20px; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: #18130f; color: #f7efe6; }
  .card { max-width: 440px; width: 100%; background: #241d17; border: 1px solid rgba(255,255,255,0.1); border-radius: 18px; padding: 24px; text-align: center; display: flex; flex-direction: column; gap: 12px; }
  .icon { font-size: 42px; }
  h1 { margin: 0; font-size: 22px; }
  p { margin: 0; color: #b7a796; font-size: 15px; line-height: 1.5; }
  .btn { display: inline-block; margin-top: 6px; padding: 12px 18px; border-radius: 12px; background: #ff6b4a; color: #fff; text-decoration: none; font-weight: 800; }
</style>
</head>
<body>
<div class="card">
  <div class="icon">${ok ? '✅' : '⚠️'}</div>
  <h1>${esc(title)}</h1>
  <p>${esc(body)}</p>
  <a class="btn" href="/store">Back to Ludo Store</a>
</div>
</body>
</html>`;
}

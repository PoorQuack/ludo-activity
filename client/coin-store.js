// "Get gems": the + beside the Die Gems. Gem packs and "Buy me a coffee", paid with real money through
// Discord's own checkout (consumable SKUs; the server checks each purchase with Discord before
// paying it out). A Ko-fi / Buy Me a Coffee link takes tips of any amount.
import { PriceUtils } from '@discord/embedded-app-sdk';
import { COIN_PACKS, TIPS, STARTER, FIRST_PACK_BONUS, ITEMS } from '../shared/shop.js';
import { t, currentLanguage as getLanguage } from './i18n.js';

let el = null;
let ctx = null; // { sdk, paid: { skus: [{ id, sku }], tipUrl }, onBought, toast, profile, need, starterArt }
let prices = null; // item id -> formatted price, from Discord
let rawPrices = null; // item id -> { amount, currency }, from Discord (for "≈ £1.20" under gem prices)
let mobileUnavailable = false;

const skuOf = (id) => ctx?.paid?.skus.find((s) => s.id === id)?.sku || null;
const webPriceOf = (id) => ctx?.paid?.webPrices?.[id] || '';
const canWebBuy = (id) => !!(ctx?.paid?.webStore && (webPriceOf(id) || skuOf(id)));

function build() {
  el = document.createElement('div');
  el.className = 'modal-wrap coin-store hidden';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  document.body.appendChild(el);
  let downOnBackdrop = false;
  el.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === el; });
  el.addEventListener('click', (e) => {
    if (downOnBackdrop && e.target === el) closeCoinStore();
    downOnBackdrop = false;
  });
  window.addEventListener('keydown', (e) => e.key === 'Escape' && !el.classList.contains('hidden') && closeCoinStore());
  window.addEventListener('ludo-lang', () => !el.classList.contains('hidden') && render());
}

export function openCoinStore(context) {
  ctx = context;
  if (!el) build();
  render();
  el.classList.remove('hidden');
  loadPrices();
}

// The shop asks for Discord's prices early (without opening anything), for "≈ £…" under gem prices
export function preloadPrices(context) {
  if (!ctx) ctx = context;
  loadPrices();
}

// The price label of a paid item (Discord's, or the web store's), or ''
export function paidPrice(id) {
  return prices?.[id] || webPriceOf(id) || '';
}

// Roughly what `gems` cost in real money, at the smallest pack's rate (formatted, or '')
export function gemsInMoney(gems) {
  const base = rawPrices?.['pack-1'];
  const pack = COIN_PACKS[0];
  if (!base || !gems || !pack) return '';
  // whole units of the smallest currency step, so ¥ and £ both come out right
  const amount = Math.max(1, Math.round((base.amount * gems) / pack.gems));
  try {
    return PriceUtils.formatPrice({ ...base, amount }, getLanguage());
  } catch {
    return '';
  }
}

// The profile changed (bought something, or the Starter Pack arrived): draw it again if open
export function refreshCoinStore(profile) {
  if (!ctx || !el || el.classList.contains('hidden')) return;
  ctx.profile = profile;
  if (ctx.need && (profile?.gems ?? 0) >= ctx.needTotal) ctx.need = 0;
  render();
}

export function closeCoinStore() {
  el?.classList.add('hidden');
}

// Prices come from Discord (in the player's currency), once per session.
async function loadPrices() {
  if (prices || !ctx.sdk || !ctx.paid?.skus.length) return;
  try {
    const { skus } = await ctx.sdk.commands.getSkus();
    prices = {};
    rawPrices = {};
    for (const { id, sku } of ctx.paid.skus) {
      const s = skus.find((k) => k.id === sku);
      if (s?.price) {
        prices[id] = PriceUtils.formatPrice(s.price, getLanguage());
        rawPrices[id] = s.price;
      }
    }
    window.dispatchEvent(new Event('ludo-prices')); // the shop can now show "≈ £…" under gem prices
    if (ctx.sdk.platform === 'mobile' && !skus?.length) mobileUnavailable = true;
    render();
  } catch {
    prices = {}; // the buttons still work, they just say "Buy"
    if (ctx.sdk.platform === 'mobile') {
      mobileUnavailable = true;
      render();
    }
  }
}

// Gems shown as a little pile: more gems, bigger pile (real money buys gems, never coins)
function pile(n) {
  return `<span class="coin-pile gem-pile" style="--n:${n}">${'<span class="gem"></span>'.repeat(n)}</span>`;
}

function render() {
  const inDiscord = !!ctx.sdk;
  const webReady = !!ctx.paid?.webStore;
  const isMobile = ctx.sdk?.platform === 'mobile';
  const anySku = !!ctx.paid?.skus.length || webReady;
  const profile = ctx.profile || null;
  const firstPack = !!profile?.firstPack;
  const need = Math.max(0, ctx.need || 0);
  // the smallest pack that covers what's missing (with the first-purchase double)
  const suggest = need ? (COIN_PACKS.find((p) => p.gems * (firstPack ? FIRST_PACK_BONUS : 1) >= need) || COIN_PACKS.at(-1)).id : '';
  const note = !inDiscord
    ? t('Purchases work in the Discord app.')
    : !anySku
      ? t('Die Gems packs are coming soon.')
      : mobileUnavailable
          ? t("Purchases aren't available on Discord mobile yet — open Ludo on Discord Desktop or Web to buy.")
          : '';
  el.innerHTML = `
    <div class="modal-card coin-card">
      <button type="button" class="set-close store-close" aria-label="${t('Close')}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      <h2 class="store-title">${t('Get Die Gems')}</h2>
      <p class="store-sub">${t('Paid securely through Discord. Gems arrive as soon as Discord confirms the payment.')}</p>
      ${note ? `<p class="store-note">${note}</p>` : ''}
      ${need ? `<p class="store-need">${t('You need {n} more gems: the highlighted pack covers it.', { n: need })}</p>` : ''}
      ${starterHtml(inDiscord, isMobile)}
      ${firstPack ? `<p class="store-first">✨ ${t('First purchase: your first gem pack gives ×{n} the gems!', { n: FIRST_PACK_BONUS })}</p>` : ''}
      <div class="pack-grid">
        ${COIN_PACKS.map(
          (p, i) => `
          <div class="pack${p.id === suggest ? ' suggest' : ''}" data-tier="${i + 1}">
            ${p.id === suggest ? `<span class="pack-suggest">${t('Covers it')}</span>` : p.bonus ? `<span class="pack-bonus">${t('+{n}% extra', { n: p.bonus })}</span>` : ''}
            ${pile(i + 2)}
            <b class="pack-coins"><span class="gem"></span>${firstPack ? `<s>${p.gems.toLocaleString(getLanguage())}</s> ${(p.gems * FIRST_PACK_BONUS).toLocaleString(getLanguage())}` : p.gems.toLocaleString(getLanguage())}</b>
            <small>${t(p.name)}</small>
            <button type="button" class="btn primary small" data-buy="${p.id}" ${inDiscord && (skuOf(p.id) || (isMobile && canWebBuy(p.id))) ? '' : 'disabled'}>${buyLabel(p.id)}</button>
          </div>`,
        ).join('')}
      </div>
      <h3 class="store-h3">☕ ${t('Buy me a coffee')}</h3>
      <p class="store-sub">${t('Enjoying the game? A coffee keeps it going: new boards, dice and features. Thank you!')}</p>
      <div class="tip-row">
        ${TIPS.map(
          (tip) => `
          <button type="button" class="tip" data-buy="${tip.id}" ${inDiscord && (skuOf(tip.id) || (isMobile && canWebBuy(tip.id))) ? '' : 'disabled'}>
            <span class="tip-icon">${tip.icon}</span><b>${t(tip.name)}</b><small>${prices?.[tip.id] || (isMobile ? webPriceOf(tip.id) : '') || (skuOf(tip.id) || (isMobile && canWebBuy(tip.id)) ? t('Buy') : t('Soon'))}</small>
          </button>`,
        ).join('')}
        ${
          ctx.paid?.tipUrl
            ? `<button type="button" class="tip any" data-tip-link><span class="tip-icon">💛</span><b>${t('Any amount')}</b><small>${t('You choose')}</small></button>`
            : ''
        }
      </div>
    </div>`;
  el.querySelector('.store-close').addEventListener('click', closeCoinStore);
  const art = el.querySelector('.starter-art');
  if (art && ctx.starterArt) art.replaceChildren(ctx.starterArt());
  for (const b of el.querySelectorAll('[data-buy]')) b.addEventListener('click', () => buy(b.dataset.buy, b));
  el.querySelector('[data-tip-link]')?.addEventListener('click', () => {
    const url = ctx.paid.tipUrl;
    if (ctx.sdk) ctx.sdk.commands.openExternalLink({ url }).catch(() => {});
    else window.open(url, '_blank', 'noopener');
  });
}

// The Starter Pack: once per player, at the top until they have it
function starterHtml(inDiscord, isMobile) {
  const profile = ctx.profile;
  if (!profile || profile.starter) return '';
  const can = inDiscord && (skuOf(STARTER.id) || (isMobile && canWebBuy(STARTER.id)));
  if (!can && !skuOf(STARTER.id) && !webPriceOf(STARTER.id)) return ''; // not on sale yet
  const dice = ITEMS[STARTER.item];
  return `
    <div class="starter-card">
      <span class="starter-ribbon">${t('Once only')}</span>
      <div class="starter-art"></div>
      <div class="starter-text">
        <b>🎁 ${t(STARTER.name)}</b>
        <span><span class="gem"></span>${STARTER.gems} · <span class="coin"></span>${STARTER.coins} · ${t('{item} dice', { item: t(dice?.name || '') })}</span>
        <small>${t('The {item} dice are only in this pack.', { item: t(dice?.name || '') })}</small>
      </div>
      <button type="button" class="btn primary small starter-buy" data-buy="${STARTER.id}" ${can ? '' : 'disabled'}>${buyLabel(STARTER.id)}</button>
    </div>`;
}

function buyLabel(id) {
  if (prices?.[id]) return prices[id];
  if (ctx?.sdk?.platform === 'mobile' && webPriceOf(id)) return webPriceOf(id);
  if (!skuOf(id) && !(ctx?.sdk?.platform === 'mobile' && canWebBuy(id))) return t('Soon');
  return t('Buy');
}

async function buy(id, btn) {
  const sku = skuOf(id);
  if (!ctx.sdk) return;
  if (ctx.sdk.platform === 'mobile' && canWebBuy(id) && ctx.onWebCheckout) {
    btn.disabled = true;
    try {
      await ctx.onWebCheckout(id);
    } finally {
      btn.disabled = false;
    }
    return;
  }
  if (!sku) return;
  btn.disabled = true;
  try {
    await ctx.sdk.commands.startPurchase({ sku_id: sku });
    ctx.onBought(); // ask the server to check with Discord and pay out
  } catch (err) {
    const detail = err?.message || (typeof err === 'string' ? err : err ? JSON.stringify(err) : '');
    if (/cancel|closed|dismiss|abort/i.test(detail)) return;
    const unsupported = err?.code === 4002 || /unsupported command/i.test(detail);
    if (unsupported && canWebBuy(id) && ctx.onWebCheckout) {
      await ctx.onWebCheckout(id);
      return;
    }
    console.warn('startPurchase failed:', err);
    const why = [err?.code != null && !String(detail).includes(String(err.code)) ? `[${err.code}]` : '', detail].filter(Boolean).join(' ').trim();
    if (ctx.sdk.platform === 'mobile') {
      mobileUnavailable = true;
      render();
      const base = t("Purchases aren't available on Discord mobile yet — open Ludo on Discord Desktop or Web to buy.");
      ctx.toast?.(why && !unsupported ? `${base} (${why})` : base, 'notice', 5500);
    } else {
      ctx.toast?.(why ? t('Purchase failed: {why}', { why }) : t('Purchase could not be started.'), 'err', 4500);
    }
  } finally {
    btn.disabled = false;
  }
}

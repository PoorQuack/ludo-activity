// "Get gems": the + beside the VIP Gems. Gem packs and "Buy me a coffee", paid with real money through
// Discord's own checkout (consumable SKUs; the server checks each purchase with Discord before
// paying it out). A Ko-fi / Buy Me a Coffee link takes tips of any amount.
import { PriceUtils } from '@discord/embedded-app-sdk';
import { COIN_PACKS, TIPS } from '../shared/shop.js';
import { t, currentLanguage as getLanguage } from './i18n.js';

let el = null;
let ctx = null; // { sdk, paid: { skus: [{ id, sku }], tipUrl }, onBought, toast }
let prices = null; // item id -> formatted price, from Discord
let mobileUnavailable = false;

const skuOf = (id) => ctx?.paid?.skus.find((s) => s.id === id)?.sku || null;

function build() {
  el = document.createElement('div');
  el.className = 'modal-wrap coin-store hidden';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  document.body.appendChild(el);
  el.addEventListener('pointerdown', (e) => e.target === el && closeCoinStore());
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

export function closeCoinStore() {
  el?.classList.add('hidden');
}

// Prices come from Discord (in the player's currency), once per session.
async function loadPrices() {
  if (prices || !ctx.sdk || !ctx.paid?.skus.length) return;
  try {
    const { skus } = await ctx.sdk.commands.getSkus();
    prices = {};
    for (const { id, sku } of ctx.paid.skus) {
      const s = skus.find((k) => k.id === sku);
      if (s?.price) prices[id] = PriceUtils.formatPrice(s.price, getLanguage());
    }
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
  const anySku = !!ctx.paid?.skus.length;
  const note = !inDiscord
    ? t('Purchases work in the Discord app.')
    : !anySku
      ? t('Gem packs are coming soon.')
      : mobileUnavailable
        ? t("Purchases aren't available on Discord mobile yet — open Ludo on Discord Desktop or Web to buy.")
        : '';
  el.innerHTML = `
    <div class="modal-card coin-card">
      <button type="button" class="set-close store-close" aria-label="${t('Close')}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      <h2 class="store-title">${t('Get VIP Gems')}</h2>
      <p class="store-sub">${t('Paid securely through Discord. Gems arrive as soon as Discord confirms the payment.')}</p>
      ${note ? `<p class="store-note">${note}</p>` : ''}
      <div class="pack-grid">
        ${COIN_PACKS.map(
          (p, i) => `
          <div class="pack" data-tier="${i + 1}">
            ${p.bonus ? `<span class="pack-bonus">${t('+{n}% extra', { n: p.bonus })}</span>` : ''}
            ${pile(i + 2)}
            <b class="pack-coins"><span class="gem"></span>${p.gems.toLocaleString(getLanguage())}</b>
            <small>${t(p.name)}</small>
            <button type="button" class="btn primary small" data-buy="${p.id}" ${inDiscord && skuOf(p.id) ? '' : 'disabled'}>${buyLabel(p.id)}</button>
          </div>`,
        ).join('')}
      </div>
      <h3 class="store-h3">☕ ${t('Buy me a coffee')}</h3>
      <p class="store-sub">${t('Enjoying the game? A coffee keeps it going: new boards, dice and features. Thank you!')}</p>
      <div class="tip-row">
        ${TIPS.map(
          (tip) => `
          <button type="button" class="tip" data-buy="${tip.id}" ${inDiscord && skuOf(tip.id) ? '' : 'disabled'}>
            <span class="tip-icon">${tip.icon}</span><b>${t(tip.name)}</b><small>${prices?.[tip.id] || (skuOf(tip.id) ? t('Buy') : t('Soon'))}</small>
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
  for (const b of el.querySelectorAll('[data-buy]')) b.addEventListener('click', () => buy(b.dataset.buy, b));
  el.querySelector('[data-tip-link]')?.addEventListener('click', () => {
    const url = ctx.paid.tipUrl;
    if (ctx.sdk) ctx.sdk.commands.openExternalLink({ url }).catch(() => {});
    else window.open(url, '_blank', 'noopener');
  });
}

function buyLabel(id) {
  if (!skuOf(id)) return t('Soon');
  return prices?.[id] || t('Buy');
}

async function buy(id, btn) {
  const sku = skuOf(id);
  if (!ctx.sdk || !sku) return;
  btn.disabled = true;
  try {
    await ctx.sdk.commands.startPurchase({ sku_id: sku });
    ctx.onBought(); // ask the server to check with Discord and pay out
  } catch (err) {
    const detail = err?.message || (typeof err === 'string' ? err : err ? JSON.stringify(err) : '');
    if (/cancel|closed|dismiss|abort/i.test(detail)) return;
    console.warn('startPurchase failed:', err);
    const why = [err?.code != null && !String(detail).includes(String(err.code)) ? `[${err.code}]` : '', detail].filter(Boolean).join(' ').trim();
    if (ctx.sdk.platform === 'mobile') {
      mobileUnavailable = true;
      render();
      const base = t("Purchases aren't available on Discord mobile yet — open Ludo on Discord Desktop or Web to buy.");
      const unsupported = err?.code === 4002 || /unsupported command/i.test(detail);
      ctx.toast?.(why && !unsupported ? `${base} (${why})` : base, 'notice', 5500);
    } else {
      ctx.toast?.(why ? t('Purchase failed: {why}', { why }) : t('Purchase could not be started.'), 'err', 4500);
    }
  } finally {
    btn.disabled = false;
  }
}

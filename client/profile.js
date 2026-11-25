// The profile page: your badges (shared/badges.js), the title you wear, and the badges you pin.
import { BADGES, BADGES_BY_ID, LEVELS, MAX_PINS, badgeValue, levelFor } from '../shared/badges.js';
import { t } from './i18n.js';

const LEVEL_NAMES = ['Bronze', 'Silver', 'Gold'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A badge's round medal: grey until bronze, then bronze / silver / gold
// Badges with their own art show it (greyed out until the first level); the rest show their emoji
export const medalHtml = (badge, level, size = '') =>
  badge.img
    ? `<span class="medal art lv${level} ${size}" aria-hidden="true"><img src="${badge.img}" alt="" loading="lazy" decoding="async"></span>`
    : `<span class="medal lv${level} ${size}" aria-hidden="true"><span>${badge.icon}</span></span>`;

// `ctx`: { profile, name, onTitle(badgeId), onPins(ids) }
export function renderProfile(el, ctx) {
  const p = ctx.profile;
  if (!p) return;
  const levels = p.badges || {};
  const pins = p.pins || [];
  const golds = BADGES.filter((b) => (levels[b.id] || 0) >= LEVELS.length);
  const earned = BADGES.reduce((n, b) => n + (levels[b.id] || 0), 0);
  const stat = (k) => (p.stats?.[k] || 0).toLocaleString();

  el.innerHTML = `
    <section class="prof-head">
      <div class="prof-who">
        <b class="prof-name">${esc(ctx.name || '')}</b>
        <span class="prof-title">${p.title ? esc(t(BADGES_BY_ID[p.title].title)) : esc(t('No title yet'))}</span>
        <span class="prof-pins">${pins.map((id) => medalHtml(BADGES_BY_ID[id], levels[id] || 0, 'small')).join('')}</span>
      </div>
      <div class="prof-stats">
        <span><b>${stat('win')}</b><small>${esc(t('Wins'))}</small></span>
        <span><b>${stat('capture')}</b><small>${esc(t('Captures'))}</small></span>
        <span><b>${stat('six')}</b><small>${esc(t('Sixes'))}</small></span>
        <span><b>${earned}/${BADGES.length * LEVELS.length}</b><small>${esc(t('Badge levels'))}</small></span>
      </div>
    </section>
    <section class="prof-sec">
      <h3>${esc(t('Title'))}</h3>
      <p class="prof-note">${esc(golds.length ? t('Shown under your name in rooms and games.') : t('Get any badge to gold to unlock its title.'))}</p>
      <div class="prof-titles">
        <button type="button" class="chip${p.title ? '' : ' on'}" data-title="">${esc(t('No title'))}</button>
        ${golds.map((b) => `<button type="button" class="chip${p.title === b.id ? ' on' : ''}" data-title="${b.id}">${b.icon} ${esc(t(b.title))}</button>`).join('')}
      </div>
    </section>
    <section class="prof-sec">
      <h3>${esc(t('Badges'))}</h3>
      <p class="prof-note">${esc(t('Every level pays coins once. Pin up to {n} badges to show them beside your name.', { n: MAX_PINS }))}</p>
      <div class="badge-grid">${BADGES.map((b) => badgeCard(b, p, levels[b.id] || 0, pins.includes(b.id), ctx.fresh?.includes(b.id))).join('')}</div>
    </section>`;

  for (const btn of el.querySelectorAll('[data-title]')) btn.addEventListener('click', () => ctx.onTitle(btn.dataset.title));
  for (const btn of el.querySelectorAll('[data-pin]')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pin;
      const next = pins.includes(id) ? pins.filter((x) => x !== id) : [...pins, id];
      if (next.length > MAX_PINS) return ctx.onPinsFull?.();
      ctx.onPins(next);
    });
  }
}

function badgeCard(b, p, level, pinned, fresh) {
  const value = badgeValue(b, p);
  const maxed = level >= LEVELS.length;
  const goal = b.goals[Math.min(level, b.goals.length - 1)];
  const from = level ? b.goals[level - 1] : 0;
  const pct = maxed ? 100 : Math.max(0, Math.min(100, ((value - from) / (goal - from)) * 100));
  const next = maxed ? '' : `<span class="badge-reward"><span class="coin"></span>+${LEVELS[level].coins}</span>`;
  return `
    <div class="badge-card lv${level}${fresh ? ' is-new' : ''}">${fresh ? `<span class="badge-new">${esc(t('New'))}</span>` : ''}
      ${medalHtml(b, level)}
      <div class="badge-main">
        <div class="badge-top">
          <b>${esc(t(b.name))}</b>
          <span class="badge-level">${level ? esc(t(LEVEL_NAMES[level - 1])) : ''}</span>
        </div>
        <small>${esc(t(b.desc, { n: goal.toLocaleString() }))}</small>
        <div class="badge-bar"><i style="width:${pct}%"></i></div>
        <div class="badge-foot"><span>${Math.min(value, goal).toLocaleString()} / ${goal.toLocaleString()}</span>${next}</div>
      </div>
      ${level ? `<button type="button" class="badge-pin${pinned ? ' on' : ''}" data-pin="${b.id}" aria-pressed="${pinned}" title="${esc(t(pinned ? 'Unpin' : 'Pin'))}" aria-label="${esc(t(pinned ? 'Unpin' : 'Pin'))}">📌</button>` : ''}
    </div>`;
}

// What's shown beside a player's name: their pinned medals and title
export function lookHtml(look) {
  if (!look || (!look.title && !look.pins?.length)) return '';
  const pins = (look.pins || []).filter((x) => BADGES_BY_ID[x.id]).map((x) => medalHtml(BADGES_BY_ID[x.id], x.level, 'tiny')).join('');
  const title = look.title && BADGES_BY_ID[look.title] ? `<span class="seat-title">${esc(t(BADGES_BY_ID[look.title].title))}</span>` : '';
  return `${pins}${title}`;
}

export { levelFor };

// The first-game walkthrough: four short cards the first time you are in a game, then never
// again (remembered on this device). "Skip" ends it at once.
import { t } from './i18n.js';

const KEY = 'ludo-tour-seen';
const STEPS = [
  ['🎲', 'Roll the dice when it is your turn. A 6 brings a token out of base, and gives you another roll.'],
  ['⚔️', "Land on another player's token to send it back to its base. Tokens on star squares are safe."],
  ['🏠', 'Bring all your tokens round the board and home to win.'],
  ['⭐', 'Your Level rises as you earn Badge medals (tap your name on the menu to view badges & titles).'],
  ['🎟️', 'Earn Battle Pass XP every day from logins and quests to unlock coins, gems and exclusive Pass items.'],
  ['🛍️', 'Playing earns coins. Spend them in the Shop, and tap "Try it" on anything to see it in action first.'],
];

let shown = false;

const seen = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false; // (no storage here: show it once per visit)
  }
};

export function maybeTour() {
  if (shown || seen()) return;
  shown = true;
  let i = 0;
  const el = document.createElement('div');
  el.className = 'modal-wrap tour';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="modal-card tour-card">
      <div class="tour-icon"></div>
      <h3 class="tour-title"></h3>
      <p class="tour-text"></p>
      <div class="tour-dots"></div>
      <div class="tour-row">
        <button type="button" class="btn small tour-skip"></button>
        <button type="button" class="btn primary tour-next"></button>
      </div>
    </div>`;
  const close = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* it will show again next visit */
    }
    el.remove();
  };
  const show = () => {
    const [icon, text] = STEPS[i];
    el.querySelector('.tour-icon').textContent = icon;
    el.querySelector('.tour-title').textContent = t('How to play');
    el.querySelector('.tour-text').textContent = t(text);
    el.querySelector('.tour-dots').innerHTML = STEPS.map((_, n) => `<i class="${n === i ? 'on' : ''}"></i>`).join('');
    el.querySelector('.tour-skip').textContent = t('Skip');
    el.querySelector('.tour-skip').classList.toggle('hidden', i === STEPS.length - 1);
    el.querySelector('.tour-next').textContent = t(i === STEPS.length - 1 ? 'Got it' : 'Next');
  };
  el.querySelector('.tour-skip').addEventListener('click', close);
  el.querySelector('.tour-next').addEventListener('click', () => (++i < STEPS.length ? show() : close()));
  document.body.appendChild(el);
  show();
}

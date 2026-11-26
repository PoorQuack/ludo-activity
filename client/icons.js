// Line icons for buttons and labels, in place of emoji (emoji look different on every phone).
// Same style as the dock icons: 24×24, 1.75 stroke, currentColor. Painted art (coins, gems,
// rewards) lives in /icons/*.webp instead.
const svg = (body) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  bot: svg('<rect x="4.5" y="8" width="15" height="11" rx="3" /><path d="M12 8V4.5" /><circle cx="12" cy="3.75" r="0.9" /><circle cx="9" cy="13" r="1.2" /><circle cx="15" cy="13" r="1.2" /><path d="M9.5 16.5h5" />'),
  flag: svg('<path d="M5.5 21V4" /><path d="M5.5 4.5h11l-2.25 4 2.25 4h-11" />'),
  leave: svg('<path d="M14 4.5H7a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 7 19.5h7" /><path d="M11 12h9.5M17.5 8.5 21 12l-3.5 3.5" />'),
  invite: svg('<circle cx="9.5" cy="8" r="3.5" /><path d="M3 19.5c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5" /><path d="M18.5 8v6M15.5 11h6" />'),
  globe: svg('<circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 3.5 5.3 3.5 8.5s-1 6.1-3.5 8.5c-2.5-2.4-3.5-5.3-3.5-8.5s1-6.1 3.5-8.5z" />'),
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V7.75a3.5 3.5 0 0 1 7 0v2.75" />'),
  bolt: svg('<path d="M13.5 2.5 5 13.5h6l-1 8 8.5-11h-6z" />'),
  crown: svg('<path d="M3.5 8.5 7.5 12 12 5l4.5 7 4-3.5-1.75 10H5.25z" /><path d="M5.5 21h13" />'),
  dice: svg('<rect x="4" y="4" width="16" height="16" rx="3.5" /><circle cx="8.75" cy="8.75" r="1.1" /><circle cx="15.25" cy="15.25" r="1.1" /><circle cx="12" cy="12" r="1.1" />'),
};

// "<icon> label" for a button or chip (label is escaped by the caller or plain text)
export const withIcon = (name, label) => `${ICONS[name] || ''}<span>${label}</span>`;

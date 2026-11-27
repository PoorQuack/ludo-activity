// @mentions in a chat box: type "@" and a short list of people pops up above the box; picking one
// writes "@Name " into the message. The box remembers who was picked (input._mentions), and on
// sending, mentionIds() gives the ids whose "@Name" is still in the text. The server checks them.

const MAX_SHOWN = 6;
const AT_QUERY = /(?:^|\s)@([^\s@]{0,24})$/; // "@que" just before the caret

// The people picked so far in this box: id -> name
const picked = (input) => (input._mentions ||= new Map());

// Writes "@Name " in place of the "@que" being typed (or at the caret), and remembers who it was
export function insertMention(input, { id, name }) {
  if (!id || !name) return;
  const caret = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, caret);
  const after = input.value.slice(caret);
  const m = AT_QUERY.exec(before);
  const start = m ? caret - m[1].length - 1 : caret;
  const lead = start > 0 && !/\s$/.test(input.value.slice(0, start)) ? ' ' : '';
  const tag = `${lead}@${name} `;
  const room = (input.maxLength > 0 ? input.maxLength : 1e9) - (input.value.length - (caret - start));
  if (tag.length > room) return; // no space left in the box
  input.value = input.value.slice(0, start) + tag + after.replace(/^ /, '');
  const pos = start + tag.length;
  input.setSelectionRange?.(pos, pos);
  picked(input).set(String(id), String(name));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// The ids picked in this box whose "@Name" is still in `text` (then the box forgets them)
export function mentionIds(input, text) {
  const low = String(text || '').toLowerCase();
  const ids = [...picked(input)].filter(([, name]) => low.includes(`@${name.toLowerCase()}`)).map(([id]) => id);
  picked(input).clear();
  return ids.slice(0, 5);
}

// candidates() -> [{ id, name }] who can be mentioned here right now (not you)
export function attachMentionPicker(input, candidates) {
  const host = input.closest('form')?.parentElement || input.parentElement;
  const pop = document.createElement('ul');
  pop.className = 'mention-pop hidden';
  pop.setAttribute('role', 'listbox');
  host.appendChild(pop);
  let items = [];
  let active = 0;
  const close = () => {
    pop.classList.add('hidden');
    items = [];
  };
  const choose = (i) => {
    const c = items[i];
    close();
    if (c) insertMention(input, c);
  };
  const paint = () => {
    pop.replaceChildren(
      ...items.map((c, i) => {
        const li = document.createElement('li');
        li.className = `mention-opt${i === active ? ' on' : ''}`;
        li.setAttribute('role', 'option');
        li.textContent = `@${c.name}`;
        // pointerdown, not click: the box keeps the focus, so a phone keyboard stays up
        li.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          choose(i);
        });
        return li;
      }),
    );
    pop.classList.toggle('hidden', !items.length);
  };
  const update = () => {
    const caret = input.selectionStart ?? input.value.length;
    const m = AT_QUERY.exec(input.value.slice(0, caret));
    if (!m) return close();
    const q = m[1].toLowerCase();
    const seen = new Set();
    const list = [];
    for (const c of candidates() || []) {
      if (!c?.id || !c.name || seen.has(c.id)) continue;
      seen.add(c.id);
      const n = c.name.toLowerCase();
      if (!q || n.includes(q)) list.push({ ...c, rank: n.startsWith(q) ? 0 : 1 });
    }
    items = list.sort((a, b) => a.rank - b.rank).slice(0, MAX_SHOWN);
    active = 0;
    paint();
  };
  input.addEventListener('input', update);
  input.addEventListener('click', update);
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (pop.classList.contains('hidden') || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      paint();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation(); // Enter picks the name; it doesn't send the message
      choose(active);
    } else if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      close();
    }
  }, true);
  return { close };
}

// Hold someone's picture in a chat to mention them (a short tap still opens their profile)
export function holdToMention(el, who, input) {
  let timer = null;
  let fired = false;
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !input || input.disabled) return;
    fired = false;
    cancel();
    timer = setTimeout(() => {
      fired = true;
      navigator.vibrate?.(15);
      input.focus({ preventScroll: true });
      input.setSelectionRange?.(input.value.length, input.value.length);
      insertMention(input, who);
    }, 450);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, cancel);
  el.addEventListener('contextmenu', (e) => e.preventDefault()); // (a long press on a phone)
  // the click that ends a hold doesn't also open their profile
  el.addEventListener('click', (e) => {
    if (!fired) return;
    fired = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);
}

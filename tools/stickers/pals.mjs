// Our own sticker characters, drawn here as SVG. Nothing is copied or traced: the hamster, the
// fox and the kitty are designs made for this game, so the packs are ours to sell.
// Rendered like brainrot.mjs:  node render.mjs <out dir> ./pals.mjs   then pack.py.
// Each `svg(t)` gets t in 0..1 across the loop (only stickers with `frames` move).

const INK = '#2a1838';
const TAU = Math.PI * 2;
const sin = (t, k = 1, ph = 0) => Math.sin((t * k + ph) * TAU);

// The white sticker border (and a soft shadow) around everything
const DEFS = `<defs>
  <filter id="sticker" x="-20%" y="-20%" width="140%" height="140%">
    <feMorphology in="SourceAlpha" operator="dilate" radius="5" result="d"/>
    <feFlood flood-color="#ffffff"/><feComposite in2="d" operator="in" result="w"/>
    <feGaussianBlur in="d" stdDeviation="3" result="s"/><feOffset in="s" dy="3" result="so"/>
    <feFlood flood-color="#000" flood-opacity="0.35"/><feComposite in2="so" operator="in" result="sh"/>
    <feMerge><feMergeNode in="sh"/><feMergeNode in="w"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>`;
const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="192" height="192">${DEFS}<g filter="url(#sticker)"><g transform="translate(100 102) scale(0.87) translate(-100 -102)">${inner}</g></g></svg>`;

const line = (w = 4.5) => `fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const edge = (w = 4.5) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

// ---------- faces ----------
// Eyes, `dx` either side of cx. s scales them (the kitty's are bigger than the hamster's).
function eyes(kind = 'open', { cx = 100, cy = 100, dx = 28, s = 1, t = 0 } = {}) {
  const L = cx - dx;
  const R = cx + dx;
  const both = (f) => f(L, -1) + f(R, 1);
  const ball = (x, rx = 10, ry = 13) => `<ellipse cx="${x}" cy="${cy}" rx="${rx * s}" ry="${ry * s}" fill="${INK}"/>`;
  const glint = (x, r = 3.6, ox = -3, oy = -5) => `<circle cx="${x + ox * s}" cy="${cy + oy * s}" r="${r * s}" fill="#fff"/>`;
  const white = (x, rx = 13, ry = 15) => `<ellipse cx="${x}" cy="${cy}" rx="${rx * s}" ry="${ry * s}" fill="#fff" ${edge(3.5)}/>`;
  const arc = (x, up, w = 11, h = 11) => `<path d="M${x - w * s} ${cy + (up ? 4 : -3) * s} q${w * s} ${(up ? -h : h) * s} ${2 * w * s} 0" ${line(5)}/>`;
  const brow = (x, side, inner, outer, w = 5) => `<path d="M${x - side * 13 * s} ${cy + outer * s} L${x + side * 11 * s} ${cy + inner * s}" ${line(w)}/>`;
  switch (kind) {
    case 'happy': // ^ ^
      return both((x) => arc(x, true));
    case 'closed': // asleep, content
      return both((x) => arc(x, false, 11, 9));
    case 'wink':
      return ball(L) + glint(L) + arc(R, true);
    case 'wide': // startled: whites showing all round
      return both((x) => white(x, 15, 17) + `<circle cx="${x}" cy="${cy}" r="${5.5 * s}" fill="${INK}"/>`);
    case 'tiny': // shocked: pinprick pupils
      return both((x) => white(x, 15, 17) + `<circle cx="${x}" cy="${cy}" r="${2.6 * s}" fill="${INK}"/>`);
    case 'shiny': // pleading
      return both((x) => `<ellipse cx="${x}" cy="${cy + 1}" rx="${14 * s}" ry="${16 * s}" fill="${INK}"/><circle cx="${x - 4 * s}" cy="${cy - 6 * s}" r="${5.5 * s}" fill="#fff"/><circle cx="${x + 5 * s}" cy="${cy + 6 * s}" r="${3 * s}" fill="#fff"/><path d="M${x - 9 * s} ${cy + 10 * s} q${9 * s} ${6 * s} ${18 * s} 0" fill="none" stroke="#8fd3ff" stroke-width="${2.5 * s}" stroke-linecap="round"/>`) + brow(L, -1, -20, -15, 4) + brow(R, 1, -20, -15, 4);
    case 'squint': // > <
      return `<path d="M${L - 10 * s} ${cy - 9 * s} L${L + 8 * s} ${cy} L${L - 10 * s} ${cy + 9 * s}" ${line(5)}/><path d="M${R + 10 * s} ${cy - 9 * s} L${R - 8 * s} ${cy} L${R + 10 * s} ${cy + 9 * s}" ${line(5)}/>`;
    case 'half': // tired, half-shut
      return both((x) => `<path d="M${x - 11 * s} ${cy} a${11 * s} ${11 * s} 0 0 0 ${22 * s} 0z" fill="${INK}"/><path d="M${x - 13 * s} ${cy} h${26 * s}" ${line(4.5)}/>`);
    case 'flat': // unimpressed
      return both((x) => `<path d="M${x - 12 * s} ${cy - 1 * s} h${24 * s}" ${line(5)}/><circle cx="${x + 2 * s}" cy="${cy + 5 * s}" r="${4 * s}" fill="${INK}"/>`);
    case 'sad':
      return both((x) => ball(x, 9, 11) + glint(x, 3, -2, -3)) + brow(L, -1, -21, -14, 4.5) + brow(R, 1, -21, -14, 4.5);
    case 'cry': // shut tight, tears streaming
      return both((x) => arc(x, false, 11, 8)) + brow(L, -1, -17, -11, 4.5) + brow(R, 1, -17, -11, 4.5) +
        both((x, side) => `<path d="M${x - 6 * s} ${cy + 6 * s} q${-3 * side} ${22 * s} ${1 * side} ${40 * s} q${10 * s} 0 ${11 * s} ${-40 * s}z" fill="#7fd4ff" ${edge(2.5)}/>`);
    case 'joy': // laughing so hard it's crying
      return both((x) => arc(x, true, 12, 12)) + both((x, side) => `<path d="M${x + side * 13 * s} ${cy + 1 * s} q${side * 12 * s} ${2 * s} ${side * 15 * s} ${14 * s} q${-side * 12 * s} ${3 * s} ${-side * 15 * s} ${-14 * s}z" fill="#7fd4ff" ${edge(2.5)}/>`);
    case 'angry':
      return both((x) => ball(x, 8, 9) + glint(x, 2.5, -2, -3)) + brow(L, -1, -6, -19, 6) + brow(R, 1, -6, -19, 6);
    case 'worried':
      return both((x) => white(x, 12, 14) + `<circle cx="${x}" cy="${cy + 2 * s}" r="${5 * s}" fill="${INK}"/>`) + brow(L, -1, -24, -17, 4.5) + brow(R, 1, -24, -17, 4.5);
    case 'side': { // looking sideways
      const o = 5 * s;
      return both((x) => white(x, 12, 14) + `<circle cx="${x + o}" cy="${cy + 1}" r="${5.5 * s}" fill="${INK}"/>`);
    }
    case 'smug':
      return both((x) => `<path d="M${x - 11 * s} ${cy - 1 * s} a${11 * s} ${10 * s} 0 0 0 ${22 * s} 0z" fill="${INK}"/><path d="M${x - 13 * s} ${cy - 1 * s} h${26 * s}" ${line(4.5)}/>`) + `<path d="M${L - 12 * s} ${cy - 15 * s} q${11 * s} ${-5 * s} ${22 * s} 0" ${line(4.5)}/><path d="M${R - 10 * s} ${cy - 20 * s} q${11 * s} ${-7 * s} ${22 * s} ${2 * s}" ${line(4.5)}/>`;
    case 'evil': // narrowed, plotting
      return both((x, side) => `<path d="M${x - side * 14 * s} ${cy - 9 * s} L${x + side * 12 * s} ${cy - 2 * s} q${-side * 10 * s} ${14 * s} ${-side * 24 * s} ${6 * s}z" fill="#fff" ${edge(3.5)}/><circle cx="${x + side * 1 * s}" cy="${cy + 1 * s}" r="${4 * s}" fill="${INK}"/>`);
    case 'heart':
      return both((x) => `<path d="M${x} ${cy + 12 * s} C${x - 19 * s} ${cy} ${x - 13 * s} ${cy - 17 * s} ${x} ${cy - 6 * s} C${x + 13 * s} ${cy - 17 * s} ${x + 19 * s} ${cy} ${x} ${cy + 12 * s}z" fill="#ff3d7f" ${edge(3)}/>`);
    case 'star':
      return both((x) => `<path d="M${x} ${cy - 15 * s} l${4 * s} ${10 * s} l${11 * s} ${1 * s} l${-8 * s} ${7 * s} l${3 * s} ${11 * s} l${-10 * s} ${-6 * s} l${-10 * s} ${6 * s} l${3 * s} ${-11 * s} l${-8 * s} ${-7 * s} l${11 * s} ${-1 * s}z" fill="#ffd23f" ${edge(3)}/>`);
    case 'hollow': // despair: empty sockets
      return both((x) => `<ellipse cx="${x}" cy="${cy + 2 * s}" rx="${11 * s}" ry="${15 * s}" fill="${INK}"/>`) + brow(L, -1, -24, -16, 4.5) + brow(R, 1, -24, -16, 4.5);
    case 'dizzy': { // spirals
      const sp = (x) => `<path d="M${x} ${cy} m0 0 a3 3 0 1 1 ${-5 * s} ${-3 * s} a8 8 0 1 1 ${11 * s} ${7 * s} a13 13 0 1 1 ${-17 * s} ${-12 * s}" ${line(3.5)}/>`;
      return sp(L) + sp(R);
    }
    case 'skull':
      return both((x) => `<ellipse cx="${x}" cy="${cy}" rx="${13 * s}" ry="${15 * s}" fill="${INK}"/><circle cx="${x}" cy="${cy}" r="${3.5 * s}" fill="#ff5a6a"/>`);
    case 'blink': { // open, shutting now and then
      const shut = t % 1 > 0.86;
      return shut ? both((x) => arc(x, false, 11, 3)) : both((x) => ball(x) + glint(x));
    }
    default:
      return both((x) => ball(x) + glint(x));
  }
}

// Mouths, centred under the nose at (cx, cy)
function mouth(kind = 'smile', { cx = 100, cy = 140, s = 1 } = {}) {
  const k = (v) => v * s;
  const tongue = (y, w = 9) => `<path d="M${cx - k(w)} ${cy + k(y)} q${k(w)} ${k(-8)} ${k(2 * w)} 0 q${k(-w)} ${k(9)} ${k(-2 * w)} 0z" fill="#ff7aa0"/>`;
  switch (kind) {
    case 'cat': // :3
      return `<path d="M${cx - k(15)} ${cy - k(1)} q${k(7.5)} ${k(11)} ${k(15)} 0 q${k(7.5)} ${k(11)} ${k(15)} 0" ${line(4.5)}/>`;
    case 'grin': // open, teeth along the top
      return `<path d="M${cx - k(20)} ${cy - k(4)} q${k(20)} ${k(5)} ${k(40)} 0 q${k(-3)} ${k(24)} ${k(-20)} ${k(24)} q${k(-17)} 0 ${k(-20)} ${k(-24)}z" fill="#7a1f3d" ${edge(4)}/><path d="M${cx - k(15)} ${cy - k(0.5)} q${k(15)} ${k(3)} ${k(30)} 0 l${k(-1)} ${k(5)} q${k(-14)} ${k(3)} ${k(-28)} 0z" fill="#fff"/>` + tongue(15);
    case 'laugh': // wide open
      return `<path d="M${cx - k(24)} ${cy - k(7)} q${k(24)} ${k(7)} ${k(48)} 0 q${k(-2)} ${k(34)} ${k(-24)} ${k(34)} q${k(-22)} 0 ${k(-24)} ${k(-34)}z" fill="#7a1f3d" ${edge(4)}/><path d="M${cx - k(18)} ${cy - k(3)} q${k(18)} ${k(4)} ${k(36)} 0 l${k(-1.5)} ${k(6)} q${k(-16.5)} ${k(3)} ${k(-33)} 0z" fill="#fff"/>` + tongue(21, 11);
    case 'bleh': // tongue out
      return `<path d="M${cx - k(15)} ${cy - k(2)} q${k(15)} ${k(10)} ${k(30)} 0" ${line(4.5)}/><path d="M${cx - k(8)} ${cy + k(3)} v${k(11)} a${k(8)} ${k(8)} 0 0 0 ${k(16)} 0 v${k(-11)}z" fill="#ff7aa0" ${edge(3.5)}/><path d="M${cx} ${cy + k(6)} v${k(9)}" ${line(2.5)}/>`;
    case 'o':
      return `<ellipse cx="${cx}" cy="${cy + k(5)}" rx="${k(7)}" ry="${k(9)}" fill="#7a1f3d" ${edge(4)}/>`;
    case 'gasp':
      return `<ellipse cx="${cx}" cy="${cy + k(9)}" rx="${k(12)}" ry="${k(16)}" fill="#7a1f3d" ${edge(4)}/>` + tongue(19, 7);
    case 'yawn':
      return `<ellipse cx="${cx}" cy="${cy + k(10)}" rx="${k(17)}" ry="${k(21)}" fill="#7a1f3d" ${edge(4)}/><path d="M${cx - k(11)} ${cy - k(5)} l${k(4)} ${k(8)} l${k(4)} ${k(-10)} M${cx + k(11)} ${cy - k(5)} l${k(-4)} ${k(8)} l${k(-4)} ${k(-10)}" fill="#fff" stroke="#fff" stroke-width="1"/>` + tongue(25, 10);
    case 'flat':
      return `<path d="M${cx - k(11)} ${cy + k(3)} h${k(22)}" ${line(4.5)}/>`;
    case 'frown':
      return `<path d="M${cx - k(13)} ${cy + k(9)} q${k(13)} ${k(-13)} ${k(26)} 0" ${line(4.5)}/>`;
    case 'wobble': // trying not to cry
      return `<path d="M${cx - k(15)} ${cy + k(5)} q${k(3.75)} ${k(-7)} ${k(7.5)} 0 t${k(7.5)} 0 t${k(7.5)} 0 t${k(7.5)} 0" ${line(4.5)}/>`;
    case 'grit': // teeth clenched
      return `<path d="M${cx - k(19)} ${cy - k(3)} h${k(38)} q${k(3)} ${k(8)} 0 ${k(16)} h${k(-38)} q${k(-3)} ${k(-8)} 0 ${k(-16)}z" fill="#fff" ${edge(4)}/><path d="M${cx - k(19)} ${cy + k(5)} h${k(38)} M${cx - k(9)} ${cy - k(3)} v${k(16)} M${cx} ${cy - k(3)} v${k(16)} M${cx + k(9)} ${cy - k(3)} v${k(16)}" ${line(2.2)}/>`;
    case 'smirk':
      return `<path d="M${cx - k(12)} ${cy + k(4)} q${k(14)} ${k(5)} ${k(22)} ${k(-8)}" ${line(4.5)}/>`;
    case 'kiss':
      return `<path d="M${cx - k(3)} ${cy - k(3)} q${k(11)} ${k(4)} 0 ${k(8)} q${k(11)} ${k(4)} 0 ${k(8)}" ${line(4.5)}/>`;
    case 'fangs': // a wicked grin
      return `<path d="M${cx - k(26)} ${cy - k(6)} q${k(26)} ${k(12)} ${k(52)} 0 q${k(-6)} ${k(24)} ${k(-26)} ${k(24)} q${k(-20)} 0 ${k(-26)} ${k(-24)}z" fill="#7a1f3d" ${edge(4)}/><path d="M${cx - k(17)} ${cy - k(1)} l${k(5)} ${k(11)} l${k(5)} ${k(-8)} M${cx + k(17)} ${cy - k(1)} l${k(-5)} ${k(11)} l${k(-5)} ${k(-8)}" fill="#fff" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>`;
    case 'buck': // the hamster's teeth
      return `<path d="M${cx - k(13)} ${cy - k(2)} q${k(6.5)} ${k(8)} ${k(13)} 0 q${k(6.5)} ${k(8)} ${k(13)} 0" ${line(4.5)}/><path d="M${cx - k(6)} ${cy + k(3)} h${k(12)} v${k(9)} q${k(-6)} ${k(3)} ${k(-12)} 0z" fill="#fff" ${edge(3)}/><path d="M${cx} ${cy + k(3)} v${k(10)}" ${line(2)}/>`;
    case 'drool':
      return `<path d="M${cx - k(14)} ${cy - k(1)} q${k(14)} ${k(17)} ${k(28)} 0z" fill="#7a1f3d" ${edge(4)}/><path d="M${cx + k(7)} ${cy + k(5)} q${k(-4)} ${k(20)} ${k(3)} ${k(24)} q${k(7)} ${k(-4)} ${k(3)} ${k(-24)}z" fill="#8fd9ff" ${edge(2.5)}/>`;
    case 'ew': // tongue out, disgusted
      return `<path d="M${cx - k(16)} ${cy + k(6)} q${k(8)} ${k(-10)} ${k(16)} ${k(-2)} q${k(8)} ${k(-8)} ${k(16)} ${k(2)}" ${line(4.5)}/><path d="M${cx - k(5)} ${cy + k(3)} q${k(-2)} ${k(14)} ${k(7)} ${k(15)} q${k(8)} ${k(-2)} ${k(5)} ${k(-15)}z" fill="#9fdc6a" ${edge(3)}/>`;
    default:
      return `<path d="M${cx - k(14)} ${cy - k(1)} q${k(14)} ${k(14)} ${k(28)} 0" ${line(4.5)}/>`;
  }
}

// ---------- bits and pieces ----------
const blush = (cx, cy, dx, r = 9) => `<ellipse cx="${cx - dx}" cy="${cy}" rx="${r}" ry="${r * 0.6}" fill="#ff7aa0" opacity=".5"/><ellipse cx="${cx + dx}" cy="${cy}" rx="${r}" ry="${r * 0.6}" fill="#ff7aa0" opacity=".5"/>`;
const sweat = (x, y, r = 1) => `<path d="M${x} ${y} q${-9 * r} ${14 * r} 0 ${19 * r} q${9 * r} ${-5 * r} 0 ${-19 * r}z" fill="#8fd9ff" ${edge(3)}/>`;
const sparkle = (x, y, r, fill = '#ffe14d') => `<path d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}z" fill="${fill}" ${edge(2.5)}/>`;
const heart = (x, y, r, fill = '#ff3d7f') => `<path d="M${x} ${y + r} C${x - r * 1.6} ${y} ${x - r * 1.1} ${y - r * 1.4} ${x} ${y - r * 0.5} C${x + r * 1.1} ${y - r * 1.4} ${x + r * 1.6} ${y} ${x} ${y + r}z" fill="${fill}" ${edge(3)}/>`;
const vein = (x, y, r = 1) => `<path d="M${x - 9 * r} ${y - 3 * r} q${6 * r} 0 ${6 * r} ${-6 * r} M${x + 9 * r} ${y - 3 * r} q${-6 * r} 0 ${-6 * r} ${-6 * r} M${x - 9 * r} ${y + 3 * r} q${6 * r} 0 ${6 * r} ${6 * r} M${x + 9 * r} ${y + 3 * r} q${-6 * r} 0 ${-6 * r} ${6 * r}" fill="none" stroke="#ff3b4e" stroke-width="${4.5 * r}" stroke-linecap="round"/>`;
const zed = (x, y, size, rot = -10) => `<text x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y})" font-family="'Arial Black', Arial, sans-serif" font-weight="900" font-size="${size}" fill="#8fd3ff" stroke="${INK}" stroke-width="${size / 5}" stroke-linejoin="round" paint-order="stroke">Z</text>`;
const mark = (ch, x, y, size, fill = '#ffe14d', rot = 8) => `<text x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y})" text-anchor="middle" font-family="'Arial Black', Arial, sans-serif" font-weight="900" font-size="${size}" fill="${fill}" stroke="${INK}" stroke-width="${size / 5.5}" stroke-linejoin="round" paint-order="stroke">${ch}</text>`;
const CONFETTI = ['#ff5ca8', '#3fd8a4', '#ffd23f', '#5aa8ff', '#b07bff'];
function confetti(t, n = 12, top = 6, bottom = 150) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = 14 + ((i * 53) % 172);
    const y = top + ((((i * 37) % 100) / 100 + t) % 1) * (bottom - top);
    out += `<rect x="${x - 5}" y="${y - 2.5}" width="10" height="5" rx="2" transform="rotate(${(i * 47 + t * 360) % 360} ${x} ${y})" fill="${CONFETTI[i % 5]}" stroke="${INK}" stroke-width="2"/>`;
  }
  return out;
}
const partyHat = (x, y, rot = -14, s = 1) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M-22 0 L0 -50 L22 0z" fill="#b07bff" ${edge(4)}/><path d="M-14 -18 L10 -27 M-19 -5 L17 -12" stroke="#ffd23f" stroke-width="5"/><circle cx="0" cy="-52" r="8" fill="#ff5ca8" ${edge(3.5)}/></g>`;

// ---------- the hamster ----------
// A round golden hamster with a cream belly and stuffed cheeks. `fur`/`belly` recolour it,
// `arms`: 'down', 'up' (both raised) or 'cheeks' (paws on its cheeks). dy drops it, rot tilts it.
function hamster({ face = {}, arms = 'down', under = '', over = '', fur = '#f4b455', belly = '#fff3dc', ear = '#ffb3c1', dy = 0, rot = 0, dx = 0 } = {}) {
  const paw = (x, y, r = 0) => `<ellipse cx="${x}" cy="${y}" rx="11" ry="9" transform="rotate(${r} ${x} ${y})" fill="${belly}" ${edge(4)}/>`;
  const hands = arms === 'up' ? paw(34, 96, -40) + paw(166, 96, 40) : arms === 'cheeks' ? paw(52, 128, 20) + paw(148, 128, -20) : arms === 'none' ? '' : paw(66, 152, 10) + paw(134, 152, -10);
  return `<g transform="translate(${dx} ${dy}) rotate(${rot} 100 120)">
    ${under}
    <circle cx="52" cy="58" r="17" fill="${fur}" ${edge()}/><circle cx="52" cy="59" r="8.5" fill="${ear}"/>
    <circle cx="148" cy="58" r="17" fill="${fur}" ${edge()}/><circle cx="148" cy="59" r="8.5" fill="${ear}"/>
    <ellipse cx="74" cy="182" rx="16" ry="8" fill="${ear}" ${edge(4)}/><ellipse cx="126" cy="182" rx="16" ry="8" fill="${ear}" ${edge(4)}/>
    <path d="M100 42 C146 42 172 76 174 116 C176 156 150 184 100 184 C50 184 24 156 26 116 C28 76 54 42 100 42Z" fill="${fur}" ${edge()}/>
    <path d="M100 96 C128 96 166 108 166 132 C164 160 138 178 100 178 C62 178 36 160 34 132 C34 108 72 96 100 96Z" fill="${belly}"/>
    <path d="M86 46 q14 12 28 0" fill="none" stroke="#d9913a" stroke-width="5" stroke-linecap="round" opacity=".7"/>
    ${blush(100, 128, 46, 11)}
    ${eyes(face.eyes, { cx: 100, cy: 98, dx: 27, s: 0.85, t: face.t })}
    <path d="M94 112 h12 q0 8 -6 8 q-6 0 -6 -8z" fill="#ff8fa6" ${edge(3)}/>
    ${mouth(face.mouth || 'buck', { cx: 100, cy: 124, s: 0.85 })}
    ${hands}
    ${over}
  </g>`;
}

// ---------- the fox ----------
// A fox's head: big dark-tipped ears, white cheek fur, a black nose.
function fox({ face = {}, under = '', over = '', rot = 0, dy = 0, fur = '#f5852b', tip = '#4b2a1e', white = '#fff6e8' } = {}) {
  const earL = `<path d="M26 92 L34 14 L92 54z" fill="${fur}" ${edge()}/><path d="M35 15 L32 48 L58 31z" fill="${tip}"/><path d="M42 78 L44 40 L74 58z" fill="${white}"/>`;
  return `<g transform="translate(0 ${dy}) rotate(${rot} 100 110)">
    ${under}
    ${earL}<g transform="translate(200 0) scale(-1 1)">${earL}</g>
    <path d="M100 46 C138 46 168 70 172 104 L192 124 L168 134 C158 160 130 176 100 176 C70 176 42 160 32 134 L8 124 L28 104 C32 70 62 46 100 46Z" fill="${fur}" ${edge()}/>
    <path d="M100 100 C112 116 142 114 170 130 C158 158 130 173 100 173 C70 173 42 158 30 130 C58 114 88 116 100 100Z" fill="${white}"/>
    <path d="M90 52 q10 10 20 0" fill="none" stroke="#c9601a" stroke-width="5" stroke-linecap="round" opacity=".7"/>
    ${blush(100, 128, 48, 10)}
    ${eyes(face.eyes, { cx: 100, cy: 100, dx: 30, s: 1, t: face.t })}
    <path d="M89 126 h22 q0 12 -11 12 q-11 0 -11 -12z" fill="${INK}"/><ellipse cx="96" cy="129" rx="4" ry="2" fill="#fff" opacity=".6"/>
    ${mouth(face.mouth || 'cat', { cx: 100, cy: 144, s: 0.9 })}
    ${over}
  </g>`;
}

// ---------- the kitty ----------
// A round grey tabby: three stripes on the forehead, a cream muzzle, a pink nose, whiskers.
function kitty({ face = {}, under = '', over = '', rot = 0, dy = 0, fur = '#aeb6d6', stripe = '#7f88ad', muzzle = '#fff6ee', ear = '#ffb3c1' } = {}) {
  const earL = `<path d="M30 88 L38 22 L92 56z" fill="${fur}" ${edge()}/><path d="M44 74 L47 40 L76 58z" fill="${ear}"/>`;
  const whisk = `<path d="M34 122 L6 114 M34 132 L6 138" ${line(3.5)}/>`;
  return `<g transform="translate(0 ${dy}) rotate(${rot} 100 112)">
    ${under}
    ${earL}<g transform="translate(200 0) scale(-1 1)">${earL}</g>
    <path d="M100 48 C148 48 180 78 180 116 C180 154 146 178 100 178 C54 178 20 154 20 116 C20 78 52 48 100 48Z" fill="${fur}" ${edge()}/>
    <path d="M100 52 v20 M82 54 l4 16 M118 54 l-4 16" fill="none" stroke="${stripe}" stroke-width="7" stroke-linecap="round"/>
    <path d="M24 104 l16 4 M22 120 l14 0 M176 104 l-16 4 M178 120 l-14 0" fill="none" stroke="${stripe}" stroke-width="6" stroke-linecap="round"/>
    <ellipse cx="100" cy="142" rx="38" ry="27" fill="${muzzle}"/>
    ${blush(100, 132, 54, 11)}
    ${whisk}<g transform="translate(200 0) scale(-1 1)">${whisk}</g>
    ${eyes(face.eyes, { cx: 100, cy: 104, dx: 32, s: 1.08, t: face.t })}
    <path d="M92 126 h16 q0 9 -8 9 q-8 0 -8 -9z" fill="#ff8fa6" ${edge(3)}/>
    ${mouth(face.mouth || 'cat', { cx: 100, cy: 142, s: 0.9 })}
    ${over}
  </g>`;
}
// The kitty's paw, pads up
const kittyPaw = (x, y, s = 1, rot = 0, fur = '#aeb6d6') => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
  <path d="M-34 60 C-40 20 -44 -6 -30 -26 C-18 -44 18 -44 30 -26 C44 -6 40 20 34 60z" fill="${fur}" ${edge()}/>
  <ellipse cx="0" cy="8" rx="17" ry="14" fill="#ff8fa6" ${edge(3.5)}/>
  <ellipse cx="-21" cy="-12" rx="7.5" ry="9" fill="#ff8fa6" ${edge(3)}/><ellipse cx="-7" cy="-24" rx="7.5" ry="9" fill="#ff8fa6" ${edge(3)}/><ellipse cx="8" cy="-24" rx="7.5" ry="9" fill="#ff8fa6" ${edge(3)}/><ellipse cx="22" cy="-12" rx="7.5" ry="9" fill="#ff8fa6" ${edge(3)}/>
</g>`;

const still = (inner) => () => inner;

export const PACKS = {
  hamster: {
    stickers: [
      { slug: 'thumbsup', svg: still(hamster({ face: { eyes: 'wink', mouth: 'grin' }, arms: 'none', over: `<ellipse cx="62" cy="152" rx="11" ry="9" fill="#fff3dc" ${edge(4)}/><path d="M132 128 q-4 -22 6 -34 q9 -4 10 6 l-2 14 h14 q10 2 8 12 l-4 20 q-3 8 -12 8 h-16 q-8 -4 -4 -26z" fill="#fff3dc" ${edge(4)}/><path d="M146 128 h18 M146 140 h17" ${line(3)}/>` })) },
      { slug: 'bonk', svg: still(hamster({ face: { eyes: 'angry', mouth: 'grit' }, arms: 'none', dx: -12, over: `<ellipse cx="62" cy="152" rx="11" ry="9" fill="#fff3dc" ${edge(4)}/><g transform="rotate(28 150 110)"><rect x="143" y="70" width="12" height="82" rx="5" fill="#c98a4a" ${edge(4)}/><rect x="120" y="34" width="58" height="42" rx="10" fill="#ff6b6b" ${edge(4.5)}/><path d="M132 44 h34" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".6"/></g><ellipse cx="140" cy="146" rx="12" ry="10" fill="#fff3dc" ${edge(4)}/>${vein(40, 44)}` })) },
      { slug: 'celebrate', frames: 16, svg: (t) => hamster({ face: { eyes: 'happy', mouth: 'laugh' }, arms: 'up', dy: 6 - 6 * Math.abs(sin(t, 1)), under: confetti(t), over: partyHat(104, 50, -10, 0.85) }) },
      { slug: 'chef', svg: still(hamster({ face: { eyes: 'happy', mouth: 'smile' }, dy: 12, arms: 'none', over: `<path d="M64 46 q-22 -6 -14 -26 q8 -16 26 -8 q8 -16 26 -12 q16 -4 24 12 q20 -6 26 10 q6 18 -14 24 l-3 16 h-68z" fill="#fff" ${edge(4.5)}/><path d="M68 50 h64" ${line(3)}/><ellipse cx="62" cy="152" rx="11" ry="9" fill="#fff3dc" ${edge(4)}/><path d="M150 96 v46" stroke="#c98a4a" stroke-width="8" stroke-linecap="round"/><path d="M150 96 v46" ${line(0)}/><ellipse cx="150" cy="86" rx="13" ry="17" fill="#e9eef5" ${edge(4)}/><ellipse cx="146" cy="148" rx="12" ry="10" fill="#fff3dc" ${edge(4)}/>` })) },
      { slug: 'goodnight', svg: still(hamster({ face: { eyes: 'closed', mouth: 'smile' }, dy: 10, over: `<path d="M50 62 C52 26 104 16 150 50 C128 46 84 50 50 62z" fill="#6f7de0" ${edge(4.5)}/><path d="M150 50 q26 4 30 30" ${line(4.5)}/><circle cx="181" cy="86" r="10" fill="#fff" ${edge(4)}/><path d="M72 44 l8 6 M96 34 l6 8 M122 36 l4 9" stroke="#ffd23f" stroke-width="5" stroke-linecap="round"/><path d="M26 34 a18 18 0 1 0 22 22 a14 14 0 0 1 -22 -22z" fill="#ffe14d" ${edge(3.5)}/>` })) },
      { slug: 'despair', svg: still(hamster({ face: { eyes: 'hollow', mouth: 'gasp' }, arms: 'cheeks', fur: '#e9c48a', over: `<path d="M150 30 v22 M164 34 v16 M136 34 v16" stroke="#7f88ad" stroke-width="5" stroke-linecap="round"/>` })) },
      { slug: 'drool', svg: still(hamster({ face: { eyes: 'star', mouth: 'drool' }, arms: 'none', over: `<ellipse cx="62" cy="152" rx="11" ry="9" fill="#fff3dc" ${edge(4)}/><ellipse cx="138" cy="152" rx="11" ry="9" fill="#fff3dc" ${edge(4)}/><g transform="translate(158 46) rotate(24)"><path d="M0 -24 C16 -8 16 14 0 24 C-16 14 -16 -8 0 -24z" fill="#3a3340" ${edge(4)}/><path d="M-5 -12 q-4 12 0 24 M5 -12 q4 12 0 24" stroke="#f3ead8" stroke-width="3.5" stroke-linecap="round" fill="none"/></g>` })) },
      { slug: 'shock', frames: 12, svg: (t) => hamster({ face: { eyes: 'tiny', mouth: 'gasp' }, arms: 'up', dx: 3 * sin(t, 4), over: `<path d="M22 44 l14 12 M14 78 l18 2 M178 44 l-14 12 M186 78 l-18 2" stroke="#ffe14d" stroke-width="6" stroke-linecap="round" opacity="${0.5 + 0.5 * sin(t, 2)}"/>` }) },
      { slug: 'happy', svg: still(hamster({ face: { eyes: 'happy', mouth: 'grin' }, arms: 'up', over: heart(30, 44, 10) + heart(172, 40, 8) })) },
      { slug: 'oxygen', svg: still(hamster({ face: { eyes: 'half', mouth: 'flat' }, fur: '#e9c48a', over: `<path d="M68 108 q32 -14 64 0 q6 26 -32 40 q-38 -14 -32 -40z" fill="#bfe9ff" fill-opacity=".8" ${edge(4)}/><path d="M78 116 q10 -6 18 -6" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M68 112 q-22 -8 -34 -22 M132 112 q22 -8 34 -22" ${line(4)}/><path d="M100 148 q4 22 34 26 q30 2 44 -10" fill="none" stroke="#7fc4e8" stroke-width="7" stroke-linecap="round"/>${sweat(160, 42)}` })) },
      { slug: 'princess', svg: still(hamster({ face: { eyes: 'shiny', mouth: 'smile' }, dy: 8, over: `<path d="M62 46 L56 12 L80 30 L100 4 L120 30 L144 12 L138 46z" fill="#ffd23f" ${edge(4.5)}/><circle cx="100" cy="30" r="6" fill="#ff5ca8" ${edge(3)}/><circle cx="74" cy="36" r="4" fill="#5aa8ff" ${edge(2.5)}/><circle cx="126" cy="36" r="4" fill="#5aa8ff" ${edge(2.5)}/>${sparkle(24, 62, 11)}${sparkle(178, 70, 9)}` })) },
      { slug: 'shocked', svg: still(hamster({ face: { eyes: 'wide', mouth: 'o' }, over: mark('!', 164, 50, 50, '#ff5a6a', 12) })) },
      { slug: 'skeleton', svg: still(hamster({ face: { eyes: 'skull', mouth: 'grit' }, fur: '#f1f1f4', belly: '#f1f1f4', ear: '#d6d6de', over: `<path d="M100 150 v26 M84 156 q16 -8 32 0 M82 166 q18 -8 36 0 M86 176 q14 -6 28 0" ${line(3.5)}/>` })) },
      { slug: 'sleepy', frames: 16, svg: (t) => hamster({ face: { eyes: 'closed', mouth: 'o' }, dy: 8 + 2 * sin(t), over: `<g opacity="${0.4 + 0.6 * Math.abs(sin(t, 0.5))}">${zed(150, 52 - 6 * t, 30)}${zed(170, 28 - 6 * t, 20)}</g>` }) },
    ],
  },
  fox: {
    stickers: [
      { slug: 'happy', svg: still(fox({ face: { eyes: 'happy', mouth: 'grin' } })) },
      { slug: 'grin', svg: still(fox({ face: { eyes: 'open', mouth: 'laugh' } })) },
      { slug: 'wink', svg: still(fox({ face: { eyes: 'wink', mouth: 'smirk' }, rot: -5, over: sparkle(170, 50, 12) })) },
      { slug: 'bleh', svg: still(fox({ face: { eyes: 'squint', mouth: 'bleh' } })) },
      { slug: 'wide-eyed', svg: still(fox({ face: { eyes: 'wide', mouth: 'flat' } })) },
      { slug: 'surprised', svg: still(fox({ face: { eyes: 'tiny', mouth: 'gasp' }, over: mark('!', 172, 44, 44, '#ff5a6a', 14) })) },
      { slug: 'pleading', svg: still(fox({ face: { eyes: 'shiny', mouth: 'wobble' } })) },
      { slug: 'hungry', svg: still(fox({ face: { eyes: 'star', mouth: 'drool' } })) },
      { slug: 'yawn', svg: still(fox({ face: { eyes: 'closed', mouth: 'yawn' }, over: `<path d="M150 104 q8 8 4 14 q-8 0 -4 -14z" fill="#8fd9ff" ${edge(2.5)}/>` })) },
      { slug: 'exhausted', svg: still(fox({ face: { eyes: 'half', mouth: 'frown' }, rot: 4, over: sweat(168, 60) + `<path d="M70 118 q8 5 16 0 M114 118 q8 5 16 0" fill="none" stroke="#7f6aa0" stroke-width="3.5" stroke-linecap="round" opacity=".7"/>` })) },
      { slug: 'squint', svg: still(fox({ face: { eyes: 'evil', mouth: 'flat' } })) },
      { slug: 'unimpressed', svg: still(fox({ face: { eyes: 'flat', mouth: 'flat' } })) },
      { slug: 'nervous', svg: still(fox({ face: { eyes: 'worried', mouth: 'grit' }, over: sweat(166, 54) + sweat(30, 70, 0.8) })) },
      { slug: 'worried', svg: still(fox({ face: { eyes: 'worried', mouth: 'wobble' } })) },
      { slug: 'wince', svg: still(fox({ face: { eyes: 'squint', mouth: 'grit' }, over: `<path d="M158 30 l8 14 l-14 0 l8 14" fill="none" stroke="#ffe14d" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` })) },
      { slug: 'sad', svg: still(fox({ face: { eyes: 'sad', mouth: 'frown' }, dy: 4 })) },
      { slug: 'cry', svg: still(fox({ face: { eyes: 'cry', mouth: 'gasp' } })) },
      { slug: 'shout', svg: still(fox({ face: { eyes: 'angry', mouth: 'laugh' }, over: `<path d="M14 40 l14 10 M6 70 l16 2 M186 40 l-14 10 M194 70 l-16 2" stroke="#ff5a6a" stroke-width="6" stroke-linecap="round"/>` })) },
      { slug: 'angry', svg: still(fox({ face: { eyes: 'angry', mouth: 'frown' }, fur: '#f06a2a', over: vein(162, 56, 1.2) })) },
      // the Laugh pack's fox stickers
      { slug: 'rofl', frames: 12, svg: (t) => fox({ face: { eyes: 'joy', mouth: 'laugh' }, rot: -24 + 5 * sin(t, 2), dy: 3 * sin(t, 2, 0.25) }) },
      { slug: 'lol', svg: still(fox({ face: { eyes: 'joy', mouth: 'grin' } })) },
      { slug: 'haha', frames: 10, svg: (t) => fox({ face: { eyes: 'squint', mouth: 'laugh' }, dy: 4 * Math.abs(sin(t, 1)), over: mark('HA', 34, 40 - 3 * sin(t), 26, '#ffe14d', -14) + mark('HA', 170, 34 + 3 * sin(t), 22, '#ffe14d', 12) }) },
      { slug: 'hehe', svg: still(fox({ face: { eyes: 'happy', mouth: 'smile' }, rot: 5, over: `<path d="M70 178 C64 152 74 134 96 136 C120 134 130 152 124 178z" fill="#4b2a1e" ${edge()}/><path d="M84 144 v11 M97 140 v13 M110 144 v11" fill="none" stroke="#8a5a44" stroke-width="3.5" stroke-linecap="round"/>` })) },
      { slug: 'smug', svg: still(fox({ face: { eyes: 'smug', mouth: 'smirk' }, rot: -6 })) },
    ],
  },
  kitty: {
    stickers: [
      { slug: 'happy', svg: still(kitty({ face: { eyes: 'happy', mouth: 'cat' } })) },
      { slug: 'smile', svg: still(kitty({ face: { eyes: 'open', mouth: 'smile' } })) },
      { slug: 'excited', svg: still(kitty({ face: { eyes: 'star', mouth: 'grin' }, over: sparkle(22, 40, 11) + sparkle(180, 44, 13) })) },
      { slug: 'wink', svg: still(kitty({ face: { eyes: 'wink', mouth: 'cat' }, rot: 5, over: heart(172, 44, 10) })) },
      { slug: 'relaxed', svg: still(kitty({ face: { eyes: 'closed', mouth: 'cat' }, dy: 4, over: `<path d="M156 40 q10 -10 0 -18 M172 44 q10 -10 0 -18" fill="none" stroke="#ffb3c1" stroke-width="5" stroke-linecap="round"/>` })) },
      { slug: 'stare', svg: still(kitty({ face: { eyes: 'tiny', mouth: 'flat' } })) },
      { slug: 'paw', svg: still(kittyPaw(100, 106, 1.5, -6)) },
      { slug: 'cute', svg: still(kitty({ face: { eyes: 'shiny', mouth: 'cat' }, over: heart(100, 30, 9) })) },
      { slug: 'kiss', svg: still(kitty({ face: { eyes: 'closed', mouth: 'kiss' }, over: heart(168, 122, 12) + heart(186, 96, 7) })) },
      { slug: 'huh', svg: still(kitty({ face: { eyes: 'side', mouth: 'o' }, rot: -8, over: mark('?', 170, 52, 50, '#8fd3ff', 14) })) },
      { slug: 'shocked', svg: still(kitty({ face: { eyes: 'wide', mouth: 'gasp' }, over: `<path d="M22 34 l12 12 M10 62 l16 4 M178 34 l-12 12 M190 62 l-16 4" stroke="#ffe14d" stroke-width="6" stroke-linecap="round"/>` })) },
      { slug: 'ew', svg: still(kitty({ face: { eyes: 'evil', mouth: 'ew' }, fur: '#b3c4b8', stripe: '#7f9a8a' })) },
      { slug: 'sad', svg: still(kitty({ face: { eyes: 'sad', mouth: 'wobble' }, dy: 4, over: `<path d="M62 124 q-8 12 0 18 q8 -6 0 -18z" fill="#8fd9ff" ${edge(2.5)}/>` })) },
      { slug: 'mad', svg: still(kitty({ face: { eyes: 'angry', mouth: 'frown' }, over: vein(166, 52, 1.2) })) },
      // the Laugh pack's kitty stickers
      { slug: 'pbbt', svg: still(kitty({ face: { eyes: 'wink', mouth: 'bleh' }, rot: 6 })) },
      { slug: 'mwahaha', svg: still(kitty({ face: { eyes: 'evil', mouth: 'fangs' }, fur: '#8f86c9', stripe: '#665c9c', over: `<path d="M40 30 l10 12 M160 30 l-10 12" stroke="#b07bff" stroke-width="6" stroke-linecap="round"/>` })) },
      { slug: 'party', frames: 16, svg: (t) => kitty({ face: { eyes: 'happy', mouth: 'laugh' }, dy: 10 - 4 * Math.abs(sin(t, 1)), under: confetti(t, 10, 4, 120), over: partyHat(104, 58, -12, 0.9) }) },
    ],
  },
};

export const svgFor = (sticker, t = 0) => wrap(sticker.svg(t));

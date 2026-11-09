// Original "brainrot" stickers, drawn here as SVG (nothing copied: our own pawn and dice
// characters, short meme phrases). render.mjs turns each into a 192px PNG, or an animated WebP
// for the ones with `frames`. Each `svg(t)` gets t in 0..1 across the loop.

const INK = '#241336';
const FONT = "'Arial Black', 'Arial Bold', Arial, sans-serif";
const TAU = Math.PI * 2;

// The white sticker border (and a soft shadow) around everything
const DEFS = `<defs>
  <filter id="sticker" x="-20%" y="-20%" width="140%" height="140%">
    <feMorphology in="SourceAlpha" operator="dilate" radius="5" result="d"/>
    <feFlood flood-color="#ffffff"/><feComposite in2="d" operator="in" result="w"/>
    <feGaussianBlur in="d" stdDeviation="3" result="s"/><feOffset in="s" dy="3" result="so"/>
    <feFlood flood-color="#000" flood-opacity="0.35"/><feComposite in2="so" operator="in" result="sh"/>
    <feMerge><feMergeNode in="sh"/><feMergeNode in="w"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <radialGradient id="shine" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></radialGradient>
</defs>`;

const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="192" height="192">${DEFS}<g filter="url(#sticker)">${inner}</g></svg>`;

// Big outlined meme text, shrunk to fit the width
function label(text, { y = 182, size = 36, fill = '#ffe14d', rot = -4, x = 100, max = 188 } = {}) {
  const fit = Math.min(size, max / (text.length * 0.66));
  return `<text x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y})" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="${fit.toFixed(1)}" fill="${fill}" stroke="${INK}" stroke-width="${(fit / 4.5).toFixed(1)}" stroke-linejoin="round" paint-order="stroke">${text}</text>`;
}

// ---------- faces (centred on cx, cy) ----------
function eyes(kind, cx, cy, t = 0) {
  const L = cx - 15, R = cx + 15;
  const white = (x, rx = 9, ry = 11) => `<ellipse cx="${x}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" stroke="${INK}" stroke-width="3.5"/>`;
  const pupil = (x, dx = 0, dy = 0, r = 5) => `<circle cx="${x + dx}" cy="${cy + dy}" r="${r}" fill="${INK}"/><circle cx="${x + dx - 1.6}" cy="${cy + dy - 2}" r="1.6" fill="#fff"/>`;
  switch (kind) {
    case 'shades':
      return `<path d="M${cx - 30} ${cy - 8} h26 q3 0 3 3 v6 q0 9 -10 9 h-10 q-11 0 -12 -10 z M${cx + 30} ${cy - 8} h-26 q-3 0 -3 3 v6 q0 9 10 9 h10 q11 0 12 -10 z" fill="${INK}"/><path d="M${cx - 4} ${cy - 6} h8" stroke="${INK}" stroke-width="4"/><path d="M${cx - 25} ${cy - 4} l7 0" stroke="#8fd3ff" stroke-width="3" stroke-linecap="round"/><path d="M${cx + 10} ${cy - 4} l7 0" stroke="#8fd3ff" stroke-width="3" stroke-linecap="round"/>`;
    case 'sad':
      return white(L) + white(R) + pupil(L, 0, 4) + pupil(R, 0, 4) + `<path d="M${L - 9} ${cy - 15} L${L + 7} ${cy - 11} M${R + 9} ${cy - 15} L${R - 7} ${cy - 11}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
    case 'cry':
      return `<path d="M${L - 8} ${cy} q8 7 16 0 M${R - 8} ${cy} q8 7 16 0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M${L - 9} ${cy - 12} L${L + 7} ${cy - 8} M${R + 9} ${cy - 12} L${R - 7} ${cy - 8}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M${L - 4} ${cy + 5} q-5 18 -2 34 q8 0 7 -34z M${R + 4} ${cy + 5} q5 18 2 34 q-8 0 -7 -34z" fill="#7fd4ff" stroke="${INK}" stroke-width="2.5"/>`;
    case 'smug':
      return white(L, 9, 9) + white(R, 9, 9) + pupil(L, 2, 2, 4.5) + pupil(R, 2, 2, 4.5) + `<path d="M${L - 10} ${cy - 1} h20 M${R - 10} ${cy - 1} h20" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M${L - 9} ${cy - 13} q9 -4 17 0 M${R - 8} ${cy - 17} q9 -6 17 2" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
    case 'stern':
      return `<path d="M${L - 10} ${cy - 2} h20 v6 h-20z M${R - 10} ${cy - 2} h20 v6 h-20z" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="${L + 2}" cy="${cy + 1}" r="2.6" fill="${INK}"/><circle cx="${R - 2}" cy="${cy + 1}" r="2.6" fill="${INK}"/><path d="M${L - 12} ${cy - 13} L${L + 10} ${cy - 5} M${R + 12} ${cy - 13} L${R - 10} ${cy - 5}" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`;
    case 'happy':
      return `<path d="M${L - 8} ${cy + 3} q8 -12 16 0 M${R - 8} ${cy + 3} q8 -12 16 0" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`;
    case 'heart': {
      const h = (x) => `<path d="M${x} ${cy + 9} C${x - 15} ${cy - 1} ${x - 10} ${cy - 15} ${x} ${cy - 6} C${x + 10} ${cy - 15} ${x + 15} ${cy - 1} ${x} ${cy + 9}z" fill="#ff3d7f" stroke="${INK}" stroke-width="3"/>`;
      return h(L) + h(R);
    }
    case 'wink':
      return white(L) + pupil(L, 1, 1) + `<path d="M${R - 9} ${cy + 1} q9 -9 18 0" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`;
    case 'blank':
      return `<circle cx="${L}" cy="${cy}" r="4" fill="${INK}"/><circle cx="${R}" cy="${cy}" r="4" fill="${INK}"/>`;
    case 'side': {
      const dx = 5 * Math.sin(t * TAU);
      return white(L) + white(R) + pupil(L, dx, 1) + pupil(R, dx, 1) + `<path d="M${L - 10} ${cy - 2} h20" stroke="${INK}" stroke-width="3.5"/><path d="M${R - 9} ${cy - 18} q9 -6 18 0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
    }
    case 'angry':
      return white(L, 8, 8) + white(R, 8, 8) + pupil(L, 1, 1, 4) + pupil(R, -1, 1, 4) + `<path d="M${L - 11} ${cy - 14} L${L + 9} ${cy - 5} M${R + 11} ${cy - 14} L${R - 9} ${cy - 5}" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>`;
    case 'worried':
      return white(L) + white(R) + pupil(L, 0, 2, 4) + pupil(R, 0, 2, 4) + `<path d="M${L - 8} ${cy - 12} L${L + 8} ${cy - 17} M${R + 8} ${cy - 12} L${R - 8} ${cy - 17}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
    default:
      return white(L) + white(R) + pupil(L) + pupil(R);
  }
}

function mouth(kind, cx, cy) {
  const s = `fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"`;
  switch (kind) {
    case 'grin':
      return `<path d="M${cx - 15} ${cy - 3} q15 3 30 0 q-2 17 -15 17 q-13 0 -15 -17z" fill="#7a1f3d" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M${cx - 12} ${cy - 1} h24 v4 h-24z" fill="#fff"/><path d="M${cx - 6} ${cy + 10} q6 -5 12 0 q-6 5 -12 0z" fill="#ff7aa0"/>`;
    case 'frown':
      return `<path d="M${cx - 11} ${cy + 6} q11 -11 22 0" ${s}/>`;
    case 'wavy':
      return `<path d="M${cx - 14} ${cy + 2} q3.5 -6 7 0 t7 0 t7 0 t7 0" ${s}/>`;
    case 'smirk':
      return `<path d="M${cx - 10} ${cy + 2} q12 3 18 -7" ${s}/>`;
    case 'flat':
      return `<path d="M${cx - 9} ${cy} h18" ${s}/>`;
    case 'o':
      return `<ellipse cx="${cx}" cy="${cy + 2}" rx="6" ry="8" fill="#7a1f3d" stroke="${INK}" stroke-width="3.5"/>`;
    case 'teeth':
      return `<path d="M${cx - 16} ${cy - 5} h32 v12 h-32z" fill="#fff" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M${cx - 16} ${cy + 1} h32 M${cx - 8} ${cy - 5} v12 M${cx} ${cy - 5} v12 M${cx + 8} ${cy - 5} v12" stroke="${INK}" stroke-width="2"/>`;
    default:
      return `<path d="M${cx - 12} ${cy - 2} q12 12 24 0" ${s}/>`;
  }
}

// ---------- characters ----------
// The Ludo pawn mascot. dy: move it down; sq: squash (1 = normal)
function pawn({ color, dark, face = {}, dy = 0, sq = 1, under = '', over = '' }) {
  const st = `stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"`;
  return `<g transform="translate(0 ${dy}) translate(100 168) scale(${2 - sq} ${sq}) translate(-100 -168)">
    ${under}
    <rect x="44" y="150" width="112" height="20" rx="10" fill="${dark}" ${st}/>
    <path d="M70 98 C72 122 60 140 52 152 L148 152 C140 140 128 122 130 98 Z" fill="${color}" ${st}/>
    <path d="M70 98 C72 122 60 140 52 152 L148 152 C140 140 128 122 130 98 Z" fill="url(#shine)"/>
    <ellipse cx="100" cy="98" rx="35" ry="9" fill="${dark}" ${st}/>
    <circle cx="100" cy="62" r="37" fill="${color}" ${st}/>
    <circle cx="100" cy="62" r="37" fill="url(#shine)"/>
    <ellipse cx="80" cy="76" rx="7" ry="4" fill="#ff7aa0" opacity=".55"/><ellipse cx="120" cy="76" rx="7" ry="4" fill="#ff7aa0" opacity=".55"/>
    ${eyes(face.eyes, 100, 58, face.t)}${mouth(face.mouth, 100, 80)}
    ${over}
  </g>`;
}

// The dice character: a rounded die with a face and two pips
function die({ color = '#ffffff', pip = '#ff4d6d', face = {}, dx = 0, dy = 0, rot = 0, under = '', over = '' }) {
  const st = `stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"`;
  return `<g transform="translate(${dx} ${dy}) rotate(${rot} 100 105)">
    ${under}
    <rect x="50" y="52" width="108" height="108" rx="24" fill="#00000033" transform="translate(6 7)"/>
    <rect x="46" y="48" width="108" height="108" rx="24" fill="${color}" ${st}/>
    <rect x="46" y="48" width="108" height="108" rx="24" fill="url(#shine)"/>
    <circle cx="68" cy="69" r="7" fill="${pip}"/><circle cx="132" cy="135" r="7" fill="${pip}"/>
    <ellipse cx="74" cy="118" rx="8" ry="4.5" fill="#ff7aa0" opacity=".5"/><ellipse cx="126" cy="118" rx="8" ry="4.5" fill="#ff7aa0" opacity=".5"/>
    ${eyes(face.eyes, 100, 98, face.t)}${mouth(face.mouth, 100, 122)}
    ${over}
  </g>`;
}

const sparkle = (x, y, r, fill = '#fff6a8') => `<path d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}z" fill="${fill}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`;
const steam = (x, y, t, k) => {
  const p = (t + k) % 1;
  return `<path d="M${x} ${y - p * 40} q-8 -8 0 -16 q8 -8 0 -16" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity="${(1 - p).toFixed(2)}"/><path d="M${x} ${y - p * 40} q-8 -8 0 -16 q8 -8 0 -16" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" opacity="${(0.6 * (1 - p)).toFixed(2)}"/>`;
};

export const PACKS = {
  brainrot: {
    name: 'Brainrot pack',
    stickers: [
      {
        slug: 'aura-plus', name: '+1000 aura', frames: 24,
        svg: (t) => {
          const rays = Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * TAU + t * TAU / 6;
            const x1 = 100 + Math.cos(a) * 30, y1 = 70 + Math.sin(a) * 30, x2 = 100 + Math.cos(a + 0.13) * 96, y2 = 70 + Math.sin(a + 0.13) * 96, x3 = 100 + Math.cos(a - 0.13) * 96, y3 = 70 + Math.sin(a - 0.13) * 96;
            return `<path d="M${x1} ${y1} L${x2} ${y2} L${x3} ${y3}z" fill="${i % 2 ? '#b388ff' : '#62e6ff'}" opacity=".85"/>`;
          }).join('');
          const pulse = 1 + 0.06 * Math.sin(t * TAU * 2);
          return `<g opacity=".95">${rays}</g><circle cx="100" cy="70" r="${(50 * pulse).toFixed(1)}" fill="#fff4b0" opacity=".45"/>` +
            pawn({ color: '#8b6cff', dark: '#5a3fd1', face: { eyes: 'shades', mouth: 'smirk' }, dy: -4 }) +
            `<g transform="translate(100 182) scale(${pulse.toFixed(3)}) translate(-100 -182)">${label('+1000 AURA', { fill: '#ffe14d' })}</g>`;
        },
      },
      {
        slug: 'aura-minus', name: '-1000 aura',
        svg: () => {
          const cloud = `<g><path d="M60 40 q-16 0 -16 -13 q0 -13 15 -13 q4 -12 18 -11 q10 -10 24 -3 q14 -6 22 6 q15 0 15 12 q0 14 -16 14z" fill="#6f7a96" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
            <path d="M68 46 l-4 10 M90 46 l-4 12 M112 46 l-4 10 M132 46 l-4 12" stroke="#7fd4ff" stroke-width="4" stroke-linecap="round"/></g>`;
          return pawn({ color: '#8c97b5', dark: '#5f6987', face: { eyes: 'sad', mouth: 'frown' }, dy: 6 }) + `<g transform="translate(0 -6)">${cloud}</g>` + label('-1000 AURA', { fill: '#ff5a5a', rot: 3 });
        },
      },
      {
        slug: 'cooked', name: 'Bro is cooked', frames: 24,
        svg: (t) => {
          const pan = `<ellipse cx="100" cy="160" rx="74" ry="18" fill="#3b3f4f" stroke="${INK}" stroke-width="4.5"/><path d="M168 156 l26 -10 q6 -2 7 4 l1 3 q1 5 -5 6 l-27 6z" fill="#7b4a2e" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><ellipse cx="100" cy="155" rx="64" ry="12" fill="#1f2230"/>`;
          const flames = [60, 82, 104, 126, 140].map((x, i) => {
            const h = 10 + 6 * Math.sin(t * TAU * 2 + i);
            return `<path d="M${x} 176 q-7 ${-h * 0.5} 0 ${-h} q7 ${h * 0.5} 0 ${h}z" fill="#ff8a1f" stroke="${INK}" stroke-width="2.5"/>`;
          }).join('');
          const wob = 1 + 0.03 * Math.sin(t * TAU * 3);
          return flames + pan + pawn({ color: '#ff7a3d', dark: '#d1501a', face: { eyes: 'worried', mouth: 'wavy' }, dy: -2, sq: wob }) +
            `<path d="M138 46 q6 8 0 14 q-6 -6 0 -14z" fill="#7fd4ff" stroke="${INK}" stroke-width="2.5"/>` +
            steam(60, 70, t, 0) + steam(140, 70, t, 0.5) + steam(100, 26, t, 0.25) + label('BRO IS COOKED', { y: 196, size: 30, fill: '#ffb03b', rot: -3 });
        },
      },
      {
        slug: 'skill-issue', name: 'Skill issue',
        svg: () => {
          const arm = `<path d="M134 118 q24 -6 34 -22" fill="none" stroke="${INK}" stroke-width="13" stroke-linecap="round"/><path d="M134 118 q24 -6 34 -22" fill="none" stroke="#22c7a9" stroke-width="7" stroke-linecap="round"/><circle cx="170" cy="93" r="9" fill="#22c7a9" stroke="${INK}" stroke-width="4"/><path d="M174 86 l9 -12" stroke="${INK}" stroke-width="9" stroke-linecap="round"/><path d="M174 86 l9 -12" stroke="#22c7a9" stroke-width="4" stroke-linecap="round"/>`;
          return pawn({ color: '#22c7a9', dark: '#118a75', face: { eyes: 'smug', mouth: 'smirk' }, dy: -4, over: '' }) + arm + label('SKILL ISSUE', { fill: '#7dffb2' });
        },
      },
      {
        slug: 'w', name: 'W', frames: 20,
        svg: (t) => {
          const tw = (k) => (0.55 + 0.45 * Math.abs(Math.sin((t + k) * Math.PI))).toFixed(2);
          return pawn({ color: '#2fd481', dark: '#1c9a5c', face: { eyes: 'happy', mouth: 'grin' }, dy: -10 }) +
            sparkle(32, 40, 14 * tw(0)) + sparkle(170, 30, 11 * tw(0.33)) + sparkle(172, 120, 12 * tw(0.66)) + sparkle(26, 128, 9 * tw(0.5)) +
            label('W', { size: 70, y: 196, fill: '#2fd481', rot: -6 });
        },
      },
      {
        slug: 'l', name: 'L',
        svg: () =>
          pawn({ color: '#4d8dff', dark: '#2a5fc8', face: { eyes: 'cry', mouth: 'frown' }, dy: -10 }) + label('L', { size: 70, y: 196, fill: '#ff4d4d', rot: 6 }),
      },
      {
        slug: 'no-cap', name: 'No cap',
        svg: () => {
          const cap = `<g transform="translate(150 50) rotate(12)"><path d="M-24 6 q0 -28 24 -28 q24 0 24 28z" fill="#ffd23f" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M14 6 h22 q4 0 2 5 l-2 2 h-36z" fill="#f2b100" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/></g><circle cx="152" cy="46" r="32" fill="none" stroke="#ff3b3b" stroke-width="8"/><path d="M130 24 l44 44" stroke="#ff3b3b" stroke-width="8" stroke-linecap="round"/>`;
          return pawn({ color: '#ff5d8f', dark: '#d13a6c', face: { eyes: 'normal', mouth: 'flat' }, dy: 2 }) + cap + label('NO CAP', { fill: '#ffffff', size: 40 });
        },
      },
      {
        slug: 'sigma', name: 'Sigma',
        svg: () =>
          `<text x="100" y="104" text-anchor="middle" font-family="Georgia, serif" font-weight="900" font-size="150" fill="#ffd23f" opacity=".9" stroke="${INK}" stroke-width="6" paint-order="stroke">Σ</text>` +
          pawn({ color: '#454b70', dark: '#2a2f4d', face: { eyes: 'stern', mouth: 'flat' }, dy: 0, over: `<path d="M76 84 L100 98 L124 84" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" opacity=".7"/>` }) +
          label('SIGMA', { fill: '#ffd23f', size: 40 }),
      },
    ],
  },
  dice: {
    name: 'Dice brainrot pack',
    stickers: [
      {
        slug: 'rigged', name: 'Rigged', frames: 16,
        svg: (t) => {
          const sh = Math.sin(t * TAU * 4) * 3;
          return die({ color: '#ffd6d6', pip: '#e0303c', face: { eyes: 'angry', mouth: 'teeth' }, dx: sh, rot: sh }) + steam(40, 70, t, 0) + steam(160, 70, t, 0.5) + label('RIGGED', { fill: '#ff4d4d', size: 44, rot: -6 });
        },
      },
      {
        slug: 'six-seven', name: '6 7', frames: 16,
        svg: (t) => {
          const a = Math.sin(t * TAU) * 14;
          const hand = (x, y, flip) => `<g transform="translate(${x} ${y}) scale(${flip} 1)"><path d="M0 0 q-20 -4 -26 -18" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><path d="M0 0 q-20 -4 -26 -18" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/><ellipse cx="-30" cy="-24" rx="15" ry="9" fill="#fff" stroke="${INK}" stroke-width="4"/></g>`;
          return die({ face: { eyes: 'normal', mouth: 'o' }, dy: 14, over: '' }) + hand(50, 128 + a, 1) + hand(150, 128 - a, -1) +
            `<g transform="translate(0 ${a.toFixed(1)})">${label('6', { x: 34, y: 60, size: 60, fill: '#ffd23f', rot: -8 })}</g><g transform="translate(0 ${(-a).toFixed(1)})">${label('7', { x: 166, y: 60, size: 60, fill: '#62e6ff', rot: 8 })}</g>`;
        },
      },
      {
        slug: 'sus', name: 'Sus', frames: 20,
        svg: (t) => die({ color: '#f1f1f6', pip: '#ff4d4d', face: { eyes: 'side', mouth: 'smirk', t } }) + label('SUS', { fill: '#ff4d4d', size: 50, y: 188, rot: 4 }),
      },
      {
        slug: 'touch-grass', name: 'Touch grass',
        svg: () => {
          const grass = Array.from({ length: 13 }, (_, i) => {
            const x = 34 + i * 11;
            return `<path d="M${x} 168 q${i % 2 ? 4 : -4} -14 ${i % 2 ? -2 : 3} -26 q6 12 6 26z" fill="${i % 3 ? '#4fd36a' : '#2fae4e'}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`;
          }).join('');
          const flower = `<circle cx="160" cy="138" r="5" fill="#ffd23f" stroke="${INK}" stroke-width="2"/>${[0, 1, 2, 3, 4].map((i) => `<circle cx="${160 + Math.cos(i * 1.256) * 9}" cy="${138 + Math.sin(i * 1.256) * 9}" r="5.5" fill="#fff" stroke="${INK}" stroke-width="2"/>`).join('')}<circle cx="160" cy="138" r="5" fill="#ffd23f" stroke="${INK}" stroke-width="2"/>`;
          return die({ color: '#e5ffe3', pip: '#2fae4e', face: { eyes: 'happy', mouth: 'smile' }, dy: -12 }) + grass + flower + label('TOUCH GRASS', { fill: '#7dff7a', y: 192 });
        },
      },
      {
        slug: 'its-giving', name: "It's giving", frames: 20,
        svg: (t) => {
          const tw = (k) => (0.5 + 0.5 * Math.abs(Math.sin((t + k) * Math.PI))).toFixed(2);
          return die({ color: '#ffd9ef', pip: '#ff5db1', face: { eyes: 'happy', mouth: 'grin' } }) + sparkle(30, 46, 14 * tw(0), '#ffffff') + sparkle(172, 40, 12 * tw(0.4), '#ffe0f5') + sparkle(176, 150, 10 * tw(0.7), '#ffffff') + label("IT'S GIVING", { fill: '#ff8fd0', y: 192 });
        },
      },
      {
        slug: 'gg-ez', name: 'GG EZ',
        svg: () => die({ color: '#d9f8ff', pip: '#14b8d6', face: { eyes: 'shades', mouth: 'grin' } }) + label('GG EZ', { fill: '#5ff2ff', size: 46, y: 190 }),
      },
      {
        slug: 'rizz', name: 'Rizz', frames: 20,
        svg: (t) => {
          const heart = (x, y, k, s) => {
            const p = (t + k) % 1;
            return `<path transform="translate(${x} ${y - p * 34}) scale(${s})" d="M0 9 C-15 -1 -10 -15 0 -6 C10 -15 15 -1 0 9z" fill="#ff3d7f" stroke="${INK}" stroke-width="3" opacity="${(1 - p).toFixed(2)}"/>`;
          };
          return die({ color: '#ffe3ea', pip: '#ff3d7f', face: { eyes: 'heart', mouth: 'smirk' } }) + heart(34, 70, 0, 1) + heart(168, 66, 0.5, 0.8) + heart(160, 40, 0.25, 0.6) + label('RIZZ', { fill: '#ff5d8f', size: 50, y: 190, rot: -5 });
        },
      },
      {
        slug: 'npc', name: 'NPC',
        svg: () =>
          die({ color: '#d4d8e2', pip: '#8a90a2', face: { eyes: 'blank', mouth: 'flat' } }) +
          `<g><path d="M128 16 h52 q8 0 8 8 v16 q0 8 -8 8 h-30 l-10 10 v-10 h-12 q-8 0 -8 -8 v-16 q0 -8 8 -8z" fill="#fff" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><circle cx="142" cy="32" r="3.5" fill="${INK}"/><circle cx="154" cy="32" r="3.5" fill="${INK}"/><circle cx="166" cy="32" r="3.5" fill="${INK}"/></g>` +
          label('NPC', { fill: '#eef1f7', size: 50, y: 190, rot: 0 }),
      },
    ],
  },
};

export const svgFor = (sticker, t = 0) => wrap(sticker.svg(t));

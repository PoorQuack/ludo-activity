// Background music and sound effects, made with the Web Audio API: no audio files to
// download and nothing copyrighted. Browsers only allow sound after the player has
// clicked or pressed a key, so everything starts on the first interaction.

const SETTINGS_KEY = 'ludo-audio';
const settings = { music: true, sound: true };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
} catch {
  // storage unavailable: keep the defaults
}

let ctx = null;
let musicGain = null;
let sfxGain = null;
let noiseBuffer = null;
let musicTimer = null;
let nextNote = 0;
let step = 0;

const MUSIC_VOLUME = 0.32;
const SFX_VOLUME = 0.5;

export function audioSettings() {
  return { ...settings };
}

// Call on the first click/keypress; safe to call again.
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const master = ctx.createGain();
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    sfxGain = ctx.createGain();
    musicGain.connect(master);
    sfxGain.connect(master);
    musicGain.gain.value = settings.music ? MUSIC_VOLUME : 0;
    sfxGain.gain.value = settings.sound ? SFX_VOLUME : 0;
    noiseBuffer = makeNoise();
  }
  if (ctx.state === 'suspended') ctx.resume();
  if (settings.music) startMusic();
}

export function setMusic(on) {
  settings.music = on;
  save();
  if (!ctx) return;
  musicGain.gain.setTargetAtTime(on ? MUSIC_VOLUME : 0, ctx.currentTime, 0.2);
  if (on) startMusic();
  else setTimeout(() => !settings.music && stopMusic(), 800);
}

export function setSound(on) {
  settings.sound = on;
  save();
  if (ctx) sfxGain.gain.setTargetAtTime(on ? SFX_VOLUME : 0, ctx.currentTime, 0.05);
}

function save() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // not saved: fine, it's only a preference
  }
}

// ---------------- music ----------------
// A calm loop: soft pad chords, a plucked arpeggio and a bass note, over Am – F – C – G.

const BEAT = 60 / 84; // seconds per beat
const CHORDS = [
  [57, 60, 64], // A minor
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];
const ARP = [0, 1, 2, 1, 0, 2, 1, null]; // eighth notes per bar; null = rest

function startMusic() {
  if (musicTimer || !ctx) return;
  nextNote = ctx.currentTime + 0.1;
  musicTimer = setInterval(scheduleMusic, 100);
}

function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
}

// Schedules the notes for the next ~300 ms, so timing stays steady.
function scheduleMusic() {
  while (nextNote < ctx.currentTime + 0.3) {
    const chord = CHORDS[Math.floor(step / 8) % CHORDS.length];
    const i = step % 8;
    if (i === 0) for (const n of chord) pad(n, nextNote, BEAT * 4);
    if (i % 4 === 0) bass(chord[0] - 12, nextNote);
    if (ARP[i] !== null) pluck(chord[ARP[i]] + 12, nextNote);
    nextNote += BEAT / 2;
    step++;
  }
}

function pad(note, t, len) {
  for (const detune of [-6, 6]) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.value = freq(note);
    osc.detune.value = detune;
    f.type = 'lowpass';
    f.frequency.value = 900;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.6);
    g.gain.setValueAtTime(0.05, t + len - 0.6);
    g.gain.linearRampToValueAtTime(0, t + len + 0.2);
    osc.connect(f).connect(g).connect(musicGain);
    osc.start(t);
    osc.stop(t + len + 0.3);
  }
}

function pluck(note, t) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq(note);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  osc.connect(g).connect(musicGain);
  osc.start(t);
  osc.stop(t + 0.5);
}

function bass(note, t) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq(note);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + BEAT * 1.8);
  osc.connect(g).connect(musicGain);
  osc.start(t);
  osc.stop(t + BEAT * 2);
}

// ---------------- sound effects ----------------

const EFFECTS = {
  // Dice rattling, then landing
  roll() {
    for (let i = 0; i < 6; i++) noise(now() + i * 0.075 + Math.random() * 0.02, 0.035, 1800 + Math.random() * 1500, 0.35);
  },
  land() {
    tone(150, now(), 0.16, 'sine', 0.5, 70);
    noise(now(), 0.03, 2500, 0.3);
  },
  // A pawn hopping one square
  step() {
    tone(880 + Math.random() * 60, now(), 0.05, 'sine', 0.12);
  },
  capture() {
    tone(620, now(), 0.35, 'sawtooth', 0.12, 110);
    noise(now(), 0.25, 900, 0.25);
  },
  home() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, now() + i * 0.08, 0.25, 'triangle', 0.25));
  },
  turn() {
    tone(660, now(), 0.12, 'sine', 0.25);
    tone(880, now() + 0.12, 0.18, 'sine', 0.25);
  },
  win() {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, now() + i * 0.12, 0.35, 'triangle', 0.25));
  },
  chat() {
    tone(1250, now(), 0.06, 'sine', 0.15);
  },
};

export function sfx(name) {
  if (!ctx || !settings.sound || ctx.state !== 'running') return;
  EFFECTS[name]?.();
}

function tone(f, t, len, type, vol, endFreq = null) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + len);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(g).connect(sfxGain);
  osc.start(t);
  osc.stop(t + len + 0.05);
}

function noise(t, len, center, vol) {
  const src = ctx.createBufferSource();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  src.buffer = noiseBuffer;
  f.type = 'bandpass';
  f.frequency.value = center;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f).connect(g).connect(sfxGain);
  src.start(t);
  src.stop(t + len + 0.02);
}

function makeNoise() {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

const now = () => ctx.currentTime;
const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);

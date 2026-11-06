// Background music and sound effects with the Web Audio API.
//
// Real recordings are used when they exist: list them in client/public/sounds/sounds.json,
// e.g. { "roll": "dice-roll.ogg", "step": "pin-tap.ogg", "music": "music.mp3" }.
// Anything not listed falls back to a sound generated here, so the game never goes quiet.
// Browsers only allow sound after the player has clicked or pressed a key, so everything
// starts on the first interaction.

const SETTINGS_KEY = 'ludo-audio';
const settings = { music: true, sound: true, emoteSounds: true, musicVolume: 0.5, soundVolume: 0.5, musicTrack: '' };
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  // Older versions had one volume for both: carry it over to each
  if (saved.volume !== undefined) {
    saved.musicVolume ??= saved.volume;
    saved.soundVolume ??= saved.volume;
    delete saved.volume;
  }
  // And a style instead of a track id.
  if (saved.musicStyle !== undefined) {
    saved.musicTrack ??= saved.musicStyle;
    delete saved.musicStyle;
  }
  Object.assign(settings, saved);
} catch {
  // storage unavailable: keep the defaults
}

let ctx = null;
let musicGain = null;
let sfxGain = null;
let noiseBuffer = null;
let musicTimer = null;
let musicEl = null; // the one <audio> element for music files (its src changes with the track)
let tracks = []; // the playlist from sounds.json: { id, label, title, artist, file }
let musicFileFailed = false; // the file wouldn't load: fall back to the generated loop
let nextNote = 0;
let step = 0;
const samples = {}; // effect name -> decoded AudioBuffer

const MUSIC_VOLUME = 0.6;
const SFX_VOLUME = 0.6;

export function audioSettings() {
  return { ...settings, tracks: tracks.map(({ id, label, title, artist }) => ({ id, label, title, artist })) };
}

function emitChange() {
  window.dispatchEvent(new Event('ludo-audio-change'));
}

// Call on the first click/keypress; safe to call again.
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    musicGain = ctx.createGain();
    sfxGain = ctx.createGain();
    musicGain.connect(ctx.destination);
    sfxGain.connect(ctx.destination);
    musicGain.gain.value = musicLevel();
    sfxGain.gain.value = soundLevel();
    noiseBuffer = makeNoise();
    loadFiles();
  }
  if (ctx.state === 'suspended') ctx.resume();
  if (settings.music) startMusic();
}

// How loud each part plays: its on/off switch times its slider.
const musicLevel = () => (settings.music ? MUSIC_VOLUME * settings.musicVolume : 0);
const soundLevel = () => (settings.sound ? SFX_VOLUME * settings.soundVolume : 0);

// The music or sound slider, 0..1.
export function setVolume(kind, v) {
  settings[kind === 'music' ? 'musicVolume' : 'soundVolume'] = Math.max(0, Math.min(1, v));
  save();
  if (!ctx) return;
  musicGain.gain.setTargetAtTime(musicLevel(), ctx.currentTime, 0.05);
  sfxGain.gain.setTargetAtTime(soundLevel(), ctx.currentTime, 0.05);
}

export function setMusic(on) {
  settings.music = on;
  save();
  if (ctx) {
    musicGain.gain.setTargetAtTime(musicLevel(), ctx.currentTime, 0.2);
    if (on) startMusic();
    else setTimeout(() => !settings.music && stopMusic(), 800);
  }
  emitChange();
}

// Loads the recordings listed in sounds/sounds.json, if there is one.
async function loadFiles() {
  let list;
  try {
    // no-store: an earlier build served this list with a week-long cache, so devices kept
    // playing removed sounds. Always ask the server for the current list.
    const res = await fetch('sounds/sounds.json', { cache: 'no-store' });
    if (!res.ok) return;
    list = await res.json();
  } catch {
    return; // no list: generated sounds only
  }
  for (const [name, file] of Object.entries(list)) {
    if (name === 'music') {
      // Preferred: an ordered playlist [{ id, label, title, artist, file }]. Still fine:
      // "one.mp3" for everyone, or { style: "file.mp3" } (id/label = the style key, title = file name).
      if (typeof file === 'string') tracks = [{ id: 'music', label: 'Music', title: file, artist: '', file: `sounds/${file}` }];
      else if (Array.isArray(file)) {
        tracks = file.map((t) => ({
          id: t.id || t.file,
          label: t.label || t.id || t.title || t.file,
          title: t.title || t.file,
          artist: t.artist || '',
          file: `sounds/${t.file}`,
        }));
      } else {
        tracks = Object.entries(file).map(([id, f]) => ({ id, label: id, title: f, artist: '', file: `sounds/${f}` }));
      }
      continue;
    }
    // A name can list several files; one is picked at random each time, for variety.
    const files = Array.isArray(file) ? file : [file];
    samples[name] = [];
    for (const f of files) {
      try {
        const data = await fetch(`sounds/${f}`).then((r) => r.arrayBuffer());
        samples[name].push(await ctx.decodeAudioData(data));
      } catch (err) {
        console.warn(`Could not load sound ${f}`, err);
      }
    }
  }
  if (tracks.length) loadTrack(currentTrack());
  window.dispatchEvent(new Event('ludo-audio-ready'));
  emitChange();
}

// The saved track — or the first one, when the saved id isn't in the playlist.
function currentTrack() {
  return tracks.find((t) => t.id === settings.musicTrack) || tracks[0];
}

// Points the one <audio> element at a track's file — only that file is ever loaded.
function loadTrack(track) {
  if (!track) return;
  if (!musicEl) {
    musicEl = new Audio();
    // A track loops so the mood stays — mood changes only happen when the player picks one.
    musicEl.loop = true;
    // A missing/broken file shouldn't leave the game silent: fall back to the generated loop.
    musicEl.addEventListener('error', () => {
      console.warn('Could not load music file, using generated music instead');
      musicFileFailed = true;
      stopMusic();
      if (settings.music) startMusic();
    });
    ctx.createMediaElementSource(musicEl).connect(musicGain);
  }
  settings.musicTrack = track.id;
  save();
  musicFileFailed = false;
  musicEl.src = track.file;
  stopMusic(); // swap the generated loop for the file
  if (settings.music) startMusic();
}

let trackSwitchTimer = null; // the pending swap: rapid taps only ever load the last pick

// Changes the track, fading out and back in (~0.6s) while music is playing.
export function playTrack(id) {
  const track = tracks.find((t) => t.id === id);
  if (!track || !ctx) return;
  // The selection changes now, even though the new file fades in a little later.
  settings.musicTrack = track.id;
  save();
  emitChange();
  clearTimeout(trackSwitchTimer);
  const swap = () => {
    trackSwitchTimer = null;
    loadTrack(track);
    musicGain.gain.setTargetAtTime(musicLevel(), ctx.currentTime, 0.2); // and in
    emitChange();
  };
  if (settings.music && musicEl && !musicEl.paused) {
    musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2); // ~0.6s out
    trackSwitchTimer = setTimeout(swap, 650);
  } else swap();
}

export function nextTrack() {
  if (tracks.length) playTrack(tracks[(tracks.indexOf(currentTrack()) + 1) % tracks.length].id);
}

export function prevTrack() {
  if (tracks.length) playTrack(tracks[(tracks.indexOf(currentTrack()) - 1 + tracks.length) % tracks.length].id);
}

// Sticker sounds (the Laugh pack) can be switched off on their own.
export function setEmoteSounds(on) {
  settings.emoteSounds = on;
  save();
}

export function setSound(on) {
  settings.sound = on;
  save();
  if (ctx) sfxGain.gain.setTargetAtTime(soundLevel(), ctx.currentTime, 0.05);
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
  if (!ctx) return;
  if (musicEl && !musicFileFailed) {
    musicEl.play().catch(() => {});
    return;
  }
  if (musicTimer) return;
  nextNote = ctx.currentTime + 0.1;
  musicTimer = setInterval(scheduleMusic, 100);
}

function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
  musicEl?.pause();
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
  // Your turn: a bright little three-note bell
  turn() {
    [784, 988, 1319].forEach((f, i) => {
      tone(f, now() + i * 0.09, 0.45, 'triangle', 0.34);
      tone(f * 2, now() + i * 0.09, 0.2, 'sine', 0.06);
    });
  },
  // Still your turn: a soft "ding-dong"
  nudge() {
    tone(988, now(), 0.5, 'triangle', 0.26);
    tone(784, now() + 0.22, 0.6, 'triangle', 0.26);
  },
  // Time nearly up: a quick tick-tock
  hurry() {
    for (let i = 0; i < 4; i++) tone(i % 2 ? 1100 : 1500, now() + i * 0.16, 0.06, 'square', 0.08);
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
  const recorded = samples[name];
  if (recorded?.length) playSample(recorded[Math.floor(Math.random() * recorded.length)], name === 'step');
  else EFFECTS[name]?.();
}

// ---------------- sticker sounds ----------------
// Laugh-pack stickers make a noise for everyone in the room. All generated here, no recordings.

const lastSticker = new Map(); // sender -> when their last sticker sound played

// `key` (the sender): each sender is heard at most every 2.5 s, so spamming doesn't stack up.
export function stickerSound(name, key) {
  if (!ctx || !settings.sound || !settings.emoteSounds || ctx.state !== 'running' || !STICKER_SOUNDS[name]) return;
  if (key !== undefined) {
    const t = performance.now();
    if (t - (lastSticker.get(key) || -1e9) < 2500) return;
    lastSticker.set(key, t);
  }
  STICKER_SOUNDS[name]();
}

const STICKER_SOUNDS = {
  // Big belly laugh, getting lower as it goes
  laugh() {
    let t = now();
    for (let i = 0; i < 7; i++) {
      const p = 290 - i * 14 + Math.random() * 20;
      ha(t, 0.13, p, p * 0.85, 1.3);
      t += 0.17 + Math.random() * 0.03;
    }
  },
  giggle() {
    let t = now();
    for (let i = 0; i < 9; i++) {
      const p = 520 - i * 12 + Math.random() * 30;
      ha(t, 0.08, p, p * 0.9, 1, [650, 1700]);
      t += 0.105;
    }
  },
  // "Ha-ha!" (pointing)
  haha() {
    ha(now(), 0.2, 270, 240, 1.4);
    ha(now() + 0.3, 0.34, 255, 185, 1.4);
  },
  honk() {
    for (const d of [0, 0.28]) for (const f of [330, 337]) tone(f, now() + d, 0.2, 'square', 0.1, f * 0.93);
  },
  // Wah wah wah waaah
  trombone() {
    let t = now();
    for (const [f, len] of [[196, 0.33], [185, 0.33], [175, 0.33], [165, 1.1]]) {
      brass(t, len, f, len > 0.5);
      t += len + 0.07;
    }
  },
  // "Mwa-ha-ha-ha-ha"
  evil() {
    let t = now();
    ha(t, 0.34, 140, 165, 1.4, [600, 1000]);
    t += 0.44;
    for (let i = 0; i < 5; i++) {
      ha(t, 0.15, 175 - i * 7, 150 - i * 7, 1.3, [650, 1050]);
      t += 0.19;
    }
  },
  raspberry() {
    const t = now();
    const len = 0.7;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.linearRampToValueAtTime(70, t + len);
    const flutter = ctx.createGain();
    flutter.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 28;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(flutter.gain);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = envelope(t, len, 0.5);
    osc.connect(flutter).connect(lp).connect(g).connect(sfxGain);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + len + 0.05);
    lfo.stop(t + len + 0.05);
    noise(t, len, 600, 0.2);
  },
  // A slap, then a long sigh
  facepalm() {
    const t = now();
    noise(t, 0.07, 2500, 1);
    noise(t, 0.12, 700, 0.6);
    tone(110, t, 0.15, 'sine', 0.5, 55);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(1200, t + 0.35);
    bp.frequency.exponentialRampToValueAtTime(380, t + 1.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    src.connect(bp).connect(g).connect(sfxGain);
    src.start(t + 0.35);
    src.stop(t + 1.35);
  },
};

// A gain that swells in, holds and fades out over `len`.
function envelope(t, len, vol) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
  g.gain.setValueAtTime(vol, t + len * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  return g;
}

// One "ha": a buzzy voice shaped like an "ah" (or another vowel), with a breathy "h" in front.
function ha(t, len, f0, f1, vol, vowel = [800, 1200]) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + len);
  const g = envelope(t, len, vol);
  for (const [fc, q, amp] of [[vowel[0], 5, 1], [vowel[1], 7, 0.7], [2600, 9, 0.25]]) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = fc;
    bp.Q.value = q;
    const a = ctx.createGain();
    a.gain.value = amp;
    osc.connect(bp).connect(a).connect(g);
  }
  g.connect(sfxGain);
  osc.start(t);
  osc.stop(t + len + 0.05);
  noise(t, 0.05, 1600, vol * 0.4);
}

// A trombone-ish note: a "wah" filter sweep, and a wobble that sags on the long last note.
function brass(t, len, f, wobble) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f, t);
  if (wobble) {
    osc.frequency.linearRampToValueAtTime(f * 0.94, t + len);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6;
    const d = ctx.createGain();
    d.gain.value = f * 0.03;
    lfo.connect(d).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + len + 0.05);
  }
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 4;
  lp.frequency.setValueAtTime(300, t);
  lp.frequency.linearRampToValueAtTime(1400, t + 0.12);
  lp.frequency.linearRampToValueAtTime(500, t + len);
  osc.connect(lp).connect(envelope(t, len, 0.35)).connect(sfxGain);
  osc.start(t);
  osc.stop(t + len + 0.05);
}

// `vary`: nudge the pitch a little so repeated taps don't sound identical.
function playSample(buffer, vary) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  if (vary) src.playbackRate.value = 0.92 + Math.random() * 0.16;
  src.connect(sfxGain);
  src.start();
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

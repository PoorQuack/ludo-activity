// Background music and sound effects with the Web Audio API.
//
// Real recordings are used when they exist: list them in client/public/sounds/sounds.json,
// e.g. { "roll": "dice-roll.ogg", "step": "pin-tap.ogg", "music": "music.mp3" }.
// Anything not listed falls back to a sound generated here, so the game never goes quiet.
// Browsers only allow sound after the player has clicked or pressed a key. Even then the sound
// engine (the AudioContext) only starts when something is about to play: just starting it makes
// phones pause other apps' audio (Spotify…), so with the music off it starts for a sound effect
// and goes back to sleep a few seconds later.

const SETTINGS_KEY = 'ludo-audio';
const settings = { music: true, sound: true, musicVolume: 0.5, soundVolume: 0.5, musicTrack: '' };
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
let activated = false; // the player has tapped or typed: sound is allowed from now on
let sleepTimer = null;
let sampleList = null; // sound effects listed in sounds.json, decoded once the engine starts
let musicGain = null;
let sfxGain = null;
let noiseBuffer = null;
let musicTimer = null;
let musicEl = null; // the one <audio> element for music files (its src changes with the track)
let tracks = []; // the genres from sounds.json: { id, label, songs: [{ title, artist, file }] }
let songIdx = 0; // which song of the current genre is playing
let musicFileFailed = false; // the file wouldn't load: fall back to the generated loop
let nextNote = 0;
let step = 0;
const samples = {}; // effect name -> decoded AudioBuffer

const MUSIC_VOLUME = 0.6;
const SFX_VOLUME = 0.6;

export function audioSettings() {
  const cur = currentTrack();
  const song = cur?.songs[songIdx % cur.songs.length];
  return {
    ...settings,
    // each genre, and the song playing now (title / artist of the current genre's song)
    tracks: tracks.map(({ id, label, songs }) => ({ id, label, songs: songs.length, title: songs[0].title, artist: songs[0].artist })),
    song: song ? { title: song.title, artist: song.artist, n: (songIdx % cur.songs.length) + 1, of: cur.songs.length } : null,
  };
}

function emitChange() {
  window.dispatchEvent(new Event('ludo-audio-change'));
}

// Call on the first click/keypress; safe to call again. Starts the music if it's on; with it
// off nothing starts here, so music from other apps keeps playing.
export function unlockAudio() {
  activated = true;
  if (!settings.music) return;
  if (!ensureCtx()) return;
  if (!musicEl?.getAttribute('src') && tracks.length) loadTrack(currentTrack());
  else startMusic();
}

// The sound engine, started (or woken) when something is about to play.
function ensureCtx() {
  if (!activated) return false;
  setAudioSession(); // before the engine starts: iPhones decide then whether it takes over audio
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    musicGain = ctx.createGain();
    sfxGain = ctx.createGain();
    musicGain.connect(ctx.destination);
    sfxGain.connect(ctx.destination);
    musicGain.gain.value = musicLevel();
    sfxGain.gain.value = soundLevel();
    noiseBuffer = makeNoise();
    decodeSamples();
  }
  clearTimeout(sleepTimer);
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

// iPhones (and browsers with the Audio Session API): with the game's music off, its sounds mix
// with other apps' audio instead of interrupting it.
function setAudioSession() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = settings.music ? 'playback' : 'ambient';
  } catch {
    // not supported here
  }
  // And don't show up as "now playing" (lock screen / Control Center) without music
  try {
    if (!settings.music && 'mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    }
  } catch {
    // not supported here
  }
}

// With the music off, the engine sleeps a few seconds after the last sound effect.
function sleepSoon() {
  clearTimeout(sleepTimer);
  if (settings.music || !ctx) return;
  sleepTimer = setTimeout(() => {
    if (!settings.music && ctx.state === 'running') ctx.suspend();
  }, 3000);
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
    if (!on) {
      setTimeout(() => !settings.music && stopMusic(), 800);
      setAudioSession();
      sleepSoon();
    }
  }
  if (on && ensureCtx()) {
    musicGain.gain.setTargetAtTime(musicLevel(), ctx.currentTime, 0.2);
    if (!musicEl?.getAttribute('src') && tracks.length) loadTrack(currentTrack());
    else startMusic();
  }
  emitChange();
}

// The list in sounds/sounds.json (music genres, any recorded effects), read as the page loads.
// The engine isn't needed for that, so the music player can show its genres straight away.
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
      // Preferred: genres [{ id, label, songs: [{ title, artist, file }] }], played one song after
      // another. Still fine: a genre with a single { title, artist, file }, "one.mp3" for
      // everyone, or { style: "file.mp3" }.
      const song = (s) => ({ title: s.title || s.file, artist: s.artist || '', file: `sounds/${s.file}` });
      if (typeof file === 'string') tracks = [{ id: 'music', label: 'Music', songs: [song({ file })] }];
      else if (Array.isArray(file)) {
        tracks = file.map((t) => ({
          id: t.id || t.file,
          label: t.label || t.id || t.title || t.file,
          songs: (t.songs || [t]).map(song),
        }));
      } else {
        tracks = Object.entries(file).map(([id, f]) => ({ id, label: id, songs: [song({ file: f })] }));
      }
      continue;
    }
    // A name can list several files; one is picked at random each time, for variety.
    (sampleList ||= {})[name] = Array.isArray(file) ? file : [file];
  }
  if (tracks.length) songIdx = randomSong(currentTrack());
  if (ctx) {
    decodeSamples();
    if (settings.music && !musicEl && tracks.length) loadTrack(currentTrack());
  }
  window.dispatchEvent(new Event('ludo-audio-ready'));
  emitChange();
}

// Recorded effects, decoded once both the list and the engine are there
let decoding = false;
async function decodeSamples() {
  if (decoding || !sampleList || !ctx) return;
  decoding = true;
  for (const [name, files] of Object.entries(sampleList)) {
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
}

// The saved track — or the first one, when the saved id isn't in the playlist.
function currentTrack() {
  return tracks.find((t) => t.id === settings.musicTrack) || tracks[0];
}

// A genre starts on a random song, so it isn't always the same one first
const randomSong = (track) => Math.floor(Math.random() * (track?.songs.length || 1));

// Points the one <audio> element at the current song of a genre — only that file is ever loaded.
// A genre plays its songs one after another (a genre with one song just loops it); the genre
// only changes when the player picks another.
function loadTrack(track) {
  if (!track) return;
  if (!musicEl) {
    musicEl = new Audio();
    musicEl.addEventListener('ended', () => {
      songIdx++;
      loadTrack(currentTrack());
      emitChange();
    });
    // A missing/broken file shouldn't leave the game silent: fall back to the generated loop.
    musicEl.addEventListener('error', () => {
      if (!musicEl.getAttribute('src')) return; // unloaded on purpose (music off)
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
  musicEl.loop = track.songs.length === 1;
  musicEl.src = track.songs[songIdx % track.songs.length].file;
  stopMusic(); // swap the generated loop for the file
  if (settings.music) startMusic();
}

let trackSwitchTimer = null; // the pending swap: rapid taps only ever load the last pick

// Changes the track, fading out and back in (~0.6s) while music is playing.
export function playTrack(id) {
  const track = tracks.find((t) => t.id === id);
  if (!track) return;
  if (!ctx || !musicEl) {
    // Nothing playing (music off, or not started yet): just remember the pick
    settings.musicTrack = track.id;
    songIdx = songTarget ?? randomSong(track);
    songTarget = null;
    save();
    emitChange();
    return;
  }
  // The selection changes now, even though the new file fades in a little later.
  settings.musicTrack = track.id;
  save();
  emitChange();
  clearTimeout(trackSwitchTimer);
  const swap = () => {
    trackSwitchTimer = null;
    if (songTarget !== null) {
      songIdx = songTarget;
      songTarget = null;
    } else songIdx = randomSong(track);
    loadTrack(track);
    musicGain.gain.setTargetAtTime(musicLevel(), ctx.currentTime, 0.2); // and in
    emitChange();
  };
  if (settings.music && musicEl && !musicEl.paused) {
    musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2); // ~0.6s out
    trackSwitchTimer = setTimeout(swap, 650);
  } else swap();
}

// ⏭ / ⏮: the next or previous song of the genre playing now
let songTarget = null;
function skipSong(step) {
  const cur = currentTrack();
  if (!cur) return;
  const n = cur.songs.length;
  songTarget = (((songIdx % n) + step) % n + n) % n;
  playTrack(cur.id);
}
export const nextTrack = () => skipSong(1);
export const prevTrack = () => skipSong(-1);

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
  // Music switched off: unload the file too. A paused-but-loaded track keeps the game listed as
  // the phone's media app, which stops other apps (Spotify…) from playing.
  if (musicEl && !settings.music && musicEl.getAttribute('src')) {
    musicEl.removeAttribute('src');
    musicEl.load();
  }
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
  if (!settings.sound || !ensureCtx()) return;
  sleepSoon();
  const recorded = samples[name];
  if (recorded?.length) playSample(recorded[Math.floor(Math.random() * recorded.length)], name === 'step');
  else EFFECTS[name]?.();
}

function envelope(t, len, vol) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
  g.gain.setValueAtTime(vol, t + len * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  return g;
}

// One "ha": a buzzy voice shaped like an "ah" (or another vowel), with a breathy "h" in front.
// A trombone-ish note: a "wah" filter sweep, and a wobble that sags on the long last note.
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

setAudioSession(); // as early as possible: with the music off, the game's sounds mix with other apps
loadFiles(); // the genre list for the music player; nothing is played or started

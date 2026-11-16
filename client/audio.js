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
// Music starts off: on phones, game music stops whatever the player is already listening to
// (Spotify…), so it's theirs to switch on in ⚙ Settings. Sound effects are on.
const settings = { music: false, sound: true, musicVolume: 0.5, soundVolume: 0.5, musicTrack: '' };
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
  // Nothing saved yet on a computer (mouse, no touch screen): start with the music on, so the
  // menu isn't silent. Phones keep it off, for the reason above.
  if (saved.music === undefined && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) saved.music = true;
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
// The song repeats until the player picks another song (⏮ ⏭) or another genre.
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
  musicEl.loop = true; // one song repeats; ⏮ ⏭ change the song, the list changes the genre
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
  // In a background tab this timer only runs now and then: skip the notes it missed instead of
  // playing them all at once when the tab comes back.
  if (nextNote < ctx.currentTime) nextNote = ctx.currentTime + 0.05;
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
  // --- the special tokens' own ways home (signatures.js), one sound each ---
  // Rocket: a rumble that climbs into a whoosh
  launch() {
    noise(now(), 0.5, 180, 0.3);
    tone(70, now(), 0.55, 'sawtooth', 0.16, 240);
    noise(now() + 0.35, 0.75, 1400, 0.3);
    tone(240, now() + 0.35, 0.7, 'sawtooth', 0.1, 1500);
  },
  // UFO: a wobbling hum sliding upward, and back down as it is set down
  beam() {
    for (let i = 0; i < 6; i++) tone(420 + i * 90 + (i % 2 ? 40 : 0), now() + i * 0.1, 0.16, 'sine', 0.16);
    for (let i = 0; i < 5; i++) tone(900 - i * 100, now() + 0.85 + i * 0.09, 0.16, 'sine', 0.13);
  },
  // Constellation, Robot: folding away into a point, and out again
  warp() {
    tone(900, now(), 0.3, 'sine', 0.2, 2600);
    tone(2400, now() + 0.6, 0.35, 'triangle', 0.16, 700);
    [1568, 2093, 2637].forEach((f, i) => tone(f, now() + 0.72 + i * 0.05, 0.3, 'sine', 0.1));
  },
  // Royal: a shower of coins
  coins() {
    for (let i = 0; i < 9; i++) tone(1900 + ((i * 577) % 1400), now() + i * 0.045, 0.14, 'triangle', 0.13);
    [1047, 1319, 1568].forEach((f, i) => tone(f, now() + 0.75 + i * 0.07, 0.3, 'triangle', 0.16));
  },
  // Dragon: wingbeats and a roar
  fly() {
    for (let i = 0; i < 4; i++) noise(now() + i * 0.22, 0.14, 420, 0.22);
    tone(170, now() + 0.1, 0.7, 'sawtooth', 0.12, 80);
    noise(now() + 0.1, 0.6, 600, 0.14);
  },
  // Ghost: a soft moan sliding down
  fade() {
    tone(660, now(), 0.7, 'sine', 0.16, 300);
    tone(990, now() + 0.05, 0.6, 'sine', 0.07, 450);
  },
  // Slime: a wet splat, then a pop
  splat() {
    noise(now(), 0.16, 500, 0.4);
    tone(200, now(), 0.2, 'sine', 0.2, 70);
    tone(300, now() + 0.72, 0.14, 'sine', 0.2, 760);
  },
  // Penguin: a long slide over ice
  slide() {
    noise(now(), 0.7, 3200, 0.2);
    tone(900, now(), 0.7, 'sine', 0.05, 500);
  },
  // Duck, Cat, Checker: boing, boing
  bounce() {
    for (let i = 0; i < 3; i++) tone(300 + i * 60, now() + i * 0.26, 0.2, 'sine', 0.2, 620 + i * 60);
  },
  // Neon, Robot: flickering out, flickering on
  blink() {
    for (let i = 0; i < 5; i++) tone(i % 2 ? 1500 : 1100, now() + i * 0.07, 0.05, 'square', 0.08);
    for (let i = 0; i < 4; i++) tone(i % 2 ? 1300 : 1700, now() + 0.55 + i * 0.07, 0.05, 'square', 0.08);
  },
  // The winner's token taking its bow: a little fanfare over the win tune
  bow() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, now() + 0.5 + i * 0.11, 0.4, 'triangle', 0.22));
    [1047, 1319, 1568].forEach((f) => tone(f, now() + 1.15, 0.9, 'triangle', 0.14));
  },
  // --- revenge and capture streaks ---
  // a big low hit, then a rising brass stab
  revenge() {
    const t = now();
    tone(70, t, 0.5, 'sine', 0.6, 40);
    noise(t, 0.3, 300, 0.35);
    for (const f of [220, 277, 330]) voice(t + 0.12, { f, f2: f * 2, len: 0.55, type: 'sawtooth', vol: 0.07, filter: { f: 2200 } });
  },
  // two quick bright notes
  double() {
    const t = now();
    tone(988, t, 0.18, 'square', 0.1);
    tone(1319, t + 0.11, 0.3, 'square', 0.1);
  },
  // a crunchy power chord, twice
  rampage() {
    const t = now();
    for (const at of [0, 0.22]) for (const f of [110, 165, 220]) voice(t + at, { f, len: 0.4, type: 'sawtooth', vol: 0.08, filter: { f: 1400, q: 1.5 } });
  },
  // --- taunts (taunts.js): each one timed to its scene ---
  // a whoosh, the hammer's thud and squeak, then little birds for the dizzy stars
  'taunt-bonk'() {
    const t = now();
    noise(t + 0.35, 0.35, 700, 0.12);
    tone(130, t + 0.7, 0.35, 'sine', 0.6, 45);
    noise(t + 0.7, 0.08, 1200, 0.35);
    voice(t + 0.72, { f: 300, f2: 900, len: 0.22, type: 'square', vol: 0.12, filter: { f: 1600 } });
    for (let i = 0; i < 3; i++) voice(t + 1.0 + i * 0.16, { f: 2200, f2: 3000, len: 0.08, type: 'sine', vol: 0.1 });
  },
  // a slide whistle, all the way down
  'taunt-bye'() {
    const t = now();
    voice(t + 0.5, { f: 1500, f2: 260, len: 1.6, type: 'sine', vol: 0.22, vib: 18, vibRate: 7 });
  },
  // the saddest little tune
  'taunt-violin'() {
    const t = now();
    [[440, 0.45], [415, 0.45], [392, 0.45], [370, 1.2]].reduce((at, [f, len]) => {
      voice(t + at, { f, len, type: 'sawtooth', vol: 0.12, vib: 7, vibRate: 5.5, filter: { f: 1800, q: 2 } });
      return at + len * 0.92;
    }, 0.15);
  },
  // shades dropping, a click, and two bright chimes
  'taunt-ggez'() {
    const t = now();
    voice(t + 0.4, { f: 1800, f2: 400, len: 0.5, type: 'sine', vol: 0.06 });
    tone(2400, t + 0.91, 0.04, 'square', 0.12);
    tone(1319, t + 0.98, 0.5, 'triangle', 0.25);
    tone(1760, t + 1.12, 0.7, 'triangle', 0.25);
  },
  // a skull cackling, each "ha" lower than the last
  'taunt-cackle'() {
    const t = now();
    for (let i = 0; i < 9; i++) ha(t + 0.3 + i * 0.2 + (i > 4 ? 0.15 : 0), 330 - i * 14);
  },
  // three airhorn blasts, then the fireworks cracking
  'taunt-fireworks'() {
    const t = now();
    for (const at of [0.38, 1.0, 1.6]) for (const f of [452, 458, 465]) voice(t + at, { f, f2: f * 1.04, len: 0.42, type: 'sawtooth', vol: 0.09, filter: { f: 2400 } });
    for (const b of [0.24, 0.4, 0.56, 0.7, 0.82]) {
      noise(t + b * 3.4, 0.35, 160, 0.4);
      for (let i = 0; i < 6; i++) noise(t + b * 3.4 + 0.1 + i * 0.05 + Math.random() * 0.03, 0.03, 4000 + Math.random() * 2000, 0.15);
    }
  },
  // HONK. HONK.
  'taunt-clown'() {
    const t = now();
    honk(t + 0.72);
    honk(t + 1.32);
  },
  // the stamp coming down, and the paper
  'taunt-skill'() {
    const t = now();
    tone(95, t + 0.75, 0.3, 'sine', 0.6, 40);
    noise(t + 0.75, 0.12, 500, 0.4);
    noise(t + 1.05, 0.25, 3200, 0.08);
  },
  // the L landing, then a wah-wah trombone going down
  'taunt-l'() {
    const t = now();
    tone(80, t + 0.77, 0.35, 'sine', 0.55, 40);
    noise(t + 0.77, 0.25, 300, 0.3);
    [[196, 0.4], [185, 0.4], [175, 0.4], [165, 1.3]].reduce((at, [f, len], i) => {
      trombone(t + at, f, len, i === 3);
      return at + len;
    }, 1.0);
  },
  // the chicken flopping down, then one very long squeak
  'taunt-chicken'() {
    const t = now();
    tone(140, t + 0.68, 0.18, 'sine', 0.35, 70);
    voice(t + 0.88, { f: 900, f2: 1250, len: 1.15, type: 'sawtooth', vol: 0.14, vib: 60, vibRate: 13, filter: { type: 'bandpass', f: 1500, q: 3 } });
  },
  win() {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, now() + i * 0.12, 0.35, 'triangle', 0.25));
  },
  chat() {
    tone(1250, now(), 0.06, 'sine', 0.15);
  },

  // ---- menus and the shop ----
  // A soft wooden "tock" for any button
  click() {
    tone(560, now(), 0.07, 'sine', 0.2, 360);
    noise(now(), 0.015, 3800, 0.06);
  },
  // Barely there: the mouse moving onto a shop card
  hover() {
    tone(1900 + Math.random() * 120, now(), 0.03, 'sine', 0.035);
  },
  // Switching tabs: a quick upward flick
  tab() {
    tone(620, now(), 0.06, 'triangle', 0.16, 880);
  },
  // Going back or closing something: the same flick, downwards
  back() {
    tone(700, now(), 0.08, 'triangle', 0.14, 420);
  },
  // A page or close-up opening: a little airy swoosh
  open() {
    tone(320, now(), 0.16, 'sine', 0.12, 760);
    noise(now(), 0.12, 1400, 0.07);
  },
  // On/off switches
  toggle() {
    tone(1050, now(), 0.035, 'square', 0.05);
    tone(1500, now() + 0.045, 0.035, 'square', 0.04);
  },
  // Bought something: coins dropping in, then a sparkle
  buy() {
    [0, 0.06, 0.11].forEach((d, i) => {
      tone(2093 + i * 140, now() + d, 0.09, 'sine', 0.12);
      noise(now() + d, 0.03, 6000, 0.08);
    });
    [1319, 1760, 2637].forEach((f, i) => tone(f, now() + 0.2 + i * 0.07, 0.4, 'triangle', 0.2));
  },
  // Put something on: a round "pop"
  equip() {
    tone(380, now(), 0.1, 'sine', 0.26, 900);
    tone(1200, now() + 0.06, 0.12, 'triangle', 0.08);
  },
  // Can't do that (not enough coins…): two low, short buzzes
  error() {
    tone(196, now(), 0.1, 'square', 0.07);
    tone(165, now() + 0.13, 0.14, 'square', 0.07);
  },
};

let lastSfx = 0;
// Did something just play (within the last few ms)? The menus' click sound stays quiet then,
// so a button with its own sound doesn't also "tock".
export const playedJustNow = (ms = 60) => performance.now() - lastSfx < ms;

export function sfx(name) {
  lastSfx = performance.now();
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

// One sustained note: optional pitch slide (f -> f2), vibrato (`vib` Hz deep at `vibRate`), and a
// filter (lowpass unless told otherwise).
function voice(t, { f, f2 = null, len, type = 'sawtooth', vol = 0.2, vib = 0, vibRate = 6, filter = null }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t);
  if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t + len);
  if (vib) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = vibRate;
    depth.gain.value = vib;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + len + 0.05);
  }
  let out = osc;
  if (filter) {
    const bq = ctx.createBiquadFilter();
    bq.type = filter.type || 'lowpass';
    bq.frequency.value = filter.f;
    bq.Q.value = filter.q || 1;
    out = osc.connect(bq);
  }
  out.connect(envelope(t, len, vol)).connect(sfxGain);
  osc.start(t);
  osc.stop(t + len + 0.05);
}

// One "ha": a buzzy voice through an "ah" shaped filter, with a breathy "h" in front.
function ha(t, f) {
  noise(t, 0.05, 1800, 0.08);
  voice(t + 0.03, { f, f2: f * 0.85, len: 0.13, type: 'sawtooth', vol: 0.16, filter: { type: 'bandpass', f: 850, q: 1.6 } });
}

// A clown horn: two reedy notes squeezed together, dipping in pitch
function honk(t) {
  for (const f of [370, 466]) voice(t, { f: f * 1.08, f2: f * 0.92, len: 0.32, type: 'sawtooth', vol: 0.1, filter: { type: 'bandpass', f: 1100, q: 2.5 } });
}

// A trombone-ish note: a "wah" filter sweep, and a wobble that sags on the long last note.
function trombone(t, f, len, last) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f, t);
  if (last) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 5;
    depth.gain.value = 6;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + len + 0.05);
    osc.frequency.exponentialRampToValueAtTime(f * 0.88, t + len);
  }
  const bq = ctx.createBiquadFilter();
  bq.type = 'lowpass';
  bq.Q.value = 6;
  bq.frequency.setValueAtTime(350, t);
  bq.frequency.exponentialRampToValueAtTime(1400, t + Math.min(0.15, len * 0.4));
  bq.frequency.exponentialRampToValueAtTime(420, t + len);
  osc.connect(bq).connect(envelope(t, len, 0.2)).connect(sfxGain);
  osc.start(t);
  osc.stop(t + len + 0.05);
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

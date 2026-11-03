# Sound files

Audio files here (`.mp3` works everywhere — iOS doesn't play `.ogg`) are listed in
`sounds.json`. Anything not listed keeps the built-in generated sound.

```json
{
  "music": [
    { "id": "lofi", "label": "Lo-fi", "title": "Deliberate Thought", "artist": "Kevin MacLeod", "file": "music-lofi.mp3" },
    { "id": "jazz", "label": "Slow jazz", "title": "Wallpaper", "artist": "Kevin MacLeod", "file": "music-jazz.mp3" },
    { "id": "energetic", "label": "Energetic", "title": "Faster Does It", "artist": "Kevin MacLeod", "file": "music-energetic.mp3" }
  ]
}
```

`music` is an ordered playlist: tracks play one after another (wrapping around),
the player's pick is remembered, and only the current track's file is loaded.
Older formats still work too: a plain filename (`"music": "song.mp3"`) plays for
everyone, and `{ "jazz": "j.mp3" }` becomes a playlist keyed on the style names.

Effect names (`roll`, `land`, `step`, `capture`, `home`, `turn`, `win`, `chat`)
can each be a filename or a list — a list picks one file at random each time, so
repeated sounds don't feel robotic. Keep effects small: ~96 kbps mono with the
leading silence trimmed; music ~128 kbps stereo.

`sounds.json` itself is served no-cache, but the mp3s are cached for a week —
to replace a track's audio, use a NEW file name. See `CREDITS.md` for where
these files came from — only use sounds you're allowed to use (CC0, or CC-BY
with in-game attribution). Run `npm run build` after changing anything here.

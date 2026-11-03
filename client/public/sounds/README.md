# Sound files

Audio files here (`.mp3` works everywhere — iOS doesn't play `.ogg`) are listed in
`sounds.json`. Anything not listed keeps the built-in generated sound.

```json
{
  "roll": ["roll-1.mp3", "roll-2.mp3", "roll-3.mp3"],
  "land": "land.mp3",
  "step": ["step-1.mp3", "step-2.mp3", "step-3.mp3"],
  "capture": "capture.mp3",
  "home": "home.mp3",
  "turn": "turn.mp3",
  "win": "win.mp3",
  "chat": "chat.mp3",
  "music": {
    "jazz": "music-jazz.mp3",
    "lofi": "music-lofi.mp3",
    "energetic": "music-energetic.mp3"
  }
}
```

A list picks one file at random each time, so repeated sounds don't feel robotic.
`music` can be one filename (all players get it) or an object of named styles the
player picks between in the audio settings — only the selected track is loaded.
Keep files small: effects ~96 kbps mono with the leading silence trimmed; music
~128 kbps stereo. See `CREDITS.md` for where these files came from — only use
sounds you're allowed to use (CC0, or CC-BY with in-game attribution).
Run `npm run build` after changing anything here.

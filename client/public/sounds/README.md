# Sound files

Put audio files here (`.mp3` works everywhere; `.ogg` and `.wav` work in Discord on desktop and Android)
and list them in `sounds.json` next to this file. Only use sounds you're allowed to use, e.g. CC0 packs
from kenney.nl. Anything not listed keeps the built-in generated sound.

```json
{
  "roll": ["dice-shake-1.ogg", "dice-shake-2.ogg"],
  "land": "dice-throw-1.ogg",
  "step": ["pin-tap-1.ogg", "pin-tap-2.ogg", "pin-tap-3.ogg"],
  "capture": "capture.ogg",
  "home": "home.ogg",
  "turn": "your-turn.ogg",
  "win": "win.ogg",
  "chat": "chat.ogg",
  "music": "music.mp3"
}
```

A list picks one file at random each time, so repeated sounds don't feel robotic.
Run `npm run build` after changing anything here.

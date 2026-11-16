// How the shop's board themes and dice look. Token skins are drawn in renderer.js.
//
// Each board theme has its own six player colours, tuned to sit well on that board.
// Pawns, bases, home columns, the dice glow and the side panel all use them, so
// everything on one board matches.

export const BOARD_THEMES = {
  // art.shield: what wraps a token standing on a safe square (renderer.js SHIELDS)
  'board-classic': {
    // Safe squares stand out: a warm gold tile, a darker ring and a big outlined star
    art: { mark: 'star', markSize: 0.34, markEdge: '#ffffff', safeRing: '#d39a1e',
      shield: { kind: 'orbit', motif: 'star', colors: ['#ffd54a', '#ffb52e'], glow: 'rgba(255, 220, 120, 0.5)' } },
    bg: '#e9e2d3', // shows between the squares
    cell: '#fbf8f1',
    safe: '#fbdc85',
    star: '#a8690a',
    baseInner: '#fbf8f1',
    players: { red: '#d24d47', green: '#2f9467', yellow: '#e2a92a', blue: '#3a68c8', purple: '#7e57bd', orange: '#dd7433' },
  },
  // The textured themes all work the same way (see art in renderer.js): a surface texture under
  // the board shows through the grout and through each base's "window", a second copy of it
  // is blended over that (art.under), and the squares and bases get their own textures (art.tex).
  //
  // ONE moving effect per board, and each board has its own: either the surface itself moves
  // (art.under with a speed: Neon's grid, Ocean's water, Lava's flow) or something floats over
  // it (art.fx: mist, dust, sprinkles, fireflies, snow, paw prints, blown sand, petals, falling
  // pixels, a golden sheen, the stars).
  // Never both. Stars are the Constellation board's alone.
  'board-midnight': {
    // Moonlight on dark slate: charcoal squares with a silver edge, crescent moons on the safe
    // squares and a moonlit patch in every yard. Its one effect: mist drifting across the board.
    // (No stars here: the night sky belongs to the Constellation board.)
    art: {
      base: 'moonlit', frame: ['#2b3048', '#c3cbe6', 0.3], panel: 'moonlit',
      tex: {
        base: { src: '/textures/midnight-slate.jpg', size: 5, blend: 'soft-light', alpha: 0.4 },
        tile: { src: '/textures/midnight-slate.jpg', size: 3, blend: 'multiply', alpha: 0.9 },
      },
      tile: 'slate', mark: 'moon', markSize: 0.3,
      fx: 'mist', fxCount: 6,
      shield: { kind: 'orbit', motif: 'moon', colors: ['#e8ecff', '#b9c4f0'], glow: 'rgba(190, 200, 255, 0.4)', n: 4, size: 0.3 },
    },
    bg: '#0d0f18',
    cell: '#454a60',
    safe: '#6a7093',
    star: '#f1f3ff',
    baseInner: '#1b1e2c',
    players: { red: '#e2645f', green: '#43bd86', yellow: '#e8bd4c', blue: '#5c8be8', purple: '#a283ea', orange: '#ea8f4f' },
  },
  'board-wood': {
    // A walnut board with pale maple squares, inlaid bases
    art: {
      base: 'inlay', frame: ['#3a200c', '#8a5a2c', 0.4],
      tex: {
        surface: { src: '/textures/wood-walnut.jpg', size: 9 },
        base: { src: '/textures/wood-maple.jpg', size: 6, blend: 'multiply', alpha: 0.5 },
        tile: { src: '/textures/wood-maple.jpg', size: 4, blend: 'multiply', alpha: 0.9 },
        panel: { src: '/textures/wood-maple.jpg', size: 5 },
      },
      tile: 'gloss', mark: 'star', fx: 'dust', fxCount: 18,
      pins: 'recess', decor: 'wood', hub: 'inlay',
      shield: { kind: 'orbit', motif: 'leaf', colors: ['#d9822b', '#b5541c', '#e8b23a'], glow: 'rgba(255, 190, 110, 0.45)' },
    },
    bg: '#4a2a12',
    cell: '#fff6e6',
    safe: '#f2cf8f',
    star: '#7f5220',
    baseInner: '#f5e7cd',
    players: { red: '#a8432f', green: '#4b7a3a', yellow: '#c48c22', blue: '#395c84', purple: '#6c4a7c', orange: '#b5622a' },
  },
  'board-candy': {
    // Pastel candy swirling through the windows, frosted bases with sprinkles
    art: {
      base: 'solid', frame: ['#ff8fb8', '#ffffff', 0.32], panel: 'window',
      tex: {
        surface: { src: '/textures/candy-swirl.jpg', size: 9 },
        base: { src: '/textures/candy-icing.jpg', size: 5, blend: 'soft-light', alpha: 0.7 },
      },
      under: { src: '/textures/candy-swirl.jpg', size: 9, alpha: 0.6, blend: 'overlay', speed: 0 },
      tile: 'gloss', mark: 'heart', fx: 'sprinkles', fxCount: 22,
      pins: 'cookie', decor: 'candy', hub: 'swirl',
      shield: 'candy',
    },
    bg: '#f6d7e5',
    cell: '#fffafc',
    safe: '#fde6b3',
    star: '#d97aa6',
    baseInner: '#fffafc',
    players: { red: '#ee7486', green: '#4fbf95', yellow: '#f2bf57', blue: '#6c98ee', purple: '#b087ec', orange: '#f3965f' },
  },
  'board-neon': {
    // A glowing grid scrolls under the board and through the windows
    art: {
      base: 'outline', frame: ['#ff2fd1', '#2ef2ff', 0.14], panel: 'window',
      tex: {
        surface: { src: '/textures/neon-grid.jpg', size: 4 },
        tile: { src: '/textures/neon-tarmac.jpg', size: 3, blend: 'multiply', alpha: 1 },
      },
      under: { src: '/textures/neon-grid.jpg', size: 4, alpha: 0.7, blend: 'screen', speed: 0.5, single: true },
      tile: 'neon', mark: 'star',
      pins: 'ring', decor: 'neon', hub: 'rings',
      shield: 'force',
    },
    bg: '#07070d',
    cell: '#24263a',
    safe: '#2c2860',
    star: '#8d84ff',
    baseInner: '#0c0d15',
    players: { red: '#ff4d6d', green: '#2ef29a', yellow: '#ffe04a', blue: '#3db2ff', purple: '#c35cff', orange: '#ff8e3a' },
  },
  // bg2 (optional): the board glows from this colour in the middle out to bg at the edges
  'board-ocean': {
    // Each base is a lagoon (a window onto moving water); sandy tiles; water-textured bases
    art: {
      base: 'solid', frame: ['#e9d3a1', '#fff2cf', 0.36], panel: 'window',
      tex: {
        surface: { src: '/textures/ocean-water.jpg', size: 7 },
        base: { src: '/textures/ocean-water.jpg', size: 5, blend: 'soft-light', alpha: 0.32 },
        tile: { src: '/textures/ocean-sand.jpg', size: 3.2, blend: 'multiply', alpha: 0.55 },
      },
      under: { src: '/textures/ocean-water.jpg', size: 7, alpha: 0.55, blend: 'overlay', speed: 0.22 },
      mark: 'starfish', markSize: 0.32,
      pins: 'islet', decor: 'ocean', hub: 'compass',
      shield: 'bubble',
    },
    bg: '#0d4a6b',
    bg2: '#1f8db5',
    cell: '#f6ecd2',
    safe: '#bfeaf5',
    star: '#ff7a59',
    baseInner: '#eaf7fb',
    players: { red: '#f0605a', green: '#1fb38a', yellow: '#f5c33b', blue: '#2f6fd6', purple: '#8b6fe0', orange: '#f08a3e' },
  },
  'board-forest': {
    // A mossy clearing in each base, stepping-stone squares, sunlight drifting through the leaves
    art: {
      base: 'solid', frame: ['#3b2a16', '#8a6a3a', 0.38], panel: 'window',
      tex: {
        surface: { src: '/textures/forest-moss.jpg', size: 6 },
        base: { src: '/textures/forest-moss.jpg', size: 5, blend: 'soft-light', alpha: 0.5 },
        tile: { src: '/textures/forest-stone.jpg', size: 3.4, blend: 'multiply', alpha: 0.85 },
      },
      under: { src: '/textures/forest-light.jpg', size: 9, alpha: 0.5, blend: 'screen', speed: 0 },
      tile: 'moss', mark: 'leaf', fx: 'fireflies', fxCount: 16,
      pins: 'stump', decor: 'forest', hub: 'stump',
      shield: { kind: 'orbit', motif: 'leaf', colors: ['#5fbf3a', '#3d9a30', '#9ad84a'], glow: 'rgba(200, 255, 140, 0.4)', n: 6 },
    },
    bg: '#263f23',
    cell: '#f4f2e6',
    safe: '#dcebb0',
    star: '#5d7d22',
    baseInner: '#f3f7e6',
    players: { red: '#c94f3d', green: '#3a8a40', yellow: '#d6a425', blue: '#3d6ea8', purple: '#7a5aa6', orange: '#d07a32' },
  },
  'board-ice': {
    // Looking down into deep cracked ice; snowy squares; snow falling
    art: {
      base: 'frosted', frame: ['#ffffff', '#9fd4f0', 0.32], panel: 'window',
      tex: {
        surface: { src: '/textures/ice-deep.jpg', size: 7 },
        base: { src: '/textures/ice-snow.jpg', size: 5, blend: 'soft-light', alpha: 0.6 },
        tile: { src: '/textures/ice-snow.jpg', size: 3.2, blend: 'multiply', alpha: 0.8 },
      },
      under: { src: '/textures/ice-deep.jpg', size: 10, alpha: 0.45, blend: 'soft-light', speed: 0 },
      tile: 'frost', mark: 'snowflake', fx: 'snow', fxCount: 40,
      pins: 'crystal', decor: 'ice', hub: 'flake',
      shield: 'frost',
    },
    bg: '#9ccfe8',
    cell: '#ffffff',
    safe: '#d4effa',
    star: '#4aa3cf',
    baseInner: '#fbfeff',
    players: { red: '#e2566a', green: '#25a585', yellow: '#e3ad1f', blue: '#3a74d8', purple: '#8a6be0', orange: '#ec8a46' },
  },
  'board-lava': {
    // Molten lava glowing between basalt squares and filling each base
    art: {
      base: 'rock', frame: ['#2a120a', '#ff7a2a', 0.3], panel: 'window',
      tex: {
        surface: { src: '/textures/lava-molten.jpg', size: 6 },
        base: { src: '/textures/lava-basalt.jpg', size: 4, blend: 'overlay', alpha: 0.8 },
        tile: { src: '/textures/lava-basalt.jpg', size: 3, blend: 'multiply', alpha: 1 },
      },
      under: { src: '/textures/lava-molten.jpg', size: 6, alpha: 0.6, blend: 'screen', speed: 0.12 },
      tile: 'stone', mark: 'flame', markSize: 0.3,
      pins: 'slab', decor: 'lava', hub: 'crater',
      shield: 'fire',
    },
    bg: '#2a0c05',
    cell: '#6a5d58',
    safe: '#8a5a3a',
    star: '#ffb347',
    baseInner: '#211310',
    players: { red: '#ff4a3d', green: '#48d18a', yellow: '#ffc83a', blue: '#4f8dff', purple: '#c06bff', orange: '#ff7b2a' },
  },
  // Warm and cosy: knitted squares whose stitches follow the route, felt bases with a fluffy
  // cushion for the pins, a paw print, a ball of yarn and claw scratches in the corners
  'board-cat': {
    art: {
      base: 'cushion', baseLight: 0.14, stitch: '#3a2010', frame: ['#b9784a', '#f3c79c', 0.3],
      panel: 'fluffy', pins: 'dents', decor: 'cat', center: 'stitched',
      tex: {
        base: { src: '/textures/cat-linen.jpg', size: 4, blend: 'multiply', alpha: 0.55 },
        panel: { src: '/textures/cat-linen.jpg', size: 3 },
      },
      tile: 'knit', mark: 'paw', fx: 'paws', fxColor: '#8a5a3c', fxCount: 18,
      hub: 'paw',
      shield: { kind: 'orbit', motif: 'paw', colors: ['#ffffff', '#ffd3e0'], glow: 'rgba(255, 190, 140, 0.55)', n: 4, size: 0.36 },
    },
    bg: '#b98a5e',
    cell: '#f2e6d4',
    safe: '#ecc9a2',
    star: '#a8683e',
    baseInner: '#f7ecdc',
    players: { red: '#d9665c', green: '#5fae7a', yellow: '#e8b84a', blue: '#6a8fd0', purple: '#a57fcc', orange: '#e88f55' },
  },
  'board-desert': {
    // Sandstone squares on blown sand; a water hole for every pin; cactus in the corners.
    // Its one effect: sand streaking past on the wind.
    art: {
      base: 'solid', frame: ['#8a5a2a', '#f6dc9a', 0.3], panel: 'window',
      tex: {
        surface: { src: '/textures/ocean-sand.jpg', size: 6 },
        base: { src: '/textures/ocean-sand.jpg', size: 5, blend: 'soft-light', alpha: 0.55 },
        tile: { src: '/textures/ocean-sand.jpg', size: 3, blend: 'multiply', alpha: 0.45 },
      },
      tile: 'sandstone', mark: 'star', fx: 'sand', fxCount: 26,
      pins: 'oasis', decor: 'desert', hub: 'sun',
      shield: { kind: 'orbit', motif: 'star', colors: ['#ffd76a', '#f29a2e'], glow: 'rgba(255, 215, 120, 0.45)' },
    },
    bg: '#c79a55',
    cell: '#f7e6bd',
    safe: '#f0b866',
    star: '#a85a1a',
    baseInner: '#f3dca6',
    players: { red: '#d9553f', green: '#3f9a6a', yellow: '#e6a52a', blue: '#3d7fc4', purple: '#8a5fc0', orange: '#e07a34' },
  },
  'board-sakura': {
    // Pale wood under cherry blossom: a flower for every pin, twigs in bloom in the corners.
    // Its one effect: petals drifting down.
    art: {
      base: 'solid', frame: ['#f29ab8', '#ffffff', 0.32],
      tex: {
        base: { src: '/textures/candy-icing.jpg', size: 5, blend: 'soft-light', alpha: 0.5 },
        tile: { src: '/textures/wood-maple.jpg', size: 3.5, blend: 'multiply', alpha: 0.35 },
      },
      tile: 'gloss', mark: 'heart', fx: 'petals', fxCount: 20,
      // Golden-hour lighting (scene.js): trees, dappled shade, light shafts, bloom. With it off
      // (Settings) the board is the plain one, with the `fx` petals.
      scene: 'golden',
      pins: 'blossom', decor: 'sakura', hub: 'blossom',
      shield: { kind: 'orbit', motif: 'heart', colors: ['#ff9ec0', '#ffffff'], glow: 'rgba(255, 170, 200, 0.45)' },
    },
    bg: '#f3c4d3',
    cell: '#fff8f3',
    safe: '#ffd0de',
    star: '#d6497a',
    baseInner: '#fff3f6',
    players: { red: '#e0566e', green: '#4aa77d', yellow: '#e9b23c', blue: '#5a86dc', purple: '#a274dc', orange: '#ee8a52' },
  },
  'board-arcade': {
    // An old arcade screen: pixel-bevelled squares, pixel pads, an invader in every corner.
    // Its one effect: pixels falling, a row at a time.
    art: {
      base: 'solid', frame: ['#0c0c1c', '#2ef2ff', 0.2],
      tile: 'pixel', mark: 'star', fx: 'blocks', fxCount: 18,
      pins: 'pad', decor: 'arcade', hub: 'heart',
      shield: { kind: 'orbit', motif: 'star', colors: ['#2ef2ff', '#ff2fd1'], glow: 'rgba(46, 242, 255, 0.4)' },
    },
    bg: '#0c0c1c',
    cell: '#34346a',
    safe: '#6a4fd0',
    star: '#ffe04a',
    baseInner: '#15152e',
    players: { red: '#ff4a5e', green: '#3fe08a', yellow: '#ffd23f', blue: '#4f9dff', purple: '#b96bff', orange: '#ff8a3d' },
  },
  'board-haunted': {
    // A graveyard at night: worn slate, headstones in the corners, a ghost in the middle.
    // Its one effect: will-o'-the-wisps rising.
    art: {
      base: 'moonlit', frame: ['#2a2140', '#b9b0ff', 0.3], panel: 'moonlit',
      tex: {
        base: { src: '/textures/midnight-slate.jpg', size: 5, blend: 'soft-light', alpha: 0.5 },
        tile: { src: '/textures/forest-stone.jpg', size: 3.2, blend: 'multiply', alpha: 0.85 },
      },
      tile: 'slate', mark: 'moon', markSize: 0.3, fx: 'wisps', fxCount: 12,
      pins: 'slab', decor: 'grave', hub: 'ghost',
      shield: { kind: 'orbit', motif: 'moon', colors: ['#d9ffe6', '#b9b0ff'], glow: 'rgba(170, 255, 210, 0.4)', n: 4, size: 0.3 },
    },
    bg: '#15101f',
    cell: '#6f6a86',
    safe: '#8f86c9',
    star: '#eafff0',
    baseInner: '#1d1730',
    players: { red: '#e0607a', green: '#4fd09a', yellow: '#e8c04c', blue: '#6c8cf0', purple: '#b07bff', orange: '#f0935a' },
  },
  'board-swamp': {
    // Mossy stones in green water: a lily pad for every pin, a pool of goo in the middle.
    // Its one effect: bubbles rising.
    art: {
      base: 'solid', frame: ['#2f5a2a', '#b8f26a', 0.3], panel: 'window',
      tex: {
        surface: { src: '/textures/forest-moss.jpg', size: 6 },
        base: { src: '/textures/forest-moss.jpg', size: 5, blend: 'soft-light', alpha: 0.6 },
        tile: { src: '/textures/forest-stone.jpg', size: 3.4, blend: 'multiply', alpha: 0.9 },
      },
      tile: 'moss', mark: 'leaf', fx: 'bubbles', fxCount: 20,
      pins: 'lily', decor: 'forest', hub: 'goo',
      shield: { kind: 'orbit', motif: 'leaf', colors: ['#b8f26a', '#5fbf3a'], glow: 'rgba(160, 240, 110, 0.4)' },
    },
    bg: '#1f3a1c',
    cell: '#c9d8a8',
    safe: '#9fcf6a',
    star: '#2f6b2a',
    baseInner: '#274a22',
    players: { red: '#d9564a', green: '#3fae6a', yellow: '#e0b52e', blue: '#3f84c9', purple: '#9060c9', orange: '#e0803a' },
  },
  'board-factory': {
    // A factory floor: steel plates, a cog for every pin, circuit traces in the corners.
    // Its one effect: a scanner sweeping down the board.
    art: {
      base: 'solid', frame: ['#2a3140', '#ffd23f', 0.24],
      tex: {
        base: { src: '/textures/neon-tarmac.jpg', size: 5, blend: 'soft-light', alpha: 0.5 },
        tile: { src: '/textures/neon-tarmac.jpg', size: 3, blend: 'multiply', alpha: 0.5 },
      },
      tile: 'pixel', mark: 'star', fx: 'scan',
      pins: 'gear', decor: 'neon', hub: 'cog',
      shield: { kind: 'orbit', motif: 'star', colors: ['#5cf2ff', '#ffd23f'], glow: 'rgba(92, 242, 255, 0.4)' },
    },
    bg: '#1b2233',
    cell: '#aab4c6',
    safe: '#ffd23f',
    star: '#1b2233',
    baseInner: '#232c40',
    players: { red: '#e0514a', green: '#3fb07a', yellow: '#e6b02a', blue: '#3f7fd9', purple: '#8f63d9', orange: '#e6813a' },
  },
  'board-space': {
    // Deep space: dark plates, landing rings for the pins, a ringed planet in the middle and
    // little ones in the corners. Its one effect: asteroids tumbling past.
    art: {
      base: 'celestial', frame: ['#1b2040', '#8fb6ff', 0.26],
      tile: 'slate', mark: 'star', fx: 'asteroids', fxCount: 12,
      pins: 'ring', decor: 'planet', hub: 'planet',
      shield: { kind: 'orbit', motif: 'star', colors: ['#8fb6ff', '#ffffff'], glow: 'rgba(143, 182, 255, 0.4)' },
    },
    bg: '#070914',
    cell: '#2b3358',
    safe: '#4a58a8',
    star: '#ffe9a8',
    baseInner: '#0c1024',
    players: { red: '#ff5a66', green: '#3fe09a', yellow: '#ffd23f', blue: '#5c9dff', purple: '#b97bff', orange: '#ff914a' },
  },
  'board-lair': {
    // A dragon's lair: basalt over molten rock, the pins on gold medallions, heaps of coins in
    // the corners. Its one effect: embers rising.
    art: {
      base: 'rock', frame: ['#2a120a', '#ffd23f', 0.3], panel: 'window',
      tex: {
        surface: { src: '/textures/lava-molten.jpg', size: 7 },
        base: { src: '/textures/lava-basalt.jpg', size: 4, blend: 'overlay', alpha: 0.8 },
        tile: { src: '/textures/lava-basalt.jpg', size: 3, blend: 'multiply', alpha: 1 },
      },
      tile: 'stone', mark: 'flame', markSize: 0.3, fx: 'embers', fxCount: 22,
      pins: 'medal', decor: 'hoard', hub: 'crater',
      shield: 'fire',
    },
    bg: '#1a0a06',
    cell: '#7a6a5a',
    safe: '#b98a2a',
    star: '#ffe14d',
    baseInner: '#1c100c',
    players: { red: '#ff4a3d', green: '#48d18a', yellow: '#ffc83a', blue: '#4f8dff', purple: '#c06bff', orange: '#ff7b2a' },
  },
  'board-royal': {
    // Purple velvet and white marble, gold everywhere
    art: {
      base: 'frame', frame: ['#b8860b', '#ffe9a0', 0.32],
      tex: {
        surface: { src: '/textures/royal-velvet.jpg', size: 6 },
        base: { src: '/textures/royal-velvet.jpg', size: 5, blend: 'soft-light', alpha: 0.6 },
        tile: { src: '/textures/royal-marble.jpg', size: 4, blend: 'multiply', alpha: 1 },
        panel: { src: '/textures/royal-velvet.jpg', size: 5 },
      },
      pattern: 'damask', patternColor: 'rgba(255, 228, 150, 0.22)', patternSize: 0.2, patternSpin: 0,
      tile: 'gilded', mark: 'crown', emblem: 'crown', emblemAlpha: 0.3, emblemColor: '#e9c35a', fx: 'sheen',
      pins: 'medal', decor: 'royal', hub: 'seal',
      shield: { kind: 'orbit', motif: 'sparkle', colors: ['#ffe08a', '#fff6d0'], glow: 'rgba(255, 215, 110, 0.5)', n: 6, crown: true },
    },
    bg: '#25114a',
    cell: '#ffffff',
    safe: '#f3dc95',
    star: '#c9971c',
    baseInner: '#3a2068',
    players: { red: '#c8364a', green: '#23875f', yellow: '#dfa923', blue: '#3159b8', purple: '#7d3fb8', orange: '#d66a2a' },
  },
  'board-crystal': {
    // A jeweller's board: dark marble veined with gold, black squares cut like gems, and each
    // yard a slab of its own stone's colour in a gold frame. The pins wait on gems cut the way
    // that stone usually is (a ruby for red, an emerald for green, a sapphire for blue…: see
    // YARD_GEMS), a marquise sits at every corner of the frame, rough stones spill over the
    // board's corners, and a diamond shines in the middle. Its one effect: glints of light.
    art: {
      base: 'jewel', panel: 'jewel', frame: ['#7a5418', '#ffe39a', 0.3],
      tex: {
        surface: { src: '/textures/crystal-marble.jpg', size: 9 },
        base: { src: '/textures/crystal-vein.jpg', size: 6, blend: 'overlay', alpha: 0.9 },
        panel: { src: '/textures/crystal-vein.jpg', size: 4.5, blend: 'overlay', alpha: 0.85 },
      },
      tile: 'facet', mark: 'sparkle', markSize: 0.3, fx: 'sparkle', fxColor: '#fff6dc', fxCount: 22,
      pins: 'cut', decor: 'jewel', hub: 'brilliant',
      shield: { kind: 'orbit', motif: 'sparkle', colors: ['#fff6dc', '#f3d27a'], glow: 'rgba(255, 226, 150, 0.45)', n: 6 },
    },
    bg: '#16161c',
    bg2: '#2a2a33',
    cell: '#1d1e25',
    safe: '#6b3fd8',
    star: '#fff6dc',
    baseInner: '#120d1c',
    // ruby, emerald, topaz, sapphire, amethyst, fire opal
    players: { red: '#d8143f', green: '#0f9e5c', yellow: '#eeac17', blue: '#2758e0', purple: '#8a3fe6', orange: '#f2601a' },
  },
  // A night sky in gold lines. Each base is a window onto the stars holding its player's
  // constellation (Aries, Taurus, Cancer, Leo…), whose brightest stars are where the tokens wait.
  'board-constellation': {
    art: {
      base: 'celestial', frame: ['#8a6a24', '#f3d98a', 0.22], panel: 'window', windowRim: '#e2bf6a', pins: 'constellation',
      tex: { surface: { src: '/textures/constellation-sky.jpg', size: 9 } },
      under: { src: '/textures/constellation-sky.jpg', size: 12, alpha: 0.5, blend: 'screen', speed: 0 },
      tile: 'celestial', mark: 'sparkle', markSize: 0.3, fx: 'cosmos', fxColor: '#fff3c4', fxCount: 26,
      decor: 'cosmos',
      shield: 'constellation',
    },
    bg: '#070a26',
    cell: 'rgba(12, 16, 56, 0.62)',
    safe: 'rgba(120, 92, 30, 0.72)',
    star: '#ffe08a',
    baseInner: '#0b0f30',
    players: { red: '#e8475f', green: '#2fbf7a', yellow: '#f2c14e', blue: '#4f8ff0', purple: '#a674f0', orange: '#f08a3e' },
  },
};

// ---------- colour-blind modes ----------
// Each player picks one for themselves. Every board theme then uses that mode's palette, and
// every player gets a shape too, so colour is never the only way to tell players apart.
// The palettes were chosen by simulating each kind of colour blindness (Machado et al. 2009) and
// picking the six colours that stay furthest apart for it: about twice the separation of the
// usual Okabe–Ito palette for protanopia and deuteranopia, three times for tritanopia
// (tools/colorblind/palettes.py).
export const CB_MODES = {
  protanopia: { label: 'Protanopia', note: 'red-weak', colors: { red: '#822b41', green: '#63eec1', yellow: '#e6d319', blue: '#1919e6', purple: '#a17dd4', orange: '#9c5a11' } },
  deuteranopia: { label: 'Deuteranopia', note: 'green-weak', colors: { red: '#8f1e1e', green: '#63eed7', yellow: '#e6d319', blue: '#1e538f', purple: '#6e19e6', orange: '#e1a770' } },
  tritanopia: { label: 'Tritanopia', note: 'blue-yellow', colors: { red: '#e6194c', green: '#3eea47', yellow: '#eed063', blue: '#11119c', purple: '#e619dd', orange: '#82522b' } },
};
export const SHAPES = { red: 'triangle', green: 'square', yellow: 'circle', blue: 'diamond', purple: 'plus', orange: 'cross' };
export const SYMBOLS = { red: '▲', green: '■', yellow: '●', blue: '◆', purple: '✚', orange: '✖' };

const A11Y_KEY = 'ludo-a11y';
let cbMode = 'off';
try {
  const saved = JSON.parse(localStorage.getItem(A11Y_KEY) || '{}');
  if (CB_MODES[saved.mode]) cbMode = saved.mode;
  else if (saved.colorBlind === true) cbMode = 'deuteranopia'; // the old on/off switch: the most common kind
} catch {
  // storage unavailable: off
}

export function colorBlindMode() {
  return cbMode;
}

export function isColorBlind() {
  return cbMode !== 'off';
}

export function setColorBlindMode(mode) {
  cbMode = CB_MODES[mode] ? mode : 'off';
  try {
    localStorage.setItem(A11Y_KEY, JSON.stringify({ mode: cbMode }));
  } catch {
    // not saved: fine, it's only a preference
  }
}

// The colour-blind colour for a player colour name, or null when colour-blind mode is off.
export function cbColor(name) {
  return CB_MODES[cbMode]?.colors[name] || null;
}

// A player's colour on a board theme (e.g. 'red' on 'board-neon').
export function playerColor(themeId, name) {
  return cbColor(name) || (BOARD_THEMES[themeId] || BOARD_THEMES['board-classic']).players[name];
}

// How each dice looks. face/edge/pip: the base colours; art: a painting on the face (renderer.js
// DICE_ART), pips: how the spots are drawn (PIP_STYLES), outline: a glowing border,
// sparks: the Legendary dice's effect, sparkles in these colours (a few at rest, a swirl when rolled).
// prop: what sticks out of it and moves (DICE_PROPS in renderer.js): ears, flames, a crown…
export const DICE_STYLES = {
  'dice-classic': { face: '#fbfaf6', edge: '#d3cdbf', pip: '#26262b' },
  'dice-midnight': { face: '#151a3d', edge: '#3b4580', pip: '#ffe9a8', art: 'night', pips: 'glow', prop: 'moon' },
  'dice-wood': { face: '#c8935a', edge: '#7f5226', pip: '#3d2208', art: 'grain', pips: 'inset', prop: 'sprout' },
  'dice-ruby': { face: '#b3122a', edge: '#6b0614', pip: '#fff4f4', pipDark: '#c9b8bb', art: 'gem', facets: ['#ff6b7f', '#d42a42', '#8c0a1f', '#5e0413'], pips: 'pearl', prop: 'flash' },
  // Glows in the colour of whoever is rolling (green in shop previews), and pulses.
  'dice-neon': { face: '#0b0c14', edge: '#2ef29a', pip: '#2ef29a', outline: '#2ef29a', playerColor: true, pulse: true, art: 'grid', pips: 'glow', prop: 'neon' },
  // The crown jewels: ruby pips, a crown on top, gems in the corners, rays of light behind
  'dice-gold': { face: '#e2b44a', edge: '#8c6512', pip: '#e0284a', pipDark: '#7a0d22', art: 'metal', pips: 'pearl', prop: 'gold', sparks: ['#fff6cf', '#ffd766'] },
  'dice-ice': { face: '#dff3fc', edge: '#7fb8d8', pip: '#2b78ad', pipDark: '#123f63', art: 'frost', pips: 'pearl', prop: 'ice' },
  'dice-candy': { face: '#ffffff', edge: '#e4577f', pip: '#ff4f7b', pipColors: ['#ff5ca8', '#3fd8a4', '#ffd23f', '#5aa8ff', '#b07bff', '#ff8a3d'], art: 'peppermint', pips: 'candy', prop: 'candy' },
  'dice-emerald': { face: '#0f7a4c', edge: '#064a2c', pip: '#ffd86a', pipDark: '#9a6b00', art: 'stepcut', facets: ['#6ff0b0', '#1fae6e', '#08502f'], pips: 'pearl', prop: 'flash' },
  // The four corners of a Ludo board, in the Classic board's colours
  'dice-ludo': { face: '#ffffff', edge: '#cfc8b8', pip: '#ffffff', art: 'ludo', quads: ['#d24d47', '#2f9467', '#e2a92a', '#3a68c8'], pips: 'outlined', prop: 'pawn' },
  'dice-lava': { face: '#1c0d0a', edge: '#ff6a2a', pip: '#ffb02e', outline: '#ff6a2a', pulse: true, art: 'magma', pips: 'magma', prop: 'lava' },
  'dice-galaxy': { face: '#0d0726', edge: '#5b3fb0', pip: '#ffffff', outline: '#8a5cff', art: 'nebula', pips: 'glow', prop: 'galaxy' },
  // Navy and gold, tinted with the roller's colour and showing their zodiac sign; each face's
  // pips are stars joined into a constellation
  'dice-constellation': { face: '#0b1034', edge: '#d9b25a', pip: '#fff1c2', outline: '#d9b25a', art: 'zodiac', pips: 'star', links: true, signed: true, prop: 'cosmos', sparks: ['#fff1c2', '#bcd0ff'] },
  'dice-cat': { face: '#f5b26b', edge: '#b0641f', pip: '#5a2d0c', art: 'tabby', pips: 'paw', prop: 'cat' },
  // Pale pink with blossom pips, a flowering twig on top, petals drifting past
  'dice-sakura': { face: '#ffe3ec', shine: '#fff6f9', edge: '#e88aac', pip: '#e2457a', art: 'sakura', pips: 'blossom', prop: 'sakura' },
  'dice-bubble': { face: '#58c8e8', edge: '#2a86b0', pip: '#ffffff', pipDark: '#a8dff0', art: 'water', pips: 'pearl', prop: 'bubbles' },
  'dice-slime': { face: '#7ed957', edge: '#2f8a26', pip: '#1f4a1a', pipDark: '#0d2a0b', art: 'goo', pips: 'pearl', prop: 'slime' },
  'dice-robot': { face: '#9aa6ba', edge: '#4a5466', pip: '#5cf2ff', art: 'steel', pips: 'glow', prop: 'robot' },
  'dice-ghost': { face: '#f4f2ff', shine: '#ffffff', edge: '#a99fe0', pip: '#3a2f66', prop: 'ghost' },
  'dice-duck': { face: '#ffd84a', shine: '#fff5b8', edge: '#d99a1a', pip: '#7a4a00', prop: 'duck' },
  'dice-snowball': { face: '#eef7fd', shine: '#ffffff', edge: '#a9cfe6', pip: '#2b3350', art: 'frost', prop: 'bobble' },
  // Legendary: a lump of burning rock trailing fire
  'dice-comet': { face: '#1c0d0a', edge: '#ff8a2a', pip: '#ffe14d', outline: '#ff8a2a', pulse: true, art: 'magma', pips: 'magma', prop: 'comet', sparks: ['#ffe14d', '#ff8a2a'] },
  // Legendary: eyes on stalks that look about and blink, rings of light under it
  'dice-alien': { face: '#5fd86a', shine: '#d6ffb8', edge: '#2a8a3a', pip: '#0c2a12', pipDark: '#000000', pips: 'pearl', prop: 'alien', sparks: ['#aaffe6', '#5cf2ff'] },
  // Legendary: horns, beating wings, smoke from its nostrils, and sparks when it rolls
  'dice-dragon': { face: '#2f7d4a', edge: '#17442a', pip: '#ffd23f', outline: '#ffb02e', wing: '#c2412d', art: 'scales', pips: 'magma', prop: 'dragon', sparks: ['#ffb02e', '#ff5a1a'] },
};

// How a token behaves, beyond how it looks. Used by the game and by the shop's "Try it" demo.
//  home: its own way of going back to base when it is captured (signatures.js):
//        launch (blasts off, comes down on its base) · beam (lifted away in a beam of light, set
//        down again) · warp (folds into a point of light, unfolds at base) · coins (bursts into
//        gold, re-forms at base) · fly (flies back in a high arc) · fade (melts away, drifts back
//        in) · splat (flattens into a puddle and oozes home) · bounce (hops home) · slide (shoots
//        home flat on its belly) · blink (flickers out, flickers back in)
//  ms: how long that takes (an ordinary token flies home in 650)
//  colors: its puffs and bursts
//  legend: a Legendary one. It also leaves a trail as it hops and makes a bigger burst when it
//        captures somebody.
//  win: how it celebrates winning the game (renderer.celebrate): 'lap' flies a lap of the board
//        first; the rest jump for joy in the middle
export const TOKEN_SIGNATURES = {
  'token-rocket': { legend: true, home: 'launch', ms: 1500, win: 'lap', colors: ['#ffb02e', '#ff5a1a', '#e9e6f0'] },
  'token-ufo': { legend: true, home: 'beam', ms: 1500, win: 'lap', colors: ['#aaffe6', '#5cf2ff', '#ffffff'] },
  'token-constellation': { legend: true, home: 'warp', ms: 1200, colors: ['#fff1c2', '#bcd0ff', '#f3d98a'] },
  'token-crown': { legend: true, home: 'coins', ms: 1200, colors: ['#ffd23f', '#fff1b0', '#d9a92e'] },
  'token-dragon': { legend: true, home: 'fly', ms: 1300, win: 'lap', colors: ['#ff5a1a', '#ffb02e', '#ffe14d'] },
  // Epic: a small moment of their own
  'token-ghost': { home: 'fade', ms: 900, colors: ['#ffffff', '#d9d4ff', '#b9b0ff'] },
  'token-slime': { home: 'splat', ms: 950, colors: ['#b8f26a', '#7ed957', '#4fbf3a'] },
  'token-duck': { home: 'bounce', hops: 3, ms: 950, colors: ['#ffffff', '#ffe14d', '#ff9a2e'] },
  'token-cat': { home: 'bounce', hops: 2, ms: 750, colors: ['#f5b26b', '#fff3dc', '#b0641f'] },
  'token-checker': { home: 'bounce', hops: 5, ms: 900, colors: ['#ffffff', '#ffd23f', '#d24d47'] },
  'token-penguin': { home: 'slide', ms: 800, colors: ['#ffffff', '#dff3fc', '#9fd4f0'] },
  'token-sakura': { home: 'fade', ms: 900, colors: ['#fff3f7', '#ffb7d0', '#ff8fb6'] },
  'token-dino': { home: 'bounce', hops: 2, ms: 850, colors: ['#eaf3ff', '#cdb8ff', '#7ef0b8'] },
  'token-robot': { home: 'blink', ms: 900, colors: ['#5cf2ff', '#ffffff', '#9aa6ba'] },
  'token-neon': { home: 'blink', ms: 800, colors: ['#2ef2ff', '#ff2fd1', '#ffe04a'] },
};

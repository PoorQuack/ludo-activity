# The Pixel pals pack: our own little pixel-art cat and bat, drawn here pixel by pixel (nothing
# copied). python3 pixel.py <emotes dir> writes <emotes dir>/pixel/*.webp: 24x24 pixels shown at
# 8x (192px), a few frames each, looping.
import os, sys
from PIL import Image

K, P, W, E, N, B = '#2a1838', '#b79cff', '#ffffff', '#2a1838', '#ff7aa0', '#ff9ec4'
COL = {'k': K, 'p': P, 'w': W, 'e': E, 'n': N, 'b': B, 'y': '#ffe14d', 'r': '#ff5a6a', 't': '#58d6c9', 'd': '#2f9c93', 'g': '#8fd3ff'}

CAT = [
    '..kk......kk....',
    '.kppk....kppk...',
    '.kpppkkkkpppk...',
    '.kppppppppppk...',
    'kppppppppppppk..',
    'kppeeppppeeppk..',
    'kppewppppewppk..',
    'kbbpppnnpppbbk..',
    'kppppwwwwppppk..',
    '.kppwwwwwwppk...',
    '.kpppwwwwpppk.kk',
    '.kppppppppppkkpk',
    '.kppkppppkppkpk.',
    '.kkkkkkkkkkkkk..',
]
# the same cat, startled: big round white eyes, a little "o" mouth
CAT_WOW = list(CAT)
CAT_WOW[4] = 'kpwwwwppwwwwpk..'
CAT_WOW[5] = 'kpwewwppwwewpk..'
CAT_WOW[6] = 'kpwwwwppwwwwpk..'
CAT_WOW[8] = 'kppppwkkwppppk..'
# fur on end
CAT_SHOCK = list(CAT_WOW)
CAT_SHOCK[0] = '.kkk.k..k.kkk...'
CAT_SHOCK[10] = '.kpppwwwwpppkkpk'
CAT_SHOCK[11] = '.kppppppppppkpkk'
CAT_SHOCK[12] = '.kppkppppkppkk.k'
# happy shut eyes (^ ^), for the handstand
CAT_GRIN = list(CAT)
CAT_GRIN[5] = 'kppkkppppkkppk..'
CAT_GRIN[6] = 'kpkppkppkppkpk..'

BAT_UP = [
    'kk..............kk',
    'ktk....k..k....ktk',
    'kttk..ktkktk..kttk',
    'ktttkkttttttkktttk',
    'kttttttwetewtttttk',
    '.kttttttttttttttk.',
    '..kttkttnnttkttk..',
    '...kk.kttttk.kk...',
    '.......kkkk.......',
]
BAT_DOWN = [
    '.......k..k.......',
    '......ktkktk......',
    '..kkkkttttttkkkk..',
    '.kttttwetewtttttk.',
    'kttttttttttttttttk',
    'ktttkttnnttktttk..',
    'kttk.kttttk.kttk..',
    'ktk...kkkk...ktk..',
    'kk............kk..',
]
BAT_DOWN = [r.ljust(18, '.')[:18] for r in BAT_DOWN]


def frame(sprite, ox, oy, flip=False, extra=()):
    im = Image.new('RGBA', (24, 24), (0, 0, 0, 0))
    rows = sprite[::-1] if flip else sprite
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != '.' and 0 <= ox + x < 24 and 0 <= oy + y < 24:
                im.putpixel((ox + x, oy + y), tuple(int(COL[ch][i:i + 2], 16) for i in (1, 3, 5)) + (255,))
    for x, y, ch in extra:
        if 0 <= x < 24 and 0 <= y < 24:
            im.putpixel((x, y), tuple(int(COL[ch][i:i + 2], 16) for i in (1, 3, 5)) + (255,))
    # a one-pixel white rim, like the other stickers' border, so it reads on a dark chat
    solid = [[im.getpixel((x, y))[3] > 0 for x in range(24)] for y in range(24)]
    for y in range(24):
        for x in range(24):
            if not solid[y][x] and any(solid[j][i] for j in range(max(0, y - 1), min(24, y + 2)) for i in range(max(0, x - 1), min(24, x + 2))):
                im.putpixel((x, y), (255, 255, 255, 255))
    return im.resize((192, 192), Image.NEAREST)


def bang(x, y, ch='y'):  # a pixel "!"
    return [(x, y, ch), (x, y + 1, ch), (x, y + 2, ch), (x, y + 4, ch)]


def save(dst, slug, frames, ms):
    frames[0].save(os.path.join(dst, slug + '.webp'), 'WEBP', save_all=True, append_images=frames[1:], duration=ms, loop=0, lossless=True, method=6)


def main(dst):
    dst = os.path.join(dst, 'pixel')
    os.makedirs(dst, exist_ok=True)
    # wow: sits, then its eyes go round and a "!" pops up
    wow = [frame(CAT, 4, 8)] * 3 + [frame(CAT_WOW, 4, 7, extra=bang(20, 2)), frame(CAT_WOW, 4, 8, extra=bang(20, 1)), frame(CAT_WOW, 4, 8, extra=bang(20, 2)), frame(CAT_WOW, 4, 8, extra=bang(20, 2))]
    save(dst, 'cat-wow', wow, [220, 220, 220, 120, 160, 260, 400])
    # shock: jumps with its fur on end, and shakes
    shock = [frame(CAT, 4, 8), frame(CAT_SHOCK, 4, 4, extra=bang(21, 1, 'r') + bang(1, 2, 'r')), frame(CAT_SHOCK, 3, 3, extra=bang(21, 1, 'r') + bang(1, 2, 'r')), frame(CAT_SHOCK, 5, 3), frame(CAT_SHOCK, 3, 4), frame(CAT_SHOCK, 4, 6), frame(CAT, 4, 8)]
    save(dst, 'cat-shock', shock, [300, 90, 90, 90, 90, 140, 400])
    # handstand: upside down, wobbling from side to side
    hand = [frame(CAT_GRIN, 4 + dx, 5 + dy, flip=True) for dx, dy in ((0, 0), (1, 0), (1, 1), (0, 0), (-1, 0), (-1, 1))]
    save(dst, 'cat-handstand', hand, 150)
    # the bat: flapping, bobbing up and down
    bat = [frame(BAT_UP, 3, 7), frame(BAT_DOWN, 3, 8), frame(BAT_UP, 3, 9), frame(BAT_DOWN, 3, 8)]
    save(dst, 'bat', bat, 130)
    print('4 pixel pals')


if __name__ == '__main__':
    main(sys.argv[1])

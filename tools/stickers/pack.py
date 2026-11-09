# python3 pack.py <frames dir> <emotes dir>: still stickers -> PNG, animated -> WebP (80ms a frame),
# plus <frames dir>/sheet.png, every sticker on one sheet for a quick look.
import glob, os, re, sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
sheet_items = []
for pack in sorted(os.listdir(src)):
    d = os.path.join(src, pack)
    if not os.path.isdir(d): continue
    os.makedirs(os.path.join(dst, pack), exist_ok=True)
    groups = {}
    for f in sorted(glob.glob(os.path.join(d, '*.png'))):
        slug = re.sub(r'-\d+\.png$', '', os.path.basename(f))
        groups.setdefault(slug, []).append(f)
    for slug, files in groups.items():
        frames = [Image.open(f).convert('RGBA') for f in files]
        if len(frames) == 1:
            frames[0].save(os.path.join(dst, pack, slug + '.png'), optimize=True)
        else:
            frames[0].save(os.path.join(dst, pack, slug + '.webp'), 'WEBP', save_all=True, append_images=frames[1:], duration=80, loop=0, quality=90, method=6)
        sheet_items.append(frames[0])
cols = 8
sheet = Image.new('RGBA', (cols * 192, ((len(sheet_items) + cols - 1) // cols) * 192), (14, 16, 30, 255))
for i, im in enumerate(sheet_items):
    sheet.paste(im, ((i % cols) * 192, (i // cols) * 192), im)
sheet.save(os.path.join(src, 'sheet.png'))
print(len(sheet_items), 'stickers')

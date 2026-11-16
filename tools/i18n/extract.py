#!/usr/bin/env python3
"""Collects every piece of text the game shows, for the translation files.

Writes tools/i18n/keys.json (sorted). Sources:
  - t('…') calls in client/*.js
  - data-i18n elements and data-i18n-attr attributes in client/index.html
  - shop item names, quest titles and game modes (shared/, server/quests.js)
  - the server's error messages (new Error('…') with no ${…} in them)
  - tools/i18n/extra-keys.json (names looked up at run time, server text with names in it)
Run: python3 tools/i18n/extract.py
"""
import json, re, pathlib
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parents[2]
keys = set()
norm = lambda s: re.sub(r'\s+', ' ', s).strip()

def js_strings(text, pattern):
    for m in re.finditer(pattern, text):
        q, body = m.group(1), m.group(2)
        if q == '`' and '${' in body:
            continue
        yield body.replace("\\'", "'").replace('\\"', '"')

T_CALL = r"""(?<![\w.])t\(\s*(['"`])((?:\\.|(?!\1).)*?)\1"""
for f in (ROOT / 'client').glob('*.js'):
    keys.update(js_strings(f.read_text(), T_CALL))

class H(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.stack = []  # [tag, collecting, buffer-list]
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        for name in (a.get('data-i18n-attr') or '').split(','):
            if name and a.get(name):
                keys.add(a[name])
        raw = self.get_starttag_text()
        for s in self.stack:
            if s[1]: s[2].append(raw)
        void = tag in ('input', 'br', 'img', 'meta', 'link')
        if not void:
            self.stack.append([tag, 'data-i18n' in a, []])
    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
    def handle_endtag(self, tag):
        while self.stack:
            t, col, buf = self.stack.pop()
            if col:
                keys.add(norm(''.join(buf)))
            for s in self.stack:
                if s[1]: s[2].append(f'</{t}>')
            if t == tag: break
    def handle_data(self, d):
        for s in self.stack:
            if s[1]: s[2].append(d)
    def handle_entityref(self, n): self.handle_data(f'&{n};')
    def handle_charref(self, n): self.handle_data(f'&#{n};')
H().feed((ROOT / 'client/index.html').read_text())

shop = (ROOT / 'shared/shop.js').read_text()
keys.update(re.findall(r"type: '(?:token|dice|board|taunt|emote|emote-pack)',\s*name: '((?:\\.|[^'])*)'", shop))
keys.update(re.findall(r'type: \'(?:token|dice|board|taunt|emote|emote-pack)\',\s*name: "([^"]*)"', shop))
keys.update(re.findall(r"perk: '([^']*)'", shop))
keys.update(re.findall(r"desc: '([^']*)'", shop))
keys.update(re.findall(r"title: '([^']*)'", (ROOT / 'server/quests.js').read_text()))
keys.update(re.findall(r"label: '([^']*)'", (ROOT / 'shared/board.js').read_text()))
INTERNAL = re.compile(r'^(Bad |Profile |profile |Only a profile|opening the DM|sending:|Unknown |Illegal move|Discord auth)')
for f in (ROOT / 'server').glob('*.js'):
    for s in js_strings(f.read_text(), r"""new Error\(\s*(['"`])((?:\\.|(?!\1).)*?)\1"""):
        if not INTERNAL.match(s):
            keys.add(s)
keys.update(json.loads((ROOT / 'tools/i18n/extra-keys.json').read_text())['keys'])
keys.discard('Ludo')  # the game's name stays as it is
keys = sorted(k.replace("\\'", "'") for k in keys if re.search(r'[A-Za-z]', k))
(ROOT / 'tools/i18n/keys.json').write_text(json.dumps(keys, ensure_ascii=False, indent=0) + '\n')
print(f'{len(keys)} keys, {sum(len(k.split()) for k in keys)} words')

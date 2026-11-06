# Board textures

The seamless textures in `client/public/textures/` are generated here, not drawn by hand:
each `<svg id="name">` in `ocean.html` (Ocean) or `boards.html` (every other theme) is a texture made with SVG noise and lighting
filters (feTurbulence, feDiffuseLighting…), so it can be tweaked and re-rendered at any time.

To re-render (needs Node, `playwright-core` and `@sparticuz/chromium` installed somewhere):

    node render.mjs "$PWD/ocean.html" /tmp/out     # writes /tmp/out/<id>.jpg for every <svg id>
    node render.mjs "$PWD/boards.html" /tmp/out

then copy the JPGs into `client/public/textures/` (ocean.html ids get an `ocean-` prefix;
boards.html ids already carry their theme name). Board themes use them
through `art.tex` and `art.under` in `client/skins.js`.

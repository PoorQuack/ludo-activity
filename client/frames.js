// Profile frames (shop type 'frame', VIP, paid in gems): a ring drawn around an avatar, in CSS
// (.pf[data-frame=…] in style.css). The same element is used in the menu's top bar, the seats,
// the players' list and the shop's previews, so a frame looks the same everywhere.

// Wraps `inner` (an <img> or any element; a plain silhouette if none) in a frame.
export function framedAvatar(frameId, inner = null, size = 40) {
  const pf = document.createElement('span');
  pf.className = 'pf';
  pf.style.setProperty('--pf', `${size}px`);
  setFrame(pf, frameId);
  const face = inner || document.createElement('span');
  if (!inner) face.className = 'pf-blank';
  face.classList.add('pf-face');
  pf.appendChild(face);
  return pf;
}

// Puts a frame on (or takes it off) an existing .pf element
export function setFrame(pf, frameId) {
  if (frameId && frameId !== 'frame-none') pf.dataset.frame = frameId;
  else delete pf.dataset.frame;
}

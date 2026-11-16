// Each special token's own way of going back to base when it is captured
// (TOKEN_SIGNATURES in skins.js says which token does what).
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutBack = (k) => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2;

// Where a captured token with a way of its own is, `k` (0..1) of the way through its trip from `from` to its
// base spot `to`. Returns what the renderer needs: { x, y, lift, squash, scale, alpha }.
// `once(tag)` is true the first time it is asked, for the bursts along the way.
// `sound(name)`: plays the trip's own sound, once, as it sets off (audio.js has one per `home`).
export function signatureHome(sig, k, from, to, once, renderer, sound = null) {
  if (sound && once('sound')) sound(sig.home);
  const puff = (p, n = 14, speed = 3) => renderer.burst(p.x, p.y, sig.colors, { count: n, speed, life: 650, size: 0.12 });
  if (sig.home === 'launch' || sig.home === 'beam') {
    // up and away from where it stood, then straight down onto its base
    const up = sig.home === 'launch' ? 0.42 : 0.5;
    if (k < 0.12) {
      // (the rocket shudders on the pad first; the saucer is caught in the beam)
      if (once('start')) puff(from, 10, 2);
      return { x: from.x + (sig.home === 'launch' ? Math.sin(k * 260) * 0.05 : 0), y: from.y, lift: 0.1, squash: sig.home === 'launch' ? 0.9 : 1 };
    }
    if (k < up) {
      const a = (k - 0.12) / (up - 0.12);
      const rise = sig.home === 'launch' ? a * a : easeInOut(a);
      if (sig.home === 'launch' && Math.random() < 0.6) renderer.burst(from.x, from.y - rise * 9, sig.colors, { count: 2, speed: 1.2, life: 500, size: 0.14 });
      return { x: from.x, y: from.y, lift: rise * 22, squash: sig.home === 'launch' ? 1.12 : 1, scale: 1 - 0.35 * rise, alpha: sig.home === 'beam' ? 1 - 0.7 * rise : 1 };
    }
    const d = (k - up) / (1 - up);
    const fall = 1 - (sig.home === 'launch' ? easeOutCubic(d) : easeInOut(d));
    if (d > 0.97 && once('land')) {
      puff(to, 18, 3.5);
      renderer.ring(to.x, to.y, sig.colors[0], 0.9);
    }
    return { x: to.x, y: to.y, lift: fall * 22, squash: d > 0.9 ? 0.85 : 1, scale: 1 - 0.35 * fall, alpha: sig.home === 'beam' ? 1 - 0.7 * fall : 1 };
  }
  if (sig.home === 'warp' || sig.home === 'coins') {
    // gone in a burst where it stood, back in a burst at its base
    if (k < 0.3) {
      const a = k / 0.3;
      return { x: from.x, y: from.y, lift: a * 0.8, squash: 1 + a * 0.3, scale: 1 - a, alpha: 1 - a * 0.5 };
    }
    if (once('gone')) puff(from, sig.home === 'coins' ? 26 : 18, sig.home === 'coins' ? 5 : 3);
    if (k < 0.62) return { x: to.x, y: to.y, lift: 0, squash: 1, scale: 0, alpha: 0 };
    if (once('back')) {
      puff(to, 16, 3);
      renderer.ring(to.x, to.y, sig.colors[0], 0.9);
    }
    const a = (k - 0.62) / 0.38;
    return { x: to.x, y: to.y, lift: (1 - a) * 0.6, squash: 1, scale: easeOutBack(a), alpha: Math.min(1, a * 2) };
  }
  const mid = (a) => ({ x: from.x + (to.x - from.x) * a, y: from.y + (to.y - from.y) * a });
  if (sig.home === 'fade') {
    // melts away where it stood, drifts back in over its base
    if (k < 0.4) return { x: from.x, y: from.y, lift: k * 2.5, squash: 1, alpha: 1 - k / 0.4 };
    if (once('gone')) puff(from, 8, 1.5);
    if (k < 0.55) return { x: to.x, y: to.y, lift: 1, squash: 1, alpha: 0 };
    const a = (k - 0.55) / 0.45;
    return { x: to.x, y: to.y, lift: (1 - easeInOut(a)) * 1, squash: 1, alpha: a };
  }
  if (sig.home === 'splat') {
    // flattens into a puddle, oozes home along the ground, pops back up
    if (once('splat')) puff(from, 12, 3);
    if (k < 0.2) return { x: from.x, y: from.y, lift: 0, squash: 1 - 0.75 * (k / 0.2) };
    if (k < 0.8) return { ...mid(easeInOut((k - 0.2) / 0.6)), lift: 0, squash: 0.25 + 0.05 * Math.sin(k * 60) };
    if (once('pop')) puff(to, 8, 2);
    return { x: to.x, y: to.y, lift: 0, squash: 0.25 + 0.75 * easeOutBack((k - 0.8) / 0.2) };
  }
  if (sig.home === 'bounce') {
    // hops home, a puff at every landing
    const n = sig.hops || 3;
    const h = Math.min(n - 1, Math.floor(k * n));
    const t = k * n - h;
    if (h > 0 && once(`hop${h}`)) puff(mid(h / n), 5, 1.5);
    if (k > 0.97 && once('land')) puff(to, 8, 2);
    return { ...mid((h + easeInOut(Math.min(1, t))) / n), lift: Math.sin(Math.PI * Math.min(1, t)) * (4.5 / n + 0.6), squash: t < 0.15 ? 0.8 : 1 };
  }
  if (sig.home === 'slide') {
    // down on its belly and away, snow spraying behind
    if (k < 0.15) return { x: from.x, y: from.y, lift: 0, squash: 1 - 0.5 * (k / 0.15) };
    if (k < 0.85) {
      const p = mid(easeOutCubic((k - 0.15) / 0.7));
      if (Math.random() < 0.5) renderer.burst(p.x, p.y, sig.colors, { count: 1, speed: 1.2, life: 380, size: 0.1 });
      return { ...p, lift: 0, squash: 0.5 };
    }
    return { x: to.x, y: to.y, lift: 0, squash: 0.5 + 0.5 * easeOutBack((k - 0.85) / 0.15) };
  }
  if (sig.home === 'blink') {
    // flickers out where it stood, flickers back in at its base
    const on = Math.floor(k * 22) % 2 === 0;
    if (k < 0.45) return { x: from.x, y: from.y, lift: 0, squash: 1, alpha: on ? 1 - k : 0.1 };
    if (once('jump')) {
      puff(from, 8, 2);
      puff(to, 8, 2);
    }
    return { x: to.x, y: to.y, lift: 0, squash: 1, alpha: on || k > 0.9 ? Math.min(1, k + 0.2) : 0.15 };
  }
  // fly: a long, high arc on its own wings, embers falling behind it
  const a = easeInOut(k);
  const p = { x: from.x + (to.x - from.x) * a, y: from.y + (to.y - from.y) * a };
  if (Math.random() < 0.35) renderer.burst(p.x, p.y - Math.sin(Math.PI * k) * 2, sig.colors, { count: 1, speed: 0.8, life: 600, size: 0.11 });
  if (k > 0.97 && once('land')) puff(to, 12, 2.5);
  return { ...p, lift: Math.sin(Math.PI * k) * 5.5 + Math.sin(k * 40) * 0.25, squash: 1 };
}

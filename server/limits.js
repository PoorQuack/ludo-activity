// Rate limiting: a token bucket for "how fast" and a fixed-window counter for "how many per key".
// The clock is injectable (`now`) so tests don't have to wait real time.

export class TokenBucket {
  constructor({ capacity, refillPerSec, now = Date.now }) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.now = now;
    this.tokens = capacity;
    this.last = now();
  }

  // Takes n tokens if they're there; returns false (and takes nothing) when the bucket is empty.
  take(n = 1) {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSec);
    this.last = t;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

export class KeyedLimiter {
  constructor({ max, windowMs, now = Date.now }) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.windows = new Map(); // key -> { count, reset }
    this.calls = 0;
  }

  // Counts one hit for `key`; returns true while under `max` hits in the current window.
  hit(key) {
    if (++this.calls % 100 === 0) this.prune();
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t >= w.reset) {
      w = { count: 0, reset: t + this.windowMs };
      this.windows.set(key, w);
    }
    w.count += 1;
    return w.count <= this.max;
  }

  prune() {
    const t = this.now();
    for (const [key, w] of this.windows) if (t >= w.reset) this.windows.delete(key);
  }
}

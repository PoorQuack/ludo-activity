// Testing only: players whose dice are rigged (set from the VM with scripts/rig-dice.sh).
// Kept in memory, so a server restart clears it, and each entry runs out on its own.
// A rigged player starts every turn with two 6s; games with a rigged roll pay no coins or points.
const rigged = new Map(); // userId -> expires at (ms)

export function rig(userId, minutes) {
  rigged.set(userId, Date.now() + minutes * 60_000);
}

export function unrig(userId) {
  rigged.delete(userId);
}

export function isRigged(userId) {
  const until = rigged.get(userId);
  if (!until) return false;
  if (Date.now() < until) return true;
  rigged.delete(userId);
  return false;
}

export function riggedList() {
  return [...rigged].filter(([id]) => isRigged(id)).map(([userId, until]) => ({ userId, minutesLeft: Math.ceil((until - Date.now()) / 60_000) }));
}

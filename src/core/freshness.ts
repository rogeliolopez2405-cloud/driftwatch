/**
 * Freshness: the one idea Driftwatch is actually about.
 *
 * A reading is not wrong when it gets old, it is just old, and the board has to
 * say so. Everything here is pure so the tests can hand it a fixed `now`.
 */

/** Milliseconds between a reading's timestamp and `now`. Never negative. */
export function ageMs(at: string, now: number = Date.now()): number {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - t);
}

/** A reading is fresh while its age is within its TTL. */
export function isFresh(at: string, ttlMs: number, now: number = Date.now()): boolean {
  return ageMs(at, now) <= ttlMs;
}

/** How much of the TTL has been used, clamped to 0..1, for the meter on a card. */
export function staleness(at: string, ttlMs: number, now: number = Date.now()): number {
  if (ttlMs <= 0) return 1;
  const used = ageMs(at, now) / ttlMs;
  if (!Number.isFinite(used)) return 1;
  return Math.min(1, Math.max(0, used));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "8m ago", "3h ago", "2d ago". Deliberately coarse. */
export function describeAge(at: string, now: number = Date.now()): string {
  const ms = ageMs(at, now);
  if (!Number.isFinite(ms)) return 'unknown';
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return Math.floor(ms / MINUTE) + 'm ago';
  if (ms < DAY) return Math.floor(ms / HOUR) + 'h ago';
  return Math.floor(ms / DAY) + 'd ago';
}

/** "30m", "6h", "1d" - for showing a TTL next to a card. */
export function describeDuration(ms: number): string {
  if (ms < HOUR) return Math.round(ms / MINUTE) + 'm';
  if (ms < DAY) return Math.round(ms / HOUR) + 'h';
  return Math.round(ms / DAY) + 'd';
}

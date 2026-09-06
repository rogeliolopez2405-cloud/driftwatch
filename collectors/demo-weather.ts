/**
 * DEMO COLLECTOR - every value here is invented.
 *
 * Port Meridian is not a real place and this collector never touches a network.
 * It exists to show a card that is fresh now and will go stale on its own if
 * you leave the board open long enough.
 */

import type { Collector, Reading } from '../src/core/types.ts';

const MINUTE = 60_000;

/** Deterministic pseudo-random, so the demo board looks the same everywhere. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const conditions = ['overcast', 'light rain', 'clear', 'fog'];

const collector: Collector = {
  id: 'demo-weather',
  label: 'Demo weather',
  intervalMs: 15 * MINUTE,
  ttlMs: 30 * MINUTE,
  synthetic: true,

  collect(): Reading[] {
    const rng = seeded(20260906);
    const temperature = 12 + Math.round(rng() * 4);
    const condition = conditions[Math.floor(rng() * conditions.length)];
    const at = new Date().toISOString();

    return [
      {
        key: 'demo.weather.temperature',
        label: 'Port Meridian temperature',
        value: temperature,
        unit: 'degC',
        note: 'Synthetic. No network request is made.',
        at,
      },
      {
        key: 'demo.weather.condition',
        label: 'Port Meridian conditions',
        value: condition,
        note: 'Synthetic.',
        at,
      },
    ];
  },
};

export default collector;

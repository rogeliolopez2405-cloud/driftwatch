/**
 * DEMO COLLECTOR - every value here is invented.
 *
 * `atlas-mono` is not a real repository. This collector reports a value whose
 * timestamp is deliberately older than its TTL, so the board has something in
 * the Needs attention lane the first time you open it. That is what a stale
 * card looks like: the number is not wrong, it is just out of date.
 */

import type { Collector, Reading } from '../src/core/types.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const collector: Collector = {
  id: 'demo-project',
  label: 'Demo project',
  intervalMs: 30 * MINUTE,
  ttlMs: 6 * HOUR,
  synthetic: true,

  collect(): Reading[] {
    // Eight hours old against a six hour TTL: stale on arrival, on purpose.
    const at = new Date(Date.now() - 8 * HOUR).toISOString();

    return [
      {
        key: 'demo.project.open',
        label: 'atlas-mono open tasks',
        value: 7,
        unit: 'task',
        note: 'Synthetic. Timestamped 8h ago so it arrives stale.',
        at,
      },
    ];
  },
};

export default collector;

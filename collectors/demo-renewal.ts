/**
 * DEMO COLLECTOR - every value here is invented.
 *
 * Kestrel Hosting is not a real vendor and this collector knows nothing about
 * money. It reports a date, and a rule turns "that date is close" into a flag.
 *
 * A date is the right shape for a demo like this. Driftwatch has no financial
 * concepts, ships no payment or banking collector, and nothing in this file
 * should be read as a template for storing account information.
 */

import type { Collector, Reading } from '../src/core/types.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const collector: Collector = {
  id: 'demo-renewal',
  label: 'Demo renewal',
  intervalMs: 6 * HOUR,
  ttlMs: 24 * HOUR,
  synthetic: true,

  collect(): Reading[] {
    const renewsAt = new Date(Date.now() + 5 * DAY);

    return [
      {
        key: 'demo.renewal.kestrel',
        label: 'Kestrel Hosting renews',
        value: renewsAt.toISOString(),
        note: 'Synthetic. Five days out, so the due-soon rule fires.',
        at: new Date().toISOString(),
      },
    ];
  },
};

export default collector;

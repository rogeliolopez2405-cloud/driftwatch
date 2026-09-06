/**
 * DEMO COLLECTOR - every value here is invented.
 *
 * There is no Workshop Sensor 3. The battery reading is below the threshold in
 * config/driftwatch.example.json, so this card shows what a rule-raised flag
 * looks like next to a card that is perfectly fresh.
 */

import type { Collector, Reading } from '../src/core/types.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const collector: Collector = {
  id: 'demo-device',
  label: 'Demo device',
  intervalMs: 60 * MINUTE,
  ttlMs: 12 * HOUR,
  synthetic: true,

  collect(): Reading[] {
    const at = new Date().toISOString();

    return [
      {
        key: 'demo.device.battery',
        label: 'Workshop Sensor 3 battery',
        value: 18,
        unit: '%',
        note: 'Synthetic. Below the 20% rule, so it raises the low flag.',
        at,
      },
      {
        key: 'demo.device.online',
        label: 'Workshop Sensor 3 online',
        value: true,
        note: 'Synthetic.',
        at,
      },
    ];
  },
};

export default collector;

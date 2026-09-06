/**
 * Copy this file into `collectors/` and change it.
 *
 * A collector is one object with one method. Whatever `collect()` returns gets
 * normalized into readings and stored. If it throws, Driftwatch records the
 * error against this collector and carries on with the others.
 */

import type { Collector, Reading } from '../../src/core/types.ts';

const MINUTE = 60_000;

const collector: Collector = {
  // Stable id. Conventionally the file name without its extension.
  id: 'my-first-collector',

  // Shown in logs and in the card drawer.
  label: 'My first collector',

  // How often Driftwatch calls collect().
  intervalMs: 5 * MINUTE,

  // TTL: how long a reading from this collector stays fresh. Past this, the
  // card is marked stale and moves into Needs attention on its own.
  ttlMs: 15 * MINUTE,

  // Set this on anything that returns invented values.
  synthetic: true,

  async collect(): Promise<Reading[]> {
    // Do whatever you like here: read a file, call an API you have access to,
    // shell out to a command. Driftwatch does not care, as long as you return
    // readings.
    //
    // If you call an API that needs a key, read it from your own environment.
    // Driftwatch never stores credentials and never asks you for one.

    return [
      {
        key: 'example.uptime.seconds',
        label: 'Process uptime',
        value: Math.round(process.uptime()),
        unit: 's',
        at: new Date().toISOString(),
      },
    ];
  },
};

export default collector;

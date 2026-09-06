/**
 * The runner: ask collectors for readings, normalize them, write them down.
 *
 * `collectOnce` is the whole of it. `startLoop` just calls it on a timer.
 */

import { join } from 'node:path';

import type { Collector, Config, Reading, StoreShape, Value } from './types.ts';
import { load, record, save } from './store.ts';

export interface RunResult {
  collectorId: string;
  readings: number;
  error?: string;
}

function isValue(v: unknown): v is Value {
  return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
}

/**
 * NORMALIZE - coerce whatever a collector returned into a valid Reading, or
 * reject it with a message that names the collector. A collector that returns
 * junk should be easy to find, not silently ignored.
 */
export function normalize(raw: unknown, collectorId: string): Reading {
  if (!raw || typeof raw !== 'object') {
    throw new Error(collectorId + ' returned something that is not a reading');
  }
  const r = raw as Partial<Reading>;

  if (typeof r.key !== 'string' || !r.key.trim()) {
    throw new Error(collectorId + ' returned a reading with no key');
  }
  if (!isValue(r.value)) {
    throw new Error(collectorId + ' reading "' + r.key + '" has a value that is not a number, string or boolean');
  }

  const at = typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at))
    ? new Date(r.at).toISOString()
    : new Date().toISOString();

  const reading: Reading = { key: r.key.trim(), value: r.value, at };
  if (typeof r.unit === 'string') reading.unit = r.unit;
  if (typeof r.label === 'string') reading.label = r.label;
  if (typeof r.note === 'string') reading.note = r.note;
  return reading;
}

/** Run every collector once and persist what came back. */
export async function collectOnce(
  root: string,
  config: Config,
  collectors: Collector[],
): Promise<RunResult[]> {
  const file = join(root, config.storeFile);
  let store: StoreShape = load(file);
  const results: RunResult[] = [];

  for (const collector of collectors) {
    try {
      const raw = await collector.collect();
      const list = Array.isArray(raw) ? raw : [raw];
      for (const item of list) {
        const reading = normalize(item, collector.id);
        store = record(store, reading, {
          collectorId: collector.id,
          ttlMs: collector.ttlMs,
          synthetic: collector.synthetic === true,
          historyLength: config.historyLength,
        });
      }
      results.push({ collectorId: collector.id, readings: list.length });
    } catch (err) {
      // One broken collector must not stop the others.
      results.push({ collectorId: collector.id, readings: 0, error: (err as Error).message });
    }
  }

  save(file, store);
  return results;
}

export interface Loop {
  stop(): void;
}

/**
 * Run each collector on its own interval.
 *
 * Every collector is also run once immediately, so a freshly started board is
 * never blank while you wait for the first tick.
 */
export function startLoop(root: string, config: Config, collectors: Collector[]): Loop {
  const timers: Array<ReturnType<typeof setInterval>> = [];

  for (const collector of collectors) {
    const tick = () => { void collectOnce(root, config, [collector]); };
    tick();
    const timer = setInterval(tick, Math.max(1000, collector.intervalMs));
    timer.unref?.();
    timers.push(timer);
  }

  return {
    stop() {
      for (const t of timers) clearInterval(t);
      timers.length = 0;
    },
  };
}

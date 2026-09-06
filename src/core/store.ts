/**
 * The store: one JSON file holding the latest reading per key.
 *
 * Deliberately not a database. The whole point of Driftwatch is that the state
 * it keeps is small enough to open in a text editor and understand.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Reading, StoreShape, StoredEntry, Value } from './types.ts';

const EMPTY: StoreShape = { version: 1, entries: {} };

export function emptyStore(): StoreShape {
  return { version: 1, entries: {} };
}

export function load(file: string): StoreShape {
  if (!existsSync(file)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as StoreShape;
    if (parsed && parsed.version === 1 && parsed.entries) return parsed;
    return emptyStore();
  } catch {
    // A corrupt store is not worth crashing over; the next collect refills it.
    return emptyStore();
  }
}

/**
 * Write atomically: a temp file in the same directory, then a rename.
 *
 * A half-written store read by the server mid-write would show a board that
 * never existed, which is worse than showing the previous one.
 */
export function save(file: string, store: StoreShape): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
}

export interface RecordOptions {
  collectorId: string;
  ttlMs: number;
  synthetic: boolean;
  historyLength: number;
}

/**
 * Put one reading into the store, keeping a short ring buffer of past values.
 *
 * The buffer exists for the sparkline and nothing else. Driftwatch is not a
 * time-series database and does not pretend to be one.
 */
export function record(store: StoreShape, reading: Reading, opts: RecordOptions): StoreShape {
  const previous = store.entries[reading.key];
  const history: Array<{ at: string; value: Value }> = previous ? [...previous.history] : [];

  const last = history[history.length - 1];
  if (!last || last.at !== reading.at || last.value !== reading.value) {
    history.push({ at: reading.at, value: reading.value });
  }
  while (history.length > opts.historyLength) history.shift();

  const entry: StoredEntry = {
    reading,
    collectorId: opts.collectorId,
    ttlMs: opts.ttlMs,
    synthetic: opts.synthetic,
    history,
  };

  return {
    version: 1,
    entries: { ...store.entries, [reading.key]: entry },
  };
}

export function forget(store: StoreShape, key: string): StoreShape {
  const entries = { ...store.entries };
  delete entries[key];
  return { version: 1, entries };
}

export function clear(file: string): void {
  if (existsSync(file)) unlinkSync(file);
}

export const _emptyShape = EMPTY;

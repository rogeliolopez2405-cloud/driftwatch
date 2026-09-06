/**
 * EVALUATE - turn stored entries into cards, and cards into a board.
 *
 * This is where freshness and rules meet. It reads the store and computes; it
 * never writes, and it never calls a collector.
 */

import { join } from 'node:path';

import type { Board, Card, Config } from '../core/types.ts';
import { load } from '../core/store.ts';
import { ageMs, isFresh } from '../core/freshness.ts';
import { flagsFor } from '../core/rules.ts';

export function buildBoard(root: string, config: Config, now: number = Date.now()): Board {
  const store = load(join(root, config.storeFile));

  const cards: Card[] = Object.values(store.entries).map((entry) => {
    const { reading } = entry;
    return {
      key: reading.key,
      label: reading.label ?? reading.key,
      value: reading.value,
      unit: reading.unit,
      note: reading.note,
      at: reading.at,
      ageMs: ageMs(reading.at, now),
      ttlMs: entry.ttlMs,
      fresh: isFresh(reading.at, entry.ttlMs, now),
      synthetic: entry.synthetic,
      collectorId: entry.collectorId,
      flags: flagsFor(reading, entry.ttlMs, config.rules, now),
      history: entry.history,
    };
  });

  // Flagged first, then oldest first, then alphabetical. A board should put
  // what is wrong at the top without the reader having to sort it.
  cards.sort((a, b) => {
    if (a.flags.length !== b.flags.length) return b.flags.length - a.flags.length;
    if (a.ageMs !== b.ageMs) return b.ageMs - a.ageMs;
    return a.key.localeCompare(b.key);
  });

  return {
    generatedAt: new Date(now).toISOString(),
    cards,
    attention: cards.filter((c) => c.flags.length > 0),
  };
}

/** Everything the board page needs, in one response. */
export function boardPayload(root: string, config: Config, now: number = Date.now()) {
  const board = buildBoard(root, config, now);
  return {
    generatedAt: board.generatedAt,
    counts: {
      cards: board.cards.length,
      attention: board.attention.length,
      stale: board.cards.filter((c) => !c.fresh).length,
    },
    cards: board.cards,
  };
}

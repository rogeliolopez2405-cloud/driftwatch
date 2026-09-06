/**
 * Driftwatch - the whole vocabulary.
 *
 * Eight nouns. If you find yourself wanting a ninth, that is usually a sign the
 * thing you want belongs in a collector rather than in the core.
 */

/** A value that is either a number, a string, or a boolean. Nothing else. */
export type Value = number | string | boolean;

/**
 * READING - one timestamped value.
 *
 * `at` is an ISO 8601 string, not an epoch number, so a stored board stays
 * readable by a human and never looks like an account number to a scanner.
 */
export interface Reading {
  /** KEY - a dotted name for what was measured. `demo.device.battery` */
  key: string;
  value: Value;
  /** Display unit, if the value has one. `%`, `degC`, `task`, `day` */
  unit?: string;
  /** ISO 8601 timestamp of when the value was true, not when it was stored. */
  at: string;
  /** Human label for the card. Falls back to the key. */
  label?: string;
  /** Free-form note the collector wants shown under the value. */
  note?: string;
}

/**
 * COLLECTOR - something that produces readings.
 *
 * A collector is one file exporting one object. It may do whatever it likes
 * inside `collect()` as long as it returns readings.
 */
export interface Collector {
  /** Stable identifier, conventionally the file name without its extension. */
  id: string;
  label: string;
  /** How often the runner should call `collect()`, in milliseconds. */
  intervalMs: number;
  /** TTL - how long this collector's readings stay fresh, in milliseconds. */
  ttlMs: number;
  /** True when every value is invented. Demo collectors must set this. */
  synthetic?: boolean;
  collect(): Promise<Reading[]> | Reading[];
}

/** How a RULE decides to raise a FLAG. */
export type RuleKind = 'below' | 'above' | 'equals' | 'withinDays';

/**
 * RULE - a predicate over one reading.
 *
 * Rules are declarative on purpose. A rule cannot read another reading, call
 * out to anything, or write state; it looks at one value and says yes or no.
 */
export interface Rule {
  id: string;
  /** Key this rule applies to, or a prefix ending in `*`. */
  key: string;
  kind: RuleKind;
  threshold: Value;
  /** FLAG raised when the rule matches. */
  flag: string;
}

/** FLAG - a named condition currently true of a card. */
export interface Flag {
  name: string;
  /** Why it fired, in words a person can read. */
  reason: string;
}

/** CARD - a key's current reading, plus what Driftwatch worked out about it. */
export interface Card {
  key: string;
  label: string;
  value: Value;
  unit?: string;
  note?: string;
  at: string;
  ageMs: number;
  ttlMs: number;
  fresh: boolean;
  synthetic: boolean;
  collectorId: string;
  flags: Flag[];
  /** Recent values, oldest first, for the sparkline. */
  history: Array<{ at: string; value: Value }>;
}

/** BOARD - every card, plus the subset that needs attention. */
export interface Board {
  generatedAt: string;
  cards: Card[];
  attention: Card[];
}

/** What actually lands on disk. */
export interface StoredEntry {
  reading: Reading;
  collectorId: string;
  ttlMs: number;
  synthetic: boolean;
  history: Array<{ at: string; value: Value }>;
}

export interface StoreShape {
  version: 1;
  entries: Record<string, StoredEntry>;
}

export interface Config {
  /** Port the board is served on. */
  port: number;
  /** Directory of collector modules, relative to the repository root. */
  collectorsDir: string;
  /** Where the store file lives, relative to the repository root. */
  storeFile: string;
  /** How many past values to keep per key, for the sparkline only. */
  historyLength: number;
  rules: Rule[];
}

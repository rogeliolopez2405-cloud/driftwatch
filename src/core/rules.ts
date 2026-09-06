/**
 * Rules and flags.
 *
 * A rule looks at exactly one reading and says yes or no. It cannot see another
 * reading, cannot call out to anything, and cannot write state. That limit is
 * deliberate: the moment rules can chain, the board stops being explainable.
 *
 * `stale` is the one flag Driftwatch raises on its own. Everything else comes
 * from the rules in the config file.
 */

import type { Flag, Reading, Rule, Value } from './types.ts';
import { describeAge, isFresh } from './freshness.ts';

/** A rule key matches exactly, or as a prefix when it ends in `*`. */
export function ruleMatchesKey(ruleKey: string, key: string): boolean {
  if (ruleKey.endsWith('*')) return key.startsWith(ruleKey.slice(0, -1));
  return ruleKey === key;
}

function asNumber(v: Value): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function daysUntil(v: Value, now: number): number | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  return (t - now) / 86_400_000;
}

/** Evaluate one rule against one reading. */
export function applyRule(rule: Rule, reading: Reading, now: number = Date.now()): Flag | null {
  if (!ruleMatchesKey(rule.key, reading.key)) return null;

  const shown = String(reading.value) + (reading.unit ? ' ' + reading.unit : '');

  if (rule.kind === 'equals') {
    return reading.value === rule.threshold
      ? { name: rule.flag, reason: shown + ' equals ' + String(rule.threshold) }
      : null;
  }

  if (rule.kind === 'withinDays') {
    const days = daysUntil(reading.value, now);
    const limit = asNumber(rule.threshold);
    if (days === null || limit === null) return null;
    return days <= limit
      ? { name: rule.flag, reason: 'due in ' + Math.max(0, Math.round(days)) + ' day(s)' }
      : null;
  }

  const value = asNumber(reading.value);
  const limit = asNumber(rule.threshold);
  if (value === null || limit === null) return null;

  if (rule.kind === 'below') {
    return value < limit
      ? { name: rule.flag, reason: shown + ' is below ' + String(limit) }
      : null;
  }
  if (rule.kind === 'above') {
    return value > limit
      ? { name: rule.flag, reason: shown + ' is above ' + String(limit) }
      : null;
  }
  return null;
}

/**
 * Every flag currently true of a reading: the built-in staleness flag first,
 * then whatever the configured rules say.
 */
export function flagsFor(
  reading: Reading,
  ttlMs: number,
  rules: Rule[],
  now: number = Date.now(),
): Flag[] {
  const flags: Flag[] = [];

  if (!isFresh(reading.at, ttlMs, now)) {
    flags.push({ name: 'stale', reason: 'last read ' + describeAge(reading.at, now) });
  }

  for (const rule of rules) {
    const flag = applyRule(rule, reading, now);
    if (flag) flags.push(flag);
  }

  return flags;
}

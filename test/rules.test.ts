import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyRule, flagsFor, ruleMatchesKey } from '../src/core/rules.ts';
import type { Reading, Rule } from '../src/core/types.ts';

const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const fresh = (over: Partial<Reading> = {}): Reading => ({
  key: 'demo.device.battery',
  value: 18,
  unit: '%',
  at: new Date(NOW).toISOString(),
  ...over,
});

const low: Rule = { id: 'battery-low', key: 'demo.device.battery', kind: 'below', threshold: 20, flag: 'low' };

test('an exact key matches and a different key does not', () => {
  assert.equal(ruleMatchesKey('a.b', 'a.b'), true);
  assert.equal(ruleMatchesKey('a.b', 'a.c'), false);
});

test('a trailing star matches by prefix', () => {
  assert.equal(ruleMatchesKey('demo.renewal.*', 'demo.renewal.kestrel'), true);
  assert.equal(ruleMatchesKey('demo.renewal.*', 'demo.device.battery'), false);
});

test('below fires under the threshold and not on or above it', () => {
  assert.equal(applyRule(low, fresh({ value: 18 }), NOW)?.name, 'low');
  assert.equal(applyRule(low, fresh({ value: 20 }), NOW), null);
  assert.equal(applyRule(low, fresh({ value: 55 }), NOW), null);
});

test('above fires over the threshold', () => {
  const hot: Rule = { id: 'hot', key: 'a', kind: 'above', threshold: 30, flag: 'hot' };
  assert.equal(applyRule(hot, fresh({ key: 'a', value: 31 }), NOW)?.name, 'hot');
  assert.equal(applyRule(hot, fresh({ key: 'a', value: 30 }), NOW), null);
});

test('equals compares the value as given, including booleans', () => {
  const offline: Rule = { id: 'offline', key: 'a', kind: 'equals', threshold: false, flag: 'offline' };
  assert.equal(applyRule(offline, fresh({ key: 'a', value: false }), NOW)?.name, 'offline');
  assert.equal(applyRule(offline, fresh({ key: 'a', value: true }), NOW), null);
});

test('withinDays fires as a date approaches and not while it is far off', () => {
  const due: Rule = { id: 'due', key: 'demo.renewal.*', kind: 'withinDays', threshold: 7, flag: 'due-soon' };
  const at = new Date(NOW).toISOString();

  const soon = fresh({ key: 'demo.renewal.kestrel', value: new Date(NOW + 5 * DAY).toISOString(), at });
  const later = fresh({ key: 'demo.renewal.kestrel', value: new Date(NOW + 30 * DAY).toISOString(), at });

  assert.equal(applyRule(due, soon, NOW)?.name, 'due-soon');
  assert.equal(applyRule(due, later, NOW), null);
});

test('a numeric rule against a non-numeric value is ignored, not an error', () => {
  assert.equal(applyRule(low, fresh({ value: 'unknown' }), NOW), null);
});

test('a rule for another key never fires', () => {
  assert.equal(applyRule(low, fresh({ key: 'somewhere.else', value: 1 }), NOW), null);
});

test('stale is raised by the core, without any configured rule', () => {
  const old = fresh({ at: new Date(NOW - 8 * HOUR).toISOString() });
  const flags = flagsFor(old, 6 * HOUR, [], NOW);

  assert.equal(flags.length, 1);
  assert.equal(flags[0].name, 'stale');
  assert.match(flags[0].reason, /8h ago/);
});

test('a fresh reading with no matching rule has no flags at all', () => {
  assert.deepEqual(flagsFor(fresh({ value: 90 }), 6 * HOUR, [low], NOW), []);
});

test('staleness and a rule flag can both be true at once', () => {
  const old = fresh({ value: 5, at: new Date(NOW - 8 * HOUR).toISOString() });
  const flags = flagsFor(old, 6 * HOUR, [low], NOW);

  assert.deepEqual(flags.map((f) => f.name), ['stale', 'low']);
});

test('a flag reason says something a person can act on', () => {
  const flags = flagsFor(fresh({ value: 5 }), HOUR, [low], NOW);
  assert.equal(flags[0].reason, '5 % is below 20');
});

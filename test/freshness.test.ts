import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ageMs, isFresh, staleness, describeAge, describeDuration } from '../src/core/freshness.ts';

const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ago = (ms: number) => new Date(NOW - ms).toISOString();

test('age is the distance back to the reading', () => {
  assert.equal(ageMs(ago(5 * MINUTE), NOW), 5 * MINUTE);
});

test('a reading from the future is age zero, not a negative age', () => {
  assert.equal(ageMs(new Date(NOW + HOUR).toISOString(), NOW), 0);
});

test('an unparseable timestamp is infinitely old, so it can never be fresh', () => {
  assert.equal(ageMs('not a date', NOW), Number.POSITIVE_INFINITY);
  assert.equal(isFresh('not a date', DAY, NOW), false);
});

test('a reading is fresh right up to its TTL and stale after it', () => {
  assert.equal(isFresh(ago(29 * MINUTE), 30 * MINUTE, NOW), true);
  assert.equal(isFresh(ago(30 * MINUTE), 30 * MINUTE, NOW), true);
  assert.equal(isFresh(ago(31 * MINUTE), 30 * MINUTE, NOW), false);
});

test('the demo project reading is stale on arrival', () => {
  // 8h old against a 6h TTL - this is what puts a card in Needs attention
  // the first time the board is opened.
  assert.equal(isFresh(ago(8 * HOUR), 6 * HOUR, NOW), false);
});

test('staleness is the fraction of TTL used, clamped to 0..1', () => {
  assert.equal(staleness(ago(0), HOUR, NOW), 0);
  assert.equal(staleness(ago(HOUR / 2), HOUR, NOW), 0.5);
  assert.equal(staleness(ago(HOUR), HOUR, NOW), 1);
  assert.equal(staleness(ago(10 * HOUR), HOUR, NOW), 1);
});

test('a zero TTL is always fully stale rather than dividing by zero', () => {
  assert.equal(staleness(ago(0), 0, NOW), 1);
});

test('ages read the way a person would say them', () => {
  assert.equal(describeAge(ago(10_000), NOW), 'just now');
  assert.equal(describeAge(ago(8 * MINUTE), NOW), '8m ago');
  assert.equal(describeAge(ago(3 * HOUR), NOW), '3h ago');
  assert.equal(describeAge(ago(2 * DAY), NOW), '2d ago');
});

test('durations read the way a TTL is written', () => {
  assert.equal(describeDuration(30 * MINUTE), '30m');
  assert.equal(describeDuration(6 * HOUR), '6h');
  assert.equal(describeDuration(2 * DAY), '2d');
});

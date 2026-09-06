import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { emptyStore, load, save, record, forget } from '../src/core/store.ts';
import { normalize } from '../src/core/run.ts';
import type { Reading } from '../src/core/types.ts';

const OPTS = { collectorId: 'test', ttlMs: 60_000, synthetic: true, historyLength: 3 };

function reading(over: Partial<Reading> = {}): Reading {
  return { key: 'a.b', value: 1, at: '2026-09-06T12:00:00.000Z', ...over };
}

test('a missing store file loads as empty rather than throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dw-store-'));
  try {
    const store = load(join(dir, 'nope', 'store.json'));
    assert.equal(store.version, 1);
    assert.deepEqual(store.entries, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt store file loads as empty rather than throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dw-store-'));
  try {
    const file = join(dir, 'store.json');
    save(file, emptyStore());
    rmSync(file);
    writeFileSync(file, '{ this is not json', 'utf8');
    assert.deepEqual(load(file).entries, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('save then load round-trips a reading', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dw-store-'));
  try {
    const file = join(dir, 'nested', 'store.json');
    const store = record(emptyStore(), reading(), OPTS);
    save(file, store);

    const back = load(file);
    assert.equal(back.entries['a.b'].reading.value, 1);
    assert.equal(back.entries['a.b'].collectorId, 'test');
    assert.equal(back.entries['a.b'].synthetic, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('save leaves no temp file behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dw-store-'));
  try {
    const file = join(dir, 'store.json');
    save(file, record(emptyStore(), reading(), OPTS));
    assert.throws(() => readFileSync(file + '.tmp'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recording keeps only the latest reading per key', () => {
  let store = record(emptyStore(), reading({ value: 1 }), OPTS);
  store = record(store, reading({ value: 2, at: '2026-09-06T13:00:00.000Z' }), OPTS);

  assert.equal(Object.keys(store.entries).length, 1);
  assert.equal(store.entries['a.b'].reading.value, 2);
});

test('history is a ring buffer capped at historyLength', () => {
  let store = emptyStore();
  for (let i = 0; i < 6; i += 1) {
    store = record(store, reading({ value: i, at: '2026-09-06T1' + i + ':00:00.000Z' }), OPTS);
  }

  const { history } = store.entries['a.b'];
  assert.equal(history.length, 3);
  assert.deepEqual(history.map((h) => h.value), [3, 4, 5]);
});

test('an identical repeated reading does not grow history', () => {
  let store = record(emptyStore(), reading(), OPTS);
  store = record(store, reading(), OPTS);
  assert.equal(store.entries['a.b'].history.length, 1);
});

test('forget removes one key and leaves the others', () => {
  let store = record(emptyStore(), reading({ key: 'a.b' }), OPTS);
  store = record(store, reading({ key: 'c.d' }), OPTS);
  store = forget(store, 'a.b');

  assert.deepEqual(Object.keys(store.entries), ['c.d']);
});

test('normalize rejects a reading with no key', () => {
  assert.throws(() => normalize({ value: 1 }, 'demo'), /no key/);
});

test('normalize rejects a value that is not a scalar', () => {
  assert.throws(() => normalize({ key: 'a', value: { nested: true } }, 'demo'), /not a number/);
});

test('normalize stamps a missing timestamp and keeps a valid one', () => {
  const stamped = normalize({ key: 'a', value: 1 }, 'demo');
  assert.ok(!Number.isNaN(Date.parse(stamped.at)));

  const kept = normalize({ key: 'a', value: 1, at: '2026-09-06T12:00:00.000Z' }, 'demo');
  assert.equal(kept.at, '2026-09-06T12:00:00.000Z');
});

test('normalize replaces an unparseable timestamp rather than storing it', () => {
  const r = normalize({ key: 'a', value: 1, at: 'sometime last week' }, 'demo');
  assert.ok(!Number.isNaN(Date.parse(r.at)));
});

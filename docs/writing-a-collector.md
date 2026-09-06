# Writing a collector

A collector is one file exporting one object. There is no registration step and
no plugin manifest — dropping a file in `collectors/` is the whole install.

```sh
cp examples/my-first-collector/collector.ts collectors/disk.ts
npm run once
```

## The shape

```ts
import type { Collector, Reading } from '../src/core/types.ts';

const collector: Collector = {
  id: 'disk',
  label: 'Disk',
  intervalMs: 5 * 60_000,
  ttlMs: 15 * 60_000,
  synthetic: false,

  async collect(): Promise<Reading[]> {
    return [{ key: 'disk.free', value: 41, unit: 'GB', at: new Date().toISOString() }];
  },
};

export default collector;
```

Files starting with `_` are skipped, which is where shared helpers go.

## Interval is not TTL

This is the decision people get wrong, so it is worth stating plainly.

- **`intervalMs`** is how often Driftwatch *asks*.
- **`ttlMs`** is how long the answer stays worth believing.

Set them equal and you get a card that flickers between fresh and stale on every
tick. Give the TTL headroom — roughly twice the interval is a sane starting
point, and much more than that when the underlying thing changes slowly.

A quarterly figure might be collected hourly and stay trustworthy for ninety
days. A queue depth might be collected every minute and be worthless after five.

## Timestamp the value, not the collection

`at` defaults to now, which is right when you just measured something. It is
wrong when you are reporting a value that was true earlier.

```ts
// Right: the file says when it was written.
{ key: 'backup.size', value: size, at: stat.mtime.toISOString() }
```

Getting this right is what makes a card correctly stale rather than falsely
fresh, and staleness is the whole point of the tool.

## Return more than one reading

`collect()` may return an array. One collector often owns a small family of
related keys, and they share an interval and a TTL naturally.

## Failing

Throw. Driftwatch records the error against your collector's id and carries on
with the others. Do not return a sentinel value like `-1` or `"unknown"` — a
rule cannot tell that apart from a real reading, and the board will lie.

If a value is genuinely unavailable, returning nothing is fine. The previous
reading stays in the store and ages, which is exactly the signal you want.

## Marking synthetic data

Set `synthetic: true` on anything that returns invented values. The board shows
a **demo data** chip for those cards, so a made-up number is never mistaken for
a real one. All four collectors that ship with Driftwatch are marked this way.

## Credentials

If your collector needs an API key, read it from your own environment inside
`collect()`.

Driftwatch has no credential store, no config field for a secret, and no way to
persist one. Nothing you hand a collector is written to the board or to the
store. That is deliberate: a tool that never holds a credential cannot leak one.

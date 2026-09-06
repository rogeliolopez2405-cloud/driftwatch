# Your first collector

Three steps.

```sh
cp examples/my-first-collector/collector.ts collectors/uptime.ts
npm run once
npm start
```

That is the whole loop: write a file, run it once to see the reading, then serve
the board.

## What has to be in the file

A default export with five things on it:

| Field | Why |
| ----- | --- |
| `id` | Names the collector in logs and on the card. |
| `label` | What a person sees. |
| `intervalMs` | How often Driftwatch calls `collect()`. |
| `ttlMs` | How long its readings stay fresh before the card goes stale. |
| `collect()` | Returns one reading or an array of them. |

Set `synthetic: true` if the values are invented. The board shows a **demo
data** chip for anything marked that way, so a made-up number is never mistaken
for a real one.

## What a reading has to have

`key` and `value`. Everything else is optional.

```ts
{
  key: 'disk.free',        // dotted name, unique across your whole board
  value: 41,               // number, string or boolean
  unit: 'GB',              // optional, shown next to the value
  label: 'Disk free',      // optional, defaults to the key
  at: new Date().toISOString(), // optional, defaults to now
}
```

Leave `at` off and Driftwatch stamps it for you. Set it explicitly when the
value was true at some other time — that is what makes a card correctly stale
rather than falsely fresh.

## Picking a TTL

The TTL is the interesting decision, and it is not the same as the interval.

The interval is how often you *ask*. The TTL is how long the answer stays worth
believing. A weather reading might be collected every 15 minutes and stay
trustworthy for 30. A quarterly figure might be collected every hour and stay
trustworthy for 90 days.

When the two are equal you get a card that flickers between fresh and stale on
every tick. Give the TTL some headroom over the interval.

## Adding a rule

Rules live in `config/driftwatch.json`, not in the collector, so you can change a
threshold without editing code.

```json
{
  "id": "disk-low",
  "key": "disk.free",
  "kind": "below",
  "threshold": 20,
  "flag": "low"
}
```

`kind` is one of `below`, `above`, `equals`, or `withinDays`. A `key` ending in
`*` matches by prefix.

## When a collector needs a credential

Read it from your own environment inside `collect()`. Driftwatch has no
credential store, no config field for a secret, and no way to persist one — by
design. Nothing you give a collector is written to the board.

# Driftwatch

A small local status board for the handful of things you keep re-checking.

You write tiny collectors that return a reading. Driftwatch keeps the latest
reading for each key, knows when one has gone stale, evaluates a few simple
rules, and shows you one board with a **Needs attention** lane at the top.

Honestly described: cron, plus a cache, plus a dashboard — with staleness as a
first-class idea. It answers one question well.

> **Is anything I care about wrong, or quietly out of date?**

## Why it exists

You end up with four or five small facts scattered across scripts, APIs and
files. None of them justifies a time-series database and a Grafana instance, so
none of them gets a dashboard, so you check them by hand until you forget to.

Driftwatch is the smallest thing that fixes that. A collector is one file. A
board is one page. There is no account, no server to run, and nothing to
configure with a secret.

## Try it

```sh
git clone https://github.com/rogeliolopez2405-cloud/driftwatch.git
cd driftwatch
npm start
```

No install step — Driftwatch has **zero dependencies**, runtime and development
both. It needs Node 22.18 or newer, which runs the TypeScript sources directly.

The demo board comes up with four synthetic collectors already reporting:

```
  atlas-mono open tasks     7 task        8h ago    ttl 6h     [stale]
  Workshop Sensor 3 battery 18 %          just now  ttl 12h    [low]
  Kestrel Hosting renews    2026-09-11    just now  ttl 1d     [due-soon]
  Workshop Sensor 3 online  true          just now  ttl 12h
  Port Meridian conditions  overcast      just now  ttl 30m
  Port Meridian temperature 13 degC       just now  ttl 30m

  6 card(s), 3 need attention, 1 stale
```

Three of those cards want attention for three different reasons: one is past its
TTL, one tripped a threshold rule, one has a date coming up. Every value is
invented, and every card says so.

## Commands

```sh
npm start          # collect on each collector's interval and serve the board
npm run once       # collect once and print the board to the terminal
npm run board      # print the current board as JSON
npm test           # run the test suite
npm run check      # run the same privacy checks CI runs
```

## Your first collector

```sh
cp examples/my-first-collector/collector.ts collectors/disk.ts
npm run once
```

That is the whole install process. A collector is one object with one method:

```ts
import type { Collector, Reading } from '../src/core/types.ts';

const collector: Collector = {
  id: 'disk',
  label: 'Disk',
  intervalMs: 5 * 60_000,   // how often we ask
  ttlMs: 15 * 60_000,       // how long the answer stays worth believing

  async collect(): Promise<Reading[]> {
    return [{ key: 'disk.free', value: 41, unit: 'GB', at: new Date().toISOString() }];
  },
};

export default collector;
```

The interesting decision is the TTL, and it is not the interval. The interval is
how often you ask; the TTL is how long the answer stays true. Give the TTL some
headroom or the card flickers on every tick.

Flag rules live in `config/driftwatch.json`, not in collector code, so a
threshold changes without a code edit:

```json
{ "id": "disk-low", "key": "disk.free", "kind": "below", "threshold": 20, "flag": "low" }
```

## How it works

```
collect  ->  normalize  ->  store  ->  evaluate  ->  render
```

Eight nouns, and that is the whole vocabulary: **Collector**, **Reading**,
**Key**, **TTL**, **Rule**, **Flag**, **Card**, **Board**.

The store is one JSON file you can open in a text editor. Rules see one reading
each and cannot chain. The server binds to loopback. See
[docs/architecture.md](docs/architecture.md) for the decisions behind that.

## What Driftwatch does not do

Not "not yet" — these are decisions:

- No accounts, roles, or authentication. It is a localhost tool.
- No sync, no hosting, no telemetry, no analytics. It contacts nothing.
- No credential store, and no config field that takes a secret.
- No history beyond a short ring buffer for the sparkline.
- No derived readings — nothing computes one fact from another.
- No language model anywhere in the codebase.
- No real integrations. The four collectors that ship are synthetic; real ones
  are yours to write.

If you want any of those, Driftwatch is the wrong tool — but the board is about
a hundred lines of plain DOM and the core is under five hundred, so it is a
reasonable thing to fork.

## Publishing safely

`tools/release-gate/` holds a dependency-free secret and privacy scanner that
refuses to report a clean result until it has proved, in the same run, that it
can still catch things — one freshly randomised canary per active detector, plus
a negative control that must come back clean.

```sh
npm run check              # public checks: portable, fork-safe, self-contained
npm run check:detectors    # prove the detectors still work
```

These are exactly what CI runs on every push and every pull request, forks
included, so you can reproduce a CI result locally. Maintainers additionally run
an owner mode that requires a rule list held outside the repository; it is
described in [tools/release-gate/README.md](tools/release-gate/README.md).

The scanner is useful outside this project.

## Documentation

- [Architecture](docs/architecture.md) — the five stages and the decisions.
- [Writing a collector](docs/writing-a-collector.md) — including the TTL trap.
- [Configuration](docs/configuration.md) — rules, ports, and what is not configurable.
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## License

MIT.

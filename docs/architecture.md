# Architecture

Driftwatch is five stages and eight nouns. That is the whole thing, and keeping
it that small is a feature rather than a stage of development.

```
collect  ->  normalize  ->  store  ->  evaluate  ->  render
```

| Stage | Lives in | Does |
| ----- | -------- | ---- |
| collect | `collectors/`, loaded by `src/core/registry.ts` | Asks each collector for readings. |
| normalize | `src/core/run.ts` | Coerces whatever came back into valid readings, or rejects it by name. |
| store | `src/core/store.ts` | Writes the latest reading per key to one JSON file. |
| evaluate | `src/core/freshness.ts`, `src/core/rules.ts`, `src/server/api.ts` | Works out fresh vs stale, and which flags are up. |
| render | `src/server/`, `src/web/` | Serves a JSON board and a page that draws it. |

## The eight nouns

**Collector** — a module that produces readings. It may do anything inside
`collect()`.

**Reading** — one timestamped value: `key`, `value`, an optional `unit`, and
`at`.

**Key** — a dotted name for what was measured, unique across your board.

**TTL** — how long a reading stays fresh. Not the same as the collection
interval; see [writing-a-collector.md](writing-a-collector.md).

**Rule** — a predicate over one reading, declared in config.

**Flag** — a named condition currently true of a card, like `stale` or `low`.

**Card** — a key's current reading plus everything Driftwatch worked out about
it: age, freshness, flags, recent history.

**Board** — every card, and the subset that needs attention.

## Decisions worth knowing about

**The store is one JSON file.** Not a database. The state Driftwatch keeps is
meant to be small enough to open in a text editor and understand, and the moment
that stops being true the tool has drifted from what it is for. Writes go to a
temp file and then a rename, so a board read mid-write shows the previous state
rather than half of the next one.

**Timestamps are ISO strings, not epoch numbers.** A stored board stays readable
by a human, and a long bare digit run never appears in a file that might be
committed.

**Rules cannot chain.** A rule sees one reading. It cannot read another reading,
call out to anything, or write state. As soon as rules can depend on each other,
a board stops being explainable — you can no longer look at a flag and say in
one sentence why it is up.

**History is a ring buffer, ten values deep by default.** It exists for the
sparkline. Driftwatch is not a time-series database and does not try to be one.

**One broken collector does not stop the others.** A collector that throws gets
its error recorded against its own id, and the run continues.

**The server binds to loopback only.** Driftwatch is a localhost tool. Serving
it on a network is not a feature it has, and adding one would drag in
authentication, which it also does not have.

**Nothing is configurable by environment variable.** There is nothing to
configure that would need a secret, so there is no mechanism that could carry
one.

## What this deliberately is not

Driftwatch does not sync, host, authenticate, report telemetry, retain history
beyond the ring buffer, derive one reading from another, or contact a language
model. Every one of those absences is a decision, not a gap.

It is a localhost status board. It does not need accounts.

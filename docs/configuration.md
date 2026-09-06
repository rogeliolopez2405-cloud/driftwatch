# Configuration

Driftwatch looks for config in this order and uses the first one it finds:

1. `config/driftwatch.json` — yours. Gitignored. Optional.
2. `config/driftwatch.example.json` — the demo config that ships with the repo.
3. Built-in defaults.

To start your own, copy the example:

```sh
cp config/driftwatch.example.json config/driftwatch.json
```

There are no environment variables and nothing that takes a secret.

## Fields

| Field | Default | Means |
| ----- | ------- | ----- |
| `port` | `8787` | Port the board is served on, bound to loopback only. |
| `collectorsDir` | `collectors` | Where collector modules are loaded from. |
| `storeFile` | `.driftwatch/store.json` | Where the latest readings are kept. |
| `historyLength` | `10` | Values kept per key, for the sparkline only. |
| `rules` | `[]` | Flag rules. See below. |

## Rules

A rule looks at one reading and decides whether to raise a flag. Rules live in
config rather than in collector code so a threshold can change without a code
edit.

```json
{
  "id": "battery-low",
  "key": "demo.device.battery",
  "kind": "below",
  "threshold": 20,
  "flag": "low"
}
```

| Field | Means |
| ----- | ----- |
| `id` | Names the rule. Only used in error messages. |
| `key` | Which reading it applies to. A trailing `*` matches by prefix. |
| `kind` | `below`, `above`, `equals`, or `withinDays`. |
| `threshold` | What to compare against. |
| `flag` | The flag name shown on the card. |

### The four kinds

**`below`** and **`above`** compare numbers. A string that parses as a number
works; anything else is ignored rather than treated as an error.

**`equals`** compares the value exactly as given, so it works on booleans and
strings too.

```json
{ "id": "offline", "key": "demo.device.online", "kind": "equals", "threshold": false, "flag": "offline" }
```

**`withinDays`** expects the reading's value to be a date, and fires when that
date is closer than the threshold.

```json
{ "id": "renewal-due", "key": "demo.renewal.*", "kind": "withinDays", "threshold": 7, "flag": "due-soon" }
```

## The one flag you do not configure

`stale` is raised by Driftwatch itself whenever a reading's age exceeds its
collector's TTL. There is no rule for it and no way to turn it off — it is the
thing the tool is for.

## What is not configurable

No authentication, no network binding beyond loopback, no remote store, no
retention window, no notification channel, no telemetry endpoint. If you find
yourself wanting one of those, Driftwatch is probably not the right tool for
what you are building — and the board it draws is only about a hundred lines of
plain DOM, so it is a reasonable thing to fork.

# Contributing

Driftwatch is small on purpose. The most useful contributions keep it that way.

## Getting set up

```sh
git clone <this repo> && cd driftwatch
npm test
npm start
```

There is nothing to install. Zero dependencies, runtime and development both.
Node 22.18 or newer runs the TypeScript sources directly.

## What is likely to be merged

- Bug fixes, with a test that fails before the fix.
- Clearer documentation, especially anywhere the TTL-versus-interval distinction
  is confusing.
- Improvements to the board's accessibility or its behaviour in either theme.
- Detectors and canaries for the release gate.
- Collectors for the `examples/` directory, if they are synthetic and teach
  something the existing four do not.

## What is unlikely to be merged

These are settled decisions rather than gaps, so a pull request adding one will
probably be declined however well it is written:

- Accounts, roles, authentication, or multi-user anything.
- Binding to a network interface other than loopback.
- Sync, hosting, remote storage, or a hosted variant.
- Telemetry, analytics, or crash reporting of any kind.
- A credential store, or a config field that holds a secret.
- Long-term retention, or anything resembling a time-series database.
- Derived readings, or rules that can see more than one reading.
- Language model integration.
- A runtime dependency. The zero-dependency property is a feature, not an
  accident, and it is worth more than the convenience any single package buys.

If you want one of those, forking is genuinely a reasonable answer. The core is
under five hundred lines.

## Adding a collector to `examples/`

Collectors in this repository must be synthetic. Set `synthetic: true`, invent
the subject, and say so in the module header. Never commit a collector that
reads a real account, a real device, or a real endpoint — write that one in your
own fork.

## Style

Match what is already there. Two spaces, single quotes, semicolons, no default
exports except the collector object itself. Comments explain why, not what.

## Tests

```sh
npm test
```

Tests use `node:test` and `node:assert/strict`. Pure functions take an explicit
`now` so they can be tested without waiting or mocking the clock — keep that
property in anything new.

## Before opening a pull request

```sh
npm test
npm run check
```

`npm run check` is a privacy scanner, not a linter — generic secret and token
detection, machine paths, credential-shaped config, file-type restrictions and
the dependency and network invariants. It is entirely self-contained: it needs
nothing that is not in this repository, so it gives you the same answer CI will.

**Your pull request will not fail for anything you cannot run.** Maintainers run
an additional release mode before publishing a version, which requires a rule
list held outside the repository. That mode is never run against contributions
and is not part of the checks your PR has to pass.

## Reporting a security issue

See [SECURITY.md](SECURITY.md). Do not open a public issue for a vulnerability.

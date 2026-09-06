# Security

## Reporting a vulnerability

Please report privately through this repository's security advisory page rather
than opening a public issue. Include what you did, what happened, and what you
expected. A proof of concept is welcome but not required.

## What Driftwatch's design already rules out

A good deal of the usual attack surface is absent by construction rather than by
mitigation:

- **No dependencies**, runtime or development. There is no supply chain to
  compromise beyond Node itself.
- **No credential store.** Driftwatch has no config field for a secret, no
  mechanism to persist one, and nothing you hand a collector is written to the
  store or the board.
- **No network binding beyond loopback.** The server listens on `127.0.0.1` and
  there is no setting that changes that.
- **No outbound requests.** The core contacts nothing. Only a collector you
  wrote can make a network call, and only to somewhere you chose.
- **No authentication**, because there is nothing multi-user to protect. If you
  find yourself needing auth, you are exposing Driftwatch somewhere it was not
  designed to go.
- **No code evaluation** of stored data. Readings are values, never expressions.

## What you are responsible for

**Your collectors.** A collector is ordinary code with your privileges. Read
credentials from your environment inside `collect()`, never from a file in the
repository, and never return one as a reading value — readings are written to
the store in plain text.

**The store file.** `.driftwatch/store.json` holds whatever your collectors
returned. It is gitignored, but treat it as being as sensitive as the values you
put in it.

**Exposure.** Do not put Driftwatch behind a reverse proxy on a public address.
It has no authentication and is not built to have any.

## Known limitations

- The store is world-readable with the permissions of the user running
  Driftwatch. There is no encryption at rest.
- The board has no CSRF protection on `POST /api/refresh`. That endpoint only
  triggers a collection cycle, and the server is loopback-only, but it is worth
  knowing before you consider exposing it.

## The release gate

`tools/release-gate/` is a privacy and secret scanner used before publishing
this repository. It is not a security boundary for running Driftwatch, and it
makes no claim to catch everything — it catches what it has canaries for, and it
refuses to report a clean result until it has proved that on the current run.

It has two modes. `npm run check` is what CI runs and what you can run: fully
self-contained, identical everywhere. Maintainers additionally run an owner mode
that requires a rule list held outside the repository, scans the full object
history and emits a release manifest. If that list is unavailable the owner run
returns NO_VERDICT rather than falling back to the public checks.

It also separates two questions rather than answering one. **Publishable
surfaces** — tracked, staged and untracked files, generated artefacts, history
blobs — block on any finding. **Local surfaces**, meaning `.git/config`, are
scanned with the same full detector set and everything found is reported, but a
finding there does not block, because `git push` never transmits that file.
Your remote URL and a CI runner's checkout credential both live there and both
are expected. If the same value also appears on a publishable surface, the local
finding is promoted and blocks.

A clean run in either mode is not authorization to publish anything. A human
still reads the files.

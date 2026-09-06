# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - unreleased

First release.

### Added

- Core pipeline: collect, normalize, store, evaluate, render.
- Collector interface with `intervalMs` and a separate `ttlMs`, so freshness is
  a property of the answer rather than of the schedule.
- JSON store with atomic writes and a short per-key ring buffer for sparklines.
- Built-in `stale` flag, plus configurable `below`, `above`, `equals` and
  `withinDays` rules.
- Board served on loopback with two views, All and Needs attention, and a detail
  drawer with a sparkline.
- Four synthetic demo collectors, each marked `synthetic` and rendered with a
  demo-data chip.
- `examples/my-first-collector/` as a copy-me template.
- Release gate: a dependency-free privacy and secret scanner that proves itself
  against freshly randomised canaries and a negative control before every scan.
  It runs in two modes — public checks that are portable, fork-safe and fully
  self-contained, and owner release checks that additionally require an external
  rule list, scan the whole object history and emit a release manifest. An owner
  run without that list returns NO_VERDICT rather than falling back to the
  public set.
- Public CI runs only the self-contained checks, so a pull request from a fork
  never fails for want of material only the maintainers hold.
- The gate separates publishable surfaces from local ones. Tracked, staged and
  untracked files, generated artefacts and history blobs block on any finding.
  `.git/config` is scanned with the same full detector set and everything found
  is reported, but does not block — `git push` never transmits it, and both a
  remote URL and a CI runner's checkout credential legitimately live there. A
  value that also appears on a publishable surface is promoted and does block.
- Three verdicts reported separately: PUBLIC_PAYLOAD, LOCAL_HYGIENE and
  OWNER_RELEASE, so a missing check cannot hide inside a single summary word.
- Zero dependencies, runtime and development both.

# Release gate

A dependency-free scanner that refuses to report a clean result until it has
proved, in the same process, that it can still catch things.

It runs in two modes, and the difference is the most important thing on this
page.

```sh
npm run check              # PUBLIC CHECKS   - portable, fork-safe, self-contained
npm run check:detectors    # prove the public detector set works

npm run release:check      # OWNER RELEASE CHECKS - maintainers only
```

## Two modes

| | Public checks | Owner release checks |
| --- | --- | --- |
| Who can run it | anyone with a clone | maintainers |
| Needs anything outside the repo | no | yes, an external rule list |
| Generic secret and token detection | yes | yes |
| Machine paths, credentials, auth material | yes | yes |
| File-type and binary restrictions | yes | yes |
| Generated-artefact scan | yes | yes |
| Dependency and network invariants | yes | yes |
| External operator rule list | no | **required** |
| Full object-history scan | optional | **always** |
| Release manifest | no | **always** |
| Final human approval | n/a | **required** |

**Public checks** are what CI runs on every push and every pull request,
including pull requests from forks. They are entirely self-contained: a fork, a
stranger's laptop and the maintainers' machines all run the same detectors over
the same inputs and get the same answer. No contribution can fail them for want
of material only the maintainers have.

**Owner release checks** are everything the public checks do, plus an external
rule list held outside the repository, plus a scan of every object reachable in
history, plus the exact manifest of what publishing would make public.

### The two are never substituted for one another

If the external rule list is unavailable, an owner run returns **NO_VERDICT**
and exits 2. It does not quietly downgrade to the public detector set and report
success. A release verdict that silently checked less than it claimed is the
exact failure this tool exists to prevent, so the two modes have separate
verdict strings and neither can be mistaken for the other:

```
PUBLIC CHECKS CLEAN        -> not a release verdict
RELEASE CANDIDATE CLEAN    -> still requires a human
NO_VERDICT                 -> owner run could not complete
```

The same rule applies inside the detector set. When the external list is absent
the rule that uses it is left **out of the set entirely**, rather than included
and unable to fire. An inert detector reporting nothing looks identical to a
working one. The self-test then asserts coverage against whichever set was
actually built, so neither mode can pass while a detector it claims sits idle.

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | Pass. The payload is publishable, and the detectors proved themselves first. |
| `1`  | Blocked. Something was found on a surface that can become public. |
| `2`  | No verdict — the run could not complete as asked. Publishing is refused. |

## Two surfaces

The other distinction, and the one that decides what a finding *means*.

**Publishable surfaces** can become part of the public repository: tracked
files, staged files, untracked files that are not ignored, generated artefacts,
and every blob reachable in history. A finding on any of them blocks. No
detector is weakened to get past one.

**Local surfaces** exist only on the machine running the scan and are never
transmitted by `git push`. `.git/config` is the one. Two things reliably live
there and both are expected: the remote URL, which carries the account name of
whoever owns the repository, and — on a CI runner — the checkout credential
that `actions/checkout` writes as an auth header for the duration of the job.

Local surfaces are scanned with the **full detector set**. Nothing is skipped,
excluded, or suppressed, and everything found is printed. All that changes is
what the finding is allowed to mean.

That matters because judging `.git/config` as publishable content produces two
guaranteed false stops: one for anyone whose account name resembles their own
name, and one on **every CI run anywhere**, because the runner's own credential
is in that file. A tool that fails on facts true of every checkout everywhere
teaches people to ignore it.

The escape valve is a correlation, not an exception: **if the same value also
appears on a publishable surface, the local finding is promoted and blocks.**
Values are compared by digest, so nothing secret is retained in order to compare
it. There is no filename exception anywhere in the source — a surface is
classified by whether it can be published, and `.git/config` cannot.

## Three verdicts

Reported separately, never collapsed into a single word:

```
PUBLIC_PAYLOAD   PASS | BLOCKED      can these bytes become public?
LOCAL_HYGIENE    CLEAN | FINDINGS    what is on this machine?
OWNER_RELEASE    PASS | BLOCKED | NO_VERDICT
```

`OWNER_RELEASE` is `PASS` only when every one of these is true, and the run
prints them individually so a missing check cannot hide inside a summary:
the payload passed, the external rule list loaded, history was scanned, the
manifest was produced, and the detectors proved themselves this run.

Local hygiene findings may coexist with an `OWNER_RELEASE PASS`, provided they
are confined to local metadata and fully reported.

There is no warn level, no `--force`, and no per-line suppression comment.
Unknown is never pass.

## Order of operations

1. **Self-test first.** Fresh randomised canaries are generated into a temporary
   directory and scanned. A missed canary, a dirty negative control, or a
   detector with no canary aborts the run with exit 2.
2. **Load the external denylist.** Absent, unreadable, or implausibly short is
   exit 2 — never a silent skip.
3. **Enumerate every surface.** Tracked files, staged files, untracked files
   that are not ignored, generated output directories, and `.git/config`.
   With `--history`, every blob reachable from every ref as well.
4. **Allowlist file types.** Anything whose extension is not allowlisted is
   blocked on sight. Binary files are blocked unless their SHA-256 is recorded
   in the binary allowlist, which currently holds nothing.
5. **Run every detector** over file contents and over paths.
6. **Check withheld capabilities** — features this project deliberately does not
   have must not appear wired into code.
7. **Verify origin.** One root commit, no submodules, no tracked symlinks,
   and the remotes are printed so a surprise remote is visible.
8. **Report and exit.**

## The external rule list

Some operators need to catch strings that are specific to them — internal
project names, hostnames, identifiers. A list of those strings is itself the
disclosure: commit it and the scanner publishes exactly what it was built to
protect.

So it lives **outside the repository**, at
`~/.driftwatch-release-gate/denylist.local.txt` or wherever
`DRIFTWATCH_DENYLIST` points. Owner runs require it, it must hold at least five
rules, and its SHA-256 is printed on every run so a swapped-in decoy list is
visible in the report. Matched terms are never echoed — a finding says only that
a listed term was present, and where.

Public checks never load it, which is what makes them reproducible everywhere.

One term per line. Blank lines and `#` comments are ignored. A line wrapped in
slashes is treated as a regular expression, which is how a bare numeric token
gets matched on word boundaries without also matching every port number.

## Detectors

Fourteen, plus binary and origin checks. Content detectors run on file text;
path detectors run on file names.

| Detector | Severity | Looks for |
| -------- | -------- | --------- |
| `vendor-key` | block | Key prefixes used by common providers, and signed web tokens. |
| `private-key-block` | block | Private key headers, any algorithm. |
| `auth-material` | block | Request headers that carry an authorization value, cookies, session identifiers. |
| `credential-config` | block | A config key named for a credential holding a value that is not a placeholder. |
| `env-file` | block | Environment and credential files by name, at any depth. |
| `high-entropy` | review | Long opaque tokens no other rule explains. |
| `account-number` | review | Long bare digit runs. |
| `machine-path` | block | Absolute paths on an author's machine — user-profile directories on any OS, and network paths. |
| `personal-identifier` | block | Email addresses outside reserved example domains, and phone-number shapes. |
| `nonallowlisted-host` | review | Any URL whose host is not on the public allowlist. |
| `deployment-identifier` | block | Opaque project, team and deployment id shapes; private-network hostnames. |
| `withheld-capability` | block | Any bare module import, and telemetry transports. |
| `denylist-term` | block | Anything from the external denylist. |
| `unknown-file-type` | block | Any extension not on the allowlist. |

Thirteen of the fourteen are active in both modes. `denylist-term` is the
exception: it requires the external rule list, so it is present only in an owner
run.

Detectors are described here rather than exemplified. Writing a trigger string
into this file would make the scanner flag its own documentation, and the fix
for that is discipline in the prose, not an exception in the code.

## Why no detector names a hosting provider

An earlier draft matched one named platform's preview domains. Naming a provider
in a public rule points at infrastructure without protecting anything the
generic rules miss: a preview or deployment hostname is an outbound host, and
`nonallowlisted-host` already flags every host that is not on the short public
allowlist, whoever operates it. What remains in `deployment-identifier` are
opaque identifier shapes, which name nobody. Anything narrower than that belongs
in an operator's own external rule list, where it stays private.

## Why `withheld-capability` checks the dependency invariant

The obvious implementation is a list of vendor names. It is a bad one, twice
over: it only catches the vendors somebody thought to write down, and the list
itself becomes a string that a privacy denylist then has to care about. On this
repository those two problems collided directly — the detector's own vendor list
tripped the denylist detector.

The fix was to find the stronger rule rather than to shorten either list.
Driftwatch has **zero dependencies**, so any import that is not a Node builtin
and not a relative path is, by definition, a capability being wired in. That
catches every vendor including the ones nobody listed, and it names none of
them.

It is also why the rule looks at imports rather than words. Matching capability
names as prose would flag this project's own honest documentation: the README
states that Driftwatch has no telemetry and contacts no language model, and
saying so would trip a word-level rule. Loosening such a rule to "ignore
Markdown" would be a bypass. Prose about what the project does not do is not a
capability; an `import` is.

## Proving the surface distinction

Getting this wrong in either direction is a real failure: treat a local file as
publishable and the tool blocks every CI run everywhere; treat a publishable
file as local and it waves a leak through. So the distinction is tested
directly, in `test/release-gate.test.ts`, with control pairs:

| | Planted | Expected |
| --- | --- | --- |
| A | secret in a tracked file | payload **BLOCKED** |
| B | secret reachable only in history | payload **BLOCKED** |
| C | secret in a generated artefact | payload **BLOCKED** |
| D | checkout credential in `.git/config` | local hygiene, payload **PASS** |
| E | owner identifier in the remote URL | local hygiene, payload **PASS** |
| F | that same identifier also in a tracked file | payload **BLOCKED**, local finding promoted |
| G | any detected credential | never printed in full |
| H | owner mode, no external list | **NO_VERDICT**, exit 2 |

Each builds a throwaway repository, plants one thing, and asserts the verdicts
and the exit code. Every planted secret is generated at runtime; no trigger
literal appears in the test file.

## Proving the gate works

`selftest.mjs` builds one canary per detector with fresh random material every
run, so the gate cannot pass by memorising a fixture. Alongside them sits a
**negative control**: ordinary project prose that must come back with zero
findings. That is the other half of the pair — a scanner that flags everything
also technically fails closed, and is useless.

Canaries are written to a temporary directory and deleted in the same run. There
is no "remember to remove the canaries" step, because they never enter the
working tree.

Success sets a proof token bound to the current process id. The scan refuses to
run without it, so the self-test cannot be skipped by calling the scanner
directly.

## A pass is not authorization to publish

The gate answers one narrow question: did an automated scan of these surfaces
find anything? A human still reads every file before anything becomes public.

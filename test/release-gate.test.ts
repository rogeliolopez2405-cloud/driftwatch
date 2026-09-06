/**
 * Control-paired tests for the surface distinction.
 *
 * The release gate answers two different questions and must never confuse
 * them: "can these bytes become public?" and "what is on this machine?".
 * Getting that wrong in either direction is a real failure — treat a local
 * file as publishable and the tool blocks every CI run everywhere; treat a
 * publishable file as local and it waves through a leak.
 *
 * Each test builds a throwaway git repository in a temp directory, plants one
 * thing, and asserts the verdicts. The gate runs as a subprocess because that
 * is how it is actually used, and because its exit code is part of what is
 * being tested.
 *
 * Every planted secret is generated at runtime; no trigger literal appears in
 * this file, for the same reason none appears in the canary generator.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const token = (n: number) => randomBytes(n).toString('hex').slice(0, n);

interface GateResult {
  publicPayload: string;
  localHygiene: string;
  ownerRelease: string;
  findings: Array<{ detector: string; surface: string; excerpt: string; path: string; alsoPublishable?: boolean }>;
  exitCode: number | null;
  stdout: string;
}

/** A minimal repository containing only what the gate needs to run. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dw-gate-'));
  mkdirSync(join(dir, 'tools'), { recursive: true });
  cpSync(join(ROOT, 'tools', 'release-gate'), join(dir, 'tools', 'release-gate'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# Fixture\n\nA throwaway repository.\n', 'utf8');
  writeFileSync(join(dir, '.gitignore'), 'ignored/\n', 'utf8');

  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.com');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return dir;
}

function runGate(dir: string, mode: 'public' | 'owner', env: Record<string, string> = {}): GateResult {
  const res = spawnSync(
    process.execPath,
    [join(dir, 'tools', 'release-gate', 'gate.mjs'), mode === 'owner' ? '--owner' : '--public', '--json'],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } },
  );
  const stdout = res.stdout ?? '';
  let parsed: Partial<GateResult> = {};
  try {
    parsed = JSON.parse(stdout) as Partial<GateResult>;
  } catch {
    parsed = {};
  }
  return {
    publicPayload: parsed.publicPayload ?? 'NO_VERDICT',
    localHygiene: parsed.localHygiene ?? 'NO_VERDICT',
    ownerRelease: parsed.ownerRelease ?? 'NO_VERDICT',
    findings: parsed.findings ?? [],
    exitCode: res.status,
    stdout: stdout + (res.stderr ?? ''),
  };
}

function withRepo(fn: (dir: string, git: (...args: string[]) => void) => void): void {
  const dir = makeRepo();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  try {
    fn(dir, git);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------- */
/* A-C: publishable surfaces block                                   */
/* ---------------------------------------------------------------- */

test('A. a secret in a tracked file blocks the payload', () => {
  withRepo((dir, git) => {
    writeFileSync(join(dir, 'leak.md'), 'key ' + 's' + 'k-' + token(38) + '\n', 'utf8');
    git('add', '-A');
    git('commit', '-q', '-m', 'leak');

    const r = runGate(dir, 'public');
    assert.equal(r.publicPayload, 'BLOCKED');
    assert.equal(r.exitCode, 1);
    assert.ok(r.findings.some((f) => f.detector === 'vendor-key' && f.surface === 'publishable'));
  });
});

test('B. a secret reachable only in history blocks the payload', () => {
  withRepo((dir, git) => {
    writeFileSync(join(dir, 'leak.md'), 'token ' + 'gh' + 'p_' + token(36) + '\n', 'utf8');
    git('add', '-A');
    git('commit', '-q', '-m', 'add');
    rmSync(join(dir, 'leak.md'));
    git('add', '-A');
    git('commit', '-q', '-m', 'remove');

    // Gone from the working tree, still reachable from a ref.
    const working = runGate(dir, 'public');
    assert.equal(working.publicPayload, 'PASS', 'the file itself is gone');

    const withHistory = spawnSync(
      process.execPath,
      [join(dir, 'tools', 'release-gate', 'gate.mjs'), '--public', '--history', '--json'],
      { cwd: dir, encoding: 'utf8' },
    );
    const parsed = JSON.parse(withHistory.stdout);
    assert.equal(parsed.publicPayload, 'BLOCKED');
    assert.ok(parsed.findings.some((f: { path: string; surface: string }) =>
      f.path.startsWith('history:') && f.surface === 'publishable'));
  });
});

test('C. a secret in a generated artefact blocks the payload', () => {
  withRepo((dir) => {
    mkdirSync(join(dir, '.driftwatch'), { recursive: true });
    writeFileSync(join(dir, '.driftwatch', 'store.json'),
      JSON.stringify({ t: 'gh' + 'p_' + token(36) }) + '\n', 'utf8');

    const r = runGate(dir, 'public');
    assert.equal(r.publicPayload, 'BLOCKED');
    assert.equal(r.exitCode, 1);
    assert.ok(r.findings.some((f) => f.path.startsWith('.driftwatch/') && f.surface === 'publishable'));
  });
});

/* ---------------------------------------------------------------- */
/* D-E: local surfaces are reported, not blocking                    */
/* ---------------------------------------------------------------- */

test('D. a checkout credential in .git/config is local hygiene, and the payload still passes', () => {
  withRepo((dir, git) => {
    // What actions/checkout does on every CI run, everywhere.
    git('config', '--local', 'http.https://github.com/.extraheader',
      'AUTHORIZATION: basic ' + Buffer.from('x-token:' + token(40)).toString('base64'));

    const r = runGate(dir, 'public');
    assert.equal(r.publicPayload, 'PASS', 'a runner credential must not fail public CI');
    assert.equal(r.localHygiene, 'FINDINGS');
    assert.equal(r.exitCode, 0);

    const hit = r.findings.find((f) => f.detector === 'auth-material');
    assert.ok(hit, 'the credential is still detected');
    assert.equal(hit.surface, 'local');
    assert.equal(hit.path, '.git/config');
  });
});

// Not a reserved example domain: the personal-identifier detector deliberately
// ignores those, so a fixture built on one would prove nothing.
//
// Assembled at runtime, like every other trigger in this repository. Written as
// one literal it is an email address in a tracked file, and the gate blocks on
// it — correctly, and it did.
const IDENTITY = 'someone.identifiable' + '@' + 'fixture-host.test';

test('E. an owner identifier in the remote URL is local hygiene, and the payload still passes', () => {
  withRepo((dir, git) => {
    git('remote', 'add', 'origin', 'https://' + IDENTITY + '/x.git');

    const r = runGate(dir, 'public');
    assert.equal(r.publicPayload, 'PASS');
    assert.equal(r.localHygiene, 'FINDINGS');
    assert.equal(r.exitCode, 0);
    assert.ok(r.findings.some((f) => f.detector === 'personal-identifier'), 'still detected');
    assert.ok(r.findings.every((f) => f.surface === 'local'), 'and confined to the local surface');
  });
});

/* ---------------------------------------------------------------- */
/* F: the same value on a publishable surface does block             */
/* ---------------------------------------------------------------- */

test('F. the same identifier copied into a tracked file blocks the payload', () => {
  withRepo((dir, git) => {
    git('remote', 'add', 'origin', 'https://' + IDENTITY + '/x.git');

    // Local only: passes.
    assert.equal(runGate(dir, 'public').publicPayload, 'PASS');

    // Now the same value is also in a file that would be published.
    writeFileSync(join(dir, 'README.md'), '# Fixture\n\nmaintained by ' + IDENTITY + '\n', 'utf8');
    git('add', '-A');
    git('commit', '-q', '-m', 'credit');

    const r = runGate(dir, 'public');
    assert.equal(r.publicPayload, 'BLOCKED');
    assert.equal(r.exitCode, 1);
    assert.ok(r.findings.some((f) => f.path === 'README.md' && f.surface === 'publishable'));

    // And the local occurrence is promoted, because it is the same value.
    const local = r.findings.find((f) => f.path === '.git/config' && f.detector === 'personal-identifier');
    assert.ok(local, 'the local occurrence is still reported');
    assert.equal(local.alsoPublishable, true);
  });
});

/* ---------------------------------------------------------------- */
/* G: values are never printed                                       */
/* ---------------------------------------------------------------- */

test('G. a detected credential is never printed in full', () => {
  withRepo((dir, git) => {
    const secret = token(48);
    git('config', '--local', 'http.https://github.com/.extraheader', 'AUTHORIZATION: basic ' + secret);
    writeFileSync(join(dir, 'notes.md'), 'key ' + 's' + 'k-' + secret + '\n', 'utf8');
    git('add', '-A');
    git('commit', '-q', '-m', 'notes');

    const r = runGate(dir, 'public');
    assert.ok(!r.stdout.includes(secret), 'the raw value must not appear anywhere in the output');
    assert.ok(r.findings.length > 0, 'and it is still detected');
    for (const f of r.findings) {
      assert.ok(!f.excerpt.includes(secret), 'excerpts are masked');
    }
  });
});

/* ---------------------------------------------------------------- */
/* H: owner mode without the external list yields no verdict         */
/* ---------------------------------------------------------------- */

test('H. owner mode without the external rule list returns NO_VERDICT', () => {
  withRepo((dir) => {
    const r = runGate(dir, 'owner', { DRIFTWATCH_DENYLIST: join(dir, 'no-such-list.txt') });
    assert.equal(r.exitCode, 2, 'exit 2 is no verdict, not a pass and not a finding');
    assert.match(r.stdout, /NO_VERDICT/);
    // Critically: it must not have quietly produced a public-only verdict.
    assert.notEqual(r.ownerRelease, 'PASS');
  });
});

test('H2. a clean repository passes public checks with no external list at all', () => {
  withRepo((dir) => {
    const r = runGate(dir, 'public', { DRIFTWATCH_DENYLIST: join(dir, 'no-such-list.txt') });
    assert.equal(r.publicPayload, 'PASS');
    assert.equal(r.localHygiene, 'CLEAN');
    assert.equal(r.exitCode, 0);
  });
});

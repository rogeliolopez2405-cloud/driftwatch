#!/usr/bin/env node
/**
 * Driftwatch release gate.
 *
 *   node tools/release-gate/gate.mjs --public   PUBLIC CHECKS  (default)
 *   node tools/release-gate/gate.mjs --owner    OWNER RELEASE CHECKS
 *
 * TWO MODES, AND THE DIFFERENCE MATTERS.
 *
 * PUBLIC CHECKS are portable, fork-safe and entirely self-contained in this
 * repository. Anyone who clones or forks it can run them and get the same
 * answer: unit tests' sibling, so to speak - generic secret and token
 * detection, machine paths, credential-shaped config, file-type restrictions,
 * generated artefacts, binaries, and the dependency and network invariants.
 * They require no material that is not in the repository, so a contributor's
 * pull request never fails for lack of something only the operator has.
 *
 * OWNER RELEASE CHECKS are everything the public checks do, plus an external
 * rule list the operator holds outside the repository, plus a scan of the
 * whole object history, plus the exact release manifest. They are what an
 * official release is judged on.
 *
 * The two are never substituted for one another. If the operator's external
 * list is unavailable, an owner run returns NO_VERDICT and exits 2. It does
 * not quietly downgrade to the public set and report success - a release
 * verdict that silently checked less than it claimed is the failure this whole
 * tool exists to prevent.
 *
 * TWO SURFACE CLASSES, AND THE DIFFERENCE ALSO MATTERS.
 *
 * PUBLISHABLE surfaces can become part of the public repository: tracked,
 * staged and untracked-but-addable files, generated artefacts, and every blob
 * reachable in history. A finding on any of them BLOCKS publication. Nothing
 * about that is negotiable and no detector is weakened to get past it.
 *
 * LOCAL surfaces exist only on the machine doing the scanning and are never
 * transmitted by `git push`. `.git/config` is one: git writes the remote URL
 * into it, and a CI runner writes its own short-lived checkout credential into
 * it. Both are expected. Both are real. Neither can reach anyone else.
 *
 * Local surfaces are scanned with the FULL detector set - not skipped, not
 * excluded, not suppressed - and everything found is reported. What changes is
 * only what the finding is allowed to mean. Judged as a publication blocker,
 * `.git/config` produces two guaranteed false stops: one for anyone whose
 * account name resembles their own name, and one on every CI run anywhere,
 * because the runner's own credential lives there.
 *
 * The escape valve is a correlation, not an exception: if the same value also
 * appears on a publishable surface, the local finding is promoted to a blocker.
 * Values are correlated by digest, so nothing secret is stored to compare.
 *
 * There is no filename exception anywhere in this file. A surface is classified
 * by whether it can be published, and `.git/config` cannot.
 *
 * VERDICTS. Three, reported separately, never collapsed into one word:
 *
 *   PUBLIC_PAYLOAD   PASS | BLOCKED    - can these bytes become public?
 *   LOCAL_HYGIENE    CLEAN | FINDINGS  - what is on this machine?
 *   OWNER_RELEASE    PASS | BLOCKED | NO_VERDICT
 *
 * OWNER_RELEASE is PASS only when the payload passes, the external rule list
 * loaded, history was scanned, the manifest was produced, and the detectors
 * proved themselves. Local hygiene findings may coexist with an OWNER_RELEASE
 * PASS provided they are confined to local metadata and fully reported.
 *
 * Fail-closed. Exit codes:
 *   0  pass         - the payload is publishable (owner mode: release passes)
 *   1  blocked      - something on a publishable surface; publishing is refused
 *   2  no verdict   - the run could not complete as asked; publishing is refused
 *
 * There is no warn level and no bypass flag. Unknown is never pass.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

import { buildDetectors, loadDenylist, GENERATED_DIRS } from './patterns.mjs';
import { runSelfTest, assertProven, scanText } from './selftest.mjs';

const REPO = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);

// Public is the default. An owner release has to be asked for explicitly, so
// nothing can drift into claiming a release verdict it did not earn.
const MODE = flag('--owner') ? 'owner' : 'public';

const OPTS = {
  mode: MODE,
  // An owner run always scans history and always applies the strict repository
  // requirements; neither is optional at release time.
  history: MODE === 'owner' || flag('--history') || flag('--all'),
  strict: MODE === 'owner' || flag('--strict') || flag('--all'),
  manifest: MODE === 'owner' || flag('--manifest'),
  json: flag('--json'),
  verbose: flag('--verbose'),
};

/* ------------------------------------------------------------------ */
/* git helpers                                                         */
/* ------------------------------------------------------------------ */

function git(args, opts) {
  try {
    return execFileSync('git', args, {
      cwd: REPO,
      encoding: (opts && opts.encoding) || 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (opts && opts.soft) return null;
    throw err;
  }
}

const isRepo = git(['rev-parse', '--is-inside-work-tree'], { soft: true }) !== null;

function gitLines(args) {
  if (!isRepo) return [];
  const out = git(args, { soft: true });
  if (!out) return [];
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* surfaces                                                            */
/* ------------------------------------------------------------------ */

function walk(dir, acc) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile()) acc.push(relative(REPO, full).split(sep).join('/'));
  }
  return acc;
}

/**
 * Every surface here is PUBLISHABLE: each one can end up in the public
 * repository, so a finding on any of them blocks. `.git/config` is handled
 * separately, in scanGitConfig, as the one local surface.
 */
function collectSurfaces() {
  const surfaces = [];

  surfaces.push({ name: 'tracked', publishable: true, paths: gitLines(['ls-files']) });

  surfaces.push({
    name: 'staged',
    publishable: true,
    paths: gitLines(['diff', '--cached', '--name-only', '--diff-filter=ACMR']),
  });

  // Untracked and not ignored: one `git add -A` away from being published.
  surfaces.push({
    name: 'untracked',
    publishable: true,
    paths: gitLines(['ls-files', '--others', '--exclude-standard']),
  });

  const generated = [];
  for (const d of GENERATED_DIRS) walk(join(REPO, d), generated);
  surfaces.push({ name: 'generated', publishable: true, paths: generated });

  if (!isRepo) {
    surfaces.push({ name: 'worktree', publishable: true, paths: walk(REPO, []) });
  }

  return surfaces;
}

/* ------------------------------------------------------------------ */
/* scanning                                                            */
/* ------------------------------------------------------------------ */

const BINARY_ALLOWLIST = new Set(); // sha256 of any binary deliberately shipped

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true;
  return false;
}

function scanFile(detectors, relPath, findings, seen, surface) {
  const key = relPath;
  if (seen.has(key)) return;
  seen.add(key);
  const tag = surface || 'publishable';

  const full = join(REPO, relPath);
  if (!existsSync(full) || !statSync(full).isFile()) return;

  const buf = readFileSync(full);

  // Path-only detectors run on every file, binary or not.
  for (const d of detectors) {
    if (d.kind !== 'path') continue;
    for (const h of d.scan('', relPath) || []) {
      findings.push({ detector: d.id, label: d.label, severity: d.severity, surface: tag, path: relPath, line: h.line, excerpt: h.excerpt, why: h.why, valueHash: h.valueHash });
    }
  }

  if (looksBinary(buf)) {
    const digest = createHash('sha256').update(buf).digest('hex');
    if (!BINARY_ALLOWLIST.has(digest)) {
      findings.push({
        detector: 'binary-file',
        label: 'Binary file not on the hash allowlist',
        severity: 'block',
        surface: tag,
        path: relPath,
        line: 0,
        excerpt: 'sha256:' + digest.slice(0, 16),
        why: 'binary content cannot be reviewed by the text detectors',
      });
    }
    return;
  }

  findings.push(...scanText(detectors.filter((d) => d.kind === 'content'), buf.toString('utf8'), relPath, tag));
}

/**
 * .git/config - the one LOCAL surface.
 *
 * Scanned with the full content detector set, exactly like everything else.
 * Nothing is skipped and nothing is suppressed; the findings are tagged
 * 'local' because `git push` does not transmit this file, so what is in it
 * cannot reach anyone. Two things reliably live here and both are expected:
 * the remote URL, which carries the account name of whoever owns the repo,
 * and, on a CI runner, the checkout credential that actions/checkout writes
 * as an auth header for the duration of the job.
 */
function scanGitConfig(detectors, findings) {
  const cfg = join(REPO, '.git', 'config');
  if (!existsSync(cfg)) return { remotes: [], scanned: false };
  const text = readFileSync(cfg, 'utf8');
  findings.push(...scanText(detectors.filter((d) => d.kind === 'content'), text, '.git/config', 'local'));
  const remotes = [...text.matchAll(/url\s*=\s*(.+)/g)]
    .map((m) => m[1].trim())
    // A credential embedded in a remote URL is still detected above; it is
    // simply never echoed back out again through the remotes list.
    .map((u) => u.replace(/\/\/[^@/]*@/, '//[redacted]@'));
  return { remotes, scanned: true };
}

function scanHistory(detectors, findings) {
  if (!isRepo) return { blobs: 0, scanned: false };
  const objects = gitLines(['rev-list', '--objects', '--all']);
  let blobs = 0;
  for (const line of objects) {
    const sp = line.indexOf(' ');
    if (sp < 0) continue;
    const sha = line.slice(0, sp);
    const path = line.slice(sp + 1);
    const type = git(['cat-file', '-t', sha], { soft: true });
    if (!type || type.trim() !== 'blob') continue;
    blobs += 1;
    const content = git(['cat-file', '-p', sha], { soft: true });
    if (content == null) continue;
    if (content.includes('\u0000')) {
      findings.push({
        detector: 'binary-file',
        label: 'Binary blob in history',
        severity: 'block',
        surface: 'publishable',
        path: 'history:' + path,
        line: 0,
        excerpt: sha.slice(0, 16),
        why: 'binary content in history cannot be reviewed by the text detectors',
      });
      continue;
    }
    findings.push(...scanText(
      detectors.filter((d) => d.kind === 'content'),
      content,
      'history:' + path,
      'publishable',
    ));
  }
  return { blobs, scanned: true };
}

/* ------------------------------------------------------------------ */
/* origin                                                          */
/* ------------------------------------------------------------------ */

function checkOrigin(findings) {
  const info = {
    isRepo,
    rootCommits: [],
    submodules: false,
    symlinks: [],
    remotes: [],
    commits: 0,
  };
  if (!isRepo) return info;

  info.rootCommits = gitLines(['rev-list', '--max-parents=0', '--all']);
  info.commits = gitLines(['rev-list', '--all']).length;
  info.submodules = existsSync(join(REPO, '.gitmodules'));
  info.symlinks = gitLines(['ls-files', '-s'])
    .filter((l) => l.startsWith('120000'))
    .map((l) => l.split('\t').pop());

  if (info.rootCommits.length > 1) {
    findings.push({
      detector: 'origin',
      label: 'More than one root commit',
      severity: 'block',
      surface: 'publishable',
      path: '.git',
      line: 0,
      excerpt: info.rootCommits.length + ' root commits',
      why: 'foreign history appears to have been merged or imported',
    });
  }
  if (info.submodules) {
    findings.push({
      detector: 'origin',
      label: 'Submodule present',
      severity: 'block',
      surface: 'publishable',
      path: '.gitmodules',
      line: 0,
      excerpt: '.gitmodules exists',
      why: 'a submodule can pull in a private repository',
    });
  }
  for (const s of info.symlinks) {
    findings.push({
      detector: 'origin',
      label: 'Symlink tracked in the repository',
      severity: 'block',
      surface: 'publishable',
      path: s,
      line: 0,
      excerpt: s,
      why: 'a symlink can escape the tree into private material',
    });
  }
  return info;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const started = Date.now();

  // Stage 1-2: prove the detectors work.
  //
  // An owner run REQUIRES the external list and aborts without it - that is
  // the NO_VERDICT path, and it is the reason an official release can never
  // be signed off by the public detector set alone. A public run never loads
  // it at all, so a fork and the operator's own machine produce identical
  // results from identical inputs.
  const deny = MODE === 'owner' ? await loadDenylist() : null;

  const selfTest = await runSelfTest({ denylist: deny });
  if (!selfTest.ok) {
    const err = new Error(
      'self-test failed: caught ' + selfTest.caught + '/' + selfTest.total
      + (selfTest.missed.length ? ', missed ' + selfTest.missed.join(', ') : '')
      + (selfTest.negativeClean ? '' : ', negative control dirty')
      + (selfTest.uncovered.length ? ', uncovered ' + selfTest.uncovered.join(', ') : ''),
    );
    err.gateExit = 2;
    throw err;
  }
  assertProven();

  const detectors = buildDetectors({ denylist: deny ? deny.rules : [] });
  const findings = [];
  const seen = new Set();

  // Stage 3-5: every surface.
  const surfaces = collectSurfaces();
  const surfaceCounts = {};
  for (const s of surfaces) {
    surfaceCounts[s.name] = s.paths.length;
    const tag = s.publishable ? 'publishable' : 'local';
    for (const p of s.paths) scanFile(detectors, p, findings, seen, tag);
  }

  const cfg = scanGitConfig(detectors, findings);
  const history = OPTS.history ? scanHistory(detectors, findings) : { blobs: 0, scanned: false };

  // Stage 7: origin.
  const origin = checkOrigin(findings);
  origin.remotes = cfg.remotes;

  if (OPTS.strict && !isRepo) {
    findings.push({
      detector: 'origin',
      label: 'Not a git repository',
      severity: 'block',
      surface: 'publishable',
      path: '.',
      line: 0,
      excerpt: REPO,
      why: 'strict mode requires a repository so history can be inspected',
    });
  }

  const blocks = findings.filter((f) => f.severity === 'block');
  const reviews = findings.filter((f) => f.severity === 'review');

  // A local finding is promoted to a publication blocker when the SAME value
  // also turns up on a surface that can be published. Correlation is by digest,
  // so nothing secret is retained in order to compare it.
  const publicHashes = new Set(
    findings.filter((f) => f.surface === 'publishable' && f.valueHash).map((f) => f.valueHash),
  );
  for (const f of findings) {
    if (f.surface === 'local' && f.valueHash && publicHashes.has(f.valueHash)) {
      f.alsoPublishable = true;
    }
  }

  const blocking = findings.filter((f) => f.surface === 'publishable' || f.alsoPublishable);
  const localOnly = findings.filter((f) => f.surface === 'local' && !f.alsoPublishable);

  const publicPayload = blocking.length === 0 ? 'PASS' : 'BLOCKED';
  const localHygiene = localOnly.length === 0 ? 'CLEAN' : 'FINDINGS';

  // OWNER_RELEASE demands everything, and says so item by item rather than
  // collapsing into one word that could hide a missing check.
  const ownerRequirements = MODE === 'owner' ? {
    payloadPass: publicPayload === 'PASS',
    ruleListLoaded: selfTest.denylistActive === true,
    historyScanned: history.scanned === true,
    manifestProduced: Boolean(OPTS.manifest),
    detectorsProven: selfTest.ok === true,
  } : null;
  const ownerRelease = MODE === 'owner'
    ? (Object.values(ownerRequirements).every(Boolean) ? 'PASS' : 'BLOCKED')
    : 'NOT REQUESTED';

  const result = {
    mode: MODE,
    publicPayload,
    localHygiene,
    ownerRelease,
    ownerRequirements,
    verdict: MODE === 'owner' ? ownerRelease : publicPayload,
    repo: REPO,
    isRepo,
    elapsedMs: Date.now() - started,
    selfTest: {
      caught: selfTest.caught,
      total: selfTest.total,
      activeDetectors: selfTest.activeDetectors,
      denylistActive: selfTest.denylistActive,
      negativeClean: selfTest.negativeClean,
      denylistFile: selfTest.denylistFile,
      denylistDigest: selfTest.denylistDigest,
      denylistRules: selfTest.denylistRules,
    },
    manifest: OPTS.manifest ? buildManifest() : null,
    surfaces: surfaceCounts,
    filesScanned: seen.size,
    gitConfigScanned: cfg.scanned,
    historyScanned: history.scanned,
    historyBlobs: history.blobs,
    origin,
    blocks: blocks.length,
    reviews: reviews.length,
    blocking: blocking.length,
    localOnly: localOnly.length,
    findings,
  };

  if (OPTS.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(render(result));
  }

  // Exit status follows the verdict that was asked for. Local hygiene findings
  // are always reported and never decide it on their own.
  if (MODE === 'owner') return ownerRelease === 'PASS' ? 0 : 1;
  return publicPayload === 'PASS' ? 0 : 1;
}

/** The exact list of files that publishing this repository would make public. */
function buildManifest() {
  if (!isRepo) return null;
  const entries = [];
  for (const line of gitLines(['ls-files', '-s'])) {
    const m = line.match(/^(\d+)\s+([0-9a-f]+)\s+\d+\t(.+)$/);
    if (!m) continue;
    const size = git(['cat-file', '-s', m[2]], { soft: true });
    entries.push({ path: m[3], bytes: size ? Number(size.trim()) : null, blob: m[2].slice(0, 12) });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    files: entries.length,
    bytes: entries.reduce((n, e) => n + (e.bytes || 0), 0),
    entries,
  };
}

function render(r) {
  const L = [];
  L.push('');
  L.push(r.mode === 'owner'
    ? '  DRIFTWATCH  -  OWNER RELEASE CHECKS'
    : '  DRIFTWATCH  -  PUBLIC CHECKS');
  L.push('  ' + '-'.repeat(58));
  L.push('  self-test        ' + r.selfTest.caught + '/' + r.selfTest.total
    + ' canaries caught, negative control '
    + (r.selfTest.negativeClean ? 'clean' : 'DIRTY'));
  L.push('  detectors        ' + r.selfTest.activeDetectors.length + ' active, each proven this run');
  if (r.selfTest.denylistActive) {
    L.push('  operator list    ' + r.selfTest.denylistRules + ' rules, sha256:' + r.selfTest.denylistDigest);
    L.push('  list source      ' + r.selfTest.denylistFile);
  } else {
    L.push('  operator list    not used - public checks are self-contained by design');
  }
  L.push('  git repository   ' + (r.isRepo ? 'yes' : 'no'));
  L.push('  surfaces         ' + Object.entries(r.surfaces).map(([k, v]) => k + '=' + v).join('  '));
  L.push('  files scanned    ' + r.filesScanned);
  L.push('  .git/config      ' + (r.gitConfigScanned ? 'scanned as a local surface' : 'absent'));
  L.push('  history          ' + (r.historyScanned ? r.historyBlobs + ' blobs scanned' : 'not scanned (pass --history)'));
  L.push('  root commits     ' + (r.origin.rootCommits.length || 0));
  L.push('  submodules       ' + (r.origin.submodules ? 'PRESENT' : 'none'));
  L.push('  symlinks         ' + (r.origin.symlinks.length ? r.origin.symlinks.join(', ') : 'none'));
  L.push('  remotes          ' + (r.origin.remotes.length ? r.origin.remotes.join(', ') : 'none'));
  L.push('  ' + '-'.repeat(58));

  const group = (list) => {
    const out = [];
    const byDetector = new Map();
    for (const f of list) {
      if (!byDetector.has(f.detector)) byDetector.set(f.detector, []);
      byDetector.get(f.detector).push(f);
    }
    for (const [id, items] of byDetector) {
      out.push('    [' + items[0].severity.toUpperCase() + '] ' + id + '  (' + items.length + ')'
        + (items[0].alsoPublishable ? '  << ALSO ON A PUBLISHABLE SURFACE' : ''));
      for (const f of items.slice(0, 8)) {
        out.push('        ' + f.path + ':' + f.line + '  ' + f.excerpt);
        out.push('            ' + f.why);
      }
      if (items.length > 8) out.push('        ... ' + (items.length - 8) + ' more');
    }
    return out;
  };

  const blocking = r.findings.filter((f) => f.surface === 'publishable' || f.alsoPublishable);
  const localOnly = r.findings.filter((f) => f.surface === 'local' && !f.alsoPublishable);

  L.push('  PUBLISHABLE SURFACES   tracked, staged, untracked, generated, history');
  if (blocking.length === 0) {
    L.push('    no findings - nothing here can carry anything into the public repository');
  } else {
    L.push(...group(blocking));
  }

  L.push('');
  L.push('  LOCAL SURFACES         .git/config  (never transmitted by git push)');
  if (localOnly.length === 0) {
    L.push('    no findings');
  } else {
    L.push(...group(localOnly));
    L.push('    Scanned with the full detector set. Reported, not suppressed.');
    L.push('    These do not block publication: nothing in them can reach anyone');
    L.push('    else. Any value that ALSO appears on a publishable surface is');
    L.push('    promoted above and does block.');
  }

  L.push('  ' + '-'.repeat(58));
  L.push('  PUBLIC_PAYLOAD   ' + r.publicPayload
    + (r.publicPayload === 'PASS' ? '' : '   (' + r.blocking + ' finding(s))'));
  L.push('  LOCAL_HYGIENE    ' + r.localHygiene
    + (r.localHygiene === 'CLEAN' ? '' : '   (' + r.localOnly + ' finding(s), reported above)'));
  if (r.mode === 'owner') {
    L.push('  OWNER_RELEASE    ' + r.ownerRelease);
    for (const [k, v] of Object.entries(r.ownerRequirements || {})) {
      L.push('      ' + (v ? '[x] ' : '[ ] ') + k);
    }
  }
  L.push('  elapsed ' + r.elapsedMs + 'ms');

  if (r.manifest) {
    L.push('  ' + '-'.repeat(58));
    L.push('  RELEASE MANIFEST  ' + r.manifest.files + ' files, '
      + r.manifest.bytes.toLocaleString('en-US') + ' bytes');
    for (const e of r.manifest.entries) {
      L.push('    ' + e.path.padEnd(44) + String(e.bytes).padStart(6) + '  ' + e.blob);
    }
  }

  L.push('  ' + '-'.repeat(58));
  if (r.mode === 'public' && r.publicPayload === 'PASS') {
    L.push('  Public checks only. This is NOT a release verdict - an official');
    L.push('  release additionally requires the owner checks.');
  } else if (r.mode === 'owner' && r.ownerRelease === 'PASS') {
    L.push('  A PASSING RUN IS NOT AUTHORIZATION TO PUBLISH.');
    L.push('  A human still reads every file and gives explicit approval.');
  }
  L.push('');
  return L.join('\n');
}

try {
  process.exit(await main());
} catch (err) {
  // An owner run that cannot complete returns NO_VERDICT rather than a
  // verdict. It never falls back to the public detector set.
  const label = MODE === 'owner' ? 'NO_VERDICT (owner release blocked): ' : 'gate error: ';
  console.error(label + err.message);
  process.exit(err.gateExit || 2);
}

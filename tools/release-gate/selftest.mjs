/**
 * Driftwatch release gate - self-test.
 *
 * Zero findings from an unproven scanner is indistinguishable from zero
 * findings from a scanner with a typo in its regex. So the gate never reports
 * a clean result on a clean scan alone. Before it is allowed to scan anything
 * real it must, in this process:
 *
 *   - catch every freshly randomised positive canary, one per active detector;
 *   - return zero findings on the negative control;
 *   - account for every ACTIVE detector with at least one canary.
 *
 * "Active" matters. The detector set differs between the two modes: public
 * checks run without the operator's external denylist, so the denylist
 * detector is not in the set and is not claimed to have run. Coverage is
 * asserted against whatever set was actually built, so neither mode can pass
 * while a detector it does include sits inert.
 *
 * Success sets a proof token bound to this process id. `assertProven()` throws
 * without it, and there is no flag that skips this step.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildDetectors, loadDenylist } from './patterns.mjs';
import { buildCanaries, buildNegativeControl } from './canaries.mjs';

let proof = null;

export function selfTestProof() {
  return proof;
}

export function assertProven() {
  if (!proof || proof.ok !== true || proof.pid !== process.pid) {
    const err = new Error(
      'refusing to scan: the detectors have not proven themselves in this process',
    );
    err.gateExit = 2;
    throw err;
  }
  return proof;
}

/**
 * Run every detector over one piece of text.
 *
 * `surface` says whether this text can become public. Detectors are identical
 * either way - the tag only records where the finding came from, so the caller
 * can decide what it means.
 */
export function scanText(detectors, text, relPath, surface) {
  const findings = [];
  for (const d of detectors) {
    const hits = d.scan(text, relPath) || [];
    for (const h of hits) {
      findings.push({
        detector: d.id,
        label: d.label,
        severity: d.severity,
        surface: surface || 'publishable',
        path: relPath,
        line: h.line,
        excerpt: h.excerpt,
        why: h.why,
        valueHash: h.valueHash,
      });
    }
  }
  return findings;
}

/**
 * @param {object} [options]
 * @param {object|null} [options.denylist] loaded denylist, or null for a run
 *        that deliberately performs public checks only.
 */
export async function runSelfTest(options) {
  const opts = options || {};
  const deny = Object.prototype.hasOwnProperty.call(opts, 'denylist')
    ? opts.denylist
    : await loadDenylist(opts.denylistPath);

  const rules = deny ? deny.rules : [];
  const literals = deny ? deny.literals : [];
  const detectors = buildDetectors({ denylist: rules });
  const activeIds = new Set(detectors.map((d) => d.id));

  const dir = mkdtempSync(join(tmpdir(), 'driftwatch-canary-'));
  const results = [];
  let negative = null;

  try {
    // Only build canaries for detectors that are actually in this set.
    const canaries = buildCanaries(literals).filter((c) => activeIds.has(c.detector));

    for (const c of canaries) {
      const full = join(dir, c.file);
      writeFileSync(full, c.body, 'utf8');
      const findings = scanText(detectors, c.body, c.file);
      const caught = findings.some((f) => f.detector === c.detector);
      results.push({ detector: c.detector, file: c.file, caught });
    }

    const control = buildNegativeControl();
    writeFileSync(join(dir, control.file), control.body, 'utf8');
    const controlFindings = scanText(detectors, control.body, control.file);
    negative = { clean: controlFindings.length === 0, findings: controlFindings };
  } finally {
    // Canaries never survive the run that created them.
    rmSync(dir, { recursive: true, force: true });
  }

  const covered = new Set(results.map((r) => r.detector));
  const uncovered = [...activeIds].filter((id) => !covered.has(id));

  const caught = results.filter((r) => r.caught).length;
  const total = results.length;
  const ok = caught === total && negative.clean && uncovered.length === 0;

  proof = {
    ok,
    pid: process.pid,
    at: new Date().toISOString(),
    caught,
    total,
    missed: results.filter((r) => !r.caught).map((r) => r.detector),
    uncovered,
    activeDetectors: [...activeIds],
    denylistActive: Boolean(deny),
    negativeClean: negative.clean,
    negativeFindings: negative.findings,
    denylistFile: deny ? deny.file : null,
    denylistDigest: deny ? deny.digest : null,
    denylistRules: deny ? deny.rules.length : 0,
    denylistAllow: deny ? (deny.allow || []).length : 0,
    results,
  };

  return proof;
}

function report(p, verbose) {
  const lines = [];
  lines.push('release gate self-test');
  lines.push('  denylist        ' + (p.denylistActive
    ? p.denylistFile
    : 'NOT LOADED - public checks only, denylist detector not in this set'));
  if (p.denylistActive) {
    lines.push('  denylist rules  ' + p.denylistRules + ' forbidden, '
      + p.denylistAllow + ' expected-public (sha256:' + p.denylistDigest + ')');
  }
  lines.push('  detectors       ' + p.activeDetectors.length + ' active');
  lines.push('  canaries caught ' + p.caught + '/' + p.total);
  lines.push('  coverage        ' + (p.uncovered.length === 0
    ? 'every active detector has a canary'
    : 'MISSING canary for: ' + p.uncovered.join(', ')));
  lines.push('  negative ctrl   ' + (p.negativeClean
    ? 'clean (0 findings)'
    : 'DIRTY (' + p.negativeFindings.length + ' findings)'));
  if (p.missed.length) lines.push('  MISSED          ' + p.missed.join(', '));
  if (!p.negativeClean) {
    for (const f of p.negativeFindings) {
      lines.push('    false positive: ' + f.detector + ' line ' + f.line + ' :: ' + f.excerpt);
    }
  }
  if (verbose) {
    for (const r of p.results) {
      lines.push('    ' + (r.caught ? 'caught ' : 'MISSED ') + r.detector + '  <- ' + r.file);
    }
  }
  lines.push(p.ok ? 'SELF-TEST PASS' : 'SELF-TEST FAIL');
  return lines.join('\n');
}

const invokedDirectly = process.argv[1]
  && process.argv[1].replace(/\\/g, '/').endsWith('tools/release-gate/selftest.mjs');

if (invokedDirectly) {
  try {
    // `--public` proves the fork-safe detector set without needing any
    // operator-private material. Without it, the denylist is required.
    const publicOnly = process.argv.includes('--public');
    const p = await runSelfTest(publicOnly ? { denylist: null } : {});
    console.log(report(p, process.argv.includes('--verbose')));
    process.exit(p.ok ? 0 : 1);
  } catch (err) {
    console.error('gate error: ' + err.message);
    process.exit(err.gateExit || 2);
  }
}

/**
 * Driftwatch release gate - detector definitions.
 *
 * Every detector is a pure function over (text, relativePath). No detector may
 * be disabled by a flag, an environment variable, or an inline comment. If a
 * detector produces a false positive the detector itself gets narrowed, in
 * source, with the reason written down - never bypassed at the call site.
 *
 * Severity:
 *   block  - refused outright
 *   review - a human must clear the hit explicitly, per hit
 *
 * Detectors do not know or care which surface they are reading. What a finding
 * MEANS depends on whether the surface it came from can become public, and
 * that judgement belongs to the caller, not here. See gate.mjs.
 *
 * Every finding carries a valueHash: a digest of the matched text. It lets the
 * caller ask "did this same value also turn up on a publishable surface?"
 * without the value itself ever being stored, logged, or printed.
 */

import { createHash } from 'node:crypto';

/* ------------------------------------------------------------------ */
/* File-type allowlist. Anything not named here is blocked on sight.   */
/* ------------------------------------------------------------------ */

export const ALLOWED_EXTENSIONS = new Set([
  '.md', '.ts', '.js', '.mjs', '.json', '.html', '.css', '.yml', '.txt',
]);

export const ALLOWED_BASENAMES = new Set([
  'LICENSE', '.gitignore', '.editorconfig', '.gitattributes',
]);

/** Hosts a public repository of this project may legitimately link to. */
export const ALLOWED_HOSTS = new Set([
  'nodejs.org',
  'github.com',
  'raw.githubusercontent.com',
  'opensource.org',
  'www.contributor-covenant.org',
  'contributor-covenant.org',
  'developer.mozilla.org',
  'keepachangelog.com',
  'semver.org',
  'localhost',
  '127.0.0.1',
  'example.com',
  'example.invalid',
  // The SVG and XML namespace URIs are constants, not endpoints. Nothing is
  // fetched from them; they are how createElementNS identifies a namespace.
  'www.w3.org',
]);

/** Directories whose contents are generated but must still be scanned. */
export const GENERATED_DIRS = ['.driftwatch', 'dist', 'build', 'coverage'];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Never echo a suspected secret in full into a log or a report. */
export function mask(s) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (t.length <= 12) return t;
  return t.slice(0, 6) + '...' + t.slice(-4) + ' (' + t.length + ' chars)';
}

/**
 * A stable digest of a matched value, for correlating the same secret across
 * surfaces. Never reversible, never printed in place of the masked excerpt.
 */
export function hashValue(v) {
  return createHash('sha256').update(String(v)).digest('hex').slice(0, 16);
}

function shannon(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function luhnValid(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return digits.length >= 12 && sum % 10 === 0;
}

/** Collect every match of a regex as a finding. */
function collect(text, re, why, keepIf) {
  const out = [];
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const rx = new RegExp(re.source, flags);
  let m;
  while ((m = rx.exec(text)) !== null) {
    if (m[0].length === 0) { rx.lastIndex += 1; continue; }
    if (keepIf && keepIf(m) === false) continue;
    out.push({ line: lineOf(text, m.index), excerpt: mask(m[0]), why, valueHash: hashValue(m[0]) });
    if (out.length >= 25) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Denylist compilation (terms arrive from OUTSIDE the repository)     */
/* ------------------------------------------------------------------ */

export function compileDenylist(lines) {
  const rules = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('/') && line.lastIndexOf('/') > 0) {
      const body = line.slice(1, line.lastIndexOf('/'));
      rules.push(new RegExp(body, 'gi'));
    } else {
      const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      rules.push(new RegExp(escaped, 'gi'));
    }
  }
  return rules;
}

/**
 * Load the denylist from OUTSIDE the repository.
 *
 * A list of forbidden private words is itself the disclosure, so it can never
 * be committed. It is REQUIRED: an absent, unreadable, or implausibly short
 * list aborts the gate rather than letting it scan with one detector silently
 * doing nothing. The file's digest is returned so a swapped-in decoy list is
 * visible in the report.
 */
export const MIN_DENYLIST_RULES = 5;

export async function loadDenylist(explicitPath) {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const crypto = await import('node:crypto');

  const file = explicitPath
    || process.env.DRIFTWATCH_DENYLIST
    || path.join(os.homedir(), '.driftwatch-release-gate', 'denylist.local.txt');

  if (!fs.existsSync(file)) {
    const err = new Error('external denylist not found at ' + file);
    err.gateExit = 2;
    throw err;
  }

  const raw = fs.readFileSync(file, 'utf8');
  const literals = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('/'));
  const rules = compileDenylist(raw.split(/\r?\n/));

  if (rules.length < MIN_DENYLIST_RULES) {
    const err = new Error(
      'external denylist at ' + file + ' has only ' + rules.length
      + ' rules; at least ' + MIN_DENYLIST_RULES + ' are required',
    );
    err.gateExit = 2;
    throw err;
  }

  return {
    file,
    rules,
    literals,
    digest: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16),
  };
}

/* ------------------------------------------------------------------ */
/* Detectors                                                           */
/* ------------------------------------------------------------------ */

const PLACEHOLDER = /^(x{3,}|y{3,}|<[^>]*>|\{\{.*\}\}|changeme|example|placeholder|redacted|your[_-].*|todo|none|null)$/i;

/**
 * Build the active detector set.
 *
 * `denylist` is the operator's external rule list. When it is empty the
 * denylist detector is left OUT of the set entirely rather than included and
 * unable to fire. An inert detector reporting no findings looks identical to a
 * working one, which is exactly the confusion this whole tool exists to avoid;
 * omitting it means the run can say plainly which checks it performed.
 */
export function buildDetectors(options) {
  const denylist = (options && options.denylist) || [];

  const detectors = [
    {
      id: 'vendor-key',
      label: 'Vendor API key shape',
      severity: 'block',
      kind: 'content',
      scan: (text) => [
        ...collect(text, /\bsk-[A-Za-z0-9_-]{20,}/, 'provider secret key prefix'),
        ...collect(text, /\bpk-[A-Za-z0-9_-]{20,}/, 'provider publishable key prefix'),
        ...collect(text, /\bgh[pousr]_[A-Za-z0-9]{30,}/, 'code-host token prefix'),
        ...collect(text, /\bAKIA[0-9A-Z]{16}\b/, 'cloud access key id'),
        ...collect(text, /\bASIA[0-9A-Z]{16}\b/, 'cloud session key id'),
        ...collect(text, /\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'chat platform token prefix'),
        ...collect(text, /\bAIza[0-9A-Za-z_-]{30,}/, 'search provider key prefix'),
        ...collect(text, /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'signed web token'),
      ],
    },

    {
      id: 'private-key-block',
      label: 'Private key material',
      severity: 'block',
      kind: 'content',
      scan: (text) => collect(
        text,
        /-{3,}\s*BEGIN\s+(RSA|EC|DSA|OPENSSH|PGP|ENCRYPTED)?\s*PRIVATE KEY/i,
        'private key header',
      ),
    },

    {
      id: 'auth-material',
      label: 'Authorization headers, cookies, session material',
      severity: 'block',
      kind: 'content',
      scan: (text) => [
        // The header name is commonly a quoted object key, so allow a closing
        // quote between the name and the separator: "Authorization": "Bearer x".
        ...collect(text, /Authorization["']?[ \t]*[:=][ \t]*['"]?(Bearer|Basic|Token)[ \t]+[A-Za-z0-9._~+/=-]{8,}/i, 'authorization header carrying a value'),
        ...collect(text, /Set-Cookie[ \t]*[:=][ \t]*\S+=\S+/i, 'cookie being set'),
        ...collect(text, /\bCookie[ \t]*[:=][ \t]*['"]?[A-Za-z0-9_-]+=[A-Za-z0-9._~+/=-]{8,}/i, 'cookie being sent'),
        ...collect(text, /\b(session|sid|sess)[_-]?(id|token)?[ \t]*[:=][ \t]*['"][A-Za-z0-9._~+/=-]{16,}['"]/i, 'session identifier'),
      ],
    },

    {
      id: 'credential-config',
      label: 'Credential-shaped configuration value',
      severity: 'block',
      kind: 'content',
      scan: (text) => collect(
        text,
        /["']?(api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|passwd|private[_-]?key)["']?[ \t]*[:=][ \t]*["']([^"']{6,})["']/i,
        'named credential key with a concrete value',
        (m) => !PLACEHOLDER.test(m[2].trim()),
      ),
    },

    {
      id: 'env-file',
      label: 'Environment / credential file',
      severity: 'block',
      kind: 'path',
      scan: (_text, relPath) => {
        const base = relPath.split('/').pop() || '';
        const bad = /^\.env(\..+)?$/i.test(base)
          || /^(credentials|secret|secrets|\.netrc|\.npmrc|\.pypirc|id_rsa|id_ed25519)$/i.test(base)
          || /\.(pem|key|p12|pfx|keystore|jks|ppk)$/i.test(base);
        return bad
          ? [{ line: 0, excerpt: relPath, why: 'file name is credential-bearing by convention', valueHash: hashValue(relPath) }]
          : [];
      },
    },

    {
      id: 'high-entropy',
      label: 'Unexplained high-entropy string',
      severity: 'review',
      kind: 'content',
      scan: (text) => collect(
        text,
        /[A-Za-z0-9+/=_-]{40,}/,
        'long opaque token no other rule explains',
        (m) => {
          const tok = m[0];
          if (!/[0-9]/.test(tok) || !/[A-Za-z]/.test(tok)) return false;
          return shannon(tok) >= 4.0;
        },
      ),
    },

    {
      id: 'account-number',
      label: 'Account-number-like digit run',
      severity: 'review',
      kind: 'content',
      scan: (text) => collect(
        text,
        /(?<![\d.])\d{12,19}(?![\d.])/,
        'long bare digit run',
      ).map((f) => f),
    },

    {
      id: 'machine-path',
      label: 'Absolute creator-machine path',
      severity: 'block',
      kind: 'content',
      scan: (text) => [
        ...collect(text, /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/, 'windows user-profile path'),
        ...collect(text, /[A-Za-z]:\/Users\/[A-Za-z0-9._-]+/, 'windows user-profile path, forward slashes'),
        ...collect(text, /\/Users\/[A-Za-z0-9._-]+\//, 'macos home path'),
        ...collect(text, /\/home\/[A-Za-z0-9._-]+\//, 'linux home path'),
        ...collect(text, /\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9$._-]+/, 'unc network path'),
        ...collect(text, /[A-Za-z]:\\(?!Users)[A-Za-z0-9._-]+\\/, 'other absolute windows path'),
      ],
    },

    {
      id: 'personal-identifier',
      label: 'Personal identifier',
      severity: 'block',
      kind: 'content',
      scan: (text) => [
        ...collect(
          text,
          /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
          'email address',
          (m) => !/@(example\.(com|org|invalid)|localhost)$/i.test(m[0]),
        ),
        ...collect(text, /\+?1[ .-]?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/, 'phone number shape'),
      ],
    },

    {
      id: 'nonallowlisted-host',
      label: 'URL to a host that is not on the public allowlist',
      severity: 'review',
      kind: 'content',
      scan: (text) => collect(
        text,
        /\bhttps?:\/\/([A-Za-z0-9._-]+)(:\d+)?(?=[/\s"'`)\]]|$)/,
        'outbound link or endpoint',
        (m) => !ALLOWED_HOSTS.has(m[1].toLowerCase()),
      ),
    },

    {
      id: 'deployment-identifier',
      label: 'Deployment / infrastructure identifier',
      severity: 'block',
      kind: 'content',
      // Named hosting providers do not belong in a public rule. Naming one
      // points at infrastructure without protecting anything the generic
      // rules miss: a preview or deployment hostname is already an outbound
      // host, and `nonallowlisted-host` flags every host that is not on the
      // short public allowlist regardless of who operates it. Anything
      // narrower than that belongs in an operator's own external denylist.
      //
      // What stays here are opaque identifier shapes, which name nobody.
      scan: (text) => [
        ...collect(text, /\bprj_[A-Za-z0-9]{16,}/, 'opaque project id'),
        ...collect(text, /\bteam_[A-Za-z0-9]{12,}/, 'opaque team id'),
        ...collect(text, /\bdpl_[A-Za-z0-9]{12,}/, 'opaque deployment id'),
        ...collect(text, /\b[a-z0-9-]+\.(internal|corp|lan|intranet)\b/i, 'private-network hostname'),
      ],
    },

    {
      id: 'withheld-capability',
      label: 'Withheld capability wired into code',
      severity: 'block',
      kind: 'content',
      scan: (text) => [
        // Enumerating vendors by name would be both weaker and self-defeating:
        // weaker because it only catches the ones someone thought to list, and
        // self-defeating because the list itself becomes a string a privacy
        // denylist has to care about.
        //
        // The invariant this project actually holds is stronger and needs no
        // list: it has zero dependencies. So ANY import that is not a Node
        // builtin and not a relative path is a capability being wired in.
        // The specifier class is what a module specifier can actually contain.
        // Anything looser matches the word "from" inside ordinary prose that
        // happens to be followed by a quote - "readings from ' + min + '" is
        // not an import, and treating it as one would train people to ignore
        // this detector.
        ...collect(
          text,
          /\b(?:from|import|require)\s*\(?\s*['"]([A-Za-z0-9@._\-/]+)['"]/,
          'bare module import - this project has zero dependencies',
          (m) => {
            const spec = m[1];
            if (spec.startsWith('.') || spec.startsWith('/')) return false;
            if (spec.startsWith('node:')) return false;
            return true;
          },
        ),
        ...collect(text, /\bnavigator\.sendBeacon\b/, 'telemetry transport'),
      ],
    },

    {
      id: 'denylist-term',
      label: 'Private term from the external denylist',
      severity: 'block',
      kind: 'content',
      scan: (text) => {
        const out = [];
        for (const rule of denylist) {
          const flags = rule.flags.includes('g') ? rule.flags : rule.flags + 'g';
          const re = new RegExp(rule.source, flags);
          let m;
          while ((m = re.exec(text)) !== null) {
            if (m[0].length === 0) { re.lastIndex += 1; continue; }
            out.push({
              line: lineOf(text, m.index),
              excerpt: '[listed term withheld from this report]',
              why: 'external rule list',
              valueHash: hashValue(m[0].toLowerCase()),
            });
            if (out.length >= 25) return out;
          }
        }
        return out;
      },
    },

    {
      id: 'unknown-file-type',
      label: 'File type not on the allowlist',
      severity: 'block',
      kind: 'path',
      scan: (_text, relPath) => {
        const base = relPath.split('/').pop() || '';
        if (ALLOWED_BASENAMES.has(base)) return [];
        const dot = base.lastIndexOf('.');
        const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
        if (ext && ALLOWED_EXTENSIONS.has(ext)) return [];
        const shown = ext || '(none)';
        return [{ line: 0, excerpt: relPath, why: 'extension ' + shown + ' is not allowlisted', valueHash: hashValue(relPath) }];
      },
    },
  ];

  if (denylist.length === 0) {
    return detectors.filter((d) => d.id !== 'denylist-term');
  }
  return detectors;
}

/* Exported so the self-test can assert on the primitives directly. */
export const _internals = { shannon, luhnValid, PLACEHOLDER };

/**
 * Driftwatch release gate - canary generation.
 *
 * Positive controls. One canary per detector, regenerated with fresh random
 * material on every run so the gate can never pass by memorising a fixture.
 *
 * Two rules this file obeys strictly:
 *
 *   1. No canary literal appears in this source. Every trigger string is
 *      assembled at runtime from fragments, so scanning this file finds
 *      nothing and the gate does not trip over its own test material.
 *
 *   2. Canaries are written to a temporary directory outside the repository
 *      and deleted in the same run. There is no "remember to remove the
 *      canaries" step, because they never enter the working tree.
 */

import { randomInt } from 'node:crypto';

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGIT = '0123456789';

// Assembled at runtime so this file never literally contains a path
// separator run or an escape that a detector would read as one.
const BACKSLASH = String.fromCharCode(92);
const NEWLINE = String.fromCharCode(10);

function pick(chars) {
  return chars[randomInt(0, chars.length)];
}

function rand(n, chars) {
  let out = '';
  for (let i = 0; i < n; i += 1) out += pick(chars);
  return out;
}

/** Mixed-case alphanumeric run - what most opaque tokens look like. */
function token(n) {
  const alphabet = UPPER + LOWER + DIGIT;
  let out = rand(n, alphabet);
  // Guarantee both classes are present so entropy rules engage predictably.
  if (!/[0-9]/.test(out)) out = pick(DIGIT) + out.slice(1);
  if (!/[A-Za-z]/.test(out)) out = pick(LOWER) + out.slice(1);
  return out;
}

function word(n) {
  return rand(n, LOWER);
}

/** A digit run that satisfies the Luhn checksum, like a real account number. */
function luhnNumber(length) {
  const body = [];
  for (let i = 0; i < length - 1; i += 1) body.push(randomInt(0, 10));
  let sum = 0;
  let alt = true;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    let d = body[i];
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  const check = (10 - (sum % 10)) % 10;
  return body.join('') + String(check);
}

/**
 * Build one canary per detector id.
 *
 * @param {string[]} denylistSamples literal terms read from the external
 *        denylist, used to prove that list is genuinely wired in.
 */
export function buildCanaries(denylistSamples) {
  const samples = Array.isArray(denylistSamples) ? denylistSamples : [];
  const denySample = samples.length
    ? samples[randomInt(0, samples.length)]
    : null;

  const canaries = [
    {
      detector: 'vendor-key',
      file: 'canary-vendor-key.ts',
      body: 'export const client = { key: "' + 's' + 'k-' + token(38) + '" };\n',
    },
    {
      detector: 'private-key-block',
      file: 'canary-private-key.txt',
      body: '-----' + 'BEGIN RSA ' + 'PRIVATE' + ' KEY-----\n' + token(60) + '\n',
    },
    {
      detector: 'auth-material',
      file: 'canary-auth.ts',
      body: 'const h = { "' + 'Authorization' + '": "' + 'Bearer ' + token(44) + '" };\n',
    },
    {
      detector: 'credential-config',
      file: 'canary-credential.json',
      body: '{\n  "' + 'api' + '_key": "' + token(30) + '"\n}\n',
    },
    {
      detector: 'env-file',
      file: '.env',
      body: 'PORT=8787\n',
    },
    {
      detector: 'high-entropy',
      file: 'canary-entropy.txt',
      body: 'blob ' + token(56) + '\n',
    },
    {
      detector: 'account-number',
      file: 'canary-account.txt',
      body: 'reference ' + luhnNumber(16) + '\n',
    },
    {
      detector: 'machine-path',
      file: 'canary-path.md',
      body: 'built at ' + pick(UPPER) + ':' + BACKSLASH + 'Users' + BACKSLASH + word(7) + BACKSLASH + 'notes' + NEWLINE,
    },
    {
      detector: 'personal-identifier',
      file: 'canary-identity.md',
      body: 'contact ' + word(6) + '.' + word(5) + '@' + word(8) + '.com\n',
    },
    {
      detector: 'nonallowlisted-host',
      file: 'canary-host.md',
      body: 'see https://' + word(9) + '.' + word(3) + '/status\n',
    },
    {
      detector: 'deployment-identifier',
      file: 'canary-deployment.json',
      body: '{\n  "project": "' + 'prj' + '_' + token(24) + '"\n}\n',
    },
    {
      detector: 'withheld-capability',
      file: 'canary-capability.ts',
      body: 'import client from "' + word(6) + '-' + word(5) + '";' + NEWLINE + 'export default client;' + NEWLINE,
    },
    {
      detector: 'unknown-file-type',
      file: 'canary-payload.bin',
      body: 'inert placeholder\n',
    },
  ];

  if (denySample) {
    canaries.push({
      detector: 'denylist-term',
      file: 'canary-denylist.md',
      // The term is never printed to stdout and the file is deleted in-run.
      body: 'internal note about ' + denySample + ' handling\n',
    });
  }

  return canaries;
}

/**
 * Negative control. Must produce ZERO findings.
 *
 * This is the other half of the pair: a scanner that flags everything also
 * "fails closed", and is useless. Ordinary project prose has to come back
 * clean or the gate is not trustworthy either.
 */
export function buildNegativeControl() {
  return {
    file: 'control-clean.md',
    body: [
      '# Notes',
      '',
      'Driftwatch keeps the latest reading for each key and marks it stale',
      'once its TTL has elapsed. Intervals are given in milliseconds, so a',
      'thirty minute TTL is 1800000.',
      '',
      'Run the demo board with `npm start` and open http://localhost:8787',
      'in a browser. See https://nodejs.org for supported runtimes.',
      '',
      '| Key                   | Value | Unit |',
      '| --------------------- | ----- | ---- |',
      '| demo.device.battery   | 18    | %    |',
      '| demo.project.open     | 7     | task |',
      '',
    ].join('\n'),
  };
}

export const _internals = { token, luhnNumber, rand };

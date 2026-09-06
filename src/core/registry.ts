/**
 * Loading collectors, and loading config.
 *
 * A collector is any `.ts` or `.js` file in the collectors directory whose
 * default export looks like a Collector. Files starting with `_` are skipped,
 * which is the escape hatch for shared helpers.
 */

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Collector, Config } from './types.ts';

export const DEFAULT_CONFIG: Config = {
  port: 8787,
  collectorsDir: 'collectors',
  storeFile: '.driftwatch/store.json',
  historyLength: 10,
  rules: [],
};

/**
 * Config resolution, in order:
 *   1. config/driftwatch.json   - yours, gitignored, optional
 *   2. config/driftwatch.example.json - the demo config that ships with the repo
 *   3. built-in defaults
 *
 * No environment variables and no secrets. There is nothing to configure that
 * would need one.
 */
export function loadConfig(root: string): { config: Config; source: string } {
  const candidates = [
    join(root, 'config', 'driftwatch.json'),
    join(root, 'config', 'driftwatch.example.json'),
  ];

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>;
      return {
        config: { ...DEFAULT_CONFIG, ...parsed, rules: parsed.rules ?? [] },
        source: file,
      };
    } catch (err) {
      throw new Error('config at ' + file + ' is not valid JSON: ' + (err as Error).message);
    }
  }

  return { config: DEFAULT_CONFIG, source: '(built-in defaults)' };
}

function looksLikeCollector(value: unknown): value is Collector {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<Collector>;
  return typeof c.id === 'string'
    && typeof c.label === 'string'
    && typeof c.intervalMs === 'number'
    && typeof c.ttlMs === 'number'
    && typeof c.collect === 'function';
}

export async function loadCollectors(dir: string): Promise<Collector[]> {
  const full = resolve(dir);
  if (!existsSync(full)) return [];

  const files = readdirSync(full)
    .filter((f) => /\.(ts|js|mjs)$/.test(f))
    .filter((f) => !f.startsWith('_'))
    .sort();

  const collectors: Collector[] = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(full, file)).href);
    const candidate = mod.default ?? mod.collector;
    if (!looksLikeCollector(candidate)) {
      throw new Error(
        file + ' does not default-export a collector '
        + '(needs id, label, intervalMs, ttlMs and collect()).',
      );
    }
    collectors.push(candidate);
  }
  return collectors;
}

#!/usr/bin/env node
/**
 * driftwatch - command line entry point.
 *
 *   driftwatch once     run every collector once and print what came back
 *   driftwatch serve    run collectors on their intervals and serve the board
 *   driftwatch board    print the current board as JSON
 *   driftwatch gate     run the release gate
 */

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { loadConfig, loadCollectors } from './core/registry.ts';
import { collectOnce, startLoop } from './core/run.ts';
import { startServer } from './server/server.ts';
import { boardPayload } from './server/api.ts';
import { describeAge, describeDuration } from './core/freshness.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage(): void {
  console.log([
    '',
    '  driftwatch <command>',
    '',
    '    once     run every collector once and print what came back',
    '    serve    run collectors on their intervals and serve the board',
    '    board    print the current board as JSON',
    '    gate     run the release gate',
    '',
  ].join('\n'));
}

async function main(): Promise<number> {
  const command = process.argv[2] ?? 'serve';

  if (command === 'help' || command === '--help' || command === '-h') {
    usage();
    return 0;
  }

  if (command === 'gate') {
    const result = spawnSync(
      process.execPath,
      [join(ROOT, 'tools', 'release-gate', 'gate.mjs'), ...process.argv.slice(3)],
      { stdio: 'inherit' },
    );
    return result.status ?? 2;
  }

  const { config, source } = loadConfig(ROOT);
  const collectors = await loadCollectors(join(ROOT, config.collectorsDir));

  if (command === 'once') {
    const results = await collectOnce(ROOT, config, collectors);
    for (const r of results) {
      const line = r.error
        ? '  ' + r.collectorId + '  failed: ' + r.error
        : '  ' + r.collectorId + '  ' + r.readings + ' reading(s)';
      console.log(line);
    }
    printBoard(config);
    return results.some((r) => r.error) ? 1 : 0;
  }

  if (command === 'board') {
    console.log(JSON.stringify(boardPayload(ROOT, config), null, 2));
    return 0;
  }

  if (command === 'serve') {
    if (collectors.length === 0) {
      console.log('  no collectors found in ' + config.collectorsDir + '/');
      console.log('  copy examples/my-first-collector/collector.ts to get started');
    }
    startLoop(ROOT, config, collectors);
    const handle = await startServer(ROOT, config, collectors);
    console.log('');
    console.log('  driftwatch  config: ' + source);
    console.log('  ' + collectors.length + ' collector(s), board on http://localhost:' + handle.port);
    console.log('');
    return new Promise<number>(() => { /* run until interrupted */ });
  }

  console.error('unknown command: ' + command);
  usage();
  return 1;
}

function printBoard(config: Parameters<typeof boardPayload>[1]): void {
  const payload = boardPayload(ROOT, config);
  console.log('');
  for (const card of payload.cards) {
    const raw = String(card.value) + (card.unit ? ' ' + card.unit : '');
    // Keep the columns aligned when a value is a long ISO date.
    const value = raw.length > 13 ? raw.slice(0, 10) : raw;
    const flags = card.flags.length ? '  [' + card.flags.map((f) => f.name).join(' ') + ']' : '';
    console.log(
      '  ' + card.label.padEnd(26)
      + value.padEnd(14)
      + describeAge(card.at).padEnd(10)
      + 'ttl ' + describeDuration(card.ttlMs).padEnd(5)
      + flags,
    );
  }
  console.log('');
  console.log('  ' + payload.counts.cards + ' card(s), '
    + payload.counts.attention + ' need attention, '
    + payload.counts.stale + ' stale');
  console.log('');
}

process.exit(await main());

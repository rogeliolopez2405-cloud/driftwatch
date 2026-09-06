/**
 * The server: node:http, no framework, three routes.
 *
 * It binds to the loopback interface only. Driftwatch is a localhost tool and
 * exposing it on a network is not a feature it has.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize as normalizePath } from 'node:path';

import type { Collector, Config } from '../core/types.ts';
import { collectOnce } from '../core/run.ts';
import { boardPayload } from './api.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export interface ServerHandle {
  port: number;
  close(): Promise<void>;
}

export function startServer(
  root: string,
  config: Config,
  collectors: Collector[],
): Promise<ServerHandle> {
  const webDir = join(root, 'src', 'web');

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    if (path === '/api/board') {
      json(200, boardPayload(root, config));
      return;
    }

    if (path === '/api/refresh' && req.method === 'POST') {
      void collectOnce(root, config, collectors)
        .then((results) => json(200, { ok: true, results }))
        .catch((err: Error) => json(500, { ok: false, error: err.message }));
      return;
    }

    // Static files from src/web only. The join is normalized and re-checked so
    // a crafted path cannot climb out of the web directory.
    const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
    const file = normalizePath(join(webDir, rel));
    if (!file.startsWith(webDir) || !existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }

    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(readFileSync(file));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', () => {
      resolve({
        port: config.port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

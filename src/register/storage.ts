// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { promises as fs } from 'fs';
import path from 'path';

import { ApiClient } from '../api/client';
import {
  StorageCommand,
  StorageDeps,
  StorageListResult,
  StorageStatResult,
  StorageShareResult,
} from '../commands/storage';
import {
  SyncEngine,
  RemotePort,
  SyncStrategy,
  createFsLocalPort,
  summarizeSync,
  syncExitCode,
} from '../commands/storage-sync';
import { API_REQUEST_TIMEOUT_MS } from '../config/constants';
import { CommandDeps } from './types';

/** Normalize a --prefix to a single trailing slash (empty stays empty). EC-4. */
function normalizePrefix(raw: string): string {
  const trimmed = raw.trim().replace(/^\.\//, '').replace(/\/+$/, '');
  return trimmed === '' ? '' : `${trimmed}/`;
}

const UPLOAD_TIMEOUT_MS = 120_000;

/** Wraps a fetch failure into an Error carrying the HTTP status for exit mapping. */
async function httpBinary(
  method: 'PUT' | 'GET',
  url: string,
  token: string | null,
  body?: Buffer,
  contentType?: string,
): Promise<Buffer> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (contentType) headers['Content-Type'] = contentType;
  if (body) headers['Content-Length'] = String(body.length);

  const resp = await fetch(url, {
    method,
    headers,
    // Node's undici fetch accepts a Buffer/Uint8Array body; typed loosely to
    // avoid depending on the DOM BodyInit lib type (not enabled in this tsconfig).
    body: body ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  } as Parameters<typeof fetch>[1]);
  if (!resp.ok) {
    throw Object.assign(new Error(`storage ${method} failed: ${resp.status}`), { status: resp.status });
  }
  const arr = await resp.arrayBuffer();
  return Buffer.from(arr);
}

export function registerStorageCommands(deps: CommandDeps): void {
  const { program, configStore, isCI, writeTo, writeError, getGlobalOpts, apiUrl, handleUnauthorized, withTimeout } = deps;

  const token = () => configStore.getToken() ?? null;
  const api = () => new ApiClient({ baseURL: apiUrl, token: configStore.getToken() ?? undefined, onUnauthorized: handleUnauthorized });
  const enc = encodeURIComponent;
  const objectPath = (p: string) => p.split('/').map(enc).join('/');

  const buildDeps = (): StorageDeps => ({
    upload: (path, body, contentType) =>
      httpBinary('PUT', `${apiUrl}/v1/storage/objects/${objectPath(path)}`, token(), body, contentType).then(() => ({
        path,
        size: body.length,
      })),
    download: (path) => httpBinary('GET', `${apiUrl}/v1/storage/objects/${objectPath(path)}`, token()),
    // MEDIUM-3: follow next_cursor to completion so `theo storage list` shows ALL
    // files, not just the first server page.
    list: async (prefix) => {
      const c = api();
      const all: StorageListResult['files'] = [];
      let cursor = '';
      for (;;) {
        const qs = `prefix=${enc(prefix)}${cursor ? `&cursor=${enc(cursor)}` : ''}`;
        const page = await c.get<StorageListResult>(`/v1/storage/objects?${qs}`);
        all.push(...page.files);
        if (!page.next_cursor) break;
        cursor = page.next_cursor;
      }
      return { files: all, next_cursor: '' };
    },
    stat: (path) => api().get<StorageStatResult>(`/v1/storage/stat/${objectPath(path)}`),
    del: (path) => api().del<void>(`/v1/storage/objects/${objectPath(path)}`),
    share: (path, expires) =>
      api().post<StorageShareResult>('/v1/storage/share', { path, expires_in_seconds: expires }),
    readFile: (localPath) => fs.readFile(localPath),
    writeFile: (localPath, data) => fs.writeFile(localPath, data),
    writeTo,
    writeError,
    isCI,
  });

  const run = async (
    sub: 'upload' | 'download' | 'list' | 'stat' | 'delete' | 'share',
    opts: Parameters<StorageCommand['execute']>[1],
  ): Promise<never> => {
    const cmd = new StorageCommand(buildDeps());
    const code = await withTimeout(
      cmd.execute(sub, { ...opts, json: getGlobalOpts().json }),
      API_REQUEST_TIMEOUT_MS + 120_000,
      'Storage request timed out. Check your connection and try again.',
    ).catch((err: Error) => {
      writeError(err.message);
      return 5;
    });
    return process.exit(code);
  };

  const storageCmd = program.command('storage').description('Store and serve files for your app');

  storageCmd
    .command('upload <file> <path>')
    .description('Upload a file to storage')
    .action((file: string, path: string) => run('upload', { file, path }));

  storageCmd
    .command('download <path> [dest]')
    .description('Download a file from storage')
    .action((path: string, dest?: string) => run('download', { path, dest }));

  storageCmd
    .command('list [prefix]')
    .description('List files (optionally under a folder prefix)')
    .action((prefix?: string) => run('list', { prefix }));

  storageCmd
    .command('stat <path>')
    .description('Show a file’s size and type')
    .action((path: string) => run('stat', { path }));

  storageCmd
    .command('delete <path>')
    .description('Delete a file')
    .action((path: string) => run('delete', { path }));

  storageCmd
    .command('share <path>')
    .description('Create a temporary share link for a file')
    .option('--expires <seconds>', 'Link lifetime in seconds (default 900, max 604800)')
    .action((path: string, cmdOpts: { expires?: string }) => run('share', { path, expires: cmdOpts.expires }));

  // A RemotePort backed by the same /v1/storage/* surfaces the subcommands above
  // use (no parallel path — ADR D5). Kept behind the port interface so the engine
  // stays backend-agnostic (ADR D3).
  const buildRemotePort = (): RemotePort => ({
    listAll: async (prefix) => {
      const c = api();
      const all: { path: string; size: number; contentType: string }[] = [];
      let cursor = '';
      for (;;) {
        const qs = `prefix=${enc(prefix)}${cursor ? `&cursor=${enc(cursor)}` : ''}`;
        const page = await c.get<StorageListResult>(`/v1/storage/objects?${qs}`);
        all.push(...page.files.map((f) => ({ path: f.path, size: f.size, contentType: f.content_type })));
        if (!page.next_cursor) break;
        cursor = page.next_cursor;
      }
      return all;
    },
    download: (p) => httpBinary('GET', `${apiUrl}/v1/storage/objects/${objectPath(p)}`, token()),
    upload: (p, buf, contentType) =>
      httpBinary('PUT', `${apiUrl}/v1/storage/objects/${objectPath(p)}`, token(), buf, contentType).then(() => undefined),
    del: (p) => api().del<void>(`/v1/storage/objects/${objectPath(p)}`).then(() => undefined),
  });

  storageCmd
    .command('sync <local-dir>')
    .description('Sync a storage folder to a local directory (two-way). Synced files are data — they are not run — until sharing is enabled.')
    .requiredOption('--prefix <prefix>', 'The storage folder to sync, e.g. .claude/')
    .option('--strategy <strategy>', 'Resolve a file changed in both places: pull | push | backup')
    .action(async (localDir: string, cmdOpts: { prefix: string; strategy?: string }) => {
      const strategy = cmdOpts.strategy as SyncStrategy | undefined;
      if (strategy && !['pull', 'push', 'backup'].includes(strategy)) {
        writeError('Use --strategy=pull, push, or backup.');
        return process.exit(1);
      }
      const prefix = normalizePrefix(cmdOpts.prefix);
      if (!prefix) {
        writeError('Provide the storage folder with --prefix, e.g. --prefix .claude/');
        return process.exit(1);
      }
      const root = path.resolve(localDir);
      const engine = new SyncEngine(buildRemotePort(), createFsLocalPort(root), root, prefix);
      try {
        const result = await withTimeout(
          engine.run(strategy),
          API_REQUEST_TIMEOUT_MS + 300_000,
          'Sync timed out. Check your connection and try again.',
        );
        const { text, json } = summarizeSync(result);
        writeTo(getGlobalOpts().json ? JSON.stringify(json) : text);
        return process.exit(syncExitCode({ result }));
      } catch (err) {
        const status = (err as { status?: number }).status;
        writeError(status === 401 ? 'Please sign in again — run `theo login`.' : `Sync failed: ${(err as Error).message}`);
        return process.exit(syncExitCode({ errorStatus: status }));
      }
    });
}

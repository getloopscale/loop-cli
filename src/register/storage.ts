// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { promises as fs } from 'fs';

import { ApiClient } from '../api/client';
import {
  StorageCommand,
  StorageDeps,
  StorageListResult,
  StorageStatResult,
  StorageShareResult,
} from '../commands/storage';
import { API_REQUEST_TIMEOUT_MS } from '../config/constants';
import { CommandDeps } from './types';

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
}

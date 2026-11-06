// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { EXIT_CODES } from '../lib/exit-codes';
import { guessContentType } from '../lib/content-type';

export interface StorageListResult {
  files: Array<{ path: string; size: number; content_type: string }>;
  next_cursor: string;
}

export interface StorageStatResult {
  path: string;
  size: number;
  content_type: string;
}

export interface StorageShareResult {
  url: string;
  expires_at: string;
}

/**
 * StorageDeps injects the HTTP + filesystem boundary so the command logic is
 * unit-testable (house pattern). The `upload`/`download`/... functions map to
 * the /v1/storage/* API; readFile/writeFile touch the local disk.
 */
export interface StorageDeps {
  upload: (path: string, body: Buffer, contentType: string) => Promise<{ path: string; size: number }>;
  download: (path: string) => Promise<Buffer>;
  list: (prefix: string) => Promise<StorageListResult>;
  stat: (path: string) => Promise<StorageStatResult>;
  del: (path: string) => Promise<void>;
  share: (path: string, expiresSeconds: number) => Promise<StorageShareResult>;
  readFile: (localPath: string) => Promise<Buffer>;
  writeFile: (localPath: string, data: Buffer) => Promise<void>;
  writeTo: (msg: string) => void;
  writeError: (msg: string) => void;
  isCI: boolean;
}

export interface StorageOptions {
  file?: string;
  path?: string;
  dest?: string;
  prefix?: string;
  expires?: string;
  json?: boolean;
}

type Sub = 'upload' | 'download' | 'list' | 'stat' | 'delete' | 'share';

/**
 * StorageCommand implements `theo storage <sub>`. Product language only — never
 * "S3"/"bucket" in output (Rule 3). Exit codes follow the permanent contract
 * (Rule 4): 0 success, 1 usage/limit (user-correctable), 4 auth, 5 partial/network.
 */
export class StorageCommand {
  constructor(private readonly deps: StorageDeps) {}

  async execute(sub: Sub, opts: StorageOptions): Promise<number> {
    try {
      switch (sub) {
        case 'upload':
          return await this.upload(opts);
        case 'download':
          return await this.download(opts);
        case 'list':
          return await this.list(opts);
        case 'stat':
          return await this.stat(opts);
        case 'delete':
          return await this.delete(opts);
        case 'share':
          return await this.share(opts);
        default:
          this.deps.writeError(`Unknown storage command: ${sub}`);
          return EXIT_CODES.USAGE;
      }
    } catch (err) {
      return this.mapError(err);
    }
  }

  private async upload(opts: StorageOptions): Promise<number> {
    if (!opts.file || !opts.path) {
      this.deps.writeError('Usage: theo storage upload <file> <path>');
      return EXIT_CODES.USAGE;
    }
    const body = await this.deps.readFile(opts.file);
    const result = await this.deps.upload(opts.path, body, guessContentType(opts.path));
    this.print(opts, result, `Uploaded ${result.path} (${result.size} bytes)`);
    return EXIT_CODES.SUCCESS;
  }

  private async download(opts: StorageOptions): Promise<number> {
    if (!opts.path) {
      this.deps.writeError('Usage: theo storage download <path> [dest]');
      return EXIT_CODES.USAGE;
    }
    const bytes = await this.deps.download(opts.path);
    const dest = opts.dest ?? basename(opts.path);
    await this.deps.writeFile(dest, bytes);
    this.print(opts, { path: opts.path, dest, size: bytes.length }, `Downloaded ${opts.path} → ${dest}`);
    return EXIT_CODES.SUCCESS;
  }

  private async list(opts: StorageOptions): Promise<number> {
    const result = await this.deps.list(opts.prefix ?? '');
    if (opts.json) {
      this.deps.writeTo(JSON.stringify(result));
    } else if (result.files.length === 0) {
      this.deps.writeTo('No files.');
    } else {
      for (const f of result.files) {
        this.deps.writeTo(`${f.path}\t${f.size}\t${f.content_type}`);
      }
    }
    return EXIT_CODES.SUCCESS;
  }

  private async stat(opts: StorageOptions): Promise<number> {
    if (!opts.path) {
      this.deps.writeError('Usage: theo storage stat <path>');
      return EXIT_CODES.USAGE;
    }
    const result = await this.deps.stat(opts.path);
    this.print(opts, result, `${result.path}\t${result.size} bytes\t${result.content_type}`);
    return EXIT_CODES.SUCCESS;
  }

  private async delete(opts: StorageOptions): Promise<number> {
    if (!opts.path) {
      this.deps.writeError('Usage: theo storage delete <path>');
      return EXIT_CODES.USAGE;
    }
    await this.deps.del(opts.path);
    this.print(opts, { path: opts.path, deleted: true }, `Deleted ${opts.path}`);
    return EXIT_CODES.SUCCESS;
  }

  private async share(opts: StorageOptions): Promise<number> {
    if (!opts.path) {
      this.deps.writeError('Usage: theo storage share <path> --expires <seconds>');
      return EXIT_CODES.USAGE;
    }
    const expires = opts.expires ? parseInt(opts.expires, 10) : 900;
    const result = await this.deps.share(opts.path, expires);
    this.print(opts, result, `Share link (expires ${result.expires_at}): ${result.url}`);
    return EXIT_CODES.SUCCESS;
  }

  private print(opts: StorageOptions, jsonObj: unknown, human: string): void {
    this.deps.writeTo(opts.json ? JSON.stringify(jsonObj) : human);
  }

  /** Map an API error to the permanent exit-code contract (Rule 4). */
  private mapError(err: unknown): number {
    const status = (err as { status?: number })?.status;
    const message = (err as Error)?.message ?? 'Storage request failed';
    if (status === 401 || status === 403) {
      this.deps.writeError('Access denied. Ensure your API key carries the storage scope (storage:read / storage:write).');
      return EXIT_CODES.AUTH_ERROR;
    }
    if (status === 402) {
      this.deps.writeError('Your plan storage limit has been reached. Upgrade your plan or delete files.');
      return EXIT_CODES.USAGE;
    }
    if (status === 413) {
      this.deps.writeError('This file exceeds the maximum file size for your plan.');
      return EXIT_CODES.USAGE;
    }
    if (status === 404) {
      this.deps.writeError('File not found.');
      return EXIT_CODES.USAGE;
    }
    if (status === 400) {
      this.deps.writeError(message);
      return EXIT_CODES.USAGE;
    }
    this.deps.writeError('Storage is temporarily unavailable. Please try again.');
    return EXIT_CODES.PARTIAL;
  }
}

function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(idx + 1) : p;
}

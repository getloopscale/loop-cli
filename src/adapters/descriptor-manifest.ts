// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import type { TheoYaml } from './theo-yaml';
import { DESCRIPTOR_FILE_NAME } from './theo-yaml';

/** The runtimes the platform builds an image for. The API's manifest schema has the same list. */
export const SUPPORTED_RUNTIMES: readonly string[] = ['node', 'python'];

/** One service of the manifest the source upload requires (schema version 2). */
export interface ManifestService {
  name: string;
  runtime: string;
  type: 'server' | 'worker';
  port: number;
  proxy: string;
  dev: string;
  start: string;
  healthcheck: string;
  cors: boolean;
  passSetCookie: boolean;
}

export interface ServicesManifest {
  version: 2;
  project: string;
  services: ManifestService[];
}

/** The descriptor lacks what a manifest needs. The message says what to add. */
export class DescriptorManifestError extends Error {
  public readonly code = 'DESCRIPTOR_INCOMPLETE';
  constructor(message: string) {
    super(message);
    this.name = 'DescriptorManifestError';
  }
}

/**
 * Builds the services manifest from the descriptor, for a project that ships none.
 * The API builds the image from `runtime` and `start`, as it does on a push.
 * `proxy`, `dev` and `healthcheck` are required by the schema and not read by the
 * build, so they take a value derived from the app.
 */
export function manifestFromDescriptor(
  config: Pick<TheoYaml, 'project'> & { apps: Record<string, unknown> },
  selectedApps?: readonly string[],
): ServicesManifest {
  const services: ManifestService[] = [];
  for (const [name, raw] of Object.entries(config.apps)) {
    if (selectedApps && !selectedApps.includes(name)) {
      continue;
    }
    const app = (raw ?? {}) as { runtime?: string; start?: string; type?: string; port?: number | null };
    if (!app.runtime) {
      throw new DescriptorManifestError(
        `App '${name}' declares no runtime. Add \`runtime: node\` or \`runtime: python\` and a \`start\` command to ${DESCRIPTOR_FILE_NAME}.`,
      );
    }
    if (!app.start) {
      throw new DescriptorManifestError(
        `App '${name}' declares no start command. Add \`start\`, the command that runs the app, to ${DESCRIPTOR_FILE_NAME}.`,
      );
    }
    services.push({
      name,
      runtime: app.runtime,
      type: app.type === 'worker' ? 'worker' : 'server',
      port: app.port ?? 8080,
      proxy: `/${name}`,
      dev: app.start,
      start: app.start,
      healthcheck: '/health',
      cors: false,
      passSetCookie: false,
    });
  }
  return { version: 2, project: config.project, services };
}

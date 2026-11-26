// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { DescriptorManifestError, manifestFromDescriptor } from '../../../src/adapters/descriptor-manifest';

describe('manifestFromDescriptor', () => {
  it('turns each app that declares runtime and start into a service of the manifest', () => {
    const manifest = manifestFromDescriptor({
      project: 'hello',
      apps: {
        web: { path: '.', port: 8080, runtime: 'node', start: 'node server.js' },
        jobs: { path: 'jobs', port: 9000, runtime: 'python', start: 'python worker.py', type: 'server' },
      },
    });

    expect(manifest).toEqual({
      version: 2,
      project: 'hello',
      services: [
        {
          name: 'web', runtime: 'node', type: 'server', port: 8080, proxy: '/web',
          dev: 'node server.js', start: 'node server.js', healthcheck: '/health', cors: false, passSetCookie: false,
        },
        {
          name: 'jobs', runtime: 'python', type: 'server', port: 9000, proxy: '/jobs',
          dev: 'python worker.py', start: 'python worker.py', healthcheck: '/health', cors: false, passSetCookie: false,
        },
      ],
    });
  });

  it('keeps only the apps asked for', () => {
    const manifest = manifestFromDescriptor(
      {
        project: 'hello',
        apps: {
          web: { path: '.', port: 8080, runtime: 'node', start: 'node server.js' },
          api: { path: 'api', port: 3000, runtime: 'node', start: 'node api.js' },
        },
      },
      ['api'],
    );
    expect(manifest.services.map((s) => s.name)).toEqual(['api']);
  });

  it('refuses an app with no runtime and says what to add', () => {
    expect(() =>
      manifestFromDescriptor({ project: 'hello', apps: { web: { path: '.', port: 8080, framework: 'express' } } }),
    ).toThrow(DescriptorManifestError);
    expect(() =>
      manifestFromDescriptor({ project: 'hello', apps: { web: { path: '.', port: 8080, framework: 'express' } } }),
    ).toThrow(/App 'web' declares no runtime\. Add `runtime: node` or `runtime: python` and a `start` command to loopscale\.yaml/);
  });

  it('refuses an app with a runtime and no start command', () => {
    expect(() =>
      manifestFromDescriptor({ project: 'hello', apps: { web: { path: '.', port: 8080, runtime: 'node' } } }),
    ).toThrow(/App 'web' declares no start command/);
  });
});

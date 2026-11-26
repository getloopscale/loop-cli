// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import * as fs from 'fs';
import * as path from 'path';

// npm trusts getloopscale/loop-cli's publish.yml through OIDC (trusted publishing), so the
// release job publishes with a short-lived credential instead of a long-lived token.
describe('publish workflow', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/publish.yml'), 'utf-8');

  it('publishes without an npm token', () => {
    expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
  });

  it('lets the job request an OIDC id-token', () => {
    expect(workflow).toMatch(/id-token:\s*write/);
  });

  it('runs an npm that supports trusted publishing (11.5.1 or newer)', () => {
    expect(workflow).toMatch(/npm install -g npm@11\b/);
  });
});

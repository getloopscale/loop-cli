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

  it('refuses a tag that does not name the version in package.json', () => {
    expect(workflow).toMatch(/github\.ref_name/);
    expect(workflow).toMatch(/does not match package\.json version/);
  });

  it('checks the tag before anything is published', () => {
    expect(workflow.indexOf('does not match package.json version')).toBeLessThan(workflow.indexOf('npm publish'));
  });

  it('grants no permission outside the publish job', () => {
    expect(workflow).toMatch(/^permissions: \{\}$/m);
  });
});

describe('workflows', () => {
  const dir = path.resolve(__dirname, '../../.github/workflows');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.yml'));

  it.each(files)('%s pins every action to a commit', (name) => {
    const uses = fs.readFileSync(path.join(dir, name), 'utf-8').match(/uses:\s*\S+/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      expect(use).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it.each(files)('%s bounds every job with a timeout', (name) => {
    const text = fs.readFileSync(path.join(dir, name), 'utf-8');
    const jobs = (text.match(/^ {4}runs-on:/gm) ?? []).length;
    expect((text.match(/^ {4}timeout-minutes:/gm) ?? []).length).toBe(jobs);
  });

  it('runs the tests of a pull request before it is merged', () => {
    expect(fs.readFileSync(path.join(dir, 'ci.yml'), 'utf-8')).toMatch(/^ {2}pull_request:/m);
  });
});

// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import * as fs from 'fs';
import * as path from 'path';

describe('package.json identity', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

  it('is published as @getloopscale/loop-cli', () => {
    expect(pkg.name).toBe('@getloopscale/loop-cli');
  });

  it('installs a single `loopscale` command pointing at bin/loopscale', () => {
    expect(pkg.bin).toEqual({ loopscale: './bin/loopscale' });
    expect(fs.existsSync(path.resolve(__dirname, '../../bin/loopscale'))).toBe(true);
  });

  it('points homepage, repository and bugs at LoopScale', () => {
    expect(pkg.homepage).toBe('https://getloopscale.com');
    expect(pkg.repository.url).toBe('git+https://github.com/getloopscale/loop-cli.git');
    expect(pkg.bugs.url).toBe('https://github.com/getloopscale/loop-cli/issues');
  });
});

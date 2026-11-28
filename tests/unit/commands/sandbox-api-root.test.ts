// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { stripEngineSuffix } from '../../../src/config/constants';
import { createProgram } from '../../../src/index';

describe('where the sandbox commands send their requests', () => {
  it('uses the console root, since /v1/sandboxes is not under the engine proxy', () => {
    expect(stripEngineSuffix('https://app.staging.getloopscale.com/engine')).toBe('https://app.staging.getloopscale.com');
    expect(stripEngineSuffix('https://app.staging.getloopscale.com/engine/')).toBe('https://app.staging.getloopscale.com');
    expect(stripEngineSuffix('http://localhost:8080')).toBe('http://localhost:8080');
  });

  it('registers sandbox list and sandbox kill', () => {
    const sandbox = createProgram().commands.find((command) => command.name() === 'sandbox');

    expect(sandbox?.commands.map((command) => command.name()).sort()).toEqual(['kill', 'list']);
  });
});

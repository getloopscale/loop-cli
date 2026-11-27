// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import {
  EXIT_CODES,
  buildStateToExitCode,
  isValidExitCode,
} from '../../src/lib/exit-codes';

describe('EXIT_CODES (plan T1.2 D3 — Rule 4)', () => {
  test('exactly 6 codes per Rule 4: 0/1/2/3/4/5', () => {
    expect(EXIT_CODES.SUCCESS).toBe(0);
    expect(EXIT_CODES.USAGE).toBe(1);
    expect(EXIT_CODES.BUILD_FAILED).toBe(2);
    expect(EXIT_CODES.DEPLOY_FAILED).toBe(3);
    expect(EXIT_CODES.AUTH_ERROR).toBe(4);
    expect(EXIT_CODES.PARTIAL).toBe(5);
    expect(Object.keys(EXIT_CODES)).toHaveLength(6);
  });
});

describe('buildStateToExitCode', () => {
  test.each([
    ['SUCCEEDED', EXIT_CODES.SUCCESS],
    ['FAILED', EXIT_CODES.BUILD_FAILED],
    ['CANCELLED', EXIT_CODES.BUILD_FAILED],
  ])('build state %s → exit %d', (state, expected) => {
    expect(buildStateToExitCode(state)).toBe(expected);
  });

  test('unknown build state defaults to BUILD_FAILED', () => {
    expect(buildStateToExitCode('WEIRD')).toBe(EXIT_CODES.BUILD_FAILED);
    expect(buildStateToExitCode(undefined)).toBe(EXIT_CODES.BUILD_FAILED);
  });
});

describe('isValidExitCode (T1.2 plan — exhaustive)', () => {
  test('test_deploy_never_exits_with_code_outside_rule_4_table', () => {
    expect(isValidExitCode(0)).toBe(true);
    expect(isValidExitCode(1)).toBe(true);
    expect(isValidExitCode(2)).toBe(true);
    expect(isValidExitCode(3)).toBe(true);
    expect(isValidExitCode(4)).toBe(true);
    expect(isValidExitCode(5)).toBe(true);
    expect(isValidExitCode(6)).toBe(false);
    expect(isValidExitCode(-1)).toBe(false);
    expect(isValidExitCode(127)).toBe(false);
  });
});

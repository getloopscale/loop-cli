// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import * as fs from 'fs';

export function cleanupFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* ignore — file may already be gone */
  }
}

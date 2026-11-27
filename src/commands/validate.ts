// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { LoopScaleYamlResult } from '../adapters/loopscale-yaml';
import { validateConfig } from '../adapters/validate-config';
import * as path from 'path';

export interface ValidateDeps {
  findLoopScaleYaml: () => LoopScaleYamlResult | null;
  writeTo: (msg: string) => void;
  writeError: (msg: string) => void;
}

export interface ValidateOptions {
  json?: boolean;
}

export class ValidateCommand {
  private readonly deps: ValidateDeps;

  constructor(deps: ValidateDeps) {
    this.deps = deps;
  }

  async execute(opts: ValidateOptions): Promise<number> {
    // 1. Find loopscale.yaml
    const yamlResult = this.deps.findLoopScaleYaml();
    if (!yamlResult) {
      if (opts.json) {
        this.deps.writeTo(JSON.stringify({ valid: false, errors: [{ field: 'loopscale.yaml', message: 'No loopscale.yaml found. Run: loopscale init' }], apps: 0 }));
      } else {
        this.deps.writeError('No loopscale.yaml found. Run: loopscale init');
      }
      return 1;
    }

    if (yamlResult.parseError) {
      if (opts.json) {
        this.deps.writeTo(JSON.stringify({ valid: false, errors: [{ field: yamlResult.fileName, message: yamlResult.parseError }], apps: 0 }));
      } else {
        this.deps.writeError(`Invalid ${yamlResult.fileName}: ${yamlResult.parseError}`);
      }
      return 1;
    }

    const config = yamlResult.content;
    const projectRoot = path.dirname(yamlResult.path);
    const appCount = Object.keys(config.apps).length;

    // 2. Run validation
    const { errors, warnings } = validateConfig(config, projectRoot);

    // 3. Output results
    if (opts.json) {
      this.deps.writeTo(JSON.stringify({
        valid: errors.length === 0,
        errors: errors.map(e => ({ field: e.field, message: e.message })),
        warnings,
        apps: appCount,
      }));
    } else {
      if (warnings.length > 0) {
        for (const w of warnings) {
          this.deps.writeTo(`Warning: ${w}`);
        }
      }
      if (errors.length > 0) {
        for (const e of errors) {
          this.deps.writeError(`Error: ${e.message}`);
        }
        this.deps.writeError(`\n${yamlResult.fileName} has ${errors.length} error(s). Fix them and try again.`);
      } else {
        this.deps.writeTo(`${yamlResult.fileName} is valid (${appCount} app${appCount !== 1 ? 's' : ''})`);
      }
    }

    return errors.length > 0 ? 1 : 0;
  }
}

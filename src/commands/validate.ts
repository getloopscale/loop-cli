// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { TheoYamlResult } from '../adapters/theo-yaml';
import { validateConfig, ValidationError } from '../adapters/validate-config';
import * as path from 'path';

export interface ValidateDeps {
  getToken: () => string | null;
  findTheoYaml: () => TheoYamlResult | null;
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
    // 1. Find theo.yaml
    const yamlResult = this.deps.findTheoYaml();
    if (!yamlResult) {
      if (opts.json) {
        this.deps.writeTo(JSON.stringify({ valid: false, errors: [{ field: 'theo.yaml', message: 'No theo.yaml found. Run: theo init' }], apps: 0 }));
      } else {
        this.deps.writeError('No theo.yaml found. Run: theo init');
      }
      return 1;
    }

    if (yamlResult.parseError) {
      if (opts.json) {
        this.deps.writeTo(JSON.stringify({ valid: false, errors: [{ field: 'theo.yaml', message: yamlResult.parseError }], apps: 0 }));
      } else {
        this.deps.writeError(`Invalid theo.yaml: ${yamlResult.parseError}`);
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
        this.deps.writeError(`\ntheo.yaml has ${errors.length} error(s). Fix them and try again.`);
      } else {
        this.deps.writeTo(`theo.yaml is valid (${appCount} app${appCount !== 1 ? 's' : ''})`);
      }
    }

    return errors.length > 0 ? 1 : 0;
  }
}

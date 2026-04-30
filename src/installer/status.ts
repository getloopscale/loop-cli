// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// CHG-2026-04-30-INFRA-PARITY / T3.1 — `getPlatformStatus` extraído de
// installer/components.ts (deletado por dead-code Rule 3 violations).
// Único módulo neutro de status; sem strings com termos internos.

import { execSync } from 'child_process';
import { releaseExists } from './helm';
import { ComponentStatus, PlatformStatus } from './types';

const CHART_VERSION = '0.2.0';

/**
 * Returns the current platform installation status by querying live K8s
 * state. Used by `theo platform status` and platform install Step 6
 * (validation).
 *
 * Output is product-language only (Rule 3): no "ArgoCD"/"Gitea"/"MinIO"
 * leaks. Component names map directly to user-facing chart releases.
 */
export function getPlatformStatus(): PlatformStatus {
  const components: ComponentStatus[] = [];

  const theoComponents = [
    'theo-api',
    'theo-tenant-controller',
    'theo-controller',
    'theo-cloud',
    'theo-dashboard',
  ];
  for (const name of theoComponents) {
    try {
      const output = execSync(
        `kubectl get deploy -n theo-system -l app.kubernetes.io/name=${name} -o jsonpath="{.items[0].status.readyReplicas}/{.items[0].spec.replicas}"`,
        { encoding: 'utf-8', timeout: 5_000 },
      ).trim();
      components.push({
        name,
        status: output.startsWith('0/') || !output ? 'Pending' : 'Running',
        replicas: output || '0/0',
      });
    } catch {
      components.push({ name, status: 'NotInstalled' });
    }
  }

  let crdsInstalled = 0;
  try {
    crdsInstalled = parseInt(
      execSync('kubectl get crd -o name 2>/dev/null | grep theo.io | wc -l', { encoding: 'utf-8' }).trim(),
      10,
    );
  } catch {
    // ignore
  }

  const installed = releaseExists('theo', 'theo-system');
  let phase: PlatformStatus['phase'] = 'NotInstalled';
  if (installed) {
    const allRunning = components.every((c) => c.status === 'Running');
    const anyFailed = components.some((c) => c.status === 'Failed');
    if (allRunning) phase = 'Ready';
    else if (anyFailed) phase = 'Failed';
    else phase = 'Degraded';
  }

  return {
    phase,
    version: CHART_VERSION,
    components,
    crdsInstalled,
    endpoints: {
      api: installed ? `https://api.${process.env.THEO_DOMAIN || 'localhost'}` : undefined,
      dashboard: installed ? `https://cloud.${process.env.THEO_DOMAIN || 'localhost'}` : undefined,
    },
  };
}

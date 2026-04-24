// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { execSync } from 'child_process';
import { PlatformConfig, PlatformStatus, ComponentStatus } from './types';
import { installOrUpgrade, uninstall, test as helmTest, releaseExists } from './helm';

/**
 * OCI registry for Theo Helm charts.
 */
const CHART_REGISTRY = 'oci://registry.digitalocean.com/theo-system/helm';
const CHART_VERSION = '0.1.3';

/**
 * Install Theo CRDs (lifecycle independent, installed first).
 */
export function installCRDs(log: (msg: string) => void): void {
  log('  Installing CRDs...');
  installOrUpgrade({
    name: 'theo-crds',
    chart: `${CHART_REGISTRY}/theo-crds`,
    version: CHART_VERSION,
    namespace: 'theo-system',
    createNamespace: true,
    wait: true,
    timeout: '2m',
  });

  // Verify CRD count
  try {
    const crds = execSync('kubectl get crd -o name 2>/dev/null | grep theo.io | wc -l', {
      encoding: 'utf-8',
    }).trim();
    log(`  ✓ ${crds} Theo CRDs installed`);
  } catch {
    log('  ✓ CRDs installed');
  }
}

/**
 * Build Helm values for the platform chart based on customer config.
 */
function buildPlatformValues(config: PlatformConfig): Record<string, unknown> {
  const values: Record<string, unknown> = {
    'global.registry': 'registry.digitalocean.com/theo-system',
  };

  // API config
  values['theo-api.config.baseDomain'] = config.domain;
  values['theo-api.config.giteaUrl'] = `http://gitea-http.gitea.svc.cluster.local:3000`;
  values['theo-api.config.argocdUrl'] = `http://argocd-server.argocd.svc.cluster.local:80`;
  values['theo-api.config.minioEndpoint'] = `minio.theo-system.svc.cluster.local:9000`;
  values['theo-api.config.registryUrl'] = config.registry.endpoint;

  // Database
  if (config.database.external && config.database.url) {
    values['theo-api.secrets.databaseUrl'] = config.database.url;
    values['theo-controller.secrets.databaseUrl'] = config.database.url;
  }

  // Profile-based sizing
  if (config.profile === 'production') {
    values['theo-api.replicaCount'] = '2';
    values['theo-cloud.replicaCount'] = '2';
    values['theo-dashboard.replicaCount'] = '2';
    values['theo-api.networkPolicy.enabled'] = 'true';
    values['theo-cloud.networkPolicy.enabled'] = 'true';
    values['theo-dashboard.networkPolicy.enabled'] = 'true';
  }

  return values;
}

/**
 * Install Theo platform components via umbrella chart.
 */
export function installPlatform(config: PlatformConfig, log: (msg: string) => void): void {
  const values = buildPlatformValues(config);

  log('  Installing Theo platform...');
  installOrUpgrade({
    name: 'theo',
    chart: `${CHART_REGISTRY}/theo-platform`,
    version: CHART_VERSION,
    namespace: 'theo-system',
    createNamespace: true,
    values,
    wait: true,
    timeout: '5m',
  });
  log('  ✓ Theo platform installed');
}

/**
 * Upgrade Theo platform to a new version.
 */
export function upgradePlatform(version: string, config: PlatformConfig, log: (msg: string) => void): void {
  const values = buildPlatformValues(config);

  log(`  Upgrading to v${version}...`);

  // CRDs first
  installOrUpgrade({
    name: 'theo-crds',
    chart: `${CHART_REGISTRY}/theo-crds`,
    version: version,
    namespace: 'theo-system',
    wait: true,
    timeout: '2m',
  });

  // Platform
  installOrUpgrade({
    name: 'theo',
    chart: `${CHART_REGISTRY}/theo-platform`,
    version: version,
    namespace: 'theo-system',
    values,
    wait: true,
    timeout: '5m',
  });
  log(`  ✓ Upgraded to v${version}`);
}

/**
 * Uninstall Theo platform (preserves CRDs and data).
 */
export function uninstallPlatform(log: (msg: string) => void): void {
  log('  Removing Theo platform...');
  uninstall('theo', 'theo-system');
  log('  ✓ Platform removed (CRDs and data preserved)');
  log('  To remove CRDs: helm uninstall theo-crds -n theo-system');
}

/**
 * Run helm test hooks to validate installation.
 */
export function validateInstallation(log: (msg: string) => void): boolean {
  log('  Running health checks...');
  const ok = helmTest('theo', 'theo-system');
  if (ok) {
    log('  ✓ All health checks passed');
  } else {
    log('  ✗ Some health checks failed — run: helm test theo -n theo-system');
  }
  return ok;
}

/**
 * Wait for all pods in theo-system to be Ready.
 */
export function waitForPods(log: (msg: string) => void, timeoutSec = 120): boolean {
  log('  Waiting for pods...');
  const deadline = Date.now() + timeoutSec * 1000;

  while (Date.now() < deadline) {
    try {
      const output = execSync(
        'kubectl get pods -n theo-system -o jsonpath="{.items[*].status.conditions[?(@.type==\'Ready\')].status}"',
        { encoding: 'utf-8', timeout: 10_000 },
      ).trim();
      const statuses = output.split(' ').filter(Boolean);
      const allReady = statuses.length > 0 && statuses.every((s) => s === 'True');
      if (allReady) {
        log(`  ✓ All ${statuses.length} pods Ready (${Math.round((Date.now() - (deadline - timeoutSec * 1000)) / 1000)}s)`);
        return true;
      }
    } catch {
      // kubectl may fail transiently
    }
    execSync('sleep 3');
  }

  log('  ✗ Timeout waiting for pods');
  return false;
}

/**
 * Get current platform status.
 */
export function getPlatformStatus(): PlatformStatus {
  const components: ComponentStatus[] = [];

  // Check each Theo component
  const theoComponents = ['theo-api', 'theo-tenant-controller', 'theo-controller', 'theo-cloud', 'theo-dashboard'];
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

  // CRD count
  let crdsInstalled = 0;
  try {
    crdsInstalled = parseInt(
      execSync('kubectl get crd -o name 2>/dev/null | grep theo.io | wc -l', { encoding: 'utf-8' }).trim(),
      10,
    );
  } catch {
    // ignore
  }

  // Determine phase
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

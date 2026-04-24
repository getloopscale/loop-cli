// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { execSync } from 'child_process';
import { PlatformConfig, PlatformStatus, ComponentStatus } from './types';
import { BootstrapTokens } from './bootstrap';
import { installOrUpgrade, uninstall, test as helmTest, releaseExists } from './helm';

/**
 * OCI registry for Theo Helm charts.
 */
const CHART_REGISTRY = 'oci://registry.digitalocean.com/theo-system/helm';
const CHART_VERSION = '0.2.0';
const IMAGE_PULL_SECRET_NAME = 'theo-system-pull';

/**
 * Ensure DOCR imagePullSecret exists in the target namespace.
 * Uses doctl to generate a docker config, or falls back to existing docker config.
 */
export function ensureImagePullSecret(namespace: string, log: (msg: string) => void): void {
  try {
    // Check if secret already exists
    execSync(`kubectl get secret ${IMAGE_PULL_SECRET_NAME} -n ${namespace}`, {
      stdio: 'pipe', timeout: 5_000,
    });
    log(`  ✓ Image pull secret exists`);
    return;
  } catch {
    // Secret doesn't exist — create it
  }

  // Try doctl registry login first (refreshes docker config)
  try {
    execSync('doctl registry login --expiry-seconds 3600', { stdio: 'pipe', timeout: 30_000 });
  } catch {
    // doctl may not be available — try with existing docker config
  }

  // Find docker config
  const home = process.env.HOME || '/root';
  const dockerConfigPaths = [
    `${home}/.docker/config.json`,
    '/root/.docker/config.json',
  ];

  let dockerConfig = '';
  for (const p of dockerConfigPaths) {
    try {
      execSync(`test -f ${p}`, { stdio: 'pipe' });
      dockerConfig = p;
      break;
    } catch {
      continue;
    }
  }

  if (dockerConfig) {
    // Create from docker config file
    execSync(
      `kubectl create secret generic ${IMAGE_PULL_SECRET_NAME} ` +
      `--namespace ${namespace} ` +
      `--from-file=.dockerconfigjson=${dockerConfig} ` +
      `--type=kubernetes.io/dockerconfigjson ` +
      `--dry-run=client -o yaml | kubectl apply -f -`,
      { stdio: 'pipe', timeout: 10_000 },
    );
    log(`  ✓ Image pull secret created from docker config`);
  } else {
    log(`  ⚠ No docker config found — pods may fail to pull images`);
    log(`    Run: doctl registry login && theo platform install ...`);
  }
}

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
 * Build Helm values for the platform chart based on customer config + bootstrap tokens.
 *
 * This is the central function that wires all runtime configuration.
 * Every token, credential, and URL needed by every component is set here.
 */
function buildPlatformValues(
  config: PlatformConfig,
  tokens: BootstrapTokens,
): Record<string, unknown> {
  const values: Record<string, unknown> = {
    // ── Global ────────────────────────────────────────────────────────────
    'global.registry': 'registry.digitalocean.com/theo-system',
    'global.imagePullSecrets[0].name': IMAGE_PULL_SECRET_NAME,

    // CRDs installed separately — disable in umbrella
    'theo-crds.enabled': 'false',

    // Disable components that need external CRDs not yet available
    'theo-monitoring.enabled': 'false',
    'theo-admission-policies.enabled': 'false',

    // ── theo-api ──────────────────────────────────────────────────────────
    'theo-api.config.baseDomain': config.domain,
    'theo-api.config.giteaUrl': 'http://gitea-http.gitea.svc.cluster.local:3000',
    'theo-api.config.argocdUrl': 'http://argocd-server.argocd.svc.cluster.local:80',
    'theo-api.config.minioEndpoint': 'minio.theo-system.svc.cluster.local:9000',
    'theo-api.config.registryUrl': config.registry.endpoint,
    'theo-api.config.jwksUrl': 'http://ory-hydra-public.ory.svc.cluster.local:4444/.well-known/jwks.json',
    'theo-api.config.jwtIssuer': 'http://ory-hydra-public.ory.svc.cluster.local:4444/',
    'theo-api.config.argoNamespace': 'argo',
    'theo-api.config.argocdNamespace': 'argocd',

    // API secrets (Helm creates the K8s Secret with these values)
    'theo-api.secrets.databaseUrl': config.database.url || 'postgres://theo:theo@postgresql.theo-system.svc:5432/theo?sslmode=disable',
    'theo-api.secrets.giteaToken': tokens.giteaToken,
    'theo-api.secrets.argocdToken': tokens.argocdPassword,
    'theo-api.secrets.minioAccessKey': tokens.minioAccessKey,
    'theo-api.secrets.minioSecretKey': tokens.minioSecretKey,
    'theo-api.secrets.argoCallbackSecret': tokens.argoCallbackSecret,

    // ── theo-controller ───────────────────────────────────────────────────
    'theo-controller.config.baseDomain': config.domain,
    'theo-controller.config.giteaUrl': 'http://gitea-http.gitea.svc.cluster.local:3000',
    'theo-controller.config.argocdUrl': 'http://argocd-server.argocd.svc.cluster.local:80',
    'theo-controller.config.minioEndpoint': 'minio.theo-system.svc.cluster.local:9000',
    'theo-controller.config.registryUrl': config.registry.endpoint,
    'theo-controller.config.argoNamespace': 'argo',
    'theo-controller.config.argocdNamespace': 'argocd',
    // THEO_CLUSTER_ISSUER: cert-manager ClusterIssuer for TLS. Customer can
    // override via config.clusterIssuer; default production "letsencrypt-prod"
    // assumes cert-manager is wired to Let's Encrypt. For self-signed or
    // internal-only installs, customer should point to a custom issuer.
    'theo-controller.config.clusterIssuer': config.clusterIssuer || 'letsencrypt-prod',
    'theo-controller.secrets.databaseUrl': config.database.url || 'postgres://theo:theo@postgresql.theo-system.svc:5432/theo?sslmode=disable',
    'theo-controller.secrets.giteaToken': tokens.giteaToken,
    'theo-controller.secrets.argocdToken': tokens.argocdPassword,
    'theo-controller.secrets.minioAccessKey': tokens.minioAccessKey,
    'theo-controller.secrets.minioSecretKey': tokens.minioSecretKey,

    // ── theo-tenant-controller ────────────────────────────────────────────
    'theo-tenant-controller.config.giteaUrl': 'http://gitea-http.gitea.svc.cluster.local:3000',
    'theo-tenant-controller.config.baseDomain': config.domain,
    'theo-tenant-controller.config.argocdNamespace': 'argocd',
    'theo-tenant-controller.secrets.giteaToken': tokens.giteaToken,

    // ── theo-build-cwts ───────────────────────────────────────────────────
    // CWT templates reference theo-minio-credentials secret directly
    // (created separately by createMinioCredentialsSecret)
    'theo-build-cwts.minio.insecure': 'true',

    // ── Network policies ──────────────────────────────────────────────────
    // Disable for initial install — cross-namespace egress requires known endpoints.
    // Can be enabled after all services are up via `theo platform upgrade`.
    'theo-api.networkPolicy.enabled': 'false',
    'theo-controller.networkPolicy.enabled': 'false',
    'theo-tenant-controller.networkPolicy.enabled': 'false',
  };

  // ── Kubeconfig (single-cluster mode) ──────────────────────────────────
  if (!config.clusters || config.clusters.mode === 'single') {
    values['theo-api.kubeconfig.build.existingConfigMap'] = 'theo-build-kubeconfig';
    values['theo-api.kubeconfig.runtime.existingConfigMap'] = 'theo-runtime-kubeconfig';
    values['theo-controller.kubeconfig.build.existingConfigMap'] = 'theo-build-kubeconfig';
    values['theo-tenant-controller.kubeconfig.build.existingConfigMap'] = 'theo-build-kubeconfig';
    values['theo-tenant-controller.kubeconfig.runtime.existingConfigMap'] = 'theo-runtime-kubeconfig';
  }

  // ── Profile-based sizing ──────────────────────────────────────────────
  if (config.profile === 'production') {
    values['theo-api.replicaCount'] = '2';
    values['theo-cloud.replicaCount'] = '2';
    values['theo-dashboard.replicaCount'] = '2';
    values['theo-api.networkPolicy.enabled'] = 'true';
    values['theo-controller.networkPolicy.enabled'] = 'true';
    values['theo-tenant-controller.networkPolicy.enabled'] = 'true';
  }

  return values;
}

/**
 * Install Theo platform components via umbrella chart.
 */
export function installPlatform(
  config: PlatformConfig,
  tokens: BootstrapTokens,
  log: (msg: string) => void,
): void {
  const values = buildPlatformValues(config, tokens);

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
export function upgradePlatform(
  version: string,
  config: PlatformConfig,
  tokens: BootstrapTokens,
  log: (msg: string) => void,
): void {
  const values = buildPlatformValues(config, tokens);

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
export function waitForPods(log: (msg: string) => void, timeoutSec = 180): boolean {
  log('  Waiting for pods...');
  const start = Date.now();
  const deadline = start + timeoutSec * 1000;

  while (Date.now() < deadline) {
    try {
      const output = execSync(
        'kubectl get pods -n theo-system -o jsonpath="{.items[*].status.conditions[?(@.type==\'Ready\')].status}"',
        { encoding: 'utf-8', timeout: 10_000 },
      ).trim();
      const statuses = output.split(' ').filter(Boolean);
      const allReady = statuses.length > 0 && statuses.every((s) => s === 'True');
      if (allReady) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        log(`  ✓ All ${statuses.length} pods Ready (${elapsed}s)`);
        return true;
      }
    } catch {
      // kubectl may fail transiently
    }
    execSync('sleep 5');
  }

  // Show which pods aren't ready for debugging
  try {
    const notReady = execSync(
      `kubectl get pods -n theo-system --field-selector=status.phase!=Running --no-headers 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 5_000 },
    ).trim();
    if (notReady) {
      log(`  Pods not ready:\n${notReady}`);
    }
  } catch {
    // ignore
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

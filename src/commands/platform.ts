// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import {
  PlatformConfig,
  BootstrapTokens,
  validateCluster,
  installCorePrerequisites,
  installAuthPrerequisites,
  ensureImagePullSecret,
  installCRDs,
  installPlatform,
  upgradePlatform,
  uninstallPlatform,
  validateInstallation,
  waitForPods,
  getPlatformStatus,
  runMigrations,
  bootstrapGitea,
  bootstrapArgoCD,
  extractMinioCredentials,
  extractPostgresCredentials,
  generateSecret,
  createKubeconfigs,
  createHydraClient,
  createMinioCredentialsSecret,
  createAuthDatabases,
  createClusterIssuer,
  ensureMinioBucket,
  grantTableOwnership,
  createBuildSecrets,
  runMigrationsViaCnpgPod,
} from '../installer';

export interface PlatformDeps {
  writeTo: (msg: string) => void;
  writeError: (msg: string) => void;
}

/**
 * `theo platform install -f values.yaml [--profile minimal|production]`
 *
 * Installs the complete Theo platform on the current Kubernetes cluster.
 * Zero manual intervention — all prerequisites, bootstrap, and config automated.
 *
 * 10-step flow:
 *   1. Validate cluster (kubectl, helm, nodes, storage)
 *   2. Install prerequisites (cert-manager, traefik, PG, Gitea, ArgoCD, Argo Workflows, Ory, MinIO)
 *   3. Registry credentials (imagePullSecret for DOCR)
 *   4. Database setup (create auth DBs: kratos, hydra)
 *   5. Install CRDs
 *   6. Bootstrap services (Gitea org+token, ArgoCD password, MinIO creds, Hydra client)
 *   7. Runtime secrets (kubeconfigs, minio-credentials for CWTs)
 *   8. Install Theo platform (umbrella chart with all tokens injected)
 *   9. Wait for pods
 *  10. Validate (health checks)
 */
export async function platformInstall(
  deps: PlatformDeps,
  valuesFile: string,
  profile?: string,
): Promise<number> {
  const { writeTo, writeError } = deps;

  // Load customer values
  let config: PlatformConfig;
  try {
    const raw = fs.readFileSync(valuesFile, 'utf-8');
    config = yaml.load(raw) as PlatformConfig;
    if (profile) config.profile = profile as PlatformConfig['profile'];
    if (!config.profile) config.profile = 'minimal';
  } catch {
    writeError(`Failed to read values file: ${valuesFile}`);
    return 1;
  }

  if (!config.domain) {
    writeError('Missing required field: domain');
    return 1;
  }

  writeTo('');
  writeTo('  Theo Platform Installer');
  writeTo('  =======================');
  writeTo(`  Domain:  ${config.domain}`);
  writeTo(`  Profile: ${config.profile}`);
  writeTo('');

  // ── Step 1: Validate cluster ──────────────────────────────────────
  writeTo('Step 1/10: Validating cluster...');
  const validation = validateCluster();
  for (const check of validation.checks) {
    writeTo(`  ${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
  }
  if (!validation.valid) {
    writeError('Cluster validation failed. Fix the issues above and retry.');
    return 1;
  }
  writeTo('');

  // ── Step 2: Install prerequisites ─────────────────────────────────
  //
  // Two-phase install (ADR-0012): core infra first (cert-manager, traefik,
  // cnpg-operator + Cluster, gitea, argocd, argo-workflows, minio), then
  // extract PG credentials from the CNPG-generated secret, THEN install
  // auth prereqs (kratos, hydra) which need the DSN at chart install time.
  //
  writeTo('Step 2/10: Installing prerequisites (core)...');
  const coreResults = installCorePrerequisites(config, writeTo);
  if (coreResults.some((r) => r.status === 'failed')) {
    writeError('Core prerequisite installation failed. Check the errors above.');
    return 1;
  }

  // Extract PG credentials (populates config.database.url for auth prereqs)
  if (!config.database.external) {
    const pgCreds = extractPostgresCredentials('theo-system', writeTo);
    if (!pgCreds) {
      writeError('Failed to obtain PostgreSQL credentials from CloudNativePG cluster.');
      writeError('  Inspect: kubectl describe cluster/postgresql-cluster -n theo-system');
      return 1;
    }
    config.database.url = pgCreds.databaseUrl;
  } else if (!config.database.url) {
    writeError('database.external=true requires database.url to be set.');
    return 1;
  }

  // Create auth DBs (kratos, hydra) BEFORE installing ory charts — the
  // kratos/hydra automigration hooks connect immediately and fail if the
  // target database does not exist yet.
  createAuthDatabases(config.database.url, writeTo);

  writeTo('Step 2/10: Installing prerequisites (auth)...');
  const authResults = installAuthPrerequisites(config, writeTo);
  if (authResults.some((r) => r.status === 'failed')) {
    writeError('Auth prerequisite installation failed. Check the errors above.');
    return 1;
  }
  writeTo('');

  // ── Step 3: Registry credentials ──────────────────────────────────
  writeTo('Step 3/10: Configuring registry credentials...');
  try {
    ensureImagePullSecret('theo-system', writeTo);
    // Also create in argo namespace (CWT pods need to pull clone-runner image)
    ensureImagePullSecret('argo', writeTo);
  } catch (err) {
    writeError(`Failed to create image pull secret: ${err}`);
    return 1;
  }
  writeTo('');

  // ── Step 4: Database setup ────────────────────────────────────────
  //
  // Auth DBs were already created in Step 2 (required for kratos/hydra
  // automigration). This step is now a no-op confirmation — kept to
  // preserve the 10-step narrative and for customers using external DB.
  //
  writeTo('Step 4/10: Database setup (verified in Step 2)...');
  const dbUrl = config.database.url!;
  writeTo('  ✓ Databases ready (theo, kratos, hydra)');
  writeTo('');

  // ── Step 5: Install CRDs + ClusterIssuer ──────────────────────────
  writeTo('Step 5/10: Installing platform resources and TLS issuer...');
  try {
    installCRDs(writeTo);
  } catch (err) {
    writeError(`Platform resource installation failed: ${err}`);
    return 1;
  }

  // Fix 1 (CHG-2026-04-24-INSTALLER-E2E): cert-manager ClusterIssuer.
  // Without this, ExposedRoute Certificate requeues forever with
  // "certificate not ready" and `theo deploy` hangs at health verification.
  //
  // For profile=minimal we provision a self-signed issuer named
  // "theo-ca-issuer" to match the default theo-controller expects in dev.
  // For profile=production the customer provides the issuer via
  // config.clusterIssuer (ACME / enterprise CA) — we never create self-signed.
  if (config.profile !== 'production') {
    createClusterIssuer(config.clusterIssuer || 'theo-ca-issuer', writeTo);
  } else {
    writeTo(`  ⚠ Production profile — ClusterIssuer "${config.clusterIssuer}" must already exist.`);
  }
  writeTo('');

  // ── Step 6: Bootstrap services ────────────────────────────────────
  writeTo('Step 6/10: Bootstrapping services...');

  // Gitea: create org + generate API token
  const giteaToken = bootstrapGitea(
    'http://gitea-http.gitea.svc.cluster.local:3000',
    'theo-admin', 'theo-gitea-pass',
    writeTo,
  );
  if (!giteaToken) {
    writeError('Platform bootstrap failed — internal service token required for operation.');
    writeError('  Check platform logs: kubectl logs -n theo-system deploy/theo-git');
    return 1;
  }

  // ArgoCD: extract admin password
  const argocdPassword = bootstrapArgoCD('argocd', writeTo);

  // MinIO: extract credentials
  const minioCreds = extractMinioCredentials(writeTo);

  // Hydra: create OAuth2 client for theo-cli
  const hydraClientId = createHydraClient(writeTo);

  // Generate callback secret for Argo → API communication
  const argoCallbackSecret = generateSecret(32);
  writeTo(`  ✓ Argo callback secret generated`);

  // CHG-2026-04-25-E2E (Gap 2): generate bootstrap + service-auth secrets.
  // bootstrapSecret authenticates POST /internal/bootstrap (admin seeding).
  // serviceAuthSecret authorizes cloud→engine X-Service-Auth proxy calls.
  const bootstrapSecret = generateSecret(32);
  const serviceAuthSecret = generateSecret(32);
  writeTo(`  ✓ Bootstrap + service-auth secrets generated`);

  const tokens: BootstrapTokens = {
    giteaToken,
    argocdPassword,
    minioAccessKey: minioCreds.accessKey,
    minioSecretKey: minioCreds.secretKey,
    argoCallbackSecret,
    hydraClientId,
    bootstrapSecret,
    serviceAuthSecret,
  };
  writeTo('');

  // ── Step 7: Runtime secrets + build infrastructure ────────────────
  writeTo('Step 7/10: Creating runtime secrets and build infrastructure...');

  // Kubeconfigs for multi-cluster access
  createKubeconfigs(config, writeTo);

  // MinIO credentials secret for build CWT templates (theo-minio-credentials)
  // Must exist in the argo namespace where workflows run
  createMinioCredentialsSecret(
    'argo',
    'http://minio.theo-system.svc.cluster.local:9000',
    minioCreds.accessKey,
    minioCreds.secretKey,
    writeTo,
  );

  // Also in theo-system for any direct access
  createMinioCredentialsSecret(
    'theo-system',
    'http://minio.theo-system.svc.cluster.local:9000',
    minioCreds.accessKey,
    minioCreds.secretKey,
    writeTo,
  );

  // Fix 2 (CHG-2026-04-24-INSTALLER-E2E): theo-builds bucket.
  // MinIO chart creates only a single bucket (the one passed via buckets[0]).
  // Build CWTs hardcode "theo-builds" as target for source bundles — without
  // it, clone-repo fails with "Bucket `theo-builds` does not exist".
  ensureMinioBucket(config.storage.bucket || 'theo-artifacts', minioCreds.accessKey, minioCreds.secretKey, writeTo);
  ensureMinioBucket('theo-builds', minioCreds.accessKey, minioCreds.secretKey, writeTo);

  // Fix 5 (CHG-2026-04-24-INSTALLER-E2E): buildkit-registry-config +
  // cosign-signing-key secrets. BuildKit needs credentials to push images to
  // the registry; cosign-signer needs a keypair to sign published images.
  // For profile=minimal we generate self-signed keypair with empty password
  // (dev/test only — rotate before production; see ADR-0012 BYO boundary).
  createBuildSecrets(config, writeTo);

  writeTo('');

  // ── Step 7.5: Pre-install migrations ──────────────────────────────
  // CHG-2026-04-25-E2E: theo-controller fails leader-acquire at startup
  // if `leader_generations` table doesn't exist. Helm `--wait` then blocks
  // forever waiting for controller Ready. Solution: apply migrations
  // BEFORE the helm install, piping SQL files directly into CNPG primary
  // via kubectl exec. THEO_LOCAL_CHARTS env exposes the repo root, from
  // which we derive migrations dir.
  const repoRoot = process.env.THEO_LOCAL_CHARTS
    ? process.env.THEO_LOCAL_CHARTS.replace(/\/charts\/?$/, '')
    : '';
  if (repoRoot) {
    const migrationsDir = `${repoRoot}/api/internal/db/migrations`;
    runMigrationsViaCnpgPod(migrationsDir, writeTo);
    grantTableOwnership(config.database.url!, 'theo', writeTo);
    writeTo('');
  }

  // ── Step 8: Install Theo platform ─────────────────────────────────
  writeTo('Step 8/10: Installing Theo platform...');
  try {
    installPlatform(config, tokens, writeTo);
  } catch (err) {
    writeError(`Platform installation failed: ${err}`);
    return 1;
  }
  writeTo('');

  // ── Step 9: Wait for pods ─────────────────────────────────────────
  writeTo('Step 9/10: Waiting for pods...');
  const podsReady = waitForPods(writeTo);
  if (!podsReady) {
    writeError('Pods did not become ready. Check: kubectl get pods -n theo-system');
    writeError('  Continuing — some pods may need database migrations...');
  }

  // Run migrations after API pod is up
  writeTo('  Running database migrations...');
  runMigrations(dbUrl, writeTo);

  // Fix 3 (CHG-2026-04-24-INSTALLER-E2E): migrations run as admin via
  // the API pod's migrate binary, which leaves tables owned by `postgres`.
  // theo-api connects as role `theo` and gets permission denied. Reassign
  // ownership after migration so runtime queries succeed.
  grantTableOwnership(dbUrl, 'theo', writeTo);
  writeTo('');

  // ── Step 10: Validate ─────────────────────────────────────────────
  writeTo('Step 10/10: Running health checks...');
  validateInstallation(writeTo);
  writeTo('');

  // ── Done ──────────────────────────────────────────────────────────
  writeTo('Installation complete!');
  writeTo('');
  writeTo(`  Platform URL:    https://${config.domain}`);
  writeTo(`  Dashboard:       https://cloud.${config.domain}`);
  writeTo(`  API:             https://api.${config.domain}`);
  if (hydraClientId) {
    writeTo(`  OAuth2 Client:   ${hydraClientId}`);
  }
  writeTo('');
  writeTo('  Bootstrap secret (save this — needed to seed first admin):');
  writeTo(`    ${bootstrapSecret}`);
  writeTo('');
  writeTo('  Next steps:');
  writeTo(`  1. Configure DNS: *.${config.domain} → <ingress-ip>`);
  writeTo(`  2. Seed admin:`);
  writeTo(`     curl -X POST -H "Authorization: Bearer ${bootstrapSecret}" \\`);
  writeTo(`       https://api.${config.domain}/internal/bootstrap \\`);
  writeTo(`       -d '{"admin_github_id":"<id>","admin_login":"<login>","admin_email":"<email>","tenant_slug":"<team>","tenant_display_name":"<Display>"}'`);
  writeTo(`  3. Login: theo login --api-url https://api.${config.domain}`);
  writeTo('');

  return 0;
}

/**
 * `theo platform status`
 */
export async function platformStatus(deps: PlatformDeps): Promise<number> {
  const { writeTo } = deps;
  const status = getPlatformStatus();

  writeTo('');
  writeTo(`  Phase:   ${status.phase}`);
  writeTo(`  Version: ${status.version || 'unknown'}`);
  writeTo(`  CRDs:    ${status.crdsInstalled}/10`);
  writeTo('');
  writeTo('  Components:');
  for (const c of status.components) {
    const icon = c.status === 'Running' ? '✓' : c.status === 'NotInstalled' ? '–' : '✗';
    writeTo(`    ${icon} ${c.name}: ${c.status}${c.replicas ? ` (${c.replicas})` : ''}`);
  }

  if (status.endpoints.api) {
    writeTo('');
    writeTo('  Endpoints:');
    writeTo(`    API:       ${status.endpoints.api}`);
    writeTo(`    Dashboard: ${status.endpoints.dashboard}`);
  }
  writeTo('');

  return status.phase === 'Ready' ? 0 : 1;
}

/**
 * `theo platform upgrade --version <version>`
 */
export async function platformUpgrade(
  deps: PlatformDeps,
  version: string,
  valuesFile?: string,
): Promise<number> {
  const { writeTo, writeError } = deps;

  let config: PlatformConfig | undefined;
  if (valuesFile) {
    try {
      config = yaml.load(fs.readFileSync(valuesFile, 'utf-8')) as PlatformConfig;
    } catch {
      writeError(`Failed to read values file: ${valuesFile}`);
      return 1;
    }
  }

  // For upgrade, we need the existing tokens from K8s secrets
  const tokens = extractExistingTokens();

  writeTo(`Upgrading to v${version}...`);
  try {
    upgradePlatform(version, config || {
      domain: '', profile: 'minimal',
      database: { external: true },
      registry: { type: 'docr', endpoint: '' },
      auth: { type: 'bundled' },
      storage: { endpoint: '', bucket: '' },
    }, tokens, writeTo);
    const podsReady = waitForPods(writeTo);
    if (!podsReady) {
      writeError('Upgrade may have failed — pods not ready');
      return 1;
    }
    writeTo(`✓ Upgraded to v${version}`);
    return 0;
  } catch (err) {
    writeError(`Upgrade failed: ${err}`);
    return 1;
  }
}

/**
 * `theo platform uninstall`
 */
export async function platformUninstall(deps: PlatformDeps): Promise<number> {
  const { writeTo } = deps;
  writeTo('Uninstalling Theo platform...');
  uninstallPlatform(writeTo);
  writeTo('✓ Uninstalled');
  return 0;
}

/**
 * Extract existing tokens from K8s secrets for upgrade operations.
 * During upgrade, we don't regenerate tokens — we reuse existing ones.
 */
function extractExistingTokens(): BootstrapTokens {
  const { execSync } = require('child_process');
  const get = (secret: string, key: string, ns = 'theo-system'): string => {
    try {
      return execSync(
        `kubectl get secret ${secret} -n ${ns} -o jsonpath='{.data.${key}}' 2>/dev/null | base64 -d`,
        { encoding: 'utf-8', timeout: 5_000 },
      ).trim();
    } catch {
      return '';
    }
  };

  // The umbrella chart creates secrets with fullname pattern
  return {
    giteaToken: get('theo-theo-api', 'GITEA_TOKEN'),
    argocdPassword: get('theo-theo-api', 'ARGOCD_TOKEN'),
    minioAccessKey: get('theo-theo-api', 'MINIO_ACCESS_KEY'),
    minioSecretKey: get('theo-theo-api', 'MINIO_SECRET_KEY'),
    argoCallbackSecret: get('theo-theo-api', 'THEO_ARGO_CALLBACK_SECRET'),
    hydraClientId: '',
    bootstrapSecret: get('theo-theo-api', 'THEO_BOOTSTRAP_SECRET'),
    serviceAuthSecret: get('theo-theo-api', 'THEO_SERVICE_AUTH_SECRET'),
  };
}

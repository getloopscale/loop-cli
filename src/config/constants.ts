// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

/**
 * Centralized constants for the LoopScale CLI.
 * All magic numbers and configurable defaults live here.
 *
 * Environment variable overrides are noted where applicable.
 * In CI mode (CI=true), behavior may differ — see individual constant docs.
 */

/**
 * Parse an integer from an environment variable, falling back to defaultValue
 * on missing or invalid input.
 */
function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

// --- API Connection ---

/**
 * MEET-040: Single URL for all CLI operations.
 * Traefik routes /v1/auth/* → cloud service, /* → engine API.
 *
 * Priority: LOOPSCALE_URL > fallback.
 * Local dev: port 8080 matches the Traefik-less direct API server.
 * Staging: set LOOPSCALE_URL=https://app.staging.getloopscale.com/engine
 * (the engine's REST API is proxied under /engine/* on the dashboard host).
 * Standalone-multi local: set LOOPSCALE_URL=http://localhost:13001 or
 * whatever canonical local port the helmfile overlay exposes.
 */
export const DEFAULT_API_URL_FALLBACK = 'http://localhost:8080';

/** Returns the unified API URL from LOOPSCALE_URL, or the local fallback. */
export function getDefaultApiUrl(): string {
  const url = process.env.LOOPSCALE_URL || DEFAULT_API_URL_FALLBACK;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error(`Invalid LOOPSCALE_URL: must start with http:// or https://. Got: ${url}`);
  }
  return url;
}

/**
 * Strips the trailing `/engine` suffix from a base URL so requests
 * for the cloud service hit the cloud root, not the engine proxy.
 *
 * Per MEET-040 above the canonical dev-public
 * value is `LOOPSCALE_URL=https://app-dev.getloopscale.com/engine`; Caddy routes
 * `/v1/auth/*` → cloud service (13002) while `/*` falls through to the
 * dashboard/engine plane. The device-flow endpoints (`/v1/auth/device/*`)
 * live at the cloud ROOT, not under `/engine/...`. Without this strip the
 * CLI hits `/engine/v1/auth/device/authorize` and dev-public returns 401
 * because that path traverses the auth-required middleware to the cloud
 * catchall.
 *
 * The sandbox routes (`/v1/sandboxes`) live at the same root.
 */
export function stripEngineSuffix(baseURL: string): string {
  return baseURL.replace(/\/engine\/?$/, '');
}

/** HTTP request timeout for API calls (ms). Override: LOOPSCALE_API_TIMEOUT */
export const API_REQUEST_TIMEOUT_MS = envInt('LOOPSCALE_API_TIMEOUT', 30000);

/** HTTP timeout for source bundle upload (ms). Override: LOOPSCALE_UPLOAD_TIMEOUT */
export const UPLOAD_TIMEOUT_MS = envInt('LOOPSCALE_UPLOAD_TIMEOUT', 120000);

// --- Dashboard URL (T2.1 of plan 2026-06-11-code-review-remediation) ---

/**
 * Default URL of the LoopScale dashboard (browser-facing) shown in CLI error
 * messages that prompt the user to sign up or sign in. Production hosts are
 * `app|auth|cloud.getloopscale.com`; staging inserts `staging.` before the
 * apex (`app.staging.getloopscale.com`).
 *
 * Sponsor mandate 2026-06-11 "PROIBINDO CONFIGURAÇÃO HARDCODED" required
 * deriving this from env so operators in custom environments
 * (self-hosted, on-prem, alt cloud cell) can override without forking.
 *
 * Override: LOOPSCALE_DASHBOARD_URL=https://my-dashboard.example.com
 */
export const DEFAULT_DASHBOARD_URL_FALLBACK = 'https://app.getloopscale.com';

/** Returns the user-facing dashboard URL with env override + validation. */
export function getDashboardUrl(): string {
  const url = process.env.LOOPSCALE_DASHBOARD_URL || DEFAULT_DASHBOARD_URL_FALLBACK;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error(
      `Invalid LOOPSCALE_DASHBOARD_URL: must start with http:// or https://. Got: ${url}`,
    );
  }
  return url;
}

// --- Cloud Service ---

/**
 * MEET-040: getCloudUrl returns the same base URL as getDefaultApiUrl.
 * Traefik routes /v1/auth/* to cloud service. No separate URL needed.
 * LOOPSCALE_CLOUD_URL overrides it.
 */
export function getCloudUrl(): string {
  const url = process.env.LOOPSCALE_CLOUD_URL;
  if (url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error(`Invalid LOOPSCALE_CLOUD_URL: must start with http:// or https://. Got: ${url}`);
    }
    return url;
  }
  // Default: same as API URL (Traefik handles routing)
  return getDefaultApiUrl();
}

// --- SSE Client ---

/** Delay between SSE reconnect attempts (ms). */
export const SSE_RECONNECT_DELAY_MS = 1000;

/** Polling interval when SSE falls back to polling (ms). */
export const SSE_POLL_INTERVAL_MS = 5000;

/** Maximum SSE reconnect attempts before giving up. */
export const SSE_MAX_RETRIES = 15;

// --- Deploy ---

/** Total deploy timeout (ms). Override: LOOPSCALE_DEPLOY_TIMEOUT.
 *
 * Sprint 8 plan qa-sprint8-cleanup-2026-06-25 T3.1 (closes loop-console#38):
 * bumped from 10min → 30min. The canonical loopzero-example build observed
 * by the QA Red Team took 615s (10min 15s) — 15s above the previous 10min
 * default — making a SUCCEEDED deploy report DEPLOY_TIMEOUT. Cold-start
 * cosign signing + ArgoCD sync + workload pull can push canonical builds
 * past 10min. 30min covers >99% of canonical builds while still bounding
 * runaway waits. Operators override via LOOPSCALE_DEPLOY_TIMEOUT env. The
 * activity-based per-event timeout (deploy.ts:557-572) still resets on
 * every SSE event, so the 30min hard ceiling only fires when the build
 * itself stalls without progress events — the intended semantic. */
export const DEPLOY_TIMEOUT_MS = envInt('LOOPSCALE_DEPLOY_TIMEOUT', 30 * 60 * 1000);

/** Maximum environment name length (RFC 1123 label). */
export const MAX_ENVIRONMENT_NAME_LENGTH = 63;

/** Maximum source bundle size in bytes (500MB). Fail fast before upload. */
export const MAX_BUNDLE_SIZE_BYTES = 500 * 1024 * 1024;


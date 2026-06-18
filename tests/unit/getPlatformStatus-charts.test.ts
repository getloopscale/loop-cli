// CHG-2026-04-30-INFRA-PARITY / T5.1 — Achados #34/#35/#36/#37 regression.
// Discovered live during T5.1 virgin install run 5: helmfile sync GREEN
// (23 charts deployed in 296.9s) but Step 6/6 validation reported phase=
// NotInstalled because:
//   #34: query used label `app.kubernetes.io/name=X` but charts apply `app: X`
//   #35: releaseExists('theo', ...) sentinel is for a release that never exists
//   #36: list contained `theo-tenant-controller` but real chart is `tenant-controller`
//   #37: list contained `theo-dashboard` but chart never existed
//
// This RED→GREEN test pins the THEO_COMPONENTS list against the filesystem
// (charts that actually exist) and pins the kubectl query template against
// the labels charts actually apply. Future drift in either direction breaks
// the test instead of failing silently in production validation.
//
// Pattern follows platform-status-drift.test.ts (mock child_process + helm).

import { describe, it, expect, jest, afterEach, beforeEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));

import { execFileSync } from 'child_process';
import { getPlatformStatus, THEO_COMPONENTS } from '../../src/installer/status';

const mockExec = execFileSync as jest.MockedFunction<typeof execFileSync>;

afterEach(() => {
  jest.resetAllMocks();
});

describe('getPlatformStatus — chart inventory pinning', () => {
  it('THEO_COMPONENTS only references charts that exist on disk', () => {
    // M2 (plan m2-extract-theo-cli): this is a MONOREPO-coupling check — it reaches
    // ../../../infra/helm, which exists only while the CLI is co-located in theo/.
    // After extraction into the standalone theo-cli repo there is no infra/helm, so
    // the on-disk assertion no-ops (the chart inventory is the engine repo's concern;
    // the polyrepo seam is the OpenAPI contract, not the chart tree). When co-located
    // (theo/ monorepo) the assertion runs as before.
    const helmDir = path.resolve(__dirname, '../../../infra/helm');
    if (!fs.existsSync(helmDir)) {
      return; // polyrepo (theo-cli standalone) — infra/helm not present
    }
    for (const name of THEO_COMPONENTS) {
      const chartPath = path.join(helmDir, name);
      expect(fs.existsSync(chartPath)).toBe(true);
    }
  });

  // Post-operator-split (CHG-2026-04-30-INFRA-PARITY T1.5): the legacy
  // theo-controller + tenant-controller charts were DELETED. Operators now
  // ship via charts/theo-{tenant,app,preview,platform}-operator (OCI). The
  // bootstrap-only charts in infra/helm/ are theo-api + theo-cloud.
  it('THEO_COMPONENTS contains the bootstrap charts in infra/helm/', () => {
    expect(THEO_COMPONENTS).toEqual([
      'theo-api',
      'theo-cloud',
    ]);
  });
});

describe('getPlatformStatus — kubectl query template (Achado #34)', () => {
  beforeEach(() => {
    mockExec.mockReturnValue('1/1' as never);
  });

  it('query uses label `app=X` not `app.kubernetes.io/name=X`', () => {
    getPlatformStatus();
    const deployCalls = mockExec.mock.calls.filter(
      (c) => c[0] === 'kubectl' && Array.isArray(c[1]) && (c[1] as string[]).includes('deploy'),
    );
    expect(deployCalls.length).toBeGreaterThan(0);
    for (const call of deployCalls) {
      const args = call[1] as string[];
      const labelIdx = args.indexOf('-l');
      expect(labelIdx).toBeGreaterThanOrEqual(0);
      // selector value is the arg right after `-l`
      expect(args[labelIdx + 1]).toMatch(/^app=/);
      expect(args[labelIdx + 1]).not.toMatch(/^app\.kubernetes\.io\/name=/);
    }
  });

  it('queries one selector per Theo component', () => {
    getPlatformStatus();
    const selectors = mockExec.mock.calls
      .filter((c) => Array.isArray(c[1]))
      .flatMap((c) => c[1] as string[]);
    for (const name of THEO_COMPONENTS) {
      expect(selectors).toContain(`app=${name}`);
    }
  });

  it('never builds a shell command string (no shell-interpolated args)', () => {
    getPlatformStatus();
    // Every call passes the binary as argv[0] and an args ARRAY as argv[1] —
    // execFileSync runs without a shell, so component names can't be injected.
    for (const call of mockExec.mock.calls) {
      expect(call[0]).toBe('kubectl');
      expect(Array.isArray(call[1])).toBe(true);
    }
  });
});

describe('getPlatformStatus — phase calculation (Achado #35)', () => {
  it('phase=Ready when all components return Running pods (no fake "theo" sentinel)', () => {
    mockExec.mockImplementation(((_file: string, args: string[]) => {
      if (args.includes('deploy')) return '1/1';
      if (args.includes('crd')) return 'customresourcedefinition.apiextensions.k8s.io/apps.theo.io';
      return '';
    }) as never);

    const status = getPlatformStatus();
    expect(status.phase).toBe('Ready');
    expect(status.components.every((c) => c.status === 'Running')).toBe(true);
  });

  it('phase=Degraded when at least one component is Pending', () => {
    let i = 0;
    mockExec.mockImplementation(((_file: string, args: string[]) => {
      if (args.includes('deploy')) {
        i++;
        return i === 1 ? '0/1' : '1/1';
      }
      if (args.includes('crd')) return 'customresourcedefinition.apiextensions.k8s.io/apps.theo.io';
      return '';
    }) as never);

    const status = getPlatformStatus();
    expect(status.phase).toBe('Degraded');
  });

  it('phase=NotInstalled when zero components are reachable', () => {
    mockExec.mockImplementation((() => {
      throw new Error('connection refused');
    }) as never);

    const status = getPlatformStatus();
    expect(status.phase).toBe('NotInstalled');
    expect(status.components.every((c) => c.status === 'NotInstalled')).toBe(true);
  });
});

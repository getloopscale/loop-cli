import { PromoteCommand, PromoteDeps } from '../../../src/commands/promote';
import { ApiError } from '../../../src/api/client';

function createMockDeps(overrides: Partial<PromoteDeps> = {}): PromoteDeps {
  return {
    getToken: jest.fn().mockReturnValue('test-token'),
    findTheoYaml: jest.fn().mockReturnValue({
      path: '/project/theo.yaml',
      content: { project: 'my-app', apps: { web: { path: '.', framework: 'express', port: 3000 } } },
    }),
    promote: jest.fn().mockResolvedValue({
      promotion_id: 'promo-abc123',
      status: 'promoting',
      source_release: 'rel-src-001',
      new_release: 'rel-new-001',
      from: 'staging',
      to: 'production',
      url: 'https://my-app-production.dev.usetheo.dev',
    }),
    writeTo: jest.fn(),
    writeError: jest.fn(),
    ...overrides,
  };
}

describe('PromoteCommand', () => {
  describe('success', () => {
    it('should promote and return exit code 0', async () => {
      const deps = createMockDeps();
      const cmd = new PromoteCommand(deps);

      const exitCode = await cmd.execute({ from: 'staging', to: 'production' });

      expect(exitCode).toBe(0);
      expect(deps.promote).toHaveBeenCalledWith('my-app', 'staging', 'production');
      const output = (deps.writeTo as jest.Mock).mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(output).toContain('rel-src-001');
      expect(output).toContain('rel-new-001');
      expect(output).toContain('https://my-app-production.dev.usetheo.dev');
    });

    it('should default to staging -> production', async () => {
      const deps = createMockDeps();
      const cmd = new PromoteCommand(deps);

      await cmd.execute({});

      expect(deps.promote).toHaveBeenCalledWith('my-app', 'staging', 'production');
    });
  });

  describe('json output', () => {
    it('should return JSON with correct schema', async () => {
      const deps = createMockDeps();
      const cmd = new PromoteCommand(deps);

      const exitCode = await cmd.execute({ json: true });

      expect(exitCode).toBe(0);
      const output = (deps.writeTo as jest.Mock).mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.promotion_id).toBe('promo-abc123');
      expect(parsed.status).toBe('promoting');
      expect(parsed.source_release).toBe('rel-src-001');
      expect(parsed.new_release).toBe('rel-new-001');
      expect(parsed.from).toBe('staging');
      expect(parsed.to).toBe('production');
      expect(parsed.url).toBe('https://my-app-production.dev.usetheo.dev');
      expect(typeof parsed.duration_seconds).toBe('number');
    });
  });

  describe('validation errors', () => {
    it('should return exit code 1 when from == to', async () => {
      const deps = createMockDeps();
      const cmd = new PromoteCommand(deps);

      const exitCode = await cmd.execute({ from: 'staging', to: 'staging' });

      expect(exitCode).toBe(1);
      const errorOutput = (deps.writeError as jest.Mock).mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(errorOutput).toContain('different');
    });
  });

  describe('auth errors', () => {
    it('should return exit code 4 when not authenticated', async () => {
      const deps = createMockDeps({ getToken: jest.fn().mockReturnValue(null) });
      const cmd = new PromoteCommand(deps);

      const exitCode = await cmd.execute({});

      expect(exitCode).toBe(4);
      const errorOutput = (deps.writeError as jest.Mock).mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(errorOutput).toContain('theo login');
    });
  });

  describe('missing config', () => {
    it('should return exit code 1 when theo.yaml is missing', async () => {
      const deps = createMockDeps({ findTheoYaml: jest.fn().mockReturnValue(null) });
      const cmd = new PromoteCommand(deps);

      const exitCode = await cmd.execute({});

      expect(exitCode).toBe(1);
      const errorOutput = (deps.writeError as jest.Mock).mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(errorOutput).toContain('theo init');
    });

    it('should return exit code 1 when theo.yaml has parse error', async () => {
      const deps = createMockDeps({
        findTheoYaml: jest.fn().mockReturnValue({
          path: '/project/theo.yaml',
          content: {},
          parseError: 'bad yaml',
        }),
      });
      const cmd = new PromoteCommand(deps);

      const exitCode = await cmd.execute({});

      expect(exitCode).toBe(1);
    });
  });

  describe('API errors', () => {
    it('should return exit code 3 for 409 concurrent operation', async () => {
      const deps = createMockDeps({
        promote: jest.fn().mockRejectedValue(new ApiError('Conflict', 3, 409, 'DEPLOY_IN_PROGRESS')),
      });
      const cmd = new PromoteCommand(deps);

      const exitCode = await cmd.execute({});

      expect(exitCode).toBe(3);
      const errorOutput = (deps.writeError as jest.Mock).mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(errorOutput).toContain('Another operation is in progress');
    });

    // T5.1 CV-M-1 of plan 2026-06-01-p3-infra-observability-test-debt:
    // 409 with code CONCURRENT_ACTIVATION (partial unique index rejected
    // a second ACTIVE release) MUST surface a specific message + code
    // distinct from the generic DEPLOY_IN_PROGRESS collapse.
    it('should surface CONCURRENT_ACTIVATION as distinct from generic 409', async () => {
      const deps = createMockDeps({
        promote: jest.fn().mockRejectedValue(
          new ApiError('Conflict', 3, 409, 'CONCURRENT_ACTIVATION'),
        ),
      });
      const cmd = new PromoteCommand(deps);

      const exitCode = await cmd.execute({});

      expect(exitCode).toBe(3);
      const errorOutput = (deps.writeError as jest.Mock).mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(errorOutput).toContain('previous release activation is still in progress');
      // MUST NOT collapse to the generic message (proves the specific
      // code branch fires BEFORE the generic 409 fallback).
      expect(errorOutput).not.toContain('Another operation is in progress');
    });

    it('should return exit code 3 for 404 no active release', async () => {
      const deps = createMockDeps({
        promote: jest.fn().mockRejectedValue(new ApiError('No active release', 3, 404, 'NO_ACTIVE_RELEASE')),
      });
      const cmd = new PromoteCommand(deps);

      const exitCode = await cmd.execute({});

      expect(exitCode).toBe(3);
      const errorOutput = (deps.writeError as jest.Mock).mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(errorOutput).toContain('No active release');
    });

    it('should return exit code 4 for auth error', async () => {
      const deps = createMockDeps({
        promote: jest.fn().mockRejectedValue(new ApiError('Unauthorized', 4, 401, 'AUTH_REQUIRED')),
      });
      const cmd = new PromoteCommand(deps);

      const exitCode = await cmd.execute({});

      expect(exitCode).toBe(4);
    });

    it('should return exit code 1 for 400 same environment', async () => {
      const deps = createMockDeps({
        promote: jest.fn().mockRejectedValue(new ApiError('Same environment', 3, 400, 'SAME_ENVIRONMENT')),
      });
      const cmd = new PromoteCommand(deps);

      // Skip client-side validation by using different envs — let server return 400
      const exitCode = await cmd.execute({ from: 'staging', to: 'production' });

      expect(exitCode).toBe(1);
    });
  });

  describe('confirmation', () => {
    it('should skip API call when user declines confirmation', async () => {
      const deps = createMockDeps({
        confirm: jest.fn().mockResolvedValue(false),
      });
      const cmd = new PromoteCommand(deps);

      const exitCode = await cmd.execute({});

      expect(exitCode).toBe(0);
      expect(deps.promote).not.toHaveBeenCalled();
      const output = (deps.writeTo as jest.Mock).mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(output).toContain('cancelled');
    });

    it('should require --yes in CI mode', async () => {
      const deps = createMockDeps({ isCI: true });
      const cmd = new PromoteCommand(deps);

      const exitCode = await cmd.execute({});

      expect(exitCode).toBe(1);
      expect(deps.promote).not.toHaveBeenCalled();
    });

    // Red Team theo-cloud#161 — non-TTY stdin (pipes/redirects/harnesses)
    // must fail-fast with the same CONFIRMATION_REQUIRED contract used in CI
    // mode. Pre-fix: the prompt hung on stdin EOF and the outer withTimeout
    // wrapper eventually mis-blamed "Promotion timed out. Check your
    // connection" — misleading operators into blaming the network.
    it('should require --yes when stdin is non-interactive (Red Team #161)', async () => {
      const deps = createMockDeps({ isNonInteractive: true });
      const cmd = new PromoteCommand(deps);

      const exitCode = await cmd.execute({});

      expect(exitCode).toBe(1);
      expect(deps.promote).not.toHaveBeenCalled();
      const output = (deps.writeTo as jest.Mock).mock.calls.map((c: string[]) => c[0]).join('\n')
        + (deps.writeError as jest.Mock).mock.calls.map((c: string[]) => c[0]).join('\n');
      expect(output).toContain('Confirmation required');
      expect(output).toContain('non-interactive');
      // Anti-regression: must NOT surface the misleading network-timeout
      // message that the pre-fix withTimeout wrapper emitted.
      expect(output).not.toContain('Check your connection');
      expect(output).not.toContain('timed out');
    });

    // Red Team #161 — --yes bypasses the non-TTY check (canonical CI/pipe usage).
    it('should proceed with --yes even when stdin is non-interactive (Red Team #161)', async () => {
      const deps = createMockDeps({ isNonInteractive: true });
      const cmd = new PromoteCommand(deps);

      const exitCode = await cmd.execute({ yes: true });

      expect(exitCode).toBe(0);
      expect(deps.promote).toHaveBeenCalled();
    });

    it('should skip confirmation with --yes', async () => {
      const deps = createMockDeps();
      const cmd = new PromoteCommand(deps);

      const exitCode = await cmd.execute({ yes: true });

      expect(exitCode).toBe(0);
      expect(deps.promote).toHaveBeenCalled();
    });
  });

  describe('no internal terms', () => {
    it('should not contain forbidden terms in any output', async () => {
      const forbidden = [
        'ArgoCD', 'argocd', 'GitOps', 'gitops-push', 'CRD',
        'tenant_id', 'advisory lock', 'pg_advisory', 'Gitea',
        'MinIO', 'kubebuilder', 'envtest', 'Kaniko',
        'Loki', 'Promtail', 'LogQL',
      ];

      // Success scenario
      const deps1 = createMockDeps();
      const cmd1 = new PromoteCommand(deps1);
      await cmd1.execute({});

      // Error scenario - not authenticated
      const deps2 = createMockDeps({ getToken: jest.fn().mockReturnValue(null) });
      const cmd2 = new PromoteCommand(deps2);
      await cmd2.execute({});

      // Error scenario - 409
      const deps3 = createMockDeps({
        promote: jest.fn().mockRejectedValue(new ApiError('Conflict', 3, 409, 'DEPLOY_IN_PROGRESS')),
      });
      const cmd3 = new PromoteCommand(deps3);
      await cmd3.execute({});

      for (const deps of [deps1, deps2, deps3]) {
        const allOutput = [
          ...(deps.writeTo as jest.Mock).mock.calls.map((c: string[]) => c[0]),
          ...(deps.writeError as jest.Mock).mock.calls.map((c: string[]) => c[0]),
        ].join('\n');

        for (const term of forbidden) {
          expect(allOutput).not.toContain(term);
        }
      }
    });
  });
});

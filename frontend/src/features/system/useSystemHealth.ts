import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';

export type DependencyStatus = { status: 'up' | 'down'; latencyMs: number; detail?: string };

export type SystemHealth = {
  backend: DependencyStatus;
  database?: DependencyStatus;
  mlService?: DependencyStatus;
  uptimeSeconds?: number;
};

type HealthResponse = {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  checks: Record<string, DependencyStatus>;
};

async function fetchHealth(): Promise<SystemHealth> {
  const started = performance.now();
  try {
    const body = await api<HealthResponse>('/api/health');
    return toHealth(body, started);
  } catch (err) {
    // 503 = backend is up but a dependency is down; the body still has the details.
    if (err instanceof ApiError && err.status === 503 && err.body) {
      return toHealth(err.body as HealthResponse, started);
    }
    return {
      backend: {
        status: 'down',
        latencyMs: Math.round(performance.now() - started),
        detail: err instanceof Error ? err.message : 'Unreachable',
      },
    };
  }
}

function toHealth(body: HealthResponse, started: number): SystemHealth {
  return {
    backend: { status: 'up', latencyMs: Math.round(performance.now() - started) },
    database: body.checks.database,
    mlService: body.checks.mlService,
    uptimeSeconds: body.uptimeSeconds,
  };
}

export function useSystemHealth() {
  return useQuery({ queryKey: ['system-health'], queryFn: fetchHealth, refetchInterval: 5000 });
}

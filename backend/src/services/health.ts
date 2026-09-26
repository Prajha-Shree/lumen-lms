import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

export type DependencyStatus = {
  status: 'up' | 'down';
  latencyMs: number;
  detail?: string;
};

/** A probe resolves (optionally with a detail string) when healthy and throws when not. */
export type HealthProbe = () => Promise<string | void>;
export type HealthProbes = Record<string, HealthProbe>;

const PROBE_TIMEOUT_MS = 2000;

/** Runs a probe with timing and a hard timeout, so one slow dependency can't stall readiness. */
export async function runProbe(probe: HealthProbe, timeoutMs = PROBE_TIMEOUT_MS): Promise<DependencyStatus> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const detail = await Promise.race([probe(), timeout]);
    return { status: 'up', latencyMs: Math.round(performance.now() - started), ...(detail && { detail }) };
  } catch (err) {
    return { status: 'down', latencyMs: Math.round(performance.now() - started), detail: summarize(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Prisma errors are multi-line with a boilerplate "Invalid `prisma...` invocation" header. */
function summarize(err: unknown): string {
  const lines = (err instanceof Error ? err.message : String(err))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.find((l) => !l.startsWith('Invalid `prisma')) ?? lines[0] ?? 'Unknown error';
}

export const defaultHealthProbes: HealthProbes = {
  database: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  mlService: async () => {
    const res = await fetch(new URL('/health', env.ML_SERVICE_URL), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`ml-service responded ${res.status}`);
    const body = (await res.json()) as { capabilities?: Record<string, boolean> };
    const caps = Object.entries(body.capabilities ?? {})
      .filter(([, ok]) => ok)
      .map(([name]) => name);
    return caps.length ? `capabilities: ${caps.join(', ')}` : 'no CV capabilities loaded';
  },
};

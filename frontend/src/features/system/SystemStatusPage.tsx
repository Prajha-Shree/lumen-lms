import { BrainCircuit, Database, RefreshCw, Server } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  StatusDot,
} from '@/components/ui';
import { useSystemHealth, type DependencyStatus, type SystemHealth } from './useSystemHealth';

const services = [
  { key: 'backend', name: 'Backend API', description: 'Express · auth, tenancy, LMS core', icon: Server },
  { key: 'database', name: 'PostgreSQL', description: 'Row-level security per tenant', icon: Database },
  { key: 'mlService', name: 'ML Service', description: 'FastAPI · profiling, recommendations, proctoring', icon: BrainCircuit },
] as const satisfies ReadonlyArray<{ key: keyof SystemHealth; [k: string]: unknown }>;

type ServiceKey = (typeof services)[number]['key'];

export function SystemStatusPage() {
  const { data, isPending, isFetching, refetch } = useSystemHealth();
  useStatusChangeToasts(data);

  const allUp = data && services.every((s) => (data[s.key] as DependencyStatus | undefined)?.status === 'up');

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:py-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8 space-y-3">
        <Badge tone="primary">Phase 1 · Scaffolding</Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">System status</h1>
        <p className="max-w-2xl text-fg-muted">
          Live health of every service in the stack, polled every 5 seconds through the backend.
        </p>
      </motion.div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {isPending ? (
          <Skeleton className="h-6 w-40" />
        ) : (
          <Badge tone={allUp ? 'success' : 'warning'} className="text-sm" role="status">
            {allUp ? 'All systems operational' : 'Degraded: see below'}
          </Badge>
        )}
        <Button variant="secondary" size="sm" onClick={() => void refetch()} loading={isFetching && !isPending}>
          {!(isFetching && !isPending) && <RefreshCw className="size-4" aria-hidden />}
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((svc, i) => (
          <motion.div
            key={svc.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            <ServiceCard
              {...svc}
              loading={isPending}
              status={data?.[svc.key] as DependencyStatus | undefined}
              unreachableUpstream={svc.key !== 'backend' && data?.backend.status === 'down'}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function ServiceCard(props: {
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  loading: boolean;
  status?: DependencyStatus;
  unreachableUpstream: boolean;
}) {
  const { name, description, icon: Icon, loading, status, unreachableUpstream } = props;
  const state = status?.status ?? 'unknown';

  return (
    <Card className="h-full transition-shadow hover:shadow-pop">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">
            <Icon className="size-5" />
          </div>
          <div>
            <CardTitle>{name}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <StatusDot status={state} />
              <span className={state === 'up' ? 'text-success' : state === 'down' ? 'text-danger' : 'text-fg-muted'}>
                {state === 'up' ? 'Operational' : state === 'down' ? 'Down' : 'Unknown'}
              </span>
              {status && <span className="ml-auto tabular-nums text-fg-muted">{status.latencyMs} ms</span>}
            </div>
            <p className="line-clamp-2 min-h-10 text-xs text-fg-muted">
              {unreachableUpstream ? 'Backend unreachable, so this service cannot be checked.' : (status?.detail ?? '')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Toast when a service flips up/down after the first load (not on initial render). */
function useStatusChangeToasts(data: SystemHealth | undefined) {
  const prev = useRef<Partial<Record<ServiceKey, string>> | null>(null);
  useEffect(() => {
    if (!data) return;
    const next = Object.fromEntries(services.map((s) => [s.key, (data[s.key] as DependencyStatus | undefined)?.status]));
    if (prev.current) {
      for (const svc of services) {
        const before = prev.current[svc.key];
        const after = next[svc.key];
        if (before && after && before !== after) {
          if (after === 'up') toast.success(`${svc.name} is back up`);
          else toast.error(`${svc.name} went down`);
        }
      }
    }
    prev.current = next;
  }, [data]);
}

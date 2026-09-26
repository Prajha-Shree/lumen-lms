import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, Stat } from '@/components/ui';
import { http } from '@/lib/api';

type PlatformTenant = {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  counts: { users: number; courses: number; enrollments: number };
  activity7d: number;
  activeUsers7d: number;
};

/** Super-admin: every institution on the platform, with a quick health read. */
export function PlatformPage() {
  const qc = useQueryClient();
  const tenants = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: () => http.get<{ tenants: PlatformTenant[] }>('/api/platform/tenants'),
    refetchInterval: 30_000,
  });

  const setStatus = useMutation({
    mutationFn: (t: PlatformTenant) =>
      http.patch(`/api/platform/tenants/${t.id}`, { status: t.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }),
    onSuccess: (_d, t) => {
      toast.success(`${t.name} ${t.status === 'ACTIVE' ? 'suspended' : 'reactivated'}`);
      void qc.invalidateQueries({ queryKey: ['platform-tenants'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const list = tenants.data?.tenants ?? [];
  const totals = list.reduce(
    (a, t) => ({ users: a.users + t.counts.users, active: a.active + t.activeUsers7d, courses: a.courses + t.counts.courses }),
    { users: 0, active: 0, courses: 0 },
  );

  return (
    <>
      <PageHeader title="Institutions" description="Tenant health across the platform. Suspending an institution ends all of its sessions immediately." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tenants.isPending ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <Stat label="Institutions" value={list.length} icon={<Building className="size-4" />} />
            <Stat label="Total users" value={totals.users} icon={<Users className="size-4" />} />
            <Stat label="Active users (7d)" value={totals.active} hint={totals.users ? `${Math.round((totals.active / totals.users) * 100)}% of all users` : undefined} />
            <Stat label="Courses" value={totals.courses} />
          </>
        )}
      </div>

      {tenants.isError ? (
        <ErrorState error={tenants.error} onRetry={() => void tenants.refetch()} />
      ) : tenants.isPending ? null : list.length === 0 ? (
        <EmptyState icon={Building} title="No institutions yet" description="Institutions appear here when they sign up." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((t, i) => {
            const engagement = t.counts.users ? t.activeUsers7d / t.counts.users : 0;
            const health = t.status === 'SUSPENDED' ? 'Suspended' : engagement >= 0.5 ? 'Healthy' : engagement >= 0.2 ? 'Quiet' : 'Dormant';
            const tone = t.status === 'SUSPENDED' ? 'danger' : engagement >= 0.5 ? 'success' : engagement >= 0.2 ? 'warning' : 'neutral';
            return (
              <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Card className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold">{t.name}</h3>
                      <p className="text-sm text-fg-muted">/{t.slug}</p>
                    </div>
                    <Badge tone={tone}>{health}</Badge>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                    {[
                      ['Users', t.counts.users],
                      ['Active 7d', t.activeUsers7d],
                      ['Courses', t.counts.courses],
                    ].map(([label, v]) => (
                      <div key={label} className="rounded-xl bg-surface-2 py-2">
                        <dt className="text-xs text-fg-muted">{label}</dt>
                        <dd className="font-semibold tabular-nums">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs text-fg-muted">{t.activity7d} events this week</span>
                    <Button
                      size="sm"
                      variant={t.status === 'ACTIVE' ? 'secondary' : 'primary'}
                      loading={setStatus.isPending && setStatus.variables?.id === t.id}
                      onClick={() => setStatus.mutate(t)}
                    >
                      {t.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                    </Button>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </>
  );
}

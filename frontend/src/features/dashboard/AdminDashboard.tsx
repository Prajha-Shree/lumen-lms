import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, BookOpen, CheckCircle2, RefreshCw, ShieldCheck, Trophy, Users } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ChartCard, TrendChart, viewerTz } from '@/components/charts';
import { Button, Card, ErrorState, PageHeader, Stat } from '@/components/ui';
import { LiveBadge } from '@/app/RealtimeProvider';
import { useSession } from '@/features/auth/AuthProvider';
import { http } from '@/lib/api';
import { ROLE_LABEL, type Role } from '@/lib/types';
import { DashSkeleton } from './StudentDashboard';

type AdminDash = {
  stats: {
    totalUsers: number;
    active7d: number;
    active30d: number;
    engagementRate: number;
    publishedCourses: number;
    draftCourses: number;
    enrollments: number;
    completionRate: number;
    avgScore30d: number | null;
  };
  roles: Partial<Record<Role, number>>;
  proctoring: Partial<Record<'NOT_REQUIRED' | 'PENDING' | 'REVIEWED_NO_CONCERN' | 'REVIEWED_CONCERN', number>>;
  trend: { day: string; activeUsers: number; lessonsCompleted: number; examsSubmitted: number; newEnrollments: number }[];
  today: { users: number; completions: number };
  topCourses: { id: string; title: string; enrollments: number; completionRate: number }[];
};

export function AdminDashboard() {
  const { tenant } = useSession();
  const qc = useQueryClient();
  const dash = useQuery({
    queryKey: ['dashboard', 'admin'],
    queryFn: () => http.get<AdminDash>(`/api/dashboard/admin?tz=${encodeURIComponent(viewerTz())}`),
    refetchInterval: 60_000,
  });
  const recompute = useMutation({
    mutationFn: () => http.post<{ written: number }>('/api/dashboard/admin/snapshots'),
    onSuccess: (r) => {
      toast.success(r.written ? `Computed ${r.written} day(s) of history` : 'History is already up to date');
      void qc.invalidateQueries({ queryKey: ['dashboard', 'admin'] });
    },
  });

  if (dash.isError) return <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />;
  if (dash.isPending) return <DashSkeleton />;
  const d = dash.data;
  const maxEnroll = Math.max(1, ...d.topCourses.map((c) => c.enrollments));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={tenant.name} description="Institution-wide usage and health." actions={<LiveBadge />} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active users (7 days)" value={d.stats.active7d} icon={<Activity className="size-4" />} hint={`${d.stats.engagementRate}% of ${d.stats.totalUsers} users · ${d.today.users} today`} />
        <Stat label="Enrollments" value={d.stats.enrollments} icon={<Users className="size-4" />} hint={`${d.stats.completionRate}% completed`} />
        <Stat label="Courses" value={d.stats.publishedCourses} icon={<BookOpen className="size-4" />} hint={`${d.stats.draftCourses} in draft`} />
        <Stat label="Avg exam score" value={d.stats.avgScore30d != null ? `${d.stats.avgScore30d}%` : '—'} icon={<Trophy className="size-4" />} hint="last 30 days" />
      </div>

      <ChartCard
        className="mb-6"
        title="Daily activity"
        description="From nightly snapshots (complete days)"
        actions={
          <Button variant="ghost" size="sm" onClick={() => recompute.mutate()} loading={recompute.isPending} title="Recompute snapshots now">
            {!recompute.isPending && <RefreshCw className="size-3.5" aria-hidden />} Refresh
          </Button>
        }
        table={{ columns: ['Day', 'Active users', 'Lessons completed', 'Exams', 'New enrollments'], rows: d.trend.map((t) => [t.day, t.activeUsers, t.lessonsCompleted, t.examsSubmitted, t.newEnrollments]) }}
      >
        {d.trend.length ? (
          <TrendChart
            data={d.trend}
            series={[
              { key: 'activeUsers', label: 'Active users', color: 'var(--series-1)' },
              { key: 'lessonsCompleted', label: 'Lessons completed', color: 'var(--series-2)' },
            ]}
            height={240}
          />
        ) : (
          <p className="py-12 text-center text-sm text-fg-muted">No history yet. Snapshots are computed hourly; press Refresh to compute now.</p>
        )}
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 font-semibold">Most enrolled courses</h2>
          <ul className="space-y-3" aria-label="Enrollments and completion by course">
            {d.topCourses.map((c) => (
              <li key={c.id} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 text-sm">
                <Link to={`/courses/${c.id}?tab=insights`} className="truncate hover:text-primary">
                  {c.title}
                </Link>
                <span className="h-2.5 rounded-full bg-surface-2" aria-hidden>
                  <span className="block h-full rounded-full" style={{ width: `${(c.enrollments / maxEnroll) * 100}%`, background: 'var(--series-1)' }} />
                </span>
                <span className="text-right tabular-nums text-fg-muted">
                  {c.enrollments} · {c.completionRate}% done
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">People</h2>
            <dl className="space-y-2 text-sm">
              {(['STUDENT', 'INSTRUCTOR', 'INSTITUTION_ADMIN'] as const).map((r) => (
                <div key={r} className="flex justify-between">
                  <dt className="text-fg-muted">{ROLE_LABEL[r]}s</dt>
                  <dd className="font-medium tabular-nums">{d.roles[r] ?? 0}</dd>
                </div>
              ))}
            </dl>
            <Link to="/admin/users" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
              Manage people →
            </Link>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold">
              <ShieldCheck className="size-4 text-fg-muted" aria-hidden /> Proctoring
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-fg-muted">Awaiting review</dt>
                <dd className="font-medium tabular-nums">{d.proctoring.PENDING ?? 0}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="flex items-center gap-1 text-fg-muted">
                  <CheckCircle2 className="size-3.5" aria-hidden /> Reviewed
                </dt>
                <dd className="font-medium tabular-nums">{(d.proctoring.REVIEWED_NO_CONCERN ?? 0) + (d.proctoring.REVIEWED_CONCERN ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-muted">No review needed</dt>
                <dd className="font-medium tabular-nums">{d.proctoring.NOT_REQUIRED ?? 0}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

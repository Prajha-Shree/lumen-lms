import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, GraduationCap, ShieldCheck, Trophy } from 'lucide-react';
import { Link } from 'react-router';
import { ChartCard, Heatmap, heatmapTable, HistogramChart, TrendChart, viewerTz, type HeatCell } from '@/components/charts';
import { Badge, Card, ErrorState, PageHeader, ProgressBar, Stat } from '@/components/ui';
import { LiveBadge } from '@/app/RealtimeProvider';
import { useSession } from '@/features/auth/AuthProvider';
import { http } from '@/lib/api';
import { AtRiskList, type AtRisk } from './AtRiskList';
import { DashSkeleton } from './StudentDashboard';

type InstructorDash = {
  stats: { students: number; activeThisWeek: number; avgScore: number | null; pendingReviews: number; atRisk: number };
  activity: { day: string; activeStudents: number; completions: number }[];
  heatmap: HeatCell[];
  scoreDistribution: { range: string; count: number }[];
  atRisk: AtRisk[];
  courses: { id: string; title: string; status: string; accent: string; avgProgress: number; avgScore: number | null; _count: { lessons: number; enrollments: number } }[];
};

export function InstructorDashboard() {
  const { user } = useSession();
  const dash = useQuery({
    queryKey: ['dashboard', 'instructor'],
    queryFn: () => http.get<InstructorDash>(`/api/dashboard/instructor?tz=${encodeURIComponent(viewerTz())}`),
    refetchInterval: 60_000,
  });

  if (dash.isError) return <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />;
  if (dash.isPending) return <DashSkeleton />;
  const d = dash.data;
  const first = user.name.replace(/^(Dr|Prof)\.?\s+/i, '').split(' ')[0];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={`Hello, ${first}`} description="How your classes are doing, updated live as students learn." actions={<LiveBadge />} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Students" value={d.stats.students} icon={<GraduationCap className="size-4" />} />
        <Stat label="Active this week" value={d.stats.activeThisWeek} icon={<Activity className="size-4" />} hint={d.stats.students ? `${Math.round((d.stats.activeThisWeek / d.stats.students) * 100)}% of students` : undefined} />
        <Stat label="Avg exam score" value={d.stats.avgScore != null ? `${d.stats.avgScore}%` : '—'} icon={<Trophy className="size-4" />} hint="last 90 days" />
        <Stat label="At risk" value={d.stats.atRisk} icon={<AlertTriangle className="size-4" />} hint="see below" />
        <Link to="/reviews" className="rounded-2xl transition-shadow hover:shadow-pop">
          <Stat label="Reviews pending" value={d.stats.pendingReviews} icon={<ShieldCheck className="size-4" />} hint="open queue →" />
        </Link>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-5">
        <ChartCard
          className="lg:col-span-3"
          title="Class activity"
          description="Last 30 days"
          loading={dash.isFetching}
          table={{ columns: ['Day', 'Active students', 'Lessons completed'], rows: d.activity.map((a) => [a.day, a.activeStudents, a.completions]) }}
        >
          <TrendChart
            data={d.activity}
            series={[
              { key: 'activeStudents', label: 'Active students', color: 'var(--series-1)' },
              { key: 'completions', label: 'Lessons completed', color: 'var(--series-2)' },
            ]}
          />
        </ChartCard>
        <ChartCard
          className="lg:col-span-2"
          title="Score distribution"
          description="Exam attempts, last 90 days"
          table={{ columns: ['Score range', 'Attempts'], rows: d.scoreDistribution.map((b) => [`${b.range}%`, b.count]) }}
        >
          <HistogramChart data={d.scoreDistribution} unit="attempts" />
        </ChartCard>
      </div>

      <ChartCard className="mb-6" title="When students learn" description="Activity by weekday and hour (your time zone), last 30 days" table={heatmapTable(d.heatmap)}>
        <Heatmap cells={d.heatmap} />
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <h2 className="font-semibold">Students who may need a check-in</h2>
          <p className="mb-2 text-sm text-fg-muted">Rule-based and explainable. Each flag lists why, so you can judge it.</p>
          <AtRiskList items={d.atRisk} />
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 font-semibold">Your courses</h2>
          <ul className="space-y-4">
            {d.courses.map((c) => (
              <li key={c.id}>
                <Link to={`/courses/${c.id}?tab=insights`} className="block rounded-xl p-2 hover:bg-surface-2">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.title}</span>
                    {c.status !== 'PUBLISHED' && <Badge>{c.status.toLowerCase()}</Badge>}
                  </div>
                  <ProgressBar value={c.avgProgress} label={`${c.title} average progress`} />
                  <p className="mt-1 text-xs text-fg-muted">
                    {c._count.enrollments} students · {c.avgProgress}% avg progress{c.avgScore != null && ` · ${c.avgScore}% avg score`}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

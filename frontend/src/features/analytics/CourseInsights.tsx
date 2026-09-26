import { useQuery } from '@tanstack/react-query';
import { ChartCard, Heatmap, heatmapTable, HistogramChart, TrendChart, viewerTz, type HeatCell } from '@/components/charts';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { MasteryBars } from '@/features/cognitive/ProfileCharts';
import { AtRiskList, type AtRisk } from '@/features/dashboard/AtRiskList';
import { http } from '@/lib/api';

type Insights = {
  enrolled: number;
  funnel: { position: number; lessonId: string; title: string; completed: number }[];
  topicPerformance: Record<string, number>;
  scoreDistribution: { range: string; count: number }[];
  heatmap: HeatCell[];
  activity: { day: string; activeStudents: number; completions: number }[];
  atRisk: AtRisk[];
};

/** Staff view of one course: where students drop off, what they struggle with, when they learn. */
export function CourseInsights({ courseId }: { courseId: string }) {
  const q = useQuery({
    queryKey: ['course-insights', courseId],
    queryFn: () => http.get<Insights>(`/api/courses/${courseId}/insights?tz=${encodeURIComponent(viewerTz())}`),
    refetchInterval: 60_000,
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-96" />;
  const d = q.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Lesson completion funnel"
          description={`Share of the ${d.enrolled} enrolled students who completed each lesson`}
          table={{ columns: ['#', 'Lesson', 'Completed', '%'], rows: d.funnel.map((f) => [f.position, f.title, f.completed, d.enrolled ? `${Math.round((f.completed / d.enrolled) * 100)}%` : '—']) }}
        >
          {/* Ordered stages → ordered bars with direct labels. Biggest drop-off is highlighted. */}
          <ol className="space-y-1.5">
            {d.funnel.map((f, i) => {
              const pct = d.enrolled ? (f.completed / d.enrolled) * 100 : 0;
              const prev = i ? (d.funnel[i - 1]!.completed / Math.max(1, d.enrolled)) * 100 : pct;
              const drop = prev - pct >= 20;
              return (
                <li key={f.lessonId} className="grid grid-cols-[1.25rem_minmax(0,9rem)_1fr_2.5rem] items-center gap-2 text-xs">
                  <span className="tabular-nums text-fg-muted">{f.position}</span>
                  <span className="truncate" title={f.title}>
                    {f.title}
                  </span>
                  <span className="h-3 rounded bg-surface-2">
                    <span className="block h-full rounded" style={{ width: `${pct}%`, background: 'var(--series-1)' }} />
                  </span>
                  <span className={`text-right tabular-nums ${drop ? 'font-semibold text-fg' : 'text-fg-muted'}`} title={drop ? 'Large drop from the previous lesson' : undefined}>
                    {Math.round(pct)}%{drop && ' ↓'}
                  </span>
                </li>
              );
            })}
          </ol>
        </ChartCard>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-1 font-semibold">Topic performance</h2>
            <p className="mb-4 text-sm text-fg-muted">Average correctness on exam questions by topic</p>
            {Object.keys(d.topicPerformance).length ? <MasteryBars mastery={d.topicPerformance} /> : <p className="text-sm text-fg-muted">No exam attempts yet.</p>}
          </Card>
          <ChartCard title="Score distribution" table={{ columns: ['Score range', 'Attempts'], rows: d.scoreDistribution.map((b) => [`${b.range}%`, b.count]) }}>
            <HistogramChart data={d.scoreDistribution} unit="attempts" height={160} />
          </ChartCard>
        </div>
      </div>

      <ChartCard title="Daily activity" description="Last 30 days" table={{ columns: ['Day', 'Active students', 'Lessons completed'], rows: d.activity.map((a) => [a.day, a.activeStudents, a.completions]) }}>
        <TrendChart
          data={d.activity}
          series={[
            { key: 'activeStudents', label: 'Active students', color: 'var(--series-1)' },
            { key: 'completions', label: 'Lessons completed', color: 'var(--series-2)' },
          ]}
          height={200}
        />
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="When students learn" description="Weekday × hour, your time zone" table={heatmapTable(d.heatmap)}>
          <Heatmap cells={d.heatmap} />
        </ChartCard>
        <Card className="p-5">
          <h2 className="mb-2 font-semibold">May need a check-in</h2>
          <AtRiskList items={d.atRisk} showCourse={false} />
        </Card>
      </div>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BrainCircuit, CalendarClock, Flame, Sparkles, Target, Trophy } from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { ChartCard, TrendChart, viewerTz } from '@/components/charts';
import { Button, Card, EmptyState, ErrorState, PageHeader, ProgressBar, Skeleton, Stat } from '@/components/ui';
import { LiveBadge } from '@/app/RealtimeProvider';
import { useSession } from '@/features/auth/AuthProvider';
import { MasteryBars } from '@/features/cognitive/ProfileCharts';
import { topicLabel } from '@/features/cognitive/api';
import { accentOf } from '@/features/courses/api';
import { badgeMeta } from '@/features/gamification/badges';
import { RecommendationsPanel } from '@/features/recommendations/RecommendationsPanel';
import { http } from '@/lib/api';
import { cn } from '@/lib/cn';

type StudentDash = {
  xp: number;
  streak: { current: number; longest: number; activeToday: boolean };
  activity: { day: string; xp: number; completions: number }[];
  courses: { id: string; title: string; accent: string; status: string; totalLessons: number; completedLessons: number; lastActiveAt: string | null }[];
  scores: { id: string; exam: string; percent: number; passingScore: number; at: string }[];
  mastery: Record<string, number>;
  hasProfile: boolean;
  badges: { badge: string; awardedAt: string }[];
  dueAssignments: { id: string; title: string; dueAt: string; course: { id: string; title: string } }[];
};

export function StudentDashboard() {
  const { user } = useSession();
  const dash = useQuery({
    queryKey: ['dashboard', 'student'],
    queryFn: () => http.get<StudentDash>(`/api/dashboard/student?tz=${encodeURIComponent(viewerTz())}`),
    refetchInterval: 60_000,
  });
  const first = user.name.split(' ')[0];

  if (dash.isError) return <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />;
  if (dash.isPending) return <DashSkeleton />;
  const d = dash.data;
  const lessonsDone = d.courses.reduce((s, c) => s + c.completedLessons, 0);
  const avgScore = d.scores.length ? Math.round(d.scores.reduce((s, x) => s + x.percent, 0) / d.scores.length) : null;
  const mastery = Object.entries(d.mastery).sort((a, b) => a[1] - b[1]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={`Welcome back, ${first}`} description={d.streak.activeToday ? 'Nice, you’ve already learned today.' : 'A few minutes today keeps your streak going.'} actions={<LiveBadge />} />

      {!d.hasProfile && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="mb-6 flex flex-wrap items-center gap-4 border-primary/30 bg-gradient-to-r from-primary-soft to-transparent p-5">
            <BrainCircuit className="size-8 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Personalize your learning path</p>
              <p className="text-sm text-fg-muted">An 8-minute adaptive check tunes lesson suggestions to you. Not graded.</p>
            </div>
            <Link to="/learning-profile">
              <Button>Get started</Button>
            </Link>
          </Card>
        </motion.div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StreakTile streak={d.streak} />
        <Stat label="Experience" value={`${d.xp.toLocaleString()} XP`} icon={<Sparkles className="size-4" />} hint={`${d.badges.length} badge${d.badges.length === 1 ? '' : 's'} earned`} />
        <Stat label="Lessons completed" value={lessonsDone} icon={<Target className="size-4" />} hint={`across ${d.courses.length} course${d.courses.length === 1 ? '' : 's'}`} />
        <Stat label="Average exam score" value={avgScore != null ? `${avgScore}%` : '—'} icon={<Trophy className="size-4" />} hint={d.scores.length ? `${d.scores.length} attempt(s)` : 'No exams yet'} />
      </div>

      <RecommendationsPanel limit={3} title="Recommended next" />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ChartCard
            title="Your learning activity"
            description="Experience earned per day, last 4 weeks"
            loading={dash.isFetching}
            table={{ columns: ['Day', 'XP', 'Lessons completed'], rows: d.activity.map((a) => [a.day, a.xp, a.completions]) }}
          >
            <TrendChart data={d.activity} series={[{ key: 'xp', label: 'XP', color: 'var(--series-1)' }]} height={200} />
          </ChartCard>

          {d.scores.length > 0 && (
            <ChartCard
              title="Exam scores"
              description="Your attempts over time"
              table={{ columns: ['Exam', 'Date', 'Score'], rows: d.scores.map((s) => [s.exam, new Date(s.at).toLocaleDateString(), `${s.percent}%`]) }}
            >
              <TrendChart
                data={d.scores.map((s) => ({ ...s, label: new Date(s.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }))}
                xKey="label"
                series={[{ key: 'percent', label: 'Score', color: 'var(--series-1)' }]}
                reference={{ y: d.scores[0]!.passingScore, label: 'Pass' }}
                yDomain={[0, 100]}
                format={(v) => `${v}%`}
                height={180}
              />
            </ChartCard>
          )}

          <Card className="p-5">
            <h2 className="mb-4 font-semibold">Continue learning</h2>
            {d.courses.length === 0 ? (
              <EmptyState title="No courses yet" description="Browse the catalog to enroll." action={<Link to="/courses"><Button>Browse courses</Button></Link>} />
            ) : (
              <ul className="space-y-3">
                {d.courses.map((c) => {
                  const pct = c.totalLessons ? (c.completedLessons / c.totalLessons) * 100 : 0;
                  return (
                    <li key={c.id}>
                      <Link to={`/courses/${c.id}`} className="group flex items-center gap-4 rounded-xl p-2 transition-colors hover:bg-surface-2">
                        <span className={cn('size-10 shrink-0 rounded-xl bg-gradient-to-br', accentOf(c.accent).ring)} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1.5 flex justify-between gap-3 text-sm">
                            <span className="truncate font-medium">{c.title}</span>
                            <span className="shrink-0 tabular-nums text-fg-muted">
                              {c.completedLessons}/{c.totalLessons}
                            </span>
                          </div>
                          <ProgressBar value={pct} label={`${c.title} progress`} />
                        </div>
                        <ArrowRight className="size-4 text-fg-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {d.dueAssignments.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2 font-semibold">
                <CalendarClock className="size-4 text-fg-muted" aria-hidden /> Coming up
              </h2>
              <ul className="space-y-2">
                {d.dueAssignments.map((a) => (
                  <li key={a.id}>
                    <Link to={`/courses/${a.course.id}?tab=assignments`} className="block rounded-xl p-2 hover:bg-surface-2">
                      <p className="text-sm font-medium">{a.title}</p>
                      <p className="text-xs text-fg-muted">
                        Due {new Date(a.dueAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {a.course.title}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-1 font-semibold">Strengths & focus areas</h2>
            <p className="mb-4 text-sm text-fg-muted">Blends your profile with recent exam results.</p>
            {mastery.length ? (
              <>
                <MasteryBars mastery={d.mastery} />
                <p className="mt-4 text-xs text-fg-muted">
                  Focus next: <span className="font-medium text-fg">{topicLabel(mastery[0]![0])}</span>
                </p>
              </>
            ) : (
              <p className="text-sm text-fg-muted">Take an exam or the learning profile to see this.</p>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Badges</h2>
              <Link to="/achievements" className="text-xs font-medium text-primary hover:underline">
                See all
              </Link>
            </div>
            {d.badges.length ? (
              <ul className="grid grid-cols-4 gap-2">
                {d.badges.slice(0, 8).map((b) => {
                  const m = badgeMeta(b.badge);
                  return (
                    <li key={b.badge} title={`${m.name}: ${m.description}`} className="grid aspect-square place-items-center rounded-2xl bg-warning-soft text-warning">
                      <m.icon className="size-6" aria-label={m.name} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">Complete your first lesson to earn a badge.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function StreakTile({ streak }: { streak: StudentDash['streak'] }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between text-sm text-fg-muted">
        Learning streak
        <motion.span animate={streak.current ? { scale: [1, 1.15, 1] } : {}} transition={{ repeat: Infinity, duration: 2 }}>
          <Flame className={cn('size-5', streak.current ? 'text-warning' : 'text-fg-muted')} aria-hidden />
        </motion.span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">
        {streak.current} day{streak.current === 1 ? '' : 's'}
      </div>
      <div className="mt-1 text-xs text-fg-muted">Best: {streak.longest} days</div>
    </div>
  );
}

export function DashSkeleton() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy="true">
      <Skeleton className="mb-3 h-9 w-72" />
      <Skeleton className="mb-8 h-5 w-96 max-w-full" />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

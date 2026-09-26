import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock, Lock, Pencil, ShieldCheck, Timer, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { Tabs } from 'radix-ui';
import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, ProgressBar, Skeleton } from '@/components/ui';
import { useSession } from '@/features/auth/AuthProvider';
import { timeAgo } from '@/features/admin/UsersPage';
import { http } from '@/lib/api';
import { cn } from '@/lib/cn';
import { accentOf, courseKeys, FORMAT_LABEL, LEVEL_LABEL, useCourse, useEnroll, type CourseDetail } from './api';
import { Difficulty, FormatIcon, StatusIcon } from './LessonIcons';

// Tabs owned by later features load lazily so the course page stays light.
const RecommendationsPanel = lazy(() => import('@/features/recommendations/RecommendationsPanel').then((m) => ({ default: m.RecommendationsPanel })));
const CourseInsights = lazy(() => import('@/features/analytics/CourseInsights').then((m) => ({ default: m.CourseInsights })));
const ForumTab = lazy(() => import('@/features/forum/ForumTab').then((m) => ({ default: m.ForumTab })));
const AssignmentsTab = lazy(() => import('@/features/assignments/AssignmentsTab').then((m) => ({ default: m.AssignmentsTab })));

export function CoursePage() {
  const { courseId = '' } = useParams();
  const course = useCourse(courseId);

  if (course.isError) return <ErrorState error={course.error} onRetry={() => void course.refetch()} />;
  if (course.isPending) return <CourseSkeleton />;
  return <CourseView course={course.data} />;
}

function CourseView({ course }: { course: CourseDetail }) {
  const { user } = useSession();
  const isStudent = user.role === 'STUDENT';
  const accent = accentOf(course.accent);
  const enroll = useEnroll();
  const [params, setParams] = useSearchParams();

  const lessons = useMemo(() => course.modules.flatMap((m) => m.lessons), [course.modules]);
  const completed = lessons.filter((l) => course.lessonStatus[l.id] === 'COMPLETED').length;
  const pct = lessons.length ? (completed / lessons.length) * 100 : 0;
  const nextLesson = lessons.find((l) => course.lessonStatus[l.id] !== 'COMPLETED') ?? lessons[0];
  const totalMinutes = lessons.reduce((s, l) => s + l.durationMinutes, 0);
  const canLearn = !isStudent || !!course.enrollment;

  const tabs: { key: string; label: string; content: ReactNode; show: boolean }[] = [
    { key: 'content', label: 'Content', show: true, content: <Outline course={course} canLearn={canLearn} /> },
    { key: 'exams', label: `Exams${course.exams.length ? ` (${course.exams.length})` : ''}`, show: true, content: <ExamsList course={course} canLearn={canLearn} /> },
    { key: 'assignments', label: 'Assignments', show: canLearn, content: <AssignmentsTab courseId={course.id} canManage={course.canManage} /> },
    { key: 'discussion', label: 'Discussion', show: canLearn, content: <ForumTab courseId={course.id} /> },
    { key: 'students', label: 'Students', show: !isStudent, content: <Roster courseId={course.id} /> },
    { key: 'insights', label: 'Insights', show: !isStudent, content: <CourseInsights courseId={course.id} /> },
  ];
  const visibleTabs = tabs.filter((t) => t.show);
  const active = visibleTabs.some((t) => t.key === params.get('tab')) ? params.get('tab')! : 'content';

  return (
    <div className="mx-auto max-w-6xl">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn('relative mb-6 overflow-hidden rounded-3xl bg-gradient-to-br p-6 text-white shadow-pop sm:p-8', accent.ring)}
      >
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.3),transparent_40%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl space-y-3">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-black/20 px-2.5 py-0.5 text-xs font-medium">{LEVEL_LABEL[course.level]}</span>
              {course.status !== 'PUBLISHED' && <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-gray-900">{course.status}</span>}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">{course.title}</h1>
            <p className="text-white/85">{course.description}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/85">
              <span className="inline-flex items-center gap-2">
                <Avatar name={course.instructor.name} size="sm" className="bg-white/25 text-white" /> {course.instructor.name}
              </span>
              <span>{lessons.length} lessons</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-4" aria-hidden /> {Math.round(totalMinutes / 6) / 10} h
              </span>
              {!isStudent && (
                <span className="inline-flex items-center gap-1">
                  <Users className="size-4" aria-hidden /> {course._count.enrollments} enrolled
                </span>
              )}
            </div>
          </div>

          <div className="w-full max-w-xs space-y-3 sm:w-auto">
            {isStudent && course.enrollment && (
              <div className="rounded-2xl bg-black/20 p-4 backdrop-blur">
                <div className="mb-2 flex justify-between text-sm">
                  <span>
                    {completed}/{lessons.length} complete
                  </span>
                  <span className="font-semibold tabular-nums">{Math.round(pct)}%</span>
                </div>
                <ProgressBar value={pct} className="bg-white/25 [&>div]:bg-white" label="Course progress" />
              </div>
            )}
            {isStudent && !course.enrollment && (
              <Button size="lg" className="w-full bg-white text-gray-900 hover:bg-white/90" onClick={() => enroll.mutate(course.id)} loading={enroll.isPending}>
                Enroll for free
              </Button>
            )}
            {isStudent && course.enrollment && nextLesson && (
              <Link to={`/courses/${course.id}/lessons/${nextLesson.id}`} className="block">
                <Button size="lg" className="w-full bg-white text-gray-900 hover:bg-white/90">
                  {completed === 0 ? 'Start learning' : completed === lessons.length ? 'Review course' : 'Continue learning'}
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              </Link>
            )}
            {course.canManage && (
              <Link to={`/courses/${course.id}/edit`} className="block">
                <Button size="lg" className="w-full bg-white text-gray-900 hover:bg-white/90">
                  <Pencil className="size-4" aria-hidden /> Edit course
                </Button>
              </Link>
            )}
          </div>
        </div>
      </motion.section>

      {isStudent && course.enrollment && (
        <Suspense fallback={<Skeleton className="mb-6 h-40" />}>
          <RecommendationsPanel courseId={course.id} />
        </Suspense>
      )}

      <Tabs.Root value={active} onValueChange={(v) => setParams(v === 'content' ? {} : { tab: v }, { replace: true })}>
        <Tabs.List className="mb-6 flex gap-1 overflow-x-auto border-b border-border" aria-label="Course sections">
          {visibleTabs.map((t) => (
            <Tabs.Trigger
              key={t.key}
              value={t.key}
              className="relative shrink-0 px-4 py-2.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg data-[state=active]:text-fg"
            >
              {t.label}
              {active === t.key && <motion.span layoutId="course-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {visibleTabs.map((t) => (
          <Tabs.Content key={t.key} value={t.key} className="focus-visible:outline-none">
            <Suspense fallback={<Skeleton className="h-64" />}>{t.content}</Suspense>
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </div>
  );
}

function Outline({ course, canLearn }: { course: CourseDetail; canLearn: boolean }) {
  if (!course.modules.length) {
    return <EmptyState title="No content yet" description={course.canManage ? 'Open the editor to add modules and lessons.' : 'Check back soon.'} />;
  }
  return (
    <div className="space-y-4">
      {course.modules.map((m, mi) => {
        const done = m.lessons.filter((l) => course.lessonStatus[l.id] === 'COMPLETED').length;
        return (
          <Card key={m.id} className="overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-border bg-surface-2/40 px-5 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Module {mi + 1}</p>
                <h2 className="font-semibold">{m.title}</h2>
                {m.description && <p className="mt-0.5 text-sm text-fg-muted">{m.description}</p>}
              </div>
              {Object.keys(course.lessonStatus).length > 0 && (
                <Badge tone={done === m.lessons.length ? 'success' : 'neutral'}>
                  {done}/{m.lessons.length}
                </Badge>
              )}
            </div>
            <ol className="divide-y divide-border">
              {m.lessons.map((l) => {
                const row = (
                  <div className="flex items-center gap-4 px-5 py-3.5">
                    {canLearn ? <StatusIcon status={course.lessonStatus[l.id]} /> : <Lock className="size-5 text-fg-muted" aria-label="Locked" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{l.title}</p>
                      <p className="truncate text-sm text-fg-muted">{l.summary}</p>
                    </div>
                    <div className="hidden items-center gap-4 text-xs text-fg-muted sm:flex">
                      <span className="inline-flex items-center gap-1.5">
                        <FormatIcon format={l.format} /> {FORMAT_LABEL[l.format]}
                      </span>
                      <Difficulty value={l.difficulty} />
                      <span className="w-14 text-right tabular-nums">{l.durationMinutes} min</span>
                    </div>
                  </div>
                );
                return (
                  <li key={l.id}>
                    {canLearn ? (
                      <Link to={`/courses/${course.id}/lessons/${l.id}`} className="block transition-colors hover:bg-surface-2/60">
                        {row}
                      </Link>
                    ) : (
                      <div className="opacity-70">{row}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          </Card>
        );
      })}
    </div>
  );
}

function ExamAction({ course, examId, maxAttempts }: { course: CourseDetail; examId: string; maxAttempts: number }) {
  const { user } = useSession();
  if (user.role !== 'STUDENT') {
    return (
      <Link to={`/exams/${examId}/sessions`}>
        <Button size="sm" variant="secondary">
          View attempts
        </Button>
      </Link>
    );
  }
  if (!course.enrollment) return <Badge>Enroll to take</Badge>;
  const attempt = course.attempts[examId];
  if (attempt?.inProgressId) {
    return (
      <Link to={`/exams/${examId}/take`}>
        <Button size="sm">Resume</Button>
      </Link>
    );
  }
  if ((attempt?.count ?? 0) >= maxAttempts) return <Badge>No attempts left</Badge>;
  return (
    <Link to={`/exams/${examId}/take`}>
      <Button size="sm">{attempt?.count ? 'Retake' : 'Start exam'}</Button>
    </Link>
  );
}

function ExamsList({ course }: { course: CourseDetail; canLearn: boolean }) {
  if (!course.exams.length) return <EmptyState icon={Timer} title="No exams yet" description="Exams for this course will appear here." />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {course.exams.map((e) => {
        const attempt = course.attempts[e.id];
        return (
          <Card key={e.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold">{e.title}</h3>
              {e.proctored ? (
                <Badge tone="info">
                  <ShieldCheck className="size-3.5" aria-hidden /> Proctored
                </Badge>
              ) : (
                <Badge>Practice</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-fg-muted">{e.description}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 text-xs text-fg-muted">
              <span>{e._count.questions} questions</span>
              <span>{e.durationMinutes} min</span>
              <span>Pass: {e.passingScore}%</span>
              {e.status !== 'PUBLISHED' && <span className="font-medium text-warning">{e.status}</span>}
            </div>
            <div className="mt-auto flex items-center justify-between gap-3 pt-5">
              {attempt?.best != null ? (
                <span className={cn('text-sm font-medium', attempt.best >= e.passingScore ? 'text-success' : 'text-warning')}>Best: {attempt.best}%</span>
              ) : (
                <span />
              )}
              <ExamAction course={course} examId={e.id} maxAttempts={e.maxAttempts} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

type RosterRow = {
  id: string;
  name: string;
  email: string;
  xp: number;
  enrollmentStatus: string;
  completedLessons: number;
  totalLessons: number;
  lastActiveAt: string | null;
  latestScore: number | null;
};

function Roster({ courseId }: { courseId: string }) {
  const roster = useQuery({
    queryKey: courseKeys.students(courseId),
    queryFn: () => http.get<{ students: RosterRow[] }>(`/api/courses/${courseId}/students`).then((r) => r.students),
  });
  if (roster.isError) return <ErrorState error={roster.error} onRetry={() => void roster.refetch()} />;
  if (roster.isPending) return <Skeleton className="h-64" />;
  if (!roster.data.length) return <EmptyState icon={Users} title="No students enrolled yet" />;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-border bg-surface-2/60 text-left text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Student</th>
            <th className="px-4 py-3 font-medium">Progress</th>
            <th className="px-4 py-3 font-medium">Latest exam</th>
            <th className="px-4 py-3 font-medium">Last active</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {roster.data.map((s) => {
            const pct = s.totalLessons ? (s.completedLessons / s.totalLessons) * 100 : 0;
            return (
              <tr key={s.id}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={s.name} size="sm" />
                    <div>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-fg-muted">{s.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <ProgressBar value={pct} className="w-28" label={`${s.name} progress`} />
                    <span className="tabular-nums text-fg-muted">
                      {s.completedLessons}/{s.totalLessons}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 tabular-nums">{s.latestScore != null ? `${s.latestScore}%` : <span className="text-fg-muted">—</span>}</td>
                <td className="px-4 py-3 text-fg-muted">{timeAgo(s.lastActiveAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CourseSkeleton() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy="true">
      <Skeleton className="mb-6 h-56 rounded-3xl" />
      <Skeleton className="mb-6 h-10 w-80" />
      <Skeleton className="mb-4 h-48" />
      <Skeleton className="h-48" />
    </div>
  );
}

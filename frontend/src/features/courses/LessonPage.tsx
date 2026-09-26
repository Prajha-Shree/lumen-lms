import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, Download, FileText, PartyPopper, PlayCircle } from 'lucide-react';
import { motion, useScroll, useSpring } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, ErrorState, Markdown, Skeleton } from '@/components/ui';
import { useSession } from '@/features/auth/AuthProvider';
import { downloadFile, http } from '@/lib/api';
import { cn } from '@/lib/cn';
import { courseKeys, FORMAT_LABEL, useCourse, useLesson, type CourseDetail, type LessonDetail } from './api';
import { Difficulty, FormatIcon, StatusIcon } from './LessonIcons';

const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

/**
 * Counts seconds only while the tab is visible and reports them in batches, so
 * "time spent" reflects actual attention, not a forgotten open tab.
 */
function useStudyTimer(lessonId: string, enabled: boolean) {
  const pending = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    pending.current = 0;
    void http.post(`/api/lessons/${lessonId}/progress`, { event: 'view', secondsSpent: 0 }).catch(() => undefined);
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') pending.current++;
    }, 1000);
    const flush = () => {
      if (pending.current < 5) return;
      const secondsSpent = pending.current;
      pending.current = 0;
      void http.post(`/api/lessons/${lessonId}/progress`, { event: 'view', secondsSpent }, { keepalive: true }).catch(() => undefined);
    };
    const periodic = setInterval(flush, 60_000);
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(tick);
      clearInterval(periodic);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [lessonId, enabled]);
  return () => {
    const s = pending.current;
    pending.current = 0;
    return s;
  };
}

export function LessonPage() {
  const { courseId = '', lessonId = '' } = useParams();
  const { user } = useSession();
  const isStudent = user.role === 'STUDENT';
  const lesson = useLesson(lessonId);
  const course = useCourse(courseId);
  const takeSeconds = useStudyTimer(lessonId, isStudent && lesson.isSuccess);

  if (lesson.isError) return <ErrorState error={lesson.error} onRetry={() => void lesson.refetch()} />;

  return (
    <div className="mx-auto flex max-w-7xl gap-8">
      <aside className="sticky top-24 hidden h-[calc(100dvh-8rem)] w-72 shrink-0 overflow-y-auto xl:block">
        {course.data ? <Outline course={course.data} currentId={lessonId} /> : <Skeleton className="h-96" />}
      </aside>
      <div className="min-w-0 flex-1">
        {lesson.isPending ? <LessonSkeleton /> : <LessonBody data={lesson.data} isStudent={isStudent} takeSeconds={takeSeconds} />}
      </div>
    </div>
  );
}

function LessonBody({ data, isStudent, takeSeconds }: { data: LessonDetail; isStudent: boolean; takeSeconds: () => number }) {
  const { lesson, course, prev, next } = data;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { refreshUser } = useSession();
  const [completing, setCompleting] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const completed = data.progress?.status === 'COMPLETED' || justCompleted;

  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 30 });

  useEffect(() => setJustCompleted(false), [lesson.id]);

  const complete = async () => {
    setCompleting(true);
    setJustCompleted(true); // optimistic
    qc.setQueryData<CourseDetail>(courseKeys.detail(course.id), (c) => c && { ...c, lessonStatus: { ...c.lessonStatus, [lesson.id]: 'COMPLETED' } });
    try {
      const res = await http.post<{ courseCompleted: boolean }>(`/api/lessons/${lesson.id}/progress`, { event: 'complete', secondsSpent: takeSeconds() });
      void refreshUser();
      if (res.courseCompleted) {
        toast.success('Course complete! 🎉', { description: `You finished every lesson in ${course.title}.`, duration: 6000 });
      } else {
        toast.success('Lesson complete · +10 XP', next ? { action: { label: 'Next lesson', onClick: () => navigate(`/courses/${course.id}/lessons/${next.id}`) } } : undefined);
      }
      void qc.invalidateQueries({ queryKey: courseKeys.lesson(lesson.id) });
      void qc.invalidateQueries({ queryKey: courseKeys.all });
      void qc.invalidateQueries({ queryKey: ['recommendations'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e) {
      setJustCompleted(false);
      void qc.invalidateQueries({ queryKey: courseKeys.detail(course.id) });
      toast.error(e instanceof Error ? e.message : 'Could not save progress');
    } finally {
      setCompleting(false);
    }
  };

  return (
    <article>
      <motion.div aria-hidden className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-primary" style={{ scaleX }} />

      <Link to={`/courses/${course.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ChevronLeft className="size-4" aria-hidden /> {course.title}
      </Link>

      <motion.header key={lesson.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <p className="mb-2 text-sm text-fg-muted">
          Lesson {data.index + 1} of {data.total}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{lesson.title}</h1>
        {lesson.summary && <p className="mt-2 text-lg text-fg-muted">{lesson.summary}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge tone="primary">
            <FormatIcon format={lesson.format} className="size-3.5" /> {FORMAT_LABEL[lesson.format]}
          </Badge>
          <Badge>{lesson.durationMinutes} min</Badge>
          <Badge>
            <Difficulty value={lesson.difficulty} />
          </Badge>
          {lesson.topics.map((t) => (
            <Badge key={t} tone="info">
              {t}
            </Badge>
          ))}
          {completed && (
            <Badge tone="success">
              <Check className="size-3.5" aria-hidden /> Completed
            </Badge>
          )}
        </div>
      </motion.header>

      {lesson.format === 'VIDEO' && <VideoPanel url={lesson.videoUrl} />}

      <div className="rounded-2xl border border-border bg-surface p-6 shadow-card sm:p-8">
        <Markdown>{lesson.content || '_This lesson has no written content yet._'}</Markdown>
      </div>

      {lesson.attachments.length > 0 && (
        <section className="mt-6" aria-labelledby="materials">
          <h2 id="materials" className="mb-3 font-semibold">
            Materials
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {lesson.attachments.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => void downloadFile(`/api/attachments/${a.id}/download`, a.fileName).catch((e: Error) => toast.error(e.message))}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-primary"
                >
                  <FileText className="size-5 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{a.fileName}</span>
                    <span className="text-xs text-fg-muted">{formatBytes(a.sizeBytes)}</span>
                  </span>
                  <Download className="size-4 text-fg-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6" aria-label="Lesson navigation">
        {prev ? (
          <Link to={`/courses/${course.id}/lessons/${prev.id}`}>
            <Button variant="ghost">
              <ArrowLeft className="size-4" aria-hidden /> <span className="max-w-40 truncate">{prev.title}</span>
            </Button>
          </Link>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {isStudent && !completed && (
            <Button onClick={() => void complete()} loading={completing} variant={next ? 'secondary' : 'primary'}>
              <Check className="size-4" aria-hidden /> Mark complete
            </Button>
          )}
          {isStudent && completed && !next && (
            <span className="inline-flex items-center gap-2 text-sm font-medium text-success">
              <PartyPopper className="size-4" aria-hidden /> Last lesson done
            </span>
          )}
          {next && (
            <Link to={`/courses/${course.id}/lessons/${next.id}`}>
              <Button
                onClick={() => {
                  if (isStudent && !completed) void complete();
                }}
              >
                <span className="max-w-40 truncate">{isStudent && !completed ? 'Complete & continue' : next.title}</span>
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </Link>
          )}
        </div>
      </nav>
    </article>
  );
}

function VideoPanel({ url }: { url: string | null }) {
  if (url && /\.(mp4|webm)(\?|$)/i.test(url)) {
    return <video src={url} controls className="mb-6 aspect-video w-full rounded-2xl bg-black" />;
  }
  return (
    <div className="mb-6 flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-700 text-white">
      <PlayCircle className="size-14 opacity-80" aria-hidden />
      {url ? (
        <a href={url} target="_blank" rel="noreferrer noopener" className="text-sm underline underline-offset-4">
          Open video in a new tab
        </a>
      ) : (
        <p className="text-sm text-white/70">Video not attached in this demo. The transcript is below.</p>
      )}
    </div>
  );
}

function Outline({ course, currentId }: { course: CourseDetail; currentId: string }) {
  return (
    <nav aria-label="Course outline" className="space-y-5 pr-2">
      {course.modules.map((m, i) => (
        <div key={m.id}>
          <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {i + 1}. {m.title}
          </p>
          <ul className="space-y-0.5">
            {m.lessons.map((l) => (
              <li key={l.id}>
                <Link
                  to={`/courses/${course.id}/lessons/${l.id}`}
                  aria-current={l.id === currentId ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors',
                    l.id === currentId ? 'bg-primary-soft font-medium text-primary' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                  )}
                >
                  <StatusIcon status={course.lessonStatus[l.id]} />
                  <span className="truncate">{l.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function LessonSkeleton() {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-4 h-4 w-40" />
      <Skeleton className="mb-3 h-10 w-3/4" />
      <Skeleton className="mb-8 h-5 w-1/2" />
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}

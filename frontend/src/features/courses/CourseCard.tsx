import { BookOpen, CheckCircle2, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { Badge, Button, ProgressBar } from '@/components/ui';
import { cn } from '@/lib/cn';
import { accentOf, LEVEL_LABEL, useEnroll, type CourseCard as Course } from './api';

export function CourseCard({ course, index = 0, isStudent }: { course: Course; index?: number; isStudent: boolean }) {
  const accent = accentOf(course.accent);
  const enroll = useEnroll();
  const pct = course.progress?.total ? (course.progress.completed / course.progress.total) * 100 : 0;
  const enrolled = !!course.enrollment;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04 }}
      whileHover={{ y: -3 }}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-card transition-shadow hover:shadow-pop"
    >
      <div className={cn('relative h-24 bg-gradient-to-br', accent.ring)}>
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.35),transparent_45%)]" />
        <BookOpen className="absolute bottom-3 right-4 size-10 text-white/40" aria-hidden />
        <div className="absolute left-4 top-3 flex gap-1.5">
          <span className="rounded-full bg-black/25 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">{LEVEL_LABEL[course.level]}</span>
          {course.status !== 'PUBLISHED' && (
            <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-gray-900">{course.status === 'DRAFT' ? 'Draft' : 'Archived'}</span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-semibold leading-snug tracking-tight">
          <Link to={`/courses/${course.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {course.title}
          </Link>
        </h3>
        <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{course.description || 'No description yet.'}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span>{course.instructor.name}</span>
          <span aria-hidden>·</span>
          <span>{course._count.lessons} lessons</span>
          {!isStudent && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" aria-hidden /> {course._count.enrollments}
              </span>
            </>
          )}
        </div>

        <div className="mt-auto pt-5">
          {isStudent ? (
            enrolled ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">
                    {course.enrollment?.status === 'COMPLETED' ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 className="size-3.5" aria-hidden /> Completed
                      </span>
                    ) : (
                      `${course.progress?.completed ?? 0} of ${course.progress?.total ?? 0} lessons`
                    )}
                  </span>
                  <span className="tabular-nums text-fg-muted">{Math.round(pct)}%</span>
                </div>
                <ProgressBar value={pct} label={`${course.title} progress`} />
              </div>
            ) : (
              <Button
                size="sm"
                className="relative z-10 w-full"
                onClick={(e) => {
                  e.preventDefault();
                  enroll.mutate(course.id);
                }}
                loading={enroll.isPending}
              >
                Enroll
              </Button>
            )
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {course.tags.slice(0, 3).map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.article>
  );
}

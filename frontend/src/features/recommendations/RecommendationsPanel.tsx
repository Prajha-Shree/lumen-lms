import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BrainCircuit, Info, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { Tooltip } from 'radix-ui';
import { Link } from 'react-router';
import { Badge, Card, Skeleton } from '@/components/ui';
import { FormatIcon } from '@/features/courses/LessonIcons';
import { FORMAT_LABEL, type LessonFormat } from '@/features/courses/api';
import { http } from '@/lib/api';
import { cn } from '@/lib/cn';

export type Recommendation = {
  lessonId: string;
  courseId: string;
  courseTitle: string;
  accent: string;
  title: string;
  format: LessonFormat;
  durationMinutes: number;
  difficulty: number;
  topics: string[];
  status: 'NOT_STARTED' | 'IN_PROGRESS';
  score: number;
  reasons: string[];
  strategy: string;
};

type Result = { recommendations: Recommendation[]; personalized: boolean; degraded?: boolean };

export function useRecommendations(courseId?: string, limit = 3) {
  return useQuery({
    queryKey: ['recommendations', courseId ?? 'all', limit],
    queryFn: () => http.get<Result>(`/api/recommendations?${new URLSearchParams({ ...(courseId && { courseId }), limit: String(limit) })}`),
    staleTime: 60_000,
  });
}

/** "Up next for you": the adaptive engine's picks for one course (or all courses). */
export function RecommendationsPanel({ courseId, limit = 3, title = 'Up next for you' }: { courseId?: string; limit?: number; title?: string }) {
  const recs = useRecommendations(courseId, limit);

  if (recs.isPending) {
    return (
      <div className="mb-6 grid gap-3 md:grid-cols-3" aria-busy="true">
        {Array.from({ length: limit }, (_, i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
    );
  }
  // Recommendations enhance the page; if they fail, stay out of the way.
  if (recs.isError || !recs.data.recommendations.length) return null;

  const { personalized } = recs.data;

  return (
    <section className="mb-6" aria-labelledby="recs-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="recs-title" className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden /> {title}
        </h2>
        {personalized ? (
          <Badge tone="primary">
            <BrainCircuit className="size-3.5" aria-hidden /> Personalized to your profile
          </Badge>
        ) : (
          <Link to="/learning-profile" className="text-xs font-medium text-primary hover:underline">
            Take the learning profile to personalize this →
          </Link>
        )}
      </div>
      <Tooltip.Provider delayDuration={200}>
        <ol className={cn('grid gap-3', limit >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
          {recs.data.recommendations.map((r, i) => (
            <motion.li key={r.lessonId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <Card className="group relative flex h-full flex-col p-4 transition-shadow hover:shadow-pop">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-fg-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <FormatIcon format={r.format} /> {FORMAT_LABEL[r.format]} · {r.durationMinutes} min
                  </span>
                  <WhyThis reasons={r.reasons} strategy={r.strategy} />
                </div>
                <h3 className="font-medium leading-snug">
                  <Link to={`/courses/${r.courseId}/lessons/${r.lessonId}`} className="after:absolute after:inset-0 focus-visible:outline-none">
                    {r.title}
                  </Link>
                </h3>
                {!courseId && <p className="mt-0.5 truncate text-xs text-fg-muted">{r.courseTitle}</p>}
                <p className="mt-2 text-sm text-fg-muted">{r.reasons[0]}</p>
                <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-medium text-primary">
                  {r.status === 'IN_PROGRESS' ? 'Resume' : 'Start'}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Card>
            </motion.li>
          ))}
        </ol>
      </Tooltip.Provider>
    </section>
  );
}

/** Explains the ranking. Keyboard-focusable; the reasons are also in the accessible name. */
function WhyThis({ reasons, strategy }: { reasons: string[]; strategy: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button className="relative z-10 inline-flex items-center gap-1 rounded-md px-1 hover:text-fg" aria-label={`Why this: ${reasons.join('; ')}`}>
          <Info className="size-3.5" aria-hidden /> Why this?
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="top" sideOffset={6} className="z-50 max-w-64 rounded-xl border border-border bg-surface p-3 text-xs shadow-pop">
          <ul className="list-disc space-y-1 pl-4 text-fg">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="mt-2 text-fg-muted">Ranked by: {strategy}</p>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

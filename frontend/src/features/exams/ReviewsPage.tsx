import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Avatar, Badge, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { timeAgo } from '@/features/admin/UsersPage';
import { http } from '@/lib/api';
import { cn } from '@/lib/cn';
import { REVIEW_LABEL, REVIEW_TONE, type ProctoringSummary, type ReviewStatus } from './api';

export type ReviewRow = {
  id: string;
  percent: number | null;
  submittedAt: string | null;
  reviewStatus: ReviewStatus;
  user: { id: string; name: string };
  exam: { id: string; title: string; course: { id: string; title: string } };
  proctoring: ProctoringSummary;
};

export function ReviewsPage() {
  const [status, setStatus] = useState<'PENDING' | 'REVIEWED'>('PENDING');
  const reviews = useQuery({
    queryKey: ['reviews', status],
    queryFn: () => http.get<{ reviews: ReviewRow[] }>(`/api/reviews?status=${status}`).then((r) => r.reviews),
    refetchInterval: 30_000,
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Proctoring reviews" description="Proctored attempts with automated signals worth a human look. You decide; the software only surfaces moments." />
      <div role="tablist" className="mb-5 inline-flex rounded-xl border border-border bg-surface p-1">
        {(['PENDING', 'REVIEWED'] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={cn('rounded-lg px-3.5 py-1.5 text-sm font-medium', status === s ? 'bg-primary text-primary-fg' : 'text-fg-muted hover:text-fg')}
          >
            {s === 'PENDING' ? 'Needs review' : 'Reviewed'}
          </button>
        ))}
      </div>

      {reviews.isError ? (
        <ErrorState error={reviews.error} onRetry={() => void reviews.refetch()} />
      ) : reviews.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : reviews.data.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={status === 'PENDING' ? 'All caught up' : 'Nothing reviewed yet'} description={status === 'PENDING' ? 'No proctored attempts need review right now.' : undefined} />
      ) : (
        <ul className="space-y-3">
          {reviews.data.map((r, i) => (
            <motion.li key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Link to={`/exam-sessions/${r.id}/review`} className="group flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 shadow-card transition-shadow hover:shadow-pop">
                <Avatar name={r.user.name} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.user.name}</p>
                  <p className="truncate text-sm text-fg-muted">
                    {r.exam.title} · {r.exam.course.title} · {timeAgo(r.submittedAt)}
                  </p>
                  <p className="mt-1 truncate text-xs text-fg-muted">{r.proctoring.reasons.join(' · ') || `${r.proctoring.totalEvents} signal(s)`}</p>
                </div>
                <Badge tone={REVIEW_TONE[r.reviewStatus]}>{REVIEW_LABEL[r.reviewStatus]}</Badge>
                <ArrowRight className="size-4 text-fg-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

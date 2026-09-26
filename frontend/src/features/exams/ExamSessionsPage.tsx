import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil, ShieldCheck, Timer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Avatar, Badge, Button, EmptyState, ErrorState, PageHeader, Skeleton, Stat } from '@/components/ui';
import { http } from '@/lib/api';
import { cn } from '@/lib/cn';
import { REVIEW_LABEL, REVIEW_TONE, type ProctoringSummary, type ReviewStatus } from './api';

type Attempt = {
  id: string;
  status: string;
  percent: number | null;
  startedAt: string;
  submittedAt: string | null;
  reviewStatus: ReviewStatus;
  user: { id: string; name: string; email: string };
  proctoring: ProctoringSummary;
};

type Data = { exam: { id: string; title: string; proctored: boolean; passingScore: number; course: { id: string; title: string } }; sessions: Attempt[] };

/** Staff: every attempt at one exam, with scores and review state. */
export function ExamSessionsPage() {
  const { examId = '' } = useParams();
  const [onlyReview, setOnlyReview] = useState(false);
  const data = useQuery({ queryKey: ['exam-sessions', examId], queryFn: () => http.get<Data>(`/api/exams/${examId}/sessions`), refetchInterval: 20_000 });

  const rows = useMemo(() => (data.data?.sessions ?? []).filter((s) => !onlyReview || s.reviewStatus === 'PENDING'), [data.data, onlyReview]);
  if (data.isError) return <ErrorState error={data.error} onRetry={() => void data.refetch()} />;
  if (data.isPending) return <Skeleton className="mx-auto h-[60dvh] max-w-5xl" />;
  const { exam, sessions } = data.data;
  const done = sessions.filter((s) => s.percent != null);
  const avg = done.length ? Math.round(done.reduce((a, s) => a + (s.percent ?? 0), 0) / done.length) : null;
  const pending = sessions.filter((s) => s.reviewStatus === 'PENDING').length;

  return (
    <div className="mx-auto max-w-5xl">
      <Link to={`/courses/${exam.course.id}?tab=exams`} className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> {exam.course.title}
      </Link>
      <PageHeader
        title={exam.title}
        description="Every attempt, with scores and proctoring review state."
        actions={
          <Link to={`/exams/${exam.id}/edit`}>
            <Button variant="secondary">
              <Pencil className="size-4" aria-hidden /> Edit exam
            </Button>
          </Link>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Attempts" value={sessions.length} />
        <Stat label="Average score" value={avg != null ? `${avg}%` : '—'} hint={`Pass mark ${exam.passingScore}%`} />
        <Stat label="Awaiting review" value={pending} icon={<ShieldCheck className="size-4" />} />
      </div>

      {exam.proctored && (
        <label className="mb-4 inline-flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          Show only attempts needing review
        </label>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={Timer} title="No attempts yet" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border bg-surface-2/60 text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Student</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                {exam.proctored && <th className="px-4 py-3 font-medium">Proctoring</th>}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-surface-2/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={s.user.name} size="sm" />
                      <span className="font-medium">{s.user.name}</span>
                    </div>
                  </td>
                  <td className={cn('px-4 py-3 font-medium tabular-nums', s.percent != null && s.percent < exam.passingScore && 'text-warning')}>
                    {s.percent != null ? `${s.percent}%` : <Badge>In progress</Badge>}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{s.submittedAt ? new Date(s.submittedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                  {exam.proctored && (
                    <td className="px-4 py-3">
                      <Badge tone={REVIEW_TONE[s.reviewStatus]}>{REVIEW_LABEL[s.reviewStatus]}</Badge>
                      <span className="ml-2 text-xs text-fg-muted">{s.proctoring.totalEvents} signal(s)</span>
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    {exam.proctored && s.status !== 'IN_PROGRESS' && (
                      <Link to={`/exam-sessions/${s.id}/review`} className="text-sm font-medium text-primary hover:underline">
                        Review
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Info, MessageCircle, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { Avatar, Badge, Button, Card, ErrorState, Skeleton, Stat, Textarea } from '@/components/ui';
import { http } from '@/lib/api';
import { formatDuration, REVIEW_LABEL, REVIEW_TONE, type ProctoringSummary, type ReviewStatus } from './api';
import { ReviewTimeline, type TimelineEvent } from './ReviewTimeline';

type ReviewData = {
  session: {
    id: string;
    status: string;
    startedAt: string;
    submittedAt: string | null;
    expiresAt: string;
    percent: number | null;
    reviewStatus: ReviewStatus;
    reviewNote: string | null;
    reviewedAt: string | null;
    reviewer: { name: string } | null;
    user: { id: string; name: string; email: string };
    exam: { id: string; title: string; durationMinutes: number; courseId: string; passingScore: number };
  };
  events: TimelineEvent[];
  summary: ProctoringSummary;
};

export function SessionReviewPage() {
  const { sessionId = '' } = useParams();
  const qc = useQueryClient();
  const key = ['session-review', sessionId];
  const review = useQuery({ queryKey: key, queryFn: () => http.get<ReviewData>(`/api/exam-sessions/${sessionId}/review`) });
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState<ReviewStatus | null>(null);

  if (review.isError) return <ErrorState error={review.error} onRetry={() => void review.refetch()} />;
  if (review.isPending) return <Skeleton className="mx-auto h-[70dvh] max-w-5xl" />;
  const { session, events, summary } = review.data;
  const endedAt = session.submittedAt ?? session.expiresAt;

  const decide = async (decision: 'REVIEWED_NO_CONCERN' | 'REVIEWED_CONCERN') => {
    setSaving(decision);
    try {
      await http.patch(`/api/exam-sessions/${sessionId}/review`, { decision, note: note || undefined });
      toast.success('Review saved');
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['reviews'] });
      void qc.invalidateQueries({ queryKey: ['exam-sessions', session.exam.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Link to={`/exams/${session.exam.id}/sessions`} className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> All attempts for {session.exam.title}
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={session.user.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{session.user.name}</h1>
          <p className="text-fg-muted">
            {session.exam.title} · {new Date(session.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        </div>
        <Badge tone={REVIEW_TONE[session.reviewStatus]} className="text-sm">
          {REVIEW_LABEL[session.reviewStatus]}
        </Badge>
      </div>

      <p className="mb-6 flex gap-3 rounded-2xl border border-info/30 bg-info-soft/60 p-4 text-sm" role="note">
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <span>
          These are automated signals, not evidence. Lighting, glasses, disabilities, a shared room or a webcam placed off to the side can all trigger them.
          Use them to decide whether a conversation is needed; no images or video were recorded.
        </span>
      </p>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Score" value={session.percent != null ? `${session.percent}%` : '—'} hint={`Pass mark ${session.exam.passingScore}%`} />
        <Stat label="Signals recorded" value={summary.totalEvents} hint={summary.flaggedMs ? `${formatDuration(summary.flaggedMs)} in total` : undefined} />
        <Stat label="Time taken" value={formatDuration(new Date(endedAt).getTime() - new Date(session.startedAt).getTime())} hint={`of ${session.exam.durationMinutes} min`} />
      </div>

      <Card className="mb-6 p-6">
        <h2 className="mb-1 font-semibold">Timeline</h2>
        <p className="mb-5 text-sm text-fg-muted">Hover or focus a mark for details.</p>
        <ReviewTimeline events={events} startedAt={session.startedAt} endedAt={endedAt} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="overflow-hidden">
          <h2 className="border-b border-border px-5 py-4 font-semibold">All signals</h2>
          {events.length ? (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-2 text-left text-xs uppercase tracking-wide text-fg-muted">
                  <tr>
                    <th className="px-5 py-2 font-medium">At</th>
                    <th className="px-5 py-2 font-medium">Signal</th>
                    <th className="px-5 py-2 text-right font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="px-5 py-2 tabular-nums text-fg-muted">{formatDuration(new Date(e.startedAt).getTime() - new Date(session.startedAt).getTime())}</td>
                      <td className="px-5 py-2">
                        {e.label} <span className="text-xs text-fg-muted">({e.source === 'CAMERA' ? 'camera' : 'browser'})</span>
                      </td>
                      <td className="px-5 py-2 text-right tabular-nums">{e.durationMs ? formatDuration(e.durationMs) : 'instant'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-5 text-sm text-fg-muted">No signals recorded.</p>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Your review</h2>
          {summary.reasons.length > 0 && (
            <ul className="mb-4 space-y-1 text-sm text-fg-muted">
              {summary.reasons.map((r) => (
                <li key={r}>• {r}</li>
              ))}
            </ul>
          )}
          {session.reviewedAt && (
            <p className="mb-3 rounded-xl bg-surface-2 p-3 text-sm">
              {session.reviewer?.name ?? 'A reviewer'} on {new Date(session.reviewedAt).toLocaleDateString()}: {session.reviewNote || <em>no note</em>}
            </p>
          )}
          <Textarea rows={3} placeholder="Private note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Review note" />
          <div className="mt-3 grid gap-2">
            <Button onClick={() => void decide('REVIEWED_NO_CONCERN')} loading={saving === 'REVIEWED_NO_CONCERN'}>
              <ThumbsUp className="size-4" aria-hidden /> No concern
            </Button>
            <Button variant="secondary" onClick={() => void decide('REVIEWED_CONCERN')} loading={saving === 'REVIEWED_CONCERN'}>
              <MessageCircle className="size-4" aria-hidden /> Follow up with student
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CircleCheck, CircleX, Info, Trophy } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { Badge, Card } from '@/components/ui';
import { MasteryBars } from '@/features/cognitive/ProfileCharts';
import { useSession as useAuthSession } from '@/features/auth/AuthProvider';
import { cn } from '@/lib/cn';
import type { ExamSession } from './api';

export function ExamResults({ session }: { session: ExamSession }) {
  const qc = useQueryClient();
  const { refreshUser } = useAuthSession();
  const percent = session.percent ?? 0;

  // Results change XP, recommendations, progress and dashboards.
  useEffect(() => {
    void refreshUser();
    for (const key of [['course', session.exam.course.id], ['recommendations'], ['dashboard'], ['exam', session.exam.id]]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  }, [qc, session.exam.course.id, session.exam.id, refreshUser]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link to={`/courses/${session.exam.course.id}?tab=exams`} className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Back to {session.exam.course.title}
      </Link>

      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
        <Card className="mb-6 overflow-hidden text-center">
          <div className={cn('p-8', session.passed ? 'bg-gradient-to-b from-success-soft to-transparent' : 'bg-gradient-to-b from-warning-soft to-transparent')}>
            <Trophy className={cn('mx-auto mb-3 size-10', session.passed ? 'text-success' : 'text-warning')} aria-hidden />
            <p className="text-sm text-fg-muted">{session.exam.title}</p>
            <p className="mt-1 text-5xl font-semibold tracking-tight">{percent}%</p>
            <p className="mt-1 text-fg-muted">
              {session.score} of {session.maxScore} points · pass mark {session.exam.passingScore}%
            </p>
            <div className="mt-4">
              {session.passed ? <Badge tone="success">Passed</Badge> : <Badge tone="warning">Not passed yet</Badge>}
              {session.status === 'EXPIRED' && <Badge className="ml-2">Submitted at time limit</Badge>}
            </div>
          </div>
        </Card>
      </motion.div>

      {session.underReview && (
        <p className="mb-6 flex gap-3 rounded-2xl bg-info-soft p-4 text-sm text-info" role="note">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          A few moments from this proctored session were noted for routine review by your instructor. This is standard and isn’t a judgment. Your
          instructor will reach out only if they have questions.
        </p>
      )}

      {session.topicScores && Object.keys(session.topicScores).length > 0 && (
        <Card className="mb-6 p-6">
          <h2 className="mb-1 font-semibold">By topic</h2>
          <p className="mb-5 text-sm text-fg-muted">Your recommendations now focus on the topics that need the most practice.</p>
          <MasteryBars mastery={session.topicScores} />
        </Card>
      )}

      <h2 className="mb-3 font-semibold">Review your answers</h2>
      <ol className="space-y-3">
        {session.questions.map((q, i) => {
          const chosen = session.answers[q.id] ?? [];
          return (
            <li key={q.id}>
              <Card className="p-5">
                <div className="flex items-start gap-3">
                  {q.correct ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-label="Correct" /> : <CircleX className="mt-0.5 size-5 shrink-0 text-danger" aria-label="Incorrect" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {i + 1}. {q.prompt}
                    </p>
                    <ul className="mt-3 space-y-1.5">
                      {q.options.map((o) => {
                        const isCorrect = q.correctOptionIds?.includes(o.id);
                        const picked = chosen.includes(o.id);
                        return (
                          <li
                            key={o.id}
                            className={cn(
                              'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm',
                              isCorrect ? 'bg-success-soft text-success' : picked ? 'bg-danger-soft text-danger' : 'text-fg-muted',
                            )}
                          >
                            {isCorrect ? <Check className="size-3.5" aria-hidden /> : <span className="size-3.5" />}
                            <span className="flex-1">{o.text}</span>
                            {picked && <span className="text-xs font-medium">Your answer</span>}
                          </li>
                        );
                      })}
                    </ul>
                    {q.explanation && <p className="mt-3 text-sm text-fg-muted">{q.explanation}</p>}
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

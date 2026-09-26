import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BrainCircuit, Pause } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button, ErrorState, ProgressBar, Skeleton } from '@/components/ui';
import { useSession } from '@/features/auth/AuthProvider';
import { http } from '@/lib/api';
import { cn } from '@/lib/cn';
import { profileKey, type Step } from './api';

const SECTION = { preference: 'About you', diagnostic: 'Knowledge check', reasoning: 'Reasoning' } as const;
const CONFIDENCE = [
  { value: 1, label: 'Guessing' },
  { value: 2, label: 'Unsure' },
  { value: 3, label: 'Fairly sure' },
  { value: 4, label: 'Certain' },
];

export function AssessmentPage() {
  // POST starts a new assessment or resumes the one in progress. As a query it is
  // deduplicated (StrictMode double-mount won't create two assessments).
  const session = useQuery({
    queryKey: ['assessment-session'],
    queryFn: () => http.post<Step & { assessmentId: string }>('/api/cognitive/assessments'),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  if (session.isError) {
    return (
      <div className="mx-auto max-w-2xl">
        <ErrorState error={session.error} onRetry={() => void session.refetch()} />
      </div>
    );
  }
  if (session.isPending) return <Skeleton className="mx-auto h-[28rem] max-w-2xl rounded-3xl" />;
  return <Runner initial={session.data} />;
}

function Runner({ initial }: { initial: Step & { assessmentId: string } }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { refreshUser } = useSession();
  const [step, setStep] = useState<Step>(initial);
  const [answer, setAnswer] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const shownAt = useRef(performance.now());
  const item = step.item;

  useEffect(() => {
    shownAt.current = performance.now();
    setAnswer(null);
    setConfidence(null);
  }, [item?.id]);

  const ready = !!answer && (!item?.asksConfidence || confidence !== null);

  const submit = useCallback(async () => {
    if (!item || !ready || submitting) return;
    setSubmitting(true);
    try {
      const next = await http.post<Step>(`/api/cognitive/assessments/${initial.assessmentId}/responses`, {
        itemId: item.id,
        answer,
        responseTimeMs: Math.round(performance.now() - shownAt.current),
        confidence: item.asksConfidence ? confidence : null,
      });
      if (next.done) {
        setFinishing(true);
        void refreshUser();
        qc.setQueryData(profileKey, next.profile ?? null);
        void qc.invalidateQueries({ queryKey: ['recommendations'] });
        setTimeout(() => {
          toast.success('Your learning profile is ready · +20 XP');
          navigate('/learning-profile', { replace: true });
        }, 1600);
      } else {
        setStep(next);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save your answer');
    } finally {
      setSubmitting(false);
    }
  }, [item, ready, submitting, initial.assessmentId, answer, confidence, qc, navigate, refreshUser]);

  // Keyboard: 1–n picks an answer, Enter continues.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!item || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = Number(e.key);
      if (n >= 1 && n <= item.options.length) setAnswer(item.options[n - 1]!.id);
      if (e.key === 'Enter' && ready) void submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, ready, submit]);

  if (finishing || !item) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center" role="status">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2.4, ease: 'linear' }} className="mb-6 grid size-16 place-items-center rounded-3xl bg-primary-soft text-primary">
          <BrainCircuit className="size-8" aria-hidden />
        </motion.div>
        <h1 className="text-xl font-semibold">Building your profile…</h1>
        <p className="mt-2 text-fg-muted">Mapping your answers to a personalized path.</p>
      </div>
    );
  }

  const pct = (step.answered / step.total) * 100;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-primary">{SECTION[item.kind]}</span>
          <span className="tabular-nums text-fg-muted">
            {step.answered + 1} / {step.total}
          </span>
        </div>
        <ProgressBar value={pct} label="Assessment progress" />
      </div>

      <AnimatePresence mode="wait">
        <motion.section
          key={item.id}
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -32 }}
          transition={{ duration: 0.22 }}
          className="rounded-3xl border border-border bg-surface p-6 shadow-card sm:p-8"
          aria-labelledby="question"
        >
          <h1 id="question" className="text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
            {item.prompt}
          </h1>
          {item.kind === 'preference' && <p className="mt-2 text-sm text-fg-muted">No right or wrong answer. Pick what’s most true for you today.</p>}

          <div role="radiogroup" aria-labelledby="question" className="mt-6 space-y-2.5">
            {item.options.map((o, i) => {
              const selected = answer === o.id;
              return (
                <motion.button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAnswer(o.id)}
                  whileTap={{ scale: 0.99 }}
                  className={cn(
                    'flex w-full items-center gap-4 rounded-2xl border-2 px-4 py-3.5 text-left transition-colors',
                    selected ? 'border-primary bg-primary-soft' : 'border-border hover:border-fg-muted/40 hover:bg-surface-2/50',
                  )}
                >
                  <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg text-xs font-semibold', selected ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-fg-muted')}>
                    {i + 1}
                  </span>
                  <span>{o.text}</span>
                </motion.button>
              );
            })}
          </div>

          <AnimatePresence>
            {item.asksConfidence && answer && (
              <motion.fieldset initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-6 overflow-hidden">
                <legend className="mb-2 text-sm font-medium">How sure are you?</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
                  {CONFIDENCE.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      role="radio"
                      aria-checked={confidence === c.value}
                      onClick={() => setConfidence(c.value)}
                      className={cn(
                        'rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
                        confidence === c.value ? 'border-primary bg-primary text-primary-fg' : 'border-border hover:bg-surface-2',
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </motion.fieldset>
            )}
          </AnimatePresence>

          <div className="mt-8 flex items-center justify-between gap-3">
            <Link to="/learning-profile" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
              <Pause className="size-4" aria-hidden /> Save & exit
            </Link>
            <Button size="lg" disabled={!ready} loading={submitting} onClick={() => void submit()}>
              {step.answered + 1 === step.total ? 'Finish' : 'Next'} {!submitting && <ArrowRight className="size-4" aria-hidden />}
            </Button>
          </div>
        </motion.section>
      </AnimatePresence>
      <p className="mt-4 text-center text-xs text-fg-muted">Tip: press 1–{item.options.length} to choose, Enter to continue.</p>
    </div>
  );
}

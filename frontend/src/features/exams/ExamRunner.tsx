import { AlertCircle, ArrowLeft, ArrowRight, Check, CloudOff, Flag, Loader, ShieldCheck, Timer } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, Dialog } from '@/components/ui';
import { http } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { EventType, ExamSession } from './api';
import type { useCamera } from './useCamera';
import { useProctoring } from './useProctoring';

type SaveState = 'saved' | 'saving' | 'error';

const NUDGE: Partial<Record<EventType, string>> = {
  NO_FACE: 'We can’t see you right now. Please return to the camera’s view.',
  MULTIPLE_FACES: 'More than one face is visible. Please make sure you’re working on your own.',
  LOOKING_AWAY: 'Please keep your attention on the exam screen.',
};

function useCountdown(expiresAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, new Date(expiresAt).getTime() - now);
}

export function ExamRunner({
  initial,
  camera,
  onFinished,
}: {
  initial: ExamSession;
  camera: ReturnType<typeof useCamera>;
  onFinished: (s: ExamSession) => void;
}) {
  const questions = initial.questions;
  const [answers, setAnswers] = useState<Record<string, string[]>>(initial.answers ?? {});
  const [save, setSave] = useState<Record<string, SaveState>>({});
  const [index, setIndex] = useState(() => Math.max(0, questions.findIndex((q) => !initial.answers?.[q.id]?.length)));
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  const remaining = useCountdown(initial.expiresAt);
  const live = useProctoring(initial.id, initial.proctored, camera);
  const q = questions[index]!;
  const answered = useMemo(() => questions.filter((x) => answers[x.id]?.length).length, [questions, answers]);

  const startCamera = camera.start;
  useEffect(() => {
    if (initial.proctored) void startCamera();
  }, [initial.proctored, startCamera]);

  const persist = useCallback(
    async (questionId: string, optionIds: string[]) => {
      setSave((s) => ({ ...s, [questionId]: 'saving' }));
      try {
        await http.put(`/api/exam-sessions/${initial.id}/answers`, { questionId, optionIds });
        setSave((s) => ({ ...s, [questionId]: 'saved' }));
      } catch {
        setSave((s) => ({ ...s, [questionId]: 'error' }));
      }
    },
    [initial.id],
  );

  // Optimistic: the choice shows immediately; the save indicator reports the sync.
  const choose = (optionId: string) => {
    const current = answers[q.id] ?? [];
    const next = q.type === 'SINGLE_CHOICE' ? [optionId] : current.includes(optionId) ? current.filter((o) => o !== optionId) : [...current, optionId];
    setAnswers((a) => ({ ...a, [q.id]: next }));
    void persist(q.id, next);
  };

  const submit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    // Retry any answers whose save failed before submitting.
    await Promise.all(Object.entries(save).filter(([, s]) => s === 'error').map(([id]) => persist(id, answers[id] ?? [])));
    try {
      const { session } = await http.post<{ session: ExamSession }>(`/api/exam-sessions/${initial.id}/submit`);
      onFinished(session);
    } catch (e) {
      submittedRef.current = false;
      toast.error(e instanceof Error ? e.message : 'Submit failed. Your answers are saved; please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [save, persist, answers, initial.id, onFinished]);

  // Time's up: submit automatically.
  useEffect(() => {
    if (remaining === 0 && !submittedRef.current) {
      toast.info('Time’s up. Submitting your answers.');
      void submit();
    }
  }, [remaining, submit]);

  // Warn before leaving mid-exam.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!submittedRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const lowTime = remaining < 2 * 60_000;
  const nudge = live.activeSignals.map((s) => NUDGE[s]).find(Boolean);
  const anyError = Object.values(save).includes('error');
  const anySaving = Object.values(save).includes('saving');

  return (
    <div className="mx-auto max-w-5xl">
      {/* Sticky exam bar: timer, save status, proctoring status */}
      <div className="sticky top-16 z-30 -mx-4 mb-6 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 flex-1 truncate font-semibold">{initial.exam.title}</h1>
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted" aria-live="polite">
            {anyError ? (
              <>
                <CloudOff className="size-3.5 text-danger" aria-hidden /> Not saved, retrying on submit
              </>
            ) : anySaving ? (
              <>
                <Loader className="size-3.5 animate-spin" aria-hidden /> Saving…
              </>
            ) : (
              <>
                <Check className="size-3.5 text-success" aria-hidden /> All answers saved
              </>
            )}
          </span>
          {initial.proctored && <ProctorPill camera={camera} available={live.analysisAvailable} alert={!!nudge} />}
          <span
            className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums', lowTime ? 'bg-danger-soft text-danger' : 'bg-surface-2')}
            role="timer"
            aria-label={`${mins} minutes ${secs} seconds remaining`}
          >
            <Timer className="size-4" aria-hidden />
            {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
          </span>
        </div>
        <AnimatePresence>
          {nudge && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              role="status"
              className="mt-2 flex items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning"
            >
              <AlertCircle className="size-4 shrink-0" aria-hidden /> {nudge}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_15rem]">
        <section aria-labelledby="q-prompt">
          <AnimatePresence mode="wait">
            <motion.div
              key={q.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="rounded-3xl border border-border bg-surface p-6 shadow-card sm:p-8"
            >
              <div className="mb-4 flex items-center justify-between text-sm text-fg-muted">
                <span>
                  Question {index + 1} of {questions.length} · {q.points} pt{q.points > 1 ? 's' : ''}
                </span>
                <button
                  onClick={() => setFlagged((f) => new Set(f.has(q.id) ? [...f].filter((x) => x !== q.id) : [...f, q.id]))}
                  aria-pressed={flagged.has(q.id)}
                  className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-1 transition-colors', flagged.has(q.id) ? 'bg-warning-soft text-warning' : 'hover:bg-surface-2')}
                >
                  <Flag className="size-3.5" aria-hidden /> {flagged.has(q.id) ? 'Marked for review' : 'Mark for review'}
                </button>
              </div>
              <h2 id="q-prompt" className="text-xl font-semibold leading-snug">
                {q.prompt}
              </h2>
              {q.type === 'MULTIPLE_CHOICE' && <p className="mt-1 text-sm text-fg-muted">Select all that apply.</p>}
              <div role={q.type === 'SINGLE_CHOICE' ? 'radiogroup' : 'group'} aria-labelledby="q-prompt" className="mt-6 space-y-2.5">
                {q.options.map((o, i) => {
                  const selected = answers[q.id]?.includes(o.id) ?? false;
                  return (
                    <button
                      key={o.id}
                      role={q.type === 'SINGLE_CHOICE' ? 'radio' : 'checkbox'}
                      aria-checked={selected}
                      onClick={() => choose(o.id)}
                      className={cn(
                        'flex w-full items-center gap-4 rounded-2xl border-2 px-4 py-3.5 text-left transition-colors',
                        selected ? 'border-primary bg-primary-soft' : 'border-border hover:border-fg-muted/40 hover:bg-surface-2/50',
                      )}
                    >
                      <span
                        className={cn(
                          'grid size-7 shrink-0 place-items-center text-xs font-semibold',
                          q.type === 'SINGLE_CHOICE' ? 'rounded-full' : 'rounded-md',
                          selected ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-fg-muted',
                        )}
                      >
                        {selected ? <Check className="size-4" aria-hidden /> : String.fromCharCode(65 + i)}
                      </span>
                      <span>{o.text}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-8 flex justify-between gap-3">
                <Button variant="secondary" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
                  <ArrowLeft className="size-4" aria-hidden /> Previous
                </Button>
                {index < questions.length - 1 ? (
                  <Button onClick={() => setIndex((i) => i + 1)}>
                    Next <ArrowRight className="size-4" aria-hidden />
                  </Button>
                ) : (
                  <Button onClick={() => setConfirmOpen(true)}>Review & submit</Button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </section>

        <aside className="space-y-4">
          {initial.proctored && (
            <div className="overflow-hidden rounded-2xl border border-border bg-gray-900">
              <video ref={camera.attach} muted playsInline className="aspect-[4/3] w-full -scale-x-100 object-cover" aria-label="Your camera preview" />
            </div>
          )}
          <nav aria-label="Questions" className="rounded-2xl border border-border bg-surface p-4">
            <p className="mb-3 text-sm font-medium">
              {answered} of {questions.length} answered
            </p>
            <div className="grid grid-cols-5 gap-2">
              {questions.map((x, i) => {
                const done = !!answers[x.id]?.length;
                return (
                  <button
                    key={x.id}
                    onClick={() => setIndex(i)}
                    aria-current={i === index ? 'step' : undefined}
                    aria-label={`Question ${i + 1}${done ? ', answered' : ''}${flagged.has(x.id) ? ', marked for review' : ''}`}
                    className={cn(
                      'relative grid aspect-square place-items-center rounded-lg text-xs font-semibold transition-colors',
                      done ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-fg-muted hover:bg-border',
                      i === index && 'ring-2 ring-primary ring-offset-2 ring-offset-surface',
                    )}
                  >
                    {i + 1}
                    {flagged.has(x.id) && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-warning" aria-hidden />}
                  </button>
                );
              })}
            </div>
            <Button variant="secondary" className="mt-4 w-full" onClick={() => setConfirmOpen(true)}>
              Submit exam
            </Button>
          </nav>
        </aside>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Submit your exam?"
        description={
          answered < questions.length
            ? `You have ${questions.length - answered} unanswered question(s). You can’t change answers after submitting.`
            : 'All questions answered. You can’t change answers after submitting.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Keep working
            </Button>
            <Button loading={submitting} onClick={() => void submit()}>
              Submit
            </Button>
          </>
        }
      />
    </div>
  );
}

function ProctorPill({ camera, available, alert }: { camera: ReturnType<typeof useCamera>; available: boolean | null; alert: boolean }) {
  const off = camera.state !== 'on';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        off ? 'bg-danger-soft text-danger' : alert ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success',
      )}
      title={available === false ? 'Camera analysis unavailable; browser signals only' : 'Proctoring active'}
    >
      <ShieldCheck className="size-3.5" aria-hidden />
      {off ? (
        <>
          Camera off
          <button className="underline" onClick={() => void camera.start()}>
            Turn on
          </button>
        </>
      ) : available === false ? (
        'Browser monitoring'
      ) : (
        'Proctoring on'
      )}
    </span>
  );
}

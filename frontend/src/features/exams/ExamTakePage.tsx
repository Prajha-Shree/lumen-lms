import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CameraOff,
  CheckCircle2,
  CircleDashed,
  Clock,
  Eye,
  FileQuestion,
  Lightbulb,
  Lock,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  XCircle,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Card, ErrorState, Skeleton, Stepper } from '@/components/ui';
import { http } from '@/lib/api';
import type { ExamInfo, ExamSession } from './api';
import { ExamResults } from './ExamResults';
import { ExamRunner } from './ExamRunner';
import { useCamera } from './useCamera';

export function ExamTakePage() {
  const { examId = '' } = useParams();
  const info = useQuery({ queryKey: ['exam', examId], queryFn: () => http.get<ExamInfo>(`/api/exams/${examId}`) });
  const camera = useCamera();
  const [session, setSession] = useState<ExamSession | null>(null);

  if (info.isError) return <ErrorState error={info.error} onRetry={() => void info.refetch()} />;
  if (info.isPending) return <Skeleton className="mx-auto h-[70dvh] max-w-3xl rounded-3xl" />;

  if (session && session.status !== 'IN_PROGRESS') {
    return <ExamResults session={session} />;
  }
  if (session) {
    return (
      <ExamRunner
        initial={session}
        camera={camera}
        onFinished={(s) => {
          camera.stop();
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          sessionStorage.removeItem(`fs:${s.id}`);
          setSession(s);
        }}
      />
    );
  }
  return <CheckIn info={info.data} camera={camera} onStarted={setSession} />;
}

// ─── Check-in wizard ──────────────────────────────────────────────────────────

function CheckIn({ info, camera, onStarted }: { info: ExamInfo; camera: ReturnType<typeof useCamera>; onStarted: (s: ExamSession) => void }) {
  const { exam } = info;
  const steps = exam.proctored ? ['Overview', 'Privacy & consent', 'Camera check', 'Begin'] : ['Overview', 'Begin'];
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [starting, setStarting] = useState(false);

  const attempts = info.attempts ?? [];
  const inProgress = attempts.find((a) => a.status === 'IN_PROGRESS' && new Date(a.expiresAt).getTime() > Date.now());
  const attemptsLeft = exam.maxAttempts - attempts.length + (inProgress ? 1 : 0);
  const current = steps[step]!;

  const begin = async () => {
    setStarting(true);
    try {
      // Full screen reduces accidental distractions; declining is allowed.
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        /* not supported or denied */
      }
      const { session } = await http.post<{ session: ExamSession }>(`/api/exams/${exam.id}/sessions`, { consent: exam.proctored ? consent : false });
      if (document.fullscreenElement) sessionStorage.setItem(`fs:${session.id}`, '1');
      onStarted(session);
    } catch (e) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      toast.error(e instanceof Error ? e.message : 'Could not start the exam');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link to={`/courses/${exam.course.id}?tab=exams`} className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> {exam.course.title}
      </Link>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{exam.title}</h1>
        {exam.proctored && (
          <Badge tone="info">
            <ShieldCheck className="size-3.5" aria-hidden /> Proctored
          </Badge>
        )}
      </div>
      <div className="my-6">
        <Stepper steps={steps} current={step} />
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={current} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
          {current === 'Overview' && (
            <Card className="p-6 sm:p-8">
              {exam.description && <p className="mb-6 text-fg-muted">{exam.description}</p>}
              <div className="grid gap-3 sm:grid-cols-3">
                <Fact icon={FileQuestion} label="Questions" value={exam.questionCount} />
                <Fact icon={Clock} label="Time limit" value={`${exam.durationMinutes} min`} />
                <Fact icon={CheckCircle2} label="To pass" value={`${exam.passingScore}%`} />
              </div>
              <ul className="mt-6 space-y-2 text-sm text-fg-muted">
                <li>• Your answers save automatically as you go. If you lose connection, reopen this page to resume.</li>
                <li>• The timer keeps running once you begin. When it reaches zero, your answers are submitted.</li>
                <li>
                  • Attempts remaining: <span className="font-medium text-fg">{Math.max(0, attemptsLeft)}</span> of {exam.maxAttempts}
                </li>
              </ul>
              {!info.enrolled ? (
                <p className="mt-6 rounded-xl bg-warning-soft p-3 text-sm text-warning">Enroll in the course to take this exam.</p>
              ) : attemptsLeft <= 0 && !inProgress ? (
                <p className="mt-6 rounded-xl bg-surface-2 p-3 text-sm">You’ve used all attempts for this exam.</p>
              ) : (
                <div className="mt-8 flex justify-end">
                  <Button size="lg" onClick={() => setStep(1)}>
                    {inProgress ? 'Resume attempt' : 'Continue'} <ArrowRight className="size-4" aria-hidden />
                  </Button>
                </div>
              )}
            </Card>
          )}

          {current === 'Privacy & consent' && (
            <ConsentStep retentionDays={info.retentionDays ?? 30} consent={consent} setConsent={setConsent} onBack={() => setStep(0)} onNext={() => setStep(2)} />
          )}

          {current === 'Camera check' && (
            <CameraCheck camera={camera} onReady={setCameraReady} ready={cameraReady} onBack={() => setStep(1)} onNext={() => setStep(3)} />
          )}

          {current === 'Begin' && (
            <Card className="p-6 text-center sm:p-10">
              <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
                <Clock className="size-7" aria-hidden />
              </div>
              <h2 className="text-xl font-semibold">Ready when you are</h2>
              <p className="mx-auto mt-2 max-w-md text-fg-muted">
                The {exam.durationMinutes}-minute timer starts when you begin. We’ll ask to switch to full screen to help you focus.
              </p>
              <div className="mt-8 flex justify-center gap-3">
                <Button variant="secondary" size="lg" onClick={() => setStep(step - 1)}>
                  Back
                </Button>
                <Button size="lg" onClick={() => void begin()} loading={starting}>
                  {inProgress ? 'Resume exam' : 'Begin exam'}
                </Button>
              </div>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface-2/70 p-4">
      <Icon className="mb-2 size-5 text-primary" aria-hidden />
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function ConsentStep({
  retentionDays,
  consent,
  setConsent,
  onBack,
  onNext,
}: {
  retentionDays: number;
  consent: boolean;
  setConsent: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const items = [
    { icon: Camera, title: 'What’s monitored', body: 'Your webcam is sampled about every 2 seconds to check that one face is visible and facing the screen. We also note if the exam tab is hidden, the window loses focus, or you leave full screen.' },
    { icon: Trash2, title: 'What’s stored', body: `No video and no images. Frames are analyzed in memory and immediately discarded. Only short event notes (like “face not visible, 6 seconds”) are kept, and they’re deleted after ${retentionDays} days.` },
    { icon: Eye, title: 'Who sees it', body: 'Only your instructor, to decide whether anything needs a conversation. Automated signals can be wrong, so a person always makes the call, never the software.' },
    { icon: UserRound, title: 'If this doesn’t work for you', body: 'If you can’t use a camera or need accommodations, contact your instructor before starting to arrange an alternative.' },
  ];
  return (
    <Card className="p-6 sm:p-8">
      <h2 className="mb-1 text-xl font-semibold">Before you start: how proctoring works</h2>
      <p className="mb-6 text-sm text-fg-muted">Please read this. You can’t begin a proctored exam without agreeing.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((i) => (
          <div key={i.title} className="rounded-2xl border border-border p-4">
            <i.icon className="mb-2 size-5 text-primary" aria-hidden />
            <h3 className="font-medium">{i.title}</h3>
            <p className="mt-1 text-sm text-fg-muted">{i.body}</p>
          </div>
        ))}
      </div>
      <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl bg-surface-2/60 p-4">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 accent-[var(--primary)]" />
        <span className="text-sm">
          I understand how my camera and browser activity will be used during this exam, and I agree to proceed.
        </span>
      </label>
      <div className="mt-8 flex justify-between gap-3">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button disabled={!consent} onClick={onNext}>
          I agree, continue <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </Card>
  );
}

type Check = { available: boolean; faces?: number; lookingAway?: boolean; brightness?: number };

function CameraCheck({
  camera,
  ready,
  onReady,
  onBack,
  onNext,
}: {
  camera: ReturnType<typeof useCamera>;
  ready: boolean;
  onReady: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [check, setCheck] = useState<Check | null>(null);
  const [goodStreak, setGoodStreak] = useState(0);
  const { state, start, capture } = camera;

  useEffect(() => {
    void start();
  }, [start]);

  // Live feedback loop: nothing is recorded during the check.
  useEffect(() => {
    if (state !== 'on') return;
    let cancelled = false;
    const run = async () => {
      const blob = await capture();
      if (!blob || cancelled) return;
      const body = new FormData();
      body.append('frame', blob, 'frame.jpg');
      try {
        const r = await http.post<Check>('/api/proctoring/check', body);
        if (cancelled) return;
        setCheck(r);
        const good = r.available && r.faces === 1 && !r.lookingAway;
        setGoodStreak((s) => (good ? s + 1 : 0));
      } catch {
        /* keep trying */
      }
    };
    const id = setInterval(() => void run(), 1500);
    void run();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [state, capture]);

  const analysisDown = check?.available === false;
  useEffect(() => onReady(state === 'on' && (analysisDown || goodStreak >= 2)), [state, analysisDown, goodStreak, onReady]);

  const items: { label: string; ok: boolean | null; hint: string }[] = [
    { label: 'Camera is on', ok: state === 'on' ? true : state === 'requesting' || state === 'idle' ? null : false, hint: 'Allow camera access in your browser.' },
    { label: 'Your face is visible', ok: analysisDown ? null : check ? (check.faces ?? 0) >= 1 : null, hint: 'Center yourself in the frame.' },
    { label: 'Only you are in view', ok: analysisDown ? null : check ? (check.faces ?? 0) <= 1 : null, hint: 'Make sure no one else is in the frame.' },
    { label: 'You’re facing the screen', ok: analysisDown ? null : check?.faces ? !check.lookingAway : null, hint: 'Look at the screen and keep your head level.' },
    { label: 'Lighting is good', ok: analysisDown ? null : check?.brightness != null ? check.brightness > 0.18 : null, hint: 'Face a light source; avoid a bright window behind you.' },
  ];

  return (
    <Card className="p-6 sm:p-8">
      <h2 className="mb-1 text-xl font-semibold">Camera check</h2>
      <p className="mb-6 text-sm text-fg-muted">A quick check that the camera can see you. Nothing is recorded.</p>
      <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-gray-900">
          {/* Mirrored like a mirror; a preview for the student only. */}
          <video ref={camera.attach} muted playsInline className="size-full -scale-x-100 object-cover" aria-label="Your camera preview" />
          {state !== 'on' && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
              {state === 'denied' ? (
                <div>
                  <CameraOff className="mx-auto mb-2 size-8" aria-hidden />
                  <p className="font-medium">Camera access was blocked</p>
                  <p className="mt-1 text-sm text-white/70">Allow the camera in your browser’s address bar, then retry.</p>
                  <Button size="sm" className="mt-4" onClick={() => void start()}>
                    Retry
                  </Button>
                </div>
              ) : state === 'unavailable' || state === 'ended' ? (
                <div>
                  <CameraOff className="mx-auto mb-2 size-8" aria-hidden />
                  <p className="font-medium">No camera found</p>
                  <p className="mt-1 text-sm text-white/70">Connect a camera or contact your instructor about alternatives.</p>
                  <Button size="sm" className="mt-4" onClick={() => void start()}>
                    Retry
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-white/70">Starting camera…</p>
              )}
            </div>
          )}
        </div>
        <ul className="space-y-2.5" aria-live="polite">
          {items.map((i) => (
            <li key={i.label} className="flex items-start gap-3">
              {i.ok === true ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-label="OK" />
              ) : i.ok === false ? (
                <XCircle className="mt-0.5 size-5 shrink-0 text-warning" aria-label="Needs attention" />
              ) : (
                <CircleDashed className="mt-0.5 size-5 shrink-0 animate-spin text-fg-muted [animation-duration:3s]" aria-label="Checking" />
              )}
              <div>
                <p className="text-sm font-medium">{i.label}</p>
                {i.ok === false && (
                  <p className="flex items-center gap-1 text-xs text-fg-muted">
                    <Lightbulb className="size-3" aria-hidden /> {i.hint}
                  </p>
                )}
              </div>
            </li>
          ))}
          {analysisDown && (
            <li className="rounded-xl bg-info-soft p-3 text-xs text-info">
              Automated camera analysis is unavailable right now, so this exam will rely on browser signals only. You can continue.
            </li>
          )}
          {check && (check.faces ?? 0) > 1 && (
            <li className="flex items-center gap-2 rounded-xl bg-warning-soft p-3 text-xs text-warning">
              <Users className="size-4" aria-hidden /> More than one face is visible.
            </li>
          )}
        </ul>
      </div>
      <p className="mt-6 flex items-center gap-1.5 text-xs text-fg-muted">
        <Lock className="size-3.5" aria-hidden /> Frames are analyzed in memory and discarded immediately.
      </p>
      <div className="mt-6 flex justify-between gap-3">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button disabled={!ready} onClick={onNext}>
          {ready ? 'Looks good, continue' : 'Waiting for a clear view…'} {ready && <ArrowRight className="size-4" aria-hidden />}
        </Button>
      </div>
    </Card>
  );
}

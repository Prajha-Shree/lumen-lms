import { useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, Clock, Eye, Gauge, Lock, RefreshCw, Sparkles, Sprout, Target, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Card, ConfirmDialog, ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { http } from '@/lib/api';
import { PACE_COPY, profileKey, topicLabel, useMyProfile, type Profile } from './api';
import { CalibrationMeter, MasteryBars, Meter, ModalityBar } from './ProfileCharts';

export function LearningProfilePage() {
  const profile = useMyProfile();
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  if (profile.isPending) return <Skeleton className="mx-auto h-[60dvh] max-w-5xl" />;
  return profile.data ? <ProfileView profile={profile.data} /> : <Intro />;
}

function Intro() {
  const points: { icon: typeof Eye; title: string; body: ReactNode }[] = [
    { icon: Target, title: 'What it looks at', body: 'Your study preferences, a quick check across five data-science topics, three reasoning puzzles, and how confident you feel about each answer.' },
    { icon: Sparkles, title: 'How it’s used', body: 'Only to order and suggest lessons for you. It is never used for grades, rankings or admission decisions.' },
    { icon: Eye, title: 'Who can see it', body: 'You and your instructors at your institution, so they can support you. Nobody outside your institution.' },
    { icon: Lock, title: 'You stay in control', body: 'Retake it any time, or delete your profile and every stored answer with one click.' },
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <div className="mx-auto mb-5 grid size-16 place-items-center rounded-3xl bg-primary-soft text-primary">
          <BrainCircuit className="size-8" aria-hidden />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Build your learning profile</h1>
        <p className="mx-auto mt-3 max-w-xl text-lg text-fg-muted">
          16 short questions, about 8 minutes. It adapts as you go: get one right and the next gets a little harder.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Badge>
            <Clock className="size-3.5" aria-hidden /> ~8 min
          </Badge>
          <Badge>Pause and resume anytime</Badge>
          <Badge tone="success">Not graded</Badge>
        </div>
      </motion.div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {points.map((p, i) => (
          <motion.div key={p.title} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.06 }}>
            <Card className="h-full p-5">
              <p.icon className="mb-3 size-5 text-primary" aria-hidden />
              <h2 className="font-semibold">{p.title}</h2>
              <p className="mt-1 text-sm text-fg-muted">{p.body}</p>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="mt-10 flex flex-col items-center gap-3">
        <Link to="/assessment">
          <Button size="lg">I understand. Start the assessment</Button>
        </Link>
        <p className="text-xs text-fg-muted">There are no trick questions. “I’m guessing” is always a valid confidence answer.</p>
      </div>
    </div>
  );
}

function ProfileView({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pace = PACE_COPY[profile.pace];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Your learning profile"
        description={`Updated ${new Date(profile.updatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })} · version ${profile.version}`}
        actions={
          <>
            <Link to="/assessment">
              <Button variant="secondary">
                <RefreshCw className="size-4" aria-hidden /> Retake
              </Button>
            </Link>
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" aria-hidden /> Delete
            </Button>
          </>
        }
      />

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="mb-6 overflow-hidden">
          <div className="flex gap-4 bg-gradient-to-br from-primary-soft to-transparent p-6">
            <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <p className="leading-relaxed">{profile.summary}</p>
          </div>
        </Card>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="p-6 lg:col-span-3">
          <h2 className="font-semibold">Where you are right now</h2>
          <p className="mb-5 text-sm text-fg-muted">Estimated from the adaptive knowledge check. It updates as you learn.</p>
          <MasteryBars mastery={profile.topicMastery} />
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <TopicChips icon={Target} title="Strengths" topics={profile.strengths} tone="success" />
            <TopicChips icon={Sprout} title="Growing next" topics={profile.growthAreas} tone="warning" />
          </div>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <h2 className="mb-4 font-semibold">How you like to learn</h2>
            <ModalityBar modality={profile.modality} />
          </Card>
          <Card className="p-6">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-semibold">Pace</h2>
              <Badge tone="primary">{pace.label}</Badge>
            </div>
            <p className="text-sm text-fg-muted">{pace.body}</p>
          </Card>
          <Card className="p-6">
            <h2 className="mb-4 flex items-center gap-2 font-semibold">
              <Gauge className="size-4 text-fg-muted" aria-hidden /> Working speed
            </h2>
            <Meter value={profile.processingSpeed} low="Deliberate" high="Quick" />
          </Card>
          <Card className="p-6">
            <h2 className="mb-3 font-semibold">Confidence calibration</h2>
            <CalibrationMeter value={profile.calibration} />
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete your learning profile?"
        description="Your profile and every stored assessment answer will be permanently deleted. Recommendations fall back to course order until you retake it."
        confirmLabel="Delete profile"
        onConfirm={async () => {
          await http.delete('/api/cognitive/profile/me');
          qc.setQueryData(profileKey, null);
          void qc.invalidateQueries({ queryKey: ['recommendations'] });
          toast.success('Profile deleted');
        }}
      />
    </div>
  );
}

function TopicChips({ icon: Icon, title, topics, tone }: { icon: typeof Target; title: string; topics: string[]; tone: 'success' | 'warning' }) {
  return (
    <div className="rounded-xl bg-surface-2/60 p-4">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
        <Icon className="size-4" aria-hidden /> {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {topics.length ? topics.map((t) => <Badge key={t} tone={tone}>{topicLabel(t)}</Badge>) : <span className="text-sm text-fg-muted">Keep going, this fills in as you learn.</span>}
      </div>
    </div>
  );
}

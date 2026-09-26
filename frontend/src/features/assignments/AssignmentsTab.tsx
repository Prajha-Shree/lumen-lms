import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, CheckCircle2, ClipboardList, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Avatar, Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, Label, Markdown, Skeleton, Textarea } from '@/components/ui';
import { useSession } from '@/features/auth/AuthProvider';
import { ApiError, http } from '@/lib/api';
import { cn } from '@/lib/cn';

type Level = { points: number; label: string; description: string };
type Criterion = { id: string; title: string; description: string; levels: Level[] };
type Submission = {
  id: string;
  content: string;
  status: 'SUBMITTED' | 'GRADED';
  submittedAt: string;
  grades: Record<string, number> | null;
  score: number | null;
  feedback: string | null;
  gradedAt: string | null;
  user?: { id: string; name: string };
  gradedBy?: { name: string } | null;
};
type Assignment = {
  id: string;
  title: string;
  description: string;
  dueAt: string | null;
  rubric: Criterion[];
  maxPoints: number;
  _count: { submissions: number };
  toGrade?: number;
  mySubmission?: Submission | null;
};

const due = (d: string | null) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'No due date');

export function AssignmentsTab({ courseId, canManage }: { courseId: string; canManage: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['assignments', courseId], queryFn: () => http.get<{ assignments: Assignment[] }>(`/api/courses/${courseId}/assignments`).then((r) => r.assignments) });

  if (openId) return <AssignmentDetail id={openId} courseId={courseId} onBack={() => setOpenId(null)} />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  return (
    <div>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> New assignment
          </Button>
        </div>
      )}
      {list.isPending ? (
        <Skeleton className="h-40" />
      ) : list.data.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No assignments yet" />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.data.map((a) => {
            const sub = a.mySubmission;
            return (
              <li key={a.id}>
                <button onClick={() => setOpenId(a.id)} className="flex h-full w-full flex-col rounded-2xl border border-border bg-surface p-5 text-left shadow-card transition-shadow hover:shadow-pop">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{a.title}</h3>
                    {a.toGrade !== undefined ? (
                      a.toGrade > 0 ? <Badge tone="warning">{a.toGrade} to grade</Badge> : <Badge>{a._count.submissions} submitted</Badge>
                    ) : sub?.status === 'GRADED' ? (
                      <Badge tone="success">
                        {sub.score}/{a.maxPoints}
                      </Badge>
                    ) : sub ? (
                      <Badge tone="info">Submitted</Badge>
                    ) : (
                      <Badge tone="warning">To do</Badge>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{a.description}</p>
                  <p className="mt-auto flex items-center gap-1.5 pt-3 text-xs text-fg-muted">
                    <CalendarClock className="size-3.5" aria-hidden /> {due(a.dueAt)} · {a.maxPoints} pts
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {canManage && <CreateAssignmentDialog courseId={courseId} open={creating} onOpenChange={setCreating} />}
    </div>
  );
}

function RubricTable({ rubric, selected, onSelect }: { rubric: Criterion[]; selected?: Record<string, number> | null; onSelect?: (criterion: string, points: number) => void }) {
  return (
    <div className="space-y-3">
      {rubric.map((c) => (
        <fieldset key={c.id} className="rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium">{c.title}</legend>
          {c.description && <p className="mb-2 text-xs text-fg-muted">{c.description}</p>}
          <div className="grid gap-2 sm:grid-cols-3" role={onSelect ? 'radiogroup' : undefined} aria-label={c.title}>
            {c.levels.map((l) => {
              const active = selected?.[c.id] === l.points;
              const Tag = onSelect ? 'button' : 'div';
              return (
                <Tag
                  key={l.label}
                  {...(onSelect && { type: 'button' as const, role: 'radio', 'aria-checked': active, onClick: () => onSelect(c.id, l.points) })}
                  className={cn('rounded-lg border p-2.5 text-left text-xs transition-colors', active ? 'border-primary bg-primary-soft' : 'border-border', onSelect && !active && 'hover:bg-surface-2')}
                >
                  <span className="flex justify-between font-medium">
                    {l.label} <span className="tabular-nums">{l.points} pts</span>
                  </span>
                  {l.description && <span className="mt-1 block text-fg-muted">{l.description}</span>}
                </Tag>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function AssignmentDetail({ id, courseId, onBack }: { id: string; courseId: string; onBack: () => void }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const key = ['assignment', id];
  const q = useQuery({ queryKey: key, queryFn: () => http.get<{ assignment: Assignment; submissions: Submission[] }>(`/api/assignments/${id}`) });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [grading, setGrading] = useState<Submission | null>(null);
  const mine = q.data?.submissions[0];

  useEffect(() => {
    if (user.role === 'STUDENT' && mine) setDraft(mine.content);
  }, [mine, user.role]);

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-96" />;
  const { assignment, submissions } = q.data;
  const isStudent = user.role === 'STUDENT';

  const submit = async () => {
    setBusy(true);
    try {
      await http.post(`/api/assignments/${id}/submissions`, { content: draft });
      toast.success(mine ? 'Resubmitted' : 'Submitted · +15 XP');
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['assignments', courseId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> All assignments
      </button>
      <Card className="mb-4 p-6">
        <h2 className="text-xl font-semibold">{assignment.title}</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Due {due(assignment.dueAt)} · {assignment.maxPoints} points
        </p>
        {assignment.description && <Markdown className="mt-4 text-sm">{assignment.description}</Markdown>}
        <h3 className="mb-2 mt-6 text-sm font-semibold">Rubric</h3>
        <RubricTable rubric={assignment.rubric} selected={isStudent ? mine?.grades : undefined} />
      </Card>

      {isStudent ? (
        <Card className="p-6">
          {mine?.status === 'GRADED' ? (
            <div>
              <p className="flex items-center gap-2 font-semibold text-success">
                <CheckCircle2 className="size-5" aria-hidden /> Graded: {mine.score}/{assignment.maxPoints}
              </p>
              {mine.feedback && (
                <p className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">
                  <span className="font-medium">{mine.gradedBy?.name ?? 'Instructor'}:</span> {mine.feedback}
                </p>
              )}
              <h3 className="mb-1 mt-4 text-sm font-medium">Your submission</h3>
              <p className="whitespace-pre-wrap text-sm text-fg-muted">{mine.content}</p>
            </div>
          ) : (
            <div>
              <Label htmlFor="submission">{mine ? 'Your submission (you can edit until it’s graded)' : 'Your submission'}</Label>
              <Textarea id="submission" rows={10} className="mt-1.5" value={draft} onChange={(e) => setDraft(e.target.value)} />
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-fg-muted">{mine ? `Last submitted ${new Date(mine.submittedAt).toLocaleString()}` : `${draft.trim().split(/\s+/).filter(Boolean).length} words`}</span>
                <Button onClick={() => void submit()} disabled={!draft.trim()} loading={busy}>
                  {mine ? 'Resubmit' : 'Submit'}
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <h3 className="border-b border-border px-5 py-3 font-semibold">Submissions ({submissions.length})</h3>
          {submissions.length === 0 ? (
            <p className="p-5 text-sm text-fg-muted">No submissions yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {submissions.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={s.user!.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{s.user!.name}</p>
                    <p className="text-xs text-fg-muted">Submitted {new Date(s.submittedAt).toLocaleString()}</p>
                  </div>
                  {s.status === 'GRADED' ? (
                    <Badge tone="success">
                      {s.score}/{assignment.maxPoints}
                    </Badge>
                  ) : (
                    <Badge tone="warning">Needs grading</Badge>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => setGrading(s)}>
                    {s.status === 'GRADED' ? 'Regrade' : 'Grade'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <GradeDialog
        assignment={assignment}
        submission={grading}
        onClose={() => setGrading(null)}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: key });
          void qc.invalidateQueries({ queryKey: ['assignments', courseId] });
        }}
      />
    </div>
  );
}

function GradeDialog({ assignment, submission, onClose, onSaved }: { assignment: Assignment; submission: Submission | null; onClose: () => void; onSaved: () => void }) {
  const [grades, setGrades] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setGrades(submission?.grades ?? {});
    setFeedback(submission?.feedback ?? '');
  }, [submission]);

  const total = assignment.rubric.reduce((s, c) => s + (grades[c.id] ?? 0), 0);
  const complete = assignment.rubric.every((c) => grades[c.id] !== undefined);

  const save = async () => {
    setSaving(true);
    try {
      await http.put(`/api/submissions/${submission!.id}/grade`, { grades, feedback: feedback || undefined });
      toast.success(`Graded: ${total}/${assignment.maxPoints}`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!submission} onOpenChange={(o) => !o && onClose()} title={`Grade: ${submission?.user?.name ?? ''}`} className="max-w-3xl">
      {submission && (
        <div className="space-y-4">
          <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-4 text-sm">{submission.content}</div>
          <RubricTable rubric={assignment.rubric} selected={grades} onSelect={(c, p) => setGrades((g) => ({ ...g, [c]: p }))} />
          <Textarea rows={3} placeholder="Feedback for the student (optional)" value={feedback} onChange={(e) => setFeedback(e.target.value)} aria-label="Feedback" />
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium tabular-nums" aria-live="polite">
              Total: {total} / {assignment.maxPoints}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={!complete} loading={saving}>
                Save grade
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

type DraftCriterion = { title: string; levels: { label: string; points: number }[] };
const defaultCriterion = (): DraftCriterion => ({
  title: '',
  levels: [
    { label: 'Excellent', points: 4 },
    { label: 'Developing', points: 2 },
    { label: 'Missing', points: 0 },
  ],
});

function CreateAssignmentDialog({ courseId, open, onOpenChange }: { courseId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [criteria, setCriteria] = useState<DraftCriterion[]>([defaultCriterion()]);
  const [saving, setSaving] = useState(false);

  const update = (i: number, fn: (c: DraftCriterion) => DraftCriterion) => setCriteria((cs) => cs.map((c, j) => (j === i ? fn(c) : c)));
  const valid = title.trim().length >= 3 && criteria.every((c) => c.title.trim() && c.levels.every((l) => l.label.trim()));

  const save = async () => {
    setSaving(true);
    try {
      await http.post(`/api/courses/${courseId}/assignments`, {
        title,
        description,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        rubric: criteria.map((c, i) => ({ id: `c${i + 1}`, title: c.title, levels: c.levels })),
      });
      toast.success('Assignment posted. Students have been notified.');
      void qc.invalidateQueries({ queryKey: ['assignments', courseId] });
      onOpenChange(false);
      setTitle('');
      setDescription('');
      setDueAt('');
      setCriteria([defaultCriterion()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New assignment" className="max-w-3xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
          <div>
            <Label htmlFor="a-title">Title</Label>
            <Input id="a-title" className="mt-1.5" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="a-due">Due</Label>
            <Input id="a-due" type="datetime-local" className="mt-1.5" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="a-desc">Instructions (Markdown)</Label>
          <Textarea id="a-desc" rows={4} className="mt-1.5" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Rubric</p>
          <div className="space-y-3">
            {criteria.map((c, i) => (
              <div key={i} className="rounded-xl border border-border p-3">
                <div className="mb-2 flex gap-2">
                  <Input aria-label={`Criterion ${i + 1} title`} placeholder="Criterion (e.g. Clarity)" value={c.title} onChange={(e) => update(i, (x) => ({ ...x, title: e.target.value }))} />
                  <button type="button" aria-label="Remove criterion" disabled={criteria.length === 1} onClick={() => setCriteria((cs) => cs.filter((_, j) => j !== i))} className="rounded-lg p-2 text-fg-muted hover:bg-danger-soft hover:text-danger disabled:opacity-30">
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {c.levels.map((l, li) => (
                    <div key={li} className="flex gap-1">
                      <Input aria-label="Level label" value={l.label} onChange={(e) => update(i, (x) => ({ ...x, levels: x.levels.map((y, k) => (k === li ? { ...y, label: e.target.value } : y)) }))} />
                      <Input aria-label="Level points" type="number" min={0} className="w-16" value={l.points} onChange={(e) => update(i, (x) => ({ ...x, levels: x.levels.map((y, k) => (k === li ? { ...y, points: Math.max(0, Number(e.target.value) || 0) } : y)) }))} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setCriteria((cs) => [...cs, defaultCriterion()])}>
            <Plus className="size-4" aria-hidden /> Add criterion
          </Button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-fg-muted">Max points: {criteria.reduce((s, c) => s + Math.max(...c.levels.map((l) => l.points)), 0)}</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!valid} loading={saving}>
              Post assignment
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

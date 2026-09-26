import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Eye, Pencil, Plus, Rocket, ShieldCheck, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Input, Skeleton, Textarea } from '@/components/ui';
import { http } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { ExamInfo } from './api';

type Question = NonNullable<ExamInfo['questions']>[number];

const settingsSchema = z.object({
  title: z.string().trim().min(3, 'At least 3 characters'),
  description: z.string().max(2000),
  durationMinutes: z.coerce.number<number>().int().min(1).max(600),
  passingScore: z.coerce.number<number>().int().min(0).max(100),
  maxAttempts: z.coerce.number<number>().int().min(1).max(20),
  proctored: z.boolean(),
});

export function ExamEditorPage() {
  const { examId = '' } = useParams();
  const qc = useQueryClient();
  const key = ['exam', examId];
  const info = useQuery({ queryKey: key, queryFn: () => http.get<ExamInfo>(`/api/exams/${examId}`) });
  const [editing, setEditing] = useState<Question | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Question | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: key });

  const form = useForm({ resolver: zodResolver(settingsSchema) });
  useEffect(() => {
    const e = info.data?.exam;
    if (e) form.reset({ title: e.title, description: e.description, durationMinutes: e.durationMinutes, passingScore: e.passingScore, maxAttempts: e.maxAttempts, proctored: e.proctored });
  }, [info.data, form]);

  if (info.isError) return <ErrorState error={info.error} onRetry={() => void info.refetch()} />;
  if (info.isPending) return <Skeleton className="mx-auto h-[70dvh] max-w-5xl" />;
  if (!info.data.canManage) return <Navigate to={`/exams/${examId}/sessions`} replace />;
  const { exam, questions = [] } = info.data;

  const save = form.handleSubmit(async (v) => {
    try {
      await http.patch(`/api/exams/${examId}`, v);
      toast.success('Exam settings saved');
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  });

  const setStatus = async (status: 'PUBLISHED' | 'DRAFT') => {
    try {
      await http.patch(`/api/exams/${examId}`, { status });
      toast.success(status === 'PUBLISHED' ? 'Exam published' : 'Exam unpublished');
      refresh();
      void qc.invalidateQueries({ queryKey: ['course', exam.course.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const proctored = form.watch('proctored');

  return (
    <div className="mx-auto max-w-5xl">
      <Link to={`/courses/${exam.course.id}/edit`} className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> {exam.course.title}
      </Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Edit exam</h1>
          <Badge tone={exam.status === 'PUBLISHED' ? 'success' : 'warning'}>{exam.status}</Badge>
        </div>
        <div className="flex gap-2">
          <Link to={`/exams/${examId}/sessions`}>
            <Button variant="secondary">
              <Eye className="size-4" aria-hidden /> Attempts
            </Button>
          </Link>
          {exam.status === 'PUBLISHED' ? (
            <Button variant="secondary" onClick={() => void setStatus('DRAFT')}>
              <Undo2 className="size-4" aria-hidden /> Unpublish
            </Button>
          ) : (
            <Button onClick={() => void setStatus('PUBLISHED')}>
              <Rocket className="size-4" aria-hidden /> Publish
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="order-2 space-y-3 lg:order-1" aria-labelledby="questions-h">
          <div className="flex items-center justify-between">
            <h2 id="questions-h" className="font-semibold">
              Questions ({questions.length})
            </h2>
            <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> Add question
            </Button>
          </div>
          {questions.length === 0 && <EmptyState title="No questions yet" description="Add at least one question before publishing." action={<Button onClick={() => setEditing('new')}>Add question</Button>} />}
          {questions.map((q, i) => (
            <Card key={q.id} className="p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-xs font-semibold">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{q.prompt}</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {q.options.map((o) => (
                      <li key={o.id} className={cn('flex items-center gap-2', q.correctOptionIds.includes(o.id) ? 'font-medium text-success' : 'text-fg-muted')}>
                        {q.correctOptionIds.includes(o.id) ? <Check className="size-3.5" aria-label="Correct" /> : <span className="size-3.5" />}
                        {o.text}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone="info">{q.topic}</Badge>
                    <Badge>{q.points} pt</Badge>
                    <Badge>Difficulty {q.difficulty}</Badge>
                  </div>
                </div>
                <button className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Edit question" onClick={() => setEditing(q)}>
                  <Pencil className="size-4" />
                </button>
                <button className="rounded-lg p-1.5 text-fg-muted hover:bg-danger-soft hover:text-danger" aria-label="Delete question" onClick={() => setDeleting(q)}>
                  <Trash2 className="size-4" />
                </button>
              </div>
            </Card>
          ))}
        </section>

        <aside className="order-1 lg:order-2">
          <Card className="p-5">
            <h2 className="mb-4 font-semibold">Settings</h2>
            <form onSubmit={save} className="space-y-4" noValidate>
              <Field label="Title" error={form.formState.errors.title?.message}>
                {(a) => <Input {...a} {...form.register('title')} />}
              </Field>
              <Field label="Description">{(a) => <Textarea {...a} rows={3} {...form.register('description')} />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Minutes">{(a) => <Input {...a} type="number" {...form.register('durationMinutes')} />}</Field>
                <Field label="Pass %">{(a) => <Input {...a} type="number" {...form.register('passingScore')} />}</Field>
              </div>
              <Field label="Attempts allowed">{(a) => <Input {...a} type="number" {...form.register('maxAttempts')} />}</Field>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-2/60 p-3">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" {...form.register('proctored')} />
                <span className="text-sm">
                  <span className="flex items-center gap-1.5 font-medium">
                    <ShieldCheck className="size-4" aria-hidden /> AI proctoring
                  </span>
                  <span className="text-fg-muted">
                    {proctored ? 'Students consent before starting. Only event notes are stored, never video.' : 'Browser and camera monitoring are off.'}
                  </span>
                </span>
              </label>
              <Button type="submit" className="w-full" disabled={!form.formState.isDirty} loading={form.formState.isSubmitting}>
                Save settings
              </Button>
            </form>
          </Card>
        </aside>
      </div>

      <QuestionDialog examId={examId} question={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this question?"
        description={deleting?.prompt ?? ''}
        onConfirm={async () => {
          await http.delete(`/api/exam-questions/${deleting!.id}`);
          toast.success('Question deleted');
          refresh();
        }}
      />
    </div>
  );
}

const questionSchema = z.object({
  prompt: z.string().trim().min(3, 'At least 3 characters'),
  options: z.array(z.object({ text: z.string().trim().min(1, 'Required'), correct: z.boolean() })).min(2).max(8),
  topic: z.string().trim().min(1, 'Required'),
  difficulty: z.coerce.number<number>().int().min(1).max(5),
  points: z.coerce.number<number>().int().min(1).max(100),
  explanation: z.string(),
}).refine((v) => v.options.some((o) => o.correct), { path: ['options'], message: 'Mark at least one correct answer' });
type QValues = z.infer<typeof questionSchema>;

function QuestionDialog({ examId, question, onClose, onSaved }: { examId: string; question: Question | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const form = useForm<QValues>({ resolver: zodResolver(questionSchema) });
  const options = form.watch('options') ?? [];

  useEffect(() => {
    if (!question) return;
    form.reset(
      question === 'new'
        ? { prompt: '', options: [{ text: '', correct: true }, { text: '', correct: false }], topic: '', difficulty: 2, points: 1, explanation: '' }
        : {
            prompt: question.prompt,
            options: question.options.map((o) => ({ text: o.text, correct: question.correctOptionIds.includes(o.id) })),
            topic: question.topic,
            difficulty: question.difficulty,
            points: question.points,
            explanation: question.explanation ?? '',
          },
    );
  }, [question, form]);

  const submit = form.handleSubmit(async (v) => {
    const payload = {
      prompt: v.prompt,
      options: v.options.map((o) => o.text),
      correct: v.options.flatMap((o, i) => (o.correct ? [i] : [])),
      topic: v.topic.toLowerCase(),
      difficulty: v.difficulty,
      points: v.points,
      explanation: v.explanation || undefined,
    };
    try {
      if (question === 'new') await http.post(`/api/exams/${examId}/questions`, payload);
      else await http.patch(`/api/exam-questions/${question!.id}`, payload);
      toast.success('Question saved');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  });

  return (
    <Dialog open={!!question} onOpenChange={(o) => !o && onClose()} title={question === 'new' ? 'New question' : 'Edit question'} className="max-w-2xl">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Question" error={form.formState.errors.prompt?.message}>
          {(a) => <Textarea {...a} rows={2} autoFocus {...form.register('prompt')} />}
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Options (check the correct ones)</legend>
          <div className="space-y-2">
            {options.map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="checkbox" aria-label={`Option ${i + 1} is correct`} className="size-5 accent-[var(--primary)]" {...form.register(`options.${i}.correct`)} />
                <Input aria-label={`Option ${i + 1}`} {...form.register(`options.${i}.text`)} />
                <button
                  type="button"
                  disabled={options.length <= 2}
                  aria-label={`Remove option ${i + 1}`}
                  onClick={() => form.setValue('options', options.filter((__, j) => j !== i))}
                  className="rounded-lg p-2 text-fg-muted hover:bg-surface-2 disabled:opacity-30"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
          {form.formState.errors.options && <p className="mt-1 text-xs text-danger">{form.formState.errors.options.message ?? form.formState.errors.options.root?.message}</p>}
          {options.length < 8 && (
            <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => form.setValue('options', [...options, { text: '', correct: false }])}>
              <Plus className="size-4" aria-hidden /> Add option
            </Button>
          )}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Topic" hint="Matches lesson topics" error={form.formState.errors.topic?.message}>
            {(a) => <Input {...a} {...form.register('topic')} />}
          </Field>
          <Field label="Difficulty (1–5)">{(a) => <Input {...a} type="number" min={1} max={5} {...form.register('difficulty')} />}</Field>
          <Field label="Points">{(a) => <Input {...a} type="number" min={1} {...form.register('points')} />}</Field>
        </div>
        <Field label="Explanation" hint="Shown to students after they submit.">
          {(a) => <Textarea {...a} rows={2} {...form.register('explanation')} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Save question
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronLeft, Eye, FolderPlus, Pencil, Plus, Rocket, Trash2, Undo2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Input, Select, Skeleton, Textarea } from '@/components/ui';
import { http } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ACCENT, courseKeys, FORMAT_LABEL, useCourse, type CourseDetail, type LessonSummary, type ModuleDetail } from './api';
import { LessonEditorDialog } from './LessonEditorDialog';
import { Difficulty, FormatIcon } from './LessonIcons';

const detailsSchema = z.object({
  title: z.string().trim().min(3, 'At least 3 characters'),
  description: z.string().trim().max(4000),
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  tags: z.string(),
  accent: z.string(),
});

function move<T>(list: T[], from: number, to: number) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function CourseEditorPage() {
  const { courseId = '' } = useParams();
  const course = useCourse(courseId);
  if (course.isError) return <ErrorState error={course.error} onRetry={() => void course.refetch()} />;
  if (course.isPending) return <Skeleton className="mx-auto h-[70dvh] max-w-5xl" />;
  if (!course.data.canManage) return <Navigate to={`/courses/${courseId}`} replace />;
  return <Editor course={course.data} />;
}

function Editor({ course }: { course: CourseDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = courseKeys.detail(course.id);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: courseKeys.all });
  };

  const [lessonDialog, setLessonDialog] = useState<{ moduleId?: string; lesson?: LessonSummary } | null>(null);
  const [moduleDialog, setModuleDialog] = useState<{ module?: ModuleDetail } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; description: string; action: () => Promise<void> } | null>(null);
  const [publishing, setPublishing] = useState(false);

  const setStatus = async (status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED') => {
    setPublishing(true);
    try {
      await http.patch(`/api/courses/${course.id}`, { status });
      toast.success(status === 'PUBLISHED' ? 'Published! Students can now enroll.' : status === 'DRAFT' ? 'Moved back to draft' : 'Course archived');
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setPublishing(false);
    }
  };

  /** Optimistic reorder: update the cache now, persist, roll back on failure. */
  const reorder = async (url: string, ids: string[], apply: (c: CourseDetail) => CourseDetail) => {
    const prev = qc.getQueryData<CourseDetail>(key);
    qc.setQueryData<CourseDetail>(key, (c) => c && apply(c));
    try {
      await http.put(url, { ids });
    } catch (e) {
      qc.setQueryData(key, prev);
      toast.error(e instanceof Error ? e.message : 'Reorder failed');
    }
  };

  const moveModule = (i: number, dir: -1 | 1) => {
    const modules = move(course.modules, i, i + dir);
    void reorder(`/api/courses/${course.id}/modules/order`, modules.map((m) => m.id), (c) => ({ ...c, modules }));
  };

  const moveLesson = (m: ModuleDetail, i: number, dir: -1 | 1) => {
    const lessons = move(m.lessons, i, i + dir);
    void reorder(`/api/modules/${m.id}/lessons/order`, lessons.map((l) => l.id), (c) => ({
      ...c,
      modules: c.modules.map((x) => (x.id === m.id ? { ...x, lessons } : x)),
    }));
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Link to={`/courses/${course.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ChevronLeft className="size-4" aria-hidden /> Back to course
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Edit course</h1>
          <Badge tone={course.status === 'PUBLISHED' ? 'success' : course.status === 'DRAFT' ? 'warning' : 'neutral'}>{course.status}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/courses/${course.id}`}>
            <Button variant="secondary">
              <Eye className="size-4" aria-hidden /> Preview
            </Button>
          </Link>
          {course.status === 'PUBLISHED' ? (
            <Button variant="secondary" onClick={() => void setStatus('DRAFT')} loading={publishing}>
              <Undo2 className="size-4" aria-hidden /> Unpublish
            </Button>
          ) : (
            <Button onClick={() => void setStatus('PUBLISHED')} loading={publishing}>
              <Rocket className="size-4" aria-hidden /> Publish
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="content-heading" className="order-2 space-y-4 lg:order-1">
          <div className="flex items-center justify-between">
            <h2 id="content-heading" className="font-semibold">
              Content
            </h2>
            <Button size="sm" variant="secondary" onClick={() => setModuleDialog({})}>
              <FolderPlus className="size-4" aria-hidden /> Add module
            </Button>
          </div>

          {course.modules.length === 0 && (
            <EmptyState
              icon={FolderPlus}
              title="Start with a module"
              description="Modules group related lessons, like chapters in a book."
              action={<Button onClick={() => setModuleDialog({})}>Add first module</Button>}
            />
          )}

          <AnimatePresence initial={false}>
            {course.modules.map((m, mi) => (
              <motion.div key={m.id} layout transition={{ type: 'spring', bounce: 0.1, duration: 0.35 }}>
                <Card className="overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-border bg-surface-2/40 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Module {mi + 1}</p>
                      <p className="truncate font-semibold">{m.title}</p>
                    </div>
                    <IconBtn label="Move module up" disabled={mi === 0} onClick={() => moveModule(mi, -1)} icon={ArrowUp} />
                    <IconBtn label="Move module down" disabled={mi === course.modules.length - 1} onClick={() => moveModule(mi, 1)} icon={ArrowDown} />
                    <IconBtn label="Rename module" onClick={() => setModuleDialog({ module: m })} icon={Pencil} />
                    <IconBtn
                      label="Delete module"
                      danger
                      icon={Trash2}
                      onClick={() =>
                        setConfirm({
                          title: `Delete “${m.title}”?`,
                          description: `This also deletes its ${m.lessons.length} lesson(s) and their materials. Student progress on them is lost.`,
                          action: async () => {
                            await http.delete(`/api/modules/${m.id}`);
                            toast.success('Module deleted');
                            refresh();
                          },
                        })
                      }
                    />
                  </div>
                  <ul className="divide-y divide-border">
                    {m.lessons.map((l, li) => (
                      <motion.li key={l.id} layout className="flex items-center gap-3 px-4 py-3">
                        <FormatIcon format={l.format} className="text-fg-muted" />
                        <button className="min-w-0 flex-1 text-left" onClick={() => setLessonDialog({ lesson: l })}>
                          <p className="truncate font-medium hover:text-primary">{l.title}</p>
                          <p className="flex items-center gap-2 text-xs text-fg-muted">
                            {FORMAT_LABEL[l.format]} · {l.durationMinutes} min · <Difficulty value={l.difficulty} />
                            {l._count.attachments > 0 && <span>· {l._count.attachments} file(s)</span>}
                          </p>
                        </button>
                        <IconBtn label="Move lesson up" disabled={li === 0} onClick={() => moveLesson(m, li, -1)} icon={ArrowUp} />
                        <IconBtn label="Move lesson down" disabled={li === m.lessons.length - 1} onClick={() => moveLesson(m, li, 1)} icon={ArrowDown} />
                        <IconBtn
                          label="Delete lesson"
                          danger
                          icon={Trash2}
                          onClick={() =>
                            setConfirm({
                              title: `Delete “${l.title}”?`,
                              description: 'Its materials and student progress will be removed.',
                              action: async () => {
                                await http.delete(`/api/lessons/${l.id}`);
                                toast.success('Lesson deleted');
                                refresh();
                              },
                            })
                          }
                        />
                      </motion.li>
                    ))}
                  </ul>
                  <div className="px-4 py-3">
                    <Button size="sm" variant="ghost" onClick={() => setLessonDialog({ moduleId: m.id })}>
                      <Plus className="size-4" aria-hidden /> Add lesson
                    </Button>
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </section>

        <aside className="order-1 space-y-4 lg:order-2">
          <DetailsCard course={course} onSaved={refresh} />
          <ExamsCard course={course} />
          {course.status !== 'ARCHIVED' && course._count.enrollments > 0 ? (
            <Button variant="ghost" size="sm" className="mt-3 w-full text-fg-muted" onClick={() => void setStatus('ARCHIVED')}>
              Archive course
            </Button>
          ) : (
            course._count.enrollments === 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 w-full text-danger"
                onClick={() =>
                  setConfirm({
                    title: 'Delete this course?',
                    description: 'All modules, lessons and materials will be permanently deleted.',
                    action: async () => {
                      await http.delete(`/api/courses/${course.id}`);
                      toast.success('Course deleted');
                      void qc.invalidateQueries({ queryKey: courseKeys.all });
                      navigate('/courses');
                    },
                  })
                }
              >
                Delete course
              </Button>
            )
          )}
        </aside>
      </div>

      <LessonEditorDialog
        open={!!lessonDialog}
        onOpenChange={(o) => !o && setLessonDialog(null)}
        courseId={course.id}
        moduleId={lessonDialog?.moduleId}
        lesson={lessonDialog?.lesson}
      />
      <ModuleDialog courseId={course.id} state={moduleDialog} onClose={() => setModuleDialog(null)} onSaved={refresh} />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title ?? ''}
        description={confirm?.description ?? ''}
        onConfirm={async () => {
          try {
            await confirm?.action();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed');
          }
        }}
      />
    </div>
  );
}

function IconBtn({ label, icon: Icon, onClick, disabled, danger }: { label: string; icon: typeof Pencil; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-lg p-1.5 text-fg-muted transition-colors disabled:pointer-events-none disabled:opacity-30',
        danger ? 'hover:bg-danger-soft hover:text-danger' : 'hover:bg-surface-2 hover:text-fg',
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function DetailsCard({ course, onSaved }: { course: CourseDetail; onSaved: () => void }) {
  const form = useForm({
    resolver: zodResolver(detailsSchema),
    defaultValues: { title: course.title, description: course.description, level: course.level, tags: course.tags.join(', '), accent: course.accent },
  });
  const accent = form.watch('accent');

  const save = form.handleSubmit(async (v) => {
    try {
      await http.patch(`/api/courses/${course.id}`, { ...v, tags: v.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) });
      toast.success('Details saved');
      form.reset(v);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  });

  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold">Details</h2>
      <form onSubmit={save} className="space-y-4" noValidate>
        <Field label="Title" error={form.formState.errors.title?.message}>
          {(a) => <Input {...a} {...form.register('title')} />}
        </Field>
        <Field label="Description">{(a) => <Textarea {...a} rows={4} {...form.register('description')} />}</Field>
        <Field label="Level">
          {(a) => (
            <Select {...a} {...form.register('level')}>
              <option value="BEGINNER">Beginner</option>
              <option value="INTERMEDIATE">Intermediate</option>
              <option value="ADVANCED">Advanced</option>
            </Select>
          )}
        </Field>
        <Field label="Tags" hint="Comma-separated">
          {(a) => <Input {...a} {...form.register('tags')} />}
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Color</legend>
          <div className="flex gap-2">
            {Object.entries(ACCENT).map(([name, c]) => (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={accent === name}
                onClick={() => form.setValue('accent', name, { shouldDirty: true })}
                className={cn('size-7 rounded-full transition-transform', c.bg, accent === name ? 'scale-110 ring-2 ring-fg ring-offset-2 ring-offset-surface' : 'hover:scale-105')}
              />
            ))}
          </div>
        </fieldset>
        <Button type="submit" className="w-full" disabled={!form.formState.isDirty} loading={form.formState.isSubmitting}>
          Save details
        </Button>
      </form>
    </Card>
  );
}

function ExamsCard({ course }: { course: CourseDetail }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const create = async () => {
    setCreating(true);
    try {
      const { exam } = await http.post<{ exam: { id: string } }>(`/api/courses/${course.id}/exams`, { title: `${course.title}: Checkpoint`, proctored: true });
      navigate(`/exams/${exam.id}/edit`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
      setCreating(false);
    }
  };
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Exams</h2>
        <Button size="sm" variant="ghost" onClick={() => void create()} loading={creating}>
          <Plus className="size-4" aria-hidden /> New
        </Button>
      </div>
      {course.exams.length === 0 ? (
        <p className="text-sm text-fg-muted">No exams yet.</p>
      ) : (
        <ul className="space-y-1">
          {course.exams.map((e) => (
            <li key={e.id}>
              <Link to={`/exams/${e.id}/edit`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm hover:bg-surface-2">
                <span className="truncate">{e.title}</span>
                <Badge tone={e.status === 'PUBLISHED' ? 'success' : 'warning'}>{e._count.questions} Q</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ModuleDialog({
  courseId,
  state,
  onClose,
  onSaved,
}: {
  courseId: string;
  state: { module?: ModuleDetail } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useForm({ resolver: zodResolver(z.object({ title: z.string().trim().min(2, 'At least 2 characters'), description: z.string() })) });
  useEffect(() => {
    if (state) form.reset({ title: state.module?.title ?? '', description: state.module?.description ?? '' });
  }, [state, form]);

  const submit = form.handleSubmit(async (v) => {
    try {
      if (state?.module) await http.patch(`/api/modules/${state.module.id}`, v);
      else await http.post(`/api/courses/${courseId}/modules`, v);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  });

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()} title={state?.module ? 'Rename module' : 'New module'}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Title" error={form.formState.errors.title?.message}>
          {(a) => <Input {...a} autoFocus {...form.register('title')} />}
        </Field>
        <Field label="Description">{(a) => <Textarea {...a} rows={2} {...form.register('description')} />}</Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            {state?.module ? 'Save' : 'Add module'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

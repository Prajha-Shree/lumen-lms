import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, GraduationCap, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Textarea } from '@/components/ui';
import { useSession } from '@/features/auth/AuthProvider';
import { http } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ACCENT, courseKeys, useCourses, type CourseCard as Course } from './api';
import { CourseCard } from './CourseCard';

export function CoursesPage() {
  const { user } = useSession();
  const isStudent = user.role === 'STUDENT';
  const courses = useCourses();
  const [tab, setTab] = useState<'mine' | 'catalog'>('mine');
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const visible = useMemo(() => {
    let list = courses.data ?? [];
    if (isStudent) list = list.filter((c) => (tab === 'mine' ? !!c.enrollment : !c.enrollment));
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((c) => `${c.title} ${c.description} ${c.tags.join(' ')}`.toLowerCase().includes(needle));
    return list;
  }, [courses.data, isStudent, tab, q]);

  const enrolledCount = courses.data?.filter((c) => c.enrollment).length ?? 0;

  return (
    <>
      <PageHeader
        title="Courses"
        description={isStudent ? 'Continue where you left off, or explore something new.' : 'Build, publish and manage your courses.'}
        actions={
          !isStudent && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden /> New course
            </Button>
          )
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        {isStudent && (
          <div role="tablist" aria-label="Course lists" className="inline-flex rounded-xl border border-border bg-surface p-1">
            {(
              [
                ['mine', `My courses (${enrolledCount})`],
                ['catalog', 'Catalog'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  'rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors',
                  tab === key ? 'bg-primary text-primary-fg shadow-sm' : 'text-fg-muted hover:text-fg',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search courses" className="pl-10" aria-label="Search courses" />
        </div>
      </div>

      {courses.isError ? (
        <ErrorState error={courses.error} onRetry={() => void courses.refetch()} />
      ) : courses.isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        isStudent && tab === 'mine' && !q ? (
          <EmptyState
            icon={GraduationCap}
            title="You’re not enrolled in anything yet"
            description="Browse the catalog and enroll in a course to get started."
            action={<Button onClick={() => setTab('catalog')}>Browse catalog</Button>}
          />
        ) : (
          <EmptyState icon={BookOpen} title="No courses found" description={q ? 'Try a different search.' : 'Nothing here yet.'} />
        )
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((c, i) => (
            <CourseCard key={c.id} course={c} index={i} isStudent={isStudent} />
          ))}
        </div>
      )}

      {!isStudent && <CreateCourseDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </>
  );
}

const createSchema = z.object({
  title: z.string().trim().min(3, 'At least 3 characters'),
  description: z.string().trim().max(4000),
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  accent: z.string(),
});

function CreateCourseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const form = useForm({ resolver: zodResolver(createSchema), defaultValues: { title: '', description: '', level: 'BEGINNER' as const, accent: 'indigo' } });
  const accent = form.watch('accent');

  const submit = form.handleSubmit(async (v) => {
    try {
      const { course } = await http.post<{ course: Course }>('/api/courses', v);
      await qc.invalidateQueries({ queryKey: courseKeys.all });
      toast.success('Course created', { description: 'Add modules and lessons, then publish.' });
      onOpenChange(false);
      form.reset();
      navigate(`/courses/${course.id}/edit`);
    } catch (e) {
      form.setError('root', { message: e instanceof Error ? e.message : 'Failed' });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New course" description="It starts as a draft. Students can’t see it until you publish.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Title" error={form.formState.errors.title?.message}>
          {(a) => <Input {...a} autoFocus {...form.register('title')} />}
        </Field>
        <Field label="Description">{(a) => <Textarea {...a} rows={3} {...form.register('description')} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Level">
            {(a) => (
              <Select {...a} {...form.register('level')}>
                <option value="BEGINNER">Beginner</option>
                <option value="INTERMEDIATE">Intermediate</option>
                <option value="ADVANCED">Advanced</option>
              </Select>
            )}
          </Field>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Color</legend>
            <div className="flex h-11 items-center gap-2">
              {Object.entries(ACCENT).map(([name, c]) => (
                <button
                  key={name}
                  type="button"
                  aria-label={name}
                  aria-pressed={accent === name}
                  onClick={() => form.setValue('accent', name)}
                  className={cn('size-7 rounded-full transition-transform', c.bg, accent === name ? 'scale-110 ring-2 ring-fg ring-offset-2 ring-offset-surface' : 'hover:scale-105')}
                />
              ))}
            </div>
          </fieldset>
        </div>
        {form.formState.errors.root && <p className="text-sm text-danger">{form.formState.errors.root.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Create and edit
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

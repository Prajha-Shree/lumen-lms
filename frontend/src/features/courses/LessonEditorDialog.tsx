import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2, UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button, Dialog, Field, Input, Markdown, Select, Textarea } from '@/components/ui';
import { http } from '@/lib/api';
import { cn } from '@/lib/cn';
import { courseKeys, type Attachment, type LessonDetail, type LessonSummary } from './api';

const schema = z.object({
  title: z.string().trim().min(2, 'At least 2 characters'),
  summary: z.string().trim().max(500),
  format: z.enum(['READING', 'VIDEO', 'INTERACTIVE']),
  durationMinutes: z.coerce.number<number>().int().min(1).max(600),
  difficulty: z.number().int().min(1).max(5),
  topics: z.string(),
  videoUrl: z.union([z.literal(''), z.url({ protocol: /^https$/, message: 'Must be an https:// URL' })]),
  content: z.string().max(100_000),
});
type Values = z.infer<typeof schema>;

const EMPTY: Values = { title: '', summary: '', format: 'READING', durationMinutes: 10, difficulty: 2, topics: '', videoUrl: '', content: '' };

/** Create (moduleId) or edit (lesson) a lesson. Attachments are available once it exists. */
export function LessonEditorDialog({
  open,
  onOpenChange,
  courseId,
  moduleId,
  lesson,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  courseId: string;
  moduleId?: string;
  lesson?: LessonSummary;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const detail = useQuery({
    queryKey: courseKeys.lesson(lesson?.id ?? 'new'),
    queryFn: () => http.get<LessonDetail>(`/api/lessons/${lesson!.id}`),
    enabled: open && !!lesson,
  });
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  useEffect(() => {
    if (!open) return;
    setTab('write');
    const l = detail.data?.lesson;
    form.reset(
      l
        ? {
            title: l.title,
            summary: l.summary,
            format: l.format,
            durationMinutes: l.durationMinutes,
            difficulty: l.difficulty,
            topics: l.topics.join(', '),
            videoUrl: l.videoUrl ?? '',
            content: l.content,
          }
        : EMPTY,
    );
  }, [open, detail.data, form]);

  const values = form.watch();

  const submit = form.handleSubmit(async (v) => {
    const payload = {
      ...v,
      topics: v.topics.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      videoUrl: v.videoUrl || null,
    };
    try {
      if (lesson) await http.patch(`/api/lessons/${lesson.id}`, payload);
      else await http.post(`/api/modules/${moduleId}/lessons`, payload);
      toast.success(lesson ? 'Lesson saved' : 'Lesson added');
      void qc.invalidateQueries({ queryKey: courseKeys.detail(courseId) });
      if (lesson) void qc.invalidateQueries({ queryKey: courseKeys.lesson(lesson.id) });
      onOpenChange(false);
    } catch (e) {
      form.setError('root', { message: e instanceof Error ? e.message : 'Failed to save' });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={lesson ? 'Edit lesson' : 'New lesson'} className="max-w-3xl">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" error={form.formState.errors.title?.message} className="sm:col-span-2">
            {(a) => <Input {...a} autoFocus {...form.register('title')} />}
          </Field>
          <Field label="Summary" hint="One line shown in the course outline." className="sm:col-span-2">
            {(a) => <Input {...a} {...form.register('summary')} />}
          </Field>
          <Field label="Format">
            {(a) => (
              <Select {...a} {...form.register('format')}>
                <option value="READING">Reading</option>
                <option value="VIDEO">Video</option>
                <option value="INTERACTIVE">Interactive</option>
              </Select>
            )}
          </Field>
          <Field label="Duration (minutes)" error={form.formState.errors.durationMinutes?.message}>
            {(a) => <Input {...a} type="number" min={1} max={600} {...form.register('durationMinutes')} />}
          </Field>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Difficulty</legend>
            <div className="flex gap-1" role="radiogroup" aria-label="Difficulty">
              {[1, 2, 3, 4, 5].map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={values.difficulty === d}
                  onClick={() => form.setValue('difficulty', d, { shouldDirty: true })}
                  className={cn(
                    'h-11 flex-1 rounded-xl border text-sm font-medium transition-colors',
                    values.difficulty === d ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:bg-surface-2',
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="Topics" hint="Comma-separated concept tags, e.g. statistics, probability. They drive recommendations.">
            {(a) => <Input {...a} {...form.register('topics')} />}
          </Field>
          {values.format === 'VIDEO' && (
            <Field label="Video URL" error={form.formState.errors.videoUrl?.message} className="sm:col-span-2">
              {(a) => <Input {...a} placeholder="https://…/lesson.mp4" {...form.register('videoUrl')} />}
            </Field>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Content (Markdown)</span>
            <div className="inline-flex rounded-lg border border-border p-0.5 text-xs" role="tablist">
              {(['write', 'preview'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={cn('rounded-md px-3 py-1 capitalize', tab === t ? 'bg-surface-2 font-medium' : 'text-fg-muted')}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {tab === 'write' ? (
            <Textarea rows={12} className="font-mono text-[13px]" aria-label="Lesson content" {...form.register('content')} />
          ) : (
            <div className="max-h-96 min-h-72 overflow-y-auto rounded-xl border border-border p-4">
              <Markdown>{values.content || '_Nothing to preview._'}</Markdown>
            </div>
          )}
        </div>

        {lesson && <Attachments lessonId={lesson.id} courseId={courseId} files={detail.data?.lesson.attachments ?? []} />}

        {form.formState.errors.root && <p className="text-sm text-danger">{form.formState.errors.root.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            {lesson ? 'Save lesson' : 'Add lesson'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Attachments({ lessonId, courseId, files }: { lessonId: string; courseId: string; files: Attachment[] }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: courseKeys.lesson(lessonId) });
    void qc.invalidateQueries({ queryKey: courseKeys.detail(courseId) });
  };

  const upload = async (file: File) => {
    const body = new FormData();
    body.append('file', file);
    setUploading(file.name);
    try {
      await http.post(`/api/lessons/${lessonId}/attachments`, body);
      toast.success(`Uploaded ${file.name}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  return (
    <div>
      <p className="mb-2 text-sm font-medium">Materials</p>
      {files.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
              <FileText className="size-4 text-primary" aria-hidden />
              <span className="flex-1 truncate">{f.fileName}</span>
              <button
                type="button"
                aria-label={`Remove ${f.fileName}`}
                className="rounded-lg p-1 text-fg-muted hover:bg-danger-soft hover:text-danger"
                onClick={() =>
                  void http
                    .delete(`/api/attachments/${f.id}`)
                    .then(refresh)
                    .catch((e: Error) => toast.error(e.message))
                }
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) void upload(f);
        }}
        className={cn(
          'flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-sm transition-colors',
          dragging ? 'border-primary bg-primary-soft' : 'border-border text-fg-muted hover:border-fg-muted/50',
        )}
      >
        <UploadCloud className={cn('size-6', uploading && 'animate-bounce')} aria-hidden />
        {uploading ? `Uploading ${uploading}…` : 'Drop a file or click to upload (PDF, Office, images, text · max 20 MB)'}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

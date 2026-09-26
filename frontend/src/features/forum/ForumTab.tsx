import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, MessageSquare, MessageSquarePlus, Pin, Send } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Avatar, Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, Skeleton, Textarea } from '@/components/ui';
import { timeAgo } from '@/features/admin/UsersPage';
import { useSession } from '@/features/auth/AuthProvider';
import { http } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Role } from '@/lib/types';

type Author = { id: string; name: string; role: Role };
type Thread = { id: string; title: string; body: string; pinned: boolean; resolved: boolean; createdAt: string; lastActivityAt: string; author: Author; _count: { posts: number } };
type Post = { id: string; body: string; isAnswer: boolean; createdAt: string; author: Author };

const StaffTag = ({ role }: { role: Role }) => (role === 'STUDENT' ? null : <Badge tone="primary">{role === 'INSTRUCTOR' ? 'Instructor' : 'Staff'}</Badge>);

export function ForumTab({ courseId }: { courseId: string }) {
  const [params, setParams] = useSearchParams();
  const threadId = params.get('thread');
  const open = (id: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id) next.set('thread', id);
        else next.delete('thread');
        return next;
      },
      { replace: true },
    );
  return threadId ? <ThreadView threadId={threadId} onBack={() => open(null)} /> : <ThreadList courseId={courseId} onOpen={open} />;
}

function ThreadList({ courseId, onOpen }: { courseId: string; onOpen: (id: string) => void }) {
  const [creating, setCreating] = useState(false);
  const threads = useQuery({ queryKey: ['threads', courseId], queryFn: () => http.get<{ threads: Thread[] }>(`/api/courses/${courseId}/threads`).then((r) => r.threads) });

  if (threads.isError) return <ErrorState error={threads.error} onRetry={() => void threads.refetch()} />;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-fg-muted">Ask questions, help classmates, and mark the reply that solved it.</p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <MessageSquarePlus className="size-4" aria-hidden /> New thread
        </Button>
      </div>
      {threads.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : threads.data.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No discussions yet" description="Start the first thread." />
      ) : (
        <ul className="space-y-2">
          {threads.data.map((t, i) => (
            <motion.li key={t.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <button onClick={() => onOpen(t.id)} className="flex w-full items-start gap-3 rounded-2xl border border-border bg-surface p-4 text-left shadow-card transition-shadow hover:shadow-pop">
                <Avatar name={t.author.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {t.pinned && <Pin className="size-3.5 text-primary" aria-label="Pinned" />}
                    <span className="font-medium">{t.title}</span>
                    {t.resolved && (
                      <Badge tone="success">
                        <CheckCircle2 className="size-3" aria-hidden /> Answered
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-sm text-fg-muted">{t.body}</p>
                  <p className="mt-1 text-xs text-fg-muted">
                    {t.author.name} · {t._count.posts} {t._count.posts === 1 ? 'reply' : 'replies'} · active {timeAgo(t.lastActivityAt)}
                  </p>
                </div>
              </button>
            </motion.li>
          ))}
        </ul>
      )}
      <NewThreadDialog courseId={courseId} open={creating} onOpenChange={setCreating} onCreated={onOpen} />
    </div>
  );
}

const threadSchema = z.object({ title: z.string().trim().min(5, 'At least 5 characters'), body: z.string().trim().min(1, 'Add some details') });

function NewThreadDialog({ courseId, open, onOpenChange, onCreated }: { courseId: string; open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const form = useForm({ resolver: zodResolver(threadSchema), defaultValues: { title: '', body: '' } });
  const submit = form.handleSubmit(async (v) => {
    try {
      const { thread } = await http.post<{ thread: Thread }>(`/api/courses/${courseId}/threads`, v);
      void qc.invalidateQueries({ queryKey: ['threads', courseId] });
      form.reset();
      onOpenChange(false);
      onCreated(thread.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Start a discussion">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Title" error={form.formState.errors.title?.message}>
          {(a) => <Input {...a} autoFocus placeholder="What’s your question?" {...form.register('title')} />}
        </Field>
        <Field label="Details" error={form.formState.errors.body?.message}>
          {(a) => <Textarea {...a} rows={5} {...form.register('body')} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Post
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type ThreadData = { thread: Thread; posts: Post[]; canModerate: boolean; canAccept: boolean };

function ThreadView({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { user } = useSession();
  const key = ['thread', threadId];
  const q = useQuery({ queryKey: key, queryFn: () => http.get<ThreadData>(`/api/threads/${threadId}`) });
  const [reply, setReply] = useState('');

  // Optimistic reply: appears instantly, reconciled with the server response.
  const post = useMutation({
    mutationFn: (body: string) => http.post<{ post: Post }>(`/api/threads/${threadId}/posts`, { body }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ThreadData>(key);
      qc.setQueryData<ThreadData>(key, (d) => d && { ...d, posts: [...d.posts, { id: `temp-${Date.now()}`, body, isAnswer: false, createdAt: new Date().toISOString(), author: { id: user.id, name: user.name, role: user.role } }] });
      setReply('');
      return { prev, body };
    },
    onError: (e, _b, ctx) => {
      qc.setQueryData(key, ctx?.prev);
      setReply(ctx?.body ?? '');
      toast.error(e instanceof Error ? e.message : 'Failed to post');
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-96" />;
  const { thread, posts, canModerate, canAccept } = q.data;

  return (
    <div className="max-w-3xl">
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> All discussions
      </button>
      <Card className="mb-4 p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{thread.title}</h2>
          {thread.resolved && <Badge tone="success">Answered</Badge>}
          {thread.pinned && <Badge tone="primary">Pinned</Badge>}
        </div>
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Avatar name={thread.author.name} size="sm" /> {thread.author.name} <StaffTag role={thread.author.role} /> · {timeAgo(thread.createdAt)}
        </div>
        <p className="mt-4 whitespace-pre-wrap">{thread.body}</p>
        {(canModerate || canAccept) && (
          <div className="mt-4 flex gap-2">
            {canModerate && (
              <Button size="sm" variant="ghost" onClick={() => void act(() => http.patch(`/api/threads/${threadId}`, { pinned: !thread.pinned }), thread.pinned ? 'Unpinned' : 'Pinned')}>
                <Pin className="size-3.5" aria-hidden /> {thread.pinned ? 'Unpin' : 'Pin'}
              </Button>
            )}
            {canAccept && (
              <Button size="sm" variant="ghost" onClick={() => void act(() => http.patch(`/api/threads/${threadId}`, { resolved: !thread.resolved }), thread.resolved ? 'Reopened' : 'Marked resolved')}>
                <CheckCircle2 className="size-3.5" aria-hidden /> {thread.resolved ? 'Reopen' : 'Mark resolved'}
              </Button>
            )}
          </div>
        )}
      </Card>

      <ol className="space-y-3" aria-label="Replies">
        {posts.map((p) => (
          <li key={p.id}>
            <Card className={cn('p-4', p.isAnswer && 'border-success/50 bg-success-soft/40', p.id.startsWith('temp-') && 'opacity-60')}>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <Avatar name={p.author.name} size="sm" />
                <span className="font-medium">{p.author.name}</span>
                <StaffTag role={p.author.role} />
                <span className="text-fg-muted">· {timeAgo(p.createdAt)}</span>
                {p.isAnswer && (
                  <Badge tone="success" className="ml-auto">
                    <CheckCircle2 className="size-3" aria-hidden /> Accepted answer
                  </Badge>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{p.body}</p>
              {canAccept && !p.isAnswer && !p.id.startsWith('temp-') && p.author.id !== thread.author.id && (
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => void act(() => http.post(`/api/posts/${p.id}/accept`), 'Marked as the answer')}>
                  Accept as answer
                </Button>
              )}
            </Card>
          </li>
        ))}
      </ol>

      <form
        className="mt-4 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (reply.trim()) post.mutate(reply.trim());
        }}
      >
        <Textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" aria-label="Reply" className="flex-1" />
        <Button type="submit" disabled={!reply.trim()} aria-label="Send reply">
          <Send className="size-4" aria-hidden />
        </Button>
      </form>
    </div>
  );
}

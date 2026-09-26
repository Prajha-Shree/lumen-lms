import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui';
import { timeAgo } from '@/features/admin/UsersPage';
import { http } from '@/lib/api';
import { cn } from '@/lib/cn';

type Notification = { id: string; type: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };
type Data = { items: Notification[]; unread: number };

const KEY = ['notifications'];

/** Live notifications (pushed via Socket.IO → cache invalidation, see RealtimeProvider). */
export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: KEY, queryFn: () => http.get<Data>('/api/notifications'), refetchInterval: 120_000 });

  // Optimistic read-state updates.
  const markRead = useMutation({
    mutationFn: (id: string) => http.post(`/api/notifications/${id}/read`),
    onMutate: (id) => {
      qc.setQueryData<Data>(KEY, (d) => d && { unread: Math.max(0, d.unread - (d.items.find((n) => n.id === id && !n.readAt) ? 1 : 0)), items: d.items.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)) });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
  const markAll = useMutation({
    mutationFn: () => http.post('/api/notifications/read-all'),
    onMutate: () => qc.setQueryData<Data>(KEY, (d) => d && { unread: 0, items: d.items.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) }),
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });

  const unread = q.data?.unread ?? 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} className="relative">
          <Bell className="size-5" />
          <AnimatePresence>
            {unread > 0 && (
              <motion.span
                key={unread}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white"
                aria-hidden
              >
                {unread > 9 ? '9+' : unread}
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-semibold">Notifications</h2>
            {unread > 0 && (
              <button onClick={() => markAll.mutate()} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <CheckCheck className="size-3.5" aria-hidden /> Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto py-1">
            {!q.data?.items.length && <li className="px-4 py-10 text-center text-sm text-fg-muted">You’re all caught up.</li>}
            {q.data?.items.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => {
                    if (!n.readAt) markRead.mutate(n.id);
                    setOpen(false);
                    if (n.link) navigate(n.link);
                  }}
                  className={cn('flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2', !n.readAt && 'bg-primary-soft/40')}
                >
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm', !n.readAt && 'font-medium')}>{n.title}</span>
                    {n.body && <span className="block truncate text-xs text-fg-muted">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-fg-muted">{timeAgo(n.createdAt)}</span>
                  </span>
                  {!n.readAt && <span className="sr-only">(unread)</span>}
                </button>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

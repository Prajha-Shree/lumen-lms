import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/AuthProvider';
import { getAccessToken, refreshSession } from '@/lib/api';

const RealtimeContext = createContext<{ connected: boolean }>({ connected: false });

/**
 * One Socket.IO connection per signed-in user. Server pushes are hints: they
 * invalidate React Query caches so the affected charts refetch, which keeps the
 * server as the single source of truth.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user) return;
    const socket: Socket = io({
      path: '/socket.io',
      // Function form: every (re)connect uses the freshest access token.
      auth: (cb) => cb({ token: getAccessToken() }),
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', async (err) => {
      if (err.message === 'unauthorized') await refreshSession();
    });

    socket.on('analytics:changed', () => {
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['course-insights'] });
    });
    socket.on('progress:changed', () => {
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['badges'] });
    });
    socket.on('review:pending', (p: { studentName: string }) => {
      void qc.invalidateQueries({ queryKey: ['reviews'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.info('New proctoring review', { description: `${p.studentName}’s attempt has signals to look at.` });
    });
    socket.on('notification', (n: { title: string; body: string }) => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      toast(n.title, { description: n.body });
    });

    return () => {
      socket.disconnect();
      setConnected(false);
    };
  }, [user?.id, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  return <RealtimeContext.Provider value={{ connected }}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);

/** Small "Live" indicator for dashboards. */
export function LiveBadge() {
  const { connected } = useRealtime();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-fg-muted" title={connected ? 'Updates in real time' : 'Reconnecting…'}>
      <span className="relative inline-flex size-2">
        {connected && <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60" />}
        <span className={`relative inline-flex size-2 rounded-full ${connected ? 'bg-success' : 'bg-fg-muted'}`} />
      </span>
      {connected ? 'Live' : 'Offline'}
    </span>
  );
}

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { http, refreshSession, setAccessToken, setOnSessionEnded } from '@/lib/api';
import type { Role, Session, Tenant, User } from '@/lib/types';

type Status = 'loading' | 'authenticated' | 'anonymous';

type AuthContextValue = {
  status: Status;
  user: User | null;
  tenant: Tenant | null;
  login: (input: { tenantSlug: string; email: string; password: string }) => Promise<void>;
  registerInstitution: (input: { institutionName: string; slug: string; adminName: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (updater: (u: User) => User) => void;
  /** Re-reads the user from the server (e.g. after XP-earning actions). Idempotent. */
  refreshUser: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const LAST_TENANT_KEY = 'lastTenantSlug';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUserState] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const applySession = useCallback((s: Session) => {
    setAccessToken(s.accessToken);
    setUserState(s.user);
    setTenant(s.tenant);
    setStatus('authenticated');
    try {
      localStorage.setItem(LAST_TENANT_KEY, s.tenant.slug);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUserState(null);
    setTenant(null);
    setStatus('anonymous');
    queryClient.clear();
    // Offline course cache is per device, not per user: drop it on sign-out.
    if ('caches' in window) void caches.delete('lms-course-content').catch(() => undefined);
  }, [queryClient]);

  // Restore a session from the refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    void refreshSession().then((s) => {
      if (cancelled) return;
      if (s) applySession(s);
      else setStatus('anonymous');
    });
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  useEffect(() => {
    setOnSessionEnded(() => {
      clear();
      toast.info('Your session ended. Please sign in again.');
    });
  }, [clear]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      tenant,
      login: async (input) => applySession(await http.post<Session>('/api/auth/login', input)),
      registerInstitution: async (input) => applySession(await http.post<Session>('/api/auth/register-institution', input)),
      logout: async () => {
        await http.post('/api/auth/logout').catch(() => undefined);
        clear();
      },
      setUser: (updater) => setUserState((u) => (u ? updater(u) : u)),
      refreshUser: async () => {
        const me = await http.get<{ user: User }>('/api/auth/me').catch(() => null);
        if (me) setUserState(me.user);
      },
      hasRole: (...roles) => !!user && roles.includes(user.role),
    }),
    [status, user, tenant, applySession, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** For components that only render when signed in. */
export function useSession() {
  const { user, tenant, ...rest } = useAuth();
  if (!user || !tenant) throw new Error('useSession used outside an authenticated route');
  return { user, tenant, ...rest };
}

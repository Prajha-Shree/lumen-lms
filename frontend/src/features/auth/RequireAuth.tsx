import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Skeleton } from '@/components/ui';
import type { Role } from '@/lib/types';
import { useAuth } from './AuthProvider';

/** Gate for authenticated areas; optionally restricted to roles. */
export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageSkeleton />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function FullPageSkeleton() {
  return (
    <div className="flex min-h-dvh" aria-busy="true" aria-label="Loading">
      <div className="hidden w-64 border-r border-border p-4 lg:block">
        <Skeleton className="mb-8 h-8 w-32" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="mb-3 h-9 w-full" />
        ))}
      </div>
      <div className="flex-1 p-6 lg:p-10">
        <Skeleton className="mb-3 h-9 w-64" />
        <Skeleton className="mb-8 h-5 w-96 max-w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    </div>
  );
}

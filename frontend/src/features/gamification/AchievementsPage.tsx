import { useQuery } from '@tanstack/react-query';
import { Flame, Lock, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { ErrorState, PageHeader, Skeleton, Stat } from '@/components/ui';
import { useSession } from '@/features/auth/AuthProvider';
import { http } from '@/lib/api';
import { cn } from '@/lib/cn';
import { badgeMeta } from './badges';

type BadgeRow = { key: string; name: string; earned: boolean; awardedAt: string | null };

export function AchievementsPage() {
  const { user } = useSession();
  const badges = useQuery({ queryKey: ['badges'], queryFn: () => http.get<{ badges: BadgeRow[] }>('/api/badges/me').then((r) => r.badges) });
  const dash = useQuery({
    queryKey: ['dashboard', 'student'],
    queryFn: () => http.get<{ streak: { current: number; longest: number } }>(`/api/dashboard/student?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`),
  });

  if (badges.isError) return <ErrorState error={badges.error} onRetry={() => void badges.refetch()} />;
  const earned = badges.data?.filter((b) => b.earned).length ?? 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Achievements" description="Badges for building good learning habits. Just for you; there’s no public leaderboard." />
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Stat label="Experience" value={`${user.xp.toLocaleString()} XP`} icon={<Sparkles className="size-4" />} />
        <Stat label="Current streak" value={dash.data ? `${dash.data.streak.current} days` : '—'} icon={<Flame className="size-4" />} hint={dash.data ? `Best: ${dash.data.streak.longest} days` : undefined} />
        <Stat label="Badges" value={badges.data ? `${earned} / ${badges.data.length}` : '—'} />
      </div>

      {badges.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {badges.data.map((b, i) => {
            const m = badgeMeta(b.key);
            return (
              <motion.li
                key={b.key}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.04 }}
                className={cn('relative flex items-center gap-4 rounded-2xl border p-5', b.earned ? 'border-warning/40 bg-gradient-to-br from-warning-soft to-surface shadow-card' : 'border-border bg-surface')}
              >
                <span className={cn('grid size-14 shrink-0 place-items-center rounded-2xl', b.earned ? 'bg-warning text-white' : 'bg-surface-2 text-fg-muted')}>
                  {b.earned ? <m.icon className="size-7" aria-hidden /> : <Lock className="size-6" aria-hidden />}
                </span>
                <div>
                  <p className="font-semibold">{m.name}</p>
                  <p className="text-sm text-fg-muted">{m.description}</p>
                  <p className="mt-1 text-xs text-fg-muted">
                    {b.earned ? `Earned ${new Date(b.awardedAt!).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : 'Locked'}
                  </p>
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

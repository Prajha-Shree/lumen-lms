import { LogOut, Menu as MenuIcon, Settings, Sparkles, WifiOff, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog as D } from 'radix-ui';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Avatar, Button, Menu, MenuItem, MenuLabel, MenuSeparator, Skeleton, ThemeToggle } from '@/components/ui';
import { useSession } from '@/features/auth/AuthProvider';
import { useOnline } from '@/hooks/useOnline';
import { cn } from '@/lib/cn';
import { ROLE_LABEL } from '@/lib/types';
import { navFor } from './nav';
import { NotificationBell } from './NotificationBell';

export function AppShell() {
  const { user, tenant } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-pop"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-border bg-surface lg:block">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      <D.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <AnimatePresence>
          {mobileOpen && (
            <D.Portal forceMount>
              <D.Overlay asChild forceMount>
                <motion.div className="fixed inset-0 z-50 bg-black/40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
              </D.Overlay>
              <D.Content asChild forceMount>
                <motion.aside
                  className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-surface shadow-pop lg:hidden"
                  initial={{ x: '-100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '-100%' }}
                  transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
                >
                  <D.Title className="sr-only">Navigation</D.Title>
                  <D.Description className="sr-only">Main navigation</D.Description>
                  <D.Close className="absolute right-3 top-4 rounded-lg p-2 text-fg-muted hover:bg-surface-2" aria-label="Close navigation">
                    <X className="size-5" />
                  </D.Close>
                  <Sidebar />
                </motion.aside>
              </D.Content>
            </D.Portal>
          )}
        </AnimatePresence>
      </D.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <MenuIcon className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{tenant.name}</p>
            <p className="truncate text-xs text-fg-muted">{ROLE_LABEL[user.role]}</p>
          </div>
          {user.role === 'STUDENT' && (
            <span className="hidden items-center gap-1 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning sm:inline-flex" title="Experience points">
              <Sparkles className="size-3.5" aria-hidden /> {user.xp.toLocaleString()} XP
            </span>
          )}
          <NotificationBell />
          <ThemeToggle />
          <UserMenu />
        </header>

        <OfflineBanner />
        <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <RouteTransition>
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </RouteTransition>
        </main>
      </div>
    </div>
  );
}

function Sidebar() {
  const { user } = useSession();
  return (
    <nav className="flex h-full flex-col p-4" aria-label="Main">
      <div className="mb-8 flex items-center gap-2.5 px-2 pt-1">
        <img src="/favicon.svg" alt="" className="size-8" />
        <span className="text-lg font-semibold tracking-tight">Lumen LMS</span>
      </div>
      <ul className="space-y-1">
        {navFor(user.role).map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-primary-soft" transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }} />
                  )}
                  <item.icon className="relative size-[1.125rem]" aria-hidden />
                  <span className="relative">{item.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function UserMenu() {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  return (
    <Menu
      trigger={
        <button className="rounded-full ring-offset-2 ring-offset-bg transition hover:ring-2 hover:ring-border" aria-label="Account menu">
          <Avatar name={user.name} />
        </button>
      }
    >
      <MenuLabel>
        <p className="text-sm font-medium">{user.name}</p>
        <p className="text-xs text-fg-muted">{user.email}</p>
      </MenuLabel>
      <MenuSeparator />
      <MenuItem icon={<Settings className="size-4" />} onSelect={() => navigate('/settings')}>
        Settings
      </MenuItem>
      <MenuItem
        danger
        icon={<LogOut className="size-4" />}
        onSelect={() => {
          void logout().then(() => navigate('/login'));
        }}
      >
        Sign out
      </MenuItem>
    </Menu>
  );
}

function RouteTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <motion.div key={pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
      {children}
    </motion.div>
  );
}

function OfflineBanner() {
  const online = useOnline();
  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          role="status"
          className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-sm text-warning"
        >
          <WifiOff className="size-4" aria-hidden /> You’re offline. Lessons you’ve opened before are still available.
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading page">
      <Skeleton className="mb-3 h-9 w-64" />
      <Skeleton className="mb-8 h-5 w-96 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
    </div>
  );
}

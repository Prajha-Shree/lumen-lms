import { Route, Routes } from 'react-router';
import { ThemeToggle } from '@/components/ui';
import { SystemStatusPage } from '@/features/system/SystemStatusPage';

export function App() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="text-lg font-semibold tracking-tight">Lumen LMS</span>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="flex-1">
        <Routes>
          <Route path="/" element={<SystemStatusPage />} />
        </Routes>
      </main>
    </div>
  );
}

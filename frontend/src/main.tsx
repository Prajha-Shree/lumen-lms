import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { toast, Toaster } from 'sonner';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { AuthProvider } from './features/auth/AuthProvider';
import { ApiError } from './lib/api';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Don't retry client errors (403/404...); retry transient failures once.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
    },
  },
});

// PWA: install support + offline course content. A new deploy asks before reloading,
// so nobody loses an in-progress exam or assessment answer.
const updateSW = registerSW({
  onNeedRefresh() {
    toast('A new version is available', { duration: Infinity, action: { label: 'Reload', onClick: () => void updateSW(true) } });
  },
  onOfflineReady() {
    toast.success('Ready to work offline', { description: 'Lessons you open are saved for offline reading.' });
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Respect the OS "reduce motion" setting across every animation. */}
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
        <Toaster richColors closeButton position="bottom-right" theme="system" />
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);

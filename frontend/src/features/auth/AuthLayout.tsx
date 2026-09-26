import { BrainCircuit, ChartNoAxesColumn, ShieldCheck, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/ui';

const features = [
  { icon: BrainCircuit, title: 'Adaptive paths', body: 'A short learning profile tunes what each student sees next.' },
  { icon: ShieldCheck, title: 'Privacy-first proctoring', body: 'Frames are analyzed in memory and discarded. Only review signals are kept.' },
  { icon: ChartNoAxesColumn, title: 'Live insight', body: 'Spot students who need help before they fall behind.' },
];

/** Split-screen shell for sign-in and onboarding. The brand panel hides on small screens. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[oklch(0.28_0.09_277)] p-12 text-white lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 size-[28rem] rounded-full bg-[oklch(0.55_0.2_277)] opacity-40 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 size-[26rem] rounded-full bg-[oklch(0.62_0.16_200)] opacity-30 blur-3xl"
        />
        <div className="relative flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-9" />
          <span className="text-xl font-semibold tracking-tight">Lumen LMS</span>
        </div>
        <div className="relative mt-auto max-w-md">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium">
            <Sparkles className="size-3.5" aria-hidden /> Learning that adapts to the learner
          </p>
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">One platform for every institution you serve.</h2>
          <ul className="mt-10 space-y-6">
            {features.map((f, i) => (
              <motion.li
                key={f.title}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.1 }}
                className="flex gap-4"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10">
                  <f.icon className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block font-medium">{f.title}</span>
                  <span className="text-sm text-white/70">{f.body}</span>
                </span>
              </motion.li>
            ))}
          </ul>
        </div>
      </aside>
      <main className="relative flex flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 lg:invisible">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="font-semibold tracking-tight">Lumen LMS</span>
          </div>
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}

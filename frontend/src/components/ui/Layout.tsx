import { Check } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1">
        {eyebrow}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="max-w-2xl text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Horizontal step indicator for guided flows (onboarding, assessment, exam check-in). */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={active ? 'step' : undefined}>
            <motion.span
              animate={{ scale: active ? 1.08 : 1 }}
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold transition-colors',
                done && 'border-primary bg-primary text-primary-fg',
                active && 'border-primary bg-primary-soft text-primary',
                !done && !active && 'border-border text-fg-muted',
              )}
            >
              {done ? <Check className="size-4" aria-hidden /> : i + 1}
            </motion.span>
            <span className={cn('hidden text-sm sm:inline', active ? 'font-medium text-fg' : 'text-fg-muted')}>{label}</span>
            {i < steps.length - 1 && (
              <span className="relative h-0.5 flex-1 overflow-hidden rounded bg-border" aria-hidden>
                <motion.span className="absolute inset-y-0 left-0 bg-primary" initial={false} animate={{ width: done ? '100%' : '0%' }} />
              </span>
            )}
            <span className="sr-only">{done ? '(completed)' : active ? '(current)' : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ProgressBar({ value, className, label }: { value: number; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn('h-2 overflow-hidden rounded-full bg-surface-2', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ type: 'spring', bounce: 0, duration: 0.8 }} />
    </div>
  );
}

export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between text-sm text-fg-muted">
        {label}
        {icon}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-fg-muted">{hint}</div>}
    </div>
  );
}

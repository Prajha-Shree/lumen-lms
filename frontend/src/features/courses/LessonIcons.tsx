import { BookText, Circle, CircleCheck, CircleDot, MousePointerClick, PlayCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { LessonFormat, ProgressStatus } from './api';

export function FormatIcon({ format, className }: { format: LessonFormat; className?: string }) {
  const Icon = format === 'VIDEO' ? PlayCircle : format === 'INTERACTIVE' ? MousePointerClick : BookText;
  return <Icon className={cn('size-4', className)} aria-hidden />;
}

export function StatusIcon({ status }: { status?: ProgressStatus }) {
  if (status === 'COMPLETED') return <CircleCheck className="size-5 text-success" aria-label="Completed" />;
  if (status === 'IN_PROGRESS') return <CircleDot className="size-5 text-primary" aria-label="In progress" />;
  return <Circle className="size-5 text-border" aria-label="Not started" />;
}

/** 1–5 difficulty as filled dots, with an accessible text equivalent. */
export function Difficulty({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`Difficulty ${value} of 5`}>
      <span className="sr-only">Difficulty {value} of 5</span>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} aria-hidden className={cn('size-1.5 rounded-full', i <= value ? 'bg-fg-muted' : 'bg-border')} />
      ))}
    </span>
  );
}

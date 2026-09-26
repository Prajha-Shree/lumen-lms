import { cn } from '@/lib/cn';

const colors = { up: 'bg-success', down: 'bg-danger', unknown: 'bg-fg-muted' } as const;

export function StatusDot({ status, className }: { status: keyof typeof colors; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2.5', className)} aria-hidden>
      {status === 'up' && <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-50" />}
      <span className={cn('relative inline-flex size-2.5 rounded-full', colors[status])} />
    </span>
  );
}

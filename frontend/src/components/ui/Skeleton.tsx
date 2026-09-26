import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Shimmering placeholder that mirrors the shape of content still loading. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer rounded-lg bg-[length:200%_100%]',
        'bg-linear-to-r from-surface-2 via-border/60 to-surface-2',
        className,
      )}
      {...props}
    />
  );
}

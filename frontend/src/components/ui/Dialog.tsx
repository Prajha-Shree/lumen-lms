import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog as D } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Accessible modal (focus trap, Esc to close, labelled) with a spring entrance. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <D.Portal forceMount>
            <D.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </D.Overlay>
            <D.Content asChild forceMount>
              <motion.div
                className={cn(
                  'fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto',
                  'rounded-2xl border border-border bg-surface p-6 shadow-pop focus:outline-none',
                  className,
                )}
                initial={{ opacity: 0, scale: 0.96, x: '-50%', y: '-46%' }}
                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                exit={{ opacity: 0, scale: 0.96, x: '-50%', y: '-46%' }}
                transition={{ type: 'spring', duration: 0.3, bounce: 0.15 }}
              >
                <div className="mb-4 pr-8">
                  <D.Title className="text-lg font-semibold tracking-tight">{title}</D.Title>
                  {description ? (
                    <D.Description className="mt-1 text-sm text-fg-muted">{description}</D.Description>
                  ) : (
                    <D.Description className="sr-only">{title}</D.Description>
                  )}
                </div>
                {children}
                {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
                <D.Close
                  className="absolute right-4 top-4 rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </D.Close>
              </motion.div>
            </D.Content>
          </D.Portal>
        )}
      </AnimatePresence>
    </D.Root>
  );
}

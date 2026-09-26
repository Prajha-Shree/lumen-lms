import { Monitor, Moon, Sun } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTheme } from '@/hooks/useTheme';
import { Button } from './Button';

const icons = { light: Sun, dark: Moon, system: Monitor } as const;

export function ThemeToggle() {
  const { pref, cycle } = useTheme();
  const Icon = icons[pref];
  return (
    <Button variant="ghost" size="icon" onClick={cycle} aria-label={`Theme: ${pref}. Click to change.`} title={`Theme: ${pref}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={pref}
          initial={{ rotate: -90, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          exit={{ rotate: 90, opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <Icon className="size-5" aria-hidden />
        </motion.span>
      </AnimatePresence>
    </Button>
  );
}

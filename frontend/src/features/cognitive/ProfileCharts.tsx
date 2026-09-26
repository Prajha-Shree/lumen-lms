import { motion } from 'motion/react';
import { MODALITY_LABEL, topicLabel, type Profile } from './api';

/**
 * Per-topic mastery as a sorted bar list. One series → one color (slot 1). Values are
 * direct-labeled, so the list doubles as its own table view (no tooltip-only data).
 */
export function MasteryBars({ mastery, highlight = [] }: { mastery: Record<string, number>; highlight?: string[] }) {
  const rows = Object.entries(mastery).sort((a, b) => b[1] - a[1]);
  return (
    <ul className="space-y-3" aria-label="Topic mastery">
      {rows.map(([topic, value], i) => (
        <li key={topic} className="grid grid-cols-[8.5rem_1fr_2.75rem] items-center gap-3 text-sm">
          <span className="truncate text-fg">{topicLabel(topic)}</span>
          <span className="relative h-2.5 rounded-full bg-surface-2" aria-hidden>
            <motion.span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ background: 'var(--series-1)', opacity: highlight.length && !highlight.includes(topic) ? 0.45 : 1 }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(3, value * 100)}%` }}
              transition={{ delay: 0.1 + i * 0.05, type: 'spring', bounce: 0, duration: 0.7 }}
            />
          </span>
          <span className="text-right tabular-nums text-fg-muted">{Math.round(value * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

const MODALITY_SLOTS = { reading: 'var(--series-1)', video: 'var(--series-2)', interactive: 'var(--series-3)' } as const;

/** Part-to-whole of three preferences: one 100% bar with 2px surface gaps + legend. */
export function ModalityBar({ modality }: { modality: Profile['modality'] }) {
  const entries = (Object.keys(MODALITY_SLOTS) as (keyof typeof MODALITY_SLOTS)[]).map((k) => [k, modality[k] ?? 0] as const);
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={entries.map(([k, v]) => `${MODALITY_LABEL[k]} ${Math.round(v * 100)}%`).join(', ')}>
        {entries
          .filter(([, v]) => v > 0)
          .map(([k, v]) => (
            <motion.span key={k} style={{ background: MODALITY_SLOTS[k] }} initial={{ flexGrow: 0 }} animate={{ flexGrow: v }} transition={{ duration: 0.8 }} className="h-full min-w-1" />
          ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {entries.map(([k, v]) => (
          <li key={k} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: MODALITY_SLOTS[k] }} aria-hidden />
            <span>{MODALITY_LABEL[k]}</span>
            <span className="tabular-nums text-fg-muted">{Math.round(v * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 0..1 meter with labeled ends. */
export function Meter({ value, low, high }: { value: number; low: string; high: string }) {
  return (
    <div>
      <div className="relative h-2.5 rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
        <motion.span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: 'var(--series-1)' }}
          initial={{ width: 0 }}
          animate={{ width: `${value * 100}%` }}
          transition={{ duration: 0.8 }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-fg-muted">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

/**
 * Calibration on a diverging scale: neutral gray midpoint (well calibrated), red arm
 * for over-confidence, blue arm for under-confidence. The label carries the meaning,
 * so color is never the only cue.
 */
export function CalibrationMeter({ value }: { value: number }) {
  const v = Math.max(-1, Math.min(1, value));
  const label = v > 0.15 ? 'Tends to under-estimate' : v < -0.15 ? 'Tends to over-estimate' : 'Well calibrated';
  const width = Math.abs(v) * 50;
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      <div className="relative h-2.5 rounded-full" style={{ background: 'var(--diverge-mid)' }} role="meter" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-valuetext={label}>
        <span className="absolute inset-y-[-3px] left-1/2 w-0.5 -translate-x-1/2 rounded bg-fg-muted" aria-hidden />
        <motion.span
          className="absolute inset-y-0 rounded-full"
          style={{ background: v < 0 ? 'var(--diverge-neg)' : 'var(--diverge-pos)', [v < 0 ? 'right' : 'left']: '50%' }}
          initial={{ width: 0 }}
          animate={{ width: `${width}%` }}
          transition={{ duration: 0.8 }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-fg-muted">
        <span>Over-confident</span>
        <span>Under-confident</span>
      </div>
    </div>
  );
}

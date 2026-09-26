import { Tooltip } from 'radix-ui';
import { useMemo } from 'react';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// One-hue sequential ramp (light→dark); dark mode steps are defined in index.css.
const RAMP = ['var(--surface-2)', 'var(--seq-100)', 'var(--seq-250)', 'var(--seq-400)', 'var(--seq-550)', 'var(--seq-700)'];

export type HeatCell = { dow: number; hour: number; n: number };

/** Weekday × hour engagement grid in the viewer's local time. */
export function Heatmap({ cells }: { cells: HeatCell[] }) {
  const { grid, max } = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    let m = 0;
    for (const c of cells) {
      g[c.dow - 1]![c.hour] = c.n;
      m = Math.max(m, c.n);
    }
    return { grid: g, max: m };
  }, [cells]);

  const step = (n: number) => (n === 0 || max === 0 ? 0 : Math.min(5, Math.ceil((n / max) * 5)));
  const hourLabel = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);

  return (
    <Tooltip.Provider delayDuration={80}>
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          <div className="grid grid-cols-[2.25rem_repeat(24,minmax(0,1fr))] gap-[2px]" role="grid" aria-label="Activity by weekday and hour">
            {grid.map((row, d) => (
              <div key={d} role="row" className="contents">
                <span role="rowheader" className="pr-1 text-right text-[11px] leading-5" style={{ color: 'var(--chart-axis)' }}>
                  {DAYS[d]}
                </span>
                {row.map((n, h) => (
                  <Tooltip.Root key={h}>
                    <Tooltip.Trigger asChild>
                      <span
                        role="gridcell"
                        tabIndex={n ? 0 : -1}
                        aria-label={`${DAYS[d]} ${hourLabel(h)}: ${n} activities`}
                        className="h-5 rounded-[3px] outline-offset-1 focus-visible:outline-2 focus-visible:outline-fg"
                        style={{ background: RAMP[step(n)] }}
                      />
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content sideOffset={4} className="z-50 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-pop">
                        <span className="font-medium text-fg">
                          {DAYS[d]} {hourLabel(h)}
                        </span>
                        <span className="text-fg-muted"> · {n} activities</span>
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-[2.25rem_repeat(24,minmax(0,1fr))] gap-[2px] text-[10px]" style={{ color: 'var(--chart-axis)' }} aria-hidden>
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center">
                {h % 3 === 0 ? hourLabel(h) : ''}
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px]" style={{ color: 'var(--chart-axis)' }}>
            Less
            {RAMP.map((c, i) => (
              <span key={i} className="size-3 rounded-[3px]" style={{ background: c }} aria-hidden />
            ))}
            More
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  );
}

export function heatmapTable(cells: HeatCell[]) {
  return {
    columns: ['Day', 'Hour', 'Activities'],
    rows: [...cells].sort((a, b) => a.dow - b.dow || a.hour - b.hour).map((c) => [DAYS[c.dow - 1]!, `${c.hour}:00`, c.n]),
  };
}

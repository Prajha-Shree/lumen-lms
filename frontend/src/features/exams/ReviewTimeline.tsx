import { Tooltip } from 'radix-ui';
import { useMemo } from 'react';
import { EVENT_META, formatDuration, type EventType } from './api';

export type TimelineEvent = {
  id: string;
  type: EventType;
  source: 'CAMERA' | 'BROWSER';
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  confidence: number | null;
  label: string;
};

const LANES: EventType[] = ['NO_FACE', 'LOOKING_AWAY', 'MULTIPLE_FACES', 'TAB_HIDDEN', 'WINDOW_BLUR', 'FULLSCREEN_EXIT', 'COPY_PASTE', 'CAMERA_UNAVAILABLE'];

/**
 * Swimlane timeline of an attempt. Each event type has its own labeled row, so identity
 * never rests on color alone; bars span start→end on a shared time axis. Every mark is
 * keyboard-focusable with the same tooltip as hover, and the table below the chart
 * (rendered by the page) carries every value.
 */
export function ReviewTimeline({ events, startedAt, endedAt }: { events: TimelineEvent[]; startedAt: string; endedAt: string }) {
  const t0 = new Date(startedAt).getTime();
  const span = Math.max(60_000, new Date(endedAt).getTime() - t0);
  const lanes = LANES.filter((l) => events.some((e) => e.type === l));

  const ticks = useMemo(() => {
    const minutes = span / 60_000;
    const step = minutes <= 10 ? 1 : minutes <= 30 ? 5 : minutes <= 90 ? 10 : 30;
    return Array.from({ length: Math.floor(minutes / step) + 1 }, (_, i) => i * step);
  }, [span]);

  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - t0) / span) * 100))}%`;

  if (!lanes.length) {
    return <p className="rounded-xl bg-surface-2/60 p-6 text-center text-sm text-fg-muted">No signals were recorded during this attempt.</p>;
  }

  return (
    <Tooltip.Provider delayDuration={100}>
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          {lanes.map((lane) => (
            <div key={lane} className="grid grid-cols-[9.5rem_1fr] items-center gap-3 py-1.5">
              <span className="flex items-center gap-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: EVENT_META[lane].color }} aria-hidden />
                {EVENT_META[lane].label}
              </span>
              <div className="relative h-6 rounded-md bg-surface-2/70">
                {ticks.map((m) => (
                  <span key={m} className="absolute inset-y-0 w-px" style={{ left: pct(t0 + m * 60_000), background: 'var(--chart-grid)' }} aria-hidden />
                ))}
                {events
                  .filter((e) => e.type === lane)
                  .map((e) => {
                    const s = new Date(e.startedAt).getTime();
                    const end = e.endedAt ? new Date(e.endedAt).getTime() : s;
                    const offset = formatDuration(s - t0);
                    return (
                      <Tooltip.Root key={e.id}>
                        <Tooltip.Trigger asChild>
                          <button
                            className="absolute inset-y-1 rounded-[4px] outline-offset-2 transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-fg"
                            style={{ left: pct(s), width: `max(6px, calc(${pct(end)} - ${pct(s)}))`, background: EVENT_META[lane].color }}
                            aria-label={`${e.label} at ${offset}${e.durationMs ? `, lasting ${formatDuration(e.durationMs)}` : ''}`}
                          />
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                          <Tooltip.Content sideOffset={6} className="z-50 rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-pop">
                            <p className="font-medium text-fg">{e.label}</p>
                            <p className="text-fg-muted">
                              At {offset}
                              {e.durationMs ? ` · ${formatDuration(e.durationMs)}` : ''}
                              {e.confidence != null ? ` · confidence ${Math.round(e.confidence * 100)}%` : ''}
                            </p>
                            <p className="text-fg-muted">{e.source === 'CAMERA' ? 'Camera signal' : 'Browser signal'}</p>
                          </Tooltip.Content>
                        </Tooltip.Portal>
                      </Tooltip.Root>
                    );
                  })}
              </div>
            </div>
          ))}
          {/* Time axis */}
          <div className="grid grid-cols-[9.5rem_1fr] gap-3">
            <span />
            <div className="relative h-5 text-[11px] tabular-nums" style={{ color: 'var(--chart-axis)' }}>
              {ticks.map((m) => (
                <span key={m} className="absolute -translate-x-1/2" style={{ left: pct(t0 + m * 60_000) }}>
                  {m}m
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  );
}

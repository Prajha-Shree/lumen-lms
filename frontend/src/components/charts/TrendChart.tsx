import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import { Legend } from './ChartCard';

export type Series = { key: string; label: string; color: string };

const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function ChartTooltip({ active, payload, label, series, format }: TooltipContentProps<number, string> & { series: Series[]; format: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-medium text-fg">{typeof label === 'string' && /^\d{4}-/.test(label) ? shortDate(label) : label}</p>
      {series.map((s) => {
        const v = payload.find((p) => p.dataKey === s.key)?.value;
        return (
          <p key={s.key} className="flex items-center gap-2 text-fg-muted">
            <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.label}
            <span className="ml-auto pl-3 font-medium tabular-nums text-fg">{v == null ? '—' : format(Number(v))}</span>
          </p>
        );
      })}
    </div>
  );
}

const axisProps = {
  stroke: 'var(--chart-axis)',
  tick: { fill: 'var(--chart-axis)', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

/**
 * Time series on ONE y-axis (never dual-axis). Single series renders as a soft area;
 * multiple series as 2px lines with a legend. Crosshair tooltip on hover.
 */
export function TrendChart({
  data,
  xKey = 'day',
  series,
  height = 220,
  format = (v) => String(v),
  reference,
  yDomain,
}: {
  data: Record<string, unknown>[];
  xKey?: string;
  series: Series[];
  height?: number;
  format?: (v: number) => string;
  reference?: { y: number; label: string };
  yDomain?: [number, number];
}) {
  const common = (
    <>
      <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
      <XAxis dataKey={xKey} {...axisProps} tickFormatter={(v: string) => (/^\d{4}-/.test(v) ? shortDate(v) : v)} minTickGap={24} />
      <YAxis {...axisProps} width={36} allowDecimals={false} domain={yDomain ?? [0, 'auto']} tickFormatter={(v: number) => format(v)} />
      <Tooltip content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} series={series} format={format} />} cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }} />
      {reference && <ReferenceLine y={reference.y} stroke="var(--chart-axis)" strokeDasharray="0" label={{ value: reference.label, position: 'insideTopRight', fill: 'var(--chart-axis)', fontSize: 11 }} />}
    </>
  );

  return (
    <div>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {series.length === 1 ? (
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`fill-${series[0]!.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={series[0]!.color} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={series[0]!.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              {common}
              <Area type="monotone" dataKey={series[0]!.key} stroke={series[0]!.color} strokeWidth={2} fill={`url(#fill-${series[0]!.key})`} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} isAnimationActive />
            </AreaChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {common}
              {series.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';

/** Single-series histogram: one color (slot 1), 4px rounded tops, 2px gaps, per-bar tooltip. */
export function HistogramChart({ data, height = 200, unit = 'students' }: { data: { range: string; count: number }[]; height?: number; unit?: string }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="range" stroke="var(--chart-axis)" tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} tickLine={false} axisLine={false} interval={0} />
          <YAxis stroke="var(--chart-axis)" tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            content={(p) => {
              const { active, payload } = p as TooltipContentProps<number, string>;
              if (!active || !payload?.length) return null;
              const row = payload[0]!.payload as { range: string; count: number };
              return (
                <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-pop">
                  <p className="font-medium text-fg">{row.range}%</p>
                  <p className="text-fg-muted">
                    {row.count} {unit}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="count" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

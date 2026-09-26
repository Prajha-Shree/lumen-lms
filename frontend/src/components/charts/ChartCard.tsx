import { Table2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Card } from '@/components/ui';
import { cn } from '@/lib/cn';

export type TableView = { columns: string[]; rows: (string | number)[][] };

/**
 * Frame for every chart: title, optional description and a "Table" toggle. The table
 * is the accessible twin of the chart, so no value is reachable only via hover.
 */
export function ChartCard({
  title,
  description,
  table,
  actions,
  children,
  className,
  loading,
}: {
  title: string;
  description?: ReactNode;
  table?: TableView;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  loading?: boolean;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card className={cn('flex flex-col p-5', className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
        </div>
        <div className="flex items-center gap-1">
          {actions}
          {table && (
            <button
              onClick={() => setShowTable((s) => !s)}
              aria-pressed={showTable}
              className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs', showTable ? 'bg-primary-soft text-primary' : 'text-fg-muted hover:bg-surface-2')}
            >
              <Table2 className="size-3.5" aria-hidden /> Table
            </button>
          )}
        </div>
      </div>
      {/* Hold the previous render at reduced opacity on refetch instead of a skeleton flash. */}
      <div className={cn('min-h-0 flex-1 transition-opacity', loading && 'opacity-60')}>
        {showTable && table ? (
          <div className="max-h-72 overflow-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-left text-xs text-fg-muted">
                <tr>
                  {table.columns.map((c) => (
                    <th key={c} className="px-3 py-2 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) => (
                      <td key={j} className="px-3 py-1.5">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

/** Legend: always present for ≥2 series so identity is never color-alone. */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

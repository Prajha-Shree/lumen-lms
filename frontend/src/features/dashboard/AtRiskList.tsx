import { AlertTriangle, HeartHandshake } from 'lucide-react';
import { Avatar, Badge, EmptyState } from '@/components/ui';

export type AtRisk = {
  userId: string;
  name: string;
  courseId: string;
  courseTitle: string;
  progress: number;
  riskScore: number;
  level: 'high' | 'medium';
  reasons: string[];
  idleDays: number | null;
};

/** Students who may need a check-in, each with the plain reasons behind the flag. */
export function AtRiskList({ items, showCourse = true }: { items: AtRisk[]; showCourse?: boolean }) {
  if (!items.length) return <EmptyState icon={HeartHandshake} title="Everyone’s on track" description="No students match the at-risk rules right now." />;
  return (
    <ul className="divide-y divide-border">
      {items.map((s) => (
        <li key={`${s.userId}-${s.courseId}`} className="flex items-start gap-3 py-3">
          <Avatar name={s.name} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{s.name}</span>
              {/* Status carries an icon + label, never color alone. */}
              <Badge tone={s.level === 'high' ? 'danger' : 'warning'}>
                <AlertTriangle className="size-3" aria-hidden /> {s.level === 'high' ? 'Needs attention' : 'Watch'}
              </Badge>
            </div>
            {showCourse && <p className="text-xs text-fg-muted">{s.courseTitle}</p>}
            <ul className="mt-1 space-y-0.5 text-sm text-fg-muted">
              {s.reasons.map((r) => (
                <li key={r}>• {r}</li>
              ))}
            </ul>
          </div>
          <span className="shrink-0 text-sm tabular-nums text-fg-muted" title="Course progress">
            {Math.round(s.progress * 100)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

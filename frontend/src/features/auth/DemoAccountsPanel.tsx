import { FlaskConical } from 'lucide-react';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './demoAccounts';

/** Dev-only: one-click fill for the seeded accounts. Lazy-loaded behind import.meta.env.DEV. */
export default function DemoAccountsPanel({
  onPick,
}: {
  onPick: (creds: { tenantSlug: string; email: string; password: string }) => void;
}) {
  return (
    <div className="mt-8 rounded-2xl border border-dashed border-border p-4">
      <p className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
        <FlaskConical className="size-3.5" aria-hidden /> Demo accounts (dev only)
      </p>
      <div className="grid grid-cols-2 gap-2">
        {DEMO_ACCOUNTS.map((a) => (
          <button
            key={a.email}
            type="button"
            onClick={() => onPick({ tenantSlug: a.tenantSlug, email: a.email, password: DEMO_PASSWORD })}
            className="rounded-xl border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-primary-soft"
          >
            <span className="block font-medium">{a.label}</span>
            <span className="block truncate text-xs text-fg-muted">{a.email}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Search, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Avatar, Badge, Button, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton } from '@/components/ui';
import { useSession } from '@/features/auth/AuthProvider';
import { useDebounced } from '@/hooks/useDebounced';
import { ApiError, http } from '@/lib/api';
import { ROLE_LABEL, type Role } from '@/lib/types';

type ManagedUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  xp: number;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

const ROLE_TONE = { INSTITUTION_ADMIN: 'primary', INSTRUCTOR: 'info', STUDENT: 'neutral', SUPER_ADMIN: 'danger' } as const;

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function timeAgo(iso: string | null) {
  if (!iso) return 'Never';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, s] of units) if (Math.abs(diff) >= s) return relative.format(Math.round(diff / s), unit);
  return 'just now';
}

export function UsersPage() {
  const { user: me } = useSession();
  const qc = useQueryClient();
  const [role, setRole] = useState<'' | Role>('');
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const [inviteOpen, setInviteOpen] = useState(false);
  const key = ['users', role, search];

  const users = useQuery({
    queryKey: key,
    queryFn: () => {
      const params = new URLSearchParams();
      if (role) params.set('role', role);
      if (search) params.set('q', search);
      return http.get<{ users: ManagedUser[] }>(`/api/users?${params}`);
    },
    placeholderData: (prev) => prev,
  });

  // Optimistic toggle: flip immediately, roll back if the server refuses.
  const toggleActive = useMutation({
    mutationFn: (u: ManagedUser) => http.patch(`/api/users/${u.id}`, { isActive: !u.isActive }),
    onMutate: async (u) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ users: ManagedUser[] }>(key);
      qc.setQueryData<{ users: ManagedUser[] }>(key, (d) => d && { users: d.users.map((x) => (x.id === u.id ? { ...x, isActive: !x.isActive } : x)) });
      return { prev };
    },
    onError: (err, _u, ctx) => {
      qc.setQueryData(key, ctx?.prev);
      toast.error(err instanceof Error ? err.message : 'Update failed');
    },
    onSuccess: (_d, u) => toast.success(`${u.name} ${u.isActive ? 'deactivated' : 'reactivated'}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <>
      <PageHeader
        title="People"
        description="Invite instructors and students, and manage who can sign in."
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" aria-hidden /> Add person
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="pl-10" aria-label="Search people" />
        </div>
        <Select value={role} onChange={(e) => setRole(e.target.value as Role | '')} className="w-48" aria-label="Filter by role">
          <option value="">All roles</option>
          <option value="INSTITUTION_ADMIN">Admins</option>
          <option value="INSTRUCTOR">Instructors</option>
          <option value="STUDENT">Students</option>
        </Select>
      </div>

      {users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : users.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : users.data.users.length === 0 ? (
        <EmptyState icon={Users} title="No people match" description="Try a different search or role filter." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2/60 text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Role</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Last active</th>
                <th className="px-4 py-3 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.data.users.map((u) => (
                <tr key={u.id} className="transition-colors hover:bg-surface-2/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{u.name}</p>
                        <p className="truncate text-xs text-fg-muted">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                  </td>
                  <td className="hidden px-4 py-3 text-fg-muted md:table-cell">{timeAgo(u.lastLoginAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      role="switch"
                      aria-checked={u.isActive}
                      aria-label={`${u.name} can sign in`}
                      disabled={u.id === me.id}
                      onClick={() => toggleActive.mutate(u)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${u.isActive ? 'bg-success' : 'bg-border'}`}
                    >
                      <span className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${u.isActive ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </>
  );
}

const inviteSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name'),
  email: z.email('Enter a valid email'),
  role: z.enum(['STUDENT', 'INSTRUCTOR', 'INSTITUTION_ADMIN']),
});
type InviteValues = z.infer<typeof inviteSchema>;

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null);
  const form = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: { name: '', email: '', role: 'STUDENT' } });

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setCreated(null);
      form.reset();
    }
  };

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const res = await http.post<{ user: ManagedUser; temporaryPassword: string }>('/api/users', v);
      await qc.invalidateQueries({ queryKey: ['users'] });
      setCreated({ name: res.user.name, email: res.user.email, password: res.temporaryPassword });
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors?.email) form.setError('email', { message: err.fieldErrors.email[0] });
      else form.setError('root', { message: err instanceof Error ? err.message : 'Failed' });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={created ? 'Account created' : 'Add a person'}
      description={created ? 'Share these sign-in details securely. The password is shown only once.' : 'They’ll receive a temporary password to sign in.'}
    >
      {created ? (
        <div className="space-y-4">
          <div className="space-y-2 rounded-xl bg-surface-2 p-4 font-mono text-sm">
            <p>{created.email}</p>
            <p className="font-semibold">{created.password}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(`${created.email}\n${created.password}`);
                toast.success('Copied to clipboard');
              }}
            >
              <Copy className="size-4" aria-hidden /> Copy
            </Button>
            <Button onClick={() => close(false)}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Full name" error={form.formState.errors.name?.message}>
            {(a) => <Input {...a} autoFocus {...form.register('name')} />}
          </Field>
          <Field label="Email" error={form.formState.errors.email?.message}>
            {(a) => <Input {...a} type="email" {...form.register('email')} />}
          </Field>
          <Field label="Role">
            {(a) => (
              <Select {...a} {...form.register('role')}>
                <option value="STUDENT">Student</option>
                <option value="INSTRUCTOR">Instructor</option>
                <option value="INSTITUTION_ADMIN">Institution admin</option>
              </Select>
            )}
          </Field>
          {form.formState.errors.root && <p className="text-sm text-danger">{form.formState.errors.root.message}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Create account
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

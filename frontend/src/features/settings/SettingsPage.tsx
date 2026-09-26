import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Avatar, Button, Card, Field, Input, PageHeader } from '@/components/ui';
import { useSession } from '@/features/auth/AuthProvider';
import { ApiError, http } from '@/lib/api';
import { ROLE_LABEL, type User } from '@/lib/types';

const profileSchema = z.object({ name: z.string().trim().min(2, 'At least 2 characters') });
const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z.string().min(10, 'At least 10 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords don’t match' });

export function SettingsPage() {
  const { user, tenant, setUser } = useSession();

  const profile = useForm({ resolver: zodResolver(profileSchema), defaultValues: { name: user.name } });
  const password = useForm({ resolver: zodResolver(passwordSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });

  const saveProfile = profile.handleSubmit(async (v) => {
    const prev = user.name;
    setUser((u) => ({ ...u, name: v.name })); // optimistic
    try {
      await http.patch<{ user: User }>('/api/users/me', v);
      toast.success('Profile updated');
      profile.reset(v);
    } catch (e) {
      setUser((u) => ({ ...u, name: prev }));
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    }
  });

  const changePassword = password.handleSubmit(async (v) => {
    try {
      await http.post('/api/users/me/password', { currentPassword: v.currentPassword, newPassword: v.newPassword });
      toast.success('Password changed', { description: 'Other devices have been signed out.' });
      password.reset();
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors?.currentPassword) password.setError('currentPassword', { message: e.fieldErrors.currentPassword[0] });
      else toast.error(e instanceof Error ? e.message : 'Failed');
    }
  });

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <Card className="p-6">
          <div className="mb-6 flex items-center gap-4">
            <Avatar name={user.name} size="lg" />
            <div>
              <p className="font-semibold">{user.name}</p>
              <p className="text-sm text-fg-muted">
                {ROLE_LABEL[user.role]} · {tenant.name}
              </p>
            </div>
          </div>
          <form onSubmit={saveProfile} className="grid gap-4 sm:grid-cols-2" noValidate>
            <Field label="Display name" error={profile.formState.errors.name?.message}>
              {(a) => <Input {...a} {...profile.register('name')} />}
            </Field>
            <Field label="Email" hint="Contact your administrator to change it.">
              {(a) => <Input {...a} value={user.email} disabled readOnly />}
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={!profile.formState.isDirty} loading={profile.formState.isSubmitting}>
                Save profile
              </Button>
            </div>
          </form>
        </Card>

        <Card className="p-6">
          <h2 className="mb-1 font-semibold">Change password</h2>
          <p className="mb-5 text-sm text-fg-muted">Changing your password signs you out everywhere else.</p>
          <form onSubmit={changePassword} className="grid gap-4 sm:grid-cols-2" noValidate>
            <Field label="Current password" error={password.formState.errors.currentPassword?.message} className="sm:col-span-2">
              {(a) => <Input {...a} type="password" autoComplete="current-password" {...password.register('currentPassword')} />}
            </Field>
            <Field label="New password" error={password.formState.errors.newPassword?.message}>
              {(a) => <Input {...a} type="password" autoComplete="new-password" {...password.register('newPassword')} />}
            </Field>
            <Field label="Confirm new password" error={password.formState.errors.confirm?.message}>
              {(a) => <Input {...a} type="password" autoComplete="new-password" {...password.register('confirm')} />}
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" loading={password.formState.isSubmitting}>
                Update password
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}

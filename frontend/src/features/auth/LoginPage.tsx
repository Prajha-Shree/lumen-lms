import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Building2, CheckCircle2, Eye, EyeOff, LogIn } from 'lucide-react';
import { motion } from 'motion/react';
import { lazy, Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button, Field, Input } from '@/components/ui';
import { useDebounced } from '@/hooks/useDebounced';
import { ApiError, http } from '@/lib/api';
import { AuthLayout } from './AuthLayout';
import { LAST_TENANT_KEY, useAuth } from './AuthProvider';

const DemoAccountsPanel = import.meta.env.DEV ? lazy(() => import('./DemoAccountsPanel')) : null;

const schema = z.object({
  tenantSlug: z.string().trim().toLowerCase().min(1, 'Enter your institution ID'),
  email: z.email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});
type FormValues = z.infer<typeof schema>;

function lastTenant() {
  try {
    return localStorage.getItem(LAST_TENANT_KEY) ?? '';
  } catch {
    return '';
  }
}

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { tenantSlug: lastTenant(), email: '', password: '' },
  });
  const { register, handleSubmit, setValue, watch, setError, formState } = form;
  const slug = useDebounced(watch('tenantSlug').trim().toLowerCase(), 350);

  // Live lookup shows the institution name so users know they're in the right place.
  const tenantLookup = useQuery({
    queryKey: ['tenant-lookup', slug],
    queryFn: () => http.get<{ name: string; slug: string }>(`/api/auth/tenants/${encodeURIComponent(slug)}`),
    enabled: slug.length >= 3,
    retry: false,
    staleTime: 60_000,
  });

  if (status === 'authenticated') return <Navigate to={from} replace />;

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values);
      toast.success('Welcome back!');
      navigate(from, { replace: true });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not sign in. Check your connection and try again.';
      setError('root', { message });
    }
  });

  return (
    <AuthLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Sign in</h1>
        <p className="mt-1.5 text-fg-muted">Use the institution ID your school gave you.</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
          <Field
            label="Institution ID"
            error={formState.errors.tenantSlug?.message}
            hint={
              tenantLookup.data ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <CheckCircle2 className="size-3.5" aria-hidden /> {tenantLookup.data.name}
                </span>
              ) : tenantLookup.isError && slug.length >= 3 ? (
                <span className="text-warning">No institution with that ID</span>
              ) : (
                'e.g. riverside'
              )
            }
          >
            {(a) => (
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
                <Input {...a} {...register('tenantSlug')} className="pl-10" autoComplete="organization" autoCapitalize="none" spellCheck={false} />
              </div>
            )}
          </Field>

          <Field label="Email" error={formState.errors.email?.message}>
            {(a) => <Input {...a} {...register('email')} type="email" autoComplete="username" />}
          </Field>

          <Field label="Password" error={formState.errors.password?.message}>
            {(a) => (
              <div className="relative">
                <Input {...a} {...register('password')} type={showPassword ? 'text' : 'password'} autoComplete="current-password" className="pr-11" />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-fg-muted hover:text-fg"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            )}
          </Field>

          {formState.errors.root && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
            >
              {formState.errors.root.message}
            </motion.p>
          )}

          <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
            {!formState.isSubmitting && <LogIn className="size-4" aria-hidden />}
            Sign in
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-fg-muted">
          Setting up a new school?{' '}
          <Link to="/signup" className="font-medium text-primary hover:underline">
            Create an institution
          </Link>
        </p>

        {DemoAccountsPanel && (
          <Suspense fallback={null}>
            <DemoAccountsPanel
              onPick={(c) => {
                setValue('tenantSlug', c.tenantSlug);
                setValue('email', c.email);
                setValue('password', c.password);
              }}
            />
          </Suspense>
        )}
      </motion.div>
    </AuthLayout>
  );
}

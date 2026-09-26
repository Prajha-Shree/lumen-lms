import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, Loader, Rocket, UserRound, XCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button, Field, Input, Stepper } from '@/components/ui';
import { useDebounced } from '@/hooks/useDebounced';
import { ApiError, http } from '@/lib/api';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './AuthProvider';

const schema = z.object({
  institutionName: z.string().trim().min(2, 'At least 2 characters').max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, '3–40 lowercase letters, numbers or hyphens'),
  adminName: z.string().trim().min(2, 'Enter your full name').max(120),
  email: z.email('Enter a valid email'),
  password: z.string().min(10, 'At least 10 characters'),
});
type FormValues = z.infer<typeof schema>;

const STEPS = ['Institution', 'Your account', 'Review'];
const STEP_FIELDS: (keyof FormValues)[][] = [['institutionName', 'slug'], ['adminName', 'email', 'password'], []];

const toSlug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

function passwordStrength(pw: string) {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(4, score);
}
const STRENGTH = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
const STRENGTH_COLOR = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-success', 'bg-success'];

export function SignupPage() {
  const { registerInstitution } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [slugTouched, setSlugTouched] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { institutionName: '', slug: '', adminName: '', email: '', password: '' },
  });
  const { register, handleSubmit, watch, setValue, trigger, setError, formState } = form;
  const values = watch();
  const slug = useDebounced(values.slug, 350);

  const availability = useQuery({
    queryKey: ['slug-available', slug],
    queryFn: () => http.get<{ available: boolean; reason?: string }>(`/api/auth/slug-available/${encodeURIComponent(slug)}`),
    enabled: slug.length >= 3,
    staleTime: 10_000,
  });

  const go = async (next: number) => {
    if (next > step) {
      const ok = await trigger(STEP_FIELDS[step]);
      if (!ok) return;
      if (step === 0 && availability.data && !availability.data.available) {
        setError('slug', { message: availability.data.reason ?? 'Not available' });
        return;
      }
    }
    setDirection(next > step ? 1 : -1);
    setStep(next);
  };

  const onSubmit = handleSubmit(async (v) => {
    try {
      await registerInstitution(v);
      toast.success(`${v.institutionName} is ready!`, { description: 'Next: invite your instructors.' });
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) {
        for (const [field, msgs] of Object.entries(err.fieldErrors)) {
          setError(field as keyof FormValues, { message: msgs[0] });
        }
        setDirection(-1);
        setStep(err.fieldErrors.slug || err.fieldErrors.institutionName ? 0 : 1);
      } else {
        setError('root', { message: err instanceof Error ? err.message : 'Something went wrong' });
      }
    }
  });

  const strength = passwordStrength(values.password);

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Create your institution</h1>
      <p className="mt-1.5 text-fg-muted">Three quick steps. You’ll be the first administrator.</p>

      <div className="my-8">
        <Stepper steps={STEPS} current={step} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 2) void go(step + 1);
          else void onSubmit();
        }}
        noValidate
        className="relative"
      >
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={step}
            custom={direction}
            initial={{ opacity: 0, x: direction * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -24 }}
            transition={{ duration: 0.2 }}
            className="space-y-5"
          >
            {step === 0 && (
              <>
                <Field label="Institution name" error={formState.errors.institutionName?.message}>
                  {(a) => (
                    <Input
                      {...a}
                      autoFocus
                      placeholder="Riverside Academy"
                      {...register('institutionName', {
                        onChange: (e) => {
                          if (!slugTouched) setValue('slug', toSlug(e.target.value), { shouldValidate: values.slug.length > 0 });
                        },
                      })}
                    />
                  )}
                </Field>
                <Field
                  label="Institution ID"
                  error={formState.errors.slug?.message}
                  hint={
                    slug.length < 3 ? (
                      'Students type this to sign in.'
                    ) : availability.isFetching ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader className="size-3.5 animate-spin" aria-hidden /> Checking…
                      </span>
                    ) : availability.data?.available ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 className="size-3.5" aria-hidden /> Available
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-danger">
                        <XCircle className="size-3.5" aria-hidden /> {availability.data?.reason ?? 'Not available'}
                      </span>
                    )
                  }
                >
                  {(a) => (
                    <Input
                      {...a}
                      {...register('slug', { onChange: () => setSlugTouched(true) })}
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="riverside"
                    />
                  )}
                </Field>
              </>
            )}

            {step === 1 && (
              <>
                <Field label="Your full name" error={formState.errors.adminName?.message}>
                  {(a) => <Input {...a} autoFocus {...register('adminName')} autoComplete="name" />}
                </Field>
                <Field label="Work email" error={formState.errors.email?.message}>
                  {(a) => <Input {...a} type="email" {...register('email')} autoComplete="email" />}
                </Field>
                <Field label="Password" error={formState.errors.password?.message}>
                  {(a) => (
                    <div className="space-y-2">
                      <Input {...a} type="password" {...register('password')} autoComplete="new-password" />
                      {values.password && (
                        <div className="flex items-center gap-2" aria-live="polite">
                          <div className="flex flex-1 gap-1">
                            {[0, 1, 2, 3].map((i) => (
                              <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i < strength ? STRENGTH_COLOR[strength] : 'bg-surface-2'}`} />
                            ))}
                          </div>
                          <span className="w-16 text-right text-xs text-fg-muted">{STRENGTH[strength]}</span>
                        </div>
                      )}
                    </div>
                  )}
                </Field>
              </>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <ReviewRow icon={Building2} label="Institution" value={values.institutionName} sub={`Sign-in ID: ${values.slug}`} onEdit={() => void go(0)} />
                <ReviewRow icon={UserRound} label="Administrator" value={values.adminName} sub={values.email} onEdit={() => void go(1)} />
                <p className="text-xs text-fg-muted">
                  Your institution’s data is isolated from every other institution on this platform at the database level.
                </p>
                {formState.errors.root && (
                  <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
                    {formState.errors.root.message}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 flex gap-3">
          {step > 0 && (
            <Button type="button" variant="secondary" size="lg" onClick={() => void go(step - 1)}>
              <ArrowLeft className="size-4" aria-hidden /> Back
            </Button>
          )}
          <Button type="submit" size="lg" className="flex-1" loading={formState.isSubmitting}>
            {step < 2 ? (
              <>
                Continue <ArrowRight className="size-4" aria-hidden />
              </>
            ) : (
              !formState.isSubmitting && (
                <>
                  <Rocket className="size-4" aria-hidden /> Create institution
                </>
              )
            )}
          </Button>
        </div>
      </form>

      <p className="mt-6 text-center text-sm text-fg-muted">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

function ReviewRow({ icon: Icon, label, value, sub, onEdit }: { icon: typeof Building2; label: string; value: string; sub: string; onEdit: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4">
      <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-fg-muted">{label}</p>
        <p className="truncate font-medium">{value}</p>
        <p className="truncate text-sm text-fg-muted">{sub}</p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
        Edit
      </Button>
    </div>
  );
}

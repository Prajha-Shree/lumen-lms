import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { http } from '@/lib/api';

export type Level = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type CourseStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type LessonFormat = 'READING' | 'VIDEO' | 'INTERACTIVE';
export type ProgressStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export type CourseCard = {
  id: string;
  title: string;
  description: string;
  level: Level;
  status: CourseStatus;
  tags: string[];
  accent: string;
  instructorId: string;
  instructor: { id: string; name: string };
  updatedAt: string;
  canManage: boolean;
  _count: { modules: number; lessons: number; enrollments: number };
  enrollment?: { status: 'ACTIVE' | 'COMPLETED' | 'DROPPED'; enrolledAt: string } | null;
  progress?: { total: number; completed: number };
};

export type LessonSummary = {
  id: string;
  title: string;
  summary: string;
  format: LessonFormat;
  durationMinutes: number;
  difficulty: number;
  topics: string[];
  position: number;
  _count: { attachments: number };
};

export type ModuleDetail = { id: string; title: string; description: string; position: number; lessons: LessonSummary[] };

export type ExamSummary = {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  proctored: boolean;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  passingScore: number;
  maxAttempts: number;
  _count: { questions: number };
};

export type CourseDetail = CourseCard & {
  modules: ModuleDetail[];
  exams: ExamSummary[];
  lessonStatus: Record<string, ProgressStatus>;
  attempts: Record<string, { count: number; best: number | null; inProgressId: string | null }>;
};

export type Attachment = { id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string };

export type LessonDetail = {
  lesson: LessonSummary & { content: string; videoUrl: string | null; moduleId: string; courseId: string; attachments: Attachment[] };
  course: { id: string; title: string; accent: string };
  prev: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
  index: number;
  total: number;
  progress: { status: ProgressStatus; timeSpentSeconds: number } | null;
};

export const courseKeys = {
  all: ['courses'] as const,
  detail: (id: string) => ['course', id] as const,
  lesson: (id: string) => ['lesson', id] as const,
  students: (id: string) => ['course', id, 'students'] as const,
};

export const useCourses = () =>
  useQuery({ queryKey: courseKeys.all, queryFn: () => http.get<{ courses: CourseCard[] }>('/api/courses').then((r) => r.courses) });

export const useCourse = (id: string) =>
  useQuery({ queryKey: courseKeys.detail(id), queryFn: () => http.get<{ course: CourseDetail }>(`/api/courses/${id}`).then((r) => r.course) });

export const useLesson = (id: string) =>
  useQuery({ queryKey: courseKeys.lesson(id), queryFn: () => http.get<LessonDetail>(`/api/lessons/${id}`) });

/** Optimistic enroll: the card flips to "enrolled" instantly and rolls back on failure. */
export function useEnroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (courseId: string) => http.post(`/api/courses/${courseId}/enroll`),
    onMutate: async (courseId) => {
      await qc.cancelQueries({ queryKey: courseKeys.all });
      const prev = qc.getQueryData<CourseCard[]>(courseKeys.all);
      qc.setQueryData<CourseCard[]>(courseKeys.all, (list) =>
        list?.map((c) => (c.id === courseId ? { ...c, enrollment: { status: 'ACTIVE', enrolledAt: new Date().toISOString() } } : c)),
      );
      return { prev };
    },
    onError: (err, _id, ctx) => {
      qc.setQueryData(courseKeys.all, ctx?.prev);
      toast.error(err instanceof Error ? err.message : 'Could not enroll');
    },
    onSuccess: () => toast.success('Enrolled! Your first lesson is ready.'),
    onSettled: (_d, _e, courseId) => {
      void qc.invalidateQueries({ queryKey: courseKeys.all });
      void qc.invalidateQueries({ queryKey: courseKeys.detail(courseId) });
    },
  });
}

export const ACCENT: Record<string, { bg: string; soft: string; text: string; ring: string }> = {
  indigo: { bg: 'bg-indigo-500', soft: 'bg-indigo-500/12', text: 'text-indigo-600 dark:text-indigo-300', ring: 'from-indigo-500 to-violet-500' },
  emerald: { bg: 'bg-emerald-500', soft: 'bg-emerald-500/12', text: 'text-emerald-600 dark:text-emerald-300', ring: 'from-emerald-500 to-teal-500' },
  rose: { bg: 'bg-rose-500', soft: 'bg-rose-500/12', text: 'text-rose-600 dark:text-rose-300', ring: 'from-rose-500 to-orange-400' },
  amber: { bg: 'bg-amber-500', soft: 'bg-amber-500/12', text: 'text-amber-600 dark:text-amber-300', ring: 'from-amber-500 to-yellow-400' },
  sky: { bg: 'bg-sky-500', soft: 'bg-sky-500/12', text: 'text-sky-600 dark:text-sky-300', ring: 'from-sky-500 to-cyan-400' },
  violet: { bg: 'bg-violet-500', soft: 'bg-violet-500/12', text: 'text-violet-600 dark:text-violet-300', ring: 'from-violet-500 to-fuchsia-500' },
};
export const accentOf = (a: string) => ACCENT[a] ?? ACCENT.indigo!;

export const LEVEL_LABEL: Record<Level, string> = { BEGINNER: 'Beginner', INTERMEDIATE: 'Intermediate', ADVANCED: 'Advanced' };
export const FORMAT_LABEL: Record<LessonFormat, string> = { READING: 'Reading', VIDEO: 'Video', INTERACTIVE: 'Interactive' };

import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@/app/AppShell';
import { NotFoundPage } from '@/app/NotFoundPage';
import { RealtimeProvider } from '@/app/RealtimeProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { LoginPage } from '@/features/auth/LoginPage';
import { RequireAuth } from '@/features/auth/RequireAuth';

// Route-level code splitting: each area loads on first visit.
const lazyNamed = <K extends string>(loader: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => loader().then((m) => ({ default: m[name] })));

const SignupPage = lazyNamed(() => import('@/features/auth/SignupPage'), 'SignupPage');
const DashboardPage = lazyNamed(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage');
const UsersPage = lazyNamed(() => import('@/features/admin/UsersPage'), 'UsersPage');
const PlatformPage = lazyNamed(() => import('@/features/admin/PlatformPage'), 'PlatformPage');
const SettingsPage = lazyNamed(() => import('@/features/settings/SettingsPage'), 'SettingsPage');
const SystemStatusPage = lazyNamed(() => import('@/features/system/SystemStatusPage'), 'SystemStatusPage');
const CoursesPage = lazyNamed(() => import('@/features/courses/CoursesPage'), 'CoursesPage');
const CoursePage = lazyNamed(() => import('@/features/courses/CoursePage'), 'CoursePage');
const LessonPage = lazyNamed(() => import('@/features/courses/LessonPage'), 'LessonPage');
const CourseEditorPage = lazyNamed(() => import('@/features/courses/CourseEditorPage'), 'CourseEditorPage');
const LearningProfilePage = lazyNamed(() => import('@/features/cognitive/LearningProfilePage'), 'LearningProfilePage');
const AssessmentPage = lazyNamed(() => import('@/features/cognitive/AssessmentPage'), 'AssessmentPage');
const ExamTakePage = lazyNamed(() => import('@/features/exams/ExamTakePage'), 'ExamTakePage');
const ExamSessionsPage = lazyNamed(() => import('@/features/exams/ExamSessionsPage'), 'ExamSessionsPage');
const ExamEditorPage = lazyNamed(() => import('@/features/exams/ExamEditorPage'), 'ExamEditorPage');
const SessionReviewPage = lazyNamed(() => import('@/features/exams/SessionReviewPage'), 'SessionReviewPage');
const ReviewsPage = lazyNamed(() => import('@/features/exams/ReviewsPage'), 'ReviewsPage');
const AchievementsPage = lazyNamed(() => import('@/features/gamification/AchievementsPage'), 'AchievementsPage');

function Home() {
  const { user } = useAuth();
  return user?.role === 'SUPER_ADMIN' ? <Navigate to="/platform" replace /> : <DashboardPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        element={
          <RequireAuth>
            <RealtimeProvider>
              <AppShell />
            </RealtimeProvider>
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="courses" element={<CoursesPage />} />
        <Route path="courses/:courseId" element={<CoursePage />} />
        <Route path="courses/:courseId/lessons/:lessonId" element={<LessonPage />} />
        <Route
          path="learning-profile"
          element={
            <RequireAuth roles={['STUDENT']}>
              <LearningProfilePage />
            </RequireAuth>
          }
        />
        <Route
          path="assessment"
          element={
            <RequireAuth roles={['STUDENT']}>
              <AssessmentPage />
            </RequireAuth>
          }
        />
        <Route
          path="exams/:examId/take"
          element={
            <RequireAuth roles={['STUDENT']}>
              <ExamTakePage />
            </RequireAuth>
          }
        />
        <Route
          path="exams/:examId/sessions"
          element={
            <RequireAuth roles={['INSTRUCTOR', 'INSTITUTION_ADMIN']}>
              <ExamSessionsPage />
            </RequireAuth>
          }
        />
        <Route
          path="exams/:examId/edit"
          element={
            <RequireAuth roles={['INSTRUCTOR', 'INSTITUTION_ADMIN']}>
              <ExamEditorPage />
            </RequireAuth>
          }
        />
        <Route
          path="exam-sessions/:sessionId/review"
          element={
            <RequireAuth roles={['INSTRUCTOR', 'INSTITUTION_ADMIN']}>
              <SessionReviewPage />
            </RequireAuth>
          }
        />
        <Route
          path="achievements"
          element={
            <RequireAuth roles={['STUDENT']}>
              <AchievementsPage />
            </RequireAuth>
          }
        />
        <Route
          path="reviews"
          element={
            <RequireAuth roles={['INSTRUCTOR', 'INSTITUTION_ADMIN']}>
              <ReviewsPage />
            </RequireAuth>
          }
        />
        <Route
          path="courses/:courseId/edit"
          element={
            <RequireAuth roles={['INSTRUCTOR', 'INSTITUTION_ADMIN']}>
              <CourseEditorPage />
            </RequireAuth>
          }
        />
        <Route
          path="platform"
          element={
            <RequireAuth roles={['SUPER_ADMIN']}>
              <PlatformPage />
            </RequireAuth>
          }
        />
        <Route
          path="admin/users"
          element={
            <RequireAuth roles={['INSTITUTION_ADMIN']}>
              <UsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="admin/status"
          element={
            <RequireAuth roles={['INSTITUTION_ADMIN', 'SUPER_ADMIN']}>
              <SystemStatusPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

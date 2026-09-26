import { useSession } from '@/features/auth/AuthProvider';
import { AdminDashboard } from './AdminDashboard';
import { InstructorDashboard } from './InstructorDashboard';
import { StudentDashboard } from './StudentDashboard';

/** Role-aware landing page. */
export function DashboardPage() {
  const { user } = useSession();
  if (user.role === 'STUDENT') return <StudentDashboard />;
  if (user.role === 'INSTITUTION_ADMIN') return <AdminDashboard />;
  return <InstructorDashboard />;
}

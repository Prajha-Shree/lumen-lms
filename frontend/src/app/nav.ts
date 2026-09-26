import {
  Activity,
  Award,
  BookOpen,
  Building,
  BrainCircuit,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/lib/types';

export type NavItem = { to: string; label: string; icon: LucideIcon; roles: Role[]; end?: boolean };

const ALL: Role[] = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'INSTRUCTOR', 'STUDENT'];
const TENANT_USERS: Role[] = ['INSTITUTION_ADMIN', 'INSTRUCTOR', 'STUDENT'];

/** Single source of truth for sidebar navigation; filtered by the signed-in role. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: TENANT_USERS, end: true },
  { to: '/platform', label: 'Institutions', icon: Building, roles: ['SUPER_ADMIN'] },
  { to: '/courses', label: 'Courses', icon: BookOpen, roles: TENANT_USERS },
  { to: '/learning-profile', label: 'Learning profile', icon: BrainCircuit, roles: ['STUDENT'] },
  { to: '/achievements', label: 'Achievements', icon: Award, roles: ['STUDENT'] },
  { to: '/reviews', label: 'Proctoring reviews', icon: ShieldCheck, roles: ['INSTRUCTOR', 'INSTITUTION_ADMIN'] },
  { to: '/admin/users', label: 'People', icon: Users, roles: ['INSTITUTION_ADMIN'] },
  { to: '/admin/status', label: 'System status', icon: Activity, roles: ['INSTITUTION_ADMIN', 'SUPER_ADMIN'] },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ALL },
];

export const navFor = (role: Role) => NAV_ITEMS.filter((i) => i.roles.includes(role));

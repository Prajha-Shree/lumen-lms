export type Role = 'SUPER_ADMIN' | 'INSTITUTION_ADMIN' | 'INSTRUCTOR' | 'STUDENT';

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  xp: number;
  createdAt: string;
};

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  settings: { primaryColor?: string; proctoringRetentionDays?: number };
};

export type Session = { accessToken: string; user: User; tenant: Tenant };

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super admin',
  INSTITUTION_ADMIN: 'Institution admin',
  INSTRUCTOR: 'Instructor',
  STUDENT: 'Student',
};

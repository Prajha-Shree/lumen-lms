import { useQuery } from '@tanstack/react-query';
import { http } from '@/lib/api';

export type Profile = {
  id: string;
  userId: string;
  version: number;
  modality: Record<'reading' | 'video' | 'interactive', number>;
  pace: 'steady' | 'balanced' | 'accelerated';
  processingSpeed: number;
  calibration: number;
  topicMastery: Record<string, number>;
  strengths: string[];
  growthAreas: string[];
  summary: string;
  updatedAt: string;
};

export type AssessmentItem = {
  id: string;
  kind: 'preference' | 'diagnostic' | 'reasoning';
  prompt: string;
  options: { id: string; text: string }[];
  asksConfidence: boolean;
};

export type Step = {
  assessmentId?: string;
  done: boolean;
  answered: number;
  total: number;
  item?: AssessmentItem | null;
  profile?: Profile | null;
};

export const profileKey = ['cognitive-profile', 'me'] as const;

export const useMyProfile = () =>
  useQuery({ queryKey: profileKey, queryFn: () => http.get<{ profile: Profile | null }>('/api/cognitive/profile/me').then((r) => r.profile) });

export const topicLabel = (t: string) => t.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const PACE_COPY: Record<Profile['pace'], { label: string; body: string }> = {
  steady: { label: 'Steady', body: 'Shorter sessions with regular review. We’ll keep new material bite-sized and revisit key ideas.' },
  balanced: { label: 'Balanced', body: 'A mix of new material and review. Your path alternates stretch lessons with consolidation.' },
  accelerated: { label: 'Accelerated', body: 'You like to move quickly. We’ll surface stretch lessons sooner and let you circle back.' },
};

export const MODALITY_LABEL: Record<keyof Profile['modality'], string> = { reading: 'Reading', video: 'Video', interactive: 'Hands-on' };

import { Award, BookOpenCheck, Brain, Flame, GraduationCap, HandHelping, Rocket, Target, Zap, type LucideIcon } from 'lucide-react';

/** Badge catalog. Keys must match the backend award rules (src/modules/gamification). */
export const BADGES: Record<string, { name: string; description: string; icon: LucideIcon }> = {
  'first-steps': { name: 'First Steps', description: 'Completed your first lesson', icon: Rocket },
  'five-lessons': { name: 'Momentum', description: 'Completed 5 lessons', icon: Zap },
  'ten-lessons': { name: 'Deep Diver', description: 'Completed 10 lessons', icon: BookOpenCheck },
  'course-complete': { name: 'Finisher', description: 'Completed an entire course', icon: GraduationCap },
  'streak-3': { name: 'On a Roll', description: 'Learned 3 days in a row', icon: Flame },
  'streak-7': { name: 'Week Warrior', description: 'Learned 7 days in a row', icon: Flame },
  'know-thyself': { name: 'Know Thyself', description: 'Built your learning profile', icon: Brain },
  'perfect-score': { name: 'Perfectionist', description: 'Scored 100% on an exam', icon: Target },
  'exam-passed': { name: 'Checkpoint Cleared', description: 'Passed an exam', icon: Award },
  helpful: { name: 'Helping Hand', description: 'Your forum reply was marked as the answer', icon: HandHelping },
};

export const badgeMeta = (key: string) => BADGES[key] ?? { name: key, description: '', icon: Award };

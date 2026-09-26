import { Prisma } from '@prisma/client';
import type { Tx } from '../../lib/db.js';

/** Accepts only valid IANA zones (validated by Intl), falling back to UTC. */
export function safeTimeZone(tz: unknown): string {
  if (typeof tz === 'string' && tz.length < 64) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return tz;
    } catch {
      /* invalid zone */
    }
  }
  return 'UTC';
}

const courseFilter = (courseIds?: string[]) =>
  courseIds ? Prisma.sql`AND course_id = ANY(${courseIds}::uuid[])` : Prisma.empty;

/** Activity counts by ISO weekday (1=Mon) × hour in the viewer's timezone. */
export async function engagementHeatmap(tx: Tx, tz: string, courseIds?: string[], days = 30) {
  const rows = await tx.$queryRaw<{ dow: number; hour: number; n: number }[]>`
    SELECT EXTRACT(ISODOW FROM occurred_at AT TIME ZONE ${tz})::int AS dow,
           EXTRACT(HOUR FROM occurred_at AT TIME ZONE ${tz})::int AS hour,
           COUNT(*)::int AS n
    FROM learning_activities
    WHERE occurred_at >= now() - make_interval(days => ${days}::int) AND type <> 'LOGIN' ${courseFilter(courseIds)}
    GROUP BY 1, 2`;
  return rows;
}

/** One row per local day for the last `days` days (zero-filled). */
export async function dailySeries(tx: Tx, tz: string, days: number, opts: { courseIds?: string[]; userId?: string } = {}) {
  const rows = await tx.$queryRaw<{ day: string; users: number; completions: number; xp: number; events: number }[]>`
    SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day,
           COUNT(DISTINCT user_id)::int AS users,
           COUNT(*) FILTER (WHERE type = 'LESSON_COMPLETE')::int AS completions,
           COALESCE(SUM(xp), 0)::int AS xp,
           COUNT(*) FILTER (WHERE type <> 'LOGIN')::int AS events
    FROM learning_activities
    WHERE occurred_at >= date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz} - make_interval(days => ${days - 1}::int)
      ${courseFilter(opts.courseIds)}
      ${opts.userId ? Prisma.sql`AND user_id = ${opts.userId}::uuid` : Prisma.empty}
    GROUP BY 1 ORDER BY 1`;
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return localDays(tz, days).map((day) => byDay.get(day) ?? { day, users: 0, completions: 0, xp: 0, events: 0 });
}

/** The last `n` local calendar days as YYYY-MM-DD, oldest first. */
export function localDays(tz: string, n: number, now = new Date()): string[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = fmt.format(now);
  const base = new Date(`${today}T12:00:00Z`); // midday avoids DST edge cases when stepping days
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

/** Current and longest streak of consecutive local days with learning activity. */
export async function streak(tx: Tx, userId: string, tz: string) {
  const rows = await tx.$queryRaw<{ day: string }[]>`
    SELECT DISTINCT to_char(date_trunc('day', occurred_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day
    FROM learning_activities WHERE user_id = ${userId}::uuid AND type <> 'LOGIN'
    ORDER BY 1`;
  return computeStreak(rows.map((r) => r.day), localDays(tz, 1)[0]!);
}

export function computeStreak(sortedDays: string[], today: string) {
  const dayNum = (d: string) => Math.round(new Date(`${d}T12:00:00Z`).getTime() / 86_400_000);
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of sortedDays) {
    const n = dayNum(d);
    run = prev !== null && n === prev + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = n;
  }
  // The current streak survives until the end of today even if today has no activity yet.
  const last = sortedDays.length ? dayNum(sortedDays.at(-1)!) : null;
  const current = last !== null && dayNum(today) - last <= 1 ? run : 0;
  return { current, longest, activeToday: last === dayNum(today) };
}

/** Histogram of exam percentages in 10-point buckets (0–9 … 90–100). */
export function scoreBuckets(percents: number[]) {
  const buckets = Array.from({ length: 10 }, (_, i) => ({ range: i === 9 ? '90–100' : `${i * 10}–${i * 10 + 9}`, count: 0 }));
  for (const p of percents) buckets[Math.min(9, Math.floor(p / 10))]!.count++;
  return buckets;
}

export type RiskInput = {
  userId: string;
  name: string;
  courseId: string;
  courseTitle: string;
  enrolledAt: Date;
  progress: number; // 0..1
  lastActiveAt: Date | null;
  scores: number[]; // most recent first
  passingScore: number;
};

/**
 * Explainable at-risk scoring. Each rule adds weight and a plain-language reason,
 * so instructors see *why* someone is flagged and can judge it themselves.
 */
export function assessRisk(students: RiskInput[], now = new Date()) {
  const byCourse = new Map<string, number[]>();
  for (const s of students) byCourse.set(s.courseId, [...(byCourse.get(s.courseId) ?? []), s.progress]);
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)]! : 0;
  };

  return students
    .map((s) => {
      const reasons: string[] = [];
      let score = 0;
      const idleDays = s.lastActiveAt ? Math.floor((now.getTime() - s.lastActiveAt.getTime()) / 86_400_000) : Infinity;
      const enrolledDays = (now.getTime() - s.enrolledAt.getTime()) / 86_400_000;
      if (idleDays >= 7) {
        score += idleDays >= 14 ? 0.45 : 0.35;
        reasons.push(Number.isFinite(idleDays) ? `No activity for ${idleDays} days` : 'Hasn’t started yet');
      }
      const cohort = median(byCourse.get(s.courseId) ?? []);
      if (enrolledDays > 7 && cohort > 0.1 && s.progress < cohort * 0.5) {
        score += 0.25;
        reasons.push(`Behind the class: ${Math.round(s.progress * 100)}% vs median ${Math.round(cohort * 100)}%`);
      }
      if (s.scores[0] !== undefined && s.scores[0] < s.passingScore) {
        score += 0.3;
        reasons.push(`Latest exam ${Math.round(s.scores[0])}% (pass ${s.passingScore}%)`);
      }
      if (s.scores.length >= 2 && s.scores[1]! - s.scores[0]! >= 15) {
        score += 0.1;
        reasons.push(`Scores dropped ${Math.round(s.scores[1]! - s.scores[0]!)} points`);
      }
      return { ...s, riskScore: Math.min(1, Math.round(score * 100) / 100), level: score >= 0.6 ? ('high' as const) : ('medium' as const), reasons, idleDays: Number.isFinite(idleDays) ? idleDays : null };
    })
    .filter((s) => s.riskScore >= 0.35)
    .sort((a, b) => b.riskScore - a.riskScore);
}

/** Loads everything `assessRisk` needs for the given courses. */
export async function riskInputs(tx: Tx, courseIds: string[]): Promise<RiskInput[]> {
  if (!courseIds.length) return [];
  const [enrollments, lessonCounts, done, lastSeen, sessions] = await Promise.all([
    tx.enrollment.findMany({
      where: { courseId: { in: courseIds }, status: 'ACTIVE' },
      include: { user: { select: { name: true } }, course: { select: { title: true } } },
    }),
    tx.lesson.groupBy({ by: ['courseId'], where: { courseId: { in: courseIds } }, _count: { _all: true } }),
    tx.lessonProgress.groupBy({ by: ['courseId', 'userId'], where: { courseId: { in: courseIds }, status: 'COMPLETED' }, _count: { _all: true } }),
    tx.learningActivity.groupBy({ by: ['courseId', 'userId'], where: { courseId: { in: courseIds } }, _max: { occurredAt: true } }),
    tx.examSession.findMany({
      where: { exam: { courseId: { in: courseIds } }, status: { in: ['SUBMITTED', 'EXPIRED'] } },
      orderBy: { submittedAt: 'desc' },
      select: { userId: true, percent: true, exam: { select: { courseId: true, passingScore: true } } },
    }),
  ]);
  return enrollments.map((e) => {
    const total = lessonCounts.find((l) => l.courseId === e.courseId)?._count._all ?? 0;
    const completed = done.find((d) => d.courseId === e.courseId && d.userId === e.userId)?._count._all ?? 0;
    const mine = sessions.filter((s) => s.userId === e.userId && s.exam.courseId === e.courseId);
    return {
      userId: e.userId,
      name: e.user.name,
      courseId: e.courseId,
      courseTitle: e.course.title,
      enrolledAt: e.enrolledAt,
      progress: total ? completed / total : 0,
      lastActiveAt: lastSeen.find((l) => l.courseId === e.courseId && l.userId === e.userId)?._max.occurredAt ?? null,
      scores: mine.map((s) => s.percent ?? 0),
      passingScore: mine[0]?.exam.passingScore ?? 60,
    };
  });
}

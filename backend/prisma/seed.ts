/**
 * Demo seed. Idempotent: skips if the demo tenants exist. `npm run db:seed -- --reset`
 * deletes and recreates them (cascades through every tenant-owned table).
 *
 * Every demo account uses DEMO_PASSWORD below. These are local test credentials only.
 *
 *   Super admin        superadmin@lumen.test       institution: platform
 *   Institution admin  admin@riverside.test        institution: riverside
 *   Instructor         instructor@riverside.test   institution: riverside
 *   Student            student@riverside.test      institution: riverside
 *   Other tenant admin admin@summit.test           institution: summit
 */
import { PrismaClient, type Prisma, type ProctoringEventType } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';
import { dataScienceCourse, mlDraftCourse, summitCourse, writingCourse, type SeedCourse } from './seed-data.js';

export const DEMO_PASSWORD = 'LumenDemo#2026';
const DEMO_SLUGS = ['platform', 'riverside', 'summit'];

// Owner connection (superuser): bypasses RLS, appropriate for seeding only.
const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

// ─── Deterministic randomness ────────────────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260926);
const between = (min: number, max: number) => min + rand() * (max - min);
const int = (min: number, max: number) => Math.floor(between(min, max + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

const NOW = new Date();
/** A timestamp `days` ago at a plausible study hour (evening-weighted). */
function daysAgo(days: number, hour?: number): Date {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  const h = hour ?? pick([8, 9, 10, 13, 15, 17, 18, 19, 19, 20, 20, 21, 21, 22]);
  d.setHours(h, int(0, 59), int(0, 59), 0);
  // "Today at 9pm" is in the future if it's currently morning; keep history in the past.
  if (days >= 0 && d > NOW) return new Date(NOW.getTime() - int(5, 180) * 60_000);
  return d;
}

// ─── Builders ────────────────────────────────────────────────────────────────
type BuiltCourse = {
  id: string;
  lessons: { id: string; durationMinutes: number; topics: string[] }[];
  exams: {
    id: string;
    proctored: boolean;
    durationMinutes: number;
    questions: { id: string; topic: string; points: number; correct: string[]; optionIds: string[] }[];
  }[];
};

const LETTERS = 'abcdefgh';

async function createCourse(tenantId: string, instructorId: string, spec: SeedCourse): Promise<BuiltCourse> {
  const course = await db.course.create({
    data: {
      tenantId,
      instructorId,
      title: spec.title,
      description: spec.description,
      level: spec.level,
      tags: spec.tags,
      accent: spec.accent,
      status: spec.published ? 'PUBLISHED' : 'DRAFT',
      publishedAt: spec.published ? daysAgo(40) : null,
      createdAt: daysAgo(45),
    },
  });

  const lessons: BuiltCourse['lessons'] = [];
  for (const [mi, m] of spec.modules.entries()) {
    const mod = await db.module.create({
      data: { tenantId, courseId: course.id, title: m.title, description: m.description, position: mi },
    });
    for (const [li, l] of m.lessons.entries()) {
      const lesson = await db.lesson.create({
        data: { tenantId, courseId: course.id, moduleId: mod.id, position: li, ...l },
      });
      lessons.push({ id: lesson.id, durationMinutes: l.durationMinutes, topics: l.topics });
    }
  }

  const exams: BuiltCourse['exams'] = [];
  for (const e of spec.exams) {
    const exam = await db.exam.create({
      data: {
        tenantId,
        courseId: course.id,
        title: e.title,
        description: e.description,
        durationMinutes: e.durationMinutes,
        proctored: e.proctored,
        passingScore: e.passingScore,
        status: 'PUBLISHED',
      },
    });
    const questions: BuiltCourse['exams'][number]['questions'] = [];
    for (const [qi, q] of e.questions.entries()) {
      const optionIds = q.options.map((_, i) => LETTERS[i]!);
      const correct = q.correct.map((i) => LETTERS[i]!);
      const row = await db.examQuestion.create({
        data: {
          tenantId,
          examId: exam.id,
          type: q.correct.length > 1 ? 'MULTIPLE_CHOICE' : 'SINGLE_CHOICE',
          prompt: q.prompt,
          options: q.options.map((text, i) => ({ id: optionIds[i], text })),
          correctOptionIds: correct,
          explanation: q.explanation,
          topic: q.topic,
          difficulty: q.difficulty,
          position: qi,
        },
      });
      questions.push({ id: row.id, topic: q.topic, points: 1, correct, optionIds });
    }
    exams.push({ id: exam.id, proctored: e.proctored, durationMinutes: e.durationMinutes, questions });
  }

  return { id: course.id, lessons, exams };
}

type Learner = { id: string; name: string; diligence: number; dormantDays: number };

/** Simulates a learner working through a course: progress rows + activity stream. */
async function simulateCourseProgress(tenantId: string, learner: Learner, course: BuiltCourse, maxCompleted?: number) {
  const target = maxCompleted ?? Math.round(learner.diligence * course.lessons.length);
  const completed = Math.min(target, course.lessons.length);
  const progress: Prisma.LessonProgressCreateManyInput[] = [];
  const activities: Prisma.LearningActivityCreateManyInput[] = [];

  // Spread completions across the window [dormantDays + span .. dormantDays] days ago.
  const span = Math.max(3, Math.round(28 * learner.diligence));
  for (let i = 0; i < completed; i++) {
    const lesson = course.lessons[i]!;
    const dayOffset = learner.dormantDays + Math.round(span - (span * i) / Math.max(1, completed));
    const viewedAt = daysAgo(dayOffset);
    const completedAt = new Date(viewedAt.getTime() + lesson.durationMinutes * 60_000 * between(0.8, 1.4));
    progress.push({
      tenantId,
      userId: learner.id,
      lessonId: lesson.id,
      courseId: course.id,
      status: 'COMPLETED',
      timeSpentSeconds: Math.round(lesson.durationMinutes * 60 * between(0.7, 1.5)),
      firstViewedAt: viewedAt,
      lastViewedAt: completedAt,
      completedAt,
    });
    activities.push(
      { tenantId, userId: learner.id, courseId: course.id, type: 'LOGIN', xp: 0, occurredAt: new Date(viewedAt.getTime() - 60_000) },
      { tenantId, userId: learner.id, courseId: course.id, type: 'LESSON_VIEW', xp: 2, occurredAt: viewedAt, metadata: { lessonId: lesson.id } },
      { tenantId, userId: learner.id, courseId: course.id, type: 'LESSON_COMPLETE', xp: 10, occurredAt: completedAt, metadata: { lessonId: lesson.id } },
    );
  }
  const next = course.lessons[completed];
  if (next && rand() < 0.6) {
    const at = daysAgo(learner.dormantDays + int(0, 2));
    progress.push({
      tenantId,
      userId: learner.id,
      lessonId: next.id,
      courseId: course.id,
      status: 'IN_PROGRESS',
      timeSpentSeconds: int(60, next.durationMinutes * 30),
      firstViewedAt: at,
      lastViewedAt: at,
    });
    activities.push({ tenantId, userId: learner.id, courseId: course.id, type: 'LESSON_VIEW', xp: 2, occurredAt: at, metadata: { lessonId: next.id } });
  }

  await db.lessonProgress.createMany({ data: progress });
  await db.learningActivity.createMany({ data: activities });
  if (completed === course.lessons.length) {
    await db.enrollment.update({
      where: { courseId_userId: { courseId: course.id, userId: learner.id } },
      data: { status: 'COMPLETED', completedAt: daysAgo(learner.dormantDays) },
    });
  }
  return completed;
}

/** Creates a submitted exam attempt with answers drawn from the learner's skill. */
async function simulateExamAttempt(
  tenantId: string,
  learner: Learner,
  courseId: string,
  exam: BuiltCourse['exams'][number],
  daysBack: number,
  suspicious: boolean,
) {
  const answers: Record<string, string[]> = {};
  const topicTotals: Record<string, { correct: number; total: number }> = {};
  let score = 0;
  for (const q of exam.questions) {
    const pCorrect = 0.35 + 0.6 * learner.diligence + between(-0.1, 0.1);
    const right = rand() < pCorrect;
    const wrongOptions = q.optionIds.filter((o) => !q.correct.includes(o));
    answers[q.id] = right ? q.correct : [pick(wrongOptions)];
    if (right) score += q.points;
    const t = (topicTotals[q.topic] ??= { correct: 0, total: 0 });
    t.total += 1;
    if (right) t.correct += 1;
  }
  const maxScore = exam.questions.reduce((s, q) => s + q.points, 0);
  const startedAt = daysAgo(daysBack, pick([10, 14, 19, 20]));
  const submittedAt = new Date(startedAt.getTime() + exam.durationMinutes * 60_000 * between(0.5, 0.95));

  const session = await db.examSession.create({
    data: {
      tenantId,
      examId: exam.id,
      userId: learner.id,
      status: 'SUBMITTED',
      proctored: exam.proctored,
      consentGivenAt: exam.proctored ? startedAt : null,
      startedAt,
      expiresAt: new Date(startedAt.getTime() + exam.durationMinutes * 60_000),
      submittedAt,
      answers,
      score,
      maxScore,
      percent: Math.round((score / maxScore) * 1000) / 10,
      topicScores: Object.fromEntries(Object.entries(topicTotals).map(([k, v]) => [k, v.correct / v.total])),
      reviewStatus: exam.proctored && suspicious ? 'PENDING' : 'NOT_REQUIRED',
    },
  });

  if (exam.proctored) {
    const events: Prisma.ProctoringEventCreateManyInput[] = [];
    const add = (type: ProctoringEventType, source: 'CAMERA' | 'BROWSER', offsetSec: number, durationSec: number) => {
      const s = new Date(startedAt.getTime() + offsetSec * 1000);
      events.push({
        tenantId,
        sessionId: session.id,
        type,
        source,
        startedAt: s,
        endedAt: new Date(s.getTime() + durationSec * 1000),
        durationMs: durationSec * 1000,
        confidence: source === 'CAMERA' ? Math.round(between(0.7, 0.97) * 100) / 100 : null,
      });
    };
    // Suspicious sessions cross the review policy thresholds (src/modules/proctoring/policy.ts),
    // so seeded "Needs review" sessions show the same reasons real ones would.
    if (suspicious) {
      add('LOOKING_AWAY', 'CAMERA', 95, 12);
      add('LOOKING_AWAY', 'CAMERA', 210, 14);
      add('TAB_HIDDEN', 'BROWSER', 340, 9);
      add('LOOKING_AWAY', 'CAMERA', 402, 9);
      add('TAB_HIDDEN', 'BROWSER', 610, 7);
      if (rand() < 0.5) add('MULTIPLE_FACES', 'CAMERA', 515, 4);
    } else if (rand() < 0.4) {
      add('LOOKING_AWAY', 'CAMERA', int(60, 600), int(3, 5));
    }
    if (events.length) await db.proctoringEvent.createMany({ data: events });
  }

  await db.learningActivity.create({
    data: { tenantId, userId: learner.id, courseId, type: 'EXAM_SUBMIT', xp: 25, occurredAt: submittedAt, metadata: { examId: exam.id, sessionId: session.id } },
  });
  return session;
}

function randomProfile(diligence: number) {
  const raw = { reading: between(0.2, 1), video: between(0.2, 1), interactive: between(0.2, 1) };
  const sum = raw.reading + raw.video + raw.interactive;
  const modality = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.round((v / sum) * 100) / 100]));
  const topics = ['data-literacy', 'statistics', 'probability', 'visualization', 'modeling', 'critical-thinking'];
  const topicMastery = Object.fromEntries(
    topics.map((t) => [t, Math.round(Math.min(0.98, Math.max(0.1, diligence * 0.7 + between(-0.2, 0.3))) * 100) / 100]),
  );
  const sorted = Object.entries(topicMastery).sort((a, b) => b[1] - a[1]);
  return {
    modality,
    pace: diligence > 0.7 ? 'accelerated' : diligence > 0.45 ? 'balanced' : 'steady',
    processingSpeed: Math.round(between(0.3, 0.9) * 100) / 100,
    calibration: Math.round(between(-0.4, 0.4) * 100) / 100,
    topicMastery,
    strengths: sorted.slice(0, 2).map(([t]) => t),
    growthAreas: sorted.slice(-2).map(([t]) => t),
    summary: 'Generated demo profile.',
  };
}

async function awardBadges(tenantId: string, userId: string) {
  const [completions, profile, perfect] = await Promise.all([
    db.lessonProgress.count({ where: { userId, status: 'COMPLETED' } }),
    db.cognitiveProfile.count({ where: { userId } }),
    db.examSession.count({ where: { userId, percent: 100 } }),
  ]);
  const badges: string[] = [];
  if (completions >= 1) badges.push('first-steps');
  if (completions >= 5) badges.push('five-lessons');
  if (completions >= 11) badges.push('course-complete');
  if (profile) badges.push('know-thyself');
  if (perfect) badges.push('perfect-score');
  if (badges.length) {
    await db.userBadge.createMany({ data: badges.map((badge) => ({ tenantId, userId, badge, awardedAt: daysAgo(int(0, 10)) })) });
  }
  const xp = await db.learningActivity.aggregate({ where: { userId }, _sum: { xp: true } });
  await db.user.update({ where: { id: userId }, data: { xp: xp._sum.xp ?? 0 } });
}

// ─── Tenants ─────────────────────────────────────────────────────────────────
const STUDENT_NAMES = [
  'Priya Nair', 'Liam O’Connor', 'Sofia Martínez', 'Kenji Watanabe', 'Amara Okafor', 'Noah Fischer',
  'Chloé Dubois', 'Mateo Rossi', 'Zara Ahmed', 'Ethan Brooks', 'Hana Kim',
];

async function seedRiverside(passwordHash: string) {
  const tenant = await db.tenant.create({
    data: {
      name: 'Riverside Academy',
      slug: 'riverside',
      settings: { primaryColor: 'indigo', proctoringRetentionDays: 30 },
      createdAt: daysAgo(60),
    },
  });
  const t = tenant.id;
  const user = (email: string, name: string, role: 'INSTITUTION_ADMIN' | 'INSTRUCTOR' | 'STUDENT') =>
    db.user.create({ data: { tenantId: t, email, name, role, passwordHash, lastLoginAt: daysAgo(int(0, 3)), createdAt: daysAgo(55) } });

  await user('admin@riverside.test', 'Jordan Blake', 'INSTITUTION_ADMIN');
  const instructor = await user('instructor@riverside.test', 'Dr. Maya Chen', 'INSTRUCTOR');
  const alex = await user('student@riverside.test', 'Alex Rivera', 'STUDENT');
  const others = [];
  for (const [i, name] of STUDENT_NAMES.entries()) {
    const email = `${name.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@riverside.test`;
    const u = await user(email, name, 'STUDENT');
    // Two learners are deliberately dormant + low-progress so at-risk detection has signal.
    const atRisk = i === 3 || i === 8;
    others.push({ id: u.id, name, diligence: atRisk ? between(0.12, 0.25) : between(0.35, 1), dormantDays: atRisk ? int(10, 16) : int(0, 3) });
  }

  const ds = await createCourse(t, instructor.id, dataScienceCourse);
  const writing = await createCourse(t, instructor.id, writingCourse);
  await createCourse(t, instructor.id, mlDraftCourse);

  const allStudents = [alex, ...others.map((o) => ({ id: o.id }))];
  await db.enrollment.createMany({ data: allStudents.map((s) => ({ tenantId: t, courseId: ds.id, userId: s.id, enrolledAt: daysAgo(35) })) });
  await db.enrollment.createMany({
    data: [alex, ...others.slice(0, 6)].map((s) => ({ tenantId: t, courseId: writing.id, userId: s.id, enrolledAt: daysAgo(20) })),
  });

  // Alex: module 1 done over the last three days (a live 3-day streak), no exam or
  // profile yet, so the demo can walk through both flows fresh.
  const alexLearner: Learner = { id: alex.id, name: 'Alex Rivera', diligence: 0.6, dormantDays: 0 };
  const alexActs: Prisma.LearningActivityCreateManyInput[] = [];
  for (let i = 0; i < 3; i++) {
    const lesson = ds.lessons[i]!;
    const at = daysAgo(2 - i, 19 + i);
    const done = new Date(at.getTime() + lesson.durationMinutes * 60_000);
    await db.lessonProgress.create({
      data: { tenantId: t, userId: alex.id, lessonId: lesson.id, courseId: ds.id, status: 'COMPLETED', timeSpentSeconds: lesson.durationMinutes * 60, firstViewedAt: at, lastViewedAt: done, completedAt: done },
    });
    alexActs.push(
      { tenantId: t, userId: alex.id, courseId: ds.id, type: 'LOGIN', occurredAt: new Date(at.getTime() - 60_000) },
      { tenantId: t, userId: alex.id, courseId: ds.id, type: 'LESSON_VIEW', xp: 2, occurredAt: at, metadata: { lessonId: lesson.id } },
      { tenantId: t, userId: alex.id, courseId: ds.id, type: 'LESSON_COMPLETE', xp: 10, occurredAt: done, metadata: { lessonId: lesson.id } },
    );
  }
  await db.learningActivity.createMany({ data: alexActs });
  await simulateCourseProgress(t, alexLearner, writing, 1);

  let suspiciousLeft = 2;
  for (const learner of others) {
    const done = await simulateCourseProgress(t, learner, ds);
    if (others.indexOf(learner) < 6) await simulateCourseProgress(t, learner, writing);
    if (done >= 7) {
      const suspicious = suspiciousLeft > 0 && rand() < 0.5;
      if (suspicious) suspiciousLeft--;
      await simulateExamAttempt(t, learner, ds.id, ds.exams[0]!, learner.dormantDays + int(1, 8), suspicious);
    }
    if (done >= 10) await simulateExamAttempt(t, learner, ds.id, ds.exams[1]!, learner.dormantDays + int(0, 3), false);
    if (learner.diligence > 0.3) {
      await db.cognitiveProfile.create({ data: { tenantId: t, userId: learner.id, ...randomProfile(learner.diligence) } });
      await db.learningActivity.create({ data: { tenantId: t, userId: learner.id, type: 'ASSESSMENT_COMPLETE', xp: 20, occurredAt: daysAgo(30) } });
    }
  }
  // Guarantee at least one session awaits human review for the instructor demo.
  if (suspiciousLeft === 2) {
    const learner = others.find((o) => o.diligence > 0.5) ?? others[0]!;
    await simulateExamAttempt(t, learner, ds.id, ds.exams[0]!, 1, true);
  }

  // Forum
  const priya = others[0]!;
  const thread1 = await db.forumThread.create({
    data: {
      tenantId: t, courseId: ds.id, authorId: priya.id,
      title: 'Why use the median for skewed data?',
      body: 'In the descriptive statistics lesson, why is the median preferred when data is skewed? Doesn\'t the mean use more information?',
      resolved: true, createdAt: daysAgo(6), lastActivityAt: daysAgo(5),
    },
  });
  await db.forumPost.createMany({
    data: [
      { tenantId: t, threadId: thread1.id, authorId: others[2]!.id, body: 'I think it\'s because outliers drag the mean around?', createdAt: daysAgo(6) },
      { tenantId: t, threadId: thread1.id, authorId: instructor.id, isAnswer: true, createdAt: daysAgo(5), body: 'Exactly. The mean does use every value, which is why a handful of extreme values can move it far from where most observations sit. For skewed data the median better describes a "typical" case. Report both when in doubt!' },
    ],
  });
  await db.forumThread.create({
    data: {
      tenantId: t, courseId: ds.id, authorId: others[4]!.id, pinned: false,
      title: 'Study group for the checkpoint exam?',
      body: 'Anyone want to review probability together before the checkpoint? Thinking Thursday evening.',
      createdAt: daysAgo(2), lastActivityAt: daysAgo(2),
    },
  });
  await db.forumThread.create({
    data: {
      tenantId: t, courseId: ds.id, authorId: instructor.id, pinned: true,
      title: 'Welcome! How to use this forum',
      body: 'Ask questions about any lesson here. Mark the reply that solved your problem as the answer so others can find it.',
      createdAt: daysAgo(40), lastActivityAt: daysAgo(40),
    },
  });

  // Assignment with rubric
  const rubric = [
    { id: 'question', title: 'Question quality', description: 'Specific, measurable, actionable.', levels: [
      { points: 4, label: 'Excellent', description: 'Precise question with clear measurement and comparison.' },
      { points: 2, label: 'Developing', description: 'Answerable but vague in measurement or scope.' },
      { points: 0, label: 'Missing', description: 'Not an answerable data question.' },
    ] },
    { id: 'data', title: 'Data plan', description: 'Where the data comes from and its limitations.', levels: [
      { points: 4, label: 'Excellent', description: 'Source identified; biases discussed.' },
      { points: 2, label: 'Developing', description: 'Source identified; limitations not considered.' },
      { points: 0, label: 'Missing', description: 'No data source.' },
    ] },
    { id: 'clarity', title: 'Clarity', description: 'Clear, concise writing.', levels: [
      { points: 2, label: 'Clear', description: 'Easy to follow.' },
      { points: 1, label: 'Mostly clear', description: 'Some confusing passages.' },
      { points: 0, label: 'Unclear', description: 'Hard to follow.' },
    ] },
  ];
  const assignment = await db.assignment.create({
    data: {
      tenantId: t, courseId: ds.id, title: 'Data Question Proposal',
      description: 'Propose one answerable data question about your school or community. Describe the data you would need, where it would come from, and one bias to watch for (300–500 words).',
      dueAt: daysAgo(-5, 23), rubric, maxPoints: 10, createdAt: daysAgo(10),
    },
  });
  for (const [i, s] of others.slice(0, 4).entries()) {
    const graded = i < 2;
    await db.submission.create({
      data: {
        tenantId: t, assignmentId: assignment.id, userId: s.id, submittedAt: daysAgo(int(1, 6)),
        content: 'My question: What share of students at our school use the library at least once per week, and does it differ by year group? I would use anonymized door-counter logs combined with a short survey. Non-response bias is a risk because frequent library users may be more likely to answer.',
        ...(graded && { status: 'GRADED', grades: { question: 4, data: 2, clarity: 2 }, score: 8, feedback: 'Strong question. Push further on how you would handle survey non-response.', gradedById: instructor.id, gradedAt: daysAgo(1) }),
      },
    });
    await db.learningActivity.create({ data: { tenantId: t, userId: s.id, courseId: ds.id, type: 'ASSIGNMENT_SUBMIT', xp: 15, occurredAt: daysAgo(int(1, 6)) } });
  }

  // Notifications for the demo student
  await db.notification.createMany({
    data: [
      { tenantId: t, userId: alex.id, type: 'welcome', title: 'Welcome to Riverside Academy', body: 'Take the learning profile assessment to personalize your path.', link: '/assessment', createdAt: daysAgo(3) },
      { tenantId: t, userId: alex.id, type: 'assignment', title: 'New assignment: Data Question Proposal', body: 'Due in 5 days.', link: `/courses/${ds.id}`, createdAt: daysAgo(1) },
    ],
  });

  for (const s of allStudents) await awardBadges(t, s.id);
  return tenant;
}

async function seedSummit(passwordHash: string) {
  const tenant = await db.tenant.create({ data: { name: 'Summit Institute', slug: 'summit', settings: { primaryColor: 'rose' }, createdAt: daysAgo(30) } });
  const t = tenant.id;
  await db.user.create({ data: { tenantId: t, email: 'admin@summit.test', name: 'Robin Hale', role: 'INSTITUTION_ADMIN', passwordHash } });
  const instructor = await db.user.create({ data: { tenantId: t, email: 'instructor@summit.test', name: 'Prof. Samir Patel', role: 'INSTRUCTOR', passwordHash } });
  const course = await createCourse(t, instructor.id, summitCourse);
  for (const name of ['Iris Novak', 'Tomás Silva', 'Grace Lee', 'Omar Haddad']) {
    const u = await db.user.create({
      data: { tenantId: t, email: `${name.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@summit.test`, name, role: 'STUDENT', passwordHash },
    });
    await db.enrollment.create({ data: { tenantId: t, courseId: course.id, userId: u.id } });
    await simulateCourseProgress(t, { id: u.id, name, diligence: between(0.3, 1), dormantDays: int(0, 4) }, course);
    await awardBadges(t, u.id);
  }
  return tenant;
}

async function main() {
  const reset = process.argv.includes('--reset');
  const existing = await db.tenant.findMany({ where: { slug: { in: DEMO_SLUGS } } });
  if (existing.length && !reset) {
    console.log('Demo data already present; skipping. Use `npm run db:seed -- --reset` to recreate.');
    return;
  }
  if (existing.length) {
    await db.tenant.deleteMany({ where: { slug: { in: DEMO_SLUGS } } });
    console.log('Removed existing demo tenants.');
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const platform = await db.tenant.create({ data: { name: 'Platform Administration', slug: 'platform' } });
  await db.user.create({
    data: { tenantId: platform.id, email: 'superadmin@lumen.test', name: 'Platform Admin', role: 'SUPER_ADMIN', passwordHash },
  });
  await seedRiverside(passwordHash);
  await seedSummit(passwordHash);

  const counts = await Promise.all([db.user.count(), db.lesson.count(), db.examSession.count(), db.learningActivity.count()]);
  console.log(`Seeded demo tenants: ${counts[0]} users, ${counts[1]} lessons, ${counts[2]} exam sessions, ${counts[3]} activities.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

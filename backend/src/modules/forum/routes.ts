import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Tx } from '../../lib/db.js';
import { events } from '../../lib/events.js';
import { idParam, parse } from '../../lib/validate.js';
import { auth, db, isStaff } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { recordActivity } from '../../services/activity.js';
import { notify } from '../../services/notifications.js';
import { assertCanLearn, loadCourse } from '../courses/access.js';

const ThreadBody = z.object({ title: z.string().trim().min(5).max(200), body: z.string().trim().min(1).max(10_000) });
const PostBody = z.object({ body: z.string().trim().min(1).max(10_000) });

const author = { select: { id: true, name: true, role: true } } as const;

/** Enrolled students and staff may read and post in a course forum. */
async function forumAccess(tx: Tx, req: Request, courseId: string) {
  const course = await loadCourse(tx, req, courseId);
  await assertCanLearn(tx, req, course);
  return course;
}

async function loadThread(tx: Tx, req: Request, id: string) {
  const thread = await tx.forumThread.findUnique({ where: { id } });
  if (!thread) throw new HttpError(404, 'Thread not found', 'NOT_FOUND');
  const course = await forumAccess(tx, req, thread.courseId);
  return { thread, course };
}

export function forumRouter(): Router {
  const router = Router();

  router.get('/courses/:id/threads', async (req, res) => {
    const courseId = idParam(req.params);
    const threads = await db(req, async (tx) => {
      await forumAccess(tx, req, courseId);
      return tx.forumThread.findMany({
        where: { courseId },
        orderBy: [{ pinned: 'desc' }, { lastActivityAt: 'desc' }],
        include: { author, _count: { select: { posts: true } } },
      });
    });
    res.json({ threads });
  });

  router.post('/courses/:id/threads', async (req, res) => {
    const courseId = idParam(req.params);
    const body = parse(ThreadBody, req.body);
    const a = auth(req);
    const { thread, activity } = await db(req, async (tx) => {
      await forumAccess(tx, req, courseId);
      const thread = await tx.forumThread.create({ data: { ...body, tenantId: a.tenantId, courseId, authorId: a.userId }, include: { author, _count: { select: { posts: true } } } });
      const activity = await recordActivity(tx, { tenantId: a.tenantId, userId: a.userId, courseId, type: 'FORUM_POST', metadata: { threadId: thread.id } });
      return { thread, activity };
    });
    events.emit('activity', activity);
    res.status(201).json({ thread });
  });

  router.get('/threads/:id', async (req, res) => {
    const id = idParam(req.params);
    const data = await db(req, async (tx) => {
      const { thread, course } = await loadThread(tx, req, id);
      const [full, posts] = await Promise.all([
        tx.forumThread.findUniqueOrThrow({ where: { id }, include: { author } }),
        tx.forumPost.findMany({ where: { threadId: id }, orderBy: { createdAt: 'asc' }, include: { author } }),
      ]);
      const a = auth(req);
      return {
        thread: full,
        posts,
        course: { id: course.id, title: course.title },
        canModerate: isStaff(a.role),
        canAccept: isStaff(a.role) || thread.authorId === a.userId,
      };
    });
    res.json(data);
  });

  router.post('/threads/:id/posts', async (req, res) => {
    const id = idParam(req.params);
    const body = parse(PostBody, req.body);
    const a = auth(req);
    const out = await db(req, async (tx) => {
      const { thread } = await loadThread(tx, req, id);
      const post = await tx.forumPost.create({ data: { tenantId: a.tenantId, threadId: id, authorId: a.userId, body: body.body }, include: { author } });
      await tx.forumThread.update({ where: { id }, data: { lastActivityAt: new Date() } });
      const activity = await recordActivity(tx, { tenantId: a.tenantId, userId: a.userId, courseId: thread.courseId, type: 'FORUM_POST', metadata: { threadId: id } });
      const push =
        thread.authorId !== a.userId
          ? await notify(tx, [{ tenantId: a.tenantId, userId: thread.authorId, type: 'forum', title: `${a.name} replied to “${thread.title}”`, body: body.body.slice(0, 140), link: `/courses/${thread.courseId}?tab=discussion&thread=${id}` }])
          : undefined;
      return { post, activity, push };
    });
    events.emit('activity', out.activity);
    out.push?.();
    res.status(201).json({ post: out.post });
  });

  /** Pin (staff) or mark resolved (staff or the thread author). */
  router.patch('/threads/:id', async (req, res) => {
    const id = idParam(req.params);
    const body = parse(z.object({ pinned: z.boolean().optional(), resolved: z.boolean().optional() }), req.body);
    const a = auth(req);
    const thread = await db(req, async (tx) => {
      const { thread } = await loadThread(tx, req, id);
      if (body.pinned !== undefined && !isStaff(a.role)) throw new HttpError(403, 'Only staff can pin threads', 'FORBIDDEN');
      if (body.resolved !== undefined && !isStaff(a.role) && thread.authorId !== a.userId) throw new HttpError(403, 'Only the author or staff can resolve', 'FORBIDDEN');
      return tx.forumThread.update({ where: { id }, data: body });
    });
    res.json({ thread });
  });

  /** Marks a reply as the accepted answer (and resolves the thread). */
  router.post('/posts/:id/accept', async (req, res) => {
    const id = idParam(req.params);
    const a = auth(req);
    const out = await db(req, async (tx) => {
      const post = await tx.forumPost.findUnique({ where: { id } });
      if (!post) throw new HttpError(404, 'Post not found', 'NOT_FOUND');
      const { thread } = await loadThread(tx, req, post.threadId);
      if (!isStaff(a.role) && thread.authorId !== a.userId) throw new HttpError(403, 'Only the author or staff can accept an answer', 'FORBIDDEN');
      await tx.forumPost.updateMany({ where: { threadId: thread.id }, data: { isAnswer: false } });
      await tx.forumPost.update({ where: { id }, data: { isAnswer: true } });
      await tx.forumThread.update({ where: { id: thread.id }, data: { resolved: true } });
      const push =
        post.authorId !== a.userId
          ? await notify(tx, [{ tenantId: a.tenantId, userId: post.authorId, type: 'forum', title: 'Your reply was marked as the answer', body: thread.title, link: `/courses/${thread.courseId}?tab=discussion&thread=${thread.id}` }])
          : undefined;
      return { push, authorId: post.authorId, courseId: thread.courseId };
    });
    out.push?.();
    // Re-evaluates "helpful" for the reply's author.
    events.emit('activity', { tenantId: a.tenantId, userId: out.authorId, courseId: out.courseId, type: 'FORUM_POST', xp: 0 });
    res.status(204).end();
  });

  return router;
}

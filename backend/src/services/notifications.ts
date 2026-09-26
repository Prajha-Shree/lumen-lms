import type { Notification } from '@prisma/client';
import type { Tx } from '../lib/db.js';
import { events } from '../lib/events.js';

export type NotificationInput = { tenantId: string; userId: string; type: string; title: string; body?: string; link?: string | null };

/**
 * Creates notifications inside the caller's transaction and returns a function that
 * pushes them over the realtime channel. Call it after the transaction commits, so a
 * rolled-back action never produces a phantom notification.
 */
export async function notify(tx: Tx, items: NotificationInput[]) {
  const created: Notification[] = [];
  for (const n of items) {
    created.push(await tx.notification.create({ data: { ...n, body: n.body ?? '', link: n.link ?? null } }));
  }
  return () => {
    for (const n of created) {
      events.emit('notification', { tenantId: n.tenantId, userId: n.userId, id: n.id, title: n.title, body: n.body, link: n.link, type: n.type });
    }
  };
}

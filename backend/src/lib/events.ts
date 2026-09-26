import { EventEmitter } from 'node:events';
import type { ActivityType } from '@prisma/client';

/**
 * In-process domain events. Producers (routes) emit after their transaction commits;
 * consumers (gamification, live analytics, notifications) subscribe at boot. Swap for
 * a message broker if services are split out.
 */
export type DomainEvents = {
  activity: [{ tenantId: string; userId: string; courseId?: string | null; type: ActivityType; xp: number }];
  notification: [{ tenantId: string; userId: string; id: string; title: string; body: string; link?: string | null; type: string }];
  proctoringFlag: [{ tenantId: string; sessionId: string; examId: string; courseId: string; type: string; studentName: string }];
};

class TypedEmitter extends EventEmitter {
  override emit<K extends keyof DomainEvents>(event: K, ...args: DomainEvents[K]): boolean {
    return super.emit(event, ...args);
  }
  override on<K extends keyof DomainEvents>(event: K, listener: (...args: DomainEvents[K]) => void): this {
    return super.on(event, listener as (...a: unknown[]) => void);
  }
}

export const events = new TypedEmitter();

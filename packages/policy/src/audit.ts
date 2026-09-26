import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const SafetyAuditEventTypeSchema = z.enum([
  'policy.evaluated',
  'authority.checked',
  'approval.validated',
  'idempotency.reserved',
  'idempotency.completed',
  'idempotency.duplicate',
  'execution.started',
  'execution.verified',
  'execution.committed',
  'execution.rolled_back',
  'execution.recovery_started',
  'execution.recovery_applied_verified',
  'execution.recovery_not_applied',
  'execution.recovery_ambiguous',
  'execution.reconciled'
]);

export type SafetyAuditEventType = z.infer<typeof SafetyAuditEventTypeSchema>;

export const SafetyAuditEventSchema = z.object({
  id: z.string(),
  occurredAt: z.string().datetime(),
  type: SafetyAuditEventTypeSchema,
  actorId: z.string(),
  planId: z.string().optional(),
  payload: z.record(z.unknown())
});

export type SafetyAuditEvent = z.infer<typeof SafetyAuditEventSchema>;

export interface SafetyAuditLog {
  append(event: Omit<SafetyAuditEvent, 'id'> & { id?: string }): void;
  list(): SafetyAuditEvent[];
}

export function createMemoryAuditLog(): SafetyAuditLog {
  const events: SafetyAuditEvent[] = [];
  return {
    append(event) {
      events.push({
        id: event.id ?? `aud_${randomUUID().replaceAll('-', '')}`,
        occurredAt: event.occurredAt,
        type: event.type,
        actorId: event.actorId,
        planId: event.planId,
        payload: event.payload
      });
    },
    list() {
      return [...events];
    }
  };
}

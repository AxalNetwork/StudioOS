/** D8339: publication evidence for count retention. Reads the outbox's intents; writes nothing. */
import type { CapacityEvictionGuard } from './ciCapacity.ts';
import { aggregateCapacity } from './lib/ciCapacityPolicy.ts';

type Mode = 'pilot' | 'full-suite';
const FINAL = ['success', 'failure', 'cancelled'];

/** True only when the check for the configured mode carries the request's final result, or none is owed.
 * A missing mode, a missing or unreadable intent, an unconfirmed create, a pending check and an owed
 * correction all keep the request. */
export function publicationSettled(storage: Pick<DurableObjectStorage, 'sql'>, mode: () => Mode | null): CapacityEvictionGuard {
  return (request, superseded) => {
    const current = mode();
    if (current !== 'pilot' && current !== 'full-suite') return false;
    const rows = storage.sql.exec<{ state: string }>('SELECT state FROM capacity_publications WHERE id = ?',
      `${request.submission.requestId}:${current}`).toArray();
    // The outbox never creates a check for a superseded attempt, so an attempt without one is owed nothing.
    if (!rows.length) return superseded;
    const intent = JSON.parse(rows[0].state) as { phase?: unknown; checkId?: unknown; sent?: unknown; failed?: unknown };
    if (intent.phase !== 'known' || !Number.isSafeInteger(intent.checkId) || typeof intent.sent !== 'string') return false;
    const sent = (JSON.parse(intent.sent) as { status?: unknown }).status;
    if (typeof sent !== 'string' || !FINAL.includes(sent) || request.completedAt === null) return false;
    // A settled request's result no longer moves with the clock, so its completion time stands for now.
    const owed = intent.failed === true ? 'failure'
      : aggregateCapacity({ ...request, superseded: request.superseded || superseded }, request.completedAt).status;
    // The outbox may lower a success to cancelled or failure from parent evidence; it never raises a result.
    return owed === 'success' ? true : owed === sent;
  };
}

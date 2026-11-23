/** D8339: publication evidence for the request store's retention. Reads the outbox's intents; writes nothing. */
import type { CapacityEvictionGuard } from './ciCapacity.ts';
import { aggregateCapacity } from './lib/ciCapacityPolicy.ts';

type Mode = 'pilot' | 'full-suite';
const CONCLUDED = ['success', 'failure', 'cancelled'];

/** What the check for the configured mode still owes a settled request.
 * `owed`: an unknown mode, a missing or unreadable intent, an unconfirmed create, a check still in progress,
 * or a correction not yet delivered.
 * `revisable`: a concluded check for a request that passed. The outbox re-reads the parent on each visit and
 * may still lower that check, so the request is kept for the full age limit.
 * `final`: a delivered failure or cancellation, or a superseded attempt that never had a check. */
export function publicationSettled(storage: Pick<DurableObjectStorage, 'sql'>, mode: () => Mode | null): CapacityEvictionGuard {
  return (request, superseded) => {
    const current = mode();
    if (current !== 'pilot' && current !== 'full-suite') return 'owed';
    const rows = storage.sql.exec<{ state: string }>('SELECT state FROM capacity_publications WHERE id = ?',
      `${request.submission.requestId}:${current}`).toArray();
    // The outbox never creates a check for a superseded attempt, so an attempt without one is owed nothing.
    if (!rows.length) return superseded ? 'final' : 'owed';
    const intent = JSON.parse(rows[0].state) as { phase?: unknown; checkId?: unknown; sent?: unknown; failed?: unknown };
    if (intent.phase !== 'known' || !Number.isSafeInteger(intent.checkId) || typeof intent.sent !== 'string') return 'owed';
    const sent = (JSON.parse(intent.sent) as { status?: unknown }).status;
    if (typeof sent !== 'string' || !CONCLUDED.includes(sent) || request.completedAt === null) return 'owed';
    // A settled request's result no longer moves with the clock, so its completion time stands for now.
    const result = intent.failed === true ? 'failure'
      : aggregateCapacity({ ...request, superseded: request.superseded || superseded }, request.completedAt).status;
    if (result === 'success') return 'revisable';
    return result === sent ? 'final' : 'owed';
  };
}

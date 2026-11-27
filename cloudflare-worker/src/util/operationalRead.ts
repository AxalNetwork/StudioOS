/**
 * D4858 (#4858) — the one shape an operational read reports its own state in.
 *
 * Platform's panels each said whether they could be read in their own way: `available`, `complete`, `reason`,
 * `read_at`, `last_written_at` and a hand-written caveat, in different combinations. That let two panels disagree
 * about the same fact. `OperationalReadMeta` is the common part: what state the read is in, when it was read, when
 * the source last changed, whether it is the whole answer and why not, and where it came from.
 *
 * THREE STATES, ONE RULE EACH:
 *   - `ready`: the read answered and is the whole answer (`complete: true`, no reason);
 *   - `partial`: the read answered but part of it could not be read (`complete: false`, a reason);
 *   - `unavailable`: nothing usable came back (`complete: false`, a reason; `data` is null).
 * A missing reason on a state that needs one is filled with a sentence rather than left blank, so a screen never
 * shows "partial" with nothing after it. `source_updated_at` is null when the source keeps no such time, and is
 * read as Not recorded, never as "now".
 */

export type ReadStatus = 'ready' | 'partial' | 'unavailable';

export type OperationalReadMeta = {
  status: ReadStatus;
  read_at: string;
  source_updated_at: string | null;
  complete: boolean;
  completeness_reason: string | null;
  source: string;
};

export type OperationalRead<T> = OperationalReadMeta & { data: T | null };

export const UNAVAILABLE_FALLBACK_REASON = 'This source could not be read.';
export const PARTIAL_FALLBACK_REASON = 'Part of this source could not be read, so the figures are not the whole answer.';

/** The meta of one read, from whether it answered and whether the answer is whole. */
export function readMeta(input: {
  answered: boolean;
  complete?: boolean;
  reason?: string | null;
  read_at: string;
  source: string;
  source_updated_at?: string | null;
}): OperationalReadMeta {
  const status: ReadStatus = !input.answered ? 'unavailable' : input.complete === false ? 'partial' : 'ready';
  const reason = input.reason && input.reason.trim() ? input.reason : null;
  return {
    status,
    read_at: input.read_at,
    source_updated_at: input.source_updated_at ?? null,
    complete: status === 'ready',
    completeness_reason: status === 'ready'
      ? null
      : reason ?? (status === 'unavailable' ? UNAVAILABLE_FALLBACK_REASON : PARTIAL_FALLBACK_REASON),
    source: input.source,
  };
}

/** A read and its meta together: `data` is null exactly when the read is unavailable. */
export function operationalRead<T>(data: T | null, meta: Omit<Parameters<typeof readMeta>[0], 'answered'>): OperationalRead<T> {
  const m = readMeta({ ...meta, answered: data !== null });
  return { ...m, data: m.status === 'unavailable' ? null : data };
}

/** The later of two times as SQL or ISO stamps, compared in one format; null when neither is set. */
export function laterOf(a: string | null | undefined, b: string | null | undefined): string | null {
  // A SQL `datetime()` stamp carries no zone and is UTC; an ISO one says its own.
  const ms = (s: string | null | undefined) => (s
    ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`)
    : NaN);
  const ta = ms(a);
  const tb = ms(b);
  if (Number.isNaN(ta) && Number.isNaN(tb)) return null;
  if (Number.isNaN(tb)) return a ?? null;
  if (Number.isNaN(ta)) return b ?? null;
  return ta >= tb ? (a ?? null) : (b ?? null);
}

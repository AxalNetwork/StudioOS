/**
 * D4811 (#4811) part 3 — the Agreements metric strip (board CT-01): what each
 * agreement row needs, counted over the whole union, with the same rule the
 * list filters by (`GET /api/admin/contracts?attention=…`). Pure: the route
 * (`routes/admin_contracts.ts`) loads the rows and this file says what they
 * mean. No score, and an unknown is never counted as zero.
 *
 *   - awaiting:  status sent or generated.
 *   - executed:  status signed; this year and this month by the recorded
 *                signature date, and a signed row with no date is counted in
 *                the total only, never in a period.
 *   - stalled:   awaiting, with a recorded send more than 30 days ago. An
 *                awaiting row whose send was never recorded is `unknown`, not
 *                stalled and not fresh.
 *   - repair:    a contradiction (marked signed with no execution evidence:
 *                no signature date, signed file, linked envelope or completed
 *                envelope; the rule `lib/contractLifecycle.js` draws), or a
 *                live row whose recipient is not linked to a company.
 *
 * The rows are the ones the page shows (`recorded=true`), so a count and the
 * list it opens always agree.
 */

export const STALLED_DAYS = 30;
export const ATTENTION_FILTERS = ['awaiting', 'executed', 'stalled', 'repair', 'repair_evidence', 'repair_unlinked'] as const;
export type AttentionFilter = typeof ATTENTION_FILTERS[number];
export const isAttentionFilter = (v: unknown): v is AttentionFilter => typeof v === 'string' && (ATTENTION_FILTERS as readonly string[]).includes(v);

export type AttentionRow = {
  status?: string | null; raw_status?: string | null; source?: string | null;
  sent_at?: string | null; signed_at?: string | null;
  file_key?: string | null; file_sha256?: string | null; envelope_uuid?: string | null;
  project_name?: string | null;
};

const DAY = 86_400_000;
const time = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const raw = String(v);
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw);
  return Number.isNaN(t) ? null : t;
};

export const isAwaiting = (r: AttentionRow) => r.status === 'sent' || r.status === 'generated';

/** The same evidence rule as the agreements table (`hasExecutionEvidence` in `lib/contractLifecycle.js`). */
export function hasExecutionEvidence(r: AttentionRow): boolean {
  if (r.signed_at || r.file_key || r.file_sha256 || r.envelope_uuid) return true;
  return r.source === 'esign' && r.raw_status === 'completed';
}

/** true when stalled, false when not, null when the send was never recorded. */
export function stalledOf(r: AttentionRow, now: number): boolean | null {
  if (!isAwaiting(r)) return false;
  const sent = time(r.sent_at);
  if (sent == null) return null;
  return now - sent > STALLED_DAYS * DAY;
}

export const needsEvidence = (r: AttentionRow) => r.status === 'signed' && !hasExecutionEvidence(r);
export const isUnlinked = (r: AttentionRow) => r.status !== 'void' && r.status !== 'draft' && !r.project_name;

/** Whether one row belongs to a drill-down. */
export function matchesAttention(r: AttentionRow, filter: AttentionFilter, now: number): boolean {
  switch (filter) {
    case 'awaiting': return isAwaiting(r);
    case 'executed': return r.status === 'signed';
    case 'stalled': return stalledOf(r, now) === true;
    case 'repair_evidence': return needsEvidence(r);
    case 'repair_unlinked': return isUnlinked(r);
    case 'repair': return needsEvidence(r) || isUnlinked(r);
  }
}

/** The strip's counts over every row. */
export function contractAttention(rows: readonly AttentionRow[], now: number) {
  const d = new Date(now);
  const year = d.getUTCFullYear(), month = d.getUTCMonth();
  const out = {
    awaiting: 0,
    executed: { total: 0, this_year: 0, this_month: 0, undated: 0 },
    stalled: { count: 0, unknown: 0, days: STALLED_DAYS },
    repair: { count: 0, evidence: 0, unlinked: 0 },
  };
  for (const r of rows) {
    if (isAwaiting(r)) out.awaiting += 1;
    if (r.status === 'signed') {
      out.executed.total += 1;
      const t = time(r.signed_at);
      if (t == null) out.executed.undated += 1;
      else {
        const s = new Date(t);
        if (s.getUTCFullYear() === year) {
          out.executed.this_year += 1;
          if (s.getUTCMonth() === month) out.executed.this_month += 1;
        }
      }
    }
    const st = stalledOf(r, now);
    if (st === true) out.stalled.count += 1;
    else if (st === null) out.stalled.unknown += 1;
    const ev = needsEvidence(r), un = isUnlinked(r);
    if (ev) out.repair.evidence += 1;
    if (un) out.repair.unlinked += 1;
    if (ev || un) out.repair.count += 1;
  }
  return out;
}

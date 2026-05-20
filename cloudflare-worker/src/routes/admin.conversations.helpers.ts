// Task #34 — pure helpers for the admin user-conversations endpoints.
// Extracted from `routes/admin.ts` so the CSV serialiser + onboarding
// "empty-reason" classifier can be unit-tested without dragging the
// full route file (which transitively imports Hono, auth, notify, …).
//
// Keep these functions pure — no `env`, no DB, no `fetch`. Inputs in,
// strings/objects out.

export type TranscriptRow = {
  conversation_id: number;
  role: string;
  question_id: string | null;
  content: string;
  meta_json: string | null;
  ts: string;
};

export type WriteMap = Map<string, string>; // `${conv_id}:${question_id}` -> 'table.column'

function safeParseJson(s: string | null): any {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function csvEsc(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const TRANSCRIPT_CSV_HEADER = [
  'ts', 'role', 'content', 'question_id', 'written_to', 'model', 'latency_ms',
];

/**
 * Build a message-level transcript CSV body matching the Task #34 spec
 * columns. `modelFilter`, when non-empty, drops messages whose meta_json
 * `.model` (or `.provider_model`) does not match (case-insensitive).
 *
 * Returns the CSV body (header + rows joined with `\n`) plus a count of
 * rows skipped by the model filter — exposed for the X-Export-Skipped-
 * Model response header.
 */
export function serializeTranscriptCsv(
  rows: TranscriptRow[],
  writeMap: WriteMap,
  modelFilter: string = '',
): { csv: string; skippedByModel: number; rowCount: number } {
  const out = [TRANSCRIPT_CSV_HEADER.join(',')];
  let skipped = 0;
  const want = (modelFilter || '').toLowerCase();
  for (const m of rows) {
    const meta = safeParseJson(m.meta_json);
    const rowModel: string = meta?.model || meta?.provider_model || '';
    if (want && rowModel.toLowerCase() !== want) { skipped++; continue; }
    const wrote = m.question_id ? writeMap.get(`${m.conversation_id}:${m.question_id}`) : null;
    out.push([
      csvEsc(m.ts),
      csvEsc(m.role),
      csvEsc(m.content),
      csvEsc(m.question_id || ''),
      csvEsc(wrote || ''),
      csvEsc(rowModel),
      csvEsc(meta?.latency_ms ?? meta?.latency ?? ''),
    ].join(','));
  }
  return { csv: out.join('\n'), skippedByModel: skipped, rowCount: out.length - 1 };
}

/**
 * Decide the `empty_reason` for the onboarding tab. Three buckets:
 *   - never_completed: no conversation row at all, OR conversation exists
 *     but in a non-active terminal state with zero assistant messages.
 *   - in_progress: conversation row exists in 'active' state with zero
 *     logged assistant messages (user opened the chatbot but never got
 *     past the greeting).
 *   - null: at least one message exists — the tab will render normally.
 */
export function classifyOnboardingEmpty(
  conv: { state?: string | null } | null,
  messageCount: number,
): { empty: boolean; empty_reason: 'never_completed' | 'in_progress' | null } {
  if (!conv) return { empty: true, empty_reason: 'never_completed' };
  if (messageCount > 0) return { empty: false, empty_reason: null };
  return {
    empty: true,
    empty_reason: (conv.state === 'active' ? 'in_progress' : 'never_completed'),
  };
}

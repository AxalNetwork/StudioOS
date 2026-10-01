/**
 * The Profiling page's reading of Eadwyn's question ledger — D350.
 *
 * The Lab Profiling report draws four things the skills / values / archetype
 * stores cannot produce: a "Questions answered" count, per-module progress, the
 * next questions to answer, and the last one answered. All four already have a
 * store — the advisor conversation ledger (`advisor_answers`) — and a read-only
 * route over it:
 *
 *   GET /api/advisor/progress  → `profiling` (the four fit.* modules, each with
 *                                 its confidence-weighted `total`, `answered`
 *                                 and a `confident` flag; routes/advisor.ts)
 *   GET /api/advisor/queue     → the ranked queue, a read-only peek that never
 *                                 marks a question asked (`/next-question` can
 *                                 pin one, which is a write — never used here)
 *   GET /api/advisor/answered  → captured answers, newest first
 *
 * This module is pure so it can be tested without React. Every function takes
 * a `read` — the outcome of one of those calls, classified by `ledgerRead` —
 * and returns a view with a `state`, so the page never has to guess whether an
 * empty list means "nothing yet" or "we could not look".
 *
 * THE THREE WAYS A READ ENDS, and the page draws each differently:
 *   ok       — the store answered.
 *   refused  — the Worker refused on purpose: 423 when Eadwyn is locked for
 *              this account or switched off. `message` is the Worker's own
 *              sentence (`e.message`, D258) and is printed as-is. The branch
 *              is on the HTTP status, never on the text.
 *   failed   — anything else (network, 5xx). Rendered "Unreadable" with a
 *              retry, never as zero or as an empty list.
 */

/** The ledger section every fit.* question carries — `/queue?focus=FIT`
 * pins the queue to the profiling bank, so the "next best questions" are
 * profiling questions rather than the week's build prompts. */
export const PROFILING_FOCUS = 'FIT';

/** Classify one ledger call. Never throws. */
export async function ledgerRead(promise) {
  try {
    const data = await promise;
    return { state: 'ok', data: data && typeof data === 'object' ? data : {} };
  } catch (e) {
    if (e?.status === 423) {
      return { state: 'refused', message: typeof e.message === 'string' && e.message ? e.message : null };
    }
    return { state: 'failed' };
  }
}

const pass = (read) => (read?.state === 'refused'
  ? { state: 'refused', message: read.message }
  : { state: 'failed' });

const whole = (n) => (Number.isFinite(Number(n)) && n !== null && n !== '' ? Math.max(0, Math.round(Number(n))) : null);

/**
 * The "Questions answered" KPI. `total` is Σ each module's required count —
 * the questions that bring every module to confidence — not the raw bank
 * size, so "12 / 23" reads as "answered toward a confident profile".
 */
export function questionsAnswered(read) {
  if (read?.state !== 'ok') return pass(read);
  const p = read.data.profiling;
  if (!p || typeof p !== 'object') {
    return { state: 'unrecorded', reason: 'The ledger returned no profiling block for this account.' };
  }
  if (p.applicable === false) {
    return { state: 'unrecorded', reason: 'This role has no profiling question bank, so nothing is counted.' };
  }
  const answered = whole(p.answered);
  const total = whole(p.total);
  if (answered == null || total == null) {
    return { state: 'unrecorded', reason: 'The ledger did not report a count.' };
  }
  const percent = whole(p.percent) ?? (total > 0 ? Math.round((Math.min(answered, total) / total) * 100) : null);
  return { state: 'ok', answered, total, percent, complete: p.complete === true };
}

/** Per-module rows (Skills · Work values · Archetype · Axal Fit & values). */
export function profilingModules(read) {
  if (read?.state !== 'ok') return pass(read);
  const p = read.data.profiling;
  if (!p || p.applicable === false || !Array.isArray(p.sections)) {
    return { state: 'unrecorded', reason: 'This role has no profiling question bank.' };
  }
  const rows = p.sections
    .filter((s) => s && typeof s === 'object' && s.key)
    .map((s) => ({
      key: String(s.key),
      label: String(s.label || s.key),
      answered: whole(s.answered),
      total: whole(s.total),
      percent: whole(s.percent),
      confident: s.confident === true,
    }));
  return { state: 'ok', rows };
}

/**
 * The next profiling questions, in the queue's rank order: the head of the
 * queue first, then the rest, de-duplicated by id. Only the question's own
 * prompt and importance are carried — the page never invents a count or a
 * "this improves X" claim the queue does not make.
 */
export function nextQuestions(read, limit = 3) {
  if (read?.state !== 'ok') return pass(read);
  const d = read.data;
  const seen = new Set();
  const rows = [];
  for (const q of [d.next_question, ...(Array.isArray(d.queue) ? d.queue : [])]) {
    if (!q || typeof q !== 'object' || !q.id || seen.has(q.id)) continue;
    const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : '';
    if (!prompt) continue;
    seen.add(q.id);
    rows.push({ id: String(q.id), prompt, importance: q.importance || 'normal' });
    if (rows.length >= limit) break;
  }
  if (!rows.length) return { state: d.complete === true ? 'complete' : 'empty' };
  return { state: 'ok', rows };
}

/** The most recent captured answer, for the "Last answered" line. */
export function lastAnswered(read) {
  if (read?.state !== 'ok') return pass(read);
  const list = Array.isArray(read.data.answered) ? read.data.answered : [];
  const top = list.find((a) => a && typeof a === 'object' && (a.label || a.question_id));
  if (!top) return { state: 'none' };
  return { state: 'ok', label: String(top.label || top.question_id), at: top.completed_at || null };
}

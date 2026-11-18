/**
 * D7177 (#7177, canvas D7043 boards RS-15 · 0 to RS-15 F) — what the company
 * selection, the Compare sheet and a comparison's layouts say, read from
 * `routes/research_project_comparisons.ts`. Pure, so the pages and the tests
 * read the same words.
 *
 * TWO ACTIONS, TWO LIMITS. Add to research takes up to 25 companies and
 * Compare 2 to 6; both limits are stated before any project is chosen, and a
 * control that cannot act says why in visible text.
 *
 * SAVE COPY FOLLOWS THE ANSWER. A refusal checked before any write and a
 * rollback the Worker confirmed say "nothing was added"; a failure the Worker
 * could not account for (a 5xx without `rolled_back`, a timeout, a closed
 * connection) says the save may not have finished, offers Check save status
 * and never a retry until that read answers.
 */

/** The Worker's limits (`MEMBER_LIMIT`, `ADD_LIMIT`, `TITLE_LIMIT`). */
export const COMPARE_MIN = 2;
export const COMPARE_MAX = 6;
export const ADD_MAX = 25;
export const TITLE_MAX = 160;
export const LIMIT_LINE = `Compare takes ${COMPARE_MIN} to ${COMPARE_MAX} companies · Add to research takes up to ${ADD_MAX}`;

/**
 * What the selection bar offers for `n` selected companies (RS-15 · 0's
 * selection rules): whether Add to research and Compare can act, and the
 * visible reason when one cannot. `compareNote` is a note, not a refusal.
 */
export function selectionRules(n) {
  const count = Math.max(0, Number(n) || 0);
  const over = count - COMPARE_MAX;
  const canCompare = count >= COMPARE_MIN && count <= COMPARE_MAX;
  const canAdd = count >= 1 && count <= ADD_MAX;
  return {
    count,
    canAdd,
    addWhy: count > ADD_MAX ? `Add to research takes up to ${ADD_MAX}. Remove ${count - ADD_MAX}.` : null,
    canCompare,
    compareWhy: count > ADD_MAX ? null
      : count < COMPARE_MIN ? `Select ${COMPARE_MIN} to ${COMPARE_MAX} to compare`
        : over > 0 ? `Compare holds at most ${COMPARE_MAX}. Remove ${over} to compare.` : null,
    compareNote: count === COMPARE_MAX ? 'At the comparison limit' : null,
    over: count > COMPARE_MAX,
  };
}

/** "6 selected · 2 on other pages": how many picks were made on another page than `page`. */
export function otherPages(picks, page) {
  return picks.filter((p) => Number.isFinite(p.page) && p.page !== page).length;
}

/** The generated title, as the Worker makes it: whole names, " …" kept inside the limit. */
export function generatedTitle(names, limit = TITLE_MAX) {
  const kept = [];
  for (const name of names) {
    if ([...kept, name].join(' · ').length <= limit) { kept.push(name); continue; }
    while (kept.length && `${kept.join(' · ')} …`.length > limit) kept.pop();
    return kept.length ? `${kept.join(' · ')} …` : `${String(names[0]).slice(0, limit - 1)}…`;
  }
  return kept.join(' · ');
}

/** One request id per Compare sheet: every attempt from the sheet sends it. */
export function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Statuses the Worker sends only for a request it checked and refused before writing. */
const REFUSED_BEFORE_WRITE = new Set([400, 401, 403, 404, 409, 422]);
/** Whether a thrown error is a refusal made before any write (a 503 `directory_unreadable` is one). */
export const refusedBeforeWrite = (err) => Boolean(err) && (REFUSED_BEFORE_WRITE.has(err.status) || (err.status === 503 && err.code === 'directory_unreadable'));

/**
 * A save's answer as one of the canvas's outcomes. `res` is the reply of a
 * resolved call; `err` the thrown error (`status`, `code`, `data` from
 * `request()`). A 503 `directory_unreadable` is a refusal before any write.
 */
export function saveOutcome({ res, err } = {}) {
  if (!err) return res?.item?.uid ? { kind: 'ok', repeat: Boolean(res.repeat) } : { kind: 'unknown' };
  if (err.data && err.data.rolled_back === true) return { kind: 'rolled_back' };
  if (refusedBeforeWrite(err)) return { kind: 'refused', code: err.code || null };
  return { kind: 'unknown' };
}

/** The outcome panel's words and the region it speaks in (RS-15 B, RCC03). */
export const OUTCOME_COPY = {
  saving: { chip: 'Saving', head: 'Saving the comparison…', body: 'Keep this panel open. The selection and title are locked until the Worker answers.', role: 'status' },
  ok: { chip: 'Saved', head: 'Comparison saved', role: 'status' },
  refused: { chip: 'Refused', head: 'Refused before saving — nothing was added', role: 'alert' },
  rolled_back: { chip: 'Rolled back · confirmed', head: 'Not saved — nothing was added', role: 'alert' },
  unknown: { chip: 'Outcome unknown', head: 'The save may not have finished', body: 'The connection closed before the Worker answered. Some, all or none of it may be saved. Don’t create it again yet.', role: 'alert' },
};

/** "“T” is in “P” with 6 columns. All 6 companies are in the project." */
export function savedSentence(res) {
  const n = Number(res?.item?.members || 0);
  return `“${res?.item?.title || ''}” is in “${res?.project?.title || ''}” with ${n} ${n === 1 ? 'column' : 'columns'}. All ${n} ${n === 1 ? 'company is' : 'companies are'} in the project.`;
}

/** The rollback sentence, naming the project when one was chosen. */
export function rolledBackSentence(projectTitle, count) {
  const where = projectTitle ? ` in “${projectTitle}”` : '';
  return `The Worker confirmed that it undid every write: no comparison and no new companies${where}. Your ${count} ${count === 1 ? 'company is' : 'companies are'} still selected.`;
}

/** Check save status (RCC03B): the read's answer, or Unavailable when the read failed. */
export function statusView({ res, err } = {}) {
  if (err || !res) return { kind: 'unreadable', chip: 'Unavailable', head: 'Couldn’t check the save', body: 'The status read failed. The outcome is still unknown; don’t create the comparison again yet.' };
  if (res.state === 'saved' && res.item?.uid) {
    const n = Number(res.item.members || 0);
    return { kind: 'saved', chip: 'Found · saved', head: 'It was saved', body: `“${res.item.title}” was saved in “${res.project?.title || ''}” with ${n} ${n === 1 ? 'column' : 'columns'}.`, res };
  }
  if (res.state === 'not_found') return { kind: 'not_found', chip: 'Not found', head: 'Not saved — safe to try again', body: 'The Worker has no record of this request. Trying again sends the same request id, so it can’t make two.' };
  return { kind: 'unreadable', chip: 'Unavailable', head: 'Couldn’t check the save', body: 'The status read gave no answer. The outcome is still unknown; don’t create the comparison again yet.' };
}

/**
 * Comparisons the old one-by-one save could leave behind (D7043 ⚑, option A):
 * a set of fewer than two columns, or the same columns as an earlier set. They
 * are flagged "Saved part-way"; the member completes or deletes them, and
 * nothing is merged or removed for them.
 */
export function partWay(sets) {
  const seen = new Map();
  const flags = new Map();
  for (const set of sets || []) {
    const key = `${set.kind}:${(set.members || []).map((m) => m.uid).join('|')}`;
    if ((set.members || []).length < COMPARE_MIN) flags.set(set.uid, { reason: 'short', text: `Saved part-way: this comparison has ${(set.members || []).length === 1 ? '1 column' : 'no columns'}. Complete it or delete it.` });
    else if (seen.has(key)) flags.set(set.uid, { reason: 'duplicate', text: `Saved part-way: the same columns as “${seen.get(key)}”. Keep it, or delete it.` });
    if (!seen.has(key)) seen.set(key, set.title);
  }
  return flags;
}

/** The tablet pager: three companies at a time, never a half-visible column. */
export const TABLET_COLUMNS = 3;
export function columnPage(count, page, size = TABLET_COLUMNS) {
  const pages = Math.max(1, Math.ceil(count / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  const from = p * size;
  return { page: p, pages, from, to: Math.min(count, from + size) };
}

/** The phone attribute stepper wraps around: the step before the first is the last. */
export const stepAttribute = (index, by, count) => (count ? (((index + by) % count) + count) % count : 0);

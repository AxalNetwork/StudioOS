/**
 * Lab Customer Discovery — the derivations over the evidence stores that
 * already exist (D351). Pure, so they are tested without React.
 *
 *   * PAIN SEVERITY (migration 211, `interview_pain_severities`). The pain-groups
 *     view reports, per theme, how many DISTINCT interviews called it a need and
 *     how many a nice-to-have, plus `severity_recorded` for the whole project.
 *     There are two severities, not the canvas's three: "good-to-have" is not a
 *     value the store accepts (`PAIN_SEVERITIES`), so it is never drawn as a
 *     band — the remainder of a theme's interviews is "not judged", which is the
 *     true state of those mentions.
 *   * COMPANY (migration 211, `interviewee_company`). The log interview modal
 *     used to fold the company into `interviewee_role` as "Role · Company". It is
 *     a column of its own; legacy rows written the old way are still split for
 *     display, and re-saved into the column the next time they are edited.
 *   * FOLLOW-UPS. The waitlist DTO names the CRM field `crm_status`; the page
 *     read `status`, which the DTO does not carry, so the third follow-up never
 *     marked `discovery_followups_mapped`. A follow-up is counted from
 *     `followed_up_at` — a later "Convert" moves `crm_status` on to `promoted`,
 *     and a lead that was followed up and then converted was still followed up.
 *   * READS. Each of the page's four reads resolves to `{ ok, data }` or
 *     `{ failed: true }`, so a failed read is drawn Unreadable rather than as
 *     an empty list — "no interviews" and "could not read the interviews" are
 *     different claims.
 */

/** Classify one read. Never throws. */
export async function evidenceRead(promise) {
  try {
    return { ok: true, data: await promise };
  } catch (e) {
    return { failed: true, status: e?.status ?? null };
  }
}

/** The interviews array out of a successful listInterviews read. */
export function interviewsOf(read) {
  if (!read?.ok) return null;
  const d = read.data;
  if (Array.isArray(d)) return d;
  return Array.isArray(d?.interviews) ? d.interviews : [];
}

/** The signups array out of a successful waitlist read. */
export function signupsOf(read) {
  if (!read?.ok) return null;
  return Array.isArray(read.data?.signups) ? read.data.signups : [];
}

const count = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * Severity split for one ranked pain row. `mentions` is the theme's interview
 * count; need + nice never exceed it, and the rest are "not judged".
 * Returns null when the project has no severity on file at all, so the page
 * says so instead of drawing every bar as unjudged.
 */
export function severitySplit(row, severityRecorded) {
  if (!severityRecorded || !row) return null;
  const mentions = count(row.count);
  const need = Math.min(count(row.need_count), mentions);
  const nice = Math.min(count(row.nice_count), mentions - need);
  return { mentions, need, nice, unjudged: mentions - need - nice };
}

/**
 * Role and company for display and for the edit form. The column wins; a
 * legacy row written as "Role · Company" is split on the first separator.
 */
export function roleAndCompany(iv) {
  const rawRole = String(iv?.interviewee_role || '');
  const column = typeof iv?.interviewee_company === 'string' ? iv.interviewee_company.trim() : '';
  if (column) return { role: rawRole.trim(), company: column, legacy: false };
  const sep = rawRole.indexOf(' · ');
  if (sep === -1) return { role: rawRole.trim(), company: '', legacy: false };
  return { role: rawRole.slice(0, sep).trim(), company: rawRole.slice(sep + 3).trim(), legacy: true };
}

/** How many leads have been followed up, counting the one just actioned. */
export function followUpsAfter(signups, actionedId) {
  const list = Array.isArray(signups) ? signups : [];
  return list.filter((s) => s && s.followed_up_at && s.id !== actionedId).length + 1;
}

/** The two values the severity store accepts, in the order they are offered. */
export const SEVERITY_OPTIONS = [
  { value: 'need', label: 'Need-to-have' },
  { value: 'nice', label: 'Nice-to-have' },
];

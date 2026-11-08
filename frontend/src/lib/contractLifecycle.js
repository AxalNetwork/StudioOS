// D4811 (#4811) part 1 — the three lifecycles of HQ › Contracts, and the
// safety overlays, as one vocabulary (board CT91). Pure: nothing here fetches.
//
// Each object kind keeps its own words, read from the values the Worker
// already stores. No stored value changes:
//
//   Templates   Draft → Under legal review → Approved for use → Superseded / Archived
//   Agreements  Prepared → Ready for signature → Sent → Executed / Voided
//   Governance  Draft → In review → Approved → Executed → Archived
//
// Only an executed instrument carries the filled "Executed" seal. "Approved
// for use" is an outline (dashed) pill and never filled. Every state is a
// glyph plus words, so colour is never the only cue (board CT93).

/** The visual treatments a badge may take: `seal` is filled, `outline` is dashed. */
export const TREATMENTS = Object.freeze(['plain', 'progress', 'outline', 'seal', 'void']);

export const TEMPLATE_STATES = Object.freeze({
  draft: { label: 'Draft', glyph: '✎', treatment: 'plain' },
  under_review: { label: 'Under legal review', glyph: '◷', treatment: 'progress' },
  approved: { label: 'Approved for use', glyph: '✓', treatment: 'outline' },
  superseded: { label: 'Superseded', glyph: '⤳', treatment: 'plain' },
  archived: { label: 'Archived', glyph: '▣', treatment: 'plain' },
});

export const AGREEMENT_STATES = Object.freeze({
  prepared: { label: 'Prepared', glyph: '○', treatment: 'plain' },
  ready: { label: 'Ready for signature', glyph: '◔', treatment: 'progress' },
  sent: { label: 'Sent', glyph: '➤', treatment: 'progress' },
  executed: { label: 'Executed', glyph: '●', treatment: 'seal' },
  voided: { label: 'Voided', glyph: '⊘', treatment: 'void' },
});

export const GOVERNANCE_STATES = Object.freeze({
  draft: { label: 'Draft', glyph: '✎', treatment: 'plain' },
  reviewed: { label: 'In review', glyph: '◑', treatment: 'progress' },
  approved: { label: 'Approved', glyph: '✓', treatment: 'plain' },
  executed: { label: 'Executed', glyph: '●', treatment: 'seal' },
  archived: { label: 'Archived', glyph: '▣', treatment: 'plain' },
});

export const OVERLAYS = Object.freeze({
  restricted: { label: 'Restricted', glyph: '🔒', title: 'Restricted — Legal review required' },
  incomplete: { label: 'Incomplete', glyph: '◌', title: 'Template incomplete' },
});

/** The sentence an incomplete template carries, wherever it is shown (board CT10). */
export const INCOMPLETE_LINE = 'This document has not yet been completed and cannot be used to generate an agreement.';

const SYSTEMS = Object.freeze({ template: TEMPLATE_STATES, agreement: AGREEMENT_STATES, governance: GOVERNANCE_STATES });

/** One state's badge: `{ system, key, label, glyph, treatment }`. An unknown key is null. */
export function lifecycleBadge(system, key) {
  const s = SYSTEMS[system]?.[key];
  return s ? { system, key, ...s } : null;
}

// ---- Templates ------------------------------------------------------------

function storedStub(row) {
  return !!row?.is_stub && Number(row.is_stub) !== 0;
}

/**
 * The overlays a template row carries. The Worker computes them
 * (`services/templateSafety.ts`, as `safety`); a row read before it did falls
 * back to the same rule from the row's own fields (`counsel_review`, a stub or
 * blank body), so the page never offers what the API refuses.
 */
export function templateOverlays(row) {
  const s = row?.safety;
  if (s && typeof s === 'object') {
    return {
      restricted: !!s.restricted, restrictedReason: s.restricted ? s.restricted_reason || null : null,
      incomplete: !!s.incomplete, incompleteReason: s.incomplete ? s.incomplete_reason || null : null,
    };
  }
  const incomplete = storedStub(row) || (row?.body_md !== undefined && !String(row.body_md ?? '').trim());
  return { restricted: !!row?.counsel_review, restrictedReason: null, incomplete, incompleteReason: null };
}

/**
 * The template's lifecycle state from stored values:
 * - `is_active = 0` → Archived;
 * - a version older than the recorded publication (a history row) → Superseded;
 * - restricted (counsel has not reviewed it) → Under legal review;
 * - a recorded publication, and neither overlay → Approved for use;
 * - anything else → Draft.
 */
export function templateLifecycle(row, { version } = {}) {
  if (row && row.is_active !== undefined && Number(row.is_active) === 0) return lifecycleBadge('template', 'archived');
  const published = Number.isInteger(row?.published_version) ? row.published_version : null;
  const v = Number.isInteger(version) ? version : null;
  if (v != null && published != null && v < published) return lifecycleBadge('template', 'superseded');
  const o = templateOverlays(row);
  if (o.restricted) return lifecycleBadge('template', 'under_review');
  if (published != null && !o.incomplete) return lifecycleBadge('template', 'approved');
  return lifecycleBadge('template', 'draft');
}

/**
 * The gating render rule (boards CT09, CT10, CT92). While either overlay
 * applies, Generate, Use template and Publish are not rendered at all, and
 * the banner says why. Withdraw, edit and preview stay available.
 */
export function templateActions(row) {
  const o = templateOverlays(row);
  const blocked = o.restricted || o.incomplete;
  const banner = o.restricted
    ? { kind: 'restricted', title: OVERLAYS.restricted.title, reason: o.restrictedReason || 'Counsel has not reviewed this template’s text.' }
    : o.incomplete ? { kind: 'incomplete', title: OVERLAYS.incomplete.title, reason: INCOMPLETE_LINE } : null;
  return {
    canGenerate: !blocked, canUseTemplate: !blocked, canPublish: !blocked,
    overlays: [o.restricted && 'restricted', o.incomplete && 'incomplete'].filter(Boolean),
    banner,
    unavailable: blocked ? ['Generate agreement', 'Use template', 'Publish'] : [],
  };
}

/** The words for a 409 the Worker answers on a gated template action, or null. */
export function templateRefusalMessage(error) {
  const code = error?.code ?? error?.data?.code;
  if (code === 'template_restricted') {
    // The Worker's sentence already starts with the title; any other wording is not shown as its reason.
    const said = [error?.data?.message, error?.data?.error, error?.message].find((t) => typeof t === 'string' && t.startsWith(OVERLAYS.restricted.title));
    return said || `${OVERLAYS.restricted.title}. Counsel has not reviewed this template’s text. Nothing was generated, sent or published.`;
  }
  if (code === 'template_has_no_body') return `${OVERLAYS.incomplete.title}. ${INCOMPLETE_LINE}`;
  return null;
}

// ---- Agreements -----------------------------------------------------------

/**
 * The agreement's lifecycle from the Contracts union's `status`
 * (`routes/admin_contracts.ts`): draft → Prepared, generated → Ready for
 * signature, sent → Sent, signed → Executed, void → Voided.
 */
export function agreementLifecycle(row) {
  switch (row?.status) {
    case 'signed': return lifecycleBadge('agreement', 'executed');
    case 'void': return lifecycleBadge('agreement', 'voided');
    case 'sent': return lifecycleBadge('agreement', 'sent');
    case 'generated': return lifecycleBadge('agreement', 'ready');
    case 'draft': return lifecycleBadge('agreement', 'prepared');
    default: return null;
  }
}

/**
 * Whether a signed row has evidence that it was executed: a signature date, a
 * signed file, a linked envelope, or (for an esign row) the completed envelope
 * the status was read from.
 */
export function hasExecutionEvidence(row) {
  if (!row) return false;
  if (row.signed_at || row.file_key || row.file_sha256 || row.envelope_uuid) return true;
  return row.source === 'esign' && row.raw_status === 'completed';
}

/** A date as the agreements table writes it ("12 May 2026"), or null. */
export function dayOf(value) {
  if (!value) return null;
  const raw = String(value);
  const stamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  const t = Date.parse(stamp);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString('en-GB', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * What one agreements row says (board CT02). A missing signature date on an
 * unsigned agreement is expected and not flagged; a missing company link is
 * "Unlinked recipient"; the only warning is a contradiction.
 *
 * Returns `{ badge, line, sentMissing, company, warning }`:
 * - `line`: "Sent 12 May 2026 · Awaiting signature", "Executed 3 Jun 2026", …
 * - `sentMissing`: an awaiting row whose send was never recorded (a neutral note);
 * - `company`: `{ name }` or `{ unlinked: true, label: 'Unlinked recipient' }`;
 * - `warning`: null, or the contradiction's words.
 */
export function agreementRowSemantics(row) {
  const badge = agreementLifecycle(row);
  const sent = dayOf(row?.sent_at);
  const signed = dayOf(row?.signed_at);
  let line = badge?.label ?? null;
  let sentMissing = false;
  let warning = null;
  if (row?.status === 'sent' || row?.status === 'generated') {
    if (sent) line = `Sent ${sent} · Awaiting signature`;
    else { line = 'Awaiting signature'; sentMissing = row?.status === 'sent'; }
  } else if (row?.status === 'signed') {
    if (!hasExecutionEvidence(row)) { warning = 'Marked signed · no execution evidence'; line = null; }
    else line = signed ? `Executed ${signed}` : 'Executed';
  } else if (row?.status === 'void') {
    const voided = dayOf(row?.voided_at);
    line = voided ? `Voided ${voided}` : 'Voided';
  }
  const company = row?.project_name ? { name: row.project_name } : { unlinked: true, label: 'Unlinked recipient' };
  const days = row?.status === 'signed' && Number.isFinite(row?.days_to_sign) ? row.days_to_sign : null;
  return { badge: warning ? null : badge, line, sentMissing, company, warning, days };
}

// ---- Governance -----------------------------------------------------------

/** Governance's stored statuses (D4563) in its own words: review reads "In review": D4563 lets it return to draft, so it is a state of being reviewed, not a finished review. */
export const GOVERNANCE_KEYS = Object.freeze({ draft: 'draft', review: 'reviewed', approved: 'approved', executed: 'executed', archived: 'archived' });
export function governanceLifecycle(status) {
  const key = GOVERNANCE_KEYS[status];
  return key ? lifecycleBadge('governance', key) : null;
}

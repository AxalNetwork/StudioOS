// D4811 (#4811) part 1 — the three lifecycles of HQ › Contracts, and the
// safety overlays, as one vocabulary (board CT91). Pure: nothing here fetches.
//
// Each object kind keeps its own words, read from the values the Worker
// already stores. No stored value changes:
//
//   Templates   Draft → Under legal review → Approved for use → Superseded / Archived
//   Agreements  Prepared → Ready for signature → Sent → Executed / Voided
//               (a closing line's paper too, D4811 part 22)
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
  // D4811 part 22: the canvas's pill (`ST['agr:Sent']`) reads "Sent · awaiting signature".
  sent: { label: 'Sent · awaiting signature', glyph: '➤', treatment: 'progress' },
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
 * D4811 part 22 (owner, 2026-11-13: "Executed everywhere"). The stored and
 * API value stays `signed`; only the words change. The metric strip already
 * said Executed, and these are the words the agreements list's status chips
 * and its sort read, so the chip, the filter and the strip say one thing.
 * `AgreementList.jsx` draws its chips and its sort from these lists (part 23).
 */
export const AGREEMENT_STATUS_FILTERS = Object.freeze([
  Object.freeze(['All', '']),
  Object.freeze(['Awaiting signature', 'awaiting_signature']),
  Object.freeze([AGREEMENT_STATES.executed.label, 'signed']),
  Object.freeze([AGREEMENT_STATES.voided.label, 'void']),
]);

/** The agreements list's sort choices as `[value, label]`; `signed_at` is the API's field, read as the executed date. */
export const AGREEMENT_SORT_OPTIONS = Object.freeze([
  Object.freeze(['sent_at:desc', 'Sent, newest']),
  Object.freeze(['sent_at:asc', 'Sent, oldest']),
  Object.freeze(['title:asc', 'Title']),
  Object.freeze(['recipient:asc', 'Recipient']),
  Object.freeze(['signed_at:desc', 'Executed, newest']),
  Object.freeze(['days_to_sign:asc', 'Days to sign']),
]);

/** The one contradiction an agreement row flags (board CT-02), in the owner's word. */
export const NO_EVIDENCE_WARNING = 'Marked executed · no execution evidence';

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

/**
 * D4811 part 11: the stores whose agreement can be linked to a company (the
 * Worker's `LINKABLE_SOURCES`, `services/contractAttention.ts`). Only these
 * read "Unlinked recipient" and offer the Link repair; a pairwise NDA, a
 * partner deal or a licence agreement has no company link to make.
 */
export const LINKABLE_SOURCES = Object.freeze(['documents', 'esign']);
export const canLinkCompany = (row) => LINKABLE_SOURCES.includes(String(row?.source ?? ''));

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
 * - `company`: `{ name }`, `{ unlinked: true, label: 'Unlinked recipient' }` in a store
 *   that can be linked (part 11), or `{ none: true, label }` in one that cannot;
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
    if (!hasExecutionEvidence(row)) { warning = NO_EVIDENCE_WARNING; line = null; }
    else line = signed ? `Executed ${signed}` : 'Executed';
  } else if (row?.status === 'void') {
    const voided = dayOf(row?.voided_at);
    line = voided ? `Voided ${voided}` : 'Voided';
  }
  const company = row?.project_name ? { name: row.project_name }
    : canLinkCompany(row) ? { unlinked: true, label: 'Unlinked recipient' }
      : { none: true, label: 'No company link in this store' };
  const days = row?.status === 'signed' && Number.isFinite(row?.days_to_sign) ? row.days_to_sign : null;
  return { badge: warning ? null : badge, line, sentMissing, company, warning, days };
}

// ---- Closings --------------------------------------------------------------

/**
 * D4811 part 22 (owner, 2026-11-13: question B, answer A). A closing line's
 * paper takes the agreement lifecycle instead of its own words. The paper is
 * D1216's staged envelope as `GET /api/legal/esign/staged/line/:id` returns it
 * (`services/stagedSigning.ts` `readStaged`): `complete`, `voided`, `countersign`
 * and each stage's `state`. Nothing stored changes; this only reads it.
 *
 * - every stage signed (`complete`) → Executed, "countersigned for Axal" when Axal signed last;
 * - some stage sent or signed → Sent · awaiting signature, with who it waits on;
 * - no stage sent yet → Ready for signature (the paper is generated: its text and digest are stored);
 * - only voided papers → Voided;
 * - no paper → no state, "No paper sent": nothing is drawn as Prepared, because
 *   no closing store records a paper before it is generated.
 *
 * Two states have no lifecycle word and are not forced into one (D4811-p22,
 * question D on #4811): a signer declined, and a signer's envelope was voided
 * while the paper itself was not. Each keeps its words and draws no pill.
 * The closing's own Open / Closed / Cancelled is the round's state, not a
 * document's, and is not read here.
 *
 * D4811 part 24: what the read cannot say is not drawn as a lifecycle state.
 * A list that is not a list (a failed or malformed read) and a live paper with
 * a stage state the Worker never writes read "Unreadable"; a live paper with
 * no stage recorded reads "Not recorded". None of them is "No paper sent" or
 * "Ready for signature".
 *
 * Returns `{ key, badge, detail, text }`; `text` is the badge's words and the detail, as one line.
 */
export const CLOSING_PAPER_UNMAPPED = Object.freeze({
  declined: 'Declined',
  stage_void: 'A signer’s envelope was voided',
});

/** What a closing paper reads where the record cannot say (D4811 part 24). */
export const CLOSING_PAPER_HONESTY = Object.freeze({ unreadable: 'Unreadable', unrecorded: 'Not recorded' });

/** The stage states `readStaged` writes (`services/stagedSigning.ts` `StageView`); any other is unreadable. */
export const CLOSING_STAGE_STATES = Object.freeze(['waiting', 'awaiting_release', 'sent', 'signed', 'declined', 'void']);

export function closingPaperLifecycle(envelopes) {
  const out = (key, badge, detail = null) => ({ key, badge, detail, text: [badge?.label, detail].filter(Boolean).join(' · ') });
  if (!Array.isArray(envelopes)) return out('unreadable', null, CLOSING_PAPER_HONESTY.unreadable);
  const list = envelopes.filter(Boolean);
  const live = list.find((e) => !e.voided);
  if (!live) return list.length ? out('voided', lifecycleBadge('agreement', 'voided')) : out('none', null, 'No paper sent');
  // `complete` is the Worker's own reading: every stage, Axal's countersign included, has a signature recorded.
  if (live.complete === true) {
    return out('executed', lifecycleBadge('agreement', 'executed'), live.countersign ? 'countersigned for Axal' : null);
  }
  if (!Array.isArray(live.stages) || !live.stages.length) return out('unrecorded', null, CLOSING_PAPER_HONESTY.unrecorded);
  const stages = live.stages;
  if (stages.some((s) => !CLOSING_STAGE_STATES.includes(s?.state))) return out('unreadable', null, CLOSING_PAPER_HONESTY.unreadable);
  if (stages.some((s) => s?.state === 'declined')) return out('declined', null, CLOSING_PAPER_UNMAPPED.declined);
  if (stages.some((s) => s?.state === 'void')) return out('stage_void', null, CLOSING_PAPER_UNMAPPED.stage_void);
  const signed = stages.filter((s) => s?.state === 'signed').length;
  const moving = stages.some((s) => s?.state === 'sent' || s?.state === 'awaiting_release') || signed > 0;
  if (!moving) return out('ready', lifecycleBadge('agreement', 'ready'), 'not sent yet');
  const detail = stages.some((s) => s?.state === 'awaiting_release') ? 'waiting for Axal’s countersign' : `${signed} of ${stages.length} signed`;
  return out('sent', lifecycleBadge('agreement', 'sent'), detail);
}

// ---- Governance -----------------------------------------------------------

/** Governance's stored statuses (D4563) in its own words: review reads "In review": D4563 lets it return to draft, so it is a state of being reviewed, not a finished review. */
export const GOVERNANCE_KEYS = Object.freeze({ draft: 'draft', review: 'reviewed', approved: 'approved', executed: 'executed', archived: 'archived' });
export function governanceLifecycle(status) {
  const key = GOVERNANCE_KEYS[status];
  return key ? lifecycleBadge('governance', key) : null;
}

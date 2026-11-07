/**
 * D4681 (#4681, Expertise P2) — what Services, Proof and Thinking say about
 * themselves, pure: no React and no fetch. `ServicesZone.jsx`,
 * `ProofZone.jsx` and `ThinkingZone.jsx` draw it.
 *
 * THREE RULES THIS FILE HOLDS:
 *   · a service is the advisor's own record. It is not on the public profile
 *     and it cannot be booked: founders book session types and booking links
 *     (`GET /api/advisors/:uid` returns those two and nothing else);
 *   · no proof is published. `is_public` is stored, but no page shows a proof
 *     item to anyone else, and publishing waits on the attestation rules (P1);
 *   · an article's state says who can read it and what the writer does next,
 *     from the statuses `routes/articles.ts` actually writes.
 */

// ─────────────────────────────────────────────────────────── Services

export const SERVICE_STATES = Object.freeze([
  { id: true, label: 'Active', hint: 'In your records as something you offer now.' },
  { id: false, label: 'Inactive', hint: 'Kept in your records as no longer offered.' },
]);
export const serviceStateLabel = (row) => (row?.is_active ? 'Active' : 'Inactive');
export const SERVICE_NOT_PUBLIC = 'A service is your own record. It is not on your public profile, and nobody can book it.';
export const SERVICE_BOOKABLE = 'What a founder can book is a session type, and a public booking link to it. Those are set in Practice › Sessions.';
export const SESSIONS_PATH = '/practice/sessions';
export const CURRENCY_RE = /^[A-Za-z]{3}$/;

/**
 * The PATCH body for an edit: only what changed, so an unchanged field is not
 * re-sent. `cents` is the parsed price (null for blank). Returns `{ error }`
 * when a field cannot be saved, and `{ body: {} }` when nothing changed.
 */
export function serviceEditBody(row, draft, cents) {
  const title = String(draft?.title ?? '').trim();
  if (!title) return { error: 'A service needs a title.' };
  const currency = String(draft?.currency ?? '').trim().toUpperCase() || 'USD';
  if (!CURRENCY_RE.test(currency)) return { error: 'A currency is three letters, such as USD.' };
  const next = {
    title,
    kind: draft?.kind || 'fixed',
    price_cents: cents ?? null,
    currency,
    duration_note: String(draft?.duration_note ?? '').trim() || null,
    scope: String(draft?.scope ?? '').trim() || null,
    is_active: draft?.is_active !== false,
  };
  const body = {};
  for (const [k, v] of Object.entries(next)) {
    const was = k === 'is_active' ? !!row?.[k] : (row?.[k] ?? null);
    if (was !== v) body[k] = v;
  }
  return { body };
}

/** The edit form's starting values, from a saved row. */
export function serviceDraftOf(row) {
  return {
    title: row?.title || '',
    kind: row?.kind || 'fixed',
    price: row?.price_cents == null ? '' : (Number(row.price_cents) / 100).toFixed(2).replace(/\.00$/, ''),
    currency: row?.currency || 'USD',
    duration_note: row?.duration_note || '',
    scope: row?.scope || '',
    is_active: !!row?.is_active,
  };
}

// ─────────────────────────────────────────────────────────── Proof

export const PROOF_NOT_PUBLIC = 'Nothing in Proof is on your public profile. Publishing a claim waits on the rules for what an attestation must show, so for now every item is private to you.';

/** What deleting a proof item takes with it, said before it happens. */
export function proofDeleteLines(item) {
  const consents = item?.consents || [];
  const names = consents.map((c) => c.attester_name).filter(Boolean);
  // D4670: a row carries its `state`; an earlier confirmation that needs reconfirming has no link out.
  const pending = consents.filter((c) => (c.state ? c.state === 'pending' : !c.consent_given && !c.withdrawn_at)).length;
  const lines = [
    consents.length
      ? `It also deletes ${consents.length === 1 ? 'the consent record' : `all ${consents.length} consent records`} behind it (${names.join(', ')}): names, emails and statements.`
      : 'No one has been asked to confirm it, so nothing else goes with it.',
  ];
  if (pending) lines.push(`${pending === 1 ? 'The link you sent stops' : `The ${pending} links you sent stop`} working.`);
  lines.push('It cannot be undone. Axal keeps no copy to restore it from.');
  return lines;
}
export const proofDeleteTitle = (item) => `Delete “${item?.title || 'this claim'}”?`;
export const proofDeletedLine = (n) => (n ? `Deleted, with ${n === 1 ? 'its consent record' : `its ${n} consent records`}.` : 'Deleted.');
export const PROOF_DELETE_FAILED = 'Nothing was deleted. The claim and its consents are as they were.';

// ─────────────────────────────────────────────────────────── Thinking

/**
 * Each article state, as the writer reads it: the label, who can read the
 * piece, and the one next step. `next.to` is a real route (App.jsx):
 * `/articles/edit/:id` is the editor, `/articles/:slug` the public reader.
 */
const STAGES = {
  draft: { label: 'Draft', tone: 'neutral', audience: 'Only you can read it.', next: 'Keep writing' },
  submitted: { label: 'Submitted', tone: 'info', audience: 'Only you and Axal’s editors can read it. It waits for an editor.', next: 'Open in the editor' },
  in_review: { label: 'In review', tone: 'info', audience: 'Only you and Axal’s editors can read it. An editor is reading it, so it is locked.', next: 'See its status' },
  changes_requested: { label: 'Changes requested', tone: 'warn', audience: 'Only you and Axal’s editors can read it. The editor’s notes are in the editor.', next: 'Make the changes' },
  rejected: { label: 'Not accepted', tone: 'warn', audience: 'Only you can read it. You can revise it and send it again.', next: 'Revise and resend' },
  approved: { label: 'Approved', tone: 'ok', audience: 'Accepted, not public yet. An editor publishes it.', next: 'Open in the editor' },
  scheduled: { label: 'Scheduled', tone: 'ok', audience: null, next: 'Open in the editor' },
  published: { label: 'Published', tone: 'ok', audience: 'Public: anyone with the link can read it.', next: 'Read it' },
};
export const ARTICLE_STAGE_KEYS = Object.freeze(Object.keys(STAGES));

const day = (iso) => String(iso || '').slice(0, 10);

/** An approved piece with a time set is Scheduled (D484); everything else is its own status. */
export function stageKey(a) {
  if (a?.status === 'approved' && a?.publish_at) return 'scheduled';
  return STAGES[a?.status] ? a.status : null;
}

export function articleStage(a) {
  const key = stageKey(a);
  if (!key) {
    return { key: 'unknown', label: String(a?.status || 'Not recorded'), tone: 'neutral', audience: 'Who can read it is not recorded.', next: { label: 'Open in the editor', to: `/articles/edit/${a?.id}` } };
  }
  const s = STAGES[key];
  const audience = key === 'scheduled' ? `Accepted, not public yet. It goes public on ${day(a.publish_at)}.` : s.audience;
  const to = key === 'published' && a?.slug ? `/articles/${a.slug}` : `/articles/edit/${a?.id}`;
  return { key, label: s.label, tone: s.tone, audience, next: { label: key === 'published' && !a?.slug ? 'Open in the editor' : s.next, to } };
}

/** One revision row, as the History list reads it (D1406's author read). */
export function revisionLine(r) {
  const at = STAGES[r?.status_at_save]?.label || r?.status_at_save || null;
  return {
    key: r?.rev,
    title: `Revision ${r?.rev}`,
    line: [day(r?.created_at), r?.saved_by_name ? `saved by ${r.saved_by_name}` : null, at ? `while ${at.toLowerCase()}` : null, r?.reason || null].filter(Boolean).join(' · '),
  };
}

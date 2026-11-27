/**
 * D1234 (#3242, part 6 of #2384) — Businesses (KYC6, KYC17a) and one
 * business's case (KYC7, KYC7b, KYC8) as pure rules, over part 3's reads
 * (D1231, `routes/kyb_admin.ts` at `/api/kyc/businesses`, `kybApi`).
 *
 * WHAT IS READ. The queue (`GET /`) returns each case's kind, legal name,
 * entity type, masked registration number, jurisdiction, status, when it was
 * submitted and reviewed, and whether its owners are disclosed, oldest first,
 * with counts by status. The case (`GET /:id`) adds the entity, the owners
 * and their identity checks, directors, documents, the registry, due
 * diligence (read only) and the history; each block is `available: false`
 * when unreadable, or `recorded: false` with its reason when missing.
 *
 * WHAT IS NOT READ, so never drawn as a figure: who a case is assigned to,
 * how many of a case's owners are checked in the queue (the case says), and
 * Send to HQ for a business (no Worker route takes it).
 */
import { STATUS_WORD } from './kycModel.js';

export const BUSINESSES = '/admin/kyc/businesses';
const UID = /^(company|account|import|studio)-[1-9][0-9]{0,9}$/;

/** One business's case. A uid that is not the Worker's shape opens the queue. */
export function businessHref(uid) {
  return UID.test(String(uid ?? '')) ? `${BUSINESSES}/${uid}` : BUSINESSES;
}
export const isBusinessUid = (v) => UID.test(String(v ?? ''));

/** The canvas's kind words (KYC6), each the Worker's `kind`. */
export const KIND_WORD = Object.freeze({
  founder_company: 'Company',
  investing_entity: 'Investing entity',
  partner_firm: 'Partner firm',
  imported_partner: 'Imported',
  licensed_studio: 'Licensed studio',
});
export const kindWord = (k) => KIND_WORD[k] || 'Not recorded';

/** The Worker's business statuses in the canvas's words; `in_review` is Waiting. */
export const pillStatus = (s) => (s === 'in_review' ? 'pending' : s);
export const businessStatusWord = (s) => (s === 'dismissed' ? 'Dismissed' : STATUS_WORD[pillStatus(s)] || 'Not recorded');

/** The kind chips (KYC6); Licensed studios only for the Super Admin (KYC17a). */
export function kindChips(superAdmin) {
  return [['', 'All'], ['founder_company', 'Companies'], ['investing_entity', 'Investing entities'], ['partner_firm', 'Partner firms'],
    ['imported_partner', 'Imported'], ...(superAdmin ? [['licensed_studio', 'Licensed studios']] : [])];
}
export const STATUS_CHIPS = [['', 'Every status'], ['in_review', 'Waiting'], ['needs_info', 'Needs information'], ['approved', 'Approved'],
  ['rejected', 'Rejected'], ['expired', 'Expired'], ['not_started', 'Not started'], ['dismissed', 'Dismissed']];

/** The query the queue reads; empty values are left out by the client. */
export function queueQuery(f, page = 1) {
  return { q: String(f?.q || '').trim().slice(0, 120), status: f?.status || '', kind: f?.kind || '', page, limit: 25 };
}

const DAY = 86_400_000;
const ms = (v) => {
  if (!v) return NaN;
  const s = String(v);
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
};
/** "11 days", "1 day", "Today"; null when the time is not recorded. */
export function waitingFor(at, now = Date.now()) {
  const t = ms(at);
  if (!Number.isFinite(t)) return null;
  const d = Math.max(0, Math.floor((now - t) / DAY));
  return d === 0 ? 'Today' : `${d} ${d === 1 ? 'day' : 'days'}`;
}
/** "12 Oct 2026"; null when not recorded. */
export function dayWord(at) {
  const t = ms(at);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null;
}

/** The four tiles (KYC6) from the queue's counts by status. A count the read lacks is Not recorded, never 0. */
export function tiles(read, now = Date.now()) {
  if (!read || !Array.isArray(read.counts)) return null;
  const by = new Map(read.counts.map((r) => [r.status, r]));
  const n = (s) => Number(by.get(s)?.n || 0);
  const waitingRows = ['in_review', 'not_started'].map((s) => by.get(s)).filter(Boolean);
  const oldest = waitingRows.map((r) => r.oldest_at).filter(Boolean).sort()[0] || null;
  return [
    { key: 'waiting', label: 'Waiting', value: String(n('in_review') + n('not_started')), note: oldest ? `Oldest: ${waitingFor(oldest, now)}` : 'None waiting' },
    { key: 'needs', label: 'Needs documents', value: String(n('needs_info')), note: 'Waiting on the business' },
    { key: 'approved', label: 'Approved', value: String(n('approved')), note: 'Valid for 24 months' },
    { key: 'rejected', label: 'Rejected', value: String(n('rejected')), note: n('expired') ? `${n('expired')} expired` : 'None expired' },
  ];
}

/** One queue row as the table draws it. */
export function rowOf(b, now = Date.now()) {
  return {
    uid: b.uid, href: businessHref(b.uid), name: b.entity_name || 'Name not recorded',
    sub: [b.entity_type, b.registration_number].filter(Boolean).join(' · ') || 'Entity type not recorded',
    kind: kindWord(b.kind), jurisdiction: b.jurisdiction || 'Jurisdiction not recorded', status: b.status,
    waiting: ['in_review', 'not_started', 'needs_info'].includes(b.status) ? waitingFor(b.submitted_at, now) || 'Not recorded' : '—',
    owners: b.kind === 'imported_partner' && !b.linked_user_id ? 'No account yet' : b.owners_disclosed ? 'Disclosed' : 'Not disclosed',
    ownersWarn: !b.owners_disclosed, highRisk: !!b.high_risk_country, canReview: b.can_review !== false,
    reviewed: dayWord(b.reviewed_at) || 'Not yet',
  };
}

/** "1–9 of 9", "0 businesses". */
export function countText(read) {
  const total = Number(read?.total);
  if (!Number.isSafeInteger(total) || total < 0) return 'Count not recorded';
  if (!total) return '0 businesses';
  const page = Number(read.page) || 1, limit = Number(read.limit) || 25;
  return `${(page - 1) * limit + 1}–${Math.min(total, page * limit)} of ${total}`;
}

// ---------------------------------------------------------------- the case

/** A block: `{ state: 'ok', value }`, `{ state: 'missing', reason }` or `{ state: 'unreadable' }`. */
export function blockOf(b) {
  if (Array.isArray(b)) return { state: 'ok', value: b };
  if (!b || b.available === false) return { state: 'unreadable' };
  if (b.recorded === false) return { state: 'missing', reason: b.reason || 'Not recorded.' };
  return { state: 'ok', value: b.value };
}

/** The owners of 25% or more, and whether each is checked. A share not recorded counts as relevant, as the Worker counts it. */
export function ownerRows(block) {
  const b = blockOf(block);
  if (b.state !== 'ok') return b;
  const rows = (b.value || []).map((o) => {
    const relevant = o.ownership_pct == null || o.ownership_pct >= 25;
    return {
      index: o.index, name: o.name || 'Name not recorded', share: o.ownership_pct == null ? 'Not recorded' : `${o.ownership_pct}%`,
      nationality: o.nationality || 'Not recorded', dob: o.date_of_birth || null, userId: o.user_id || null,
      kyc: o.kyc_status || null, kycReason: o.kyc_reason || null, relevant, checked: o.kyc_status === 'approved',
      sanctions: blockOf(o.sanctions),
    };
  });
  const relevant = rows.filter((r) => r.relevant);
  return { state: 'ok', value: rows, unchecked: relevant.filter((r) => !r.checked), relevantCount: relevant.length,
    total: rows.reduce((s, r) => s + (r.share.endsWith('%') ? Number(r.share.slice(0, -1)) : 0), 0) };
}

/** Which decisions a case offers (KYC7, KYC7b). The Worker refuses anything else. */
export function actionsOf(c) {
  if (!c) return [];
  if (c.can_review === false) return [];
  if (c.status === 'dismissed') return [];
  const out = [];
  const unlinkedImport = c.kind === 'imported_partner' && !c.linked_user_id;
  if (unlinkedImport) out.push('link', 'dismiss');
  if (c.status !== 'approved') out.push('documents', 'reject', 'approve');
  else out.push('reject');
  return out;
}

/** Why Approve is not yet possible, or null. The Worker checks the same before it approves. */
export function approveBlocker(c, owners) {
  if (!c?.owners_disclosed) return 'Owners are not disclosed yet. Ask for the register of shareholders.';
  if (owners.state !== 'ok') return owners.state === 'unreadable' ? 'The owners could not be read, so the check cannot be approved yet.' : 'Owners have not been recorded, so the check cannot be approved yet.';
  return null;
}

export const REASON_MIN = 5;
export const REASON_MAX = 2000;
export const reasonProblem = (r) => {
  const n = String(r || '').trim().length;
  if (n < REASON_MIN) return `Give a reason of at least ${REASON_MIN} characters.`;
  if (n > REASON_MAX) return `Keep the reason to ${REASON_MAX} characters.`;
  return null;
};

/** The body Approve sends (KYC8 A); `unchecked_owner_reason` only when an owner of 25% or more is not checked. */
export function approveBody(f, owners) {
  const needsReason = owners.state === 'ok' && owners.unchecked.length > 0;
  return {
    registry_matches: f.registry === true, owners_identified: f.identified === true, owners_checked_or_explained: f.checked === true,
    ...(f.goodStanding === 'yes' ? { good_standing: true } : f.goodStanding === 'no' ? { good_standing: false } : {}),
    ...(needsReason ? { unchecked_owner_reason: String(f.reason || '').trim() } : {}),
    ...(String(f.note || '').trim() ? { note: String(f.note).trim() } : {}),
  };
}
/** What stops Approve's confirm button, or null. */
export function approveProblem(f, owners) {
  if (!f.registry || !f.identified || !f.checked) return 'Confirm the three checks first.';
  if (owners.state === 'ok' && owners.unchecked.length && reasonProblem(f.reason)) {
    return `${owners.unchecked.map((o) => `${o.name} (${o.share})`).join(', ')} ${owners.unchecked.length === 1 ? 'has' : 'have'} no approved identity check. Say why you approve now.`;
  }
  return null;
}

/** KYC8 C: the documents to ask for, the Worker's kinds. */
export const DOC_KINDS = [['incorporation', 'Certificate of incorporation'], ['shareholders', 'A certified register of shareholders'],
  ['registered_address', 'Proof of registered address'], ['other', 'Something else']];
export const docKindWord = (k) => DOC_KINDS.find(([v]) => v === k)?.[1] || 'Document';
export function requestText(name, kinds) {
  const words = DOC_KINDS.filter(([k]) => kinds.includes(k)).map(([, w]) => w.charAt(0).toLowerCase() + w.slice(1));
  if (!words.length) return '';
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return `To finish the business check for ${name || 'your business'}, we need ${list}.`;
}

/** The history's words, from the stored action. */
export const EVENT_WORDS = {
  kyb_owners_updated: 'Owners recorded', kyb_approved: 'Approved', kyb_rejected: 'Rejected', kyb_documents_requested: 'Documents asked for',
  kyb_import_dismissed: 'Import dismissed', kyb_import_linked: 'Linked to an account', kyb_document_uploaded: 'Document added',
};
export const eventWord = (a) => EVENT_WORDS[a] || 'Recorded';

/** How a write's refusal reads; a changed case asks for a fresh read. */
export function refusalOf(e) {
  const code = e?.data?.error || e?.data?.code || null;
  if (code === 'kyb_changed' || e?.status === 409 && !code) return { changed: true, line: 'The case changed while you had it open. Read it again before deciding.' };
  return { changed: false, line: e?.data?.detail || e?.message || 'That was not saved. Nothing was changed.' };
}

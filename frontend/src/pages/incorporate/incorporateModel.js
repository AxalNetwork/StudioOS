/**
 * D1414 (#3696, INC1–INC7) — Incorporate's words and derivations, pure, so
 * the tests read them without a browser.
 *
 * The flow has six steps on its rail: Tell us your goals · Compare
 * jurisdictions · Company details · Review · Pay & file · Done. On a phone
 * the rail is a line: "Step 3 of 6 · Company details".
 *
 * WHAT IT NEVER INVENTS. The price is the catalog quote's one amount (owner
 * answer Q5): no itemised breakdown, and "The state fee is confirmed at
 * filing." The status timeline is the order's own fields (D601): Submitted
 * is `paid_at`, Packet ready is `packet_document_id`, Filed is `filed_on`.
 * EIN is its own row (D579), never a status. There is no plan gate (Q6).
 *
 * THE BANK STEP (#4356, D4356). The owner chose Mercury, which settled Q7.
 * "Open a bank account" names Mercury and links to its account opening:
 * the owner's referral link when one is configured (`VITE_MERCURY_REFERRAL_URL`,
 * never in the code), else Mercury's public site. The step is done only when
 * the founder's own Mercury is connected and active (`GET
 * /api/mercury/personal/status`), never from a guess. On the status timeline
 * it comes after Filed, so it shows once the company is formed.
 */
import { PAID_STATUSES } from '../../lib/incorporationPricing.js';

export const STEPS = Object.freeze([
  { id: 'goals', label: 'Tell us your goals' },
  { id: 'compare', label: 'Compare jurisdictions' },
  { id: 'details', label: 'Company details' },
  { id: 'review', label: 'Review' },
  { id: 'pay', label: 'Pay & file' },
  { id: 'done', label: 'Done' },
]);
export const stepLine = (i) => `Step ${i + 1} of ${STEPS.length} · ${STEPS[i]?.label || ''}`;

export const TITLE = 'Incorporate your company';
export const LINE = 'Turn a project into a legal company, filed by Axal VC and linked to your workspace.';
export const OWN_ONLY = 'Only your own projects are listed.';
export const NOT_YOURS = 'You don’t have access to this project. Pick one of your own projects.';
export const RANGES = 'Costs and timelines are ranges. The exact total shows before you pay.';
export const STATE_FEE = 'The state fee is confirmed at filing.';
export const OFFICERS_LATER = 'You record these on the company once it exists.';
export const DECLINED = 'Your card was declined. Nothing was charged.';
export const WAITING_FILING = 'Waiting for Axal VC to record the filing';
export const SAVED_HERE = 'Your answers are saved on this device. Pick up where you left off.';

/** The four goal questions' answer → the jurisdiction recommended (the wizard's rule, unchanged). */
export function recommend(answers = {}) {
  if (answers.raisingVc === 'yes_us') return 'us_de_ccorp';
  if (answers.raisingVc === 'yes_eu') return 'uk_ltd';
  if (answers.region === 'apac') return 'sg_pte';
  if (answers.minimalCost === 'yes' && answers.raisingVc !== 'yes_us') return 'ee_oy';
  if (answers.entityPref === 'llc') return 'us_de_llc';
  return 'us_de_ccorp';
}

const usd = (n) => (Number.isFinite(Number(n)) ? `$${Number(n).toLocaleString('en-US')}` : null);
const range = (r, fmt) => (Array.isArray(r) && r.length === 2 ? `${fmt(r[0])}–${fmt(r[1])}` : null);

/** A jurisdiction card's words, from the Worker's fields only (`GET /api/legal/jurisdictions`). */
export function jurisdictionCard(j) {
  return {
    id: j.id,
    label: j.label,
    pill: j.fundraising_friendly ? { label: 'VC-friendly', tone: 'ok' } : { label: 'Limited VC', tone: 'neutral' },
    summary: j.summary || null,
    cost: range(j.est_cost_usd, usd),
    timeline: Array.isArray(j.time_to_form_days) ? `${j.time_to_form_days[0]}–${j.time_to_form_days[1]} days` : null,
    pros: (j.pros || []).slice(0, 2),
    cons: (j.cons || []).slice(0, 2),
  };
}

/**
 * The projects Incorporate may form a company from: the caller's own (the
 * owner's seat in `GET /api/account/projects`), never the every-venture
 * `GET /api/projects`. A seat that is not the owner's is not listed.
 */
export function ownProjects(read) {
  const list = Array.isArray(read?.projects) ? read.projects : [];
  return list.filter((p) => p.my_seat === 'owner').map((p) => ({
    id: p.id, name: String(p.name || '').trim() || 'Untitled project',
    sub: p.company_uid ? `In ${p.company_name || 'a company'}` : 'Not in a company',
    companyUid: p.company_uid || null,
  }));
}

/** `?project=<id>`: the project it names when it is yours; `refused` when it names one you do not own. */
export function prefill(own, raw) {
  if (raw == null || String(raw).trim() === '') return { id: null, refused: false };
  const hit = (own || []).find((p) => String(p.id) === String(raw));
  return hit ? { id: hit.id, refused: false, name: hit.name } : { id: null, refused: true };
}

/** The co-founder agreement's status from `GET /api/legal/documents?project_id=`. */
export function cofounderStatus(docs) {
  if (!Array.isArray(docs)) return { kind: 'unread' };
  const mine = docs.filter((d) => d.template_name === 'cofounder_agreement');
  const signed = mine.find((d) => d.status === 'signed');
  if (signed) return { kind: 'signed', on: signed.signed_at || null };
  if (mine.length) return { kind: 'drafted' };
  return { kind: 'none' };
}

const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? `${Number(m[3])} ${M[Number(m[2]) - 1]}` : null;
}

/**
 * INC3b's status timeline, from the order's own row (D601). Each step is done
 * or waiting, with the date the row holds; nothing is marked done that the
 * row does not record. EIN is not a status (it is its own row, D579).
 */
export function timeline(order) {
  const paid = !!order && (PAID_STATUSES.includes(order.status) || !!order.paid_at);
  const packet = !!order?.packet_document_id || order?.status === 'packet_ready' || order?.status === 'filed';
  const filed = order?.status === 'filed';
  return [
    { key: 'submitted', label: 'Submitted', done: paid, line: paid ? `Paid${order?.paid_at ? ` · ${shortDay(order.paid_at)}` : ''}` : 'Waiting for payment' },
    { key: 'packet', label: 'Packet ready', done: packet, line: packet ? 'Your founder documents are prepared' : 'Waiting for Axal VC to prepare your founder documents' },
    { key: 'filed', label: 'Filed', done: filed, line: filed ? `Filed with the state${order?.filed_on ? ` · ${shortDay(order.filed_on)}` : ''}` : WAITING_FILING },
  ];
}

/** INC4's 83(b) card from `GET /api/legal/83b/trackers?project_id=`: "Due 29 Nov · 29 days left", or null when none is recorded. */
export function deadline83b(read) {
  const list = Array.isArray(read?.trackers) ? read.trackers : null;
  if (!list) return { kind: 'unread' };
  const open = list.find((t) => !t.mailed_at && t.deadline_date);
  if (!open) return { kind: 'none' };
  const left = Number(open.days_left);
  return { kind: 'due', line: `Due ${shortDay(open.deadline_date)}${Number.isFinite(left) ? (left >= 0 ? ` · ${left} day${left === 1 ? '' : 's'} left` : ' · overdue') : ''}`, overdue: !!open.overdue };
}

// ---------------------------------------------------------------- the device draft (INC5a)

export const DRAFT_KEY = 'incorporate:draft';

/** The answers kept on this device. A store that throws or holds junk reads as no draft. */
export function loadDraft(store = globalThis.localStorage) {
  try {
    const raw = store?.getItem(DRAFT_KEY);
    const d = raw ? JSON.parse(raw) : null;
    return d && typeof d === 'object' && Number.isInteger(d.step) ? d : null;
  } catch { return null; }
}
/** Keep the answers on this device; a store that throws keeps nothing and the flow goes on. */
export function saveDraft(draft, store = globalThis.localStorage) {
  try { store?.setItem(DRAFT_KEY, JSON.stringify(draft)); return true; } catch { return false; }
}
export function clearDraft(store = globalThis.localStorage) {
  try { store?.removeItem(DRAFT_KEY); } catch { /* nothing kept */ }
}

// ---------------------------------------------------------------- the bank step (#4356, D4356)

/** Mercury's public site, where "Open account" starts its sign-up; used until the owner configures a referral link. */
export const MERCURY_PUBLIC_URL = 'https://mercury.com/';
export const BANK_TITLE = 'Open a bank account';
export const BANK_LINES = Object.freeze({
  todo: 'Open your company’s business account with Mercury, Axal’s bank partner. Then connect it here so Axal can read it.',
  connect: 'Already have a Mercury account? Connect it, and this step is done.',
  done: 'Your Mercury account is connected.',
  attention: 'Your Mercury connection needs attention. Reconnect it to finish this step.',
  unread: 'Whether your Mercury is connected could not be read.',
  reading: 'Reading…',
});

/**
 * The link to open a Mercury account: the configured referral link when it is
 * an https address on mercury.com (or a subdomain), else the public site. A
 * malformed or off-site value is never linked to.
 */
export function mercuryOpenUrl(configured) {
  const raw = typeof configured === 'string' ? configured.trim() : '';
  if (!raw) return MERCURY_PUBLIC_URL;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (u.protocol === 'https:' && (host === 'mercury.com' || host.endsWith('.mercury.com')) && !u.username && !u.password) return u.toString();
  } catch { /* not an address */ }
  return MERCURY_PUBLIC_URL;
}

/**
 * The step's state from `GET /api/mercury/personal/status` (`undefined` while
 * reading, `'unread'` when it failed): done only when connected and active.
 *   { kind: 'reading' | 'unread' | 'todo' | 'attention' | 'done', done, line }
 */
export function bankStepOf(status) {
  if (status === undefined) return { kind: 'reading', done: false, line: BANK_LINES.reading };
  if (status === 'unread' || !status || typeof status !== 'object') return { kind: 'unread', done: false, line: BANK_LINES.unread };
  if (status.connected === true && status.connection?.status === 'active') return { kind: 'done', done: true, line: BANK_LINES.done };
  if (status.connected === true) return { kind: 'attention', done: false, line: BANK_LINES.attention };
  return { kind: 'todo', done: false, line: BANK_LINES.todo };
}

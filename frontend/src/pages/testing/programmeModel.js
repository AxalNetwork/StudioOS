// D815 (#2261) — the rules the partner's testing programmes (D4) and HQ ›
// Product testing (D5) share. Pure, so both pages and their tests read one copy.
// The data is D812's (frontend/src/lib/api/productTesting.js, routes/testing.ts).

/** How each Worker status reads to a person (prompt 2, boards D4 and D5). */
export const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Waiting for HQ',
  approved: 'Approved',
  open: 'Open',
  testing: 'Testing',
  closed: 'Closed',
  rejected: 'Sent back',
};

/** The Pill tone for each status. */
export const STATUS_TONE = {
  draft: 'neutral',
  submitted: 'warn',
  approved: 'info',
  open: 'ok',
  testing: 'info',
  closed: 'neutral',
  rejected: 'danger',
};

/** The order programmes are grouped in, newest work first. */
export const STATUS_ORDER = ['submitted', 'rejected', 'draft', 'approved', 'open', 'testing', 'closed'];

export const statusLabel = (s) => STATUS_LABEL[s] || 'Unknown status';
export const statusTone = (s) => STATUS_TONE[s] || 'neutral';

/** Who may apply, in the Worker's role keys, with the words a page shows. */
export const ROLE_OPTIONS = [
  ['founder', 'Founders'],
  ['investor', 'Investors'],
  ['advisor', 'Advisors'],
  ['partner', 'Operating partners'],
  ['exploring', 'Exploring members'],
];
export const MAX_QUESTIONS = 5;

/** The application statuses as the owner reads them. */
export const APPLICATION_LABEL = {
  applied: 'Applied',
  picked: 'Picked',
  declined: 'Not this time',
  withdrawn: 'Withdrawn',
};

/** "[n] of [n] places filled", from the Worker's counts. */
export function placesLine(p) {
  const places = Number(p?.places);
  const picked = Number(p?.picked_count ?? 0);
  if (!Number.isFinite(places) || places <= 0) return 'Places not recorded';
  return `${picked} of ${places} places filled`;
}

/** A programme can be edited while it is a draft, or once HQ sent it back. */
export const isEditable = (p) => p?.status === 'draft' || p?.status === 'rejected';
/** Only a draft goes to HQ (a sent-back one returns to draft on its next save). */
export const isSubmittable = (p) => p?.status === 'draft' && p?.owner_kind !== 'hq';
/** Testers are picked once the programme has opened (D812). */
export const isPickable = (p) => ['open', 'testing', 'closed'].includes(p?.status);
/** What HQ can do to a programme's status, as D812 allows it. */
export function hqSteps(p) {
  if (!p) return [];
  if (p.status === 'submitted' && p.owner_kind === 'partner') return ['approve', 'reject'];
  if ((p.owner_kind === 'hq' && p.status === 'draft') || (p.owner_kind === 'partner' && p.status === 'approved')) return ['open'];
  if (p.status === 'open' || p.status === 'testing') return ['close'];
  return [];
}

/** Pick takes an applied or declined application; decline an applied or picked one. */
export const canPick = (a) => a?.status === 'applied' || a?.status === 'declined';
export const canDecline = (a) => a?.status === 'applied' || a?.status === 'picked';

/** Programmes grouped by status, in `STATUS_ORDER`, empty groups dropped. */
export function byStatus(items) {
  const list = Array.isArray(items) ? items : [];
  return STATUS_ORDER
    .map((status) => ({ status, label: statusLabel(status), items: list.filter((p) => p?.status === status) }))
    .filter((g) => g.items.length > 0);
}

/** A blank form, or one filled from a programme being edited. */
export function formFrom(p) {
  const day = (v) => (typeof v === 'string' && v ? v.slice(0, 10) : '');
  return {
    product_name: p?.product_name || '',
    summary: p?.summary || '',
    tester_tasks: p?.tester_tasks || '',
    time_needed: p?.time_needed || '',
    opens_at: day(p?.opens_at),
    closes_at: day(p?.closes_at),
    testing_starts: day(p?.testing_starts),
    testing_ends: day(p?.testing_ends),
    places: p?.places ? String(p.places) : '',
    eligible_roles: Array.isArray(p?.eligible_roles) ? [...p.eligible_roles] : [],
    questions: Array.isArray(p?.questions) ? [...p.questions] : [],
  };
}

/**
 * The form as D812's body, or `{ error }` with the sentence to show. The Worker
 * checks the same things; this catches them before a round trip.
 */
export function formToPayload(form) {
  const f = form || {};
  const name = String(f.product_name || '').trim();
  if (!name) return { error: 'Name the product being tested.' };
  const places = Number(String(f.places || '').trim());
  if (!Number.isSafeInteger(places) || places < 1 || places > 10000) {
    return { error: 'Places is a whole number from 1 to 10000.' };
  }
  const roles = (Array.isArray(f.eligible_roles) ? f.eligible_roles : []).filter((r) => ROLE_OPTIONS.some(([k]) => k === r));
  if (roles.length === 0) return { error: 'Choose who can apply.' };
  const questions = (Array.isArray(f.questions) ? f.questions : []).map((q) => String(q || '').trim()).filter(Boolean);
  if (questions.length > MAX_QUESTIONS) return { error: `Ask up to ${MAX_QUESTIONS} questions.` };
  const pairs = [['opens_at', 'closes_at', 'Applications close before they open.'], ['testing_starts', 'testing_ends', 'Testing ends before it starts.']];
  for (const [a, z, why] of pairs) {
    if (f[a] && f[z] && f[a] > f[z]) return { error: why };
  }
  const text = (k) => (String(f[k] || '').trim() || null);
  const date = (k) => (f[k] ? f[k] : null);
  return {
    payload: {
      product_name: name,
      summary: text('summary'),
      tester_tasks: text('tester_tasks'),
      time_needed: text('time_needed'),
      opens_at: date('opens_at'),
      closes_at: date('closes_at'),
      testing_starts: date('testing_starts'),
      testing_ends: date('testing_ends'),
      places,
      eligible_roles: roles,
      questions,
    },
  };
}

/** The Worker's own sentence for a refusal, or a fallback in words; never a bare code. */
export function refusalText(e, fallback) {
  const msg = String(e?.message || '').trim();
  if (msg && !/^[a-z_]+$/.test(msg) && msg !== 'Request failed') return msg;
  return fallback;
}

/** The dates line on a card: "Applications 1 Nov – 15 Nov · Testing 16 Nov – 30 Nov". */
export function datesLine(p) {
  const fmt = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  };
  const span = (a, z) => {
    const x = fmt(a), y = fmt(z);
    if (x && y) return `${x} – ${y}`;
    return x ? `from ${x}` : y ? `until ${y}` : null;
  };
  const parts = [];
  const apps = span(p?.opens_at, p?.closes_at);
  const test = span(p?.testing_starts, p?.testing_ends);
  if (apps) parts.push(`Applications ${apps}`);
  if (test) parts.push(`Testing ${test}`);
  return parts.length ? parts.join(' · ') : 'Dates not set';
}

/** The sentence every owner reads above their applicants. */
export const MAIL_NOTE = 'Testers hear from you through Axal VC Mail.';

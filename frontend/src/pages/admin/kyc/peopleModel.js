/**
 * D1233 (#3241, KYC part 5) — People and one person's case, from the owner's
 * canvas "KYC & KYB" (KYC1–KYC5, KYC11–KYC16). Pure, so
 * `frontend/test/kyc_people_d1233.test.mjs` holds each rule.
 *
 * WHAT IS READ. Part 1's queue (`GET /api/kyc/admin/people`, with its counts),
 * its figures (`/admin/figures`) and the case beside the record
 * (`/admin/:userId/case`: assignee, history, notes, documents); part 2's
 * screening and HQ blocks on the record (`GET /admin/:userId`). Every read is
 * logged by the Worker. A value a read does not carry stays null and the page
 * says "Not recorded" with its reason, never a zero.
 *
 * AN UNREAD SCREENING IS NEVER CLEAR. `screeningView` answers `clear` only for
 * the Worker's `clear`; unreadable, never run, missing and an unreviewed match
 * each say so, and `approveNeedsNote` asks the approver for a note on each.
 */
import { statusWord } from './kycModel';

// ---------------------------------------------------------------- words

/** The profile words the canvas uses for each role. */
const ROLE_WORD = Object.freeze({
  investor: 'Investor', founder: 'Founder', advisor: 'Advisor', partner: 'Operating Partner',
  exploring: 'Explorer', admin: 'Admin', service_provider: 'Service provider',
});
export const roleWord = (r) => ROLE_WORD[r] || (r ? String(r).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : null);

/** The ID types the Worker accepts (`kyc.ts` ALLOWED_ID_TYPES), in the canvas's words. */
export const ID_TYPES = Object.freeze([
  { value: 'passport', label: 'Passport' },
  { value: 'national_id', label: 'National ID' },
  { value: 'driver_license', label: 'Driving licence' },
  { value: 'residence_permit', label: 'Residence permit' },
]);
export const idTypeWord = (v) => ID_TYPES.find((t) => t.value === v)?.label || (v ? String(v) : null);

/** The flags the queue read returns (`kycCase.ts` QUEUE_FLAGS). */
export const FLAGS = Object.freeze([
  { value: 'pep', label: 'PEP' },
  { value: 'auto_failed', label: 'Automatic check failed' },
  { value: 'no_document', label: 'No document' },
]);
export const flagWord = (v) => FLAGS.find((f) => f.value === v)?.label || String(v);

const INITIALS = /[\p{L}\p{N}]/u;
export function initials(name, email) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const pick = (w) => [...w].find((c) => INITIALS.test(c)) || '';
  const two = words.length > 1 ? pick(words[0]) + pick(words[words.length - 1]) : pick(words[0] || String(email || ''));
  return two.toUpperCase() || '?';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A Worker timestamp (`YYYY-MM-DD HH:MM:SS`, UTC, or ISO) as a Date; null when it is not one. */
export function stamp(v) {
  if (!v) return null;
  const s = String(v);
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function dayLabel(v) {
  const d = stamp(v);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : null;
}
export function timeLabel(v) {
  const d = stamp(v);
  if (!d) return null;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dayLabel(v)} · ${hh}:${mm}`;
}

// ---------------------------------------------------------------- the queue (KYC1, KYC2)

/** The status chips in the canvas's order; `all` is every case someone has opened. */
export const CHIPS = Object.freeze(['pending', 'needs_info', 'approved', 'rejected', 'expired', 'not_started', 'all']);
export const chipWord = (k) => (k === 'all' ? 'All' : statusWord(k));

/**
 * A chip's count from the read's `counts`. `all` adds every status but Not
 * started, as the Worker's `all` does. No counts read is null, never zero.
 */
export function chipCount(counts, key) {
  if (!counts || typeof counts !== 'object') return null;
  if (key === 'all') {
    return CHIPS.filter((k) => k !== 'all' && k !== 'not_started')
      .reduce((n, k) => n + (Number.isFinite(Number(counts[k])) ? Number(counts[k]) : 0), 0);
  }
  const n = Number(counts[key]);
  return Number.isFinite(n) ? n : null;
}

/** The four sorts the Worker reads, in the canvas's words. Waiting longest first is the default. */
export const SORTS = Object.freeze([
  { key: 'oldest', label: 'Waiting longest first', sort: 'submitted', dir: 'asc' },
  { key: 'newest', label: 'Submitted, newest', sort: 'submitted', dir: 'desc' },
  { key: 'decided', label: 'Decided, newest', sort: 'reviewed', dir: 'desc' },
  { key: 'name', label: 'Name, A to Z', sort: 'name', dir: 'asc' },
]);
export const PAGE_SIZES = Object.freeze([10, 25, 50]);

export const DEFAULT_QUERY = Object.freeze({
  status: 'pending', q: '', id_type: '', country: '', flag: '', assignee: '', sort: 'oldest', page: 1, page_size: 25,
});

/** The query the page holds, as the parameters `kycPeopleApi.people` sends. */
export function queryParams(s = DEFAULT_QUERY) {
  const sort = SORTS.find((x) => x.key === s.sort) || SORTS[0];
  const country = String(s.country || '').trim().toUpperCase();
  return {
    status: CHIPS.includes(s.status) ? s.status : 'pending',
    q: String(s.q || '').trim(),
    id_type: ID_TYPES.some((t) => t.value === s.id_type) ? s.id_type : '',
    country: /^[A-Z]{2,3}$/.test(country) ? country : '',
    flag: FLAGS.some((f) => f.value === s.flag) ? s.flag : '',
    assignee: ['me', 'none'].includes(s.assignee) ? s.assignee : '',
    sort: sort.sort,
    dir: sort.dir,
    page: Math.max(1, Math.floor(Number(s.page)) || 1),
    page_size: PAGE_SIZES.includes(Number(s.page_size)) ? Number(s.page_size) : 25,
  };
}

const ASSIGNEE_WORD = { me: 'Assigned: me', none: 'Assigned: no one' };
/** The filters applied beyond the status chips, each with its own chip so it can be cleared. */
export function appliedFilters(s = DEFAULT_QUERY) {
  const p = queryParams(s);
  const out = [];
  if (p.id_type) out.push({ key: 'id_type', label: `ID type: ${idTypeWord(p.id_type)}` });
  if (p.country) out.push({ key: 'country', label: `Country: ${p.country}` });
  if (p.flag) out.push({ key: 'flag', label: `Flags: ${flagWord(p.flag)}` });
  if (p.assignee) out.push({ key: 'assignee', label: ASSIGNEE_WORD[p.assignee] });
  return out;
}
export const filtersOn = (s) => appliedFilters(s).length > 0 || Boolean(String(s?.q || '').trim());

/** "1–25 of 40"; "0 of 0" when nothing matches. */
export function pageLine(total, page, size) {
  const t = Number(total);
  if (!Number.isFinite(t)) return null;
  if (t <= 0) return '0 of 0';
  const from = (page - 1) * size + 1;
  return `${Math.min(from, t)}–${Math.min(page * size, t)} of ${t}`;
}
export const pageCount = (total, size) => Math.max(1, Math.ceil((Number(total) || 0) / size));

/** A row's wait. Only a Waiting or Needs information case has one; under a day is said, never "0 days". */
export function waitText(row) {
  const d = row?.wait_days;
  if (d == null || !Number.isFinite(Number(d))) return null;
  const n = Number(d);
  return n < 1 ? 'Under a day' : n === 1 ? '1 day' : `${n} days`;
}

/** What an empty list says: filters that match nobody keep their chips so they can be cleared (KYC11c). */
export function emptyLine(s = DEFAULT_QUERY) {
  if (filtersOn(s)) return { title: 'No cases match these filters.', line: 'Clear a filter to see more.' };
  if (s.status === 'pending') return { title: 'Nothing is waiting.', line: 'New submissions appear here, oldest first.' };
  return { title: `No one is ${chipWord(s.status)}.`, line: null };
}

/** The phone card's second line (KYC15a): "Waiting 6 days · Passport". */
export function cardLine(row) {
  const w = waitText(row);
  return [w ? `Waiting ${w === 'Under a day' ? 'under a day' : w}` : null, idTypeWord(row?.id_type)].filter(Boolean).join(' · ') || null;
}

// ---------------------------------------------------------------- the figures (KYC1)

const WEEKS = 8;
const DAY = 86400000;
/** The Monday a Worker week starts on (`date(created_at, 'weekday 0', '-6 days')`), as YYYY-MM-DD. */
export function weekStartOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * DAY).toISOString().slice(0, 10);
}

/**
 * The last eight weeks, this one last. A week no decision was recorded in is
 * `recorded: false`, drawn dashed as "Not recorded": the history began with
 * migration 614 and holds no earlier decision (D1229 §1).
 */
export function weekBars(weeks, nowIso) {
  const now = stamp(nowIso) || new Date();
  const last = new Date(`${weekStartOf(now)}T00:00:00Z`);
  const byWeek = new Map((Array.isArray(weeks) ? weeks : []).map((w) => [w.week_start, w]));
  const out = [];
  for (let i = WEEKS - 1; i >= 0; i -= 1) {
    const start = new Date(last.getTime() - i * 7 * DAY).toISOString().slice(0, 10);
    const w = byWeek.get(start);
    out.push({
      week_start: start,
      label: dayLabel(start).replace(/ \d{4}$/, ''),
      current: i === 0,
      recorded: Boolean(w),
      approved: w ? Number(w.approved) || 0 : null,
      rejected: w ? Number(w.rejected) || 0 : null,
      needs_info: w ? Number(w.needs_info) || 0 : null,
    });
  }
  return out;
}
export const weekTotal = (b) => (b.recorded ? b.approved + b.rejected + b.needs_info : null);

export const BANDS = Object.freeze([
  { key: 'under_1_day', label: 'Under 1 day', short: '<1 d' },
  { key: '1_to_3_days', label: '1–3 days', short: '1–3 d' },
  { key: '3_to_7_days', label: '3–7 days', short: '3–7 d' },
  { key: 'over_7_days', label: 'Over 7 days', short: '>7 d' },
]);
/** The wait bands of the people still waiting; a band the read lacks is null. */
export function bandBars(bands) {
  return BANDS.map((b) => ({ ...b, n: bands && Number.isFinite(Number(bands[b.key])) ? Number(bands[b.key]) : null }));
}

/** The chart's lead sentence (KYC1): what is waiting, and how many have waited a day or more. */
export function waitLead(bands) {
  const bars = bandBars(bands);
  if (bars.some((b) => b.n == null)) return null;
  const all = bars.reduce((n, b) => n + b.n, 0) + (Number(bands?.not_recorded) || 0);
  if (!all) return 'Nobody is waiting.';
  const past = bars.filter((b) => b.key !== 'under_1_day').reduce((n, b) => n + b.n, 0);
  const long = bars.find((b) => b.key === 'over_7_days').n;
  const unrec = Number(bands?.not_recorded) || 0;
  return [
    `${all} ${all === 1 ? 'person is' : 'people are'} waiting.`,
    `${past} ${past === 1 ? 'has' : 'have'} waited a day or more, past the one-business-day promise;`,
    long ? `${long} longer than 7 days.` : 'nobody longer than 7 days.',
    unrec ? `${unrec} ${unrec === 1 ? 'has' : 'have'} no submission time recorded.` : null,
  ].filter(Boolean).join(' ');
}

export function weekLead(bars) {
  const recorded = bars.filter((b) => b.recorded);
  if (!recorded.length) return 'No decision is recorded in the last eight weeks: the history began with migration 614.';
  const total = recorded.reduce((n, b) => n + weekTotal(b), 0);
  const gaps = bars.filter((b) => !b.recorded && !b.current).length;
  const now = bars[bars.length - 1];
  return [
    `${total} ${total === 1 ? 'decision' : 'decisions'} recorded in eight weeks.`,
    gaps ? `${gaps} ${gaps === 1 ? 'week has' : 'weeks have'} none recorded, drawn dashed.` : null,
    now.recorded ? `This week so far: ${weekTotal(now)}.` : 'This week so far: none recorded.',
  ].filter(Boolean).join(' ');
}

/** "1.8 days" or "5 hours"; null when the median is not recorded. */
export function medianWord(hours) {
  const h = Number(hours);
  if (hours == null || !Number.isFinite(h)) return null;
  if (h < 24) return `${Math.round(h * 10) / 10} ${h === 1 ? 'hour' : 'hours'}`;
  const d = Math.round((h / 24) * 10) / 10;
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

/**
 * The four tiles. Waiting and Needs information come from the queue's counts,
 * which follow the filters (the tile then says so); decided and the median
 * come from the figures. A read that did not answer leaves its tile null.
 */
export function tiles({ counts, figures, filtered = false, nowIso } = {}) {
  const bars = figures ? weekBars(figures.weeks, nowIso) : null;
  const four = bars ? bars.slice(-4) : null;
  const sum = (k) => four.reduce((n, b) => n + (b.recorded ? b[k] : 0), 0);
  const scope = filtered ? 'Under these filters' : null;
  return [
    { key: 'waiting', label: 'Waiting', value: chipCount(counts, 'pending'), sub: scope },
    { key: 'needs_info', label: 'Needs information', value: chipCount(counts, 'needs_info'), sub: scope || 'Waiting on the member' },
    {
      key: 'decided', label: 'Decided, last 4 weeks',
      value: four ? sum('approved') + sum('rejected') + sum('needs_info') : null,
      sub: four ? `${sum('approved')} approved · ${sum('rejected')} rejected · ${sum('needs_info')} asked for information` : null,
    },
    {
      key: 'median', label: 'Median time to a decision',
      value: figures ? medianWord(figures.median_hours_to_decision) : null,
      sub: figures ? (figures.median_hours_to_decision == null ? figures.median_reason || 'Not recorded' : 'Last 90 days') : null,
    },
  ];
}

// ---------------------------------------------------------------- the case (KYC3)

/**
 * "What they submitted" (KYC3): the plain values, in the canvas's order. A
 * value the record did not return stays null. The masked ones (date of
 * birth, ID number, address, phone) are `KycSensitiveFields`', shown one at a
 * time and logged.
 */
export function submittedFacts(r = {}) {
  const d = r.kyc_data || {};
  const name = `${d.legal_first_name || ''} ${d.legal_last_name || ''}`.trim();
  return [
    ['Legal name', name || null],
    ['Nationality', d.nationality || null],
    ['Country of residence', d.country || null],
    ['ID type', idTypeWord(d.id_type)],
    ['Submitted', timeLabel(r.submitted_at)],
    ['Provider', r.kyc_provider === 'mock' ? 'Test provider' : r.kyc_provider || null],
    ['Email', r.email || null],
  ];
}

/** The seven automatic checks the mock provider runs (`kyc.ts` runMockKyc), in the canvas's words. */
export const CHECKS = Object.freeze([
  { key: 'name_present', label: 'Name present' },
  { key: 'dob_valid', label: 'Date of birth valid' },
  { key: 'address_present', label: 'Address present' },
  { key: 'id_type_valid', label: 'ID type accepted' },
  { key: 'id_number_present', label: 'ID number present' },
  { key: 'document_present', label: 'Document present' },
  { key: 'age_ok', label: 'Age 18 or over' },
]);

/** Each check as passed, failed or not recorded (null), from the provider's result. */
export function checkRows(kycData) {
  const c = kycData?.provider_result?.checks;
  return CHECKS.map((k) => ({ ...k, passed: c && typeof c[k.key] === 'boolean' ? c[k.key] : null }));
}
export function checkSummary(rows) {
  const known = rows.filter((r) => r.passed != null);
  if (!known.length) return null;
  const failed = known.filter((r) => !r.passed).length;
  if (failed) return `${failed} failed`;
  return known.length === rows.length ? `All ${rows.length} passed` : `${known.length} of ${rows.length} passed`;
}
const RESULT = { review: 'Passed: needs a person to decide.', pass: 'Passed.', fail: 'Failed: they were asked to correct it.' };
export const resultLine = (r) => RESULT[r] || null;

const UNREADABLE_WHY = {
  lists_unavailable: 'A sanctions list could not be read when they submitted.',
  not_recorded: 'The screening ran, but its result could not be written.',
  read_failed: 'The screening record could not be read.',
  error: 'The screening could not finish.',
};

/**
 * The sanctions block (KYC3, KYC3b, KYC13b). `clear` only for the Worker's
 * clear; anything else — unreadable, never run, no block at all, a match —
 * says what it is and never "No match".
 */
export function screeningView(s) {
  if (!s || typeof s !== 'object' || !s.state) {
    return { state: 'unreadable', clear: false, title: 'Screening not read', line: 'The case read carried no screening. This is not a claim that there is no match.' };
  }
  if (s.state === 'clear') {
    return { state: 'clear', clear: true, title: 'Screened', line: `${dayLabel(s.run_at) || 'Date not recorded'} · against the OFAC, EU and UK lists · No match` };
  }
  if (s.state === 'match') {
    const n = Number(s.match_count) || 0;
    const rev = s.reviewed
      ? `reviewed by ${s.reviewed.by?.name || 'an admin'}${s.reviewed.at ? ` on ${dayLabel(s.reviewed.at)}` : ''}`
      : 'not reviewed';
    return {
      state: 'match', clear: false, reviewable: !s.reviewed, id: s.id, title: 'Sanctions match',
      line: `${n ? `${n} possible ${n === 1 ? 'match' : 'matches'}` : 'A possible match'}${s.severity ? ` · ${s.severity}` : ''} · ${rev}`,
      notes: s.reviewed?.notes || null,
    };
  }
  if (s.state === 'not_run') {
    return { state: 'not_run', clear: false, title: 'Not screened', line: 'This person has not been screened. This is not a claim that there is no match.' };
  }
  return {
    state: 'unreadable', clear: false, title: 'Screening could not be read',
    line: `${UNREADABLE_WHY[s.reason] || UNREADABLE_WHY.error} This is not a claim that there is no match.`,
  };
}

/** Approving without a clear screening asks the approver for a note (KYC13b). */
export function approveNeedsNote(screening) {
  return !screeningView(screening).clear;
}

export function pepLine(kycData) {
  const v = kycData?.pep_self_disclosed;
  if (v === true) return { pep: true, text: 'Politically exposed: they said Yes. This case goes to HQ before approval.' };
  if (v === false) return { pep: false, text: 'Politically exposed: they said No' };
  return { pep: null, text: null };
}
export function consentLine(kycData) {
  const v = kycData?.sanctions_acknowledged;
  return v === true ? 'Sanctions consent: given' : v === false ? 'Sanctions consent: not given' : null;
}

const HQ_REASON = { pep: 'They said yes to politically exposed', sanctions_match: 'A possible sanctions match', admin: 'Sent by an admin' };
export const hqReasonWord = (r) => HQ_REASON[r] || 'Not recorded';

/**
 * Whether the case is with HQ (part 2). A failed or missing read is never
 * "not with HQ": the studio's decisions then wait, as the Worker's do.
 */
export function hqView(hq) {
  if (!hq || hq.state !== 'ready') {
    return { readable: false, withHq: null, line: 'Whether this case is with HQ could not be read. Decisions wait until it can.' };
  }
  const open = Array.isArray(hq.open) ? hq.open : [];
  if (hq.with_hq || open.length) {
    return {
      readable: true, withHq: true, open,
      line: `With HQ since ${dayLabel(open[0]?.raised_at) || 'a date not recorded'}. A Super Admin decides; you can still read the case.`,
      reasons: open.map((r) => hqReasonWord(r.reason)),
    };
  }
  return { readable: true, withHq: false, line: null };
}

const EVENT = {
  submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', needs_info: 'Asked for information',
  recheck: 'Asked for a re-check', expired: 'Expired', assigned: 'Assigned', unassigned: 'Unassigned',
};
/** One history row (newest first, as read). An assignment's note is an id and is not shown. */
export function eventLine(e) {
  const what = EVENT[e?.kind] || 'Not recorded';
  const by = e?.actor ? ` by ${e.actor.name || 'an admin'}` : '';
  const note = e?.note && !['assigned', 'unassigned'].includes(e.kind) ? e.note : null;
  return { when: timeLabel(e?.at) || 'Time not recorded', what: `${what}${by}`, note };
}

const KIND = { id_front: 'ID, front', id_back: 'ID, back', proof_of_address: 'Proof of address', selfie: 'Selfie', other: 'Other document' };
export const docKindWord = (k) => KIND[k] || 'Document';

export function sizeWord(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
}
const typeWord = (t) => (t === 'application/pdf' ? 'PDF' : /^image\//.test(String(t)) ? 'image' : null);

/**
 * The case's documents (part 1's several, each with a kind) and the single one
 * the older form stored. A removed document says when; it never opens.
 */
export function documentRows(caseDocs, kycData) {
  const rows = (Array.isArray(caseDocs) ? caseDocs : []).map((d) => ({
    key: `doc-${d.id}`, id: d.id, legacy: false, title: docKindWord(d.kind),
    meta: [typeWord(d.content_type), sizeWord(d.size_bytes), dayLabel(d.created_at)].filter(Boolean).join(' · ') || null,
    removed: d.removed_at ? dayLabel(d.removed_at) || 'a date not recorded' : null,
  }));
  if (kycData?.document_uploaded) {
    rows.unshift({ key: 'legacy', id: null, legacy: true, title: 'ID document', meta: 'Sent with the form', removed: null });
  }
  return rows;
}

// ---------------------------------------------------------------- decisions (KYC5)

export const REASON_MIN = 5;
export const NOTE_MAX = 2000;
export const HQ_NOTE_MAX = 1000;

/** The approval's line, by profile: only an investor's use of the platform waits on it. */
export const unlockLine = (role) => (role === 'investor'
  ? 'Approving clears them to sign agreements and invest.'
  : 'Approving clears them to sign agreements.');

/**
 * The decision bar: what each status allows, as the Worker allows it. A case
 * with HQ, or one whose HQ state could not be read, has no studio decision.
 */
export function actionsFor(status, hq) {
  const h = hqView(hq);
  const base = {
    pending: ['info', 'reject', 'approve', 'hq'],
    rejected: ['approve', 'hq'],
    needs_info: ['hq'],
    approved: ['recheck'],
    expired: ['recheck'],
  }[status] || [];
  if (h.withHq) return { list: [], held: h.line };
  if (!h.readable) return { list: base.filter((a) => a === 'hq'), held: h.line };
  return { list: base, held: status === 'needs_info' ? 'Waiting on the member to answer. The case comes back here when they do.' : null };
}

export const QUICK_REASONS = Object.freeze(['Photo unreadable.', 'Name does not match.', 'Document expired.']);

/** What Ask for information can ask for (KYC5 C). */
export const INFO_ASKS = Object.freeze([
  { key: 'photo', label: 'A clearer photo', text: 'a clearer photo of your ID' },
  { key: 'address', label: 'Proof of address, dated in the last 3 months', text: 'a proof of address dated in the last 3 months' },
  { key: 'second', label: 'A second document', text: 'a second identity document' },
  { key: 'other', label: 'Something else', text: null },
]);

/** The question the member reads, from the picks and the free text. */
export function infoMessage(picks = [], other = '') {
  const parts = INFO_ASKS.filter((a) => a.text && picks.includes(a.key)).map((a) => a.text);
  const extra = picks.includes('other') ? String(other || '').trim().replace(/\.$/, '') : '';
  if (extra) parts.push(extra);
  if (!parts.length) return '';
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}.`;
}

/** The member's notice, as `kycCase.ts` noticeFor words it, so the dialog shows what they will read. */
export function noticePreview(kind, message) {
  const said = String(message || '').trim();
  if (kind === 'needs_info') return `To finish your identity check, Axal compliance asks: ${said || 'Not recorded'}. Open Identity verification to answer.`;
  if (kind === 'recheck') return `Axal compliance asks you to verify your identity again: ${said || 'Not recorded'}. Full access waits until it is approved.`;
  if (kind === 'rejected') return `Axal compliance could not approve your identity check. Reason: ${said || 'Not recorded'}. You can correct it and submit again.`;
  return 'Axal compliance approved your identity check. Full access is open.';
}

/** A refusal in words. Nothing a refusal carries beyond its message is shown. */
export function refusalWord(e) {
  const code = e?.code || e?.data?.code || e?.data?.error;
  if (code === 'step_up_required') return 'Your authenticator code was not confirmed, so nothing was decided.';
  if (code === 'branch_suspended' || e?.status === 423) return 'A paused studio cannot decide checks. Nothing was changed.';
  if (code === 'sent_to_hq') return 'This case is with HQ. A Super Admin decides it.';
  if (code === 'not_waiting') return 'This case is no longer waiting, so nothing was sent.';
  if (code === 'not_checked') return 'Only an approved or expired check can be re-checked.';
  if (code === 'already_sent_to_hq') return 'An admin already sent this case to HQ, and HQ has not decided it yet.';
  return e?.message || 'It could not be saved. Try again.';
}

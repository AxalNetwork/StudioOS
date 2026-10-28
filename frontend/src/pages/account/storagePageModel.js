/**
 * D1166, D1171 (#2449) — the words and the rules of `/account/usage/storage`,
 * Usage's fourth page, from the canvas "Account · Usage · Storage"
 * (`Account Storage Page.dc.html`, boards STG1–STG20). Pure, so
 * `frontend/test/storage_page_d1171.test.mjs` holds each rule.
 *
 * TWO READS.
 * - D642's `GET /api/usage/storage`, grown by D1169: the member's files by
 *   area, kind and company, the ten largest, and their plan's allowance and
 *   state. The allowance is the Worker's (part 1's catalogue); no byte count
 *   is typed here.
 * - `GET /api/public/plans-and-packs`: each plan's name, storage and Best
 *   suited for, and a sold plan's monthly price, for the plan pill and "More
 *   room as you grow". It fails on its own: the page then names no plan.
 *
 * NEVER A ZERO FOR A MISSING VALUE. A figure the Worker sends as null is "Not
 * recorded" with its reason. An unreadable kind withholds the total, the bar
 * and every share. There is no bar or percentage without an allowance.
 *
 * NEVER DELETE, HIDE OR CUT (#2449 owner questions 4 and 5). Every sentence
 * here that meets a full or over plan says what is kept.
 */

export const STORAGE_PAGE = Object.freeze({
  title: 'Storage',
  sub: 'How much you keep on StudioOS, across all your companies.',
});

/** 1 GB = 1,024 MB: the catalogue's binary unit (D1167). */
export const UNIT_LINE = '1 GB = 1,024 MB.';

/** STG1's "What counts", byte for byte from the canvas. */
export const COUNTS = Object.freeze(['Every file you upload', 'Its earlier versions', 'Exports kept on StudioOS']);
export const DOES_NOT_COUNT = Object.freeze(['Identity documents', 'Signed legal copies', 'Fund documents', 'Anything Axal VC publishes']);

/** STG17: Cost's details no longer hold storage. */
export const COST_STORAGE_NOTE = 'Storage no longer sits in this list. It has its own page, Usage › Storage.';

/** The canvas's six kinds, in its palette order; the Worker's keys (D1169 §3). */
export const KINDS = Object.freeze([
  ['data_room', 'Data room'],
  ['documents', 'Documents'],
  ['recordings', 'Recordings'],
  ['decks_exports', 'Decks and exports'],
  ['brand', 'Brand'],
  ['other', 'Other'],
]);
const KIND_LABEL = Object.fromEntries(KINDS);

export const STORAGE_HREF = '/account/usage/storage';
export const COMPARE_HREF = '/pricing';
export const COMPARE_PLANS = 'Compare plans';
export const OPEN_STORAGE = 'Open Storage';
export const SEE_LARGEST = 'See largest files';
export const RECORDING_KEPT = 'A recording already in progress finishes and is kept.';
export const READ_FAILED = 'Your storage could not be read. That is not the same as having none.';
export const COMPANY_NOTE = 'This counts every company at once. Switching company in the sidebar does not change it.';
export const LARGEST_FOOT = 'Open takes you to where the file lives.';
export const KIND_FOOT = `Bar lengths compare the kinds with each other. ${UNIT_LINE}`;
export const STAFF_FOOT = 'Staff accounts have no storage allowance. Uploads are never paused for space.';

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
const MB = 1024 ** 2;
const GB = 1024 ** 3;
const TB = 1024 ** 4;
const one = (x) => String(+x.toFixed(1));

/**
 * A byte count as the canvas writes it, in binary units: "640 MB", "3.2 GB",
 * "250 GB", "1.8 TB". A measured empty store is "0 B". Null when it is not a
 * count, so the caller says Not recorded and never "0".
 */
export function storageSize(bytes) {
  if (!isCount(bytes)) return null;
  if (bytes === 0) return '0 B';
  if (bytes >= TB) return `${one(bytes / TB)} TB`;
  if (bytes >= GB) return `${bytes >= 100 * GB ? Math.round(bytes / GB) : one(bytes / GB)} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const files = (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'file' : 'files'}`;

/* ------------------------------------------------------------------ *
 * The plan, from the public catalogue
 * ------------------------------------------------------------------ */

/** The catalogue entry for a plan key, from the public read, or null. */
export function catalogueEntry(plans, key) {
  const list = Array.isArray(plans?.catalogue) ? plans.catalogue : [];
  return (key && list.find((e) => e?.key === key)) || null;
}

/** The plan's name for the pill: the catalogue's label; null while unknown. */
export function planLabel(plans, key) {
  return catalogueEntry(plans, key)?.label || null;
}

/** A Free or Basic plan: the canvas shows "More room as you grow" (STG6, STG9a). */
export const isEntryPlan = (key) => key === 'other' || /:free$/.test(String(key || ''));

/** "$20 a month", from a sold plan's monthly price in the read; null with none. */
function monthly(plans, key) {
  const row = (Array.isArray(plans?.plans) ? plans.plans : []).find((p) => p?.catalogue?.key === key && p.monthly);
  const m = row?.monthly;
  if (!m || !isCount(m.unit_amount)) return null;
  try {
    const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: String(m.currency || 'usd').toUpperCase(), minimumFractionDigits: m.unit_amount % 100 ? 2 : 0 }).format(m.unit_amount / 100);
    return `${money} a month`;
  } catch { return null; }
}

/**
 * STG6/STG9a: the plans of the member's family that hold more storage than
 * theirs, smallest first, each with its storage, its Best suited for and its
 * monthly price when one is sold. Every figure is the catalogue's.
 */
export function upgradeRows(plans, planKey, allowance) {
  if (!isEntryPlan(planKey) || !isCount(allowance)) return [];
  const family = catalogueEntry(plans, planKey)?.family;
  const list = Array.isArray(plans?.catalogue) ? plans.catalogue : [];
  return list
    .filter((e) => e && e.key !== planKey && (family ? e.family === family : true) && isCount(e.storage?.bytes) && e.storage.bytes > allowance)
    .sort((a, b) => a.storage.bytes - b.storage.bytes)
    .map((e) => ({ key: e.key, label: e.label, size: storageSize(e.storage.bytes), best: e.best_suited_for || null, price: monthly(plans, e.key) }));
}

/* ------------------------------------------------------------------ *
 * Your storage (STG1–STG3, STG5–STG10)
 * ------------------------------------------------------------------ */

/** The pill beside the plan, by the Worker's state. Below 80% there is none. */
export const STATE_PILL = Object.freeze({
  near_80: { label: 'Near your limit', tone: 'amber' },
  near_95: { label: 'Almost full', tone: 'amber' },
  full: { label: 'Storage full', tone: 'red' },
  over: { label: 'Over your plan', tone: 'red' },
});

/** The kinds that could not be read, by name. */
function unreadKinds(s) {
  return (Array.isArray(s?.kinds) ? s.kinds : []).filter((k) => k?.recorded !== true).map((k) => KIND_LABEL[k?.key] || 'A kind');
}

/**
 * The allowance card. One of:
 * - `staff`: a staff account, its measured bytes and no allowance (STG10);
 * - `unread`: a kind could not be read, so no total, bar or state (STG13b);
 * - `negotiated`: a plan whose allowance is not a figure we hold, or a plan
 *   the Worker could not read: the bytes, and the reason, never a bar;
 * - `meter`: used of allowance, with the bar's parts.
 */
export function allowanceView(s, plans) {
  if (!s || typeof s !== 'object') return null;
  const planKey = s.plan_key ?? null;
  const used = isCount(s.measured_bytes) ? s.measured_bytes : null;
  const unknown = isCount(s.unknown_size_files) ? s.unknown_size_files : 0;
  const label = planLabel(plans, planKey);
  const pending = unknown > 0 ? `${files(unknown)} ${unknown === 1 ? 'was' : 'were'} stored before sizes were recorded. They are being measured.` : null;
  if (planKey === 'admin') {
    return { mode: 'staff', label: 'Staff account', used: storageSize(used), pending };
  }
  // The Worker withholds the total when any place could not be read (D1169).
  if (used === null) {
    const missing = unreadKinds(s);
    const names = missing.length ? missing.join(', ') : 'A place';
    return { mode: 'unread', label, reason: `Total not shown: ${names} could not be read, so a total would be wrong.` };
  }
  const allowance = s.allowance_bytes;
  if (!isCount(allowance) || allowance === 0) { // a negotiated or unread plan: no figure to measure against
    return { mode: 'negotiated', label, used: storageSize(used), pending,
      reason: s.plan_recorded === false ? 'Your plan could not be read, so how much of it you use is not shown.'
        : (s.allowance_reason ? `${s.allowance_reason}. How much of it you use is not shown.` : 'Your plan’s allowance is not recorded, so how much of it you use is not shown.') };
  }
  const over = used > allowance ? used - allowance : 0;
  const left = Math.max(0, allowance - used);
  const lp = planKey === 'lp_access';
  const pill = STATE_PILL[s.state] || null;
  // The bar's scale is the plan, or what is used when that is more: an overrun
  // is drawn past the plan's end, hatched, and never clipped (STG5).
  const scale = Math.max(used, allowance);
  const kinds = (Array.isArray(s.kinds) ? s.kinds : []).filter((k) => isCount(k?.measured_bytes) && k.measured_bytes > 0)
    .map((k) => ({ key: k.key, label: KIND_LABEL[k.key] || 'Other', size: storageSize(k.measured_bytes), share: k.measured_bytes / scale }));
  return {
    mode: 'meter', label, planKey, state: s.state ?? null, pill,
    used: storageSize(used), allowance: storageSize(allowance),
    headline: `${storageSize(used)} of ${storageSize(allowance)}${lp ? ' personal storage' : ''}`,
    side: over ? `${storageSize(over)} over` : left > 0 ? `${storageSize(left)} left` : 'None left',
    sideTone: over || left === 0 ? 'red' : 'muted',
    pct: Math.min(100, Math.floor((used * 100) / allowance)),
    over: over ? storageSize(over) : null,
    // Where the plan ends and its 80% and 95% ticks sit, as shares of the bar.
    end: allowance / scale, ticks: [0.8, 0.95].map((f) => (f * allowance) / scale),
    warn: s.state === 'near_80' || s.state === 'near_95',
    full: s.state === 'full',
    kinds, pending, unknown,
    foot: lp ? `LP Access includes ${storageSize(allowance)} of personal storage. Files you upload count toward it.`
      : `Your plan includes ${storageSize(allowance)}. Files you upload to your companies count toward your storage.`,
    compare: (!pill || s.state === 'near_80') && !isEntryPlan(planKey),
  };
}

/** The notice above the page at 80%, 95%, full and over; null below 80%. */
export function noticeFor(v) {
  if (!v || v.mode !== 'meter') return null;
  if (v.state === 'near_80') return { tone: 'amber', text: 'You have used 80% of your storage. Uploads keep working.', compare: false, largest: true };
  if (v.state === 'near_95') return { tone: 'amber', text: 'Your storage is almost full. At 100%, new uploads pause.', compare: true, largest: true };
  if (v.state === 'full') return { tone: 'red', text: 'Storage full. New uploads are paused. Everything you stored stays, and you can still open and download it.', compare: true, largest: true, recording: RECORDING_KEPT };
  if (v.state === 'over') {
    const plan = v.label ? `Your plan is ${v.label}. ` : '';
    return { tone: 'red', text: `${plan}You are using ${v.used} of ${v.allowance}. Nothing was deleted. New uploads resume once you are under ${v.allowance}.`, compare: true, largest: false };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * By kind, by company, largest files
 * ------------------------------------------------------------------ */

/**
 * By kind (STG1, STG13b). Each kind's files and size; its share of what is
 * used only when every kind was read. A kind the Worker could not read says
 * so, and the row "In total" withholds its total.
 */
export function kindRows(s) {
  const list = new Map((Array.isArray(s?.kinds) ? s.kinds : []).map((k) => [k?.key, k]));
  const all = KINDS.every(([key]) => list.get(key)?.recorded === true);
  const total = all && isCount(s?.measured_bytes) ? s.measured_bytes : null;
  const max = Math.max(1, ...KINDS.map(([key]) => (isCount(list.get(key)?.measured_bytes) ? list.get(key).measured_bytes : 0)));
  const rows = KINDS.map(([key, label]) => {
    const k = list.get(key);
    if (!k || k.recorded !== true) return { key, label, unread: true };
    const bytes = isCount(k.measured_bytes) ? k.measured_bytes : null;
    const count = isCount(k.files) ? k.files : null;
    return {
      key, label, unread: false,
      files: count === null ? null : count === 0 ? 'None' : count.toLocaleString('en-US'),
      size: bytes === null ? null : bytes === 0 ? 'None' : storageSize(bytes),
      exact: isCount(k.bytes),
      width: bytes ? (bytes / max) * 100 : 0,
      share: total && bytes ? `${((bytes / total) * 100).toFixed(1)}%` : null,
    };
  });
  return {
    rows, complete: all,
    totalFiles: all && isCount(s?.files) ? s.files.toLocaleString('en-US') : null,
    totalSize: total === null ? null : storageSize(total),
    summary: `Storage by kind: ${rows.map((r) => `${r.label} ${r.unread ? 'could not be read' : r.size || 'not recorded'}`).join(', ')}.`,
  };
}

/**
 * By company (STG1, STG7, STG8). The Worker's companies, largest first, then
 * the row for files tied to no company. A figure it withholds is null here.
 */
export function companyRows(s) {
  if (!Array.isArray(s?.companies)) return null;
  const used = isCount(s.measured_bytes) && s.measured_bytes > 0 ? s.measured_bytes : null;
  const fig = (r) => ({
    files: isCount(r?.files) ? r.files.toLocaleString('en-US') : null,
    size: storageSize(r?.measured_bytes),
    share: used && isCount(r?.measured_bytes) ? Math.round((r.measured_bytes / used) * 100) : null,
  });
  return s.companies
    .filter((c) => !(c?.personal && c.files === 0 && !(c.ventures || []).length))
    .map((c) => ({
      key: c.uid || 'personal',
      name: c.personal ? 'Not tied to a company' : (c.name || 'A company with no name recorded'),
      personal: !!c.personal,
      ...fig(c),
      ventures: (c.ventures || []).map((v) => ({ key: v.uid, name: v.name || 'A venture with no name recorded', ...fig(v) })),
    }));
}

/** Where a file lives, by the Worker's area (D1169 §2); null where no page opens it. */
export const AREA_PLACE = Object.freeze({
  data_room: ['the data room', '/raise/data-room/files'],
  data_room_versions: ['the data room, as an earlier version', '/raise/data-room/files'],
  diligence_files: ['due diligence', '/due-diligence'],
  research_library: ['the research library', '/research/library'],
  interview_recordings: ['the interview', '/validate/customer-research'],
  session_audio: ['the interview', '/validate/customer-research'],
  deck_reviews: ['the deck review', '/raise/pitch/review'],
  validate_evidence: ['Validate › Demand signals', '/validate/demand-signals'],
  build_proofs: ['Build', '/build'],
  grow_minutes: ['Grow', '/grow'],
  brand_files: ['your account', '/account'],
  csv_imports: ['your imports', null],
});

function day(iso) {
  const d = new Date(typeof iso === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? `${iso.replace(' ', 'T')}Z` : iso || NaN);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** The ten largest (STG1): name, kind, company, size, added, and where Open goes. */
export function largestRows(s) {
  if (!Array.isArray(s?.largest)) return null;
  return s.largest.map((f, i) => {
    const [place, to] = AREA_PLACE[f.area] || ['where it was stored', null];
    const name = f.area === 'brand_files'
      ? (f.brand === 'brand_logo' ? 'Your logo' : 'Your photo')
      : (f.name || 'A file with no name recorded') + (isCount(f.version) && f.version > 0 ? ` · version ${f.version}` : '');
    return {
      key: `${f.area}:${f.ref ?? i}:${f.version ?? ''}`,
      name, kind: f.kind, kindLabel: KIND_LABEL[f.kind] || 'Other',
      company: f.company_name || f.venture_name || 'Personal',
      size: storageSize(f.bytes), bytes: isCount(f.bytes) ? f.bytes : 0,
      added: day(f.added_at), addedAt: f.added_at || '',
      place, to,
    };
  });
}

/** The largest list's filters and sort, as its toolbar chips draw them. */
export function filterLargest(rows, { kind = '', company = '', sort = 'size' } = {}) {
  const out = (rows || []).filter((r) => (!kind || r.kind === kind) && (!company || r.company === company));
  return out.sort(sort === 'added' ? (a, b) => String(b.addedAt).localeCompare(String(a.addedAt)) : (a, b) => b.bytes - a.bytes);
}

/* ------------------------------------------------------------------ *
 * Empty, and the profiles
 * ------------------------------------------------------------------ */

/** STG11's door, by profile: an investor opens the library; others with no page see none. */
export function emptyDoor(role) {
  if (role === 'founder') return { label: 'Open the data room', to: '/raise/data-room/files' };
  if (role === 'investor') return { label: 'Open your research library', to: '/research/library' };
  return null;
}

/** STG7: an LP's fund documents are kept by the fund. */
export const LP_FUND_NOTE = 'Fund documents don’t count. Statements, notices and reports from your funds are kept by the fund, not in your storage.';

/* ------------------------------------------------------------------ *
 * STG4: the one refusal, where it happens
 * ------------------------------------------------------------------ */

/**
 * The Worker's `storage_full` refusal (D1170 §1) as the three upload places
 * draw it: the data room upload, the message composer and Record a Session.
 * One sentence, from the refusal's own figures, so it reads the same in all
 * three. Null for any other error: each place keeps its own words for those.
 *
 *   { text, yours, full, links: [{ label, to }] }
 */
export function storageRefusal(error) {
  if (error?.code !== 'storage_full' && error?.data?.error !== 'storage_full') return null;
  const d = error?.data && typeof error.data === 'object' ? error.data : {};
  const yours = d.counts_to !== 'company_owner';
  const used = isCount(d.used_bytes) ? d.used_bytes : null;
  const allowance = isCount(d.allowance_bytes) ? d.allowance_bytes : null;
  const incoming = isCount(d.incoming_bytes) ? d.incoming_bytes : null;
  const left = used !== null && allowance !== null ? Math.max(0, allowance - used) : null;
  const full = left === 0 || incoming === 0 || incoming === null || left === null;
  let text;
  if (yours) {
    text = full
      ? 'Storage full. Nothing new can be stored until you free up space or change plan. Everything you stored stays.'
      : `This file needs ${storageSize(incoming)}. You have ${storageSize(left)} left on your plan.`;
  } else {
    text = full
      ? 'This counts to the company owner’s storage, which is full. Nothing new can be stored until they free up space or change plan.'
      : `This file needs ${storageSize(incoming)}. It counts to the company owner’s plan, which has ${storageSize(left)} left.`;
  }
  return {
    text, yours, full,
    links: yours ? [{ label: OPEN_STORAGE, to: STORAGE_HREF }, { label: COMPARE_PLANS, to: COMPARE_HREF }] : [],
  };
}

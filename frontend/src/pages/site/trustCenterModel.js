/**
 * D1072 (#2425) — the public trust center's pure rules: its tabs and
 * addresses, the facts each tab may state, and what is not recorded yet. No
 * React here, so `node --test` loads it alone.
 *
 * Every fact below is one the code on `main` shows (D1072 §2 names the file
 * for each). None carries a "Checked" date: these are the page's own lines,
 * so each says "Checked: Not recorded". Nothing here is a certification, an
 * audit or a figure the platform does not hold.
 *
 * D1077 (#2969, part 5): the page reads the published store
 * (`GET /api/public/trust`, D1075) and draws each block from it, with each
 * line's Checked date. A block HQ has never published keeps these lines
 * (`blockOf` answers `fallback`); a part of the read that failed is
 * Unreadable with Try again, never these lines passed off as current.
 */

import { NOT_RECORDED } from '../../lib/absence.js';

export const TITLE = 'How we protect your data and your money';
export const LINE = 'Facts we can show, with the date we last checked them. Anything we cannot show yet says Not recorded.';
export { NOT_RECORDED };
export const CHECKED_WAIT = 'Checked: Not recorded';

export const TABS = [
  { id: 'overview', label: 'Overview', path: '/trust' },
  { id: 'security', label: 'Security', path: '/trust/security' },
  { id: 'data', label: 'Data and privacy', path: '/trust/data' },
  { id: 'subprocessors', label: 'Subprocessors', path: '/trust/subprocessors' },
  { id: 'documents', label: 'Documents', path: '/trust/documents' },
  { id: 'disclosure', label: 'Disclosure', path: '/trust/disclosure' },
];

/** The signed-in member's own part, kept at its own address (owner question 1, read from the canvas). */
export const YOUR_TRUST = { id: 'me', label: 'Your trust', path: '/trust/me' };

export const PUBLIC_PATHS = TABS.map((t) => t.path);

/** The tab an address names; any other address under /trust is the overview. */
export const tabOf = (pathname = '') => (TABS.find((t) => t.path === String(pathname).replace(/\/+$/, '')) || TABS[0]).id;

/** One line per status, from `/api/public/status`'s overall state. */
export function statusLine(overall) {
  switch (overall) {
    case 'operational': return 'All systems operational';
    case 'degraded': return 'Some systems degraded';
    case 'down': return 'A major outage is reported';
    default: return 'Status not known';
  }
}

/** A fact the code shows, or one it does not (`missing`), with the line that says what is missing. */
const fact = (text) => ({ text, recorded: true });
const missing = (text, why) => ({ text, recorded: false, why });

export const SECURITY = [
  { title: 'Hosting and network', facts: [
    fact('One production deployment, on a global edge network.'),
    fact('HTTPS only, with HSTS for two years and preload.'),
    fact('Pages cannot be framed by other sites.'),
    fact('A content security policy limits what scripts can run.'),
  ] },
  { title: 'Signing in', facts: [
    fact('Password plus an authenticator app.'), fact('Passkeys.'), fact('Sign in with Google.'), fact('SMS codes.'), fact('Account recovery.'),
  ] },
  { title: 'Inside the team', facts: [
    fact('Sensitive admin actions ask for a fresh code.'),
    fact('Admin actions are written to an audit log.'),
  ] },
  { title: 'Encryption', facts: [
    fact('Phone numbers, connector credentials, due-diligence files and signed documents are encrypted with AES-GCM before storage.'),
    missing('Storage-level encryption by our host', 'Not stated by us yet.'),
  ] },
  { title: 'Backups and recovery', facts: [
    fact('Backups: a backups bucket is bound to the platform.'),
    missing('Last recovery drill', 'No drill date is published yet.'),
  ] },
  { title: 'Testing', facts: [
    missing('Independent penetration test', 'None is on record.'),
    fact('Certifications: none held.'),
  ] },
];

export const DATA = [
  fact('Axal VC Management LLC is the data controller.'),
  fact('No third-party analytics run on the platform.'),
  fact('You are told of a significant breach within 30 days of it being found.'),
  fact('You can download your data or ask to delete your account from your account settings.'),
];

export const SUBPROCESSORS_WAIT = 'Our subprocessor list is being reviewed by counsel. Ask privacy@axal.vc for it.';

/** Severity, acknowledgement, updates, fix target: SECURITY.md's Response SLAs. */
export const RESPONSE_TIMES = [
  ['Critical', '4 business hours', 'every 24 hours', '7 days'],
  ['High', '1 business day', 'every 3 business days', '30 days'],
  ['Medium', '3 business days', 'weekly', '90 days'],
  ['Low', '5 business days', 'at milestones', 'best effort'],
];

export const DISCLOSURE_GAPS = [
  missing('PGP key', 'None is published. Send sensitive detail through the private advisory.'),
  missing('Researchers we thank', 'No report has been credited yet.'),
];

/** The documents and their last update, from the legal pages' own dates; a version is not recorded yet. */
export function documentRows({ terms, privacy, risk }) {
  return [
    { name: 'Terms of Service', to: '/terms', updated: terms || null, appliesTo: 'Everyone' },
    { name: 'Privacy Policy', to: '/privacy', updated: privacy || null, appliesTo: 'Everyone' },
    { name: 'Risk Disclosures', to: '/risk-disclosures', updated: risk || null, appliesTo: 'Investors' },
    { name: 'Interview notice', to: '/privacy/interviews', updated: null, appliesTo: 'Recorded sessions' },
    { name: 'Data Processing Addendum', to: null, updated: null, appliesTo: 'Being reviewed by counsel' },
  ];
}

/* ------------------------------------------------------------------ *
 * D1077 (#2969): the page on the published store
 * ------------------------------------------------------------------ */

export const UNREADABLE = 'Unreadable';
export const TRY_AGAIN = 'Try again';
export const PART_UNREADABLE = 'This part could not be read just now. That is not the same as none.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-14" or an ISO stamp → "14 Oct 2026"; anything else → null (never a made-up day). */
export function dayWord(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
/** A line's check: its date, or "Checked: Not recorded". */
export const checkedLine = (checkedAt) => (dayWord(checkedAt) ? `Checked ${dayWord(checkedAt)}` : CHECKED_WAIT);

/** One read's state: `{ status: 'loading' | 'ready' | 'error', data }`. */
export const isLoading = (read) => !read || read.status === 'loading';
export const isFailed = (read) => read?.status === 'error';
/** A part of `GET /api/public/trust` the Worker could not read. */
const unreadablePart = (v) => Boolean(v && typeof v === 'object' && v.unreadable === true);

/** A static fact as a stored line: no Checked date. */
const asLine = (f) => ({ text: f.text, recorded: f.recorded, why: f.recorded ? null : (f.why || null), checked_at: null });

/** What the page shows for a block the store has never published (D1072's lines). */
export const FALLBACK = {
  glance: [
    { title: 'Security', lines: [SECURITY[0].facts[1], SECURITY[1].facts[0], SECURITY[2].facts[0]].map(asLine), to: '/trust/security' },
    { title: 'Data and privacy', lines: DATA.slice(0, 3).map(asLine), to: '/trust/data' },
    { title: 'Disclosure', lines: ['Report a vulnerability privately.', 'We answer by severity, within set times.', 'We will not take legal action against good-faith research.'].map((text) => asLine(fact(text))), to: '/trust/disclosure' },
  ],
  security: SECURITY.map((g) => ({ title: g.title, lines: g.facts.map(asLine) })),
  data: [{ title: 'Who holds your data, and what you can do', lines: DATA.map(asLine) }],
  disclosure: [{ title: null, lines: DISCLOSURE_GAPS.map(asLine) }],
  documents: [],
  subprocessors: [],
};

/** A stored line, checked: a recorded line needs its text; a gap needs its reason. Anything else is dropped, never shown half-read. */
const cleanLine = (l) => {
  if (!l || typeof l.text !== 'string' || !l.text.trim()) return null;
  const recorded = l.recorded !== false;
  return { text: l.text, recorded, why: recorded ? null : (typeof l.why === 'string' && l.why.trim() ? l.why : null), checked_at: typeof l.checked_at === 'string' ? l.checked_at : null };
};

/**
 * One block of the read, in one of four states:
 *   loading · unreadable (the read failed, or its blocks part did) ·
 *   fallback (never published: the page's own lines, `FALLBACK[key]`) ·
 *   ready (the published block's groups, each line with its Checked date).
 */
export function blockOf(read, key) {
  if (isLoading(read)) return { state: 'loading' };
  const blocks = read.data?.blocks;
  if (isFailed(read) || !blocks || unreadablePart(blocks)) return { state: 'unreadable' };
  const b = blocks[key];
  if (b === null || b === undefined) return { state: 'fallback', groups: FALLBACK[key] || [], intro: null, publishedAt: null };
  if (key === 'certifications') {
    const items = Array.isArray(b.body?.items) ? b.body.items.filter((c) => c && typeof c.name === 'string') : [];
    return { state: 'ready', items, publishedAt: b.published_at || null, checkedAt: b.checked_at || null };
  }
  const groups = (Array.isArray(b.body?.groups) ? b.body.groups : [])
    .map((g) => ({ title: typeof g?.title === 'string' && g.title.trim() ? g.title : null, lines: (Array.isArray(g?.lines) ? g.lines : []).map(cleanLine).filter(Boolean) }))
    .filter((g) => g.lines.length);
  return { state: 'ready', groups, intro: typeof b.body?.intro === 'string' && b.body.intro.trim() ? b.body.intro : null, publishedAt: b.published_at || null, checkedAt: b.checked_at || null };
}

/** The header's "Last reviewed": the newest publish of any block; none published is Not recorded; a read not in is nothing yet. */
export function lastReviewed(read) {
  if (isLoading(read) || isFailed(read) || unreadablePart(read.data?.blocks) || !read.data?.blocks) return null;
  const days = Object.values(read.data.blocks).map((b) => (b && typeof b.published_at === 'string' ? b.published_at : null)).filter(Boolean).sort();
  return days.length ? `Last reviewed ${dayWord(days.at(-1)) || NOT_RECORDED}` : `Last reviewed: ${NOT_RECORDED}`;
}

/** TRU1's Certifications tile: none held is a fact; a certification is named with its auditor. */
export function certificationsTile(read) {
  const b = blockOf(read, 'certifications');
  if (b.state === 'loading' || b.state === 'unreadable') return b;
  const items = b.state === 'ready' ? b.items : [];
  if (!items.length) return { state: 'ready', value: 'None held', sub: 'We list a certification here only after an auditor issues it.' };
  return { state: 'ready', value: `${items.length} held`, sub: items.map((c) => `${c.name}, issued by ${c.auditor}`).join(' · '), items };
}

/** The subprocessors, from the read's own part. None listed is TRU4v: the list is with counsel. */
export function subprocessorsOf(read) {
  if (isLoading(read)) return { state: 'loading' };
  const p = read.data?.subprocessors;
  if (isFailed(read) || !p || unreadablePart(p) || !Array.isArray(p.items)) return { state: 'unreadable' };
  if (!p.items.length) return { state: 'review', line: SUBPROCESSORS_WAIT };
  const items = p.items.map((x) => ({
    uid: x.uid, name: x.name, purpose: x.purpose, data: x.data, location: x.location,
    since: dayWord(x.starts_at) ? (x.active ? dayWord(x.starts_at) : `From ${dayWord(x.starts_at)}`) : null,
    active: Boolean(x.active),
  }));
  return { state: 'ready', items, lastChange: dayWord(p.last_change) };
}

/** TRU1's Subprocessors tile. */
export function subprocessorsTile(read) {
  const s = subprocessorsOf(read);
  if (s.state !== 'ready') return s.state === 'review' ? { state: 'review', sub: 'The list is being reviewed by counsel.' } : s;
  return { state: 'ready', value: `${s.items.length} listed`, sub: s.lastChange ? `Last change ${s.lastChange}` : `Last change: ${NOT_RECORDED}` };
}

/** The change list, newest first: each with its date block, the blocks it touched and its note. */
export function changesOf(part, read = null) {
  if (read && isLoading(read)) return { state: 'loading' };
  if ((read && isFailed(read)) || !part || unreadablePart(part) || !Array.isArray(part.items)) return { state: 'unreadable' };
  if (!part.items.length) return { state: 'empty' };
  const items = part.items.map((c) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(c.published_at || ''));
    const blocks = (Array.isArray(c.blocks) ? c.blocks : []).map((b) => b?.label).filter(Boolean);
    return {
      uid: c.uid, date: m ? { m: MONTHS[Number(m[2]) - 1]?.toUpperCase() || '—', d: m[3], y: m[1] } : null,
      day: dayWord(c.published_at), text: blocks.length ? `${blocks.join(', ')} · ${c.note}` : String(c.note || ''),
    };
  });
  return { state: 'ready', items, complete: part.complete !== false };
}
export const NO_CHANGES = 'No changes published yet.';
export const NO_CHANGES_SUB = 'Changes to the trust center appear here with their date.';

/** "What we check, and for whom": each cell in words; a dash is a requirement not asked of that profile. */
export const MATRIX_DASH = '—';
export const MATRIX_DASH_TIP = 'Not asked of this profile';
export const MATRIX_FOOT = 'A dash means the requirement is not asked of that profile.';
export function matrixCell(cell) {
  if (!cell) return { text: MATRIX_DASH, tip: MATRIX_DASH_TIP, asked: false };
  const n = Number(cell.renews_months);
  const renews = cell.renews_months !== null && cell.renews_months !== undefined && Number.isFinite(n) && n > 0 ? `Renew every ${n} months` : null;
  const base = cell.asked === 'when_it_applies' ? 'When it applies' : 'Required';
  return { text: renews ? (cell.asked === 'when_it_applies' ? `When it applies · ${renews.toLowerCase()}` : renews) : base, tip: null, asked: true };
}
export function matrixOf(read) {
  if (isLoading(read)) return { state: 'loading' };
  const d = read.data;
  if (isFailed(read) || !d || !Array.isArray(d.profiles) || !Array.isArray(d.rows)) return { state: 'unreadable' };
  return {
    state: 'ready', profiles: d.profiles.map((p) => ({ key: p.key, label: p.label })),
    rows: d.rows.map((r) => ({ key: r.key, label: r.label, cells: d.profiles.map((p) => matrixCell(r.cells?.[p.key])) })),
  };
}

/**
 * The Status strip (TRU1s), from `/api/public/status` (D1076): one cell per
 * day across the monitored services, the worst of them. A day no monitored
 * service had begun recording is Not recorded, never a good day; nothing is
 * a percentage.
 */
const RANK = { not_recorded: 0, no_incident: 1, degraded: 2, down: 3 };
export function statusStrip(read) {
  if (isLoading(read)) return { state: 'loading' };
  const services = (isFailed(read) ? null : read.data?.services);
  if (!Array.isArray(services)) return { state: 'unreadable' };
  const monitored = services.filter((s) => s?.monitoring !== 'not_monitored' && Array.isArray(s?.history) && s.history.length);
  if (!monitored.length) return { state: 'none' };
  const days = new Map();
  for (const s of monitored) {
    for (const c of s.history) {
      if (!c || typeof c.day !== 'string' || !(c.status in RANK)) continue;
      const prev = days.get(c.day);
      if (prev === undefined || RANK[c.status] > RANK[prev]) days.set(c.day, c.status);
    }
  }
  const cells = [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, status]) => ({ day, status }));
  const recorded = cells.filter((c) => c.status !== 'not_recorded');
  const clear = recorded.filter((c) => c.status === 'no_incident').length;
  const since = monitored.map((s) => s.records_since).filter((x) => typeof x === 'string').sort()[0] || null;
  const days_ = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
  return {
    state: 'ready', cells,
    title: cells.some((c) => c.status === 'not_recorded') && dayWord(since) ? `Status · records began on ${dayWord(since)}` : 'Status',
    line: recorded.length ? `Days with no incident reported: ${clear} of ${days_(recorded.length)} recorded` : (dayWord(since) ? `Not recorded yet: records begin on ${dayWord(since)}` : `${NOT_RECORDED} yet`),
    alt: recorded.length
      ? `Incident history: no incident reported on ${clear} of ${days_(recorded.length)} recorded${cells.length > recorded.length ? `; the ${days_(cells.length - recorded.length)} before records began are not recorded` : ''}.`
      : 'Incident history: no day is recorded yet.',
  };
}

/** TRU6: the three ways to report. The third is a private report filed from the app, signed in (D1075). */
export const REPORT_WAYS = [
  { key: 'advisory', eye: 'PREFERRED FOR CODE ISSUES', title: 'Private advisory on the code host', note: 'Open a private security advisory on our code repository.', action: 'Open an advisory', href: 'https://github.com/AxalNetwork/StudioOS/security/advisories/new' },
  { key: 'email', eye: 'ANY ISSUE', title: 'Email', note: 'Write to security@axal.vc.', action: 'Copy address', copy: 'security@axal.vc' },
  { key: 'app', eye: 'MEMBERS', title: 'Signed in', note: 'Report a security issue opens a private report only HQ’s security team reads.', action: 'Report a security issue' },
];
export const SAFE_HARBOUR = [
  'We will not take legal action against good-faith research.',
  'Stay within your own accounts and data, and stop if you reach anyone else’s.',
  'Give us time to fix an issue before you publish it.',
];
export const REPORT_DIALOG = {
  title: 'Report a security issue',
  line: 'Only the security team can read this. Do not include other people’s data.',
  done: 'Sent privately. Only HQ’s security team reads it.',
  limits: { affected: 200, what: 5000, how: 5000 },
};

/** TRU5's rows: the legal pages with their own dates, the cookie dialog, the DPA not yet published and security.txt. */
export function documentTable(dates) {
  return documentRows(dates).map((r) => ({ ...r, version: r.to ? null : 'Not published yet', kind: 'page' })).concat([
    { name: 'Cookie preferences', to: null, updated: '—', appliesTo: 'Everyone', version: '—', kind: 'cookies' },
    { name: 'security.txt', to: '/.well-known/security.txt', updated: '—', appliesTo: 'Security researchers', version: '—', kind: 'file' },
  ]);
}

/**
 * D1056 (#2427) — the Reporting desk and the investor's company page as pure
 * rules: the addresses, the tabs, and what each block can say from the reads
 * on `main`. No React here, so `node --test` loads it alone.
 *
 * The reads (D1056 §2):
 *   - Grow's Durable company-building module read, `parts.updates`: every
 *     update the venture sent, with its sent, opened and reply counts. It is
 *     the desk's History until part 3's desk read.
 *   - `GET /api/positions`, `GET /api/portfolio-updates?project_id=` and
 *     `GET /api/portfolio/chases`: the investor's company page.
 * No duty, period, due date or late state is stored yet (#2424's
 * `reporting_duties`, part 2), so none is drawn: each such block says what it
 * waits for, never "nothing due".
 */

export const TITLE = 'Reporting';
export const LINE = 'What you owe the investors who signed, when it’s due, and what you’ve sent.';
export const NOT_YET = 'Not read here yet';
export const DUTIES_LINE = 'Duties come from signed documents. To change one, amend the document in Raise.';

/** The desk's own tabs, under Grow's tab row. */
export const DESK_TABS = [
  { id: 'desk', label: 'Desk', path: '/grow/reporting' },
  { id: 'duties', label: 'Duties', path: '/grow/reporting/duties' },
];

/** Only `?project_id=` rides on a desk tab, so the chosen venture is kept and nothing else. */
export function deskSearch(search = '') {
  const id = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('project_id');
  return id && /^\d+$/.test(id) ? `?project_id=${id}` : '';
}

export const deskHref = (tab, search = '') => `${(DESK_TABS.find((t) => t.id === tab) || DESK_TABS[0]).path}${deskSearch(search)}`;

/**
 * The desk's blocks that no read carries yet, in the canvas's order, each with
 * the part that draws it. Drawn as "Not read here yet" with this reason.
 */
export const DESK_WAITS = [
  { key: 'due-next', title: 'Due next', waits: 'The next period and its readiness wait for the duties store (part 2) and the report assembler (part 3).' },
  { key: 'needs-you', title: 'Needs you', waits: 'Late periods and investors’ asks wait for the periods and the ask route (part 2).' },
  { key: 'calendar', title: 'Calendar', waits: 'The twelve months of duties wait for the duties store (part 2).' },
];

export const DUTIES_WAIT = 'Duties are created when a deal closes on Axal VC’s templates (#2424) and stored by part 2. Until then no duty is shown, which is not the same as owing none.';

// ---------------------------------------------------------------- investor

export const COMPANY_TABS = [
  { id: 'figures', label: 'Figures', path: '' },
  { id: 'reports', label: 'Reports', path: '/reports' },
  { id: 'terms', label: 'Terms', path: '/terms' },
];

/** A project uid as the Worker writes it; anything else is no company. */
export const COMPANY_UID = /^[A-Za-z0-9_-]{1,64}$/;

export function companyHref(uid, tab = 'figures') {
  if (!COMPANY_UID.test(String(uid || ''))) return null;
  const t = COMPANY_TABS.find((x) => x.id === tab) || COMPANY_TABS[0];
  return `/portfolio/companies/${encodeURIComponent(uid)}${t.path}`;
}

/** The tab an address names, from its last segment. */
export const companyTabOf = (pathname = '') => (/\/reports\/?$/.test(pathname) ? 'reports' : /\/terms\/?$/.test(pathname) ? 'terms' : 'figures');

/** The position the investor holds in this company, from `GET /api/positions`, or null. */
export function companyOf(positions, uid) {
  return (Array.isArray(positions) ? positions : []).find((p) => p?.project?.uid && String(p.project.uid) === String(uid)) || null;
}

const day = (v) => {
  const d = v ? new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) || String(v).length <= 10 ? '' : 'Z')) : null;
  return d && !Number.isNaN(d.valueOf()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null;
};

/**
 * The header's holding line, from the position's own fields: the round, the
 * amount invested and the first cheque's date. A missing field is left out,
 * never written as zero. The route (direct, via an SPV, via a fund) is not
 * stored on a position yet (#2424's `closing_lines`).
 */
export function holdingLine(position) {
  if (!position) return null;
  const parts = [];
  if (position.latest_round) parts.push(String(position.latest_round));
  const inv = Number(position.total_invested);
  if (Number.isFinite(inv) && inv > 0) parts.push(`${(inv).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} invested`);
  const since = day(position.first_date);
  if (since) parts.push(`since ${since}`);
  return parts.length ? `Your holding: ${parts.join(' · ')}` : 'Your holding: not recorded';
}

/**
 * The Reports tab: this company's updates the investor can read, newest
 * first, each with its period and the date it was sent. A row is "Received"
 * only when the Worker gives a submitted date.
 */
export function reportRows(updates, projectId) {
  const pid = String(projectId);
  return (Array.isArray(updates) ? updates : [])
    .filter((u) => u && String(u.project_id) === pid)
    .map((u) => {
      const at = u.submitted_at || u.sent_at || null;
      return { key: String(u.uid || u.id), title: u.title || (u.period ? `Update · ${u.period}` : 'Update'), period: u.period || null, sent: day(at), at, href: u.uid ? `/updates/${encodeURIComponent(u.uid)}` : null };
    })
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

export const FIGURES_WAIT = 'Figures over time are drawn from the frozen figures of the reports you received, which part 3 stores. Until then no chart is drawn, so nothing here is a guessed or zero value.';
export const TERMS_WAIT = 'The duties owed to you wait for the duties store (part 2), read from the documents you signed.';
export const NOT_HELD = 'This company is not in your portfolio, or your positions could not be matched to it.';

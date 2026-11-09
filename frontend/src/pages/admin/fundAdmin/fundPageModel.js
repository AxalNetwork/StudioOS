/**
 * D4812 part 3 (#4812, board FA-04) — the fund page's identity and the person
 * picker's words, pure.
 *
 * The page leads with who the fund is and six figures: target size,
 * committed, called, NAV, distributed and LPs. Committed and called come from
 * the overview's row for the fund; NAV and distributed from
 * `GET /api/fund-performance/:id`. A figure no read holds is Not recorded with
 * its reason, and a failed read Unreadable, never 0.
 *
 * The picker changes one of the two people a fund names. Who may hold each
 * role is the Worker's rule, read with each candidate
 * (`GET /api/fund-admin/funds/:id/people`); this file only words the change.
 */
import { BASE, money } from './fundAdminModel.js';
import { sizeText, statusLabel } from './fundsModel.js';


/** FA-04's local navigation: this page, then the workspaces with this fund in scope, then the page's own sections. */
export function fundNav(fundId) {
  return [
    { key: 'overview', label: 'Overview', to: `${BASE}/funds/${fundId}` },
    { key: 'investors', label: 'Investors', to: `${BASE}/lps?fund=${fundId}` },
    { key: 'capital', label: 'Capital', to: `${BASE}/calls?fund=${fundId}` },
    { key: 'portfolio', label: 'Portfolio', to: `${BASE}/performance?fund=${fundId}` },
    { key: 'documents', label: 'Documents', to: `${BASE}/funds/${fundId}#fund-documents` },
    { key: 'settings', label: 'Settings', to: `${BASE}/funds/${fundId}#fund-settings` },
  ];
}

/** The line under the fund's name: vintage, status and its GP of record by name. */
export function identityLine(fund, gp) {
  const parts = [
    fund?.vintage_year ? `Vintage ${fund.vintage_year}` : 'Vintage not recorded',
    statusLabel(fund?.status),
  ];
  if (gp?.status === 'ready') parts.push(gp.data?.current ? `GP: ${gp.data.current.name}` : 'GP of record not named');
  return parts.join(' · ');
}

const isCents = (v) => v != null && Number.isSafeInteger(Number(v));

/**
 * The six key figures, each `{ key, label, value }` or `{ key, label, state:
 * 'not_recorded', reason }` or `{ key, label, state: 'unreadable' }`.
 */
export function keyFigures(fund, item, perf) {
  const ledger = (key, label, field) => {
    if (!item) return { key, label, state: 'not_recorded', reason: 'Not read for a fund the console does not administer.' };
    return isCents(item[field]) ? { key, label, value: money(Number(item[field])) } : { key, label, state: 'not_recorded', reason: 'No figure is recorded.' };
  };
  const p = (key, label, field) => {
    if (perf?.status === 'unreadable') return { key, label, state: 'unreadable' };
    // A read that was never made is not a read in progress: it says so, and never draws a bar forever.
    if (!perf || perf.status === 'idle') return { key, label, state: 'not_recorded', reason: 'Not read on this page; Portfolio reads it.' };
    if (perf.status !== 'ready') return { key, label, state: 'loading' };
    const v = perf.data?.[field];
    return isCents(v) ? { key, label, value: money(Number(v)), note: key === 'nav' && perf.data?.as_of ? `latest marks to ${perf.data.as_of}` : null }
      : { key, label, state: 'not_recorded', reason: perf.data?.unavailable?.[field] || 'No figure is recorded.' };
  };
  const size = sizeText(fund?.fund_size_cents);
  return [
    size ? { key: 'target', label: 'Target size', value: size } : { key: 'target', label: 'Target size', state: 'not_recorded', reason: 'No target size is recorded.' },
    ledger('committed', 'Committed', 'committed_cents'),
    ledger('called', 'Called', 'called_cents'),
    p('nav', 'NAV', 'nav_cents'),
    p('distributed', 'Distributed', 'distributed_cents'),
    Number.isSafeInteger(Number(fund?.lp_count)) ? { key: 'lps', label: 'LPs', value: String(fund.lp_count) } : { key: 'lps', label: 'LPs', state: 'not_recorded', reason: 'Not counted.' },
  ];
}

/** The two roles a fund names, and what each change does. */
export const ROLES = Object.freeze({
  gp: {
    key: 'gp', label: 'General partner of record', act: 'fund.gp_of_record',
    verb: (name) => `Make ${name} general partner of record`,
    effects: (from, to) => [
      `${to} becomes the fund’s general partner of record${from ? `, in place of ${from}` : ''}.`,
      'The GP of record’s name signs LP documents; the LPA is redrafted only when you regenerate it.',
      'The change and its reason are kept on the audit record.',
    ],
    reason: true,
  },
  ledger: {
    key: 'ledger', label: 'Ledger administrator', act: 'fund_ledger.administrator',
    verb: (name) => (name ? `Make ${name} ledger administrator` : 'Remove the ledger administrator'),
    effects: (from, to) => (to
      ? [`${to} can write this fund’s ledger.`, ...(from ? [`${from} no longer can.`] : []), 'HQ admins keep the books either way.']
      : [`${from || 'The administrator'} no longer writes this fund’s ledger.`, 'HQ admins keep the books.']),
    reason: false,
  },
});

export const REASON_MIN = 10;
export const REASON_MAX = 500;

/** The change's body, or `{ error }`: an eligible person who is not already in the role, and for the GP a reason. */
export function checkChange(role, pick, reason) {
  const r = ROLES[role];
  if (!r) return { error: 'Choose a role.' };
  if (pick === undefined) return { error: 'Choose a person.' };
  if (pick && pick.current) return { error: `${pick.name} already holds this role.` };
  if (pick && !pick.eligible) return { error: pick.reason || 'This person cannot hold this role.' };
  if (pick === null && role === 'gp') return { error: 'A fund keeps a general partner of record.' };
  if (r.reason) {
    const text = String(reason ?? '').trim();
    if (text.length < REASON_MIN || text.length > REASON_MAX) return { error: `A reason is ${REASON_MIN} to ${REASON_MAX} characters.` };
    return { body: { gp_user_id: pick.id, reason: text } };
  }
  return { body: { user_id: pick ? pick.id : null } };
}

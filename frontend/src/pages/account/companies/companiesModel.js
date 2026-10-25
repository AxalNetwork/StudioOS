/**
 * D1134 (#2422) — Account › Companies and projects: the words, the tabs and
 * every derivation from the reads, kept pure so the tests read them without a
 * browser.
 *
 * WHAT IS READ, AND FROM WHERE. Every row comes from a read on `main`:
 *   - `GET /api/company/memberships` → Companies: one card per company, with
 *     the caller's role, primary admin, members, the cycles in use and when
 *     it was last opened (the same read the sidebar switcher makes);
 *   - `GET /api/projects` → Projects, for a founder only. For an investor or an
 *     Operating Partner that read answers every project on the platform
 *     (#2422 § What is missing), so it is never made for them here.
 *
 * ACTIVE ON THIS DEVICE. The active company lives in this browser only
 * (`active_company_id`, sent as `X-Company-Id`); `/me` carries none. The page
 * says so rather than calling it the account's.
 *
 * WHAT IS NOT DRAWN YET. Invitations addressed to you have no read; another
 * profile's ventures have no read that is theirs alone; archive, leave,
 * transfer and move have no route. Each says so (D1134 §6).
 */

import { NOT_RECORDED } from '../../../lib/absence.js';

export const SECTION = 'companies';
export const TITLE = 'Companies and projects';
export const LINE = 'The companies you belong to and the ventures you work on. The one marked active is the one the sidebar switcher has picked on this device.';
export const ACTIVE_HERE = 'Active on this device';

export const TABS = [
  { id: 'companies', label: 'Companies' },
  { id: 'projects', label: 'Projects' },
  { id: 'invitations', label: 'Invitations' },
];

export const WAITS = {
  invitations: 'Not read here yet. No read lists the invitations addressed to you; they arrive by email link today. This is not a claim that you have none.',
  projects: 'Not read here yet. Only a founder’s own ventures have a read that is theirs alone today; yours need one before they can be listed here.',
  manage: 'Company Settings edits the company that is active on this device. Switch to a company in the sidebar to edit it there.',
};

const CYCLE_WORDS = { validate: 'Validate', build: 'Build', raise: 'Raise', grow: 'Grow' };

/** "3 Oct 2026" from an ISO date or stamp; anything else is null. */
export function day(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${M[Number(m[2]) - 1]} ${m[1]}`;
}

/** The cycles a company is in use for, in words; null (not read) is never "none". */
export function cyclesLine(cycles) {
  if (cycles == null) return 'Cycles: could not be read';
  if (!Array.isArray(cycles) || cycles.length === 0) return 'No cycle in use';
  return cycles.map((c) => CYCLE_WORDS[c] || String(c)).join(', ');
}

/** One card per company, from `GET /api/company/memberships`. */
export function companyCards(memberships, activeId = null) {
  const list = Array.isArray(memberships) ? memberships : [];
  return list.map((c) => ({
    id: Number(c.id),
    uid: c.uid,
    name: String(c.company_name || '').trim() || NOT_RECORDED,
    role: c.my_role || NOT_RECORDED,
    primary: !!c.is_primary_admin,
    members: Number.isFinite(Number(c.member_count)) ? Number(c.member_count) : (Array.isArray(c.members) ? c.members.length : null),
    stage: String(c.stage || '').trim() || null,
    cycles: cyclesLine(c.cycles_active),
    lastOpened: day(c.last_opened) || null,
    active: activeId != null && Number(c.id) === Number(activeId),
  }));
}

const STAGE = { idea: 'Idea', validation: 'Validation', mvp: 'MVP', growth: 'Growth', scale: 'Scale' };

/**
 * A founder's ventures grouped by company (CMP3): each company's ventures in
 * the companies' order, then "Not in a company". A trashed venture is left out.
 */
export function projectGroups(projects, memberships) {
  const list = (Array.isArray(projects) ? projects : (projects?.items || [])).filter((p) => !p?.deleted_at);
  const companies = Array.isArray(memberships) ? memberships : [];
  const row = (p) => ({ id: p.id, name: String(p.name || '').trim() || 'Untitled venture', stage: STAGE[p.stage] || p.stage || NOT_RECORDED, week: p.playbook_week || null });
  const groups = companies.map((c) => ({
    key: `c-${c.id}`, title: String(c.company_name || '').trim() || NOT_RECORDED,
    rows: list.filter((p) => p.company_id != null && Number(p.company_id) === Number(c.id)).map(row),
  })).filter((g) => g.rows.length);
  const known = new Set(companies.map((c) => Number(c.id)));
  const loose = list.filter((p) => p.company_id == null || !known.has(Number(p.company_id))).map(row);
  if (loose.length) groups.push({ key: 'none', title: 'Not in a company', rows: loose });
  return groups;
}

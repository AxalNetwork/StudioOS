/**
 * D4154 (#4154) — the Calendar's admin scopes, the words and rules they draw by.
 *
 * Pure, for the Node test. `GET /api/calendar/events` already answers
 * `scope=studio` (an admin, on a studio deployment) and `scope=all` (the Super
 * Admin, on HQ) read-only (D1206, `fetchCalendarScope`): every item carries
 * `read_only: true` and `can` all false, and every email is nulled. This file
 * decides who sees which scope, how a scoped item reads as a row, and how the
 * coverage the route sends is said. What the items do not carry yet (owner,
 * company, studio, the link into the company) is C1's (#4196).
 */

import { NOT_RECORDED } from '../../lib/absence.js';
import { branchLabel, branchOfUser, isSuperAdminUser } from '../../lib/shellRole.js';

export { NOT_RECORDED };

/** The build task behind what the items do not carry yet. */
export const BUILD = {
  C1: { issue: 4196, live: false, what: 'Each item’s owner, company, studio and its link into the company' },
};
export const notYet = (key) => `Not switched on yet. ${BUILD[key].what} arrives with #${BUILD[key].issue}.`;

/** The three scopes, in the canvas's order, with the value the route takes. */
export const SCOPES = [
  { key: 'mine', label: 'Mine', api: null },
  { key: 'studio', label: 'Studio', api: 'studio' },
  { key: 'platform', label: 'Platform', api: 'all' },
];

/**
 * Which scopes a viewer has, mirroring the route (`routes/calendar.ts`):
 * a member has none (no switcher is drawn); an admin on a studio deployment
 * has Studio; the Super Admin on HQ has Platform. A plain HQ admin has no
 * staff scope: HQ has no member-to-licence association, so the route answers
 * Studio there with "Open the studio deployment", and Platform is the Super
 * Admin's alone. The Worker re-checks every read.
 */
export function scopesFor(user) {
  if (String(user?.role || '').toLowerCase() !== 'admin') return [];
  const keys = ['mine'];
  if (branchOfUser(user)) keys.push('studio');
  else if (isSuperAdminUser(user)) keys.push('platform');
  return keys.length > 1 ? SCOPES.filter((s) => keys.includes(s.key)) : [];
}

/** The scope `?scope=` names, when the viewer has it; else Mine. */
export function scopeOf(search = '', allowed = []) {
  const v = new URLSearchParams(String(search).replace(/^\?/, '')).get('scope');
  return allowed.some((s) => s.key === v) && v !== 'mine' ? v : 'mine';
}

/** `search` with `?scope=` set (or cleared for Mine), keeping the rest. */
export function withScope(search = '', scope) {
  const p = new URLSearchParams(String(search).replace(/^\?/, ''));
  if (!scope || scope === 'mine') p.delete('scope'); else p.set('scope', scope);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const apiScope = (scope) => SCOPES.find((s) => s.key === scope)?.api ?? null;

/** "Viewing: Studio" — with the studio's name when `/me` gives it. */
export function viewingChip(scope, user) {
  if (scope === 'studio') return `Viewing: Studio${branchLabel(user) ? ` · ${branchLabel(user)}` : ''}`;
  if (scope === 'platform') return 'Viewing: Platform';
  return null;
}

/** CA2's types, each over the Worker's kinds. Agent runs arrive as a kind with #3957. */
export const TYPES = [
  { key: 'meeting', label: 'Meeting', kinds: ['ic_meeting', 'founder_checkin', 'investor_meeting', 'advisor_booking', 'partner_office_hour'] },
  { key: 'deadline', label: 'Deadline', kinds: ['cohort_date', 'deal_closing', 'round_close', 'nda_expiry', 'workflow_task', 'mvp_task', 'contact_task', 'engagement_milestone'] },
  { key: 'compliance', label: 'Compliance', kinds: ['compliance_due'] },
  { key: 'learning', label: 'Learning', kinds: ['learning'] },
  { key: 'event', label: 'Event', kinds: ['event_ticket', 'event_hosted'] },
];
export const AGENT_RUNS_LINE = 'Agent runs join the staff calendar when scheduled agent runs exist (#3957).';
export const typeOf = (kind) => TYPES.find((t) => t.kinds.includes(kind)) || null;

const textOf = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * One scoped item as a CA2 row. The owner falls back to the founder or first
 * named person the route sends; the company, studio and link are C1's and
 * read "Not recorded" until then. A row never carries an edit.
 */
export function scopedRow(item) {
  const people = (item?.attendees || []).filter((p) => textOf(p?.name));
  const owner = textOf(item?.owner?.name) ?? textOf(people.find((p) => p.role === 'founder')?.name) ?? textOf(people[0]?.name) ?? NOT_RECORDED;
  const type = typeOf(item?.kind);
  return {
    id: String(item?.id ?? item?.uid ?? ''),
    kind: item?.kind ?? null,
    type: type?.label ?? 'Other',
    typeKey: type?.key ?? 'other',
    title: textOf(item?.title) ?? 'Untitled',
    start: item?.start_at ?? null,
    end: item?.end_at ?? null,
    allDay: item?.all_day === true,
    owner,
    people: people.map((p) => p.name),
    company: textOf(item?.company?.name) ?? NOT_RECORDED,
    project: textOf(item?.project_name) ?? textOf(item?.deal_name),
    studio: textOf(item?.studio?.name) ?? (item?.studio?.code === 'hq' ? 'HQ-held' : null),
    where: textOf(item?.where) ?? NOT_RECORDED,
    openHref: textOf(item?.open_href),
    status: textOf(item?.status),
    cancelled: item?.status === 'cancelled',
    readOnly: true,
  };
}

/** The filters over the read: type, project and a person by name. */
export function filterRows(rows, { type = '', project = '', person = '' } = {}) {
  const who = String(person).trim().toLowerCase();
  return (rows || []).filter((r) => (!type || r.typeKey === type) && (!project || r.project === project)
    && (!who || [r.owner, ...r.people].some((n) => typeof n === 'string' && n.toLowerCase().includes(who))));
}

const dayKey = (iso) => {
  const d = new Date(iso ?? '');
  return Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;
};

/** CA2's agenda: rows grouped by local day, in time order, each day with its count. */
export function byDay(rows) {
  const days = new Map();
  for (const r of [...(rows || [])].sort((a, b) => String(a.start).localeCompare(String(b.start)))) {
    const k = dayKey(r.start);
    if (!k) continue;
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(r);
  }
  return [...days.entries()].map(([day, items]) => ({ day, items, line: `${items.length} item${items.length === 1 ? '' : 's'}` }));
}

/**
 * CA3's month counts: every day of the window with its count. When the read
 * was incomplete a day with nothing reads "Not recorded", never "0 items":
 * a studio that did not answer is not an empty day.
 */
export function dayCounts(rows, from, to, complete = true) {
  const counts = new Map();
  for (const r of rows || []) { const k = dayKey(r.start); if (k) counts.set(k, (counts.get(k) || 0) + 1); }
  const out = [];
  for (let d = new Date(from); d < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const k = dayKey(d.toISOString());
    const n = counts.get(k) || 0;
    out.push({ day: k, n, line: n ? `${n} item${n === 1 ? '' : 's'}` : complete ? '0 items' : NOT_RECORDED });
  }
  return out;
}

/** The coverage the route sends, said plainly: complete, or what did not answer. */
export function coverageLine(coverage, scope, user) {
  if (!coverage) return 'Coverage not reported.';
  if (coverage.complete) return scope === 'studio' ? `Every company in ${branchLabel(user) || 'this studio'} answered.` : 'Every studio answered.';
  const missing = (coverage.studios || []).filter((s) => !s.ok).map((s) => s.name || s.code || 'A studio');
  return [coverage.reason, missing.length ? `Not read: ${missing.join(', ')}.` : null].filter(Boolean).join(' ') || 'Some of the calendar could not be read.';
}

/** CA5c: a scope with nothing in the window, said with whether everyone answered. */
export function emptyLine(scope, user, complete) {
  const where = scope === 'studio' ? (branchLabel(user) || 'this studio') : 'any studio';
  return `Nothing in ${where} in this range.${complete ? (scope === 'studio' ? ' Every company answered.' : ' Every studio answered.') : ''}`;
}

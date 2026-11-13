/**
 * D4154 C1 (#4196) — what a staff scope's item says about where it lives.
 *
 * `fetchCalendarScope` (D1206) answers `GET /api/calendar/events?scope=studio|all`
 * read-only. Each of its items also carries, for the admin page's rows (CA2,
 * CA3) and item detail (CA4):
 *
 *   owner     { uid, name } — the person the item belongs to, read in the same
 *             bound statement as the item (`owner_user_uid`, `owner_user_name`).
 *             A name, never an email: no scoped statement selects one, and a
 *             name that is itself an address is dropped rather than shown.
 *   company   { uid, name } — the company its venture sits in
 *             (`projects.company_id` → `company_profiles`), from ONE batched
 *             lookup for the whole read. A failed lookup leaves every company
 *             null; the scope still answers.
 *   studio    { code, name } — on `scope=all` only. That scope is HQ's alone
 *             and reads HQ's D1 alone (remote studios are "Not read here yet",
 *             D1206), so every row it returns is HQ-held. A branch's rows would
 *             carry the branch's code and name; none is read today.
 *   open_href the item's page inside its company — a link, never a write —
 *             or null when the item has none.
 *   where     "<company> › <module>", the company and the registry's module
 *             the item lives in, or null when the company is not known.
 *
 * `can` stays all false and `href` stays null: this file adds a way to look,
 * not a way to act.
 */
import type { Env } from '../../types';
import type { CalendarEvent } from '../calendar';

export type ScopeOwner = { uid: string | null; name: string };
export type ScopeCompany = { uid: string; name: string };
export type ScopeStudio = { code: string; name: string };

/** Every row `scope=all` returns today: HQ's own D1, HQ-held. */
export const HQ_STUDIO: Readonly<ScopeStudio> = Object.freeze({ code: 'hq', name: 'HQ-held' });

/** What the source row knew about an item, kept beside the projection. */
export interface ScopeRowFacts { owner: ScopeOwner | null; event_slug: string | null; event_status: string | null }

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** A person's name as a staff scope may show it: trimmed, and never an email address. */
export const personName = (v: unknown): string | null => { const n = text(v); return n && !EMAIL.test(n) ? n : null; };

/** The owner columns every scoped statement selects; a compliance deadline may name a free-text owner instead. */
export function scopeRowFacts(kind: CalendarEvent['kind'], row: Record<string, unknown>): ScopeRowFacts {
  const name = personName(row.owner_user_name);
  let owner: ScopeOwner | null = name ? { uid: text(row.owner_user_uid), name } : null;
  if (!owner && kind === 'compliance_due') {
    const written = personName(row.owner_name);
    if (written) owner = { uid: null, name: written };
  }
  return { owner, event_slug: text(row.event_slug), event_status: text(row.event_status) };
}

export interface ScopeCompanies { byProject: Map<number, ScopeCompany>; byDeal: Map<number, ScopeCompany> }

const ids = (values: unknown[]): number[] =>
  [...new Set(values.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

/**
 * Each item's company, in one bound statement for the whole read (no lookup
 * per item). An IC meeting reaches its company through its deal's venture.
 */
export async function scopeCompanies(env: Env, events: Pick<CalendarEvent, 'project_id' | 'deal_id'>[]): Promise<ScopeCompanies> {
  const out: ScopeCompanies = { byProject: new Map(), byDeal: new Map() };
  const projects = ids(events.map((e) => e.project_id));
  const deals = ids(events.map((e) => e.deal_id));
  if (!projects.length && !deals.length) return out;
  try {
    const rows = await env.DB.prepare(
      `SELECT 'project' AS via, p.id AS id, cp.uid AS company_uid, cp.company_name AS company_name
         FROM projects p JOIN company_profiles cp ON cp.id = p.company_id
        WHERE p.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) AND p.deleted_at IS NULL
       UNION ALL
       SELECT 'deal' AS via, d.id AS id, cp.uid AS company_uid, cp.company_name AS company_name
         FROM deals d JOIN projects p ON p.id = d.project_id JOIN company_profiles cp ON cp.id = p.company_id
        WHERE d.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) AND p.deleted_at IS NULL`,
    ).bind(JSON.stringify(projects), JSON.stringify(deals))
      .all<{ via: string; id: number; company_uid: string | null; company_name: string | null }>();
    for (const r of rows.results || []) {
      const uid = text(r.company_uid), name = text(r.company_name);
      if (!uid || !name) continue;
      (r.via === 'deal' ? out.byDeal : out.byProject).set(Number(r.id), { uid, name });
    }
  } catch {
    // Counts only: never a database message, a name or a member identifier.
    console.warn('[calendar] scope companies unreadable', { projects: projects.length, deals: deals.length });
    return { byProject: new Map(), byDeal: new Map() };
  }
  return out;
}

export function companyOf(ev: Pick<CalendarEvent, 'project_id' | 'deal_id'>, companies: ScopeCompanies): ScopeCompany | null {
  const viaProject = ev.project_id ? companies.byProject.get(Number(ev.project_id)) : undefined;
  const viaDeal = ev.deal_id ? companies.byDeal.get(Number(ev.deal_id)) : undefined;
  const found = viaProject || viaDeal;
  return found ? { ...found } : null;
}

/**
 * The item's own page inside its company, or null. Only pages that address
 * this item's record: a personal page (My events, Capital relationships, an
 * advisor's practice) would show the admin their own calendar, not the item.
 */
export function scopeOpenHref(ev: Pick<CalendarEvent, 'kind' | 'project_id' | 'deal_id'>, facts: ScopeRowFacts | undefined, company: ScopeCompany | null): string | null {
  switch (ev.kind) {
    case 'ic_meeting': return ev.deal_id ? `/deals/${Number(ev.deal_id)}` : null;
    case 'founder_checkin': return ev.project_id ? `/projects/${Number(ev.project_id)}` : null;
    // D1614: a company's compliance tasks live under its settings.
    case 'compliance_due':
      if (company) return `/account/companies/${encodeURIComponent(company.uid)}/settings/compliance`;
      return ev.project_id ? `/projects/${Number(ev.project_id)}` : null;
    // An event's public page exists once it is published; a draft has none to open.
    case 'event_ticket':
    case 'event_hosted':
      return facts?.event_slug && facts.event_status === 'published' ? `/events/${encodeURIComponent(facts.event_slug)}` : null;
    default: return null;
  }
}

/** "Northwind Labs › Build › Compliance": the company, then the module the registry names. */
export function scopeWhere(company: ScopeCompany | null, module: string | null | undefined): string | null {
  const m = text(module);
  return company && m ? `${company.name} › ${m}` : null;
}

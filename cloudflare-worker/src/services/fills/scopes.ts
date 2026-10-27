/**
 * D1329 (#3490, #2431 part 6) — RECORD_SCOPES: the records Fill with Eadwyn
 * fills that do not sit on a venture.
 *
 * Every founder form is a venture's (`canAccessProject`, D1325). The other
 * profiles write records owned another way, and each keeps its own route's
 * write check, read here as one literal statement and one rule:
 *
 *   advisor_services          the advisor's own service    (routes/advisors.ts, `requireMyAdvisor`)
 *   engagement_status_reports the partner on the engagement, until it is sent
 *                             (routes/partner_delivery.ts, `requireOwnEngagement`; a sent report is frozen)
 *   events, event_agenda_items `canManage`: an admin, or the event's host (routes/events.ts)
 *   admin_publications        an admin (routes/admin_publications.ts, `requireAdmin`)
 *   ic_decisions              its author, while it is not decided (routes/ic.ts `PUT /:uid`);
 *                             read as `icDecisionScope` reads it
 *
 * WHO SEES WHAT, as on a venture: whoever may read the record reads its marks;
 * the trigger is for whoever may write it, in their own session. A reader is,
 * for a status report, the client founder it is sent to; for an IC memo, a
 * colleague who votes on it or shares its firm.
 *
 * NO ADMIN TRIGGER ON A DECISION OR A MEMBER'S RECORD (#2431 question 5, A).
 * An admin manages events and publications, which are content they write. An
 * IC memo is another member's decision record: an admin reads it and gets no
 * trigger. An approval and a member's own record have no FILL_FIELDS entry.
 *
 * An Add form has no record yet: its `parent` is what the new row will hang
 * under (the caller's own advisor profile, an engagement, an event), checked
 * by the same rule. Every statement is literal; every value is bound.
 */
import type { Env, User } from '../../types';

export interface ScopeAccess { read: boolean; write: boolean }
export type ParentKind = 'advisor' | 'engagement' | 'event';

export interface RecordScope {
  /** The record by its id, with what its rule reads. */
  read: string;
  /**
   * What an Add form's new row hangs under, and the column that names it on
   * the row; null for a record that is only edited here. `own`: the parent is
   * the caller's own profile, never one a request names.
   */
  parent: { kind: ParentKind; column: string; own?: (env: Env, user: User) => Promise<number | null> } | null;
  /** The caller's access to a record (`row`), or to adding one under `parentId`. */
  access(env: Env, user: User, row: Record<string, unknown> | null, parentId: number | null): Promise<ScopeAccess>;
}

const NONE: ScopeAccess = Object.freeze({ read: false, write: false });
const role = (u: User) => String(u.role || '').toLowerCase();
const isAdminUser = (u: User) => role(u) === 'admin';

/** The caller's own advisor profile id (`myAdvisor`'s rule: the profile whose user is the caller). */
export async function myAdvisorId(env: Env, user: User): Promise<number | null> {
  const r = await env.DB.prepare('SELECT id FROM advisors WHERE user_id = ?').bind(user.id).first<{ id: number }>();
  return r ? Number(r.id) : null;
}

/** The caller's own partner profile id (`requirePartnerProfile`'s rule), for a partner. */
async function myPartnerId(env: Env, user: User): Promise<number | null> {
  if (role(user) !== 'partner' || !(user as any).partner_id) return null;
  const r = await env.DB.prepare('SELECT id FROM partners WHERE id = ?').bind((user as any).partner_id).first<{ id: number }>();
  return r ? Number(r.id) : null;
}

/** `canManage` in routes/events.ts: an admin, or the event's host. */
const manages = (event: Record<string, unknown> | null, user: User) => !!event && (isAdminUser(user) || Number(event.host_user_id) === Number(user.id));

export const RECORD_SCOPES: Readonly<Record<string, RecordScope>> = Object.freeze({
  advisor_services: {
    read: 'SELECT * FROM advisor_services WHERE id = ?',
    parent: { kind: 'advisor', column: 'advisor_id', own: myAdvisorId },
    async access(env, user, row, parentId) {
      const mine = await myAdvisorId(env, user);
      if (mine == null) return NONE;
      const own = row ? Number(row.advisor_id) === mine : parentId === mine;
      return own ? { read: true, write: true } : NONE;
    },
  },
  engagement_status_reports: {
    read: `SELECT r.*, e.partner_id AS engagement_partner_id, e.founder_id AS engagement_founder_id
             FROM engagement_status_reports r JOIN engagements e ON e.id = r.engagement_id WHERE r.id = ?`,
    parent: { kind: 'engagement', column: 'engagement_id' },
    async access(env, user, row, parentId) {
      const engagement = row
        ? { partner_id: row.engagement_partner_id, founder_id: row.engagement_founder_id }
        : parentId == null ? null
          : await env.DB.prepare('SELECT partner_id, founder_id FROM engagements WHERE id = ?').bind(parentId).first<{ partner_id: number; founder_id: number | null }>();
      if (!engagement) return NONE;
      const partner = await myPartnerId(env, user);
      if (partner != null && Number(engagement.partner_id) === partner) {
        // A sent report is a record of what the client received: read, never filled.
        return { read: true, write: !row || row.state !== 'sent' };
      }
      // The client founder the report is sent to reads its marks.
      const founderId = (user as any).founder_id;
      if (row && founderId != null && engagement.founder_id != null && Number(engagement.founder_id) === Number(founderId)) return { read: true, write: false };
      return NONE;
    },
  },
  events: {
    read: 'SELECT * FROM events WHERE id = ?',
    parent: null,
    async access(_env, user, row) {
      return manages(row, user) ? { read: true, write: true } : NONE;
    },
  },
  event_agenda_items: {
    read: 'SELECT a.*, e.host_user_id FROM event_agenda_items a JOIN events e ON e.id = a.event_id WHERE a.id = ?',
    parent: { kind: 'event', column: 'event_id' },
    async access(env, user, row, parentId) {
      const event = row ? { host_user_id: row.host_user_id }
        : parentId == null ? null : await env.DB.prepare('SELECT host_user_id FROM events WHERE id = ?').bind(parentId).first<Record<string, unknown>>();
      return manages(event, user) ? { read: true, write: true } : NONE;
    },
  },
  admin_publications: {
    read: 'SELECT * FROM admin_publications WHERE id = ?',
    parent: null,
    async access(_env, user, row) {
      return row && isAdminUser(user) ? { read: true, write: true } : NONE;
    },
  },
  ic_decisions: {
    read: 'SELECT * FROM ic_decisions WHERE id = ?',
    parent: null,
    async access(env, user, row) {
      if (!row || !['admin', 'investor', 'partner'].includes(role(user))) return NONE;
      // `icDecisionScope`'s predicate, as one literal statement: the author, a voter, or the firm's.
      // An admin reads every decision, as that scope lets them.
      const readable = isAdminUser(user) || !!(await env.DB.prepare(
        `SELECT 1 FROM ic_decisions d WHERE d.id = ? AND (d.created_by = ?
            OR EXISTS (SELECT 1 FROM ic_votes v WHERE v.ic_decision_id = d.id AND v.user_id = ?)
            OR (d.company_id IS NOT NULL AND EXISTS (SELECT 1 FROM user_company_links ucl WHERE ucl.user_id = ? AND ucl.company_id = d.company_id)))`,
      ).bind(row.id, user.id, user.id, user.id).first());
      if (!readable) return NONE;
      // Only the author fills it, and never once it is decided: an admin gets marks, not a trigger.
      return { read: true, write: Number(row.created_by) === Number(user.id) && row.status !== 'decided' };
    },
  },
});

/** Each scoped table's own read, by table, for `routes/fills.ts`' ROW_READS. */
export const SCOPED_READS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(Object.entries(RECORD_SCOPES).map(([t, s]) => [t, s.read])));

/** The scope a form's table is filled under, or null for a venture's table. */
export const scopeOf = (table: string): RecordScope | null => (Object.hasOwn(RECORD_SCOPES, table) ? RECORD_SCOPES[table] : null);

/** The parent an Add form's proposals are filed under, as `<kind>:<id>`; a new row is checked against it after its Save. */
export const parentKey = (scope: RecordScope, id: number) => `${scope.parent?.kind ?? 'none'}:${id}`;

/** Which profiles hold nothing Fill can fill yet: the Explorer (AF22). */
export const isExplorer = (user: User) => role(user) === 'exploring';

import { holdsLicence } from '../accountLicences';
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
 *   events, event_agenda_items `canManage`: an admin, or the event's host (routes/events.ts);
 *                             #4046 (B2): a new event (/events/new) hangs under the caller, its host
 *   admin_publications        an admin (routes/admin_publications.ts, `requireAdmin`)
 *   ic_decisions              its author, while it is not decided (routes/ic.ts `PUT /:uid`);
 *                             read as `icDecisionScope` reads it
 *   portfolio_support_entries D1595: an investor, on a project in their own book
 *                             (routes/portfolio_support.ts, `supportBookIds`); an admin reads
 *   service_offerings         D1595: the offering's owner (routes/services.ts, `offeringOwned`);
 *                             an admin reads
 *   perks                     D1595: a partner's own listing (routes/perks.ts, `myPerk`);
 *                             an admin reads
 *   deal_notes                #4046: a firm's private note on a deal (routes/deal_context.ts,
 *                             `context`): an investor who may open the deal for that firm reads
 *                             the firm's notes; only the note's author fills it. No staff bypass.
 *   testing_applications      #4046 (B2): a member's application to a product-testing programme,
 *                             under the programme while `apply` would take it (services/testing.ts,
 *                             `mayApplyTo`); a sent one is its member's alone. No staff bypass.
 *   program_proposals         #4046 (B4): a studio's program proposal (routes/admin_program_proposals.ts,
 *                             `requireAdmin` then services/programProposals.ts `ownRow`): its studio's
 *                             admins, or its creator while HQ-held; written while a draft or sent back,
 *                             never by a frozen admin. A new one hangs under the caller. A Super Admin
 *                             reads one that is not a draft. No write bypass.
 *   partner_invitations       #4046 (B4): an admin's invitation to a partner (routes/admin_partners.ts
 *                             POST /invitations, `requireAdmin`): a new one hangs under the caller, its
 *                             inviter; a sent one is read by any admin and filled by its inviter alone.
 *   article_review_comments   #4046 (B4): a reviewer's comment on an article (routes/admin_articles.ts
 *                             POST /:id/comments, `requireAdmin`): any admin adds one under an article
 *                             that exists; any admin reads one, and only its author fills it. Not concealed:
 *                             any admin reads every comment on the article, and no one else reaches the route.
 *   segment_profiles          #4046 (B4): HQ's New segment (routes/persona_segments.ts POST /, `requireSuperAdmin`):
 *                             an HQ Super Admin writes, on HQ alone; any admin reads (GET is `requireAdmin`). A new
 *                             one hangs under the caller (`createProfile` stamps `updated_by`). Keyed by its rowid.
 *
 * The D1595 three, the deal note, a testing application, a program proposal and a partner invitation are CONCEALED: a caller who may not read the record is
 * answered as if it did not exist, and each reads the request's verified
 * active company (`ScopeContext`), as its route does; without one it answers
 * nothing.
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
import { inSupportBook, myPerk, offeringOwned, supportBookIds } from '../profileWriteGates';
import { noteFirm, visibleDeal } from '../dealNotes';
import { mayApplyTo } from '../testing';
import { studioOf } from '../programProposals';
import { adminWritesFrozen, isSuperAdmin } from '../../auth';
import { branchOf } from '../../util/branch';

export interface ScopeAccess { read: boolean; write: boolean }
export type ParentKind = 'advisor' | 'engagement' | 'event' | 'project' | 'owner' | 'deal' | 'programme' | 'article';

/** What a scope may need from the request: the caller's verified active company (`activeCompanyFor`). */
export interface ScopeContext {
  activeCompany(): Promise<number | null>;
  /** #4046: whether the request named a company (`X-Company-Id`); a claim that does not verify never falls back. */
  claimed?(): boolean;
}

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
  access(env: Env, user: User, row: Record<string, unknown> | null, parentId: number | null, ctx?: ScopeContext): Promise<ScopeAccess>;
  /** D1595: a caller who may not read is told the record does not exist, never that it is someone else's. */
  concealed?: boolean;
}

const NONE: ScopeAccess = Object.freeze({ read: false, write: false });
const READ_ONLY: ScopeAccess = Object.freeze({ read: true, write: false });
const BOTH: ScopeAccess = Object.freeze({ read: true, write: true });
/** The caller's own user id, for a record whose parent is its owner. */
const ownUserId = async (_env: Env, user: User) => (Number.isSafeInteger(Number(user.id)) ? Number(user.id) : null);
const role = (u: User) => String(u.role || '').toLowerCase();
const isAdminUser = (u: User) => role(u) === 'admin';

/** The caller's own advisor profile id (`myAdvisor`'s rule: the profile whose user is the caller). */
export async function myAdvisorId(env: Env, user: User): Promise<number | null> {
  const r = await env.DB.prepare('SELECT id FROM advisors WHERE user_id = ?').bind(user.id).first<{ id: number }>();
  return r ? Number(r.id) : null;
}

/** The caller's own partner profile id (`requirePartnerProfile`'s rule), for a partner. */
async function myPartnerId(env: Env, user: User): Promise<number | null> {
  if (!holdsLicence(user, 'partner') || !(user as any).partner_id) return null;
  const r = await env.DB.prepare('SELECT id FROM partners WHERE id = ?').bind((user as any).partner_id).first<{ id: number }>();
  return r ? Number(r.id) : null;
}

/** `canManage` in routes/events.ts: an admin, or the event's host. */
/** #4046 (B2): the profiles `/events/new` admits (App.jsx's guard); `POST /api/events` makes the caller its host. */
const EVENT_HOSTS = new Set(['admin', 'founder', 'partner', 'investor', 'advisor']);
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
  // #4046 (B2): /events/new. A new event hangs under its host, the caller (`POST /api/events` makes the caller
  // its host); any profile the page admits may draft one. A saved event is its host's, or an admin's (`canManage`).
  events: {
    read: 'SELECT * FROM events WHERE id = ?',
    parent: { kind: 'owner', column: 'host_user_id', own: ownUserId },
    async access(_env, user, row, parentId) {
      if (row) return manages(row, user) ? BOTH : NONE;
      return parentId != null && parentId === Number(user.id) && (EVENT_HOSTS.has(role(user)) || (user.licences || []).some(licence => EVENT_HOSTS.has(licence))) ? BOTH : NONE;
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
      if (!row || !(role(user) === 'admin' || holdsLicence(user, 'investor') || holdsLicence(user, 'partner'))) return NONE;
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
  // D1595 (#3868): Value-add's Log support. `canViewLpData`, then the book the route writes against.
  // No admin trigger (D1329, #2431 question 5): an admin reads every entry and fills none.
  portfolio_support_entries: {
    read: 'SELECT * FROM portfolio_support_entries WHERE id = ?',
    parent: { kind: 'project', column: 'project_id' },
    concealed: true,
    async access(env, user, row, parentId, ctx) {
      if (isAdminUser(user)) return READ_ONLY;
      if (!holdsLicence(user, 'investor') || !ctx) return NONE;
      const projectId = Number(row ? row.project_id : parentId);
      if (!Number.isSafeInteger(projectId) || projectId <= 0) return NONE;
      const book = await supportBookIds(env, user, await ctx.activeCompany());
      return inSupportBook(book, projectId) ? BOTH : NONE;
    },
  },
  // D1595: Catalog's New service. The owner, under `offeringOwned`'s company rule; the public catalog's readers get no marks.
  service_offerings: {
    read: 'SELECT * FROM service_offerings WHERE id = ?',
    parent: { kind: 'owner', column: 'owner_user_id', own: ownUserId },
    concealed: true,
    async access(env, user, row, parentId, ctx) {
      if (!ctx) return NONE;
      if (!row) return parentId != null && parentId === Number(user.id) ? BOTH : NONE;
      if (Number(row.owner_user_id) === Number(user.id) && await offeringOwned(env, Number(row.id), user, await ctx.activeCompany())) return BOTH;
      return isAdminUser(user) ? READ_ONLY : NONE;
    },
  },
  // D1595: Perk deals' New perk. A partner's own listing, as `myPerk` returns it; founders who browse get no marks.
  perks: {
    read: 'SELECT * FROM perks WHERE id = ?',
    parent: { kind: 'owner', column: 'partner_user_id', own: ownUserId },
    concealed: true,
    async access(env, user, row, parentId, ctx) {
      if (!ctx) return NONE;
      if (holdsLicence(user, 'partner')) {
        if (!row) return parentId != null && parentId === Number(user.id) ? BOTH : NONE;
        if (await myPerk(env, String(row.uid ?? ''), Number(user.id), await ctx.activeCompany())) return BOTH;
      }
      return isAdminUser(user) && row ? READ_ONLY : NONE;
    },
  },
  // #4046 (B2): a member's application to a product-testing programme, its answers only. A new one hangs under
  // the programme, for a member `apply` would take now (`mayApplyTo`); a sent one is its member's alone, and
  // only while it waits ('applied'), so the record step after Apply can keep what was placed. Concealed:
  // another member's application, or a programme they may not apply to, reads as one that does not exist.
  // The read lays the answers out as one column each, so a kept answer is compared field by field.
  testing_applications: {
    read: `SELECT a.*, json_extract(a.answers, '$[0]') AS answer_1, json_extract(a.answers, '$[1]') AS answer_2,
      json_extract(a.answers, '$[2]') AS answer_3, json_extract(a.answers, '$[3]') AS answer_4, json_extract(a.answers, '$[4]') AS answer_5
      FROM testing_applications a WHERE a.id = ?`,
    parent: { kind: 'programme', column: 'programme_id' },
    concealed: true,
    async access(env, user, row, parentId) {
      if (row) return Number(row.user_id) === Number(user.id) ? (row.status === 'applied' ? BOTH : READ_ONLY) : NONE;
      return parentId != null && (await mayApplyTo(env, { id: Number(user.id), role: role(user) }, parentId)) ? BOTH : NONE;
    },
  },
  // #4046 (B4): Admin · Programs' Propose a program. `ownRow`'s studio rule: a licence's admins share its proposals,
  // an admin bound to no licence holds only their own. Written while 'draft' or 'sent_back' (`saveDraft`), and
  // never while `requireAdmin` would refuse the admin's write (D135's freeze), so an Undo through /api/fills
  // cannot write what Save could not. A new one hangs under the caller (`startDraft` makes them its creator).
  // A Super Admin reads one that is not a draft (`proposalDetail`) and fills none of another studio's.
  // Concealed: another studio's proposal answers 404 `unknown_proposal` on the route, so it does here too.
  program_proposals: {
    read: 'SELECT id, uid, created_by_user_id, licence_uid, status, name, purpose, eligibility, who_json, grp, join_method, cycle FROM program_proposals WHERE id = ?',
    parent: { kind: 'owner', column: 'created_by_user_id', own: ownUserId },
    concealed: true,
    async access(env, user, row, parentId) {
      if (!isAdminUser(user)) return NONE;
      const uid = Number(user.id);
      if (!row) return parentId != null && parentId === uid ? ((await adminWritesFrozen(env, user)) ? READ_ONLY : BOTH) : NONE;
      const studio = await studioOf(env, uid);
      const owns = studio != null ? row.licence_uid === studio : row.licence_uid == null && Number(row.created_by_user_id) === uid;
      if (owns) return { read: true, write: (row.status === 'draft' || row.status === 'sent_back') && !(await adminWritesFrozen(env, user)) };
      return isSuperAdmin(user as any) && row.status !== 'draft' ? READ_ONLY : NONE;
    },
  },
  // #4046 (B4): New invitation on Admin · Community · Partner invitations. POST /api/admin/partners/invitations is
  // `requireAdmin` (any admin, a Super Admin included) and binds the caller as `invited_by_user_id`, so a new one hangs
  // under the caller. The admin reads (GET /invitations/:id) are any admin's; only the inviter's own Send records a
  // fill, so a saved one is filled by its inviter alone. No partner or member reaches an invitation: concealed. The
  // frozen-admin and suspended-branch refusals stay with the POST itself, which writes the row.
  partner_invitations: {
    read: 'SELECT id, invited_by_user_id, status, personal_message FROM partner_invitations WHERE id = ?',
    parent: { kind: 'owner', column: 'invited_by_user_id', own: ownUserId },
    concealed: true,
    async access(env, user, row, parentId) {
      if (!isAdminUser(user)) return NONE;
      // The route is `requireAdmin`, so D135's freeze is part of its gate: a frozen admin reads and fills nothing.
      const frozen = await adminWritesFrozen(env, user);
      if (row) return { read: true, write: !frozen && Number(row.invited_by_user_id) === Number(user.id) };
      return parentId != null && parentId === Number(user.id) ? (frozen ? READ_ONLY : BOTH) : NONE;
    },
  },
  // #4046 (B4): the review drawer's new comment on Super Admin · Content · Content queue. POST
  // /api/admin/articles/:id/comments is `requireAdmin` (any admin) and checks no article, so the scope adds that check:
  // a new comment hangs under an article that exists. Any admin reads a comment (GET /api/admin/articles/:id lists them
  // all); only its author fills one: the route lets a Super Admin rewrite another admin's words, but no trigger is
  // given on another member's record (D1329). Not concealed: the route conceals nothing from an admin.
  article_review_comments: {
    read: 'SELECT * FROM article_review_comments WHERE id = ?',
    parent: { kind: 'article', column: 'article_id' },
    async access(env, user, row, parentId) {
      if (!isAdminUser(user)) return NONE;
      // `requireAdmin` carries D135's freeze: a frozen admin reads and fills nothing.
      const frozen = await adminWritesFrozen(env, user);
      if (row) return Number(row.author_id) === Number(user.id) && !frozen ? BOTH : READ_ONLY;
      if (parentId == null) return NONE;
      return (await env.DB.prepare('SELECT id FROM articles WHERE id = ?').bind(parentId).first()) ? (frozen ? READ_ONLY : BOTH) : NONE;
    },
  },
  // #4046 (B4): HQ's New segment on Super Admin · Content · Personas. `requireSuperAdmin`'s rule exactly: an admin with the
  // Super Admin elevation, on HQ (a branch is refused). A plain Admin, or any admin on a branch, reads (GET is `requireAdmin`)
  // and fills nothing. `requireAdmin`'s D135 freeze never applies here: it exempts a Super Admin and a branch. A segment hangs
  // under no record, so a new one hangs under the caller (`createProfile` stamps `updated_by` on its first version). The
  // table's key is TEXT; the fill keys it by its rowid (a rowid table, and no route deletes a segment). Not concealed: the
  // route conceals nothing from an admin and refuses everyone else.
  segment_profiles: {
    read: 'SELECT rowid AS id, key, name, profile, status, who, version, updated_by FROM segment_profiles WHERE rowid = ?',
    parent: { kind: 'owner', column: 'updated_by', own: ownUserId },
    async access(env, user, row, parentId) {
      if (!isAdminUser(user)) return NONE;
      const write = isSuperAdmin(user as any) && !branchOf(env);
      if (row) return { read: true, write };
      return parentId != null && parentId === Number(user.id) ? { read: true, write } : NONE;
    },
  },
  // #4046 (#3740 2b): Deal notes' New note. The firm and the deal by `context`'s own rule (routes/deal_context.ts);
  // a note is read by the firm it is filed under (a firm-less note by its author alone) and filled by its author.
  // No admin and no staff bypass: the route has none, so a caller who may not read it is told it does not exist.
  deal_notes: {
    read: 'SELECT * FROM deal_notes WHERE id = ?',
    parent: { kind: 'deal', column: 'deal_id' },
    concealed: true,
    async access(env, user, row, parentId, ctx) {
      if (!holdsLicence(user, 'investor') || !ctx) return NONE;
      const firm = await noteFirm(env.DB, Number(user.id), await ctx.activeCompany(), !!ctx.claimed?.());
      if (firm === undefined) return NONE;
      const dealId = Number(row ? row.deal_id : parentId);
      if (!Number.isSafeInteger(dealId) || dealId <= 0 || !(await visibleDeal(env.DB, dealId, Number(user.id), firm))) return NONE;
      if (!row) return BOTH;
      const noteFirmId = row.company_id == null ? null : Number(row.company_id);
      const author = Number(row.author_user_id) === Number(user.id);
      if (noteFirmId !== firm || (noteFirmId == null && !author)) return NONE;
      return author ? BOTH : READ_ONLY;
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

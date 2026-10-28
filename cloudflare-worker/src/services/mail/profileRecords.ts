/**
 * D1348 (#3555, part 7 of #3547) — the people an investor, an advisor, an
 * operating partner and an admin write to, and what Eadwyn may quote for each.
 *
 * Each person kind is one module's row, read under that module's own rule:
 *
 *   deal:<entry id>         Deals: the investor's own deal-flow entry (`scope_key 'u:<id>'`, as `GET /api/deals/flow`)
 *   holding:<project id>    Portfolio: a venture the investor holds (`investorHeldProjectIds`)
 *   coinvestor:<rel id>     Deals · co-investing: an accepted `co_investor` relationship the member is in (partnernet)
 *   client:<user id>        Practice: a founder on the advisor's roster (a booking with them, as `requireRosterClient`)
 *   cohort:<cycle>-<user>   Cohorts: a founder in a cohort the advisor is actively assigned to, not opted out
 *   engagement:<id>         Delivery: an engagement of the operating partner's (`e.partner_id`)
 *   lead:<quote id>         Pipeline: a proposal the operating partner sent (`q.partner_id`)
 *   application:<id>        Programs (admin): a Spin-Out Lab application the admin holds
 *   ticket:<id>             Support (admin): an open ticket assigned to the admin
 *
 * A kind outside the member's profile, or a row the rule does not admit, is
 * "Record not found.", as one that does not exist. An admin's pack is the case
 * only: no founder module, and no company items (`caseOnly`).
 *
 * Each source carries `as_of`. A missing value reads in its own words, never 0.
 */
import type { Env, User } from '../../types';
import { investorHeldProjectIds, investorProjectIds } from '../../routes/_investorProjectScope';
import { updateFigures } from '../../routes/portfolio_updates';
import { optedOutFounderIds } from '../cohortAdvisorAccess';
import type { Person, PackItem } from './contextPack';
import { RELATIONSHIP_OF } from './intents';

export type Profile = 'founder' | 'investor' | 'advisor' | 'partner' | 'admin' | 'explorer';

/** The member's profile, from `users.role` (`partner` is the operating partner, `exploring` the Explorer). */
export function profileOf(user: Pick<User, 'role'>): Profile {
  const r = String(user.role || '').toLowerCase();
  if (r === 'investor' || r === 'advisor' || r === 'partner' || r === 'admin') return r;
  if (r === 'exploring') return 'explorer';
  return 'founder';
}

/** An admin writes about a case they hold and nothing else: no founder module, no company item, no block. */
export const caseOnly = (user: Pick<User, 'role'>) => profileOf(user) === 'admin';

/** The kinds each profile may open, beyond the founder's (D1341) and the Network match (D1342). */
export const PROFILE_KINDS: Readonly<Record<Profile, readonly string[]>> = Object.freeze({
  founder: [],
  investor: ['deal', 'holding', 'coinvestor'],
  advisor: ['client', 'cohort'],
  partner: ['engagement', 'lead'],
  admin: ['application', 'ticket'],
  explorer: [],
});

export class RecordMissing extends Error {}
const missing = () => new RecordMissing('not found');

export type ProfileRead = { person: Person; item: PackItem; more: PackItem[] };

const NUMERIC = /^[1-9][0-9]{0,9}$/;
const num = (id: string) => (NUMERIC.test(id) ? Number(id) : null);
export const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const said = (v: unknown, none = 'Not recorded') => (v == null || String(v).trim() === '' ? none : String(v).trim());
const latest = (...vs: unknown[]) => vs.map(day).filter((v): v is string => !!v).sort().pop() ?? null;
const nowIso = (now: number) => new Date(now).toISOString();

function person(kind: string, id: string, name: string): Person {
  return { ref: `${kind}:${id}`, kind, relationship: RELATIONSHIP_OF[kind], name, project_id: null };
}
function source(ref: string, kind: string, label: string, as_of: string | null, link: string, text: string, selected = false): PackItem {
  return { ref, kind, label, as_of, link, selected, text };
}

// ── Investor ────────────────────────────────────────────────────────────────

/** The investor's own deal-flow entry: the deal note, its stage and revisit. */
async function dealEntry(env: Env, user: User, id: string, now: number): Promise<ProfileRead> {
  const key = num(id);
  if (key == null) throw missing();
  const e = await env.DB.prepare(
    `SELECT e.id, e.deal_id, e.stage, e.note, e.revisit_at, e.passed_at, e.entered_at, e.stage_changed_at, e.updated_at, p.id AS project_id, p.name AS project_name, p.sector
       FROM deal_flow_entries e JOIN deals d ON d.id = e.deal_id JOIN projects p ON p.id = d.project_id
      WHERE e.id = ? AND e.scope_key = ?`,
  ).bind(key, `u:${user.id}`).first<any>();
  if (!e) throw missing();
  const name = said(e.project_name, 'A deal');
  const p = person('deal', id, name);
  const text = [name, `Sector: ${said(e.sector)}`, `Stage: ${said(e.stage)} since ${day(e.stage_changed_at) ?? day(e.entered_at) ?? 'a day not recorded'}`,
    `Deal note: ${said(e.note, 'none written')}`, `Revisit: ${day(e.revisit_at) ?? 'none set'}`].join('\n');
  const more = [...await sharedKpis(env, user, Number(e.project_id)), ...await coInvestment(env, user, Number(e.deal_id), now)];
  return { person: p, item: source(p.ref, 'deal', `Deal note · ${name}`, latest(e.updated_at, e.stage_changed_at, e.entered_at), '/deals', text, true), more };
}

/** A venture the investor holds: its name and the KPIs its founder shared with investors. */
async function holding(env: Env, user: User, id: string, now: number): Promise<ProfileRead> {
  const key = num(id);
  if (key == null) throw missing();
  const held = (await investorHeldProjectIds(env, user)) ?? [];
  if (!held.includes(key)) throw missing();
  const p0 = await env.DB.prepare('SELECT id, name, sector, stage FROM projects WHERE id = ?').bind(key).first<any>();
  if (!p0) throw missing();
  const name = said(p0.name, 'A portfolio company');
  const p = person('holding', id, name);
  const kpis = await sharedKpis(env, user, key);
  const deal = await env.DB.prepare('SELECT id FROM deals WHERE project_id = ? ORDER BY id DESC LIMIT 1').bind(key).first<{ id: number }>();
  const co = deal ? await coInvestment(env, user, Number(deal.id), now) : [];
  const text = [name, `Sector: ${said(p0.sector)}`, `Stage: ${said(p0.stage)}`, 'In your portfolio.'].join('\n');
  return { person: p, item: source(p.ref, 'holding', `Portfolio · ${name}`, kpis[0]?.as_of ?? null, '/portfolio', text, true), more: [...kpis, ...co] };
}

/**
 * The latest submitted update the founder shared with investors, as
 * `GET /api/portfolio-updates` admits it: the venture is one the investor
 * relates to, and the update names the investor or its audience is investors.
 */
async function sharedKpis(env: Env, user: User, projectId: number): Promise<PackItem[]> {
  const related = (await investorProjectIds(env, user)) ?? [];
  if (!related.includes(projectId)) return [];
  const u = await env.DB.prepare(
    `SELECT id, uid, period, kpis_json, metrics_json, submitted_at, updated_at FROM portfolio_updates
      WHERE project_id = ? AND status = 'submitted'
        AND (EXISTS (SELECT 1 FROM update_recipients ur WHERE ur.update_id = portfolio_updates.id AND ur.user_id = ? AND ur.audience = 'investor')
          OR (CASE WHEN json_valid(portfolio_updates.audience_json) THEN json_type(portfolio_updates.audience_json, '$.investors') END) = 'true')
      ORDER BY COALESCE(submitted_at, updated_at) DESC, id DESC LIMIT 1`,
  ).bind(projectId, user.id).first<any>();
  if (!u) return [];
  // The update page's own reading of its figures (`updateFigures`): a figure nothing recorded keeps its reason, never 0.
  const { figures, kpis } = updateFigures(u);
  const rows = [
    ...figures.map((f) => `- ${f.label}: ${f.value == null ? f.reason : `${f.value} ${f.unit}`.trim()}${f.as_of ? ` (as of ${f.as_of})` : ''}`),
    ...Object.entries(kpis).filter(([k]) => !figures.some((f) => f.key === k)).map(([k, v]) => `- ${k}: ${v == null || v === '' ? 'Not recorded' : String(v)}`),
  ].slice(0, 12);
  const when = day(u.submitted_at) ?? day(u.updated_at);
  return [source(`update:${u.id}`, 'update', `Portfolio KPIs · ${said(u.period, 'latest update')}`, when, `/updates/${u.uid}`,
    [`Update shared with investors${u.period ? ` for ${u.period}` : ''}:`, ...(rows.length ? rows : ['No KPI recorded in it.'])].join('\n'))];
}

/** The syndicates on a deal the member created or joined (`GET /api/networkfx/syndicates`' rule): co-investment status. */
async function coInvestment(env: Env, user: User, dealId: number, _now: number): Promise<PackItem[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.name, s.status, s.created_at, s.closed_at,
            (SELECT COUNT(*) FROM syndicate_members m WHERE m.syndicate_id = s.id) AS members
       FROM syndicates s
      WHERE s.deal_id = ? AND (s.created_by = ? OR EXISTS (SELECT 1 FROM syndicate_members m WHERE m.syndicate_id = s.id AND m.user_id = ?))
      ORDER BY s.id DESC LIMIT 3`,
  ).bind(dealId, user.id, user.id).all<any>();
  return (results || []).map((s: any) => source(`syndicate:${s.id}`, 'syndicate', `Co-investment · ${said(s.name, 'Syndicate')}`, latest(s.closed_at, s.created_at), '/network',
    [`Syndicate: ${said(s.name)}`, `Status: ${said(s.status)}`, `Members: ${Number(s.members)}`, s.closed_at ? `Closed: ${day(s.closed_at)}` : 'Not closed'].join('\n')));
}

/** An accepted co-investor relationship the member is in; its reminders and shared syndicates. */
async function coinvestor(env: Env, user: User, id: string, now: number): Promise<ProfileRead> {
  const key = num(id);
  if (key == null) throw missing();
  const r = await env.DB.prepare(
    `SELECT r.id, r.metadata, r.created_at, r.responded_at, r.updated_at, u.name, u.display_name
       FROM partner_relationships r JOIN users u ON u.id = CASE WHEN r.partner_a_id = ?1 THEN r.partner_b_id ELSE r.partner_a_id END
      WHERE r.id = ?2 AND r.status = 'accepted' AND r.relationship_type = 'co_investor' AND (r.partner_a_id = ?1 OR r.partner_b_id = ?1)`,
  ).bind(user.id, key).first<any>();
  if (!r) throw missing();
  const name = said(r.display_name || r.name, 'A co-investor');
  const p = person('coinvestor', id, name);
  const due = await env.DB.prepare(
    'SELECT remind_at, note FROM partner_reminders WHERE relationship_id = ? AND created_by = ? AND done = 0 ORDER BY remind_at ASC LIMIT 1',
  ).bind(key, user.id).first<any>();
  const text = [name, `Co-investor since ${day(r.responded_at) ?? day(r.created_at) ?? 'a day not recorded'}`,
    due ? `Your reminder: ${day(due.remind_at)}${due.note ? ` · ${due.note}` : ''}` : 'No reminder set'].join('\n');
  void now;
  return { person: p, item: source(p.ref, 'coinvestor', `Co-investor · ${name}`, latest(r.updated_at, r.responded_at, r.created_at), '/network', text, true), more: [] };
}

// ── Advisor ─────────────────────────────────────────────────────────────────

/** The advisor's own profile row, as `routes/advisors.ts`' `myAdvisor` finds it. */
export async function advisorRow(env: Env, user: User): Promise<{ id: number } | null> {
  const viaId = (user as any).advisor_id
    ? await env.DB.prepare('SELECT id FROM advisors WHERE id = ? AND user_id = ?').bind((user as any).advisor_id, user.id).first<{ id: number }>()
    : null;
  return viaId ?? await env.DB.prepare('SELECT id FROM advisors WHERE user_id = ?').bind(user.id).first<{ id: number }>();
}

/** The advisor's own Expertise services, active: offered, never ticked. */
async function services(env: Env, advisorId: number): Promise<PackItem[]> {
  const { results } = await env.DB.prepare(
    'SELECT uid, title, kind, duration_note, price_cents, currency, scope, updated_at FROM advisor_services WHERE advisor_id = ? AND is_active = 1 ORDER BY id ASC LIMIT 5',
  ).bind(advisorId).all<any>();
  return (results || []).map((s: any) => source(`service:${s.uid}`, 'service', `Expertise · ${said(s.title)}`, day(s.updated_at), '/expertise',
    [said(s.title), `Kind: ${said(s.kind)}`, `Price: ${s.price_cents == null ? 'Not recorded' : `${(Number(s.price_cents) / 100).toFixed(2)} ${said(s.currency, '')}`.trim()}`,
      `Duration: ${said(s.duration_note)}`, `Scope: ${said(s.scope)}`].join('\n')));
}

/** A founder on the advisor's roster: the advisor's note on them, their sessions, and the next one booked. */
async function client(env: Env, user: User, id: string, now: number): Promise<ProfileRead> {
  const founder = num(id);
  const adv = await advisorRow(env, user);
  if (founder == null || !adv) throw missing();
  const roster = await env.DB.prepare('SELECT 1 AS ok FROM advisor_bookings WHERE advisor_id = ? AND founder_user_id = ? LIMIT 1').bind(adv.id, founder).first();
  if (!roster) throw missing();
  const u = await env.DB.prepare('SELECT name, display_name FROM users WHERE id = ?').bind(founder).first<any>();
  const name = said(u?.display_name || u?.name, 'A client');
  const p = person('client', id, name);
  const at = nowIso(now);
  const past = await env.DB.prepare(
    `SELECT s.starts_at, b.topic, b.status FROM advisor_bookings b JOIN advisor_office_hour_slots s ON s.id = b.slot_id
      WHERE b.advisor_id = ? AND b.founder_user_id = ? AND b.status NOT IN ('cancelled','no_show') AND s.starts_at <= ?
      ORDER BY s.starts_at DESC LIMIT 5`,
  ).bind(adv.id, founder, at).all<any>();
  const next = await env.DB.prepare(
    `SELECT s.starts_at, b.topic FROM advisor_bookings b JOIN advisor_office_hour_slots s ON s.id = b.slot_id
      WHERE b.advisor_id = ? AND b.founder_user_id = ? AND b.status IN ('pending','confirmed') AND s.starts_at > ?
      ORDER BY s.starts_at ASC LIMIT 1`,
  ).bind(adv.id, founder, at).first<any>();
  const note = await env.DB.prepare('SELECT body, updated_at FROM advisor_client_notes WHERE advisor_user_id = ? AND client_user_id = ?').bind(user.id, founder).first<any>();
  const sessions = past.results || [];
  const text = [name, sessions.length ? 'Sessions:' : 'Sessions: none held yet', ...sessions.map((s: any) => `- ${day(s.starts_at)}${s.topic ? ` · ${s.topic}` : ''}`)].join('\n');
  const more: PackItem[] = [];
  if (note) more.push(source(`client_note:${id}`, 'session_notes', 'Your session notes', day(note.updated_at), '/practice', String(note.body).slice(0, 2000), true));
  more.push(source(`next_session:${id}`, 'next_session', 'Next session booked', next ? day(next.starts_at) : null, '/practice',
    next ? `Next session: ${day(next.starts_at)}${next.topic ? ` · ${next.topic}` : ''}` : 'No next session booked'));
  more.push(...await services(env, adv.id));
  return { person: p, item: source(p.ref, 'client', `Practice · ${name}`, day(sessions[0]?.starts_at), '/practice', text, true), more };
}

const COHORT_ID = /^([1-9][0-9]{0,9})-([1-9][0-9]{0,9})$/;

/** A founder in a cohort the advisor is actively assigned to, and not hidden from them: the cohort's week plan and their progress. */
async function cohortFounder(env: Env, user: User, id: string, now: number): Promise<ProfileRead> {
  const m = COHORT_ID.exec(id);
  if (!m || String(user.role || '').toLowerCase() !== 'advisor') throw missing();
  const [cycle, founder] = [Number(m[1]), Number(m[2])];
  const assigned = await env.DB.prepare('SELECT 1 AS ok FROM advisor_cohort_assignments WHERE advisor_user_id = ? AND cohort_cycle_id = ? AND is_active = 1').bind(user.id, cycle).first();
  if (!assigned) throw missing();
  if ((await optedOutFounderIds(env, user.id)).has(founder)) throw missing();
  const { results: weeks } = await env.DB.prepare(
    `SELECT w.week_number, w.deadline_at, s.status, s.deliverables_done, s.deliverables_required
       FROM company_week_status s LEFT JOIN week_windows w ON w.cohort_cycle_id = s.cohort_cycle_id AND w.week_number = s.week_number
      WHERE s.cohort_cycle_id = ? AND s.user_id = ? ORDER BY s.week_number ASC LIMIT 12`,
  ).bind(cycle, founder).all<any>();
  if (!weeks?.length) throw missing();
  const c = await env.DB.prepare('SELECT year, month FROM cohort_cycles WHERE id = ?').bind(cycle).first<any>();
  const u = await env.DB.prepare('SELECT name, display_name FROM users WHERE id = ?').bind(founder).first<any>();
  const name = said(u?.display_name || u?.name, 'A cohort founder');
  const cohort = c ? `${c.year}-${String(c.month).padStart(2, '0')} cohort` : 'Cohort';
  const p = person('cohort', id, name);
  const plan = weeks.map((w: any) => `- Week ${w.week_number}: ${said(w.status)}, ${Number(w.deliverables_done)} of ${Number(w.deliverables_required)} deliverables${w.deadline_at ? `, due ${day(w.deadline_at)}` : ''}`);
  const adv = await advisorRow(env, user);
  void now;
  return {
    person: p,
    item: source(p.ref, 'cohort', `Cohorts · ${name}`, latest(...weeks.map((w: any) => w.deadline_at)), '/cohorts', [name, `${cohort}`].join('\n'), true),
    more: [source(`week_plan:${id}`, 'week_plan', `Cohort week plan · ${cohort}`, latest(...weeks.map((w: any) => w.deadline_at)), '/cohorts', ['Week plan:', ...plan].join('\n'), true),
      ...(adv ? await services(env, adv.id) : [])],
  };
}

// ── Operating partner ───────────────────────────────────────────────────────

const partnerOf = (user: User) => (String(user.role || '').toLowerCase() === 'partner' && (user as any).partner_id ? Number((user as any).partner_id) : null);

/** The partner's own Offers (`service_offerings`, active): offered, never ticked. */
async function offers(env: Env, user: User): Promise<PackItem[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, title, category, price_usd, updated_at FROM service_offerings WHERE owner_user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 5',
  ).bind(user.id).all<any>();
  return (results || []).map((o: any) => source(`offer:${o.id}`, 'offer', `Offer · ${said(o.title)}`, day(o.updated_at), '/offers',
    [`Offer: ${said(o.title)}`, `Category: ${said(o.category)}`, `Price: ${o.price_usd == null ? 'Not recorded' : `$${Number(o.price_usd).toLocaleString('en-US')}`}`].join('\n')));
}

/** The founder of an engagement or a need: `founder_id` is a founders.id (as `needs.ts` joins it). */
const FOUNDER_NAME = 'SELECT f.name AS founder_name, p.name AS project_name FROM founders f LEFT JOIN projects p ON p.id = ? WHERE f.id = ?';

/** One of the partner's engagements: the latest sent status report and the milestones. */
async function engagement(env: Env, user: User, id: string, now: number): Promise<ProfileRead> {
  const key = num(id);
  const partner = partnerOf(user);
  if (key == null || partner == null) throw missing();
  const e = await env.DB.prepare('SELECT id, founder_id, project_id, status, delivered_at, created_at, updated_at FROM engagements WHERE id = ? AND partner_id = ?').bind(key, partner).first<any>();
  if (!e) throw missing();
  const f = await env.DB.prepare(FOUNDER_NAME).bind(e.project_id, e.founder_id).first<any>();
  const name = [f?.founder_name, f?.project_name].map((v) => said(v, '')).filter(Boolean).join(' · ') || 'A client';
  const p = person('engagement', id, name);
  const report = await env.DB.prepare(
    "SELECT period, shipped, next_up, sent_at, updated_at FROM engagement_status_reports WHERE engagement_id = ? AND state = 'sent' ORDER BY COALESCE(sent_at, updated_at) DESC LIMIT 1",
  ).bind(key).first<any>();
  const { results: ms } = await env.DB.prepare('SELECT title, due_at, completed_at, updated_at FROM engagement_milestones WHERE engagement_id = ? ORDER BY COALESCE(due_at, updated_at) ASC LIMIT 12').bind(key).all<any>();
  const done = (ms || []).filter((m: any) => m.completed_at).length;
  const more: PackItem[] = [];
  if (report) more.push(source(`status_report:${id}`, 'status_report', `Status report · ${day(report.sent_at) ?? said(report.period)}`, day(report.sent_at) ?? day(report.updated_at), '/delivery',
    [`Period: ${said(report.period)}`, `Shipped: ${said(report.shipped)}`, `Next up: ${said(report.next_up)}`].join('\n'), true));
  if (ms?.length) more.push(source(`milestones:${id}`, 'milestones', `Milestones · ${done} of ${ms.length} done`, latest(...ms.map((m: any) => m.completed_at ?? m.updated_at)), '/delivery',
    ['Milestones:', ...ms.map((m: any) => `- ${said(m.title)}: ${m.completed_at ? `done ${day(m.completed_at)}` : `due ${day(m.due_at) ?? 'not set'}`}`)].join('\n'), true));
  more.push(...await offers(env, user));
  void now;
  const text = [name, `Engagement: ${said(e.status)}`, `Started: ${day(e.created_at) ?? 'Not recorded'}`, `Delivered: ${day(e.delivered_at) ?? 'Not yet'}`].join('\n');
  return { person: p, item: source(p.ref, 'engagement', `Delivery · ${name}`, latest(e.updated_at, e.created_at), '/delivery', text, true), more };
}

/** A proposal the partner sent on a founder's need. */
async function lead(env: Env, user: User, id: string, now: number): Promise<ProfileRead> {
  const key = num(id);
  const partner = partnerOf(user);
  if (key == null || partner == null) throw missing();
  const q = await env.DB.prepare(
    `SELECT q.id, q.price, q.timeline_weeks, q.deliverables, q.status, q.created_at, q.updated_at, n.title, n.project_id, n.founder_id
       FROM quotes q JOIN founder_needs n ON n.id = q.need_id WHERE q.id = ? AND q.partner_id = ?`,
  ).bind(key, partner).first<any>();
  if (!q) throw missing();
  const f = await env.DB.prepare(FOUNDER_NAME).bind(q.project_id, q.founder_id).first<any>();
  const name = [f?.founder_name, f?.project_name].map((v) => said(v, '')).filter(Boolean).join(' · ') || 'A lead';
  const p = person('lead', id, name);
  void now;
  const text = [name, `Need: ${said(q.title)}`, `Proposal: ${said(q.status)}, sent ${day(q.created_at) ?? 'on a day not recorded'}`,
    `Price: ${q.price == null ? 'Not recorded' : `$${Number(q.price).toLocaleString('en-US')}`}`, `Timeline: ${q.timeline_weeks == null ? 'Not recorded' : `${q.timeline_weeks} weeks`}`,
    `Deliverables: ${said(q.deliverables)}`].join('\n');
  return { person: p, item: source(p.ref, 'lead', `Pipeline · proposal · ${name}`, latest(q.updated_at, q.created_at), '/pipeline', text, true), more: await offers(env, user) };
}

// ── Admin: the case only ────────────────────────────────────────────────────

/** A Spin-Out Lab application the admin holds: they scheduled its interview or decided it. */
export const HELD_APPLICATION = `SELECT a.id, a.user_id, a.company_name, a.stage, a.cohort, a.status, a.created_at, a.decided_at
   FROM spinout_applications a
  WHERE a.id = ?1 AND a.status <> 'withdrawn'
    AND (EXISTS (SELECT 1 FROM spinout_application_interviews i WHERE i.application_id = a.id AND i.scheduled_by = ?2)
      OR EXISTS (SELECT 1 FROM cohort_applicants ca WHERE ca.application_id = a.id AND ca.decided_by = ?3))`;

async function application(env: Env, user: User, id: string, now: number): Promise<ProfileRead> {
  const key = num(id);
  if (key == null) throw missing();
  // `decided_by` is the text 'admin:<id>' (`admin_lab_writes.ts`), bound whole so no number is cast into it.
  const a = await env.DB.prepare(HELD_APPLICATION).bind(key, user.id, `admin:${user.id}`).first<any>();
  if (!a) throw missing();
  const u = await env.DB.prepare('SELECT name, display_name FROM users WHERE id = ?').bind(a.user_id).first<any>();
  const name = [said(u?.display_name || u?.name, ''), said(a.company_name, '')].filter(Boolean).join(' · ') || 'An applicant';
  const p = person('application', id, name);
  const i = await env.DB.prepare('SELECT scheduled_at, status, updated_at FROM spinout_application_interviews WHERE application_id = ? ORDER BY scheduled_at DESC LIMIT 1').bind(key).first<any>();
  void now;
  const text = [`Spin-Out Lab application · ${said(a.company_name)}`, `Submitted: ${day(a.created_at) ?? 'Not recorded'}`, `Cohort: ${said(a.cohort)}`,
    `Stage: ${said(a.stage)}`, `Status: ${said(a.status)}${a.decided_at ? `, decided ${day(a.decided_at)}` : ''}`,
    i ? `Interview: ${day(i.scheduled_at)} · ${said(i.status)}` : 'Interview: none scheduled'].join('\n');
  return { person: p, item: source(p.ref, 'application', `Application · ${said(a.company_name)} · submitted ${day(a.created_at) ?? 'on a day not recorded'}`, latest(a.decided_at, i?.updated_at, a.created_at), `/admin/programs/spinout-lab/applications/${a.id}`, text, true), more: [] };
}

/** An open ticket assigned to the admin, by their name or address (`tickets.assigned_to` is free text). */
export const HELD_TICKET = `SELECT t.id, t.title, t.description, t.priority, t.status, t.type, t.user_id, t.created_at, t.updated_at
   FROM tickets t
  WHERE t.id = ?1 AND t.status IN ('open','in_progress') AND t.user_id IS NOT NULL
    AND t.assigned_to IS NOT NULL AND lower(trim(t.assigned_to)) IN (lower(trim(?2)), lower(trim(?3)))`;

const holderNames = (user: User) => [String(user.email || '').trim() || '\u0000', String((user as any).name || '').trim() || '\u0000'];

async function ticket(env: Env, user: User, id: string, now: number): Promise<ProfileRead> {
  const key = num(id);
  if (key == null) throw missing();
  const t = await env.DB.prepare(HELD_TICKET).bind(key, ...holderNames(user)).first<any>();
  if (!t) throw missing();
  const u = await env.DB.prepare('SELECT name, display_name FROM users WHERE id = ?').bind(t.user_id).first<any>();
  const name = said(u?.display_name || u?.name, 'A member');
  const p = person('ticket', id, name);
  void now;
  const text = [`Ticket #${t.id} · ${said(t.title)}`, `Opened: ${day(t.created_at) ?? 'Not recorded'}`, `Status: ${said(t.status)}`, `Priority: ${said(t.priority)}`,
    `What they wrote: ${said(t.description, 'nothing beyond the title').slice(0, 1500)}`].join('\n');
  return { person: p, item: source(p.ref, 'ticket', `Ticket #${t.id} · opened ${day(t.created_at) ?? 'on a day not recorded'}`, latest(t.updated_at, t.created_at), `/help/tickets/${t.id}`, text, true), more: [] };
}

export { holderNames };

const READS: Record<string, (env: Env, user: User, id: string, now: number) => Promise<ProfileRead>> = {
  deal: dealEntry, holding, coinvestor, client, cohort: cohortFounder, engagement, lead, application, ticket,
};

/** The record of one of the other profiles' person kinds, under its module's rule; null when the kind is not one of them. */
export async function profileRecord(env: Env, user: User, kind: string, id: string, now = Date.now()): Promise<ProfileRead | null> {
  const read = READS[kind];
  if (!read) return null;
  if (!PROFILE_KINDS[profileOf(user)].includes(kind)) throw missing();
  return read(env, user, id, now);
}

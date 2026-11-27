/**
 * D1348 (#3555, part 7 of #3547; boards EM2i, EM2a, EM2o, EM2x and EM2e) —
 * the People pane: the people a member may write to, grouped as their
 * profile's canvas draws them.
 *
 *   investor   Founders · deal flow, Founders · portfolio, Co-investors, Network matches
 *   advisor    Clients · sessions, Cohort founders, Network matches
 *   partner    Clients · engagements, Leads, Network matches
 *   admin      Spin-Out Lab applicants, Open support tickets, Partner firms (the cases they hold, never a member's own records)
 *   explorer   Network matches
 *   founder    Network matches. The founder's module people are read by each module's own list (D1341's kinds).
 *
 * Each group reads its module's rows under the module's own rule (the same
 * rule `profileRecords.ts` applies when one is opened). Each person carries
 * its ref, name, role, the source label ("From Practice · sessions"), the
 * last contact day, and a marker. A group whose module cannot be read says
 * so in its own words; it is never shown as empty.
 *
 * MARKERS ARE DERIVED, NEVER STORED (`markerOf`). "Follow-up due" is a
 * module's own due date that has passed. "Needs a reply" is a thread whose
 * last message is theirs, read from a mailbox that shows replies; no mailbox
 * read reaches this list yet, so no person carries it (D1348 §4).
 */
import type { Env, User } from '../../types';
import { investorHeldProjectIds } from '../../routes/_investorProjectScope';
import { optedOutFounderIds } from '../cohortAdvisorAccess';
import { listShares } from './shares';
import { advisorRow, day, holderNames, profileOf, type Profile } from './profileRecords';

export type Marker = 'needs_reply' | 'follow_up_due';
export const MARKER_LABEL: Readonly<Record<Marker, string>> = Object.freeze({ needs_reply: 'Needs a reply', follow_up_due: 'Follow-up due' });

const utc = (v: unknown): number | null => {
  if (typeof v !== 'string' || !v.trim()) return null;
  const raw = v.trim();
  const t = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}${raw.length > 10 ? 'Z' : 'T00:00:00Z'}`);
  return Number.isFinite(t) ? t : null;
};

/**
 * The marker, from what the modules and the mailbox say now. A reply waiting
 * wins over a due date. `lastFromThem` is a mailbox thread's last message
 * (true when it is theirs); null when no mailbox read shows the thread.
 */
export function markerOf(p: { lastFromThem?: boolean | null; dueAt?: string | null }, now: number): Marker | null {
  if (p.lastFromThem === true) return 'needs_reply';
  const due = utc(p.dueAt ?? null);
  if (due != null && due <= now) return 'follow_up_due';
  return null;
}

export type PeopleRow = { ref: string; name: string; role: string | null; source: string; last_contact: string | null; marker: Marker | null; marker_label: string | null };
export type PeopleGroup = { key: string; label: string; people: PeopleRow[]; empty: string | null; error: string | null };
export type People = { profile: Profile; groups: PeopleGroup[]; note: string | null; empty: string | null };

const LIMIT = 100;
const said = (v: unknown, none: string) => (v == null || String(v).trim() === '' ? none : String(v).trim());
const latest = (...vs: unknown[]) => vs.map(day).filter((v): v is string => !!v).sort().pop() ?? null;

function row(ref: string, name: string, role: string | null, src: string, last: string | null, marker: Marker | null): PeopleRow {
  return { ref, name, role, source: src, last_contact: last, marker, marker_label: marker ? MARKER_LABEL[marker] : null };
}

type GroupSpec = { key: string; label: string; empty: string; read: (env: Env, user: User, now: number) => Promise<PeopleRow[]> };

// ── Network matches (every profile but the admin's) ─────────────────────────

const network: GroupSpec = {
  key: 'network', label: 'Network matches', empty: 'No Network match yet. An introduction you both accept appears here.',
  read: async (env, user) => (await listShares(env, user)).slice(0, LIMIT).map((s) =>
    row(s.person, s.name, s.role, `Network · accepted ${day(s.matched_at) ?? 'on a day not recorded'}`, day(s.matched_at), null)),
};

// ── Investor ────────────────────────────────────────────────────────────────

const dealFlow: GroupSpec = {
  key: 'deal_flow', label: 'Founders · deal flow', empty: 'Nothing in your deal flow yet.',
  read: async (env, user, now) => {
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.revisit_at, e.passed_at, e.stage_changed_at, e.updated_at, e.entered_at, p.name AS project_name
         FROM deal_flow_entries e JOIN deals d ON d.id = e.deal_id JOIN projects p ON p.id = d.project_id
        WHERE e.scope_key = ? ORDER BY COALESCE(e.updated_at, e.stage_changed_at, e.entered_at) DESC, e.id DESC LIMIT ?`,
    ).bind(`u:${user.id}`, LIMIT).all<any>();
    return (results || []).map((e: any) => row(`deal:${e.id}`, said(e.project_name, 'A deal'), 'Founder', 'From Deals',
      latest(e.updated_at, e.stage_changed_at, e.entered_at), markerOf({ dueAt: e.revisit_at }, now)));
  },
};

const portfolio: GroupSpec = {
  key: 'portfolio', label: 'Founders · portfolio', empty: 'No portfolio company yet.',
  read: async (env, user) => {
    const held = ((await investorHeldProjectIds(env, user)) ?? []).slice(0, LIMIT);
    const out: PeopleRow[] = [];
    for (const id of held) {
      const p = await env.DB.prepare(
        `SELECT p.id, p.name, (SELECT MAX(COALESCE(u.submitted_at, u.updated_at)) FROM portfolio_updates u WHERE u.project_id = p.id AND u.status = 'submitted') AS last_update
           FROM projects p WHERE p.id = ?`,
      ).bind(id).first<any>();
      if (p) out.push(row(`holding:${p.id}`, said(p.name, 'A portfolio company'), 'Founder', 'From Portfolio', day(p.last_update), null));
    }
    return out;
  },
};

const coInvestors: GroupSpec = {
  key: 'co_investors', label: 'Co-investors', empty: 'No co-investor yet.',
  read: async (env, user, now) => {
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.created_at, r.responded_at, r.updated_at, u.name, u.display_name,
              (SELECT MIN(m.remind_at) FROM partner_reminders m WHERE m.relationship_id = r.id AND m.created_by = ?1 AND m.done = 0) AS remind_at
         FROM partner_relationships r JOIN users u ON u.id = CASE WHEN r.partner_a_id = ?1 THEN r.partner_b_id ELSE r.partner_a_id END
        WHERE (r.partner_a_id = ?1 OR r.partner_b_id = ?1) AND r.status = 'accepted' AND r.relationship_type = 'co_investor'
        ORDER BY r.updated_at DESC, r.id DESC LIMIT ?2`,
    ).bind(user.id, LIMIT).all<any>();
    return (results || []).map((r: any) => row(`coinvestor:${r.id}`, said(r.display_name || r.name, 'A co-investor'), 'Investor', 'From Deals · co-investing',
      latest(r.updated_at, r.responded_at, r.created_at), markerOf({ dueAt: r.remind_at }, now)));
  },
};

// ── Advisor ─────────────────────────────────────────────────────────────────

const clientsSessions: GroupSpec = {
  key: 'clients', label: 'Clients · sessions', empty: 'No client has booked a session with you yet.',
  read: async (env, user, now) => {
    const adv = await advisorRow(env, user);
    if (!adv) return [];
    const at = new Date(now).toISOString();
    // The roster is who booked with the advisor (`requireRosterClient`); the due date is an engagement's term end.
    const { results } = await env.DB.prepare(
      `SELECT b.founder_user_id AS id, u.name, u.display_name,
              MAX(CASE WHEN s.starts_at <= ?2 THEN s.starts_at END) AS last_session,
              (SELECT MIN(e.term_ends_at) FROM advisor_engagements e WHERE e.advisor_id = ?1 AND e.founder_user_id = b.founder_user_id AND e.ended_at IS NULL) AS term_ends_at
         FROM advisor_bookings b JOIN advisor_office_hour_slots s ON s.id = b.slot_id JOIN users u ON u.id = b.founder_user_id
        WHERE b.advisor_id = ?1 AND b.status NOT IN ('cancelled','no_show')
        GROUP BY b.founder_user_id ORDER BY last_session DESC LIMIT ?3`,
    ).bind(adv.id, at, LIMIT).all<any>();
    return (results || []).map((c: any) => row(`client:${c.id}`, said(c.display_name || c.name, 'A client'), 'Founder', 'From Practice · sessions',
      day(c.last_session), markerOf({ dueAt: c.term_ends_at }, now)));
  },
};

const cohortFounders: GroupSpec = {
  key: 'cohort', label: 'Cohort founders', empty: 'You are not assigned to a cohort.',
  read: async (env, user, now) => {
    const at = new Date(now).toISOString();
    const hidden = await optedOutFounderIds(env, user.id);
    // A week past its deadline that is neither passed nor failed is the follow-up the cohort's plan sets.
    const { results } = await env.DB.prepare(
      `SELECT s.cohort_cycle_id AS cycle, s.user_id AS id, u.name, u.display_name, c.year, c.month,
              MAX(w.deadline_at) AS last_deadline,
              MIN(CASE WHEN s.status NOT IN ('passed','failed') AND w.deadline_at <= ?2 THEN w.deadline_at END) AS overdue
         FROM advisor_cohort_assignments a
         JOIN company_week_status s ON s.cohort_cycle_id = a.cohort_cycle_id
         JOIN users u ON u.id = s.user_id
         LEFT JOIN cohort_cycles c ON c.id = s.cohort_cycle_id
         LEFT JOIN week_windows w ON w.cohort_cycle_id = s.cohort_cycle_id AND w.week_number = s.week_number
        WHERE a.advisor_user_id = ?1 AND a.is_active = 1
        GROUP BY s.cohort_cycle_id, s.user_id ORDER BY c.year DESC, c.month DESC, u.name ASC LIMIT ?3`,
    ).bind(user.id, at, LIMIT).all<any>();
    return (results || []).filter((r: any) => !hidden.has(Number(r.id))).map((r: any) => {
      const cohort = r.year ? `${r.year}-${String(r.month).padStart(2, '0')} cohort` : 'cohort';
      return row(`cohort:${r.cycle}-${r.id}`, said(r.display_name || r.name, 'A cohort founder'), 'Founder', `From Cohorts · ${cohort}`, day(r.last_deadline), markerOf({ dueAt: r.overdue }, now));
    });
  },
};

// ── Operating partner ───────────────────────────────────────────────────────

const partnerId = (user: User) => ((user as any).partner_id ? Number((user as any).partner_id) : null);

const clientsEngagements: GroupSpec = {
  key: 'clients', label: 'Clients · engagements', empty: 'No engagement yet.',
  read: async (env, user, now) => {
    const pid = partnerId(user);
    if (pid == null) return [];
    const at = new Date(now).toISOString();
    // `engagements.founder_id` is a founders.id, joined as `needs.ts` joins it.
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.updated_at, e.created_at, f.name AS founder_name, p.name AS project_name,
              (SELECT MAX(r.sent_at) FROM engagement_status_reports r WHERE r.engagement_id = e.id AND r.state = 'sent') AS last_report,
              (SELECT MIN(m.due_at) FROM engagement_milestones m WHERE m.engagement_id = e.id AND m.completed_at IS NULL AND m.due_at <= ?2) AS overdue
         FROM engagements e LEFT JOIN founders f ON f.id = e.founder_id LEFT JOIN projects p ON p.id = e.project_id
        WHERE e.partner_id = ?1 AND e.status NOT IN ('cancelled')
        ORDER BY COALESCE(e.updated_at, e.created_at) DESC, e.id DESC LIMIT ?3`,
    ).bind(pid, at, LIMIT).all<any>();
    return (results || []).map((e: any) => row(`engagement:${e.id}`, [e.founder_name, e.project_name].map((v) => said(v, '')).filter(Boolean).join(' · ') || 'A client',
      'Founder', 'From Delivery · engagement', latest(e.last_report, e.updated_at, e.created_at), markerOf({ dueAt: e.overdue }, now)));
  },
};

const leads: GroupSpec = {
  key: 'leads', label: 'Leads', empty: 'No proposal sent yet.',
  read: async (env, user) => {
    const pid = partnerId(user);
    if (pid == null) return [];
    const { results } = await env.DB.prepare(
      `SELECT q.id, q.created_at, q.updated_at, f.name AS founder_name, p.name AS project_name
         FROM quotes q JOIN founder_needs n ON n.id = q.need_id LEFT JOIN founders f ON f.id = n.founder_id LEFT JOIN projects p ON p.id = n.project_id
        WHERE q.partner_id = ? AND q.status = 'submitted'
        ORDER BY q.updated_at DESC, q.id DESC LIMIT ?`,
    ).bind(pid, LIMIT).all<any>();
    return (results || []).map((q: any) => row(`lead:${q.id}`, [q.founder_name, q.project_name].map((v) => said(v, '')).filter(Boolean).join(' · ') || 'A lead',
      'Founder', 'From Pipeline · proposal sent', latest(q.updated_at, q.created_at), null));
  },
};

// ── Admin: only the cases they hold ─────────────────────────────────────────

const applicants: GroupSpec = {
  key: 'applicants', label: 'Spin-Out Lab applicants', empty: 'No application is yours: you have not scheduled or decided one.',
  read: async (env, user, now) => {
    // Held: the admin scheduled its interview or decided it. An interview held with no outcome is the follow-up.
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.company_name, a.created_at, a.decided_at, u.name, u.display_name,
              (SELECT MAX(i.updated_at) FROM spinout_application_interviews i WHERE i.application_id = a.id) AS last_interview,
              (SELECT MIN(i.scheduled_at) FROM spinout_application_interviews i WHERE i.application_id = a.id AND i.status = 'scheduled' AND i.scheduled_at <= ?2) AS overdue
         FROM spinout_applications a JOIN users u ON u.id = a.user_id
        WHERE a.status <> 'withdrawn'
          AND (EXISTS (SELECT 1 FROM spinout_application_interviews i WHERE i.application_id = a.id AND i.scheduled_by = ?1)
            OR EXISTS (SELECT 1 FROM cohort_applicants ca WHERE ca.application_id = a.id AND ca.decided_by = ?4))
        ORDER BY a.created_at DESC, a.id DESC LIMIT ?3`,
    ).bind(user.id, new Date(now).toISOString(), LIMIT, `admin:${user.id}`).all<any>();
    return (results || []).map((a: any) => row(`application:${a.id}`, [said(a.display_name || a.name, ''), said(a.company_name, '')].filter(Boolean).join(' · ') || 'An applicant',
      'Founder', 'From Programs · application', latest(a.decided_at, a.last_interview, a.created_at), markerOf({ dueAt: a.overdue }, now)));
  },
};

const tickets: GroupSpec = {
  key: 'tickets', label: 'Open support tickets', empty: 'No open ticket is assigned to you.',
  read: async (env, user) => {
    const [email, name] = holderNames(user);
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.created_at, t.updated_at, u.name, u.display_name, u.role
         FROM tickets t JOIN users u ON u.id = t.user_id
        WHERE t.status IN ('open','in_progress') AND t.assigned_to IS NOT NULL AND lower(trim(t.assigned_to)) IN (lower(trim(?1)), lower(trim(?2)))
        ORDER BY t.updated_at DESC, t.id DESC LIMIT ?3`,
    ).bind(email, name, LIMIT).all<any>();
    return (results || []).map((t: any) => row(`ticket:${t.id}`, said(t.display_name || t.name, 'A member'), t.role ? String(t.role) : null, `From Support · ticket #${t.id}`,
      latest(t.updated_at, t.created_at), null));
  },
};

/** No partner firm names an Axal holder: no table records one, so this group cannot be read honestly yet (D1348 §4). */
const partnerFirms: GroupSpec = {
  key: 'partner_firms', label: 'Partner firms', empty: 'No partner firm records an Axal holder yet, so none is listed.',
  read: async () => [],
};

const GROUPS: Readonly<Record<Profile, readonly GroupSpec[]>> = Object.freeze({
  investor: [dealFlow, portfolio, coInvestors, network],
  advisor: [clientsSessions, cohortFounders, network],
  partner: [clientsEngagements, leads, network],
  admin: [applicants, tickets, partnerFirms],
  explorer: [network],
  founder: [network],
});

export const PROFILE_GROUPS: Readonly<Record<Profile, readonly string[]>> = Object.freeze(
  Object.fromEntries(Object.entries(GROUPS).map(([k, v]) => [k, v.map((g) => g.key)])) as Record<Profile, string[]>,
);

const NOTES: Partial<Record<Profile, string>> = {
  admin: 'Admins email members only about a case they hold: an application, a ticket or a partner agreement. Eadwyn reads that case, never a member’s own records.',
  explorer: 'Explorers see Network matches only. Set up your profile to email the people you work with.',
};
const EMPTY: Partial<Record<Profile, string>> = {
  explorer: 'Pick a Network match to write to them. Email opens once you have both shared an address.',
};

/** The member's People pane, grouped by their profile. */
export async function peopleFor(env: Env, user: User, now = Date.now()): Promise<People> {
  const profile = profileOf(user);
  const groups: PeopleGroup[] = [];
  for (const g of GROUPS[profile]) {
    try {
      const people = await g.read(env, user, now);
      groups.push({ key: g.key, label: g.label, people, empty: people.length ? null : g.empty, error: null });
    } catch {
      groups.push({ key: g.key, label: g.label, people: [], empty: null, error: `${g.label} could not be read. Try again.` });
    }
  }
  return { profile, groups, note: NOTES[profile] ?? null, empty: EMPTY[profile] ?? null };
}

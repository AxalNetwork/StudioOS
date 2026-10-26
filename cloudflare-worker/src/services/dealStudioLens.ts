/**
 * D1242 (#3255, part 6 of #2423) — the Studio lens on Deal flow: every round
 * on the platform for studio staff, with who leads it, how many investors are
 * looking, where it came from, and, for a round that is Not raising, who set
 * it so.
 *
 * WHO MOVES A ROUND. An admin moves any round. An Operating Partner (`role =
 * 'partner'`) moves only the rounds they lead (`deals.lead_partner_id`, #2423
 * owner question 3), on advance, pass and every write through `PUT /:id`; a
 * partner never hands a round to someone else or takes one, so the lead
 * itself is the admin's to write. The lens reads every round for both.
 *
 * WHO SET A ROUND TO NOT RAISING. `deals.status = 'rejected'` has had three
 * writers:
 *   - a person, through `POST /:id/pass` (`passed_by_user_id`, and a `pass`
 *     stage event with its actor) or, before task #127, a direct status write
 *     (a `set` stage event with its actor);
 *   - intake scoring, which stored `rejected` for a score under 70 until
 *     #2643 (2026-10-23). Those rows carry no person and no stage event, and
 *     their project's `auto_scored` activity line reads "Status: rejected";
 *   - anything else that left no trace: a CRM sync, a queue job, an old row.
 * Intake no longer writes `rejected` (a low score stays In intake for a human
 * decision), so the first two are told apart from what is already recorded,
 * with no migration: a NEW `kind` value would need the stage events' CHECK
 * rebuilt. `notRaisingBy` reads the evidence; a row with none is "not
 * recorded", never guessed to be a pass.
 */
import type { Env } from '../types';
import { ensureDealPassSchema } from './dealStageHistory';

/** The round's pipeline, in order; `rejected` (Not raising) is outside it. */
export const ROUND_PIPELINE = ['applied', 'scored', 'active', 'funded'] as const;
export const NOT_RAISING = 'rejected';

/** The refusal an Operating Partner gets on a round someone else leads. */
export const NOT_YOUR_ROUND = {
  code: 'not_your_round',
  detail: 'You can move only the rounds you lead. The studio moves the rest.',
} as const;

/** The refusal on a write to who leads a round, from anyone but an admin. */
export const LEAD_ADMIN_ONLY = {
  code: 'lead_admin_only',
  detail: 'Only an admin changes who leads a round. Nothing in this request was saved.',
} as const;

/** May this caller move (advance, pass, edit) a round led by `leadPartnerId`? */
export function canMoveRound(user: { id?: unknown; role?: unknown } | null | undefined, leadPartnerId: unknown): boolean {
  const role = String(user?.role ?? '');
  if (role === 'admin') return true;
  if (role !== 'partner') return false;
  const me = Number(user?.id);
  return Number.isInteger(me) && me > 0 && leadPartnerId != null && Number(leadPartnerId) === me;
}

export type NotRaisingBy = 'person' | 'intake' | 'not_recorded';

/**
 * Who set a Not raising round so, from what the row and its trail record:
 * a person when anyone is named (the pass's own column or a stage event's
 * actor), intake when its own log line says it wrote `rejected`, otherwise
 * not recorded. Null for a round that is not Not raising.
 */
export function notRaisingBy(row: {
  status?: unknown; passed_by_user_id?: unknown; person_event?: unknown; intake_logged?: unknown;
}): NotRaisingBy | null {
  if (String(row?.status) !== NOT_RAISING) return null;
  if (row.passed_by_user_id != null || Number(row.person_event) === 1) return 'person';
  if (Number(row.intake_logged) === 1) return 'intake';
  return 'not_recorded';
}

const count = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

function daysSince(ts: unknown): number | null {
  if (!ts) return null;
  const raw = String(ts);
  const t = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`).getTime();
  if (!Number.isFinite(t)) return null;
  const d = Math.floor((Date.now() - t) / 86_400_000);
  return d > 0 ? d : 0;
}

/** The project's own intake line, as intake wrote it before #2643. Bound, never interpolated. */
export const INTAKE_LINE = '%Status: rejected%';

/**
 * `GET /api/deals/studio`: every round, newest first, for an admin or an
 * Operating Partner, with `intake_not_raising` counted for the notice above
 * the board. Each row says whether this caller may move it.
 */
export async function readStudioLens(env: Env, user: { id?: unknown; role?: unknown }) {
  await ensureDealPassSchema(env);
  const res = await env.DB.prepare(
    `SELECT d.id, d.uid, d.status, d.amount, d.target_raise, d.currency, d.source, d.lead_partner_id,
            d.minimum_check, d.valuation_cap, d.carry_pct, d.management_fee_pct, d.instrument,
            d.spv_jurisdiction, d.closing_deadline, d.website,
            d.stage_changed_at, d.updated_at, d.created_at, d.pass_reason, d.passed_by_user_id, d.passed_at,
            p.name AS project_name, p.sector AS project_sector,
            lp.name AS lead_partner_name, pb.name AS passed_by_name,
            (SELECT COUNT(*) FROM deal_invitations i WHERE i.deal_id = d.id) AS invited,
            (SELECT COUNT(*) FROM deal_invitations i WHERE i.deal_id = d.id AND i.status = 'interested') AS interested,
            (SELECT COUNT(DISTINCT cm.investor_user_id) FROM commitments cm WHERE cm.deal_id = d.id AND cm.status = 'confirmed') AS committed,
            EXISTS (SELECT 1 FROM deal_stage_events e WHERE e.deal_id = d.id AND e.to_stage = ? AND e.actor_user_id IS NOT NULL) AS person_event,
            EXISTS (SELECT 1 FROM activity_logs a WHERE a.project_id = d.project_id AND a.action = 'auto_scored' AND a.details LIKE ?) AS intake_logged
       FROM deals d
       LEFT JOIN projects p ON p.id = d.project_id
       LEFT JOIN users lp ON lp.id = d.lead_partner_id
       LEFT JOIN users pb ON pb.id = d.passed_by_user_id
      WHERE (p.id IS NULL OR p.deleted_at IS NULL)
      ORDER BY d.created_at DESC, d.id DESC`,
  ).bind(NOT_RAISING, INTAKE_LINE).all<any>();
  const me = Number(user?.id);
  const rows = (res.results || []).map((r) => {
    const by = notRaisingBy(r);
    return {
      id: Number(r.id),
      uid: r.uid ?? null,
      project_name: r.project_name ?? null,
      project_sector: r.project_sector ?? null,
      status: String(r.status),
      amount: r.amount ?? null,
      target_raise: r.target_raise ?? null,
      currency: r.currency ?? 'USD',
      source: r.source ?? null,
      // The terms, for Edit terms on a round this caller may move.
      terms: {
        target_raise: r.target_raise ?? null, minimum_check: r.minimum_check ?? null,
        valuation_cap: r.valuation_cap ?? null, carry_pct: r.carry_pct ?? null,
        management_fee_pct: r.management_fee_pct ?? null, instrument: r.instrument ?? null,
        spv_jurisdiction: r.spv_jurisdiction ?? null, closing_deadline: r.closing_deadline ?? null,
        website: r.website ?? null,
      },
      lead_partner_id: r.lead_partner_id == null ? null : Number(r.lead_partner_id),
      lead_partner_name: r.lead_partner_name ?? null,
      days_in_stage: daysSince(r.stage_changed_at || r.updated_at || r.created_at),
      investors: { invited: count(r.invited), interested: count(r.interested), committed: count(r.committed) },
      not_raising_by: by,
      passed_by_name: by === 'person' ? r.passed_by_name ?? null : null,
      you_lead: r.lead_partner_id != null && Number(r.lead_partner_id) === me,
      can_move: canMoveRound(user, r.lead_partner_id),
    };
  });
  return {
    rows,
    intake_not_raising: rows.filter((r) => r.not_raising_by === 'intake').length,
  };
}

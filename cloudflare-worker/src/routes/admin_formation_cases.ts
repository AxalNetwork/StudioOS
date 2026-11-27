/**
 * D6697 (#6697, H1 of #6680) — HQ's formation case reads: the queue with its
 * saved views, one case, and the filings board. D6698 adds the HQ case actions.
 *
 *   GET /api/admin/formation/cases                  the queue: `view` (VIEWS), `country`, `partner`, `route`,
 *                                                   `track`, `limit`, `offset`; legacy and v2 cases in one list,
 *                                                   legacy rows marked; ages, clocks and bands; no people, no documents
 *   GET /api/admin/formation/cases/:uid             one case: stages, filings, requests, fee lines, timeline,
 *                                                   choice record; people, documents and answers only for its
 *                                                   assigned HQ owner and Super Admins (counts for any other admin),
 *                                                   and each such read is written to formation_case_access_log
 *   GET /api/admin/formation/filings                every filing by state, with days since it was submitted
 *   GET  /api/admin/formation/cases/:uid/eligible-partners  D6710: firms covering the case's form and a service, each
 *                                                   with why it may not be offered, ranked (services/formationAssignments.ts)
 *   POST /api/admin/formation/cases/:uid/offer      D6710: offer a service on the case to an eligible firm, after a re-screen
 *   POST /api/admin/formation/cases/:uid/reassign   D6710: move it to another firm; the old firm's access ends at once and
 *                                                   it is sent a deletion or return request (step-up)
 *
 * WHO. `requireHqAdmin` on every route: an admin on HQ; a non-admin is refused,
 * and a branch gets the named `hq_only` refusal. `GET /api/admin/incorporations`
 * (admin_incorporations.ts) is unchanged. Rules and reads: services/formationQueue.ts.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { isSuperAdmin, requireHqAdmin, requireStepUp } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { decideScreening } from '../services/formationScreening';
import { eligiblePartners, offerCase, reassignCase } from '../services/formationAssignments';
import { SERVICES } from '../services/formationPartners';
import { HQ_ACTIONS, writeHqCase } from '../services/formationHqActions';
import { STAGES } from '../services/formationCase';
import {
  QUEUE_READ_CAP, ROUTES, TRACKS, VIEWS, bandOf, daysSince, inView, partyClocks, queueRow,
  readCaseByUid, readQueueCases, readWaiting, type View,
} from '../services/formationQueue';

type Ctx = Context<{ Bindings: Env }>;
const cases = new Hono<{ Bindings: Env }>();
const filings = new Hono<{ Bindings: Env }>();

const unreadable = (c: Ctx, raw: unknown) =>
  refuse(c, 503, { code: 'formation_cases_unreadable', message: 'The formation cases could not be read. Try again in a moment.', raw });
const intParam = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const UID = /^[A-Za-z0-9_-]{1,64}$/;

cases.get('/', async (c) => {
  const user = await requireHqAdmin(c);
  const view = String(c.req.query('view') || 'all');
  if (!(VIEWS as readonly string[]).includes(view)) {
    return refuse(c, 400, { code: 'invalid_view', message: `A view is one of ${VIEWS.join(', ')}.` });
  }
  const country = String(c.req.query('country') || '').toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) return refuse(c, 400, { code: 'invalid_country', message: 'A country is a two-letter code, such as DE.' });
  const route = String(c.req.query('route') || '');
  if (route && !(ROUTES as readonly string[]).includes(route)) return refuse(c, 400, { code: 'invalid_route', message: 'A route is simple or specialist.' });
  const track = String(c.req.query('track') || '');
  if (track && !(TRACKS as readonly string[]).includes(track)) return refuse(c, 400, { code: 'invalid_track', message: 'A track is legacy_v1 or v2.' });
  const partnerRaw = c.req.query('partner');
  const partner = partnerRaw == null || partnerRaw === '' ? null : Number(partnerRaw);
  if (partner != null && (!Number.isSafeInteger(partner) || partner <= 0)) return refuse(c, 400, { code: 'invalid_partner', message: 'A partner is a positive number.' });
  const limit = intParam(c.req.query('limit'), 50, 1, 100);
  const offset = intParam(c.req.query('offset'), 0, 0, QUEUE_READ_CAP);

  try {
    const now = Date.now();
    const { cases: rows, truncated } = await readQueueCases(c.env);
    const waiting = await readWaiting(c.env, rows.map((r) => Number(r.id)));
    const withClocks = rows.map((r) => ({ r, clocks: partyClocks(waiting.get(Number(r.id)) || [], now, r.closed_at) }));
    const filtered = withClocks.filter(({ r }) =>
      (!country || r.country === country) && (!route || r.path === route) && (!track || r.track === track)
      && (partner == null || Number(r.partner_id) === partner));
    const counts = Object.fromEntries(VIEWS.map((v) => [v, filtered.filter(({ r, clocks }) => inView(v, r, clocks)).length]));
    const inThis = filtered.filter(({ r, clocks }) => inView(view as View, r, clocks));
    return c.json({
      view, filters: { country: country || null, route: route || null, track: track || null, partner },
      total: inThis.length, limit, offset,
      views: counts,
      items: inThis.slice(offset, offset + limit).map(({ r, clocks }) => queueRow(r, clocks, Number(user.id), now)),
      truncated, read_cap: QUEUE_READ_CAP,
      read_at: new Date(now).toISOString(),
    });
  } catch (e) { return unreadable(c, e); }
});

/** True when `user` may see this case's people, documents and answers. */
function seesPrivate(user: User, hqOwner: number | null): boolean {
  return isSuperAdmin(user as any) || (hqOwner != null && Number(hqOwner) === Number(user.id));
}

cases.get('/:uid', async (c) => {
  const user = await requireHqAdmin(c);
  const uid = c.req.param('uid');
  if (!UID.test(uid)) return c.json({ detail: 'Not found' }, 404);
  let row: Awaited<ReturnType<typeof readCaseByUid>>;
  try { row = await readCaseByUid(c.env, uid); } catch (e) { return unreadable(c, e); }
  if (!row) return c.json({ detail: 'Not found' }, 404);
  const id = Number(row.id);
  const now = Date.now();
  const full = seesPrivate(user, row.hq_owner_user_id);
  try {
    const db = c.env.DB;
    const [stages, fl, rq, ev, docs, answers, waiting, order, fees, people] = await Promise.all([
      db.prepare('SELECT stage, responsible_role, owner_user_id, completed_by, completed_at, created_at FROM formation_case_stages WHERE case_id = ? ORDER BY id').bind(id).all<any>(),
      db.prepare(`SELECT uid, kind, authority_name, submitted_by_party, reference, submitted_on, state, decided_on, rejection_reason,
                         registration_number, attempt, recorded_after_the_fact, created_at, updated_at
                    FROM formation_filings WHERE case_id = ? ORDER BY id`).bind(id).all<any>(),
      db.prepare(`SELECT uid, asked_by_party, asked_by_user_id, asked_of_party, asked_of_user_id, kind, title, due_on, state, created_at, closed_at
                    FROM formation_case_requests WHERE case_id = ? ORDER BY id`).bind(id).all<any>(),
      db.prepare('SELECT id, at, actor_user_id, party, kind, from_stage, to_stage, visibility, detail_json FROM formation_case_events WHERE case_id = ? ORDER BY id').bind(id).all<any>(),
      db.prepare('SELECT uid, filing_id, document_id, class, visible_to, created_at FROM formation_case_documents WHERE case_id = ? ORDER BY id').bind(id).all<any>(),
      db.prepare('SELECT uid, case_revision, answers_json, prefill_json, created_at FROM formation_case_answers WHERE case_id = ? ORDER BY case_revision DESC LIMIT 1').bind(id).all<any>(),
      readWaiting(c.env, [id]),
      db.prepare(`SELECT i.id AS incorporation_id, i.company_name, i.status, i.amount_cents, i.currency
                    FROM formation_case_orders o JOIN incorporations i ON i.id = o.incorporation_id WHERE o.case_id = ? ORDER BY o.id DESC LIMIT 1`).bind(id).first<any>(),
      db.prepare(`SELECT l.line_key, l.label, l.payee, l.collected_by, l.currency, l.amount_cents, l.timing, l.checked_on
                    FROM formation_fee_lines l JOIN formation_entity_forms f ON f.id = l.form_id
                   WHERE l.version_id = ? AND f.version_id = ? AND f.form_key = ? ORDER BY l.id`)
        .bind(row.catalogue_version_id ?? -1, row.catalogue_version_id ?? -1, row.form_key ?? '').all<any>(),
      db.prepare(`SELECT u.id, u.name, u.email, CASE WHEN u.id = ? THEN 'founder' ELSE 'hq_owner' END AS role
                    FROM users u WHERE u.id IN (?, ?)`).bind(row.user_id, row.user_id, row.hq_owner_user_id ?? -1).all<any>(),
    ]);

    const recorded = new Map((stages.results || []).map((s: any) => [s.stage, s]));
    const latestAnswer = (answers.results || [])[0] ?? null;
    const docList = docs.results || [];
    const clocks = partyClocks(waiting.get(id) || [], now, row.closed_at);

    if (full) {
      const logged: string[] = ['people'];
      if (docList.length) logged.push('documents');
      if (latestAnswer) logged.push('answers');
      await db.batch(logged.map((what) =>
        db.prepare('INSERT INTO formation_case_access_log (case_id, viewer_user_id, what) VALUES (?, ?, ?)').bind(id, Number(user.id), what)));
    }

    // Only the assigned reviewer sees named-person matches. The preceding private-read
    // audit must succeed before any screening evidence is returned.
    const screenings = full ? await db.prepare(`SELECT s.id,p.name,s.person_revision,s.checkpoint,s.severity,
      s.provider_lists,s.matches,s.screened_at,s.decided_at,s.decided_by,s.decision,s.hq_reason
      FROM formation_case_screenings s JOIN formation_case_people p ON p.id=s.person_id
      WHERE p.case_id=? ORDER BY s.id DESC`).bind(id).all() : null;
    const peopleRows = people.results || [];
    const age = daysSince(row.created_at, now);
    return c.json({
      case: {
        ...queueRow(row, clocks, Number(user.id), now),
        project_id: row.project_id, company_id: row.company_id, structure_gate: row.structure_gate,
        catalogue_version_id: row.catalogue_version_id, revision: row.revision, hold_reason: row.hold_reason,
      },
      access: full ? 'full' : 'counts',
      ...(screenings ? { screenings: screenings.results } : {}),
      people: full
        ? peopleRows.map((p: any) => ({ role: p.role, user_id: Number(p.id), name: p.name ?? null, email: p.role === 'founder' ? (p.email ?? null) : null }))
        : { count: peopleRows.length },
      // The recorded stages (D6686 part 2): eight from paid; the stages before them keep no record.
      stages: STAGES.map((s) => {
        const r: any = recorded.get(s);
        return {
          stage: s, current: s === row.stage,
          record: r ? { responsible_role: r.responsible_role, opened_at: r.created_at, completed_at: r.completed_at,
            ...(full ? { owner_user_id: r.owner_user_id, completed_by: r.completed_by } : {}) } : null,
        };
      }),
      filings: (fl.results || []).map((f: any) => ({ ...f, days_since_submitted: f.submitted_on ? daysSince(f.submitted_on, now) : null })),
      requests: (rq.results || []).map((q: any) => {
        const { asked_by_user_id, asked_of_user_id, ...rest } = q;
        return full ? { ...rest, asked_by_user_id, asked_of_user_id } : rest;
      }),
      fee_lines: {
        catalogue: fees.results || [],
        order: order ? { incorporation_id: order.incorporation_id, status: order.status, amount_cents: order.amount_cents, currency: order.currency, company_name: order.company_name } : null,
      },
      timeline: (ev.results || []).map((e: any) => {
        const out: Record<string, unknown> = { id: e.id, at: e.at, party: e.party, kind: e.kind, from_stage: e.from_stage, to_stage: e.to_stage, visibility: e.visibility };
        if (full) out.actor_user_id = e.actor_user_id;
        if (full && e.detail_json) { try { out.detail = JSON.parse(e.detail_json); } catch { out.detail = null; } }
        return out;
      }),
      documents: full ? docList : { count: docList.length },
      choice: latestAnswer
        ? { case_revision: latestAnswer.case_revision, recorded_at: latestAnswer.created_at,
          ...(full ? { answers: safeJson(latestAnswer.answers_json), prefill: safeJson(latestAnswer.prefill_json) } : {}) }
        : null,
      age_days: age, age_band: bandOf(age),
      read_at: new Date(now).toISOString(),
    });
  } catch (e) { return unreadable(c, e); }
});

// The closed list leaves future partner-offer and screening routes with their own gates.
for (const action of HQ_ACTIONS) {
  cases.post(`/:uid/${action}`, async (c) => {
    const admin = await requireHqAdmin(c);
    if (action === 'confirm-registration') await requireStepUp(c);
    const uid = c.req.param('uid');
    if (!UID.test(uid)) return c.json({ detail: 'Not found' }, 404);
    const body = await c.req.json().catch(() => null);
    if (!body || Array.isArray(body) || typeof body !== 'object') return refuse(c, 400, { code: 'invalid_body', message: 'Send a JSON object for this case action.' });
    const result = await writeHqCase(c.env, admin, uid, action, body);
    if (!result.ok) return refuse(c, result.status, { code: result.error, message: HQ_REFUSALS[result.error] ?? result.error.replaceAll('_', ' ') + '.' });
    return c.json(result);
  });
}

for (const decision of ['clear','decline'] as const) {
  cases.post(`/:uid/screenings/:id/${decision}`, async c => {
    const admin = await requireHqAdmin(c);
    await requireStepUp(c);
    const id = Number(c.req.param('id'));
    const reason = (await c.req.json().catch(() => null))?.reason;
    if (!Number.isSafeInteger(id) || id <= 0 || typeof reason !== 'string' || !reason.trim() || reason.length > 2000)
      return refuse(c,400,{code:'invalid_screening_decision',message:'Choose a screening and give a reason.'});
    if (!await decideScreening(c.env,c.req.param('uid'),id,admin.id,isSuperAdmin(admin),decision,reason.trim()))
      return refuse(c,404,{code:'screening_unavailable',message:'This review is unavailable.'});
    return c.json({decision});
  });
}

cases.get('/:uid/eligible-partners', async (c) => {
  const admin = await requireHqAdmin(c);
  const uid = c.req.param('uid');
  if (!UID.test(uid)) return c.json({ detail: 'Not found' }, 404);
  const service = String(c.req.query('service') || 'formation');
  if (!(SERVICES as readonly string[]).includes(service)) return refuse(c, 400, { code: 'invalid_service', message: `A service is one of ${SERVICES.join(', ')}.` });
  try {
    const row = await readCaseByUid(c.env, uid);
    if (!row) return c.json({ detail: 'Not found' }, 404);
    if (!isSuperAdmin(admin) && Number(row.hq_owner_user_id) !== Number(admin.id)) {
      return refuse(c, 403, { code: 'case_owner_required', message: HQ_REFUSALS.case_owner_required });
    }
    const now = new Date();
    const partners = await eligiblePartners(c.env, row, service as any, now);
    return c.json({ case_uid: uid, service, country: row.country, form_key: row.form_key, partners, read_at: now.toISOString() });
  } catch (e) { return unreadable(c, e); }
});

for (const action of ['offer', 'reassign'] as const) {
  cases.post(`/:uid/${action}`, async (c) => {
    const admin = await requireHqAdmin(c);
    if (action === 'reassign') await requireStepUp(c);
    const uid = c.req.param('uid');
    if (!UID.test(uid)) return c.json({ detail: 'Not found' }, 404);
    const body = await c.req.json().catch(() => null);
    if (!body || Array.isArray(body) || typeof body !== 'object') return refuse(c, 400, { code: 'invalid_body', message: 'Send a JSON object for this case action.' });
    const result = action === 'offer' ? await offerCase(c.env, admin, uid, body) : await reassignCase(c.env, admin, uid, body);
    if (!result.ok) {
      return refuse(c, result.status, { code: result.error, message: HQ_REFUSALS[result.error] ?? result.error.replaceAll('_', ' ') + '.', ...(result.detail ? { extra: result.detail } : {}) });
    }
    return c.json(result);
  });
}

const HQ_REFUSALS: Record<string, string> = {
  case_moved: 'This case changed. Reload it before trying again.',
  case_owner_required: 'Only the assigned HQ owner or a Super Admin can act on this case.',
  reason_required: 'Give a reason for this action.',
  recorded_for_partner_required: 'Name the partner whose record you are entering.',
  partner_not_assigned: 'That partner is not assigned to this case.',
  founder_approval_required: 'The founder must approve the current filing pack first.',
  registration_not_pending: 'This case has no partner registration awaiting confirmation.',
  document_not_on_case: 'Choose a document belonging to this case.',
  // D6710: offer and reassign.
  legacy_case: 'A legacy case is not offered to a partner here.',
  case_on_hold: 'This case is on hold. Resolve the hold first.',
  form_not_chosen: 'The case has no chosen company form yet, so no partner coverage applies.',
  invalid_service: 'Choose a partner service.',
  formation_partner_required: 'Choose the partner to offer this case to.',
  invalid_expiry: 'An offer expires after 1 to 336 hours.',
  invalid_notice_kind: 'A request to the previous partner is a deletion_request or a return_request.',
  partner_has_no_coverage: 'That partner does not cover this form and service.',
  partner_not_verified: 'That partner is not verified.',
  coverage_off: "That partner's coverage for this form and service is switched off.",
  credential_missing: 'That partner holds no licence for this country.',
  credential_expired: "That partner's licence for this country has expired.",
  dpa_missing: 'That partner has no signed data agreement.',
  restricted_place: "One of this case's countries is a restricted place for that partner.",
  restricted_places_unreadable: "That partner's restricted places are not all two-letter country codes, so they cannot be checked.",
  assignment_exists: 'This service is already offered or assigned. Reassign it instead.',
  no_assignment: 'This service is not offered or assigned yet. Offer it instead.',
  same_partner: 'The case is already with that partner.',
  people_required: 'Add the people on this case before offering it, so they can be screened.',
  screening_unavailable: 'The screening lists could not be read. Try again in a moment.',
};

function safeJson(v: unknown) { try { return JSON.parse(String(v)); } catch { return null; } }

const FILING_STATES = ['prepared', 'submitted', 'queried', 'accepted', 'rejected', 'withdrawn'] as const;

filings.get('/', async (c) => {
  await requireHqAdmin(c);
  const state = String(c.req.query('state') || '');
  if (state && !(FILING_STATES as readonly string[]).includes(state)) {
    return refuse(c, 400, { code: 'invalid_state', message: `A filing state is one of ${FILING_STATES.join(', ')}.` });
  }
  try {
    const now = Date.now();
    const r = await c.env.DB.prepare(
      `SELECT f.uid, f.kind, f.state, f.authority_name, f.submitted_by_party, f.reference, f.submitted_on, f.decided_on,
              f.attempt, f.recorded_after_the_fact, f.updated_at, c.uid AS case_uid, c.track, c.stage AS case_stage
         FROM formation_filings f JOIN formation_cases c ON c.id = f.case_id
        WHERE (? = '' OR f.state = ?)
        ORDER BY f.submitted_on IS NULL, f.submitted_on, f.id`,
    ).bind(state, state).all<any>();
    const rows = (r.results || []).map((f: any) => {
      const days = f.submitted_on ? daysSince(f.submitted_on, now) : null;
      return { ...f, legacy: f.track === 'legacy_v1', days_since_submitted: days, age_band: bandOf(days) };
    });
    const by_state = Object.fromEntries(FILING_STATES.map((s) => [s, rows.filter((f: any) => f.state === s)]));
    return c.json({ state: state || null, total: rows.length, by_state, read_at: new Date(now).toISOString() });
  } catch (e) {
    return refuse(c, 503, { code: 'formation_filings_unreadable', message: 'The filings could not be read. Try again in a moment.', raw: e });
  }
});

export default cases;
export { filings as formationFilingsRouter };

export const mount: RouteMount[] = [
  { path: '/api/admin/formation/cases', router: cases },
  { path: '/api/admin/formation/filings', router: filings },
];

/**
 * D959 (#2792, Programs part 6) — Investor cohort access, the members' side.
 * Mounted at `/api/investor-cohorts`. The pages that draw these are a task of
 * their own (D959 §7); this part builds the routes.
 *
 * THE INVESTOR (O-VER A, O-NDA B, O-SEE A). Every read checks, every time: an
 * active account, verified now, an open grant whose last day has not passed,
 * and the grant's cohort NDA signed.
 *   GET  /me                          the investor's open grants and their state
 *   GET  /me/:cycleId/ventures        each venture's summary and weekly progress, as the grant's scope allows
 *   POST /me/:cycleId/intros          { founder_user_id, message? } asks a founder for an introduction
 * Refusals: 403 `not_verified`, 403 `not_assigned`, 403 `nda_required`.
 * The read selects its own columns and serves no founder's email address; a
 * founder who hid from this investor is left out, and cannot be asked.
 *
 * THE FOUNDER (D492's pattern, routes/advisors.ts `/me/cohort-access`).
 *   GET  /founder/access                       the investors who can or could see them
 *   PUT  /founder/access/:investorUserId       { visible } hides from one investor, or shows again
 *   GET  /founder/intros                       the requests made to them
 *   POST /founder/intros/:uid/decide           { accepted } decides once
 * Contact goes one way (O-SEE A): once a founder accepts, their list shows the
 * investor's email address so the founder can write; the investor is told the
 * founder accepted, and never receives the founder's address here.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { notify } from '../services/notify';
import { mapError, newUid } from './_t13t14t15_helpers';
import {
  NOTE_MAX, NOTICE_LINK, NOTICE_TYPE, cohortLabel, founderInvestorAccess, grantStateOf, hiddenFrom,
  isVerifiedInvestor, ndaStateOf, openGrant, scopeOf, setFounderVisibility, syncInvestorCohortNotices,
  todayUtc, type GrantRow,
} from '../services/investorCohortAccess';

const r = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

/** The signed-in user as a verified investor (O-VER A, read fresh), or the refusal. */
async function verifiedSelf(c: C): Promise<{ id: number; name: string | null; firm: string | null } | Response> {
  const user = await requireAuth(c);
  const u = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.role, u.is_active, u.kyc_status, p.firm_name AS firm
       FROM users u LEFT JOIN investor_profiles p ON p.user_id = u.id WHERE u.id = ?`,
  ).bind(user.id).first<{ id: number; name: string | null; role: string; is_active: number; kyc_status: string | null; firm: string | null }>();
  if (!isVerifiedInvestor(u)) {
    return refuse(c, 403, { code: 'not_verified', message: 'Cohort access is for verified investors: an active account and approved KYC.' });
  }
  return { id: Number(u!.id), name: u!.name ?? null, firm: u!.firm ?? null };
}

/** The open, signed grant this investor holds on a cohort, or the refusal. */
async function readableGrant(c: C, investorId: number, rawCycle: string | undefined): Promise<GrantRow | Response> {
  if (!/^[1-9][0-9]{0,14}$/.test(String(rawCycle ?? ''))) return refuse(c, 400, { code: 'bad_cycle_id', message: 'cycleId is a cohort cycle id.' });
  const grant = await openGrant(c.env, investorId, Number(rawCycle), todayUtc());
  if (!grant) return refuse(c, 403, { code: 'not_assigned', message: 'You do not have open access to this cohort.' });
  if (!grant.nda_signed_at) return refuse(c, 403, { code: 'nda_required', message: 'Sign the cohort NDA before you read this cohort.' });
  return grant;
}

/** The founders in a cohort (company_week_status), less those who hid from this investor. */
async function visibleFounders(env: Env, cycleId: number, investorId: number): Promise<Array<{ user_id: number; name: string | null }>> {
  const [res, hidden] = await Promise.all([
    env.DB.prepare(
      `SELECT DISTINCT w.user_id, u.name FROM company_week_status w JOIN users u ON u.id = w.user_id
        WHERE w.cohort_cycle_id = ? ORDER BY lower(COALESCE(u.name, '')), w.user_id LIMIT 500`,
    ).bind(cycleId).all<{ user_id: number; name: string | null }>(),
    hiddenFrom(env, investorId),
  ]);
  return (res.results || []).filter((f) => !hidden.has(Number(f.user_id)));
}

r.get('/me', async (c) => {
  try {
    const me = await verifiedSelf(c);
    if (me instanceof Response) return me;
    const today = todayUtc();
    const res = await c.env.DB.prepare(
      `SELECT g.uid, g.cohort_cycle_id, g.granted_at, g.ends_at, g.ended_at, g.scope_json, g.nda_envelope_uuid, g.nda_signed_at, c.year, c.month
         FROM investor_cohort_access g LEFT JOIN cohort_cycles c ON c.id = g.cohort_cycle_id
        WHERE g.investor_user_id = ? AND g.ended_at IS NULL AND g.ends_at >= ?
        ORDER BY g.granted_at DESC, g.id DESC LIMIT 100`,
    ).bind(me.id, today).all<any>();
    return c.json({
      items: (res.results || []).map((g: any) => ({
        uid: g.uid,
        cohort: { id: Number(g.cohort_cycle_id), label: cohortLabel(g.year, g.month) },
        state: grantStateOf(g, true, today),
        nda_state: ndaStateOf(g),
        scope: scopeOf(g.scope_json),
        granted_at: g.granted_at,
        ends_at: g.ends_at,
      })),
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/me/:cycleId/ventures', async (c) => {
  try {
    const me = await verifiedSelf(c);
    if (me instanceof Response) return me;
    const grant = await readableGrant(c, me.id, c.req.param('cycleId'));
    if (grant instanceof Response) return grant;
    // A founder is told no later than the first read of them.
    try { await syncInvestorCohortNotices(c.env, { grantId: grant.id }); } catch (e) {
      console.error('[investor-cohorts] notice sweep before a read failed', (e as Error)?.name);
    }
    const cycleId = grant.cohort_cycle_id;
    const scope = scopeOf(grant.scope_json);
    const founders = await visibleFounders(c.env, cycleId, me.id);
    const ids = JSON.stringify(founders.map((f) => Number(f.user_id)));
    const [cycle, ventures, weeks, intros] = await Promise.all([
      c.env.DB.prepare('SELECT year, month FROM cohort_cycles WHERE id = ?').bind(cycleId).first<{ year: number; month: number }>(),
      scope.includes('summary')
        ? c.env.DB.prepare(
          `SELECT u.id AS user_id, p.name, p.tagline, p.sector, p.stage
             FROM users u
             JOIN projects p ON p.id = (SELECT p2.id FROM projects p2
                                         WHERE p2.founder_id = u.founder_id AND p2.deleted_at IS NULL
                                         ORDER BY p2.id DESC LIMIT 1)
            WHERE u.id IN (SELECT value FROM json_each(?))`,
        ).bind(ids).all<{ user_id: number; name: string; tagline: string | null; sector: string | null; stage: string | null }>()
        : Promise.resolve({ results: [] as any[] }),
      scope.includes('weekly_progress')
        ? c.env.DB.prepare(
          `SELECT user_id, week_number, status, deliverables_done, deliverables_required
             FROM company_week_status WHERE cohort_cycle_id = ? AND user_id IN (SELECT value FROM json_each(?))
            ORDER BY user_id, week_number`,
        ).bind(cycleId, ids).all<any>()
        : Promise.resolve({ results: [] as any[] }),
      c.env.DB.prepare('SELECT uid, founder_user_id, decision FROM investor_cohort_intro_requests WHERE grant_id = ?')
        .bind(grant.id).all<{ uid: string; founder_user_id: number; decision: string | null }>(),
    ]);
    const ventureOf = new Map((ventures.results || []).map((v: any) => [Number(v.user_id), v]));
    const weeksOf = new Map<number, any[]>();
    for (const w of weeks.results || []) {
      const k = Number(w.user_id);
      if (!weeksOf.has(k)) weeksOf.set(k, []);
      weeksOf.get(k)!.push({ week: Number(w.week_number), status: w.status, deliverables_done: Number(w.deliverables_done) || 0, deliverables_required: Number(w.deliverables_required) || 0 });
    }
    const introOf = new Map((intros.results || []).map((i) => [Number(i.founder_user_id), { uid: i.uid, state: i.decision ?? 'pending' }]));
    return c.json({
      cohort: { id: cycleId, label: cohortLabel(cycle?.year, cycle?.month) },
      scope,
      ventures: founders.map((f) => {
        const v = ventureOf.get(Number(f.user_id));
        return {
          founder_user_id: Number(f.user_id),
          founder_name: f.name ?? null,
          ...(scope.includes('summary')
            ? { venture: v ? { name: v.name, tagline: v.tagline ?? null, sector: v.sector ?? null, stage: v.stage ?? null } : null }
            : {}),
          ...(scope.includes('weekly_progress') ? { weeks: weeksOf.get(Number(f.user_id)) ?? [] } : {}),
          intro: introOf.get(Number(f.user_id)) ?? null,
        };
      }),
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/me/:cycleId/intros', async (c) => {
  try {
    const me = await verifiedSelf(c);
    if (me instanceof Response) return me;
    const grant = await readableGrant(c, me.id, c.req.param('cycleId'));
    if (grant instanceof Response) return grant;
    const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const founderId = typeof b.founder_user_id === 'number' && Number.isSafeInteger(b.founder_user_id) && b.founder_user_id > 0 ? b.founder_user_id : null;
    if (!founderId) return refuse(c, 400, { code: 'invalid_founder', message: 'founder_user_id is a whole-number id.' });
    if (b.message !== undefined && b.message !== null && typeof b.message !== 'string') return refuse(c, 400, { code: 'invalid_message', message: 'message is text.' });
    const message = typeof b.message === 'string' && b.message.trim() ? b.message.trim() : null;
    if (message && message.length > NOTE_MAX) return refuse(c, 400, { code: 'message_too_long', message: `The message is at most ${NOTE_MAX} characters.` });
    const founders = await visibleFounders(c.env, grant.cohort_cycle_id, me.id);
    if (!founders.some((f) => Number(f.user_id) === founderId)) {
      return refuse(c, 404, { code: 'founder_not_in_cohort', message: 'This founder is not in your cohort.' });
    }
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO investor_cohort_intro_requests (uid, grant_id, investor_user_id, founder_user_id, cohort_cycle_id, message)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (grant_id, founder_user_id) DO NOTHING`,
    ).bind(uid, grant.id, me.id, founderId, grant.cohort_cycle_id, message).run();
    if (!(Number(ins.meta?.changes) > 0)) {
      return refuse(c, 409, { code: 'already_requested', message: 'You have already asked this founder for an introduction.' });
    }
    const name = me.firm ? `${me.name || 'An investor'} (${me.firm})` : (me.name || 'An investor');
    await notify(c.env, {
      userId: founderId,
      type: NOTICE_TYPE,
      category: 'privacy',
      title: `${name} asks for an introduction`,
      body: `${name} has access to your Spin-Out Lab cohort and would like an introduction. You can accept or decline; your email address is not shared unless you accept and write to them.`,
      link: NOTICE_LINK,
      payload: { kind: 'intro_requested', intro_uid: uid, investor_user_id: me.id },
    });
    return c.json({ intro: { uid, founder_user_id: founderId, state: 'pending' } }, 201);
  } catch (e) { return mapError(c, e); }
});

r.get('/founder/access', async (c) => {
  try {
    const user = await requireAuth(c);
    try { await syncInvestorCohortNotices(c.env, { founderUserId: user.id }); } catch (e) {
      console.error('[investor-cohorts] founder notice sweep failed', (e as Error)?.name);
    }
    return c.json({ items: await founderInvestorAccess(c.env, user.id) });
  } catch (e) { return mapError(c, e); }
});

r.put('/founder/access/:investorUserId', async (c) => {
  try {
    const user = await requireAuth(c);
    const raw = c.req.param('investorUserId');
    if (!/^[1-9][0-9]{0,14}$/.test(raw)) return refuse(c, 400, { code: 'invalid_investor', message: 'investorUserId is a user id.' });
    const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
    if (typeof b.visible !== 'boolean') return refuse(c, 400, { code: 'invalid_visible', message: 'visible is true or false.' });
    const ok = await setFounderVisibility(c.env, user.id, Number(raw), b.visible);
    if (!ok) return refuse(c, 404, { code: 'investor_not_found', message: 'That investor has no access to a cohort you are in.' });
    // Showing again may make a start notice owed (none is sent while hidden).
    if (b.visible) {
      try { await syncInvestorCohortNotices(c.env, { founderUserId: user.id }); } catch { /* the nightly sweep retries */ }
    }
    return c.json({ items: await founderInvestorAccess(c.env, user.id) });
  } catch (e) { return mapError(c, e); }
});

r.get('/founder/intros', async (c) => {
  try {
    const user = await requireAuth(c);
    const res = await c.env.DB.prepare(
      `SELECT i.uid, i.message, i.created_at, i.decided_at, i.decision, i.investor_user_id,
              u.name AS investor_name, u.email AS investor_email, p.firm_name AS firm, c.year, c.month
         FROM investor_cohort_intro_requests i
         LEFT JOIN users u ON u.id = i.investor_user_id
         LEFT JOIN investor_profiles p ON p.user_id = i.investor_user_id
         LEFT JOIN cohort_cycles c ON c.id = i.cohort_cycle_id
        WHERE i.founder_user_id = ?
        ORDER BY i.created_at DESC, i.id DESC LIMIT 100`,
    ).bind(user.id).all<any>();
    return c.json({
      items: (res.results || []).map((i: any) => ({
        uid: i.uid,
        investor: {
          id: Number(i.investor_user_id), name: i.investor_name ?? null, firm: i.firm ?? null,
          // The founder writes first, so the address is theirs only once they accept.
          email: i.decision === 'accepted' ? i.investor_email ?? null : null,
        },
        cohort_label: cohortLabel(i.year, i.month),
        message: i.message ?? null,
        created_at: i.created_at,
        state: i.decision ?? 'pending',
        decided_at: i.decided_at ?? null,
      })),
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/founder/intros/:uid/decide', async (c) => {
  try {
    const user = await requireAuth(c);
    const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
    if (typeof b.accepted !== 'boolean') return refuse(c, 400, { code: 'invalid_decision', message: 'accepted is true or false.' });
    const uid = c.req.param('uid');
    const row = await c.env.DB.prepare(
      'SELECT id, investor_user_id FROM investor_cohort_intro_requests WHERE uid = ? AND founder_user_id = ?',
    ).bind(uid, user.id).first<{ id: number; investor_user_id: number }>();
    if (!row) return refuse(c, 404, { code: 'intro_not_found', message: 'No such introduction request.' });
    const decision = b.accepted ? 'accepted' : 'declined';
    const upd = await c.env.DB.prepare(
      `UPDATE investor_cohort_intro_requests SET decided_at = datetime('now'), decision = ? WHERE id = ? AND decided_at IS NULL`,
    ).bind(decision, row.id).run();
    if (!(Number(upd.meta?.changes) > 0)) {
      return refuse(c, 409, { code: 'already_decided', message: 'You have already answered this request, so nothing changed.' });
    }
    const founderName = (await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(user.id).first<{ name: string | null }>())?.name?.trim() || 'The founder';
    await notify(c.env, {
      userId: row.investor_user_id,
      type: NOTICE_TYPE,
      category: 'privacy',
      title: b.accepted ? `${founderName} accepted your introduction request` : `${founderName} declined your introduction request`,
      body: b.accepted
        ? `${founderName} has your contact details and will write to you.`
        : `${founderName} declined your introduction request in your Spin-Out Lab cohort.`,
      link: '/dashboard',
      payload: { kind: `intro_${decision}`, intro_uid: uid },
    });
    return c.json({ intro: { uid, state: decision } });
  } catch (e) { return mapError(c, e); }
});

export default r;

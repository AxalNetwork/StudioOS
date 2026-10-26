/**
 * D959 (#2792, Programs part 6) — Investor cohort access, the admin's side:
 * PG11's table and tiles and PG11d's Give an investor access. Mounted at
 * `/api/admin/investor-cohorts`. Part 10 (#2796) draws the page.
 *
 *   GET  /assignable?q=&cycle_id=&limit=&offset=   verified investors, by name or fund
 *   GET  /?q=&cycle_id=&nda=&state=&limit=&offset=  the grants, newest first
 *   GET  /summary                                   PG11's four tiles
 *   POST /           { investor_user_id, cohort_cycle_id, ends_at, scope?, note? }
 *   POST /:uid/end   ends an open grant
 *   POST /:uid/nda   sends the cohort NDA from HQ's template (O-NDA B)
 *
 * Every route takes `requireAdmin`; the writes also take the branch gate
 * (`requireBranchNotSuspended`, S-GATE). Each write records its decision in the
 * admin audit (`logAdminAction`), which Programs' Activity tab reads
 * (`services/programActivity.ts`). Who is verified is read again on every list
 * and write (O-VER A), never kept from the grant.
 *
 * The program grant gate (`programRefusal`) does not apply: Investor cohorts
 * is not in `ENFORCED_PROGRAMS`, because no branch holds it (D959 §3).
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireBranchNotSuspended } from '../auth';
import { refuse } from '../util/refusal';
import { likeNeedleLower } from '../util/likeSearch';
import { logAdminAction } from '../services/adminAudit';
import { activeTemplate } from '../services/legalTemplateStore';
import { applyMergeFields } from '../services/mergeFields';
import { mapError, newUid } from './_t13t14t15_helpers';
import {
  COHORT_NDA_DOC_TYPE, COHORT_NDA_SLUG, GRANT_STATES, NDA_STATES, NOTE_MAX,
  cohortLabel, expireGrants, isVerifiedInvestor, ndaStateOf, parseScope, scopeOf,
  syncInvestorCohortNotices, todayUtc, validEndDate, type GrantRow,
} from '../services/investorCohortAccess';

const r = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

export const INVESTOR_COHORT_ACTIONS = {
  granted: 'investor_cohort.granted',
  ended: 'investor_cohort.ended',
  ndaSent: 'investor_cohort.nda_sent',
} as const;

/** An envelope in one of these states can be replaced by a new send. */
const ENVELOPE_DEAD = new Set(['void', 'rejected']);

const PAGE_MAX = 100;

function page(c: C): { limit: number; offset: number } | null {
  const rawLimit = c.req.query('limit');
  const rawOffset = c.req.query('offset');
  const limit = rawLimit === undefined || rawLimit === '' ? 25 : Number(rawLimit);
  const offset = rawOffset === undefined || rawOffset === '' ? 0 : Number(rawOffset);
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX || !Number.isInteger(offset) || offset < 0) return null;
  return { limit, offset };
}

const badPage = (c: C) => refuse(c, 400, { code: 'bad_page', message: `limit is a whole number from 1 to ${PAGE_MAX}, and offset a whole number from 0.` });

const intId = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);
const queryId = (v: string | undefined): number | null | undefined =>
  v === undefined || v === '' ? undefined : /^[1-9][0-9]{0,14}$/.test(v) ? Number(v) : null;

/** Whether HQ's cohort NDA template is published; `unreadable` when the store cannot be read. */
async function ndaTemplate(env: Env): Promise<'published' | 'missing' | 'unreadable'> {
  try { return (await activeTemplate(env, COHORT_NDA_SLUG)) ? 'published' : 'missing'; } catch (e) {
    console.warn('[investor-cohorts] nda template unreadable', (e as Error)?.name);
    return 'unreadable';
  }
}

/**
 * The grants with their computed state, as one fixed statement every list and
 * count reads from. `?1` is today. No value is ever spliced into this text.
 */
const GRANTS = `SELECT g.id, g.uid, g.investor_user_id, g.cohort_cycle_id, g.granted_at, g.ends_at, g.ended_at, g.end_reason,
       g.note, g.scope_json, g.nda_envelope_uuid, g.nda_sent_at, g.nda_signed_at,
       u.name AS investor_name, u.email AS investor_email, p.firm_name AS firm, c.year, c.month,
       CASE WHEN (lower(u.role) = 'investor' AND u.is_active = 1 AND u.kyc_status = 'approved') THEN 1 ELSE 0 END AS verified,
       CASE WHEN g.ended_at IS NOT NULL OR g.ends_at < ?1 THEN 'ended'
            WHEN NOT (lower(u.role) = 'investor' AND u.is_active = 1 AND u.kyc_status = 'approved') THEN 'waits_for_verification'
            WHEN g.nda_signed_at IS NULL THEN 'waits_for_nda'
            ELSE 'active' END AS state,
       CASE WHEN g.nda_signed_at IS NOT NULL THEN 'signed' WHEN g.nda_envelope_uuid IS NOT NULL THEN 'sent' ELSE 'not_sent' END AS nda_state,
       (SELECT COUNT(*) FROM investor_cohort_intro_requests i WHERE i.grant_id = g.id) AS intro_requests,
       (SELECT COUNT(*) FROM investor_cohort_intro_requests i WHERE i.grant_id = g.id AND i.decision = 'accepted') AS intros_accepted
  FROM investor_cohort_access g
  LEFT JOIN users u ON u.id = g.investor_user_id
  LEFT JOIN investor_profiles p ON p.user_id = g.investor_user_id
  LEFT JOIN cohort_cycles c ON c.id = g.cohort_cycle_id`;

const FILTER = ` WHERE (?2 IS NULL OR x.cohort_cycle_id = ?2) AND (?3 IS NULL OR x.nda_state = ?3) AND (?4 IS NULL OR x.state = ?4)
   AND (?5 IS NULL OR lower(COALESCE(x.investor_name, '')) LIKE ?5 ESCAPE '\\' OR lower(COALESCE(x.firm, '')) LIKE ?5 ESCAPE '\\')`;

function grantView(x: any) {
  return {
    uid: x.uid,
    investor: { id: Number(x.investor_user_id), name: x.investor_name ?? null, email: x.investor_email ?? null, firm: x.firm ?? null },
    verified_now: Number(x.verified) === 1,
    cohort: { id: Number(x.cohort_cycle_id), label: cohortLabel(x.year, x.month) },
    state: x.state,
    nda_state: x.nda_state,
    scope: scopeOf(x.scope_json),
    note: x.note ?? null,
    intro_requests: Number(x.intro_requests) || 0,
    intros_accepted: Number(x.intros_accepted) || 0,
    granted_at: x.granted_at,
    ends_at: x.ends_at,
    ended_at: x.ended_at ?? null,
    end_reason: x.end_reason ?? null,
  };
}

async function grantByUid(env: Env, uid: string, today: string) {
  return env.DB.prepare(GRANTS + ' WHERE g.uid = ?2').bind(today, uid).first<any>();
}

r.get('/assignable', async (c) => {
  try {
    await requireAdmin(c);
    const pg = page(c);
    if (!pg) return badPage(c);
    const cycleId = queryId(c.req.query('cycle_id'));
    if (cycleId === null) return refuse(c, 400, { code: 'bad_cycle_id', message: 'cycle_id is a cohort cycle id.' });
    const raw = c.req.query('q');
    const needle = raw === undefined || raw === '' ? null : likeNeedleLower(raw);
    if (raw && needle === null) return refuse(c, 400, { code: 'query_too_short', message: 'Search with at least 2 characters.' });
    const today = todayUtc();
    const where = `FROM users u LEFT JOIN investor_profiles p ON p.user_id = u.id
      WHERE (lower(u.role) = 'investor' AND u.is_active = 1 AND u.kyc_status = 'approved')
        AND (?1 IS NULL OR lower(COALESCE(u.name, '')) LIKE ?1 ESCAPE '\\' OR lower(COALESCE(p.firm_name, '')) LIKE ?1 ESCAPE '\\')`;
    const [rows, total] = await Promise.all([
      c.env.DB.prepare(
        `SELECT u.id, u.name, p.firm_name AS firm,
                CASE WHEN ?2 IS NULL THEN NULL ELSE EXISTS (
                  SELECT 1 FROM investor_cohort_access g
                   WHERE g.investor_user_id = u.id AND g.cohort_cycle_id = ?2 AND g.ended_at IS NULL AND g.ends_at >= ?3) END AS has_open_grant `
          + where + ' ORDER BY lower(COALESCE(u.name, \'\')), u.id LIMIT ?4 OFFSET ?5',
      ).bind(needle, cycleId ?? null, today, pg.limit, pg.offset).all<any>(),
      c.env.DB.prepare('SELECT COUNT(*) AS n ' + where).bind(needle).first<{ n: number }>(),
    ]);
    return c.json({
      items: (rows.results || []).map((x: any) => ({
        id: Number(x.id), name: x.name ?? null, firm: x.firm ?? null,
        ...(cycleId ? { has_open_grant: Number(x.has_open_grant) === 1 } : {}),
      })),
      total: Number(total?.n) || 0,
      ...pg,
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/summary', async (c) => {
  try {
    await requireAdmin(c);
    const today = todayUtc();
    const OPEN = `FROM investor_cohort_access g JOIN users u ON u.id = g.investor_user_id
      WHERE g.ended_at IS NULL AND g.ends_at >= ?1 AND (lower(u.role) = 'investor' AND u.is_active = 1 AND u.kyc_status = 'approved')`;
    const [people, cohorts, intros] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(DISTINCT g.investor_user_id) AS n ' + OPEN).bind(today).first<{ n: number }>(),
      c.env.DB.prepare('SELECT COUNT(DISTINCT g.cohort_cycle_id) AS n ' + OPEN).bind(today).first<{ n: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(decision = 'accepted'), 0) AS accepted, COALESCE(SUM(decided_at IS NULL), 0) AS pending
           FROM investor_cohort_intro_requests`,
      ).first<{ n: number; accepted: number; pending: number }>(),
    ]);
    // A count, never names: founders hiding from an investor who holds an open
    // grant on their cohort today. Null, not 0, when it cannot be read.
    let hidden: number | null = null;
    try {
      const h = await c.env.DB.prepare(
        `SELECT COUNT(DISTINCT o.founder_user_id) AS n
           FROM investor_cohort_optouts o
           JOIN investor_cohort_access g ON g.investor_user_id = o.investor_user_id
           JOIN users u ON u.id = g.investor_user_id
          WHERE o.withdrawn_at IS NULL AND g.ended_at IS NULL AND g.ends_at >= ?1
            AND (lower(u.role) = 'investor' AND u.is_active = 1 AND u.kyc_status = 'approved')
            AND EXISTS (SELECT 1 FROM company_week_status w WHERE w.user_id = o.founder_user_id AND w.cohort_cycle_id = g.cohort_cycle_id)`,
      ).bind(today).first<{ n: number }>();
      hidden = Number(h?.n) || 0;
    } catch (e) { console.error('[investor-cohorts] hidden founders unreadable', (e as Error)?.name); }
    return c.json({
      investors_with_access: Number(people?.n) || 0,
      cohorts_open: Number(cohorts?.n) || 0,
      founders_hidden: hidden,
      intro_requests: Number(intros?.n) || 0,
      intros_accepted: Number(intros?.accepted) || 0,
      intros_pending: Number(intros?.pending) || 0,
      nda_template: await ndaTemplate(c.env),
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/', async (c) => {
  try {
    await requireAdmin(c);
    const pg = page(c);
    if (!pg) return badPage(c);
    const cycleId = queryId(c.req.query('cycle_id'));
    if (cycleId === null) return refuse(c, 400, { code: 'bad_cycle_id', message: 'cycle_id is a cohort cycle id.' });
    const nda = c.req.query('nda') || null;
    if (nda && !(NDA_STATES as readonly string[]).includes(nda)) return refuse(c, 400, { code: 'bad_nda', message: `nda is one of ${NDA_STATES.join(', ')}.` });
    const state = c.req.query('state') || null;
    if (state && !(GRANT_STATES as readonly string[]).includes(state)) return refuse(c, 400, { code: 'bad_state', message: `state is one of ${GRANT_STATES.join(', ')}.` });
    const raw = c.req.query('q');
    const needle = raw === undefined || raw === '' ? null : likeNeedleLower(raw);
    if (raw && needle === null) return refuse(c, 400, { code: 'query_too_short', message: 'Search with at least 2 characters.' });
    const today = todayUtc();
    const binds = [today, cycleId ?? null, nda, state, needle];
    const [rows, total] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM (' + GRANTS + ') x' + FILTER + ' ORDER BY x.granted_at DESC, x.id DESC LIMIT ?6 OFFSET ?7')
        .bind(...binds, pg.limit, pg.offset).all<any>(),
      c.env.DB.prepare('SELECT COUNT(*) AS n FROM (' + GRANTS + ') x' + FILTER).bind(...binds).first<{ n: number }>(),
    ]);
    return c.json({ items: (rows.results || []).map(grantView), total: Number(total?.n) || 0, ...pg });
  } catch (e) { return mapError(c, e); }
});

r.post('/', async (c) => {
  try {
    const admin = await requireAdmin(c);
    await requireBranchNotSuspended(c);
    const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const investorId = intId(b.investor_user_id);
    const cycleId = intId(b.cohort_cycle_id);
    if (!investorId || !cycleId) return refuse(c, 400, { code: 'invalid_ids', message: 'investor_user_id and cohort_cycle_id are whole-number ids.' });
    const today = todayUtc();
    const target = await c.env.DB.prepare('SELECT id, role, is_active, kyc_status FROM users WHERE id = ?')
      .bind(investorId).first<{ id: number; role: string; is_active: number; kyc_status: string | null }>();
    if (!target) return refuse(c, 404, { code: 'user_not_found', message: 'No such user.' });
    if (!isVerifiedInvestor(target)) {
      return refuse(c, 400, { code: 'not_verified', message: 'Only a verified investor can be given a cohort: an investor with an active account and approved KYC.' });
    }
    const cycle = await c.env.DB.prepare('SELECT id FROM cohort_cycles WHERE id = ?').bind(cycleId).first<{ id: number }>();
    if (!cycle) return refuse(c, 404, { code: 'cycle_not_found', message: 'No such cohort.' });
    if (!validEndDate(b.ends_at, today)) {
      return refuse(c, 400, { code: 'invalid_end_date', message: 'ends_at is the last day of access, as YYYY-MM-DD, today or later.' });
    }
    const scope = parseScope(b.scope);
    if (!scope.ok) {
      return scope.code === 'scope_unavailable'
        ? refuse(c, 400, { code: 'scope_unavailable', message: 'Pitch deck and Demo Day have nothing to read yet, so a grant cannot open them.', extra: { scope: scope.asked } })
        : refuse(c, 400, { code: 'invalid_scope', message: 'scope is a list of summary and weekly_progress.' });
    }
    if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') return refuse(c, 400, { code: 'invalid_note', message: 'note is text.' });
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null;
    if (note && note.length > NOTE_MAX) return refuse(c, 400, { code: 'note_too_long', message: `The note is at most ${NOTE_MAX} characters.` });
    // A grant past its last day is closed first, so it never blocks a new one.
    await expireGrants(c.env, today);
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO investor_cohort_access (uid, investor_user_id, cohort_cycle_id, granted_by_admin_id, ends_at, note, scope_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (investor_user_id, cohort_cycle_id) WHERE ended_at IS NULL DO NOTHING`,
    ).bind(uid, investorId, cycleId, admin.id, b.ends_at, note, JSON.stringify(scope.scope)).run();
    if (!(Number(ins.meta?.changes) > 0)) {
      return refuse(c, 409, { code: 'already_active', message: 'This investor already has open access to this cohort, so nothing changed.' });
    }
    const row = await c.env.DB.prepare('SELECT id FROM investor_cohort_access WHERE uid = ?').bind(uid).first<{ id: number }>();
    await logAdminAction(c.env, admin.id, admin.email, INVESTOR_COHORT_ACTIONS.granted, {
      target_user_id: investorId, grant_uid: uid, cohort_cycle_id: cycleId,
    });
    // Founders are told now. Null, not 0, when the sweep failed: nobody knows how many were told.
    let notified: number | null = null;
    try { notified = (await syncInvestorCohortNotices(c.env, { grantId: row!.id, today })).started; } catch (e) {
      console.error('[investor-cohorts] start notices failed', (e as Error)?.name);
    }
    const grant = await grantByUid(c.env, uid, today);
    return c.json({ grant: grantView(grant), founders_notified: notified, nda_template: await ndaTemplate(c.env) }, 201);
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/end', async (c) => {
  try {
    const admin = await requireAdmin(c);
    await requireBranchNotSuspended(c);
    const uid = c.req.param('uid');
    const today = todayUtc();
    await expireGrants(c.env, today);
    const row = await c.env.DB.prepare('SELECT id, investor_user_id, cohort_cycle_id FROM investor_cohort_access WHERE uid = ?')
      .bind(uid).first<{ id: number; investor_user_id: number; cohort_cycle_id: number }>();
    if (!row) return refuse(c, 404, { code: 'grant_not_found', message: 'No such grant.' });
    const upd = await c.env.DB.prepare(
      `UPDATE investor_cohort_access SET ended_at = datetime('now'), ended_by_admin_id = ?, end_reason = 'admin'
        WHERE id = ? AND ended_at IS NULL`,
    ).bind(admin.id, row.id).run();
    if (!(Number(upd.meta?.changes) > 0)) {
      return refuse(c, 409, { code: 'already_ended', message: 'This access has already ended, so nothing changed.' });
    }
    await logAdminAction(c.env, admin.id, admin.email, INVESTOR_COHORT_ACTIONS.ended, {
      target_user_id: row.investor_user_id, grant_uid: uid, cohort_cycle_id: row.cohort_cycle_id,
    });
    let notified: number | null = null;
    try { notified = (await syncInvestorCohortNotices(c.env, { grantId: row.id, today })).ended; } catch (e) {
      console.error('[investor-cohorts] end notices failed', (e as Error)?.name);
    }
    return c.json({ grant: grantView(await grantByUid(c.env, uid, today)), founders_notified: notified });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/nda', async (c) => {
  try {
    const admin = await requireAdmin(c);
    await requireBranchNotSuspended(c);
    const uid = c.req.param('uid');
    const today = todayUtc();
    const g = await c.env.DB.prepare(
      `SELECT g.id, g.investor_user_id, g.cohort_cycle_id, g.ends_at, g.ended_at, g.nda_envelope_uuid, g.nda_signed_at,
              u.name, u.email, u.role, u.is_active, u.kyc_status, p.firm_name AS firm, c.year, c.month
         FROM investor_cohort_access g
         JOIN users u ON u.id = g.investor_user_id
         LEFT JOIN investor_profiles p ON p.user_id = g.investor_user_id
         LEFT JOIN cohort_cycles c ON c.id = g.cohort_cycle_id
        WHERE g.uid = ?`,
    ).bind(uid).first<GrantRow & { name: string | null; email: string | null; role: string; is_active: number; kyc_status: string | null; firm: string | null; year: number | null; month: number | null }>();
    if (!g) return refuse(c, 404, { code: 'grant_not_found', message: 'No such grant.' });
    if (g.ended_at || g.ends_at < today) return refuse(c, 409, { code: 'grant_ended', message: 'This access has ended, so no NDA is sent for it.' });
    if (!isVerifiedInvestor(g)) return refuse(c, 400, { code: 'not_verified', message: 'This investor is not verified now, so no NDA is sent.' });
    if (ndaStateOf(g) === 'signed') return refuse(c, 409, { code: 'already_signed', message: 'The cohort NDA is already signed.' });
    if (g.nda_envelope_uuid) {
      let status: string | null = null;
      try {
        status = (await c.env.DB.prepare('SELECT status FROM esign_envelopes WHERE envelope_uuid = ?')
          .bind(g.nda_envelope_uuid).first<{ status: string }>())?.status ?? null;
      } catch { status = null; }
      if (!status || !ENVELOPE_DEAD.has(status)) {
        return refuse(c, 409, { code: 'already_sent', message: 'The cohort NDA is already out for signature. It is sent again only once that envelope is voided or declined.', extra: { envelope_status: status } });
      }
    }
    let template: { title: string; body: string } | null;
    try { template = await activeTemplate(c.env, COHORT_NDA_SLUG); } catch (e) {
      return refuse(c, 503, { code: 'nda_template_unreadable', message: 'The cohort NDA template could not be read. Nothing was sent.', raw: e, audience: 'admin' });
    }
    if (!template) {
      return refuse(c, 409, { code: 'nda_template_missing', message: `No cohort NDA template is published yet. HQ writes it in the legal template library as ${COHORT_NDA_SLUG}. Nothing was sent.` });
    }
    const body = applyMergeFields(template.body, {
      investor_name: g.name ?? '', firm_name: g.firm ?? '', cohort: cohortLabel(g.year, g.month), ends_at: g.ends_at,
    });
    const { createAndSendEnvelope, UnfilledFieldsError } = await import('./esign');
    let sent: Awaited<ReturnType<typeof createAndSendEnvelope>>;
    try {
      sent = await createAndSendEnvelope(c.env, {
        adminUserId: admin.id,
        adminName: admin.name || admin.email,
        recipientUserId: g.investor_user_id,
        recipientEmail: String(g.email || ''),
        recipientName: g.name || String(g.email || ''),
        documentType: COHORT_NDA_DOC_TYPE,
        dealId: g.id,
        appUrl: c.env.APP_URL || 'https://axal.vc',
        viaProvider: 'native',
        renderedBody: { title: template.title, body },
        templateVersion: null,
      });
    } catch (e) {
      if (e instanceof UnfilledFieldsError) {
        return refuse(c, 409, { code: 'nda_template_unfilled', message: 'The cohort NDA template has a field this send cannot fill. Nothing was sent.', extra: { fields: e.fields } });
      }
      throw e;
    }
    if (!sent) return refuse(c, 502, { code: 'envelope_send_failed', message: 'The cohort NDA could not be created or sent. Nothing was recorded.' });
    await c.env.DB.prepare(
      `UPDATE investor_cohort_access SET nda_envelope_uuid = ?, nda_sent_at = datetime('now') WHERE id = ? AND nda_signed_at IS NULL`,
    ).bind(sent.envelope_uuid, g.id).run();
    await logAdminAction(c.env, admin.id, admin.email, INVESTOR_COHORT_ACTIONS.ndaSent, {
      target_user_id: g.investor_user_id, grant_uid: uid, cohort_cycle_id: g.cohort_cycle_id,
    });
    return c.json({ grant: grantView(await grantByUid(c.env, uid, today)), envelope: { uuid: sent.envelope_uuid, email_sent: sent.email_sent } });
  } catch (e) { return mapError(c, e); }
});

export default r;

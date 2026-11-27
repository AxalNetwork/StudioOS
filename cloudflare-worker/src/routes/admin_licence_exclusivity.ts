/**
 * D5019 (#5019) — a licence's territorial exclusivity and development
 * commitments, apart from its operating fee. Super Admin, HQ only; every write
 * takes the write bar and a reason, and is audited.
 *
 *   GET  /api/admin/licences/:uid/exclusivity                         the operating licence, the current exclusivity and its
 *                                                                     versions, each target year's progress, reviews, agreement match
 *   PUT  /api/admin/licences/:uid/exclusivity                         write the next version (expected_revision; overlap rules)
 *   POST /api/admin/licences/:uid/exclusivity/observations            record a measured figure; a missed target opens a review
 *   POST /api/admin/licences/:uid/exclusivity/reviews                 open a review by hand
 *   POST /api/admin/licences/:uid/exclusivity/reviews/:rid/preview    what an action would do (writes nothing)
 *   POST /api/admin/licences/:uid/exclusivity/reviews/:rid/resolve    take the action (reason, the consequence acknowledged)
 *   GET  /api/admin/territory-regions                                 named sub-territories and multi-country regions
 *   POST /api/admin/territory-regions                                 record one (write bar, reason)
 *
 * NOTHING REVOKES ITSELF: a missed target marks the exclusivity at risk and
 * opens a review; only HQ's action changes the territory or ends it. A change
 * to a contractual exclusivity never touches an executed agreement; the read
 * says the agreement no longer matches until a replacement is instantiated.
 */
import { Hono, type Context } from 'hono';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import type { Env } from '../types';
import { mapError, nowIso } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import { byUid, logEvent, type LicenceRow } from '../services/licenceLedgerCore';
import { readLicenceTerms } from '../services/licenceTerms';
import { currentContract, territoryOf } from '../services/licencePricingApply';
import adminLicences from './admin_licences';
import type { RouteMount } from '../util/routeRegistry';
import { decisionGuard, runDecision } from '../services/decisionBatch';
import {
  ACTIONS, METRICS, ExclusivityError, allRegions, countriesOfScope, currentTerms, getReview, observationsFor, openReviewStatement,
  overlapProblems, previewAction, progressOf, reviewsFor, termsHistory, validateTermsBody, writeVersion, versionStatements,
  type Action, type Territory,
} from '../services/licenceExclusivity';
import { isIsoDay } from '../services/licenceTerms';

type C = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();
const regionsRouter = new Hono<{ Bindings: Env }>();
const actorOf = (u: { id: number }) => `user:${u.id}`;
const today = () => new Date().toISOString().slice(0, 10);

function answer(c: C, e: unknown) {
  if (e instanceof ExclusivityError) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: e.extra });
  return mapError(c, e);
}
const reasonOf = (b: Record<string, unknown> | null) => {
  const s = typeof b?.reason === 'string' ? b.reason.trim() : '';
  return s.length >= 3 && s.length <= 500 ? s : null;
};
const noReason = (c: C) => refuse(c, 400, { code: 'reason_required', message: 'Say why, in 3 to 500 characters.' });
const notFound = (c: C) => refuse(c, 404, { code: 'not_found', message: 'No licence with that id.' });

/** The agreement against the exclusivity: a contractual version newer than the current contract means it may no longer match. */
async function agreementOf(c: C, licenceUid: string) {
  let contract: Awaited<ReturnType<typeof currentContract>>;
  try { contract = await currentContract(c.env, licenceUid); } catch { return { state: 'unreadable' as const, reason: 'The licence contract store could not be read just now.' }; }
  if (!contract) return { state: 'none' as const, reason: 'No agreement has been instantiated for this licence.' };
  const later = await c.env.DB.prepare(
    'SELECT revision FROM licence_exclusivity_terms WHERE licence_uid = ? AND contractual = 1 AND revision > 1 AND created_at > ? ORDER BY revision DESC LIMIT 1',
  ).bind(licenceUid, contract.created_at).first<{ revision: number }>();
  return later
    ? { state: 'mismatch' as const, contract_status: contract.status, reason: `Exclusivity version ${later.revision} changed after the agreement was drawn, so it may no longer match. Instantiate the replacement agreement on the Contract tab; the current one is not edited.` }
    : { state: 'matches' as const, contract_status: contract.status, reason: null };
}

r.get('/:uid/exclusivity', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return notFound(c);
    const [cur, history, obs, reviews, regions, territory] = await Promise.all([
      currentTerms(c.env, licence.uid), termsHistory(c.env, licence.uid), observationsFor(c.env, licence.uid),
      reviewsFor(c.env, licence.uid), allRegions(c.env), territoryOf(c.env, licence.id),
    ]);
    let scheduleExclusive: number | null | 'unreadable' = null;
    // D5019 part 2: the operating licence's minimum is the terms schedule's Minimum Guarantee (§4.4), read with it.
    let minimumGuarantee: number | null | 'unreadable' = null;
    try {
      const schedule = (await readLicenceTerms(c.env, licence.uid))?.terms;
      scheduleExclusive = (schedule?.exclusive ?? null) as number | null;
      minimumGuarantee = typeof schedule?.minimum_guarantee_cents === 'number' ? schedule.minimum_guarantee_cents : null;
    } catch { scheduleExclusive = 'unreadable'; minimumGuarantee = 'unreadable'; }
    // The structure both ways: the children this master lists, and the master that lists this licence.
    const parentRow = await c.env.DB.prepare(
      `SELECT t.licence_uid, l.licence_ref FROM licence_exclusivity_terms t JOIN territory_licences l ON l.uid = t.licence_uid
        WHERE t.superseded_at IS NULL AND t.scope_type = 'master_franchise' AND EXISTS (SELECT 1 FROM json_each(t.child_licences_json) WHERE value = ?)`,
    ).bind(licence.uid).first<Record<string, any>>();
    const children = cur && cur.child_licence_uids.length
      ? ((await c.env.DB.prepare('SELECT uid, licence_ref FROM territory_licences WHERE uid IN (SELECT value FROM json_each(?))')
        .bind(JSON.stringify(cur.child_licence_uids)).all<Record<string, any>>()).results || []).map((x) => ({ licence_uid: String(x.uid), licence_ref: String(x.licence_ref) }))
      : [];
    const exclusive = !!cur && cur.scope_type !== 'non_exclusive' && ['in_force', 'at_risk'].includes(cur.state);
    return c.json({
      licence_uid: licence.uid,
      // The operating licence, which exclusivity does not change.
      operating: {
        territory, annual_fee_cents: licence.annual_fee_cents ?? null, revenue_share_bps: licence.revenue_share_bps ?? null,
        currency: licence.currency ?? null,
        // null: the schedule records no minimum (never 0); 'unreadable': the schedule could not be read just now.
        minimum_guarantee_cents: minimumGuarantee,
      },
      exclusivity: cur,
      exclusivity_reason: cur ? null : 'No exclusivity is recorded: the licence is non-exclusive. Paying the licence fee grants none.',
      reach: cur ? countriesOfScope(cur.territory, regions) : [],
      progress: cur ? progressOf(cur.targets, obs, today()) : [],
      observations: obs.slice(-50).reverse(),
      next_review_on: cur?.cure_until ?? cur?.review_on ?? null,
      reviews,
      history: history.map((h) => ({ revision: h.revision, scope_type: h.scope_type, state: h.state, territory: h.territory, reason: h.reason, created_at: h.created_at, created_by: h.created_by })),
      children,
      master: parentRow ? { licence_uid: String(parentRow.licence_uid), licence_ref: String(parentRow.licence_ref) } : null,
      // The terms schedule's own "Exclusive territory" (§2.1) against this record; a disagreement is said, never fixed by itself.
      schedule: scheduleExclusive === 'unreadable'
        ? { exclusive: null, matches: null, reason: 'The terms schedule could not be read just now.' }
        : { exclusive: scheduleExclusive === null ? null : scheduleExclusive === 1, matches: scheduleExclusive === null ? null : (scheduleExclusive === 1) === exclusive,
          reason: scheduleExclusive === null ? 'The terms schedule does not record whether the territory is exclusive.' : (scheduleExclusive === 1) === exclusive ? null : 'The terms schedule\'s "Exclusive territory" disagrees with this record. Update one of them.' },
      agreement: await agreementOf(c, licence.uid),
      regions,
    });
  } catch (e) { return answer(c, e); }
});

r.put('/:uid/exclusivity', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return notFound(c);
    if (licence.status === 'terminated') return refuse(c, 409, { code: 'licence_terminated', message: 'A terminated licence holds no exclusivity.' });
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const expected = body?.expected_revision;
    if (!(typeof expected === 'number' && Number.isSafeInteger(expected) && expected >= 0)) {
      return refuse(c, 400, { code: 'expected_revision_required', message: 'Name the exclusivity revision you read (expected_revision; 0 when none is recorded).' });
    }
    const v = validateTermsBody(body);
    if (!v.ok) return refuse(c, 400, { code: v.errors.reason ? 'reason_required' : 'invalid_exclusivity', message: 'The exclusivity has fields to fix.', extra: { fields: v.errors } });
    const problems = await overlapProblems(c.env, licence, v.value);
    if (problems.length) return refuse(c, 409, { code: 'territory_overlap', message: problems.join(' '), extra: { problems } });
    const before = await currentTerms(c.env, licence.uid);
    // A contractual change to a licence that has an agreement is acknowledged first: the agreement is never edited.
    let contract: Awaited<ReturnType<typeof currentContract>> = null;
    try { contract = await currentContract(c.env, licence.uid); } catch { contract = null; }
    if (before && v.value.contractual && contract && body?.acknowledge_agreement_mismatch !== true) {
      return refuse(c, 409, { code: 'agreement_ack_required', message: `The licence has an agreement (${contract.status}) that states its exclusivity. Acknowledge that it may no longer match; it is not edited, and a replacement is instantiated on the Contract tab.` });
    }
    const terms = await writeVersion(c.env, { licenceUid: licence.uid, expectedRevision: expected, next: v.value, uid: crypto.randomUUID(), actor: actorOf(admin), now: nowIso() });
    await logEvent(c.env, licence.id, 'terms_changed', admin.id, { source: 'exclusivity', revision: terms.revision, scope_type: terms.scope_type, reason: v.value.reason }, v.value.reason,
      { before: before ? { scope_type: before.scope_type, territory: before.territory, state: before.state } : null, after: { scope_type: terms.scope_type, territory: terms.territory, state: terms.state } });
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_exclusivity_set', { licence_uid: licence.uid, revision: terms.revision, scope_type: terms.scope_type, territory: terms.territory, reason: v.value.reason });
    return c.json({ exclusivity: terms }, before ? 200 : 201);
  } catch (e) { return answer(c, e); }
});

r.post('/:uid/exclusivity/observations', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return notFound(c);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const reason = reasonOf(body);
    if (!reason) return noReason(c);
    const metric = body?.metric;
    const errors: Record<string, string> = {};
    if (typeof metric !== 'string' || !(METRICS as readonly string[]).includes(metric)) errors.metric = `must be one of ${METRICS.join(', ')}`;
    if (!isIsoDay(body?.period_start) || !isIsoDay(body?.period_end) || (body!.period_end as string) < (body!.period_start as string)) errors.period = 'needs a real period_start and a period_end on or after it';
    const value = body?.value;
    if (!(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) errors.value = 'must be a whole number, not negative';
    const source = typeof body?.source === 'string' ? body.source.trim().slice(0, 200) : '';
    if (source.length < 2) errors.source = 'say where the figure comes from';
    const supersedes = typeof body?.supersedes_uid === 'string' ? body.supersedes_uid : null;
    if (Object.keys(errors).length) return refuse(c, 400, { code: 'invalid_observation', message: 'The observation has fields to fix.', extra: { fields: errors } });
    const now = nowIso();
    const uid = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO licence_performance_observations (uid, licence_uid, metric, period_start, period_end, value, source, note, supersedes_uid, recorded_at, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, licence.uid, metric, body!.period_start, body!.period_end, value, source, reason, supersedes, now, actorOf(admin)).run();
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_performance_observed', { licence_uid: licence.uid, metric, value, period_start: body!.period_start, period_end: body!.period_end, source, reason });
    // A completed year that missed its target opens an HQ review and marks the exclusivity at risk — and nothing more.
    const cur = await currentTerms(c.env, licence.uid);
    let review: unknown = null;
    if (cur && cur.state === 'in_force' && cur.scope_type !== 'non_exclusive') {
      const missed = progressOf(cur.targets, await observationsFor(c.env, licence.uid), today()).filter((p) => p.status === 'missed');
      const open = (await reviewsFor(c.env, licence.uid)).some((x) => x.state === 'open');
      if (missed.length && !open) {
        const termsUid = crypto.randomUUID();
        const reviewUid = crypto.randomUUID();
        const run = await runDecision(c.env, versionStatements(c.env, {
          licenceUid: licence.uid, expectedRevision: cur.revision, uid: termsUid, actor: actorOf(admin), now,
          next: { ...cur, state: 'at_risk', reason: `Development target missed (year ${missed.map((m) => m.year).join(', ')}); HQ review opened.` },
          extra: [openReviewStatement(c.env, { uid: reviewUid, licenceUid: licence.uid, termsUid, trigger: 'target_missed', detail: { years: missed.map((m) => m.year), metrics: missed.flatMap((m) => m.metrics.filter((x) => x.met === false)) }, actor: actorOf(admin), now })],
        }));
        if (!run.lost) {
          review = await getReview(c.env, reviewUid);
          await logAdminAction(c.env, admin.id, admin.email || '', 'licence_exclusivity_review_opened', { licence_uid: licence.uid, review_uid: reviewUid, trigger: 'target_missed', years: missed.map((m) => m.year) });
        }
      }
    }
    return c.json({ observation: { uid, metric, value }, review_opened: review, exclusivity_changed: false }, 201);
  } catch (e) { return answer(c, e); }
});

r.post('/:uid/exclusivity/reviews', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return notFound(c);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const reason = reasonOf(body);
    if (!reason) return noReason(c);
    const cur = await currentTerms(c.env, licence.uid);
    if (!cur || cur.scope_type === 'non_exclusive' || !['in_force', 'at_risk'].includes(cur.state)) {
      return refuse(c, 409, { code: 'nothing_to_review', message: 'This licence holds no exclusivity in force to review.' });
    }
    const uid = crypto.randomUUID();
    const res = await openReviewStatement(c.env, { uid, licenceUid: licence.uid, termsUid: cur.uid, trigger: body?.trigger === 'review_date' ? 'review_date' : 'hq', detail: { reason }, actor: actorOf(admin), now: nowIso() }).run();
    if (Number(res?.meta?.changes ?? 0) !== 1) return refuse(c, 409, { code: 'review_open', message: 'This licence already has an open exclusivity review.' });
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_exclusivity_review_opened', { licence_uid: licence.uid, review_uid: uid, trigger: 'hq', reason });
    return c.json({ review: await getReview(c.env, uid) }, 201);
  } catch (e) { return answer(c, e); }
});

async function reviewTarget(c: C) {
  const licence = await byUid(c.env, String(c.req.param('uid') ?? ''));
  if (!licence) return { refused: notFound(c) };
  const review = await getReview(c.env, String(c.req.param('rid') ?? ''));
  if (!review || review.licence_uid !== licence.uid) return { refused: refuse(c, 404, { code: 'review_not_found', message: 'No exclusivity review with that id for this licence.' }) };
  if (review.state !== 'open') return { refused: refuse(c, 409, { code: 'review_closed', message: 'This review is already closed.' }) };
  const cur = await currentTerms(c.env, licence.uid);
  if (!cur) return { refused: refuse(c, 409, { code: 'nothing_to_review', message: 'This licence holds no exclusivity.' }) };
  return { licence, review, cur };
}

function actionOf(body: Record<string, unknown> | null): { action: Action; params: { territory?: Territory; cure_period_days?: number | null } } | null {
  const a = body?.action;
  if (typeof a !== 'string' || !(ACTIONS as readonly string[]).includes(a)) return null;
  const t = body?.territory as Record<string, unknown> | undefined;
  const territory = t && typeof t === 'object' ? {
    countries: (Array.isArray(t.countries) ? t.countries : []).map((x) => String(x ?? '').trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)).sort(),
    regions: (Array.isArray(t.regions) ? t.regions : []).map((x) => String(x ?? '').trim().toUpperCase()).filter((x) => /^[A-Z0-9-]{2,40}$/.test(x)).sort(),
  } : undefined;
  const days = body?.cure_period_days;
  return { action: a as Action, params: { territory, cure_period_days: typeof days === 'number' && Number.isInteger(days) && days > 0 && days <= 3650 ? days : null } };
}

r.post('/:uid/exclusivity/reviews/:rid/preview', async (c) => {
  try {
    await requireSuperAdmin(c);
    const t = await reviewTarget(c);
    if ('refused' in t) return t.refused;
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const a = actionOf(body);
    if (!a) return refuse(c, 400, { code: 'invalid_action', message: `action is one of ${ACTIONS.join(', ')}.` });
    const p = previewAction(t.cur, a.action, a.params, today(), await allRegions(c.env));
    if (!p.ok) return refuse(c, 400, { code: p.code, message: p.sentence });
    return c.json({ action: a.action, consequence: p.consequence, next: { scope_type: p.next.scope_type, territory: p.next.territory, state: p.next.state, ends_on: p.next.ends_on, cure_until: p.next.cure_until }, stored: false });
  } catch (e) { return answer(c, e); }
});

r.post('/:uid/exclusivity/reviews/:rid/resolve', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const t = await reviewTarget(c);
    if ('refused' in t) return t.refused;
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const reason = reasonOf(body);
    if (!reason) return noReason(c);
    const a = actionOf(body);
    if (!a) return refuse(c, 400, { code: 'invalid_action', message: `action is one of ${ACTIONS.join(', ')}.` });
    const expected = body?.expected_revision;
    if (!(typeof expected === 'number' && Number.isSafeInteger(expected) && expected >= 1)) {
      return refuse(c, 400, { code: 'expected_revision_required', message: 'Name the exclusivity revision you read (expected_revision).' });
    }
    if (body?.acknowledge_consequence !== true) return refuse(c, 400, { code: 'consequence_unacknowledged', message: 'Preview the consequence and acknowledge it before taking the action.' });
    const regions = await allRegions(c.env);
    const p = previewAction(t.cur, a.action, a.params, today(), regions);
    if (!p.ok) return refuse(c, 400, { code: p.code, message: p.sentence });
    if (a.action === 'reduce_territory') {
      const problems = await overlapProblems(c.env, t.licence, p.next);
      if (problems.length) return refuse(c, 409, { code: 'territory_overlap', message: problems.join(' ') });
    }
    const now = nowIso();
    const termsUid = crypto.randomUUID();
    const next = { ...p.next, reason: `Review: ${a.action.replace(/_/g, ' ')} — ${reason}` };
    const run = await runDecision(c.env, versionStatements(c.env, {
      licenceUid: t.licence.uid, expectedRevision: expected, uid: termsUid, actor: actorOf(admin), now, next,
      extra: [c.env.DB.prepare(
        `UPDATE licence_exclusivity_reviews SET state = 'resolved', action = ?, resolution_reason = ?, consequence = ?, resulting_terms_uid = ?,
                resolved_at = ?, resolved_by = ?, revision = revision + 1
          WHERE uid = ? AND state = 'open'`,
      ).bind(a.action, reason, p.consequence, termsUid, now, actorOf(admin), t.review.uid), decisionGuard(c.env)],
    }));
    if (run.lost) return refuse(c, 409, { code: 'exclusivity_conflict', message: 'This exclusivity or review changed since you opened it, so nothing was saved. Reload it.' });
    await logEvent(c.env, (t.licence as LicenceRow).id, 'terms_changed', admin.id, { source: 'exclusivity_review', review_uid: t.review.uid, action: a.action, consequence: p.consequence, reason }, reason,
      { before: { scope_type: t.cur.scope_type, territory: t.cur.territory, state: t.cur.state }, after: { scope_type: next.scope_type, territory: next.territory, state: next.state } });
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_exclusivity_review_resolved', { licence_uid: t.licence.uid, review_uid: t.review.uid, action: a.action, consequence: p.consequence, reason });
    return c.json({ review: await getReview(c.env, t.review.uid), exclusivity: await currentTerms(c.env, t.licence.uid), consequence: p.consequence });
  } catch (e) { return answer(c, e); }
});

regionsRouter.get('/', async (c) => {
  try {
    await requireSuperAdmin(c);
    return c.json({ regions: await allRegions(c.env) });
  } catch (e) { return answer(c, e); }
});

regionsRouter.post('/', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const reason = reasonOf(body);
    if (!reason) return noReason(c);
    const id = typeof body?.id === 'string' ? body.id.trim().toUpperCase() : '';
    const kind = body?.kind;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const countries = Array.isArray(body?.countries) ? [...new Set(body!.countries.map((x) => String(x ?? '').trim().toUpperCase()))].sort() : [];
    const parent = typeof body?.parent_region_id === 'string' ? body.parent_region_id.trim().toUpperCase() : null;
    const errors: Record<string, string> = {};
    if (!/^[A-Z0-9-]{2,40}$/.test(id)) errors.id = 'is 2 to 40 characters: A–Z, 0–9 and hyphens';
    if (kind !== 'subnational' && kind !== 'metro' && kind !== 'multi_country') errors.kind = 'is subnational, metro or multi_country';
    if (!name || name.length > 120) errors.name = 'is 1 to 120 characters';
    if (!countries.length || countries.some((x) => !/^[A-Z]{2}$/.test(x))) errors.countries = 'are ISO 3166-1 alpha-2 codes, at least one';
    if (kind !== 'multi_country' && countries.length !== 1) errors.countries = 'a subnational region or metro lies in exactly one country';
    if (Object.keys(errors).length) return refuse(c, 400, { code: 'invalid_region', message: 'The region has fields to fix.', extra: { fields: errors } });
    if (parent) {
      const p = (await allRegions(c.env)).find((x) => x.id === parent);
      if (!p) return refuse(c, 400, { code: 'invalid_region', message: `No region is recorded as ${parent}.` });
      if (countries.some((x) => !p.countries.includes(x))) return refuse(c, 400, { code: 'invalid_region', message: 'A region lies inside its parent\'s countries.' });
    }
    try {
      await c.env.DB.prepare('INSERT INTO territory_regions (id, kind, name, countries_json, parent_region_id, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, kind, name, JSON.stringify(countries), parent, actorOf(admin)).run();
    } catch (e) {
      if (/UNIQUE|PRIMARY|constraint/i.test(String((e as Error)?.message))) return refuse(c, 409, { code: 'region_exists', message: `A region is already recorded as ${id}.` });
      throw e;
    }
    await logAdminAction(c.env, admin.id, admin.email || '', 'territory_region_recorded', { id, kind, countries, parent_region_id: parent, reason });
    return c.json({ region: (await allRegions(c.env)).find((x) => x.id === id) }, 201);
  } catch (e) { return answer(c, e); }
});

export const mount: RouteMount[] = [
  // Ahead of the licence ledger, whose `/:uid` catch-all would otherwise see these paths first.
  { path: '/api/admin/licences', router: r, before: [adminLicences] },
  { path: '/api/admin/territory-regions', router: regionsRouter },
];

export default r;

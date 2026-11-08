/**
 * #4707 — HQ licence routes: commercial terms: territories, seats and terms (incl. the D797 schedule). Mounted by `admin_licences.ts` at
 * `/api/admin/licences`, in the order the routes were declared before the split;
 * moved unchanged, with their original comments.
 */
import { Hono } from 'hono';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError, nowIso } from './_t13t14t15_helpers';
import { pushLicenceToBranch } from '../services/licencePush';
import { DEFAULT_TERM_SECTIONS, LICENCE_TERM_KEYS, parseExpectedRevision, readLicenceTerms, termsDiff, validateCoreTermsBody, validateTermsBody, type LicenceTermsRecord } from '../services/licenceTerms';
import { SEAT_TYPES, ISO2, intOrNull, byUid, logEvent, pushOutcome, seatsOf, countriesOf, type LicenceRow } from '../services/licenceLedgerCore';
import type { Env } from '../types';
import type { LicenceSeatsResult, LicenceTermsResult, LicenceTerritoriesResult } from '../services/licenceContracts';

const r = new Hono<{ Bindings: Env }>();

// Step 2 — territory. Refuses an overlap rather than recording one.
r.put('/:uid/territories', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    if (licence.status === 'terminated') {
      return c.json({ error: 'a terminated licence cannot be given territory' }, 409);
    }
    const b = await c.req.json().catch(() => ({} as any));
    const raw: unknown[] = Array.isArray(b?.countries) ? b.countries : [];
    const normalised: string[] = raw.map((x) => String(x ?? '').trim().toUpperCase());
    // Validate BEFORE de-duplicating: comparing a de-duplicated length against
    // the input length would report ['FR','FR'] — harmless — as an invalid
    // country code, which is a confusing thing to tell someone.
    const bad = normalised.filter((x) => !ISO2.test(x));
    if (bad.length) {
      return c.json({
        error: 'every country must be an ISO 3166-1 alpha-2 code',
        invalid: [...new Set(bad)],
      }, 400);
    }
    const wanted = [...new Set(normalised)];

    // Held by someone ELSE. A licence keeping its own countries is not a
    // conflict, and a suspended holder still counts — suspension does not
    // release territory.
    let conflicts: any[] = [];
    if (wanted.length) {
      const placeholders = wanted.map(() => '?').join(',');
      const held = await c.env.DB.prepare(
        `SELECT lt.country_code, l.licence_ref, l.brand_name, l.status
           FROM licence_territories lt
           JOIN territory_licences l ON l.id = lt.licence_id
          WHERE lt.country_code IN (${placeholders}) AND lt.licence_id != ?`,
      ).bind(...wanted, licence.id).all<any>();
      conflicts = held.results || [];
    }
    if (conflicts.length) {
      return c.json({
        error: 'territory_conflict',
        conflicts,
        message: conflicts.map((x) => `${x.country_code} is held by ${x.licence_ref} (${x.status})`).join('; '),
      }, 409);
    }

    const beforeCountries = await countriesOf(c.env, licence.id);
    const stmts = [
      // #4678: a licence terminated since the read above releases its territory
      // for good; neither statement may take it back.
      c.env.DB.prepare("DELETE FROM licence_territories WHERE licence_id = ? AND EXISTS (SELECT 1 FROM territory_licences WHERE id = ? AND status <> 'terminated')").bind(licence.id, licence.id),
      ...wanted.map((code) => c.env.DB.prepare(
        "INSERT INTO licence_territories (licence_id, country_code, created_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM territory_licences WHERE id = ? AND status <> 'terminated')",
      ).bind(licence.id, code, nowIso(), licence.id)),
      c.env.DB.prepare('UPDATE territory_licences SET revision = revision + 1, updated_at = ? WHERE id = ?')
        .bind(nowIso(), licence.id),
    ];
    // The unique index on country_code is the real guard: if another request
    // claimed a country between the check above and here, this batch fails
    // rather than double-recording it.
    await c.env.DB.batch(stmts);
    // D272 — this changes what the branch's copy holds, so it pushes like
    // every status transition; a push that does not land is retried.
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    await logEvent(c.env, licence.id, 'territory_changed', admin.id, { countries: wanted }, null,
      { before: { countries: beforeCountries }, after: { countries: wanted } }, pushOutcome(pushed));
    return c.json({ ok: true, countries: wanted, pushed } satisfies LicenceTerritoriesResult);
  } catch (e) { return mapError(c, e); }
});

// Step 3 — seats.
r.put('/:uid/seats', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const seats: Record<string, number> = {};
    for (const t of SEAT_TYPES) {
      const n = intOrNull(b?.seats?.[t]);
      if (n !== null && n < 0) return c.json({ error: `${t} seats cannot be negative` }, 400);
      seats[t] = n ?? 0;
    }
    const beforeSeats = await seatsOf(c.env, licence.id);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM licence_seats WHERE licence_id = ? AND EXISTS (SELECT 1 FROM territory_licences WHERE id = ? AND status <> 'terminated')").bind(licence.id, licence.id),
      ...SEAT_TYPES.map((t) => c.env.DB.prepare(
        "INSERT INTO licence_seats (licence_id, seat_type, seats_licensed, created_at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM territory_licences WHERE id = ? AND status <> 'terminated')",
      ).bind(licence.id, t, seats[t], nowIso(), licence.id)),
      c.env.DB.prepare('UPDATE territory_licences SET revision = revision + 1, updated_at = ? WHERE id = ?')
        .bind(nowIso(), licence.id),
    ]);
    // D272 — this changes what the branch's copy holds, so it pushes like
    // every status transition; a push that does not land is retried.
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    await logEvent(c.env, licence.id, 'seats_changed', admin.id, seats, null,
      { before: beforeSeats, after: seats }, pushOutcome(pushed));
    return c.json({ ok: true, seats, pushed } satisfies LicenceSeatsResult);
  } catch (e) { return mapError(c, e); }
});

// Step 4 — commercial terms (D4694).
//
// A MONEY WRITE, SO IT TAKES THE SAME BAR AS THE SCHEDULE'S: a TOTP-minted
// session, a recent step-up, the elevation, and a reason the history keeps.
// ONLY THE KEYS THE BODY NAMES CHANGE (`null` clears one), so an editor that
// sends only what its user touched cannot carry a stale untouched field over a
// newer value. THE WRITE NAMES THE REVISION IT READ (`expected_revision`, the
// licence's `terms_revision`); when another save or a renewal got there first
// it changes no row and answers 409 with the terms as they now stand. Nothing
// is clamped: a share above 10000 basis points is refused.
r.patch('/:uid/terms', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const raw = await c.req.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return c.json({ error: 'invalid_terms', message: 'Send an object of terms.' }, 400);
    const b = raw as Record<string, unknown>;
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
    if (!reason) return c.json({ error: 'reason_required', message: 'Say why the terms change.' }, 400);
    const rev = parseExpectedRevision(b.expected_revision);
    if (!rev.ok) return c.json({ error: 'revision_required', message: rev.message }, 400);
    const v = validateCoreTermsBody(b);
    if (!v.ok) return c.json({ error: 'invalid_terms', message: `${v.errors[0].field} ${v.errors[0].message}.`, errors: v.errors }, 400);
    const keys = Object.keys(v.set) as Array<keyof typeof v.set>;
    if (!keys.length) return c.json({ error: 'nothing_to_change', message: 'Name at least one term to change.' }, 400);
    const coreOf = (l: LicenceRow) => ({
      term_years: l.term_years ?? null, annual_fee_cents: l.annual_fee_cents ?? null, currency: l.currency ?? null,
      revenue_share_bps: l.revenue_share_bps ?? null, token_split_bps: l.token_split_bps ?? null,
      starts_on: l.starts_on ?? null, renews_on: l.renews_on ?? null,
    });
    // READ → MERGE → ONE LITERAL UPDATE, the way every PATCH in this repo is written (no `${}` in `DB.prepare`). Only
    // the named keys differ from the snapshot; the revision guard makes the merge safe, because a write whose snapshot
    // is not the stored revision changes no row.
    const merged = { ...coreOf(licence), ...v.set };
    const res = await c.env.DB.prepare(
      `UPDATE territory_licences
          SET term_years = ?, annual_fee_cents = ?, currency = ?, revenue_share_bps = ?, token_split_bps = ?,
              starts_on = ?, renews_on = ?, terms_revision = terms_revision + 1, revision = revision + 1, updated_at = ?
        WHERE id = ? AND terms_revision = ?`,
    ).bind(merged.term_years, merged.annual_fee_cents, merged.currency, merged.revenue_share_bps, merged.token_split_bps,
      merged.starts_on, merged.renews_on, nowIso(), licence.id, rev.value).run();
    if (Number(res?.meta?.changes ?? 0) !== 1) {
      const now = await byUid(c.env, licence.uid);
      return c.json({
        error: 'terms_conflict',
        message: 'These terms changed since you opened them, so nothing was saved. Reload them and apply your change again.',
        current_revision: now ? Number((now as any).terms_revision ?? 0) : null,
        current: now ? coreOf(now) : null,
      }, 409);
    }
    const beforeTerms = coreOf(licence);
    const after = (await byUid(c.env, licence.uid)) ?? licence;
    const terms = coreOf(after);
    const changed = Object.fromEntries(keys.map((k) => [k, { before: beforeTerms[k], after: terms[k] }]));
    // D272 — this changes what the branch's copy holds, so it pushes like
    // every status transition; a push that does not land is retried.
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    await logEvent(c.env, licence.id, 'terms_changed', admin.id, { reason, changed }, reason,
      { before: beforeTerms, after: terms }, pushOutcome(pushed));
    return c.json({ ok: true, ...terms, terms_revision: Number((after as any).terms_revision ?? 0), changed, pushed } satisfies LicenceTermsResult);
  } catch (e) { return mapError(c, e); }
});


// D4671 — complete the entity and signatory a contract names. A contract whose
// `{{licence.legal_entity_name}}`, address or signatory is still a placeholder
// is refused at send; this is where HQ fills them without reaching for SQL.
// Only the keys sent change. Every value is trimmed, bounded, free of control
// characters and of `{{ }}` (a value that is itself a placeholder would defeat
// the unresolved-field refusal), and a recorded value cannot be blanked.
const ENTITY_FIELDS: Record<string, number> = {
  legal_entity_name: 200, brand_name: 120, registered_address: 500,
  signatory_name: 200, signatory_title: 200,
};
r.patch('/:uid/entity', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!b || typeof b !== 'object') return c.json({ error: 'invalid_body' }, 400);
    const next: Record<string, string> = {};
    for (const [key, max] of Object.entries(ENTITY_FIELDS)) {
      if (!(key in b)) continue;
      const raw = b[key];
      if (typeof raw !== 'string') return c.json({ error: 'invalid_field', field: key, message: `${key} must be text.` }, 400);
      const v = raw.trim();
      if (!v) return c.json({ error: 'invalid_field', field: key, message: `${key} cannot be blank.` }, 400);
      if (v.length > max) return c.json({ error: 'invalid_field', field: key, message: `${key} is at most ${max} characters.` }, 400);
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f]/.test(v) || /\{\{|\}\}/.test(v)) {
        return c.json({ error: 'invalid_field', field: key, message: `${key} has characters a contract cannot carry.` }, 400);
      }
      next[key] = v;
    }
    const keys = Object.keys(next);
    if (!keys.length) return c.json({ error: 'nothing_to_change', message: 'Send at least one of: ' + Object.keys(ENTITY_FIELDS).join(', ') + '.' }, 400);
    const before: Record<string, string | null> = {};
    for (const k of keys) before[k] = (licence as any)[k] ?? null;
    // One fixed statement: a field not sent binds NULL and keeps its column.
    await c.env.DB.prepare(
      `UPDATE territory_licences
          SET legal_entity_name = COALESCE(?, legal_entity_name), brand_name = COALESCE(?, brand_name),
              registered_address = COALESCE(?, registered_address), signatory_name = COALESCE(?, signatory_name),
              signatory_title = COALESCE(?, signatory_title), revision = revision + 1, updated_at = ?
        WHERE id = ?`,
    ).bind(
      next.legal_entity_name ?? null, next.brand_name ?? null, next.registered_address ?? null,
      next.signatory_name ?? null, next.signatory_title ?? null, nowIso(), licence.id,
    ).run();
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    await logEvent(c.env, licence.id, 'terms_changed', admin.id, { entity: keys }, 'Entity and signatory details completed',
      { before, after: next }, pushOutcome(pushed));
    return c.json({ ok: true, ...next, pushed });
  } catch (e) { return mapError(c, e); }
});

// D797 (#2230) — the licence's terms schedule: deal terms, renewal and notice,
// money and reporting, beyond Step 4's fee and shares. The field list is
// `services/licenceTerms.ts`; migration 512's CHECKs hold the same ranges.
r.get('/:uid/terms', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const rec = await readLicenceTerms(c.env, licence.uid);
    return c.json({ licence_uid: licence.uid, terms: rec?.terms ?? null, sections: rec?.sections ?? {}, revision: rec?.revision ?? 0 });
  } catch (e) { return mapError(c, e); }
});

// A MONEY WRITE, SO IT TAKES THE MONEY BAR: a TOTP-minted session, a recent
// step-up, then the elevation (`requireSuperAdminWriteBar`). Only the keys the
// body names change, and `null` clears one. A reason is required, and every
// save appends exactly one `terms_changed` event naming the changed keys with
// their before and after.
r.put('/:uid/terms', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const reason = typeof b?.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
    if (!reason) return c.json({ error: 'reason_required', message: 'Say why the terms change.' }, 400);
    const rev = parseExpectedRevision(b?.expected_revision);
    if (!rev.ok) return c.json({ error: 'revision_required', message: rev.message }, 400);
    const v = validateTermsBody(b?.terms, b?.sections);
    if (!v.ok) {
      return c.json({ error: 'invalid_terms', message: `${v.errors[0].field} ${v.errors[0].message}.`, errors: v.errors }, 400);
    }
    const before = await readLicenceTerms(c.env, licence.uid);
    // THE REVISION THE CALLER READ MUST BE THE ONE STORED (D4694). A licence
    // with no schedule row is revision 0. This is the early, cheap refusal; the
    // write below names the revision again and is the one that decides.
    const conflict = (now: LicenceTermsRecord | null) => c.json({
      error: 'terms_conflict',
      message: 'This licence\'s terms changed since you opened them, so nothing was saved. Reload them and apply your change again.',
      current_revision: now?.revision ?? 0,
      current: now ? { terms: now.terms, sections: now.sections } : null,
    }, 409);
    if ((before?.revision ?? 0) !== rev.value) return conflict(before);
    const after: LicenceTermsRecord = {
      terms: { ...(before?.terms ?? {}), ...v.terms },
      sections: { ...(before?.sections ?? {}) },
      revision: (before?.revision ?? 0) + 1,
    };
    for (const [k, sec] of Object.entries(v.sections ?? {})) {
      // A cleared section reads the canvas's default again (none for a term
      // the canvas does not cite).
      if (sec !== null) after.sections[k] = sec;
      else if (DEFAULT_TERM_SECTIONS[k]) after.sections[k] = DEFAULT_TERM_SECTIONS[k];
      else delete after.sections[k];
    }
    // Only HQ's overrides of the canvas's section numbers are stored; a
    // cleared section reads the default again.
    const overrides = Object.fromEntries(Object.entries(after.sections)
      .filter(([k, sec]) => sec !== DEFAULT_TERM_SECTIONS[k]));
    // THE WRITE IS CONDITIONAL AND ITS ROW COUNT IS READ. A first save inserts
    // and does nothing if another save inserted first; a later save updates only
    // the revision it read. No row changed means someone got there first: a 409,
    // and no event is appended for a save that did not commit.
    const values = [...LICENCE_TERM_KEYS.map((k) => after.terms[k] ?? null), JSON.stringify(overrides), admin.id, nowIso()];
    const written = before === null
      ? await c.env.DB.prepare(
        `INSERT INTO licence_terms
           (licence_uid,
          licensor_ip_entity, licensor_brand_entity, governing_law, exclusive,
          non_compete_months, referrals_note, renewal_mode, non_renewal_notice_days,
          cure_days, termination_note, share_subscriptions_bps, share_licence_fees_bps,
          share_token_margin_bps, royalty_platform_licence_bps, payment_terms_days, late_interest_bps,
          minimum_guarantee_cents, fee_invoiced, first_look_business_days, co_invest_max_bps,
          carry_share_bps, referral_fee_bps, hq_approval_above_cents, conflicts_note,
          seat_includes, brand_kit, usage_report_day, statement_period,
          data_role, audit_right, audit_notice_days, sections_json,
          updated_by_user_id, updated_at,
          revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(licence_uid) DO NOTHING`,
      ).bind(licence.uid, ...values).run()
      : await c.env.DB.prepare(
        `UPDATE licence_terms SET
          licensor_ip_entity = ?, licensor_brand_entity = ?, governing_law = ?,
          exclusive = ?, non_compete_months = ?, referrals_note = ?,
          renewal_mode = ?, non_renewal_notice_days = ?, cure_days = ?,
          termination_note = ?, share_subscriptions_bps = ?, share_licence_fees_bps = ?,
          share_token_margin_bps = ?, royalty_platform_licence_bps = ?, payment_terms_days = ?,
          late_interest_bps = ?, minimum_guarantee_cents = ?, fee_invoiced = ?,
          first_look_business_days = ?, co_invest_max_bps = ?, carry_share_bps = ?,
          referral_fee_bps = ?, hq_approval_above_cents = ?, conflicts_note = ?,
          seat_includes = ?, brand_kit = ?, usage_report_day = ?,
          statement_period = ?, data_role = ?, audit_right = ?,
          audit_notice_days = ?, sections_json = ?, updated_by_user_id = ?,
          updated_at = ?,
          revision = revision + 1
          WHERE licence_uid = ? AND revision = ?`,
      ).bind(...values, licence.uid, rev.value).run();
    if (Number(written?.meta?.changes ?? 0) !== 1) return conflict(await readLicenceTerms(c.env, licence.uid));
    const changed = termsDiff(before, after);
    await logEvent(c.env, licence.id, 'terms_changed', admin.id, { schedule: 'licence_terms', reason, changed }, reason);
    // The branch's copy carries the terms (`branch_licence.terms_json`), so a
    // save pushes like Step 4's; a push that does not land is retried (D272).
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    const saved = await readLicenceTerms(c.env, licence.uid);
    return c.json({ ok: true, licence_uid: licence.uid, terms: saved?.terms ?? null, sections: saved?.sections ?? {}, revision: saved?.revision ?? after.revision, changed, pushed });
  } catch (e) { return mapError(c, e); }
});


export default r;

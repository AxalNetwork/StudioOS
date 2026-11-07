/**
 * #4707 — HQ licence routes: commercial terms: territories, seats and terms (incl. the D797 schedule). Mounted by `admin_licences.ts` at
 * `/api/admin/licences`, in the order the routes were declared before the split;
 * moved unchanged, with their original comments.
 */
import { Hono } from 'hono';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError, nowIso } from './_t13t14t15_helpers';
import { pushLicenceToBranch } from '../services/licencePush';
import { DEFAULT_TERM_SECTIONS, readLicenceTerms, termsDiff, validateTermsBody, type LicenceTermsRecord } from '../services/licenceTerms';
import { SEAT_TYPES, ISO2, str, intOrNull, byUid, logEvent, pushOutcome, seatsOf, countriesOf } from '../services/licenceLedgerCore';
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
      c.env.DB.prepare('DELETE FROM licence_territories WHERE licence_id = ?').bind(licence.id),
      ...wanted.map((code) => c.env.DB.prepare(
        'INSERT INTO licence_territories (licence_id, country_code, created_at) VALUES (?,?,?)',
      ).bind(licence.id, code, nowIso())),
      c.env.DB.prepare('UPDATE territory_licences SET updated_at = ? WHERE id = ?')
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
      c.env.DB.prepare('DELETE FROM licence_seats WHERE licence_id = ?').bind(licence.id),
      ...SEAT_TYPES.map((t) => c.env.DB.prepare(
        'INSERT INTO licence_seats (licence_id, seat_type, seats_licensed, created_at) VALUES (?,?,?,?)',
      ).bind(licence.id, t, seats[t], nowIso())),
      c.env.DB.prepare('UPDATE territory_licences SET updated_at = ? WHERE id = ?')
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

// Step 4 — commercial terms.
r.patch('/:uid/terms', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const bps = (v: unknown) => {
      const n = intOrNull(v);
      if (n === null) return null;
      // Basis points. A share above 100% is a typo, not a deal.
      return Math.min(10000, Math.max(0, n));
    };
    const fee = intOrNull(b?.annual_fee_cents);
    if (fee !== null && fee < 0) return c.json({ error: 'the annual fee cannot be negative' }, 400);
    const terms = {
      term_years: intOrNull(b?.term_years),
      annual_fee_cents: fee,
      currency: str(b?.currency, 3).toUpperCase() || licence.currency,
      revenue_share_bps: bps(b?.revenue_share_bps),
      token_split_bps: bps(b?.token_split_bps),
      starts_on: str(b?.starts_on, 32) || licence.starts_on,
      renews_on: str(b?.renews_on, 32) || licence.renews_on,
    };
    await c.env.DB.prepare(
      `UPDATE territory_licences
          SET term_years = ?, annual_fee_cents = ?, currency = ?, revenue_share_bps = ?,
              token_split_bps = ?, starts_on = ?, renews_on = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(
      terms.term_years, terms.annual_fee_cents, terms.currency, terms.revenue_share_bps,
      terms.token_split_bps, terms.starts_on, terms.renews_on, nowIso(), licence.id,
    ).run();
    const beforeTerms = {
      term_years: licence.term_years ?? null, annual_fee_cents: licence.annual_fee_cents ?? null,
      currency: licence.currency ?? null, revenue_share_bps: licence.revenue_share_bps ?? null,
      token_split_bps: licence.token_split_bps ?? null, starts_on: licence.starts_on ?? null,
      renews_on: licence.renews_on ?? null,
    };
    // D272 — this changes what the branch's copy holds, so it pushes like
    // every status transition; a push that does not land is retried.
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    await logEvent(c.env, licence.id, 'terms_changed', admin.id, terms, null,
      { before: beforeTerms, after: terms }, pushOutcome(pushed));
    return c.json({ ok: true, ...terms, pushed } satisfies LicenceTermsResult);
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
    return c.json({ licence_uid: licence.uid, terms: rec?.terms ?? null, sections: rec?.sections ?? {} });
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
    const v = validateTermsBody(b?.terms, b?.sections);
    if (!v.ok) {
      return c.json({ error: 'invalid_terms', message: `${v.errors[0].field} ${v.errors[0].message}.`, errors: v.errors }, 400);
    }
    const before = await readLicenceTerms(c.env, licence.uid);
    const after: LicenceTermsRecord = {
      terms: { ...(before?.terms ?? {}), ...v.terms },
      sections: { ...(before?.sections ?? {}) },
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
    const t = (k: string) => after.terms[k] ?? null;
    await c.env.DB.prepare(
      `INSERT INTO licence_terms
         (licence_uid, licensor_ip_entity, licensor_brand_entity, governing_law,
          exclusive, non_compete_months, referrals_note,
          renewal_mode, non_renewal_notice_days, cure_days, termination_note,
          share_subscriptions_bps, share_licence_fees_bps, share_token_margin_bps, royalty_platform_licence_bps,
          payment_terms_days, late_interest_bps, minimum_guarantee_cents, fee_invoiced,
          first_look_business_days, co_invest_max_bps, carry_share_bps, referral_fee_bps,
          hq_approval_above_cents, conflicts_note, seat_includes, brand_kit,
          usage_report_day, statement_period, data_role, audit_right, audit_notice_days,
          sections_json, updated_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(licence_uid) DO UPDATE SET
         licensor_ip_entity = excluded.licensor_ip_entity, licensor_brand_entity = excluded.licensor_brand_entity,
         governing_law = excluded.governing_law,
         exclusive = excluded.exclusive, non_compete_months = excluded.non_compete_months,
         referrals_note = excluded.referrals_note,
         renewal_mode = excluded.renewal_mode, non_renewal_notice_days = excluded.non_renewal_notice_days,
         cure_days = excluded.cure_days, termination_note = excluded.termination_note,
         share_subscriptions_bps = excluded.share_subscriptions_bps, share_licence_fees_bps = excluded.share_licence_fees_bps,
         share_token_margin_bps = excluded.share_token_margin_bps, royalty_platform_licence_bps = excluded.royalty_platform_licence_bps,
         payment_terms_days = excluded.payment_terms_days, late_interest_bps = excluded.late_interest_bps,
         minimum_guarantee_cents = excluded.minimum_guarantee_cents, fee_invoiced = excluded.fee_invoiced,
         first_look_business_days = excluded.first_look_business_days, co_invest_max_bps = excluded.co_invest_max_bps,
         carry_share_bps = excluded.carry_share_bps, referral_fee_bps = excluded.referral_fee_bps,
         hq_approval_above_cents = excluded.hq_approval_above_cents, conflicts_note = excluded.conflicts_note,
         seat_includes = excluded.seat_includes, brand_kit = excluded.brand_kit,
         usage_report_day = excluded.usage_report_day, statement_period = excluded.statement_period,
         data_role = excluded.data_role, audit_right = excluded.audit_right, audit_notice_days = excluded.audit_notice_days,
         sections_json = excluded.sections_json, updated_by_user_id = excluded.updated_by_user_id,
         updated_at = excluded.updated_at`,
    ).bind(
      licence.uid, t('licensor_ip_entity'), t('licensor_brand_entity'), t('governing_law'),
      t('exclusive'), t('non_compete_months'), t('referrals_note'),
      t('renewal_mode'), t('non_renewal_notice_days'), t('cure_days'), t('termination_note'),
      t('share_subscriptions_bps'), t('share_licence_fees_bps'), t('share_token_margin_bps'), t('royalty_platform_licence_bps'),
      t('payment_terms_days'), t('late_interest_bps'), t('minimum_guarantee_cents'), t('fee_invoiced'),
      t('first_look_business_days'), t('co_invest_max_bps'), t('carry_share_bps'), t('referral_fee_bps'),
      t('hq_approval_above_cents'), t('conflicts_note'), t('seat_includes'), t('brand_kit'),
      t('usage_report_day'), t('statement_period'), t('data_role'), t('audit_right'), t('audit_notice_days'),
      JSON.stringify(overrides), admin.id, nowIso(),
    ).run();
    const changed = termsDiff(before, after);
    await logEvent(c.env, licence.id, 'terms_changed', admin.id, { schedule: 'licence_terms', reason, changed }, reason);
    // The branch's copy carries the terms (`branch_licence.terms_json`), so a
    // save pushes like Step 4's; a push that does not land is retried (D272).
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    const saved = await readLicenceTerms(c.env, licence.uid);
    return c.json({ ok: true, licence_uid: licence.uid, terms: saved?.terms ?? null, sections: saved?.sections ?? {}, changed, pushed });
  } catch (e) { return mapError(c, e); }
});

export default r;

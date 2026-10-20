/**
 * HQ · Licences → a licence's annual licence-fee invoices (D802, #2238).
 *
 *   GET   /api/admin/licences/:uid/fee-invoices                    the list, and the period Issue would invoice
 *   POST  /api/admin/licences/:uid/fee-invoices                    issue the invoice for a fee year
 *   PATCH /api/admin/licences/:uid/fee-invoices/:invoiceUid        record a payment, or void it
 *   GET   /api/admin/licences/:uid/fee-invoices/:invoiceUid/pdf    the invoice, printed
 *
 * Mounted at `/api/admin/licences` BEFORE `admin_licences.ts`, so these paths
 * reach their own handlers; that file is past two thousand lines and these
 * four are a ledger of their own (as `admin_statements.ts` is).
 *
 * MONEY WRITES TAKE THE MONEY BAR. Issuing and recording are Super Admin with
 * a TOTP-minted session and a recent step-up (`requireSuperAdminWriteBar`); a
 * licence Administrator, or a member, reaches neither. The reads are Super
 * Admin (`requireSuperAdmin`); the licensee reads its own invoices on
 * `/api/licence/mine/statements`.
 *
 * WHAT AN INVOICE IS. The ledger's `annual_fee_cents` and currency, copied at
 * issue, for one fee year (`feePeriod`). `paid_cents` is what an HQ operator
 * recorded receiving (D.8, as on a statement): nothing here reads a bank or
 * Stripe. Every issue, payment and void writes one audit row.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { logAdminAction } from '../services/adminAudit';
import { readLicenceTerms, TERMS_REASON } from '../services/licenceTerms';
import {
  addDays, DEFAULT_PAYMENT_TERMS_DAYS, feeInvoiceOf, feeInvoicePdf, feePeriod, listFeeInvoices,
} from '../services/licenceFeeInvoice';

const r = new Hono<{ Bindings: Env }>();

type LicenceRow = {
  id: number; uid: string; licence_ref: string; legal_entity_name: string; brand_name: string;
  status: string; annual_fee_cents: number | null; currency: string; starts_on: string | null;
};

async function licenceOf(env: Env, uid: string): Promise<LicenceRow | null> {
  return await env.DB.prepare(
    `SELECT id, uid, licence_ref, legal_entity_name, brand_name, status, annual_fee_cents, currency, starts_on
       FROM territory_licences WHERE uid = ?`,
  ).bind(uid).first<LicenceRow>();
}

const pdfBase = (licenceUid: string) => `/api/admin/licences/${licenceUid}/fee-invoices`;
const today = () => nowIso().slice(0, 10);
const str = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max);
/** A whole number of minor units, 0 or more, or null (D514's rule: never clamped to 0). */
const typedCents = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/** Why this licence cannot be invoiced, or null. */
function issueRefusal(l: LicenceRow): { error: string; message: string } | null {
  if (l.status !== 'active') {
    return { error: 'licence_not_active', message: `${l.licence_ref} is ${l.status}, so no fee invoice is issued for it.` };
  }
  if (!(Number.isSafeInteger(l.annual_fee_cents) && Number(l.annual_fee_cents) > 0)) {
    return { error: 'no_annual_fee', message: `${l.licence_ref} has no annual fee on its terms, so there is no amount to invoice. Set it in step 4 of the issue flow first.` };
  }
  if (!feePeriod(l.starts_on, today())) {
    return { error: 'no_start_date', message: `${l.licence_ref} has no start date, so its fee year cannot be counted.` };
  }
  return null;
}

// GET /api/admin/licences/:uid/fee-invoices
r.get('/:uid/fee-invoices', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await licenceOf(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const invoices = await listFeeInvoices(c.env, licence, pdfBase(licence.uid));
    const refusal = issueRefusal(licence);
    const next = refusal ? null : feePeriod(licence.starts_on, today());
    const taken = next && invoices.some((i) => i.period_start === next.period_start && i.status !== 'void');
    return c.json({
      licence_uid: licence.uid,
      annual_fee_cents: licence.annual_fee_cents,
      currency: licence.currency,
      invoices,
      next_period: next,
      can_issue: !refusal && !taken,
      issue_refusal: refusal?.message ?? (taken ? `The ${next!.period_label} fee year is already invoiced.` : null),
    });
  } catch (e) { return mapError(c, e); }
});

// POST /api/admin/licences/:uid/fee-invoices  { period_start? }
// The fee year holding today unless `period_start` names another anniversary.
r.post('/:uid/fee-invoices', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await licenceOf(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const refusal = issueRefusal(licence);
    if (refusal) return c.json(refusal, 409);

    const b = await c.req.json().catch(() => ({} as any));
    let period = feePeriod(licence.starts_on, today())!;
    if (b?.period_start !== undefined && b?.period_start !== null) {
      const asked = feePeriod(licence.starts_on, str(b.period_start, 10));
      if (!asked || asked.period_start !== b.period_start) {
        return c.json({ error: 'bad_period', message: 'period_start must be an anniversary of the licence\'s start date.' }, 400);
      }
      period = asked;
    }

    // The due date and the licensor come from D797's schedule; a schedule
    // that cannot be read refuses rather than guessing either.
    let terms;
    try {
      terms = (await readLicenceTerms(c.env, licence.uid))?.terms ?? {};
    } catch {
      return c.json({ error: 'terms_unreadable', message: `${TERMS_REASON.unreadable} No invoice is issued until its payment terms can be read.` }, 503);
    }
    const days = typeof terms.payment_terms_days === 'number' ? terms.payment_terms_days : DEFAULT_PAYMENT_TERMS_DAYS;

    const existing = await c.env.DB.prepare(
      `SELECT uid FROM licence_fee_invoices WHERE licence_uid = ? AND period_start = ? AND status <> 'void'`,
    ).bind(licence.uid, period.period_start).first<{ uid: string }>();
    const duplicate = () => c.json({
      error: 'period_invoiced',
      message: `The ${period.period_label} fee year for ${licence.licence_ref} is already invoiced. Void that invoice first to issue another.`,
      uid: existing?.uid,
    }, 409);
    if (existing) return duplicate();

    const uid = newUid();
    const now = nowIso();
    const issued = now.slice(0, 10);
    const due = addDays(issued, days);
    try {
      await c.env.DB.prepare(
        `INSERT INTO licence_fee_invoices
           (uid, licence_uid, period_label, period_start, period_end, amount_cents, currency,
            issued_at, due_at, status, issued_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)`,
      ).bind(
        uid, licence.uid, period.period_label, period.period_start, period.period_end,
        licence.annual_fee_cents, licence.currency, now, due, admin.id, now, now,
      ).run();
    } catch (e) {
      // Two issues at once: the partial unique index lets one land.
      if (/UNIQUE/i.test(String((e as Error)?.message))) return duplicate();
      throw e;
    }
    await logAdminAction(c.env, admin.id, admin.email, 'licence_fee_invoice_issued', {
      uid, licence_uid: licence.uid, period: period.period_label, amount_cents: licence.annual_fee_cents,
      currency: licence.currency, due_at: due, payment_terms_days: days,
    });
    const row = await feeInvoiceOf(c.env, licence.uid, uid);
    return c.json({ ...row, pdf_url: `${pdfBase(licence.uid)}/${uid}/pdf` }, 201);
  } catch (e) { return mapError(c, e); }
});

// PATCH /api/admin/licences/:uid/fee-invoices/:invoiceUid
//   { paid_cents, paid_note }   what HQ recorded receiving; equal to the amount marks it paid
//   { status: 'void', void_reason }
r.patch('/:uid/fee-invoices/:invoiceUid', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await licenceOf(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const inv = await feeInvoiceOf(c.env, licence.uid, c.req.param('invoiceUid'));
    if (!inv) return c.json({ error: 'not_found', message: 'No such invoice on this licence.' }, 404);
    if (inv.status === 'void') {
      return c.json({ error: 'invoice_void', message: 'This invoice was voided; nothing more is recorded on it.' }, 409);
    }
    const b = await c.req.json().catch(() => ({} as any));
    const now = nowIso();

    if (b?.status === 'void') {
      const reason = str(b.void_reason, 500);
      if (reason.length < 10) {
        return c.json({ error: 'void_reason_required', message: 'Say why the invoice is voided, in ten characters or more.' }, 400);
      }
      if (Number(inv.paid_cents) > 0) {
        return c.json({ error: 'paid_recorded', message: 'A payment is recorded on this invoice. Set it back to 0 before voiding it.' }, 409);
      }
      await c.env.DB.prepare(
        `UPDATE licence_fee_invoices SET status = 'void', void_reason = ?, recorded_by_user_id = ?, updated_at = ?
          WHERE uid = ? AND status <> 'void'`,
      ).bind(reason, admin.id, now, inv.uid).run();
      await logAdminAction(c.env, admin.id, admin.email, 'licence_fee_invoice_voided', {
        uid: inv.uid, licence_uid: licence.uid, period: inv.period_label, from_status: inv.status, note: reason,
      });
    } else if (b?.status !== undefined) {
      return c.json({ error: 'bad_status', message: 'status may only be void; a payment marks an invoice paid.' }, 400);
    } else if (b?.paid_cents !== undefined) {
      const cents = typedCents(b.paid_cents);
      if (cents === null) {
        return c.json({ error: 'bad_amount', message: 'paid_cents must be a whole number of minor units, 0 or more.' }, 400);
      }
      if (cents > Number(inv.amount_cents)) {
        return c.json({ error: 'overpaid', message: `That is more than the ${inv.amount_cents} minor units invoiced.` }, 409);
      }
      const note = str(b.paid_note, 500);
      if (cents > 0 && !note) {
        return c.json({ error: 'paid_note_required', message: 'Give the payment\'s reference or a note saying how it arrived.' }, 400);
      }
      const status = cents === Number(inv.amount_cents) ? 'paid' : 'issued';
      await c.env.DB.prepare(
        `UPDATE licence_fee_invoices
            SET paid_cents = ?, paid_note = ?, paid_at = ?, status = ?, recorded_by_user_id = ?, updated_at = ?
          WHERE uid = ? AND status <> 'void'`,
      ).bind(cents, note || null, cents > 0 ? now : null, status, admin.id, now, inv.uid).run();
      await logAdminAction(c.env, admin.id, admin.email, 'licence_fee_invoice_paid', {
        uid: inv.uid, licence_uid: licence.uid, period: inv.period_label, from_status: inv.status, to_status: status,
        currency: inv.currency, amounts: { paid_cents: { before: Number(inv.paid_cents), after: cents } },
        ...(note ? { note } : {}),
      });
    } else {
      return c.json({ error: 'nothing_to_change', message: 'Send paid_cents with a note, or status void with a reason.' }, 400);
    }
    const row = await feeInvoiceOf(c.env, licence.uid, inv.uid);
    return c.json(row);
  } catch (e) { return mapError(c, e); }
});

// GET /api/admin/licences/:uid/fee-invoices/:invoiceUid/pdf
r.get('/:uid/fee-invoices/:invoiceUid/pdf', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await licenceOf(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const inv = await feeInvoiceOf(c.env, licence.uid, c.req.param('invoiceUid'));
    if (!inv) return c.json({ error: 'not_found', message: 'No such invoice on this licence.' }, 404);
    let licensor: string | null = null;
    try {
      const t = (await readLicenceTerms(c.env, licence.uid))?.terms;
      licensor = typeof t?.licensor_ip_entity === 'string' ? t.licensor_ip_entity : null;
    } catch {
      return c.json({ error: 'terms_unreadable', message: `${TERMS_REASON.unreadable} The invoice is not printed until its licensor can be checked.` }, 503);
    }
    const pdf = await feeInvoicePdf(c.env, licence, inv, licensor);
    if (!pdf.ok) return c.json({ error: pdf.code, message: pdf.message }, pdf.status);
    return new Response(pdf.bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${pdf.filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) { return mapError(c, e); }
});

export default r;

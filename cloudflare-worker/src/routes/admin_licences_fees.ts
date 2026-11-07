/**
 * #4707 — HQ licence routes: annual fee invoices. Mounted by `admin_licences.ts` at
 * `/api/admin/licences`, in the order the routes were declared before the split;
 * moved unchanged, with their original comments.
 */
import { Hono } from 'hono';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError, nowIso } from './_t13t14t15_helpers';
import { logAdminAction } from '../services/adminAudit';
import { byUid } from '../services/licenceLedgerCore';
import type { Env } from '../types';

const r = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// D802 (#2238) — annual licence-fee invoices (migration 513,
// `services/licenceFeeInvoices.ts`). HQ issues one per licence year and
// records what it received, as it does on a statement (D.8). Issuing and
// recording are money writes, so both take the write bar; reading and the PDF
// take the plain Super Admin elevation. No branch copy changes, so nothing is
// pushed.
// ---------------------------------------------------------------------------
export const feeInvoices = () => import('../services/licenceFeeInvoices');

export async function feeRefusal(c: any, e: unknown) {
  const { FeeInvoiceRefusal } = await feeInvoices();
  if (!(e instanceof FeeInvoiceRefusal)) return null;
  // A FeeInvoiceRefusal carries a sentence the service wrote, never an exception's text.
  const refused = e;
  return c.json({ error: refused.code, message: refused.message, ...refused.extra }, refused.status);
}

// GET /api/admin/licences/:uid/fee-invoices — the licence's invoices, newest year first.
r.get('/:uid/fee-invoices', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const { listFeeInvoices, hqInvoiceView } = await feeInvoices();
    const rows = await listFeeInvoices(c.env, licence.uid);
    return c.json({ invoices: rows.map((row) => hqInvoiceView(row, licence.uid)), annual_fee_cents: licence.annual_fee_cents, currency: licence.currency, starts_on: licence.starts_on });
  } catch (e) { return mapError(c, e); }
});

// POST /api/admin/licences/:uid/fee-invoices — issue the invoice for the
// licence year that holds today. 409 while that year is already invoiced.
r.post('/:uid/fee-invoices', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const { issueFeeInvoice, hqInvoiceView } = await feeInvoices();
    // D797's schedule: the platform IP's licensor and the payment terms. No row,
    // or a database before migration 512, leaves the defaults (Holdings, 30
    // days); terms that cannot be read refuse rather than invoice on a guess.
    let terms: Record<string, unknown> | null = null;
    try {
      const { readLicenceTerms } = await import('../services/licenceTerms');
      terms = (await readLicenceTerms(c.env, licence.uid))?.terms ?? null;
    } catch (e) {
      if (!/no such table/i.test(String((e as Error)?.message ?? e))) {
        return c.json({ error: 'terms_unreadable', message: 'This licence\'s terms could not be read, so its licensor and payment terms are unknown. Nothing was issued; try again.' }, 503);
      }
    }
    const inv = await issueFeeInvoice(c.env, licence, admin.id, nowIso().slice(0, 10), {
      licensorIpEntity: typeof terms?.licensor_ip_entity === 'string' ? terms.licensor_ip_entity : null,
      paymentTermsDays: typeof terms?.payment_terms_days === 'number' ? terms.payment_terms_days : null,
    });
    await logAdminAction(c.env, admin.id, admin.email, 'licence_fee_invoice_issued', {
      licence_uid: licence.uid, licence_ref: licence.licence_ref, invoice_uid: inv.uid, period: inv.period_label,
      amount_cents: inv.amount_cents, currency: inv.currency, due_at: inv.due_at,
    });
    return c.json({ invoice: hqInvoiceView(inv, licence.uid) }, 201);
  } catch (e) {
    return (await feeRefusal(c, e)) ?? mapError(c, e);
  }
});

// PATCH /api/admin/licences/:uid/fee-invoices/:invoiceUid
//   { paid_cents, paid_note? } — the running total received; or
//   { status: 'void', void_note } — void an invoice with nothing paid on it.
r.patch('/:uid/fee-invoices/:invoiceUid', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const { feeInvoiceOf, parseFeeInvoiceUpdate, recordFeeInvoiceUpdate, hqInvoiceView } = await feeInvoices();
    const inv = await feeInvoiceOf(c.env, licence.uid, c.req.param('invoiceUid'));
    if (!inv) return c.json({ error: 'not_found' }, 404);
    const parsed = parseFeeInvoiceUpdate(await c.req.json().catch(() => null), inv);
    if (!parsed.ok) return c.json({ error: parsed.code, field: parsed.field, message: parsed.message }, parsed.status);
    const after = await recordFeeInvoiceUpdate(c.env, inv, parsed, admin.id, nowIso());
    await logAdminAction(c.env, admin.id, admin.email, parsed.kind === 'void' ? 'licence_fee_invoice_void' : 'licence_fee_invoice_payment', {
      licence_uid: licence.uid, invoice_uid: inv.uid, period: inv.period_label, currency: inv.currency,
      from_status: inv.status, to_status: after.status, paid_cents_before: inv.paid_cents, paid_cents: after.paid_cents,
      ...(parsed.kind === 'void' ? { note: parsed.void_note } : {}),
    });
    return c.json({ invoice: hqInvoiceView(after, licence.uid) });
  } catch (e) { return mapError(c, e); }
});

// GET /api/admin/licences/:uid/fee-invoices/:invoiceUid/pdf — the invoice as issued.
r.get('/:uid/fee-invoices/:invoiceUid/pdf', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const { feeInvoiceOf, feeInvoicePdf } = await feeInvoices();
    const inv = await feeInvoiceOf(c.env, licence.uid, c.req.param('invoiceUid'));
    if (!inv) return c.json({ error: 'not_found' }, 404);
    const pdf = await feeInvoicePdf(c.env, inv);
    if (!pdf.ok) return c.json({ error: pdf.code, message: pdf.message }, pdf.status);
    return new Response(pdf.bytes, {
      status: 200,
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${pdf.filename}"`, 'Cache-Control': 'private, no-store' },
    });
  } catch (e) { return mapError(c, e); }
});

export default r;

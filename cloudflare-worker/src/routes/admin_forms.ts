import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import {
  IRS_FORMS,
  FORM_PLACEHOLDER_FIELDS,
  renderForm,
  sampleFields,
  type FormFields,
} from '../services/irsForms';

// Task #9 — Hardcoded IRS-style forms (SS-4 + instructions, Form 8821,
// Statement & Acknowledgement of Faxed EIN, Confirmation of Information).
// Rendered programmatically as fixed-layout PDFs with three placeholder
// fields (full legal name, company, date). Admin-only: admins can list the
// catalog and preview/download each form blank or with sample values.
// Mounted at /api/admin/forms — a new prefix, so the API-drift checker is
// satisfied once the SPA calls land under it.
const adminForms = new Hono<{ Bindings: Env }>();

// GET / — static forms catalog.
adminForms.get('/', async (c) => {
  await requireAdmin(c);
  return c.json({
    items: IRS_FORMS,
    placeholder_fields: FORM_PLACEHOLDER_FIELDS,
    total: IRS_FORMS.length,
  });
});

// GET /:id/preview — render a form as a PDF.
//   ?blank=1  → render with empty placeholder fields (a true blank).
//   default   → render with sample placeholder values.
adminForms.get('/:id/preview', async (c) => {
  await requireAdmin(c);
  const id = c.req.param('id');
  const blank = c.req.query('blank') === '1' || c.req.query('blank') === 'true';
  const fields: FormFields = blank
    ? { fullLegalName: '', company: '', date: '' }
    : sampleFields();

  const bytes = await renderForm(id, fields);
  if (!bytes) return c.json({ error: 'Form not found', id }, 404);

  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="axal-form-${id}${blank ? '-blank' : ''}.pdf"`,
      'Cache-Control': 'private, max-age=0, no-store',
    },
  });
});

export default adminForms;

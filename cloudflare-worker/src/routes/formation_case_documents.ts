/**
 * D6706 (#6706, plan key E14 of #6680): the founder's side of a formation
 * case's documents, mounted at /api/formation/cases beside
 * routes/formation_cases.ts (which has no /:uid/documents route), every route signed in and scoped to the
 * caller's own v2 case; another subject's case reads as 404.
 *
 *   GET  /:uid/documents              The case documents the founder may see
 *                                     (visible_to `all`), each with its SHA-256
 *                                     and the last envelope it was sent in, and
 *                                     `plan`: the form's template set as it
 *                                     stands (what would be generated, and what
 *                                     waits on counsel, a body, fields, people
 *                                     or an envelope). The plan writes nothing.
 *   GET  /:uid/documents/:docUid      One of them; a generated document carries
 *                                     its text, a stored file only its hash.
 *   POST /:uid/documents/sign         `{ document_uid | template_key, person_uid?,
 *                                     purpose? }`: send it for signature through
 *                                     the in-house e-sign, to the founder or a
 *                                     person of the case; `purpose:
 *                                     'consent_to_act'` for an appointee's consent.
 *
 * Generation, consent uploads and pack approvals are HQ's and partners'
 * routes' (they call services/formationDocuments.ts).
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { branchOf } from '../util/branch';
import { refuse } from '../util/refusal';
import {
  founderDocCase, generateCaseDocuments, listFounderDocuments, openFounderDocument, sendForSignature, type DocCase,
} from '../services/formationDocuments';

const r = new Hono<{ Bindings: Env }>();
r.use('/:uid/documents/*', bodyLimit({ maxSize: 8192 }));

/** One sentence for each code a founder can be sent. */
export const REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  case_not_found: 'That formation case was not found.',
  case_closed: 'This formation case is closed.',
  document_not_found: 'That document was not found on this case.',
  document_required: 'Choose the document to send.',
  purpose_invalid: 'Choose what the signature is for.',
  person_not_found: 'That person is not on this case.',
  person_required: 'Choose the person whose consent this is.',
  recipient_has_no_address: 'This person has no email address on the case. Add one first.',
  not_an_appointee: 'Only a director, secretary or legal representative gives a consent to act.',
  consent_already_recorded: 'This person\'s consent to act is already recorded.',
  not_a_consent_document: 'This document is not this person\'s consent to act.',
  consent_is_a_case_document: 'A consent to act is sent from the consent document generated for that person.',
  document_is_for_another_person: 'This document was prepared for another person.',
  template_not_in_set: 'That template is not one this case signs through e-sign.',
  case_has_no_form: 'This case has no form chosen yet.',
  not_reviewed_for_country: 'Counsel has not approved this template for this country yet. Nothing was sent.',
  template_has_no_body: 'This document has no text in the library yet. Nothing was sent.',
  template_unreadable: 'The template could not be read, so nothing was sent. Try again in a moment.',
  template_restricted: 'This document is not ready to send: counsel has not reviewed its text yet. Nothing was sent.',
  fields_unfilled: 'Some details this document needs are missing from the case. Nothing was sent.',
  send_failed: 'The document could not be sent. Nothing was recorded; try again.',
});
const refusal = (c: any, status: number, code: string, extra: Record<string, unknown> = {}) =>
  refuse(c, status, { code, message: REFUSALS[code] ?? 'This could not be completed.', extra });

async function ownCase(c: any): Promise<DocCase | null> {
  const user = await requireAuth(c);
  c.header('Cache-Control', 'private, no-store');
  if (branchOf(c.env)) return null;
  return founderDocCase(c.env, String(c.req.param('uid')), Number(user.id));
}

// GET /api/formation/cases/:uid/documents
r.get('/:uid/documents', async (c) => {
  const k = await ownCase(c);
  if (!k) return refusal(c, 404, 'case_not_found');
  const plan = await generateCaseDocuments(c.env, k.id, { party: 'founder', userId: k.user_id }, { dryRun: true });
  return c.json({
    case_uid: k.uid,
    documents: await listFounderDocuments(c.env, k.id),
    plan: plan.ok ? {
      to_generate: plan.documents.filter((d) => !d.reused).map((d) => ({ template_key: d.template_key, title: d.title, person_uid: d.person_uid })),
      pending_esign: plan.pending_esign, pending_counsel: plan.pending_counsel, pending_body: plan.pending_body,
      pending_fields: plan.pending_fields, pending_people: plan.pending_people,
    } : { unavailable: plan.error },
  });
});

// POST /api/formation/cases/:uid/documents/sign
r.post('/:uid/documents/sign', async (c) => {
  const k = await ownCase(c);
  if (!k) return refusal(c, 404, 'case_not_found');
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) return refusal(c, 400, 'document_required');
  const out = await sendForSignature(c.env, k, {
    documentUid: b.document_uid, templateKey: b.template_key, personUid: b.person_uid, purpose: b.purpose,
  }, { appUrl: c.env.APP_URL || 'https://axal.vc' });
  if (!out.ok) return refusal(c, out.status, out.error, 'fields' in out ? { fields: out.fields } : {});
  return c.json(out, 201);
});

// GET /api/formation/cases/:uid/documents/:docUid
r.get('/:uid/documents/:docUid', async (c) => {
  const k = await ownCase(c);
  if (!k) return refusal(c, 404, 'case_not_found');
  const doc = await openFounderDocument(c.env, k.id, String(c.req.param('docUid')));
  if (!doc) return refusal(c, 404, 'document_not_found');
  return c.json({ document: doc });
});

export const mount: RouteMount = { path: '/api/formation/cases', router: r };
export default r;

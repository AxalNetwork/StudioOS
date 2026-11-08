/**
 * #4707 — HQ licence routes: the licence contract: instantiate, read, send for signature. Mounted by `admin_licences.ts` at
 * `/api/admin/licences`, in the order the routes were declared before the split;
 * moved unchanged, with their original comments.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { ensureLegalTemplatesSchema, getTemplate, listTemplates } from '../services/legalTemplateStore';
import { mergeValues, renderContract } from '../services/licenceContract';
import { COUNSEL_REVIEW_SLUGS } from '../services/templateFormat';
import { createAndSendEnvelope, templateBodyRefusal, TemplateBodyError } from './esign';
import { refuse } from '../util/refusal';
import { pushLicenceToBranch } from '../services/licencePush';
import { readLicenceTerms, type LicenceTerms } from '../services/licenceTerms';
import { type LicenceRow, str, byUid, logEvent } from '../services/licenceLedgerCore';

const r = new Hono<{ Bindings: Env }>();

/* ------------------------------------------------------------------ *
 * H3 step 5 — the contract, instantiated from a master template        *
 * ------------------------------------------------------------------ */

export const COUNTERSIGN_NOT_RECORDED =
  'Ordered signers and HQ countersignature are not recorded yet — Session 13 holds '
  + 'ordered-signer envelopes; this send uses one recipient through createAndSendEnvelope.';

export function contractStatusFromEnvelope(envelopeStatus: string): 'draft' | 'sent' | 'signed' | 'void' {
  if (envelopeStatus === 'completed') return 'signed';
  if (envelopeStatus === 'void') return 'void';
  if (envelopeStatus === 'sent' || envelopeStatus === 'partially_signed') return 'sent';
  return 'draft';
}

export function mergeFieldsForEnvelope(
  licence: LicenceRow,
  territories: string[],
  seats: Array<{ seat_type: string; seats_licensed: number }>,
): Record<string, string> {
  const raw = mergeValues(licence, territories, seats);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== null && v !== undefined) out[k] = String(v);
  }
  return out;
}

/** D451 — status on read follows the envelope row when one exists (D110 deferred leg). */
export async function enrichContractFromEnvelope(env: Env, row: Record<string, unknown>) {
  const countersignature = { recorded: false as const, reason: COUNTERSIGN_NOT_RECORDED };
  const envelopeUid = row.envelope_uid ? String(row.envelope_uid) : null;
  if (!envelopeUid) {
    return { ...row, countersignature };
  }
  try {
    const e = await env.DB.prepare(
      `SELECT status, completed_at FROM esign_envelopes WHERE envelope_uuid = ?`,
    ).bind(envelopeUid).first<{ status: string; completed_at: string | null }>();
    if (!e) {
      return {
        ...row,
        countersignature,
        envelope_unreadable: true,
        envelope_reason: 'The envelope row could not be read for this contract.',
      };
    }
    const status = contractStatusFromEnvelope(String(e.status));
    return {
      ...row,
      status,
      signed_at: status === 'signed' ? (e.completed_at || row.signed_at || null) : row.signed_at,
      countersignature,
    };
  } catch {
    return {
      ...row,
      countersignature,
      envelope_unreadable: true,
      envelope_reason: 'The esign_envelopes table could not be read on this database.',
    };
  }
}

// GET /:uid/contract — what has been instantiated, and what could be.
//
// THE TEMPLATE LIST AND THE CONTRACT LIST COME BACK TOGETHER because the
// screen's two states are "pick one" and "here is the one you picked", and a
// second request to learn which of those it is would be a request whose
// failure mode is a picker that renders empty for a licence that already has
// a contract.
r.get('/:uid/contract', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);

    let contracts: any[] = [];
    let store = true;
    try {
      const q = await c.env.DB.prepare(
        `SELECT uid, template_slug, template_version, template_title, unfilled_fields,
                status, envelope_uid, superseded_at, created_at, sent_at, signed_at
           FROM licence_contracts WHERE licence_uid = ? ORDER BY created_at DESC, id DESC`,
      ).bind(licence.uid).all<any>();
      contracts = await Promise.all((q.results || []).map(async (row) => enrichContractFromEnvelope(
        c.env,
        {
          ...row,
          unfilled_fields: JSON.parse(String(row.unfilled_fields || '[]')),
        },
      )));
    } catch { store = false; }

    await ensureLegalTemplatesSchema(c.env);
    const templates = await listTemplates(c.env);

    return c.json({
      licence_uid: licence.uid,
      contracts,
      contracts_available: store,
      ...(store ? {} : {
        contracts_reason:
          'The licence_contracts table could not be read on this database (migration 259).',
      }),
      // What the master library actually holds. Offered as-is rather than
      // filtered to a "licence agreement" category: `legal_templates` has four
      // categories and none of them is that, so a filter would show an empty
      // picker over a library that is not empty.
      templates: templates.map((t) => ({
        slug: t.slug, title: t.title, category: t.category, version: t.version,
        // D803: a body counsel has not reviewed, said where HQ picks it.
        counsel_review: COUNSEL_REVIEW_SLUGS.has(t.slug),
      })),
      ...(templates.length ? {} : {
        templates_reason:
          'HQ has authored no master templates yet, so there is nothing to instantiate. '
          + 'The library lives on Contracts.',
      }),
    });
  } catch (e) { return mapError(c, e); }
});

// POST /:uid/contract — instantiate the named template at its current version.
//
// THE VERSION IS READ, NOT PASSED. A caller naming a version could instantiate
// an archived one, and the rule the library runs on is that an archived
// version stays binding on contracts that ALREADY carry it — not that it can
// be newly issued. The current version is the only one HQ is offering today.
r.post('/:uid/contract', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);

    const b = await c.req.json().catch(() => ({} as any));
    const slug = str(b?.template_slug, 120);
    if (!slug) return c.json({ error: 'template_slug is required' }, 400);

    await ensureLegalTemplatesSchema(c.env);
    const tpl = await getTemplate(c.env, slug);
    if (!tpl) return c.json({ error: 'template_not_found', template_slug: slug }, 404);
    // D758 — a row with no body is refused before anything is written, so the
    // current draft is not superseded by an empty one.
    if (Number(tpl.is_stub) === 1 || !String(tpl.body_md || '').trim()) {
      const r = templateBodyRefusal(new TemplateBodyError('no_body', tpl.slug), 'admin')!;
      return refuse(c, r.status, { code: r.code, message: r.message });
    }

    const [terr, seats] = await Promise.all([
      c.env.DB.prepare(
        'SELECT country_code FROM licence_territories WHERE licence_id = ? ORDER BY country_code',
      ).bind(licence.id).all<{ country_code: string }>(),
      c.env.DB.prepare(
        'SELECT seat_type, seats_licensed FROM licence_seats WHERE licence_id = ? ORDER BY seat_type',
      ).bind(licence.id).all<{ seat_type: string; seats_licensed: number }>(),
    ]);

    // D803 (#2240): D797's terms fill `{{terms.<key>}}`. With none recorded, or a store
    // that cannot be read, every such field stays visible and is named in `unfilled_fields`.
    let terms: LicenceTerms | null = null;
    try { terms = (await readLicenceTerms(c.env, licence.uid))?.terms ?? null; } catch { terms = null; }
    const { body, unfilled } = renderContract(
      tpl.body_md,
      mergeValues(licence, (terr.results || []).map((t) => t.country_code), seats.results || [], terms),
    );

    // The prior contract is SUPERSEDED, never deleted or edited — the same
    // rule licence_events runs on, and for the same reason: a contract
    // dispute is exactly the case where the overwritten copy was the one that
    // mattered.
    const now = nowIso();
    await c.env.DB.prepare(
      'UPDATE licence_contracts SET superseded_at = ?, updated_at = ? WHERE licence_uid = ? AND superseded_at IS NULL',
    ).bind(now, now, licence.uid).run();

    const uid = newUid();
    await c.env.DB.prepare(
      `INSERT INTO licence_contracts
         (uid, licence_uid, template_slug, template_version, template_title, body_md,
          unfilled_fields, status, created_by_user_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?, 'draft', ?,?,?)`,
    ).bind(
      uid, licence.uid, tpl.slug, tpl.version, tpl.title, body,
      JSON.stringify(unfilled), admin.id, now, now,
    ).run();

    await logEvent(c.env, licence.id, 'contract_instantiated', admin.id, {
      contract_uid: uid, template_slug: tpl.slug, template_version: tpl.version,
      unfilled_fields: unfilled,
    });
    // D272 — the copy carries the latest contract's template_version, so a
    // new contract changes what the branch holds.
    const pushed = await pushLicenceToBranch(c.env, licence.id);

    return c.json({
      uid,
      template_slug: tpl.slug,
      template_version: tpl.version,
      template_title: tpl.title,
      status: 'draft',
      unfilled_fields: unfilled,
      body_md: body,
      // Said here because the screen's next control is Activate, and the rule
      // is the canvas's own.
      note: 'Instantiated unsigned. A pending signature does not block activation; a territory conflict does.',
      pushed,
    }, 201);
  } catch (e) { return mapError(c, e); }
});

// POST /:uid/contract/:contractUid/send — leave draft through the shared envelope helper (D451).
//
// D110 deliberately left `envelope_uid` unwired; the owner's wave-8 direction
// reverses that for the licence agreement without touching esign.ts (Session 13).
r.post('/:uid/contract/:contractUid/send', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);

    const contractUid = c.req.param('contractUid');
    const row = await c.env.DB.prepare(
      `SELECT id, uid, template_slug, status, envelope_uid, superseded_at
         FROM licence_contracts
        WHERE uid = ? AND licence_uid = ?`,
    ).bind(contractUid, licence.uid).first<{
      id: number; uid: string; template_slug: string; status: string;
      envelope_uid: string | null; superseded_at: string | null;
    }>();
    if (!row || row.superseded_at) {
      return c.json({ error: 'contract_not_found', message: 'No current contract with that id exists for this licence.' }, 404);
    }
    if (row.envelope_uid) {
      return c.json({
        error: 'already_sent',
        message: 'This contract already has an envelope. Its status is derived from that envelope on read.',
      }, 409);
    }
    if (row.status !== 'draft') {
      return c.json({ error: 'not_draft', message: 'Only a draft contract can be sent for the first time.' }, 409);
    }

    const recipient = await c.env.DB.prepare(
      `SELECT u.id, u.email, u.name
         FROM licence_admins la
         JOIN users u ON u.id = la.user_id
        WHERE la.licence_id = ? AND u.is_active = 1
        ORDER BY CASE la.admin_role WHEN 'principal' THEN 0 ELSE 1 END, la.id
        LIMIT 1`,
    ).bind(licence.id).first<{ id: number; email: string; name: string | null }>();
    if (!recipient?.email) {
      return c.json({
        error: 'no_signer',
        message: 'No active licence administrator has an account to receive the envelope. Grant an admin on this licence first.',
      }, 409);
    }

    const [terr, seats] = await Promise.all([
      c.env.DB.prepare(
        'SELECT country_code FROM licence_territories WHERE licence_id = ? ORDER BY country_code',
      ).bind(licence.id).all<{ country_code: string }>(),
      c.env.DB.prepare(
        'SELECT seat_type, seats_licensed FROM licence_seats WHERE licence_id = ? ORDER BY seat_type',
      ).bind(licence.id).all<{ seat_type: string; seats_licensed: number }>(),
    ]);

    let sent: Awaited<ReturnType<typeof createAndSendEnvelope>>;
    try {
      sent = await createAndSendEnvelope(c.env, {
        adminUserId: admin.id,
        adminName: admin.name || admin.email,
        recipientUserId: recipient.id,
        recipientEmail: recipient.email,
        recipientName: recipient.name || licence.signatory_name || recipient.email,
        documentType: row.template_slug,
        dealId: row.id,
        appUrl: c.env.APP_URL || 'https://axal.vc',
        mergeFields: mergeFieldsForEnvelope(
          licence,
          (terr.results || []).map((t) => t.country_code),
          seats.results || [],
        ),
        refuseUnfilled: false,
      });
    } catch (e) {
      // D758 — the row lost its body after drafting (or the store could not
      // be read): nothing was sent, and the contract stays a draft.
      const r = templateBodyRefusal(e, 'admin');
      if (r) return refuse(c, r.status, { code: r.code, message: r.message });
      throw e;
    }
    if (!sent) {
      return c.json({ error: 'envelope_send_failed', message: 'The envelope could not be created or sent.' }, 502);
    }

    const now = nowIso();
    await c.env.DB.prepare(
      `UPDATE licence_contracts
          SET status = 'sent', envelope_uid = ?, sent_at = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(sent.envelope_uuid, now, now, row.id).run();

    await logEvent(c.env, licence.id, 'contract_sent', admin.id, {
      contract_uid: row.uid,
      envelope_uuid: sent.envelope_uuid,
      recipient_user_id: recipient.id,
    });

    return c.json({
      contract_uid: row.uid,
      envelope_uuid: sent.envelope_uuid,
      envelope_id: sent.envelope_id,
      signing_url: sent.signing_url,
      email_sent: sent.email_sent,
      already_pending: sent.already_pending ?? false,
      status: 'sent',
      countersignature: { recorded: false, reason: COUNTERSIGN_NOT_RECORDED },
    });
  } catch (e) { return mapError(c, e); }
});

export default r;

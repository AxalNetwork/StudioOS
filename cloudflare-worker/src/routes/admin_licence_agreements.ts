/**
 * D5048 (#5048, part 1 of #5047) — HQ's reads of the canonical package and program agreements. Mounted at
 * `/api/admin/licence-agreements`; the store is `licence_program_agreements` (`services/programAgreements.ts`).
 *
 *   GET  /licences/:licenceUid          every agreement version of one licence, each slot's executed and
 *                                       in-flight version, and each granted program's five legal states
 *   GET  /templates                     D5049: the package and program templates, whether HQ authored each, the merge schema
 *   POST /licences/:licenceUid/drafts   D5049: draft a version from a template's current version   (write bar, reason)
 *   GET  /:uid                          one version and its history
 *   GET  /:uid/preview                  D5049: the stored body, its hash and its readiness: what a send sends
 *   POST /:uid/send                     D5049: send the stored body through e-sign                   (write bar, reason)
 *   POST /:uid/void                     D5049: void a version in flight                              (write bar, reason)
 *
 * WHO. Reads are `requireSuperAdmin`, as the licence ledger and the program grants are read. Every write is
 * `requireSuperAdminWriteBar`, names the revision it read, carries a reason of at least 10 characters, writes
 * its history line in its own batch and an admin audit row (`logAdminAction`). A D1 failure is a 5xx through
 * `mapError`, never an empty list.
 *
 * THE SEND (D5049, reusing D4671's guarantees). A draft is rendered ONCE, from the template's current version
 * and the licence, package, program and grant values as they stood, and stored with its SHA-256. The preview
 * is that stored body; the send passes that stored body to e-sign as a rendered body (D416), after checking it
 * still hashes to what was stored and carries no `{{field}}`; the envelope that comes back must carry the same
 * hash, or nothing is linked. Nothing is ever re-rendered from live data after the draft. A program schedule
 * is not drafted here: it is built from its grant's terms and sent from Program access (D1120, D4805), and
 * written to the same table there (D5048).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import {
  AGREEMENT_KINDS, agreementByUid, agreementEvents, agreementsOfLicence, programLegalState, slotKeyOf, slotsOf,
  type AgreementKind, type AgreementRow,
} from '../services/programAgreements';
import { presentGrant, type LicenceLite } from '../services/programGrants';
import {
  AGREEMENT_TEMPLATES, MERGE_NAMESPACES, agreementMergeValues, catalogRefusal, counselReviewRequired, readinessOf, renderAgreement,
} from '../services/agreementTemplates';
import { ensureLegalTemplatesSchema, getTemplate } from '../services/legalTemplateStore';
import { templateUseRefusal } from '../services/templateSafety';
import { readLicenceTerms } from '../services/licenceTerms';
import { byUid } from '../services/licenceLedgerCore';
import { unresolvedFields } from '../services/licenceContract';
import { createAndSendEnvelope, templateBodyRefusal } from './esign';
import { sha256Hex } from '../services/pdf';
import { clearGuard, decisionGuard, runDecision } from '../services/decisionBatch';
import { logAdminAction } from '../services/adminAudit';

const r = new Hono<{ Bindings: Env }>();
const today = () => new Date().toISOString().slice(0, 10);
export const REASON_MIN = 10;
const refuse = (c: any, status: 400 | 404 | 409 | 422 | 502, error: string, message: string, extra: Record<string, unknown> = {}) =>
  c.json({ error, message, ...extra }, status);

function reasonOf(b: any): string | null {
  const reason = typeof b?.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
  return reason.length >= REASON_MIN ? reason : null;
}
const REASON_REFUSAL = `Say why, in at least ${REASON_MIN} characters. It is the line HQ's record keeps.`;
const KEY = /^[a-z0-9][a-z0-9_-]{0,59}$/;
const optKey = (v: unknown) => (typeof v === 'string' && KEY.test(v) ? v : null);

/** The licence's principal administrator: the person a version is sent to (as the licence contract and the schedule are). */
async function signerOf(env: Env, licenceId: number) {
  return await env.DB.prepare(
    `SELECT u.id, u.email, u.name FROM licence_admins la JOIN users u ON u.id = la.user_id
      WHERE la.licence_id = ? AND u.is_active = 1
      ORDER BY CASE la.admin_role WHEN 'principal' THEN 0 ELSE 1 END, la.id LIMIT 1`,
  ).bind(licenceId).first<{ id: number; email: string; name: string | null }>();
}

function parseList(v: string | null): string[] {
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}

/** A version as the routes answer it: the stored text, and its readiness read from that text. */
function presentVersion(row: AgreementRow & Record<string, any>, signerKnown: boolean) {
  const unresolved = row.body_md ? unresolvedFields(row.body_md) : parseList(row.unresolved_fields_json);
  return {
    ...row,
    merge_values_json: undefined,
    unresolved_fields_json: undefined,
    merge_values: (() => { try { return row.merge_values_json ? JSON.parse(row.merge_values_json) : null; } catch { return null; } })(),
    unresolved_fields: unresolved,
    readiness: readinessOf({ unresolved, slug: row.template_slug, signerKnown, templateMissing: row.body_md ? null : 'This version holds no stored text.' }),
  };
}

r.get('/licences/:licenceUid', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await c.env.DB.prepare('SELECT id, uid, licence_ref, brand_name, kind, status, renews_on FROM territory_licences WHERE uid = ?')
      .bind(c.req.param('licenceUid')).first<LicenceLite & { id: number }>();
    if (!licence) return c.json({ error: 'not_found', message: 'There is no such licence.' }, 404);
    const [rows, grants] = await Promise.all([
      agreementsOfLicence(c.env, licence.uid),
      c.env.DB.prepare('SELECT * FROM program_grants WHERE licence_id = ? ORDER BY program_key').bind(licence.id).all<Record<string, any>>(),
    ]);
    const now = today();
    return c.json({
      licence_uid: licence.uid,
      // D5057: the shared licence identity (`licences.uid`). A territory licence's shared uid is its own uid,
      // so the value is unchanged; what it names is the shared registry row.
      licence_identity: 'shared_licence',
      agreements: rows,
      slots: slotsOf(rows).map((s) => ({ ...s, executed: s.executed?.uid ?? null, in_flight: s.in_flight?.uid ?? null })),
      programs: (grants.results || []).map((g) => programLegalState(g, rows, { grantInForce: presentGrant(g, licence, now).in_force })),
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/templates', async (c) => {
  try {
    await requireSuperAdmin(c);
    await ensureLegalTemplatesSchema(c.env);
    const items = await Promise.all(AGREEMENT_TEMPLATES.map(async (t) => {
      const row = await getTemplate(c.env, t.slug);
      const blocked = row ? templateUseRefusal(row) : null;
      return {
        ...t,
        authored: !!row && !blocked,
        version: row?.version ?? null,
        library_title: row?.title ?? null,
        refusal: row ? (blocked?.message ?? null) : 'HQ has not authored this template in the Contracts library yet.',
        counsel_review: counselReviewRequired(t.slug),
      };
    }));
    return c.json({ items, merge_namespaces: MERGE_NAMESPACES });
  } catch (e) { return mapError(c, e); }
});

// ─────────────────────────────────────────────── D5049: draft

const INSERT_DRAFT = `INSERT INTO licence_program_agreements
  (uid, licence_uid, agreement_kind, slot_key, program_key, program_grant_id, package_offer_uid, package_key, package_version, addendum_key,
   template_slug, template_version, status, body_sha256, title, body_md, merge_values_json, unresolved_fields_json, counsel_review,
   origin, created_at, created_by_user_id, updated_at, revision)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'app', ?, ?, ?, 0)`;

r.post('/licences/:licenceUid/drafts', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const b = await c.req.json().catch(() => ({} as any));
    const reason = reasonOf(b);
    if (!reason) return refuse(c, 400, 'reason_required', REASON_REFUSAL);
    const licence = await byUid(c.env, c.req.param('licenceUid'));
    if (!licence) return refuse(c, 404, 'not_found', 'There is no such licence.');
    const kind = String(b?.agreement_kind || '') as AgreementKind;
    if (!(AGREEMENT_KINDS as readonly string[]).includes(kind)) return refuse(c, 400, 'invalid_kind', 'Choose an agreement kind.');
    if (kind === 'program_schedule') {
      return refuse(c, 409, 'schedule_from_program_access', 'A program schedule is built from its grant’s terms and sent from Program access, so it is not drafted from a template.');
    }
    const scope = { agreement_kind: kind, program_key: optKey(b?.program_key), package_key: optKey(b?.package_key), addendum_key: optKey(b?.addendum_key) };
    const slot = slotKeyOf(scope);
    if (!slot) return refuse(c, 400, 'invalid_scope', 'This kind of agreement needs its program or package (and, for an addendum, its addendum key).');
    const slug = typeof b?.template_slug === 'string' ? b.template_slug.slice(0, 120) : '';
    const wrong = catalogRefusal(slug, kind, scope);
    if (wrong) return refuse(c, 422, 'wrong_template', wrong);
    const packageVersion = b?.package_version == null ? null : Number(b.package_version);
    if (packageVersion !== null && !(Number.isInteger(packageVersion) && packageVersion >= 1)) return refuse(c, 400, 'invalid_package_version', 'A package version is a whole number from 1.');
    const packageOfferUid = typeof b?.package_offer_uid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(b.package_offer_uid) ? b.package_offer_uid : null;

    // The template: its CURRENT version, read now and frozen into the version. A slug HQ has not authored, or
    // one the library restricts, is refused before anything is written.
    await ensureLegalTemplatesSchema(c.env);
    const tpl = await getTemplate(c.env, slug);
    if (!tpl) return refuse(c, 409, 'missing_template', 'HQ has not authored this template in the Contracts library yet, so nothing can be drafted from it.', { template_slug: slug });
    const blocked = templateUseRefusal(tpl);
    if (blocked) return refuse(c, 409, blocked.code, blocked.message, { template_slug: slug });

    const [terr, seats, grant, signer] = await Promise.all([
      c.env.DB.prepare('SELECT country_code FROM licence_territories WHERE licence_id = ? ORDER BY country_code').bind(licence.id).all<{ country_code: string }>(),
      c.env.DB.prepare('SELECT seat_type, seats_licensed FROM licence_seats WHERE licence_id = ? ORDER BY seat_type').bind(licence.id).all<{ seat_type: string; seats_licensed: number }>(),
      scope.program_key
        ? c.env.DB.prepare('SELECT * FROM program_grants WHERE licence_id = ? AND program_key = ?').bind(licence.id, scope.program_key).first<Record<string, unknown>>()
        : Promise.resolve(null),
      signerOf(c.env, licence.id),
    ]);
    let terms = null;
    try { terms = (await readLicenceTerms(c.env, licence.uid))?.terms ?? null; } catch { terms = null; }
    const values = agreementMergeValues({
      licence, territories: (terr.results || []).map((t) => t.country_code), seats: seats.results || [], licenceTerms: terms,
      grant: grant ?? null, program_key: scope.program_key, package_key: scope.package_key, package_version: packageVersion,
      signer: signer ? { name: signer.name, email: signer.email } : null, agreement: { kind, prepared_on: today() },
    });
    const { body, unresolved } = renderAgreement(tpl.body_md, values);
    const sha = await sha256Hex(body);
    const readiness = readinessOf({ unresolved, slug, signerKnown: !!signer?.email });
    const status = readiness.ready ? 'ready' : 'draft';

    // A version already out for signature in this slot is not replaced by a draft: void it first.
    const live = await c.env.DB.prepare(
      "SELECT uid, status FROM licence_program_agreements WHERE licence_uid = ? AND slot_key = ? AND status IN ('sent', 'partially_signed')",
    ).bind(licence.uid, slot).first<{ uid: string; status: string }>();
    if (live) return refuse(c, 409, 'in_flight', 'A version of this agreement is out for signature. Void it before drafting a new one.', { agreement_uid: live.uid });

    const uid = newUid();
    const at = nowIso();
    try {
      await c.env.DB.batch([
        // A draft or ready version of the slot is superseded by this one: history, then the row.
        c.env.DB.prepare(
          `INSERT INTO licence_agreement_events (agreement_uid, licence_uid, action, from_status, to_status, revision, actor_user_id, detail_json, created_at)
           SELECT uid, licence_uid, 'superseded', status, 'superseded', revision + 1, ?, ?, ? FROM licence_program_agreements
            WHERE licence_uid = ? AND slot_key = ? AND status IN ('draft', 'ready')`,
        ).bind(admin.id, JSON.stringify({ superseded_by: uid, reason }), at, licence.uid, slot),
        c.env.DB.prepare(
          `UPDATE licence_program_agreements SET status = 'superseded', superseded_at = ?, superseded_by_uid = ?, updated_at = ?, revision = revision + 1
            WHERE licence_uid = ? AND slot_key = ? AND status IN ('draft', 'ready')`,
        ).bind(at, uid, at, licence.uid, slot),
        c.env.DB.prepare(INSERT_DRAFT).bind(
          uid, licence.uid, kind, slot, scope.program_key, (grant as any)?.id ?? null, packageOfferUid, scope.package_key, packageVersion, scope.addendum_key,
          tpl.slug, tpl.version, status, sha, tpl.title, body, JSON.stringify(values), JSON.stringify(unresolved),
          counselReviewRequired(tpl.slug) ? 1 : 0, at, admin.id, at,
        ),
        c.env.DB.prepare(
          `INSERT INTO licence_agreement_events (agreement_uid, licence_uid, action, from_status, to_status, revision, actor_user_id, detail_json, created_at)
           VALUES (?, ?, 'drafted', NULL, ?, 0, ?, ?, ?)`,
        ).bind(uid, licence.uid, status, admin.id, JSON.stringify({ template_slug: tpl.slug, template_version: tpl.version, body_sha256: sha, unresolved, reason }), at),
      ]);
    } catch (e) {
      if (/UNIQUE/i.test(e instanceof Error ? e.message : '')) {
        return refuse(c, 409, 'agreement_conflict', 'Another version of this agreement was being drafted or sent at the same moment. Reload and try again.');
      }
      throw e;
    }
    await logAdminAction(c.env, admin.id, admin.email, 'licence_agreement_drafted', {
      licence_uid: licence.uid, agreement_uid: uid, slot_key: slot, template_slug: tpl.slug, template_version: tpl.version, body_sha256: sha, reason,
    });
    // D5052: a draft of a slot whose executed version needs replacing is that replacement. The history says so;
    // nothing about the executed version changes, and nothing is sent. Best effort: an older D1 has no store.
    try {
      await c.env.DB.prepare(
        `INSERT INTO licence_legal_events (licence_uid, action, scope_kind, scope_key, program_key, package_key, agreement_uid, agreement_revision, actor_user_id, reason, detail_json, created_at)
         SELECT ?, 'replacement_prepared', CASE WHEN ? IS NOT NULL THEN 'program' ELSE 'package' END, COALESCE(?, ?), ?, ?, ?, 0, ?, ?, json_object('replaces', x.uid, 'slot_key', ?), ?
           FROM licence_program_agreements x
          WHERE x.licence_uid = ? AND x.slot_key = ? AND x.status = 'executed'
            AND EXISTS (SELECT 1 FROM licence_legal_events e WHERE e.action = 'replacement_required' AND e.agreement_uid = x.uid)`,
      ).bind(licence.uid, scope.program_key, scope.program_key, scope.package_key, scope.program_key, scope.package_key, uid, admin.id, reason, slot, at, licence.uid, slot).run();
    } catch (e) { console.warn('[licence-agreements] replacement_prepared not recorded', (e as Error)?.message); }
    const row = await agreementByUid(c.env, uid);
    return c.json({ ok: true, agreement: presentVersion(row as any, !!signer?.email) }, 201);
  } catch (e) { return mapError(c, e); }
});

r.get('/:uid', async (c) => {
  try {
    await requireSuperAdmin(c);
    const row = await agreementByUid(c.env, c.req.param('uid'));
    if (!row) return c.json({ error: 'not_found', message: 'There is no such agreement.' }, 404);
    return c.json({ agreement: row, events: await agreementEvents(c.env, row.uid) });
  } catch (e) { return mapError(c, e); }
});

r.get('/:uid/preview', async (c) => {
  try {
    await requireSuperAdmin(c);
    const row = await agreementByUid(c.env, c.req.param('uid')) as (AgreementRow & Record<string, any>) | null;
    if (!row) return refuse(c, 404, 'not_found', 'There is no such agreement.');
    const licence = await byUid(c.env, row.licence_uid);
    const signer = licence ? await signerOf(c.env, licence.id) : null;
    // What a send sends: the stored body, never a re-render. A backfilled schedule's text is its envelope's.
    let body: string | null = row.body_md ?? null;
    let title: string | null = row.title ?? null;
    if (body === null && row.envelope_uuid) {
      const e = await c.env.DB.prepare('SELECT document_title, document_body FROM esign_envelopes WHERE envelope_uuid = ?')
        .bind(row.envelope_uuid).first<{ document_title: string; document_body: string }>();
      body = e?.document_body ?? null; title = e?.document_title ?? null;
    }
    const computed = body === null ? null : await sha256Hex(body);
    return c.json({
      uid: row.uid, status: row.status, revision: row.revision, title, body_md: body,
      body_sha256: row.body_sha256, body_matches: computed === null ? null : computed === row.body_sha256,
      template_slug: row.template_slug, template_version: row.template_version,
      readiness: presentVersion(row, !!signer?.email).readiness,
    });
  } catch (e) { return mapError(c, e); }
});

// ─────────────────────────────────────────────── D5049: send

const LINK_ENVELOPE = `UPDATE licence_program_agreements SET status = 'sent', envelope_uuid = ?, sent_at = ?, updated_at = ?, revision = revision + 1
  WHERE uid = ? AND revision = ? AND status IN ('draft', 'ready') AND envelope_uuid IS NULL`;
const SENT_EVENT = `INSERT INTO licence_agreement_events (agreement_uid, licence_uid, action, from_status, to_status, revision, actor_user_id, detail_json, created_at)
  SELECT uid, licence_uid, 'sent', ?, 'sent', revision, ?, ?, ? FROM licence_program_agreements WHERE uid = ? AND envelope_uuid = ?`;
/** An envelope nobody has begun signing, voided with its pending recipients. */
const VOID_ENVELOPE = [
  `UPDATE esign_envelopes SET status = 'void', last_error = ?
    WHERE envelope_uuid = ? AND status IN ('sent', 'partially_signed')
      AND NOT EXISTS (SELECT 1 FROM esign_recipients r WHERE r.envelope_id = esign_envelopes.id AND r.status IN ('signing', 'signed'))`,
  `UPDATE esign_recipients SET status = 'void'
    WHERE status = 'pending' AND envelope_id IN (SELECT e.id FROM esign_envelopes e WHERE e.envelope_uuid = ? AND e.status = 'void')`,
] as const;

r.post('/:uid/send', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const b = await c.req.json().catch(() => ({} as any));
    const reason = reasonOf(b);
    if (!reason) return refuse(c, 400, 'reason_required', REASON_REFUSAL);
    const readRevision = Number(b?.revision);
    if (!Number.isInteger(readRevision) || readRevision < 0) return refuse(c, 400, 'revision_required', 'Name the revision of the version you read.');
    const row = await agreementByUid(c.env, c.req.param('uid')) as (AgreementRow & Record<string, any>) | null;
    if (!row) return refuse(c, 404, 'not_found', 'There is no such agreement.');
    if (row.agreement_kind === 'program_schedule') return refuse(c, 409, 'schedule_from_program_access', 'A program schedule is sent from Program access.');
    if (row.envelope_uuid || !['draft', 'ready'].includes(row.status)) {
      return refuse(c, 409, 'not_sendable', `This version is ${row.status}. Only a draft or ready version is sent, once.`, { status: row.status });
    }
    if (row.revision !== readRevision) return refuse(c, 409, 'agreement_changed', 'This version changed since you read it. Read it again.', { revision: row.revision });
    if (!row.body_md || !row.title) return refuse(c, 409, 'no_stored_body', 'This version holds no stored text. Draft it again from its template.');
    // D4671's checks, before a recipient, an envelope or an email exists.
    const storedSha = await sha256Hex(row.body_md);
    if (row.body_sha256 !== storedSha) {
      return refuse(c, 409, 'agreement_body_changed', 'The stored text no longer matches the fingerprint taken when it was drafted. Draft it again from its template.');
    }
    const unresolved = unresolvedFields(row.body_md);
    if (unresolved.length) {
      return refuse(c, 409, 'agreement_incomplete', 'This agreement still has fields that are not filled. Record them, then draft it again.', {
        unresolved_fields: unresolved, readiness: readinessOf({ unresolved, slug: row.template_slug, signerKnown: true }),
      });
    }
    const licence = await byUid(c.env, row.licence_uid);
    if (!licence) return refuse(c, 404, 'not_found', 'The licence this agreement belongs to no longer exists.');
    const signer = await signerOf(c.env, licence.id);
    if (!signer?.email) return refuse(c, 409, 'no_signer', 'No active licence administrator has an account to receive the agreement. Grant an admin on this licence first.');

    let sent: Awaited<ReturnType<typeof createAndSendEnvelope>>;
    try {
      sent = await createAndSendEnvelope(c.env, {
        adminUserId: admin.id, adminName: admin.name || admin.email,
        recipientUserId: signer.id, recipientEmail: signer.email,
        recipientName: signer.name || licence.signatory_name || signer.email,
        documentType: row.template_slug, dealId: row.id, appUrl: c.env.APP_URL || 'https://axal.vc',
        // The stored, previewed body, hashed exactly as given; nothing is merged into it (D416).
        renderedBody: { title: row.title, body: row.body_md },
        templateVersion: row.template_version,
      });
    } catch (e) {
      const t = templateBodyRefusal(e, 'admin');
      if (t) return refuse(c, t.status === 503 ? 502 : 409, t.code, t.message);
      throw e;
    }
    if (!sent) return refuse(c, 502, 'envelope_send_failed', 'The envelope could not be created or sent. Nothing was recorded.');
    // The envelope must carry the stored body's hash; an envelope that was already pending for this signer and
    // document was built from some earlier text and is not linked (D4671).
    const env = await c.env.DB.prepare('SELECT body_sha256 FROM esign_envelopes WHERE envelope_uuid = ?').bind(sent.envelope_uuid).first<{ body_sha256: string | null }>();
    if (!env || env.body_sha256 !== storedSha) {
      return refuse(c, 409, 'envelope_body_mismatch', 'The envelope on file for this signer does not carry this agreement’s text, so it was not linked. Void the pending envelope, then send again.', { envelope_uuid: sent.envelope_uuid });
    }
    const at = nowIso();
    const run = await runDecision(c.env, [
      c.env.DB.prepare(LINK_ENVELOPE).bind(sent.envelope_uuid, at, at, row.uid, readRevision),
      decisionGuard(c.env),
      c.env.DB.prepare(SENT_EVENT).bind(row.status, admin.id, JSON.stringify({ envelope_uuid: sent.envelope_uuid, body_sha256: storedSha, recipient_user_id: signer.id, reason }), at, row.uid, sent.envelope_uuid),
      clearGuard(c.env),
    ]);
    if (run.lost) {
      // Another write won (a second send, a void, a new draft). The envelope this request made is linked to no
      // version, so it can execute nothing; it is voided too, unless someone has begun signing it.
      await c.env.DB.batch([
        c.env.DB.prepare(VOID_ENVELOPE[0]).bind('voided: the agreement version changed while it was being sent', sent.envelope_uuid),
        c.env.DB.prepare(VOID_ENVELOPE[1]).bind(sent.envelope_uuid),
      ]);
      return refuse(c, 409, 'agreement_changed', 'This version changed while it was being sent. The envelope that was made is not linked and was voided. Read it again.');
    }
    await logAdminAction(c.env, admin.id, admin.email, 'licence_agreement_sent', {
      licence_uid: row.licence_uid, agreement_uid: row.uid, envelope_uuid: sent.envelope_uuid, body_sha256: storedSha, reason,
    });
    return c.json({
      ok: true,
      agreement: presentVersion((await agreementByUid(c.env, row.uid)) as any, true),
      envelope: { uuid: sent.envelope_uuid, email_sent: sent.email_sent, signing_url: sent.signing_url },
    });
  } catch (e) { return mapError(c, e); }
});

// ─────────────────────────────────────────────── D5049: void

r.post('/:uid/void', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const b = await c.req.json().catch(() => ({} as any));
    const reason = reasonOf(b);
    if (!reason) return refuse(c, 400, 'reason_required', REASON_REFUSAL);
    const readRevision = Number(b?.revision);
    if (!Number.isInteger(readRevision) || readRevision < 0) return refuse(c, 400, 'revision_required', 'Name the revision of the version you read.');
    const row = await agreementByUid(c.env, c.req.param('uid'));
    if (!row) return refuse(c, 404, 'not_found', 'There is no such agreement.');
    if (row.agreement_kind === 'program_schedule') return refuse(c, 409, 'schedule_from_program_access', 'A program schedule is replaced from Program access, by changing its grant’s terms.');
    if (!['draft', 'ready', 'sent', 'partially_signed'].includes(row.status)) return refuse(c, 409, 'not_voidable', `This version is ${row.status}, so it cannot be voided.`);
    const at = nowIso();
    // The version is voided only while nobody has begun signing its envelope, in the same statement: a
    // signature that lands first wins, and the executed document is never replaced.
    const run = await runDecision(c.env, [
      c.env.DB.prepare(
        `UPDATE licence_program_agreements SET status = 'voided', voided_at = ?, updated_at = ?, revision = revision + 1
          WHERE uid = ? AND revision = ? AND status IN ('draft', 'ready', 'sent', 'partially_signed')
            AND NOT EXISTS (SELECT 1 FROM esign_envelopes e
                             WHERE e.envelope_uuid = licence_program_agreements.envelope_uuid
                               AND (e.status = 'completed'
                                    OR EXISTS (SELECT 1 FROM esign_recipients rr WHERE rr.envelope_id = e.id AND rr.status IN ('signing', 'signed'))))`,
      ).bind(at, at, row.uid, readRevision),
      decisionGuard(c.env),
      c.env.DB.prepare(
        `INSERT INTO licence_agreement_events (agreement_uid, licence_uid, action, from_status, to_status, revision, actor_user_id, detail_json, created_at)
         SELECT uid, licence_uid, 'voided', ?, 'voided', revision, ?, ?, ? FROM licence_program_agreements WHERE uid = ?`,
      ).bind(row.status, admin.id, JSON.stringify({ reason, envelope_uuid: row.envelope_uuid }), at, row.uid),
      c.env.DB.prepare(VOID_ENVELOPE[0]).bind('voided: HQ voided the agreement version', row.envelope_uuid ?? ''),
      c.env.DB.prepare(VOID_ENVELOPE[1]).bind(row.envelope_uuid ?? ''),
      clearGuard(c.env),
    ]);
    if (run.lost) {
      return refuse(c, 409, 'agreement_changed', 'This version changed, or its signer began signing, since you read it. Read it again.');
    }
    await logAdminAction(c.env, admin.id, admin.email, 'licence_agreement_voided', { licence_uid: row.licence_uid, agreement_uid: row.uid, reason });
    return c.json({ ok: true, agreement: await agreementByUid(c.env, row.uid) });
  } catch (e) { return mapError(c, e); }
});

export const mount: RouteMount = { path: '/api/admin/licence-agreements', router: r };
export default r;

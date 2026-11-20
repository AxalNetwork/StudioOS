/**
 * D5585 part 4 (#5585, WorkGraph P1 under the #5577 epic) — the `signed_document` release adapter: the release owner
 * signs a release, through the Worker's existing native e-sign service (`createAndSendEnvelope` and
 * `voidEnvelopeForResend` in `routes/esign.ts`). Preview-only, like every adapter: it runs only inside
 * `drainReleaseEffects`, which is off unless `WORK_GRAPH_RELEASE_DELIVERY` is `preview`, and nothing schedules it.
 * Decision: `documentation/architecture/decisions/D5585-p4.md`.
 *
 * WHO SIGNS. The owner answered on #5585 (2026-11-19): the release owner signs a release. A release line has no owner
 * column; the person who registered it (`work_graph_release_lines.created_by_user_id`, an agent's on-behalf-of user)
 * is its owner. The signer must still be an active account (`users.is_active = 1`, with an email) linked to the
 * release's company (`user_company_links`, the company not archived): that link is how D5579 resolves a WorkGraph
 * tenant today. Otherwise the effect is refused `signer_unavailable` and nothing is sent.
 *
 * ONE ENVELOPE PER EFFECT. The envelope's body is built from the effect alone (its idempotency key, the release line,
 * the manifest uid and digest, the effect's ref): ids only, never content. The e-sign service stores its SHA-256 as
 * `body_sha256`, so the body's hash IS the key's identity, and `lookup` finds the effect's envelope by it before any
 * `send`. An envelope whose signing mail is not recorded as sent is voided through the service and sent again; one the
 * signer received (or has already signed or declined) is never sent again.
 *
 * RETRACTION voids every live envelope of the manifest and ref through `voidEnvelopeForResend`. A signature already
 * given stays, as evidence (retention keeps a taken-down release's decisions and audit the same way).
 *
 * THE EMAIL (D5585-p5). The service mails a `work_graph_release` envelope the release sign-off email
 * (`releaseSignEmailContent` in `services/email.ts`), never the partner agreement email: it names the line, manifest
 * and digest that `releaseSignFacts` reads back from the body, and what signing does.
 *
 * CREDENTIALS. The native service mails the signing link through Gmail. Without `GMAIL_CLIENT_ID`,
 * `GMAIL_CLIENT_SECRET` and `GMAIL_REFRESH_TOKEN` the adapter refuses `target_not_configured` and calls nothing.
 */
import type { Env } from '../types';
import { RELEASE_ENVELOPE_DOC_TYPE, createAndSendEnvelope, voidEnvelopeForResend } from '../routes/esign';
import { sha256Hex } from './pdf';
import { DeliveryRetry, type ReleaseDeliveryAdapter, type ReleaseDeliveryRequest } from './workGraphReleaseDelivery';
import type { EffectTarget } from './workGraphReleases';

/** The document type every release envelope is sent under; the e-sign service mails it the release email (D5585-p5). */
export const RELEASE_SIGN_DOC_TYPE = RELEASE_ENVELOPE_DOC_TYPE;
export const RELEASE_SIGN_TITLE = 'StudioOS release sign-off';
const SENDER_NAME = 'StudioOS releases';
/** Envelope states in which the signer can still sign (and a retraction can void). */
const LIVE = new Set(['sent', 'partially_signed']);
/** Envelope states that ended with nothing delivered: the effect may be sent again. */
const WITHDRAWN = new Set(['void', 'voided', 'cancelled']);

const refuse = (code: string): never => { throw new DeliveryRetry(code); };

/** What the adapter counts: one per e-sign service call (a lookup read, a send, a void). */
export interface SigningMeter { count(t: EffectTarget): void }

/** The envelope body of one release effect. Ids only; deterministic, so its hash names the effect. */
export function releaseSignBody(req: Pick<ReleaseDeliveryRequest, 'idempotencyKey' | 'lineAssetUid' | 'manifestUid' | 'digest' | 'ref'>): string {
  return [
    `# ${RELEASE_SIGN_TITLE}`,
    '',
    'As the owner of this release line, you are asked to sign the release named below. The release is identified by',
    'its manifest and digest; its pieces are not reproduced here.',
    '',
    `- Release line: \`${req.lineAssetUid}\``,
    `- Release: \`${req.manifestUid}\``,
    `- Manifest digest: \`sha256:${req.digest}\``,
    `- Signing request: \`${req.ref}\``,
    `- Release key: \`${req.idempotencyKey}\``,
    '',
  ].join('\n');
}
/**
 * D5585-p5 — the ids a release envelope's body names, read back from the stored body, for the release sign-off email
 * (`signingEmailFor` in `routes/esign.ts`, on the first send, a reminder and a signer's resend). `null` when the body
 * is not one `releaseSignBody` wrote.
 */
export function releaseSignFacts(body: string): { lineAssetUid: string; manifestUid: string; digest: string } | null {
  const lines = String(body ?? '').split('\n');
  if (lines[0] !== `# ${RELEASE_SIGN_TITLE}`) return null;
  const read = (label: string) => {
    const m = lines.map((l) => /^- ([A-Za-z ]+): `(.*)`$/.exec(l)).find((x) => x && x[1] === label);
    return m ? m[2] : null;
  };
  const lineAssetUid = read('Release line');
  const manifestUid = read('Release');
  const digest = /^sha256:([0-9a-f]{64})$/.exec(read('Manifest digest') ?? '')?.[1];
  return lineAssetUid && manifestUid && digest ? { lineAssetUid, manifestUid, digest } : null;
}
const manifestLine = (uid: string) => `- Release: \`${uid}\``;
const refLine = (ref: string) => `- Signing request: \`${ref}\``;

export const signingConfigured = (env: Env) => !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);

interface Owner { userId: number; companyId: number }
interface Signer { id: number; email: string; name: string }
interface EnvelopeRow { id: number; envelope_uuid: string; status: string; body_sha256: string; mailed: number }

export function signedDocumentAdapter(env: Env, meter: SigningMeter): ReleaseDeliveryAdapter {
  const call = async <T>(f: () => Promise<T>): Promise<T> => {
    meter.count('signed_document');
    try { return await f(); } catch (e) {
      if (e instanceof DeliveryRetry) throw e;
      return refuse('provider_unavailable');
    }
  };

  /** The release line's owner, as recorded when the line was registered. */
  const ownerOf = async (req: ReleaseDeliveryRequest): Promise<Owner> => {
    const row = await env.DB.prepare(
      'SELECT company_id, created_by_user_id FROM work_graph_release_lines WHERE line_asset_uid = ?',
    ).bind(req.lineAssetUid).first<{ company_id: number; created_by_user_id: number }>();
    if (!row || !Number.isSafeInteger(row.created_by_user_id)) return refuse('signer_unavailable');
    return { userId: row.created_by_user_id, companyId: row.company_id };
  };

  /** The owner, if they can sign now: an active account with an email, linked to the release's company. */
  const signerOf = async (o: Owner): Promise<Signer> => {
    const u = await env.DB.prepare(
      `SELECT u.id, u.email, u.name FROM users u
        WHERE u.id = ? AND u.is_active = 1 AND u.email IS NOT NULL AND TRIM(u.email) <> ''
          AND EXISTS (SELECT 1 FROM user_company_links l WHERE l.user_id = u.id AND l.company_id = ?
                        AND NOT EXISTS (SELECT 1 FROM company_profiles p WHERE p.id = l.company_id AND p.archived_at IS NOT NULL))`,
    ).bind(o.userId, o.companyId).first<{ id: number; email: string; name: string | null }>();
    if (!u) return refuse('signer_unavailable');
    return { id: u.id, email: String(u.email).trim().toLowerCase(), name: u.name ?? '' };
  };

  /** Everything checked before any e-sign call: credentials, then the signer. */
  const ready = async (req: ReleaseDeliveryRequest) => {
    if (!signingConfigured(env)) refuse('target_not_configured');
    const owner = await ownerOf(req);
    return { owner, signer: await signerOf(owner) };
  };

  /** The effect's own envelopes, by the body hash its key fixes. */
  const ofKey = (userId: number, bodySha: string) => call(async () => ((await env.DB.prepare(
    `SELECT e.id, e.envelope_uuid, e.status, e.body_sha256,
            EXISTS (SELECT 1 FROM esign_audit_events a WHERE a.envelope_id = e.id AND a.action = 'email_sent') AS mailed
       FROM esign_envelopes e
      WHERE e.user_id = ? AND e.document_type = ? AND e.body_sha256 = ? ORDER BY e.id`,
  ).bind(userId, RELEASE_SIGN_DOC_TYPE, bodySha).all<EnvelopeRow>()).results ?? []));
  /** Every envelope of one manifest and ref, whichever key sent it. */
  const ofManifest = (userId: number, req: ReleaseDeliveryRequest) => call(async () => ((await env.DB.prepare(
    `SELECT e.id, e.envelope_uuid, e.status, e.body_sha256,
            EXISTS (SELECT 1 FROM esign_audit_events a WHERE a.envelope_id = e.id AND a.action = 'email_sent') AS mailed
       FROM esign_envelopes e
      WHERE e.user_id = ? AND e.document_type = ? AND instr(e.document_body, ?) > 0 AND instr(e.document_body, ?) > 0 ORDER BY e.id`,
  ).bind(userId, RELEASE_SIGN_DOC_TYPE, manifestLine(req.manifestUid), refLine(req.ref)).all<EnvelopeRow>()).results ?? []));

  /** An envelope the signer has: received (its mail went), or already signed or declined. */
  const delivered = (e: EnvelopeRow) => !WITHDRAWN.has(e.status) && (!LIVE.has(e.status) || !!e.mailed);
  const ext = (uuid: string) => `esign:${uuid}`;
  const voidIt = (uuid: string, reason: string, actor: number) => call(() => voidEnvelopeForResend(env, uuid, reason, actor));

  return {
    async lookup(req) {
      if (req.op === 'publish') {
        const { signer } = await ready(req);
        const found = (await ofKey(signer.id, await sha256Hex(releaseSignBody(req)))).find(delivered);
        return found ? { status: 'confirmed', externalRef: ext(found.envelope_uuid) } : { status: 'absent' };
      }
      // A retraction does not need the signer to be a member still: it is done once nothing is left to sign.
      if (!signingConfigured(env)) refuse('target_not_configured');
      const owner = await ownerOf(req);
      return (await ofManifest(owner.userId, req)).some((e) => LIVE.has(e.status)) ? { status: 'absent' } : { status: 'confirmed', externalRef: null };
    },
    async send(req) {
      if (req.op === 'retract') {
        if (!signingConfigured(env)) refuse('target_not_configured');
        const owner = await ownerOf(req);
        const live = (await ofManifest(owner.userId, req)).filter((e) => LIVE.has(e.status));
        if (!live.length) return { status: 'absent' };
        for (const e of live) {
          if (!(await voidIt(e.envelope_uuid, `release ${req.manifestUid} retracted`, owner.userId))) refuse('signature_in_progress');
        }
        return { status: 'confirmed', externalRef: ext(live[0].envelope_uuid) };
      }

      const { signer } = await ready(req);
      const body = releaseSignBody(req);
      const sha = await sha256Hex(body);
      // An envelope of this key whose mail never went is withdrawn first, so the signer is asked once, by a link that
      // reached them. One the signer already has is never sent again.
      for (const e of await ofKey(signer.id, sha)) {
        if (delivered(e)) return { status: 'confirmed', externalRef: ext(e.envelope_uuid) };
        if (LIVE.has(e.status) && !(await voidIt(e.envelope_uuid, 'release signing mail was not sent', signer.id))) {
          return { status: 'confirmed', externalRef: ext(e.envelope_uuid) }; // being signed: the signer has it
        }
      }
      const out = await call(() => createAndSendEnvelope(env, {
        adminUserId: signer.id, adminName: SENDER_NAME, recipientUserId: signer.id, recipientEmail: signer.email,
        recipientName: signer.name, documentType: RELEASE_SIGN_DOC_TYPE, appUrl: env.APP_URL || 'https://axal.vc',
        viaProvider: 'native', renderedBody: { title: RELEASE_SIGN_TITLE, body },
        format: { kind: 'unilateral', party: 'none' }, templateVersion: null, pageSize: 'letter', cover: 'dark',
      }));
      if (!out) return refuse('provider_unavailable');
      if (out.already_pending) {
        // The service keeps one pending envelope per document, sender and recipient (D410): another release's
        // envelope still waits on this owner. This one is sent once that one is signed, declined or voided.
        const other = (await ofKey(signer.id, sha)).find((e) => e.envelope_uuid === out.envelope_uuid);
        if (!other) refuse('signer_has_pending_release');
        return delivered(other!) ? { status: 'confirmed', externalRef: ext(other!.envelope_uuid) } : refuse('provider_unavailable');
      }
      if (!out.email_sent) {
        await voidIt(out.envelope_uuid, 'release signing mail was not sent', signer.id);
        return refuse('provider_unavailable');
      }
      return { status: 'confirmed', externalRef: ext(out.envelope_uuid) };
    },
  };
}

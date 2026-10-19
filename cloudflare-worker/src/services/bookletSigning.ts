// D759 (#1858) — a submitted Subscription Booklet sent for e-signature.
//
// Two stages, two envelopes, one link table (migration 485):
//
//   applicant  the applicant asks (`POST /api/fund-booklets/mine/sign`) and
//              signs Parts 3 to 8, their own account as sender, subject and
//              the one recipient;
//   gp         sent when the applicant's envelope completes (or again by a
//              Super Admin, `POST /:uid/acceptance`): the Fund's signatory,
//              the HQ Super Admin at `AXAL_COUNTERSIGNER_EMAIL`, signs Part 9
//              and Part 3's Fund line. The applicant stays the sender, so the
//              accepted copy lands in their Documents & agreements.
//
// WHAT IS SIGNED IS THE FROZEN COPY. Each envelope's `document_body` is the
// booklet's `frozen_json`, sent through `createAndSendEnvelope({ renderedBody })`,
// so its `body_sha256` IS the booklet's digest; the send checks it, and every
// page prints the parts at the versions frozen at submit (`frozenBodies`), so
// the applicant signs exactly what they ticked. Native provider only.
//
// A signing token goes only to the route that answers the applicant (the
// caller is that recipient, signed in) and to the recipients' inboxes. It is
// never logged, audited or returned to an Admin. No signature image is stored
// outside the signed PDF.
//
// The state reads (`bookletSigning`, `bookletEdition`, `bodyAtVersion`) live
// in subscriptionBooklet.ts beside the store, so the imports run one way.
//
// NOTE: authored to load under `node --experimental-strip-types` (the worker
// test gate) — no `enum`s, no TS parameter properties.

import type { Env } from '../types';
import { createAndSendEnvelope } from '../routes/esign';
import { AXAL_ENTITIES, AXAL_SIGNATORY_NAME } from './legalDocFormat';
import { DEFAULT_COUNTERSIGNER_EMAIL, type PaperInput, type PartSignature } from './legalPaper';
import { structureForPaper } from './fundStructure';
import {
  BOOKLET_TITLE, BookletRefusal, applicantName, bookletAudience, bookletEdition, bookletPaperInput, bookletSigning,
  bookletStages, frozenBodies, resolveParts, sha256Hex, type BookletRow, type BookletSignatures,
} from './subscriptionBooklet';

export type BookletStage = 'applicant' | 'gp';

const BOOKLET_DOC_TYPE = 'subscription_booklet';
const BOOKLET_FORMAT = { kind: 'booklet', party: 'fund' } as const;

const textChanged = () => new BookletRefusal(409, 'booklet_text_changed',
  'The text you submitted can no longer be rebuilt exactly, so it cannot be signed. Ask Axal VC to withdraw the booklet so you can open a new one.');
const alreadySent = (state: string) => new BookletRefusal(409, 'booklet_already_sent',
  'This booklet is already out for signature. Open the signing link in your email.', { state });
const sendFailed = () => new BookletRefusal(503, 'booklet_send_failed',
  'The booklet could not be sent for signature just now. Try again.');
const notFound = () => new BookletRefusal(404, 'booklet_not_found', 'No subscription booklet here.');

/** Decision 3's titles. */
export function stageTitle(edition: number, stage: BookletStage): string {
  return `${BOOKLET_TITLE} · v${edition} · ${stage === 'applicant' ? 'Parts 3 to 8' : 'Part 9'}`;
}

async function bookletById(env: Env, id: number): Promise<BookletRow | null> {
  return env.DB.prepare(
    `SELECT id, uid, application_id, status, frozen_json, digest, submitted_at, withdrawn_reason, created_at, updated_at
       FROM fund_subscription_booklets WHERE id = ?`,
  ).bind(id).first<BookletRow>();
}

/** The envelope a send produced, as recorded. */
async function envelopeHash(env: Env, envelopeUuid: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT body_sha256 FROM esign_envelopes WHERE envelope_uuid = ?')
    .bind(envelopeUuid).first<{ body_sha256: string | null }>();
  return row?.body_sha256 ?? null;
}

/** Record a stage once: two concurrent sends land one row. */
async function recordStage(env: Env, booklet: BookletRow, envelopeUuid: string, stage: BookletStage): Promise<boolean> {
  const res = await env.DB.prepare(
    `INSERT INTO fund_booklet_envelopes (booklet_id, envelope_uuid, stage, digest)
     SELECT ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM fund_booklet_envelopes WHERE booklet_id = ? AND stage = ?)`,
  ).bind(booklet.id, envelopeUuid, stage, booklet.digest, booklet.id, stage).run();
  return !!(res.meta?.changes && res.meta.changes > 0);
}

/** The frozen copy must still hash to the digest, and its parts rebuild exactly. */
async function assertFrozen(env: Env, booklet: BookletRow): Promise<void> {
  if (!booklet.frozen_json || !booklet.digest || await sha256Hex(booklet.frozen_json) !== booklet.digest) throw textChanged();
  await frozenBodies(env, booklet);
}

async function send(env: Env, booklet: BookletRow, stage: BookletStage, opts: {
  senderId: number; recipientId: number; recipientEmail: string; recipientName: string; appUrl: string; actorIp?: string;
}) {
  const edition = await bookletEdition(env, booklet);
  const out = await createAndSendEnvelope(env, {
    adminUserId: opts.senderId,
    adminName: AXAL_ENTITIES.fund.name,
    recipientUserId: opts.recipientId,
    recipientEmail: opts.recipientEmail,
    recipientName: opts.recipientName,
    documentType: BOOKLET_DOC_TYPE,
    appUrl: opts.appUrl,
    actorIp: opts.actorIp,
    viaProvider: 'native',
    renderedBody: { title: stageTitle(edition, stage), body: booklet.frozen_json as string },
    format: { ...BOOKLET_FORMAT },
    templateVersion: null,
    pageSize: 'letter',
    cover: 'dark',
  }).catch((e) => {
    console.warn('[bookletSigning] send failed', stage, (e as Error)?.name || 'error');
    return null;
  });
  if (!out) throw sendFailed();
  if (out.already_pending) {
    // A concurrent send landed the envelope first: record it as this stage if
    // it carries the digest and no row exists yet, then say it is already out.
    if (await envelopeHash(env, out.envelope_uuid) === booklet.digest) await recordStage(env, booklet, out.envelope_uuid, stage);
    throw alreadySent((await bookletSigning(env, booklet)).state);
  }
  if (await envelopeHash(env, out.envelope_uuid) !== booklet.digest) {
    // Never record an envelope over other words; void it so nobody signs it.
    await env.DB.prepare(`UPDATE esign_envelopes SET status = 'void' WHERE envelope_uuid = ? AND status = 'sent'`)
      .bind(out.envelope_uuid).run();
    throw textChanged();
  }
  if (!await recordStage(env, booklet, out.envelope_uuid, stage)) {
    throw alreadySent((await bookletSigning(env, booklet)).state);
  }
  return out;
}

/**
 * The applicant's stage (decision 5's checks 4 to 8; the route answers 1 to
 * 3). Returns the token for the route's answer alone: the caller is the
 * recipient.
 */
export async function sendApplicantStage(
  env: Env, user: { id: number | string; email?: string | null; name?: string | null }, booklet: BookletRow, appUrl: string, actorIp?: string,
): Promise<{ envelope_uuid: string; token: string }> {
  if (booklet.status !== 'submitted') {
    throw new BookletRefusal(409, 'booklet_not_submitted', 'Submit the booklet first. Only a submitted booklet is sent for signature.');
  }
  if ((await bookletStages(env, booklet.id)).some((s) => s.stage === 'applicant')) {
    throw alreadySent((await bookletSigning(env, booklet)).state);
  }
  const missing = (await resolveParts(env)).filter((p) => p.missing).map((p) => p.part);
  if (missing.length) {
    throw new BookletRefusal(409, 'booklet_part_missing',
      `The booklet cannot be sent for signature yet: Part ${missing.join(', Part ')} has no text from counsel.`, { parts: missing });
  }
  await assertFrozen(env, booklet);
  const email = String(user.email || '').trim();
  if (!email) throw sendFailed();
  const name = (await applicantName(env, booklet.application_id)) || String(user.name || '').trim() || email;
  const out = await send(env, booklet, 'applicant', {
    senderId: Number(user.id), recipientId: Number(user.id), recipientEmail: email, recipientName: name, appUrl, actorIp,
  });
  const token = out.signing_url.split('/esign/').pop() || '';
  return { envelope_uuid: out.envelope_uuid, token };
}

/** The HQ Super Admin who signs for the Fund: the account at the countersigner address. */
async function fundSigner(env: Env): Promise<{ id: number; email: string } | null> {
  const address = String(env.AXAL_COUNTERSIGNER_EMAIL || DEFAULT_COUNTERSIGNER_EMAIL).trim().toLowerCase();
  return env.DB.prepare(
    `SELECT u.id, u.email FROM users u JOIN super_admins s ON s.user_id = u.id
      WHERE lower(u.email) = ? AND u.role = 'admin' LIMIT 1`,
  ).bind(address).first<{ id: number; email: string }>();
}

/** The General Partner's stage (decisions 3, 6 and 7). No token leaves here. */
export async function sendGpStage(env: Env, booklet: BookletRow, appUrl: string): Promise<{ envelope_uuid: string }> {
  if (booklet.status !== 'submitted') throw notFound();
  const stages = await bookletStages(env, booklet.id);
  const applicant = stages.find((s) => s.stage === 'applicant');
  if (!applicant || applicant.status !== 'completed') {
    throw new BookletRefusal(409, 'booklet_not_signed', 'The applicant has not signed yet, so there is nothing for the General Partner to accept.');
  }
  if (stages.some((s) => s.stage === 'gp')) throw alreadySent((await bookletSigning(env, booklet)).state);
  const signer = await fundSigner(env);
  if (!signer) {
    throw new BookletRefusal(409, 'fund_signer_missing',
      'No Super Admin account uses the countersigner address, so the acceptance cannot be sent. Set AXAL_COUNTERSIGNER_EMAIL to the signatory\'s account email.');
  }
  await assertFrozen(env, booklet);
  const app = await env.DB.prepare('SELECT user_id FROM lp_applications WHERE id = ?')
    .bind(booklet.application_id).first<{ user_id: number }>();
  if (!app) throw notFound();
  const out = await send(env, booklet, 'gp', {
    senderId: Number(app.user_id), recipientId: Number(signer.id), recipientEmail: signer.email, recipientName: AXAL_SIGNATORY_NAME, appUrl,
  });
  return { envelope_uuid: out.envelope_uuid };
}

/** The stage an envelope carries, with its booklet, or null for any other envelope. */
export async function bookletLink(env: Env, envelopeUuid: string): Promise<{ booklet: BookletRow; stage: BookletStage } | null> {
  const link = await env.DB.prepare('SELECT booklet_id, stage FROM fund_booklet_envelopes WHERE envelope_uuid = ?')
    .bind(envelopeUuid).first<{ booklet_id: number; stage: BookletStage }>();
  if (!link) return null;
  const booklet = await bookletById(env, link.booklet_id);
  return booklet ? { booklet, stage: link.stage } : null;
}

/** `GET /sign/:token`'s `booklet` field. */
export async function bookletSignInfo(env: Env, envelopeUuid: string): Promise<{ stage: BookletStage; edition: number } | null> {
  const link = await bookletLink(env, envelopeUuid);
  return link ? { stage: link.stage, edition: await bookletEdition(env, link.booklet) } : null;
}

/**
 * Decision 6: the winner of an envelope's completion calls this. The
 * applicant's completion sends the General Partner's stage; it never fails
 * the signature, and logs a code, never a token. Returns the stage it found,
 * so the caller skips the applicant stage's `contract_signed` notices.
 */
export async function onBookletEnvelopeCompleted(env: Env, envelopeUuid: string, appUrl: string): Promise<BookletStage | null> {
  const link = await bookletLink(env, envelopeUuid);
  if (!link) return null;
  if (link.stage === 'applicant') {
    try {
      await sendGpStage(env, link.booklet, appUrl);
    } catch (e) {
      const code = e instanceof BookletRefusal && e.code === 'fund_signer_missing' ? 'fund_signer_missing' : 'booklet_gp_stage_failed';
      console.warn(`[bookletSigning] ${code}`);
    }
  }
  return link.stage;
}

/** The other stage's signed time, for the signed lines. */
async function stageSigned(env: Env, bookletId: number, stage: BookletStage): Promise<{ envelopeUuid: string; signedAt: string } | null> {
  const row = (await bookletStages(env, bookletId)).find((s) => s.stage === stage);
  return row && row.status === 'completed' && row.signed_at ? { envelopeUuid: row.envelope_uuid, signedAt: row.signed_at } : null;
}

/**
 * The paper for a booklet envelope (the signer's page and each signed copy):
 * the frozen parts, this signer's image on their own lines when they are
 * signing, and the other stage's lines as signed (time and envelope, no
 * image: none is stored). Refuses `booklet_text_changed` unless the envelope's
 * body hashes to its `body_sha256` and that is the booklet's digest.
 */
export async function bookletEnvelopeModel(
  env: Env,
  rec: { envelope_uuid: string; document_body: string; body_sha256: string },
  opts: { signature?: { imageDataUrl: string; signedAt: string } | null } = {},
): Promise<PaperInput> {
  const link = await bookletLink(env, rec.envelope_uuid);
  if (!link) throw notFound();
  const { booklet, stage } = link;
  if (!booklet.digest || rec.body_sha256 !== booklet.digest || await sha256Hex(String(rec.document_body || '')) !== rec.body_sha256) {
    throw textChanged();
  }
  const mine: PartSignature | null = opts.signature
    ? { signedAt: opts.signature.signedAt, envelopeUuid: rec.envelope_uuid, imageDataUrl: opts.signature.imageDataUrl }
    : null;
  let signed: BookletSignatures;
  if (stage === 'applicant') {
    signed = { counterparty: mine, axal: null };
  } else {
    const applicant = await stageSigned(env, booklet.id, 'applicant');
    signed = { counterparty: applicant ? { ...applicant, imageDataUrl: null } : null, axal: mine };
  }
  const input = await bookletPaperInput(env, booklet, signed);
  return {
    ...input,
    envelopeUuid: rec.envelope_uuid,
    state: { kind: 'issued' },
    structure: await structureForPaper(env, input.slug, await bookletAudience(env, booklet)),
  };
}

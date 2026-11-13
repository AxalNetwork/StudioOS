/**
 * D1586 (#3833, deck v2 F7) — a data-room proof link behind a shared figure.
 *
 *   GET /api/decks/share/:token/proof/:ref
 *
 * `ref` is a figure's `proof_ref`: a D1602 data-room citation
 * (`dataroom:<file uid>:v<content revision>:p<page>`), which the share read
 * sends only when the link includes `evidence` and requires the NDA
 * (`shareInclude.ts`). The answer is a two-minute signed download of the cited
 * file, the same one the data room's own download mints, and the page.
 *
 * The checks, in this order, each refusing before the next is read:
 *
 *   1. the link: a valid token, live, bound to this browser, with `evidence`
 *      on. A link without it has no proof (404 `no_evidence`).
 *   2. the NDA: the link must require one (404 `no_evidence` otherwise) and
 *      the signed-in reader must have accepted it on this link (`ndaGate`, the
 *      share read's own gate; 403 `nda_required` with the gate's answer).
 *   3. email → account → grant: the link is an investor's own (D1565, a
 *      prospect with an email); the signed-in account is that email, verified
 *      and active; and that account holds an active, unexpired data-room grant
 *      on the deck's venture (`activeGrant`). 403 `not_the_investor` or
 *      `no_grant`.
 *   4. the ref: a data-room citation that a figure this link sends carries
 *      (`sharedProofRefs`), naming a file still tagged as a deck source at that
 *      revision (D1602's `sourceFile`). Anything else is 404 `not_found`: a
 *      bank figure, a quote, any other record, a withdrawn or replaced file.
 *   5. the file's tier: the data room's own rules (`tierAdmits` with the
 *      grant's folder scope; an `nda` file needs the founder's NDA,
 *      `projectNdaActive`). A tier that hides the file answers 404 as the
 *      room's download does; a missing NDA is logged `blocked` and 403.
 *
 * A proof uses no view, and the data room's activity log records the
 * download. An admin is refused, as on the room's download.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import decks, { bindShareViewer, ndaGate, sha256Hex, shareLinkLive, verifySignedToken } from './decks';
import { activeGrant, logAccess, projectNdaActive } from './data_room';
import { DATAROOM_REF, parseShareInclude, shareGatesFor, sharedProofRefs } from '../services/decks/shareInclude';
import { sourceFile } from '../services/decks/dataroomExtract';
import { grantFolderScope, investorCommitted, tierAdmits } from '../services/dataRoomAccess';
import { mintDownloadToken } from '../services/signedDownload';

const deckProof = new Hono<{ Bindings: Env }>();

/** The answer for every ref the link cannot prove: it does not say why. */
const NOT_FOUND = { code: 'not_found', message: 'There is no proof for this figure on this link.' } as const;

type LinkRow = { id: number; deck_id: number; nda_required: number | null; include_json: string | null; prospect_id: number | null };

deckProof.get('/share/:token/proof/:ref', async (c) => {
  const token = c.req.param('token');
  let payload: any;
  try { payload = await verifySignedToken(c.env, token); }
  catch (e: any) {
    if (/expired/i.test(String(e?.message || ''))) return refuse(c, 410, { code: 'link_closed', message: 'This link is no longer open.' });
    return refuse(c, 403, { code: 'forbidden', message: 'This share link is not valid.', raw: e });
  }
  const m = /^deck:(\d+):v(\d+)$/.exec(String(payload?.k || ''));
  if (!m) return refuse(c, 400, { code: 'bad_token_scope', message: 'This share link is not valid.' });
  const deckId = Number(m[1]);
  const hash = await sha256Hex(token);

  // 1. The link: live, this browser's, with evidence on.
  const bind = await bindShareViewer(c, hash);
  if (bind.refused) return refuse(c, 403, { code: 'forwarding_off', message: 'This link was sent to someone else.' });
  if (bind.setCookie) c.header('Set-Cookie', bind.setCookie);
  const live = await shareLinkLive(c.env, hash, bind.viewerHash);
  if (!live || live.deck_id !== deckId) return refuse(c, 410, { code: 'link_closed', message: 'This link is no longer open.' });
  const link = await c.env.DB.prepare(
    'SELECT id, deck_id, nda_required, include_json, prospect_id FROM pitch_deck_share_tokens WHERE id = ?',
  ).bind(live.id).first<LinkRow>();
  if (!link) return refuse(c, 410, { code: 'link_closed', message: 'This link is no longer open.' });
  const include = parseShareInclude(link.include_json);
  // 2. The NDA: proof exists only behind one, accepted on this link by the signed-in reader.
  if (!include.evidence || Number(link.nda_required ?? 0) !== 1) {
    return refuse(c, 404, { code: 'no_evidence', message: 'This link carries no proof.' });
  }
  const gate = await ndaGate(c, Number(link.id), deckId);
  if (gate) return refuse(c, 403, { code: 'nda_required', message: 'Accept the NDA on this link first.', extra: gate });

  // 3. Email → account → grant.
  const user = await requireAuth(c);
  if (user.role === 'admin') return refuse(c, 403, { code: 'support_read_required', message: 'Use an audited support read to open this room.' });
  const deck = await c.env.DB.prepare('SELECT id, project_id, slides FROM pitch_decks WHERE id = ?').bind(deckId).first<{ id: number; project_id: number; slides: string | null }>();
  if (!deck) return refuse(c, 404, NOT_FOUND);
  const projectId = Number(deck.project_id);
  // The same match the room's commitment check makes (`investorCommitted`): the prospect's email is the account's.
  const investor = link.prospect_id == null ? null : await c.env.DB.prepare(
    `SELECT u.id FROM raise_prospects rp JOIN users u ON u.id = ?
      WHERE rp.id = ? AND rp.project_id = ?
        AND rp.email IS NOT NULL AND u.email IS NOT NULL AND LOWER(rp.email) = LOWER(u.email)
        AND u.email_verified = 1 AND u.is_active = 1 AND u.deletion_requested_at IS NULL`,
  ).bind(Number(user.id), Number(link.prospect_id), projectId).first<{ id: number }>();
  if (!investor) return refuse(c, 403, { code: 'not_the_investor', message: 'Sign in with the email this link was sent to.' });
  const grant = await activeGrant(c.env, projectId, Number(user.id));
  if (!grant) return refuse(c, 403, { code: 'no_grant', message: 'The venture has not opened its data room to you.' });

  // 4. The ref: a data-room citation a figure on this link carries, of a file still a deck source at that revision.
  const ref = c.req.param('ref');
  const cited = DATAROOM_REF.exec(ref);
  if (!cited) return refuse(c, 404, NOT_FOUND);
  let slides: unknown = [];
  try { slides = JSON.parse(deck.slides || '[]'); } catch { slides = []; }
  if (!sharedProofRefs(slides, include, await shareGatesFor(c.env, projectId)).has(ref)) return refuse(c, 404, NOT_FOUND);
  const file = await sourceFile(c.env, projectId, cited[1]);
  if (!file || Number(file.deck_source) !== 1 || Number(file.deck_source_revision) !== Number(cited[2])) return refuse(c, 404, NOT_FOUND);

  // 5. The file's tier, as the room's own download checks it.
  const tiered = file as typeof file & { access_tier?: string | null; access_expires_at?: string | null; folder_id?: number | null; visibility?: string };
  if (!tierAdmits(tiered, await investorCommitted(c.env, projectId, Number(user.id)), Date.now(), await grantFolderScope(c.env, grant.id))) {
    return refuse(c, 404, NOT_FOUND);
  }
  if (tiered.visibility !== 'open' && !(await projectNdaActive(c.env, projectId, Number(user.id)))) {
    await logAccess(c.env, projectId, Number(user.id), 'blocked', file.id);
    return refuse(c, 403, { code: 'file_nda_required', message: 'This file requires a signed NDA with the venture.' });
  }
  if (!c.env.FILES) return refuse(c, 503, { code: 'storage_not_configured', message: 'Files are not available right now.' });
  const project = await c.env.DB.prepare('SELECT uid FROM projects WHERE id = ?').bind(projectId).first<{ uid: string }>();
  if (!project) return refuse(c, 404, NOT_FOUND);
  const { token: dl, expires_at } = await mintDownloadToken(c.env, {
    key: file.r2_key, audience: `data_room:${project.uid}`, userId: Number(user.id), ttlSec: 120,
  });
  await logAccess(c.env, projectId, Number(user.id), 'download', file.id);
  const page = Number(cited[3]);
  return c.json({ url: `/api/files/dl/${dl}`, expires_at, name: file.name, page: page > 0 ? page : null });
});

export default deckProof;

/** #4105: `/api/decks`, before `decks`, whose `/:id` routes must not answer a share path. */
export const mount: RouteMount = { path: '/api/decks', router: deckProof, before: [decks] };

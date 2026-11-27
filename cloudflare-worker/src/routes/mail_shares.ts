/**
 * D1342 (#3550, part 3 of #3547) — Network members' address shares, mounted at `/api/mail`.
 *
 *   GET    /shares          the member's Network matches: each one's state on both sides, and the
 *                           other's address only while both have shared (D414 stands everywhere else)
 *   POST   /shares/:uid     { share: true | false } → share the member's own address, or decline
 *   DELETE /shares/:uid     take a share back: the address is hidden from the other at once
 *
 * A pair exists only for a mutually accepted introduction (`services/mail/shares.ts`).
 * Another member's pair is 404, as one that does not exist. A support session
 * changes nothing: an address is the member's own to share.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { MailError } from '../services/mail/contextPack';
import { listShares, revokeShare, setShare } from '../services/mail/shares';
import { refuse } from '../util/refusal';

const mailShares = new Hono<{ Bindings: Env }>();

async function member(c: Context<{ Bindings: Env }>, write: boolean): Promise<User | Response> {
  let user: User;
  try { user = (await requireAuth(c)) as User; } catch { return c.json({ detail: 'Unauthorized' }, 401); }
  if (write && (await selectJwt(c))?.payload.impersonated_by) {
    return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot share a member’s address.' });
  }
  return user;
}

function failure(c: Context<any>, e: unknown): Response {
  if (e instanceof MailError) return refuse(c, e.status, { code: e.code, message: e.sentence });
  return refuse(c, 503, { code: 'shares_unreadable', message: 'Your Network matches could not be read. Try again.', raw: e });
}

mailShares.get('/shares', async (c) => {
  const user = await member(c, false);
  if (user instanceof Response) return user;
  try { return c.json({ items: await listShares(c.env, user) }); } catch (e) { return failure(c, e); }
});

mailShares.post('/shares/:uid', async (c) => {
  const user = await member(c, true);
  if (user instanceof Response) return user;
  const b = await c.req.json().catch(() => ({}));
  if (typeof b?.share !== 'boolean') return refuse(c, 400, { code: 'share_required', message: 'Say whether to share your address: share true or false.' });
  try { return c.json({ share: await setShare(c.env, user, c.req.param('uid'), b.share) }); } catch (e) { return failure(c, e); }
});

mailShares.delete('/shares/:uid', async (c) => {
  const user = await member(c, true);
  if (user instanceof Response) return user;
  try { return c.json({ share: await revokeShare(c.env, user, c.req.param('uid')) }); } catch (e) { return failure(c, e); }
});

export default mailShares;

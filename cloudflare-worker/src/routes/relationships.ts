/**
 * D1356 (#3571, part 7 of #3564) — the team relationship layer, mounted at
 * `/api/relationships`.
 *
 *   GET  /sharing                          my teams, and whether my relationships are shared with each
 *   PUT  /sharing                          { share } — the one opt-in, for every team I belong to
 *   PUT  /sharing/teams/:key               { share } — on or off for one of my teams
 *   GET  /who-knows?person=|company=|fund= the teammates who shared and know them, and how
 *   POST /intro-request                    { teammate, ref, note? } — asks the teammate; sends nothing to the contact
 *   GET  /intro-requests                   the requests I sent and received
 *   POST /intro-requests/:uid/decide       { decision: made | declined } — the teammate's answer
 *
 * Private by default: the access rule is in each statement (`services/relationships.ts`).
 * A support session is refused: what a member shares is theirs to choose.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { decideIntro, introRequests, myTeams, RelationshipRefusal, requestIntro, setShare, whoKnows, whoKnowsQuery } from '../services/relationships';
import { refuse } from '../util/refusal';

const relationships = new Hono<{ Bindings: Env }>();

async function member(c: Context<{ Bindings: Env }>): Promise<User | Response> {
  let user: User;
  try { user = (await requireAuth(c)) as User; } catch { return c.json({ detail: 'Unauthorized' }, 401); }
  if ((await selectJwt(c))?.payload.impersonated_by) {
    return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot read or change a member’s shared relationships.' });
  }
  return user;
}

const body = async (c: Context<any>): Promise<Record<string, unknown>> => {
  const b = await c.req.json().catch(() => ({}));
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
};

function failure(c: Context<any>, e: unknown): Response {
  if (e instanceof RelationshipRefusal) return refuse(c, e.status, { code: e.code, message: e.sentence });
  return refuse(c, 503, { code: 'relationships_unreadable', message: 'Relationships could not be read. Try again.', raw: e instanceof Error ? e.name : 'error' });
}

const share = (b: Record<string, unknown>) => {
  if (typeof b.share !== 'boolean') throw new RelationshipRefusal(400, 'share_required', 'Say whether to share: true or false.');
  return b.share;
};

relationships.get('/sharing', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { return c.json(await myTeams(c.env, user)); } catch (e) { return failure(c, e); }
});

relationships.put('/sharing', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { return c.json(await setShare(c.env, user, '*', share(await body(c)))); } catch (e) { return failure(c, e); }
});

relationships.put('/sharing/teams/:key', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try {
    const key = c.req.param('key');
    if (key === '*') throw new RelationshipRefusal(404, 'not_found', 'Not found.');
    return c.json(await setShare(c.env, user, key, share(await body(c))));
  } catch (e) { return failure(c, e); }
});

relationships.get('/who-knows', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { return c.json(await whoKnows(c.env, user, whoKnowsQuery({ person: c.req.query('person'), company: c.req.query('company'), fund: c.req.query('fund') }))); }
  catch (e) { return failure(c, e); }
});

relationships.post('/intro-request', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { return c.json({ request: await requestIntro(c.env, user, await body(c)) }, 201); } catch (e) { return failure(c, e); }
});

relationships.get('/intro-requests', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { return c.json(await introRequests(c.env, user)); } catch (e) { return failure(c, e); }
});

relationships.post('/intro-requests/:uid/decide', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { return c.json({ request: await decideIntro(c.env, user, c.req.param('uid'), (await body(c)).decision) }); } catch (e) { return failure(c, e); }
});

export default relationships;

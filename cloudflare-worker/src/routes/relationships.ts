/**
 * D1356 (#3571, part 7 of #3564) — the team relationship layer, mounted at
 * `/api/relationships`.
 *
 *   GET  /sharing                          my teams, and whether my relationships are shared with each
 *   PUT  /sharing                          { share } — the one opt-in, for every team I belong to
 *   PUT  /sharing/teams/:key               { share } — on or off for one of my teams
 *   GET  /who-knows?person=|company=|fund= the teammates who shared and know them, and how
 *   POST /who-knows/rank?person=|company=|fund= { query } — #3938 NE1: ranks exactly the people that
 *        read answers against what the member needs; each row is { ref, position, line }
 *   POST /intro-request                    { teammate, ref, note?, context_note? } — asks the teammate; sends nothing to the contact
 *   GET  /intro-requests[?team=&status=]   the requests I sent and received, and my follow-ups due (D4329)
 *   POST /intro-requests/:uid/decide       { decision: accepted | declined, note? } — the teammate's answer, once
 *   POST /intro-requests/:uid/withdraw     the asker withdraws a request not yet answered
 *   POST /intro-requests/:uid/outcome      { outcome, note? } — either side, once it is made
 *   PUT  /intro-requests/:uid/follow-up    { due_on } — my own follow-up on it
 *   POST /intro-requests/:uid/follow-up/done
 *   POST /intro-requests/:uid/follow-up/snooze { until }
 * Made is recorded when the teammate sends the intro from the Email composer
 * (`POST /api/mail/send` with `intro_uid`, D4329), never by a press here.
 *
 * D4330 (#4330): Eadwyn's three drafts, each a quoted proposal (`estimate: true` quotes it and runs
 * nothing); a run is metered like every Eadwyn run, and nothing is stored or sent:
 *   POST /drafts/ask-reason                 { teammate, ref, record?, estimate? } — RI3, for the asker
 *   POST /intro-requests/:uid/drafts/intro  { estimate? } — RI4, for the teammate who accepted
 *   POST /intro-requests/:uid/drafts/follow-up { estimate? } — RI6, either person on a made introduction
 *
 * Private by default: the access rule is in each statement (`services/relationships.ts`).
 * A support session is refused: what a member shares is theirs to choose.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import {
  decideIntro, followUpDone, introRequests, myTeams, recordOutcome, RelationshipRefusal, requestIntro, setFollowUp, setShare, snoozeFollowUp,
  whoKnows, whoKnowsQuery, withdrawIntro,
} from '../services/relationships';
import { refuse } from '../util/refusal';
import { railFor, refuseRun } from '../util/railContext';
import { askReasonInput, followUpInput, introInput, pressDraft, type DraftInput } from '../services/relationshipDrafts';
import { AI_SURFACE } from '../services/aiSurfaces';
import { MATCH_DEPS, MatchRefused, matchRows } from '../services/ai/matchRows';

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

// #3938 NE1 (D1478 task 4, part 5): the member's press ranks the people the who-knows read
// answers, against what they need from an introduction. It runs that same read, so the
// access rule (my team, the teammate's share, a withdrawal) still decides who is a
// candidate, and the read's audit rows are written as for any who-knows read. The text a
// model sees is the person's title and company and how the teammate knows them: never a
// name, an email or a profile URL.
relationships.post('/who-knows/rank', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const query = typeof b?.query === 'string' ? b.query.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  if (!query) return refuse(c, 422, { code: 'query_missing', message: 'Say what you need an introduction for.' });
  let read;
  try { read = await whoKnows(c.env, user, whoKnowsQuery({ person: c.req.query('person'), company: c.req.query('company'), fund: c.req.query('fund') })); }
  catch (e) { return failure(c, e); }
  const candidates = read.people.map((p) => ({
    key: String(p.ref),
    text: [
      p.person.title ? `Title: ${String(p.person.title).slice(0, 200)}` : null,
      p.person.company ? `Company: ${String(p.person.company).slice(0, 200)}` : null,
      `Known through: ${p.how.source_label}`,
      p.how.connected_since ? `Connected since: ${p.how.connected_since}` : null,
    ].filter(Boolean).join('. '),
  }));
  const rail = railFor(c, { page: 'Founder · Network · Introductions', option: null });
  const deps = MATCH_DEPS.make(c.env, { userId: Number(user.id), surface: AI_SURFACE.networkIntroductions, rail, guardText: query }, 'NE1');
  let res;
  try { res = await matchRows(query, candidates, deps, { top: 10 }); } catch (e) {
    if (e instanceof MatchRefused) return refuseRun(c, e.result)!;
    throw e;
  }
  return c.json({ job: 'NE1', steps: res.steps, rows: res.rows.map((r) => ({ ref: Number(r.key), position: r.position, line: r.line })) });
});

relationships.post('/intro-request', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { return c.json({ request: await requestIntro(c.env, user, await body(c)) }, 201); } catch (e) { return failure(c, e); }
});

relationships.get('/intro-requests', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { return c.json(await introRequests(c.env, user, { team: c.req.query('team') || null, status: c.req.query('status') || null })); } catch (e) { return failure(c, e); }
});

relationships.post('/intro-requests/:uid/decide', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { const b = await body(c); return c.json({ request: await decideIntro(c.env, user, c.req.param('uid'), b.decision, b.note) }); } catch (e) { return failure(c, e); }
});

relationships.post('/intro-requests/:uid/withdraw', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { return c.json({ request: await withdrawIntro(c.env, user, c.req.param('uid')) }); } catch (e) { return failure(c, e); }
});

relationships.post('/intro-requests/:uid/outcome', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { return c.json({ request: await recordOutcome(c.env, user, c.req.param('uid'), await body(c)) }); } catch (e) { return failure(c, e); }
});

relationships.put('/intro-requests/:uid/follow-up', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { return c.json({ request: await setFollowUp(c.env, user, c.req.param('uid'), await body(c)) }); } catch (e) { return failure(c, e); }
});

relationships.post('/intro-requests/:uid/follow-up/done', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { return c.json({ request: await followUpDone(c.env, user, c.req.param('uid')) }); } catch (e) { return failure(c, e); }
});

relationships.post('/intro-requests/:uid/follow-up/snooze', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { return c.json({ request: await snoozeFollowUp(c.env, user, c.req.param('uid'), await body(c)) }); } catch (e) { return failure(c, e); }
});

// D4330: one press of a draft button. The input is read under the access rule first, so a request or a
// relationship the caller cannot see is 404 before anything is quoted or run.
const DRAFT_PAGE = 'Founder · Network · Introductions';
async function draftPress(c: Context<{ Bindings: Env }>, read: (user: User, b: Record<string, unknown>) => Promise<DraftInput>) {
  const user = await member(c);
  if (user instanceof Response) return user;
  let input: DraftInput;
  const b = await body(c);
  try { input = await read(user, b); } catch (e) { return failure(c, e); }
  const out = await pressDraft(c.env, user, input, railFor(c, { page: DRAFT_PAGE, option: null }), b.estimate === true);
  if (out.ok) return c.json('estimate' in out ? { estimate: out.estimate } : { draft: out.draft });
  if (out.refusal !== null) return refuseRun(c, { refusal: out.refusal, error: out.error }) ?? refuse(c, 503, { code: 'draft_unreadable', message: 'Eadwyn could not draft this. Try again.' });
  return refuse(c, 503, { code: out.code, message: out.message });
}

relationships.post('/drafts/ask-reason', (c) => draftPress(c, (user, b) => askReasonInput(c.env, user, b)));
relationships.post('/intro-requests/:uid/drafts/intro', (c) => draftPress(c, (user) => introInput(c.env, user, c.req.param('uid'))));
relationships.post('/intro-requests/:uid/drafts/follow-up', (c) => draftPress(c, (user) => followUpInput(c.env, user, c.req.param('uid'))));

export default relationships;

/**
 * D1341 (#3549, part 2 of #3547) — Eadwyn's email drafts, mounted at `/api/mail`.
 *
 *   GET    /context?person=<kind:id>[&project=]  the context pack: the person's record (selected) and the company's items
 *   POST   /blocks    { kind, ref?, project? }   one live update block, computed now; `{ block: null }` when there is none
 *   POST   /drafts    { person, intent, tone, length, refs[], blocks[], project?, estimate? }
 *   POST   /drafts/:uid/revise { instruction, project?, estimate? }
 *   GET    /drafts[?person=]   GET /drafts/:uid   DELETE /drafts/:uid   the member's own drafts only
 *
 * A draft is one `mail_draft` run (`services/aiRouter.ts`), held and settled in
 * AI tokens by the router like every rail run; `estimate: true` quotes the
 * same run first and runs nothing. A ref the member cannot read is 404 in the
 * same words as one that does not exist. A support session drafts nothing: an
 * email is the member's own words.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { quoteRun, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { computeBlock, isBlockKind } from '../services/mail/blocks';
import { contextPack, MailError, NOT_FOUND, parseRef, personRecord } from '../services/mail/contextPack';
import {
  blocksNow, deleteDraft, draftAsk, draftMessages, draftOf, listDrafts, MAX_TOKENS, parentAsk,
  projectParam, revisionInstruction, runDraft, ticked, type DraftAsk, type Revision,
} from '../services/mail/drafts';
import type { Block } from '../services/mail/blocks';
import type { Pack, PackItem } from '../services/mail/contextPack';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import { caseOnly } from '../services/mail/profileRecords';

const mail = new Hono<{ Bindings: Env }>();
const PAGE = 'Email';
const OPTION = 'draft:email';

async function member(c: Context<{ Bindings: Env }>): Promise<User | Response> {
  let user: User;
  try { user = (await requireAuth(c)) as User; } catch { return c.json({ detail: 'Unauthorized' }, 401); }
  if ((await selectJwt(c))?.payload.impersonated_by) {
    return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot draft a member’s email.' });
  }
  return user;
}

const body = async (c: Context<any>): Promise<Record<string, unknown>> => {
  const b = await c.req.json().catch(() => ({}));
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
};

function failure(c: Context<any>, e: unknown): Response {
  if (e instanceof MailError) return refuse(c, e.status, { code: e.code, message: e.sentence });
  return refuse(c, 503, { code: 'mail_unreadable', message: 'The records for this email could not be read. Try again.', raw: e });
}

function runOptions(c: Context<any>, user: User, pack: Pack, ask: DraftAsk, sources: PackItem[], blocks: Block[], revision: Revision | null): RunOptions {
  return {
    task: 'mail_draft', userId: Number(user.id), messages: draftMessages(pack, ask, sources, blocks, revision), maxTokens: MAX_TOKENS[ask.length],
    rail: railFor(c, { page: PAGE, option: OPTION }, pack.person.ref),
  };
}

/** One press: the estimate, or the run, its draft stored with its sources and the router's charge. */
async function press(c: Context<any>, user: User, b: Record<string, unknown>, parent: { uid: string; revision: Revision } | null) {
  const { ask, pack } = await draftAsk(c.env, user, b);
  const sources = ticked(pack, ask.refs);
  const blocks = await blocksNow(c.env, user, pack, ask);
  const opts = runOptions(c, user, pack, ask, sources, blocks, parent?.revision ?? null);
  if (b.estimate === true) {
    const q = await quoteRun(c.env, { ...opts, surface: AI_SURFACE.mailDraft, rail: opts.rail });
    if (!q.ok) return refuseRun(c, { refusal: q.refusal, error: q.error }) ?? refuse(c, 503, { code: 'estimate_unreadable', message: 'The cost of this draft could not be worked out. Try again.' });
    return c.json({ estimate: { hold_microusd: q.hold_microusd, model: q.model }, sources: sources.map(({ ref, label, as_of, link }) => ({ ref, label, as_of, link })), blocks: blocks.map(({ kind, as_of, link }) => ({ kind, as_of, link })) });
  }
  // D1343: the run and the store are `runDraft`'s, shared with the MCP tool `mail_draft`.
  const out = await runDraft(c.env, user, { ask, pack, sources, blocks, parent, rail: opts.rail });
  if (out.ok) return c.json({ draft: out.draft }, 201);
  if (out.refusal !== null) return refuseRun(c, { refusal: out.refusal, error: out.error }) ?? refuse(c, 503, { code: 'draft_unreadable', message: 'Eadwyn could not draft this email. Try again.' });
  return refuse(c, 503, { code: out.code, message: out.message });
}

mail.get('/context', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { return c.json(await contextPack(c.env, user, c.req.query('person'), projectParam(c.req.query('project')))); }
  catch (e) { return failure(c, e); }
});

mail.post('/blocks', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try {
    const b = await body(c);
    if (!isBlockKind(b.kind)) return refuse(c, 400, { code: 'block_invalid', message: 'Choose an update block: KPIs, raise status, project progress, interview insights or the one-liner.' });
    // D1348 (#3555): an admin's email quotes the case they hold, never a venture's live block.
    if (caseOnly(user)) return refuse(c, 403, { code: 'case_only', message: 'An admin’s email quotes the case only.' });
    // The venture is the person's when a ref names one, else the one named.
    let projectId = projectParam(b.project);
    if (b.ref != null && b.ref !== '') {
      if (!parseRef(b.ref)) return refuse(c, 404, { code: 'not_found', message: NOT_FOUND });
      projectId = (await personRecord(c.env, user, b.ref)).person.project_id ?? projectId;
    }
    if (projectId == null) return refuse(c, 400, { code: 'project_required', message: 'Choose the company this update is about.' });
    const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(projectId).first<{ id: number; founder_id: number | null }>();
    return c.json({ block: project ? await computeBlock(c.env, user, b.kind, project) : null });
  } catch (e) { return failure(c, e); }
});

mail.post('/drafts', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try { return await press(c, user, await body(c), null); } catch (e) { return failure(c, e); }
});

mail.post('/drafts/:uid/revise', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try {
    const b = await body(c);
    const parent = await parentAsk(c.env, user, c.req.param('uid'));
    if (!parent) return refuse(c, 404, { code: 'not_found', message: 'Draft not found.' });
    const revision = { subject: parent.row.subject, body: parent.row.body, instruction: revisionInstruction(b.instruction) };
    return await press(c, user, { ...parent.body, project: b.project, estimate: b.estimate }, { uid: parent.row.uid, revision });
  } catch (e) { return failure(c, e); }
});

mail.get('/drafts', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const person = c.req.query('person');
  try { return c.json({ drafts: await listDrafts(c.env, user, person && parseRef(person) ? person : null) }); } catch (e) { return failure(c, e); }
});

mail.get('/drafts/:uid', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try {
    const draft = await draftOf(c.env, user, c.req.param('uid'));
    return draft ? c.json({ draft }) : refuse(c, 404, { code: 'not_found', message: 'Draft not found.' });
  } catch (e) { return failure(c, e); }
});

mail.delete('/drafts/:uid', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try {
    return await deleteDraft(c.env, user, c.req.param('uid')) ? c.json({ ok: true }) : refuse(c, 404, { code: 'not_found', message: 'Draft not found.' });
  } catch (e) { return failure(c, e); }
});

export default mail;

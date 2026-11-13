/**
 * D955 (#2788) — Admin › Programs › proposals: a studio's drafts and Send to
 * HQ, its own list, HQ's queue and the Super Admin's decision. Mounted at
 * /api/admin/programs/proposals, before the /api/admin/programs router, whose
 * `/:key` would otherwise answer `proposals`.
 *
 *   POST  /                    start a draft (requireAdmin)                           → 201 { proposal }
 *   PATCH /:uid                save any fields of a draft or sent-back one (requireAdmin) → { proposal } (its updated_at is "Draft saved")
 *   POST  /:uid/send           Send to HQ (requireAdmin; closed while OD-PROP is open: 403 proposals_closed)
 *   GET   /mine?q=&status=&sort=newest|oldest&page=   Your proposals (requireAdmin)   → { rows, total, page, page_size }
 *   GET   /?q=&status=&licence=&sort=oldest|newest&page=  HQ's queue (requireSuperAdmin) → { rows, total, page, page_size, counts }
 *   GET   /:uid                one proposal: the studio's own, or for a Super Admin any not a draft
 *   POST  /:uid/decision       { outcome, note } (requireSuperAdmin)                  → { proposal }
 *
 * A proposal another studio owns is 404 `unknown_proposal`, as for one that
 * does not exist. `requireAdmin` answers a frozen admin's write with 423, and
 * `requireSuperAdmin` refuses on a branch (D106). The rules are in
 * `services/programProposals.ts`.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { isSuperAdmin, requireAdmin, requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { ProgramError } from '../services/programRegistry';
import {
  ProposalsClosed, decide, hqQueue, myProposals, parseListQuery, proposalDetail, saveDraft, sendProposal, startDraft, studioOf,
} from '../services/programProposals';

const r = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

function answer(c: C, e: unknown) {
  if (e instanceof ProposalsClosed) return refuse(c, 403, { code: 'proposals_closed', message: e.sentence, extra: { code: 'proposals_closed' } });
  if (e instanceof ProgramError) {
    const missing = (e as ProgramError & { missing?: string[] }).missing;
    return refuse(c, e.status, { code: e.code, message: e.sentence, extra: { code: e.code, ...(missing ? { missing } : {}) } });
  }
  return mapError(c, e);
}

async function studioActor(c: C) {
  const user = await requireAdmin(c);
  const id = Number(user.id);
  return { id, email: String(user.email || ''), studio: await studioOf(c.env, id), superAdmin: isSuperAdmin(user as any) };
}

const json = (c: C) => c.req.json().catch(() => ({}));

r.post('/', async (c) => {
  try {
    const a = await studioActor(c);
    return c.json({ proposal: await startDraft(c.env, a, await json(c)) }, 201);
  } catch (e) {
    return answer(c, e);
  }
});

// Literal paths before `/:uid`.
r.get('/mine', async (c) => {
  try {
    const a = await studioActor(c);
    const q = parseListQuery((k) => c.req.query(k), 'newest');
    if (!q.ok) return c.json({ code: q.code, detail: q.detail }, 400);
    return c.json(await myProposals(c.env, a, q.query));
  } catch (e) {
    return answer(c, e);
  }
});

r.get('/', async (c) => {
  try {
    await requireSuperAdmin(c);
    const q = parseListQuery((k) => c.req.query(k), 'oldest');
    if (!q.ok) return c.json({ code: q.code, detail: q.detail }, 400);
    return c.json(await hqQueue(c.env, q.query));
  } catch (e) {
    return answer(c, e);
  }
});

r.get('/:uid', async (c) => {
  try {
    const a = await studioActor(c);
    return c.json({ proposal: await proposalDetail(c.env, c.req.param('uid'), a) });
  } catch (e) {
    return answer(c, e);
  }
});

r.patch('/:uid', async (c) => {
  try {
    const a = await studioActor(c);
    return c.json({ proposal: await saveDraft(c.env, c.req.param('uid'), a, await json(c)) });
  } catch (e) {
    return answer(c, e);
  }
});

r.post('/:uid/send', async (c) => {
  try {
    const a = await studioActor(c);
    return c.json({ proposal: await sendProposal(c.env, c.req.param('uid'), a) });
  } catch (e) {
    return answer(c, e);
  }
});

r.post('/:uid/decision', async (c) => {
  try {
    const user = await requireSuperAdmin(c);
    return c.json({ proposal: await decide(c.env, c.req.param('uid'), await json(c), { id: Number(user.id), email: String(user.email || '') }) });
  } catch (e) {
    return answer(c, e);
  }
});

export default r;

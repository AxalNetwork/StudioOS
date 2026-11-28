/**
 * D4535 part 2 (#4535): composable skill workflows, the routes that run
 * nothing. Mounts itself at `/api/skill-workflows`, behind the same
 * `TEAM_AGENTS_ENABLED` switch as the agent and skill routes (404
 * `team_agents_off`).
 *
 * The owner scope is `?company=<company uid>` (a company's workflows) or no
 * `company` (HQ's). Every route takes it, resolves it against the caller's own
 * links and binds the resolved id in the store; a workflow of another scope
 * reads as absent (404 `not_found`).
 *
 *   GET  /                            the owner's workflows: { workflows: [{ uid, slug, name, status, current_version, has_draft, updated_at }] }
 *   POST /                            { definition }: a new DRAFT. The server mints the uid; an `owner` left out is the
 *                                     caller's scope. 201 { workflow }
 *   GET  /:uid                        { workflow: { uid, slug, status, current_version, draft, versions } }
 *   PUT  /:uid                        { definition }: save the draft in place (shape-checked; slug fixed). 200 { workflow }
 *   GET  /:uid/versions/:version      a published version: { version, definition, definition_hash }
 *   POST /validate                    { definition }: the full check (`validateWorkflow`) against D1's facts
 *   POST /:uid/validate               the saved draft, checked as it would publish
 *     ?run_company=<uid>              the company whose agents would run it: required for an HQ workflow, and a
 *                                     company workflow runs only in its own company
 *     → 200 { ok, refusals, order, levels, resolved, run_company, not_checked }
 *
 * GATES. An HQ workflow is read and written by a Super Admin only (403
 * `not_super_admin`). A company's workflows are read and written by its
 * editors only (`canEditAsMember`): a member who is not an editor is 403
 * `not_editor`; anyone else, a Super Admin without an editor's seat included,
 * gets 404 `not_found`, as for a company that does not exist. HQ moderates a
 * company's skills and never writes them (D4161); the same holds here. A draft
 * save writes the admin audit row with the definition hash before and after.
 *
 * WHAT IS NOT HERE, AND WHY (D4535-p2.md). No publish, run, cancel or run
 * detail route, and no run timeline: publishing needs #4533's qualified-version
 * identity and #4536's budget evidence (D4535 §8), running needs both and the
 * execution slice, and the run detail is the timeline #8823's design has not
 * drawn. Validation runs nothing, plans nothing and writes nothing; its reply
 * names the checks it cannot make yet (`not_checked`).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, isSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { canEditAsMember } from '../services/companyAccess';
import { logAdminAction } from '../services/adminAudit';
import { teamAgentsEnabled } from './team_agents';
import { isAdmin, newUid } from './_t13t14t15_helpers';
import { canonical, checkShape, validateWorkflow, type OwnerScope, type WorkflowDefinition } from '../services/agents/skillWorkflow';
import { listVersions, listWorkflows, readVersion, readWorkflow, saveDraft } from '../services/agents/skillWorkflowStore';
import { NOT_CHECKED, workflowContext } from '../services/agents/skillWorkflowContext';
import type { SkillRow } from '../services/agents/skillLinks';

type C = Context<{ Bindings: Env }>;
const skillWorkflows = new Hono<{ Bindings: Env }>();

skillWorkflows.use('*', async (c, next) => {
  if (!teamAgentsEnabled(c.env)) return c.json({ error: 'team_agents_off' }, 404);
  await next();
});

/** The largest definition body accepted, in bytes. */
export const BODY_MAX = 64 * 1024;
const UID_RE = /^[0-9a-f]{32}$/;

const say = (c: C, status: number, code: string, message: string, extra?: Record<string, unknown>) => refuse(c, status, { code, message, extra });
const notFound = (c: C) => say(c, 404, 'not_found', 'There is no such workflow.');

type Company = { id: number; uid: string; company_name: string; archived_at: string | null };
async function companyByUid(env: Env, uid: string): Promise<Company | null> {
  return env.DB.prepare('SELECT id, uid, company_name, archived_at FROM company_profiles WHERE uid = ?').bind(uid).first<Company>();
}
async function isMember(env: Env, companyId: number, user: User): Promise<boolean> {
  if (isAdmin(user)) return true;
  return !!(await env.DB.prepare('SELECT 1 AS ok FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(companyId, user.id).first());
}

type Owner = { owner: OwnerScope; company: Company | null; user: User };

/**
 * The owner scope the caller may write, from `?company=` and the caller's own
 * links; a Response when refused. Nothing in the body or path chooses it.
 */
async function ownerOf(c: C): Promise<Owner | Response> {
  const user = await requireAuth(c);
  const uid = c.req.query('company');
  if (uid == null || uid === '') {
    if (!isSuperAdmin(user as any)) return say(c, 403, 'not_super_admin', "Only a Super Admin works on HQ's workflows.");
    return { owner: { scope: 'hq', company_id: null }, company: null, user };
  }
  const company = await companyByUid(c.env, uid);
  if (!company || company.archived_at) return say(c, 404, 'not_found', 'There is no such company.');
  if (!(await canEditAsMember(c.env, company, user))) {
    const member = await hasSeat(c.env, company.id, user);
    return member ? say(c, 403, 'not_editor', "Only the company's editors work on its workflows.") : say(c, 404, 'not_found', 'There is no such company.');
  }
  return { owner: { scope: 'company', company_id: company.id }, company, user };
}
/** A seat at the company, whatever its role (a Super Admin's admin role does not count here). */
async function hasSeat(env: Env, companyId: number, user: User): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 AS ok FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(companyId, user.id).first());
}

/** A JSON object body of at most BODY_MAX bytes; a Response when it is not. */
async function bodyOf(c: C): Promise<Record<string, any> | Response> {
  const text = await c.req.text().catch(() => '');
  if (new TextEncoder().encode(text).length > BODY_MAX) return say(c, 413, 'body_too_large', `A workflow is at most ${BODY_MAX / 1024} KB.`);
  let b: unknown = null;
  try { b = text ? JSON.parse(text) : {}; } catch { b = null; }
  return b && typeof b === 'object' && !Array.isArray(b) ? b as Record<string, any> : say(c, 400, 'body_invalid', 'Send a JSON object.');
}

/**
 * The definition from the body, with the server's uid and, when it names none,
 * the caller's owner; a Response when it is not an object. `mint`: the uid is
 * new, so whatever the body names is replaced; otherwise a different uid is
 * refused.
 */
function definitionFrom(c: C, body: Record<string, any>, uid: string, owner: OwnerScope, mint = false): Record<string, any> | Response {
  const d = body.definition;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return say(c, 400, 'definition_required', 'Send the workflow as `definition`.');
  if (!mint && d.uid !== undefined && d.uid !== uid) return say(c, 400, 'uid_mismatch', "The definition's uid is not this workflow's.");
  return { ...d, uid, ...(d.owner === undefined ? { owner } : {}) };
}

const ownerLabel = (o: OwnerScope) => (o.scope === 'hq' ? 'skill_workflow' : 'company_skill_workflow');
const hashOf = async (json: string | null) => {
  if (!json) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Save through the store; the refusal as a reply, else the audit row and the workflow. */
async function save(c: C, o: Owner, def: Record<string, any>, before: string | null) {
  // A company cannot claim HQ's reference provenance.
  if (o.owner.scope === 'company' && def.provenance?.origin === 'hq_reference') {
    return say(c, 422, 'provenance_invalid', "A company's workflow is company_authored or copied, never HQ's reference.");
  }
  const r = await saveDraft(c.env, o.user.id, o.owner, def);
  if (!r.ok) {
    const status = r.code === 'definition_invalid' || r.code === 'not_a_draft' ? 422
      : r.code === 'workflow_out_of_scope' ? 403 : 409;
    return say(c, status, r.code, MESSAGES[r.code] ?? 'The draft was not saved.', r.refusals ? { refusals: r.refusals } : undefined);
  }
  const after = canonical(def);
  if (before !== after) {
    await logAdminAction(c.env, o.user.id, o.user.email, `${ownerLabel(o.owner)}_draft_${r.created ? 'created' : 'saved'}`, {
      workflow_uid: r.uid, ...(o.company ? { company_uid: o.company.uid } : {}),
      before: before ? { definition_hash: await hashOf(before) } : null, after: { definition_hash: await hashOf(after) },
    });
  }
  return c.json({ workflow: await detail(c.env, o.owner, r.uid) }, r.created ? 201 : 200);
}

const MESSAGES: Record<string, string> = {
  definition_invalid: 'The workflow does not have the required shape; see `refusals`.',
  not_a_draft: 'Only a draft is saved here; lifecycle must be draft.',
  workflow_out_of_scope: "The definition's owner is not this scope.",
  uid_taken: 'That uid is taken.',
  slug_taken: 'A workflow in this scope already has that slug.',
  slug_immutable: "A workflow's slug does not change.",
  workflow_retired: 'A retired workflow takes no draft.',
};

async function detail(env: Env, owner: OwnerScope, uid: string) {
  const w = await readWorkflow(env, owner, uid);
  if (!w) return null;
  return {
    uid: w.uid, slug: w.slug, status: w.status, current_version: w.current_version,
    draft: w.draft_json ? JSON.parse(w.draft_json) : null, versions: (await listVersions(env, owner, uid)) ?? [],
  };
}

/** The run company: the owner's own for a company workflow; named, and real, for HQ's. */
async function runCompanyOf(c: C, o: Owner): Promise<Company | Response> {
  const asked = c.req.query('run_company');
  if (o.company) {
    if (asked && asked !== o.company.uid) return say(c, 400, 'run_company_not_allowed', "A company's workflow runs only in that company.");
    return o.company;
  }
  if (!asked) return say(c, 400, 'run_company_required', 'Name the company whose agents would run it (`run_company`).');
  const company = await companyByUid(c.env, asked);
  if (!company || company.archived_at) return say(c, 404, 'not_found', 'There is no such company.');
  return company;
}

/** The full check of `def` against D1's facts for the run company. Reads only. */
async function validate(c: C, o: Owner, def: unknown) {
  const shape = checkShape(def);
  const run = await runCompanyOf(c, o);
  if (run instanceof Response) return run;
  const base = { run_company: run.uid, not_checked: [...NOT_CHECKED] };
  if (shape.length) return c.json({ ok: false, refusals: shape, ...base });
  const readable = async (s: SkillRow) => {
    if (s.scope === 'company' && !(s.company_id != null && await isMember(c.env, s.company_id, o.user))) return false;
    if (s.current_version > 0) return true;
    return s.scope === 'hq' ? isSuperAdmin(o.user as any) : s.company_id != null && canEditAsMember(c.env, { id: s.company_id }, o.user);
  };
  const ctx = await workflowContext(c.env, run.id, def as WorkflowDefinition, readable);
  const v = validateWorkflow(def, ctx);
  if (!v.ok) return c.json({ ok: false, refusals: v.refusals, ...base });
  return c.json({ ok: true, refusals: [], order: v.order, levels: v.levels, resolved: v.resolved, ...base });
}

skillWorkflows.get('/', async (c) => {
  const o = await ownerOf(c);
  if (o instanceof Response) return o;
  return c.json({ workflows: await listWorkflows(c.env, o.owner) });
});

skillWorkflows.post('/validate', async (c) => {
  const o = await ownerOf(c);
  if (o instanceof Response) return o;
  const body = await bodyOf(c);
  if (body instanceof Response) return body;
  // An unsaved definition may name no uid yet; it is checked under a throwaway one.
  const d = definitionFrom(c, body, typeof body.definition?.uid === 'string' ? body.definition.uid : newUid(), o.owner);
  if (d instanceof Response) return d;
  return validate(c, o, d);
});

skillWorkflows.post('/', async (c) => {
  const o = await ownerOf(c);
  if (o instanceof Response) return o;
  const body = await bodyOf(c);
  if (body instanceof Response) return body;
  const def = definitionFrom(c, body, newUid(), o.owner, true);
  if (def instanceof Response) return def;
  return save(c, o, def, null);
});

skillWorkflows.get('/:uid', async (c) => {
  const o = await ownerOf(c);
  if (o instanceof Response) return o;
  const uid = c.req.param('uid');
  if (!UID_RE.test(uid)) return notFound(c);
  const w = await detail(c.env, o.owner, uid);
  return w ? c.json({ workflow: w }) : notFound(c);
});

skillWorkflows.put('/:uid', async (c) => {
  const o = await ownerOf(c);
  if (o instanceof Response) return o;
  const uid = c.req.param('uid');
  const w = UID_RE.test(uid) ? await readWorkflow(c.env, o.owner, uid) : null;
  if (!w) return notFound(c);
  const body = await bodyOf(c);
  if (body instanceof Response) return body;
  const def = definitionFrom(c, body, uid, o.owner);
  if (def instanceof Response) return def;
  return save(c, o, def, w.draft_json);
});

skillWorkflows.get('/:uid/versions/:version', async (c) => {
  const o = await ownerOf(c);
  if (o instanceof Response) return o;
  const uid = c.req.param('uid');
  const version = Number(c.req.param('version'));
  const v = UID_RE.test(uid) && /^[1-9][0-9]{0,8}$/.test(c.req.param('version')) ? await readVersion(c.env, o.owner, uid, version) : null;
  return v ? c.json({ version, definition: v.definition, definition_hash: v.definition_hash }) : notFound(c);
});

skillWorkflows.post('/:uid/validate', async (c) => {
  const o = await ownerOf(c);
  if (o instanceof Response) return o;
  const uid = c.req.param('uid');
  const w = UID_RE.test(uid) ? await readWorkflow(c.env, o.owner, uid) : null;
  if (!w) return notFound(c);
  if (!w.draft_json) return say(c, 409, 'no_draft', 'This workflow has no draft to check.');
  return validate(c, o, JSON.parse(w.draft_json));
});

export default skillWorkflows;
export const mount: RouteMount = { path: '/api/skill-workflows', router: skillWorkflows };

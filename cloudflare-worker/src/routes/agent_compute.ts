/** D4557 part 2: authenticated compute staging and private host callbacks, disabled until isolated broker/host policy is configured. */
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { constantTimeEqual } from '../rpc/secret';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { COMPUTE_BODY_CAP, computeBody, computeUid } from '../services/agents/computeHost';
import { computeFailure, computeInternal, computeTask, createComputeRequest, readyComputeRequest, uploadComputeInput } from '../services/agents/computeBridge';

export const router = new Hono<{ Bindings: Env }>();
const body = async (request: Request, cap: number) => JSON.parse(new TextDecoder().decode(await computeBody(request, cap)));
async function answer(work: () => Promise<unknown>) {
  try { return Response.json(await work()); }
  catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof HTTPException) return error.getResponse();
    if (error instanceof Error && AUTH_ERROR_STATUSES[error.message]) throw error;
    if (error instanceof SyntaxError) return computeFailure('compute_request_invalid', 422);
    if (error instanceof Error && error.message === 'compute_body_limit') return computeFailure('compute_body_limit', 413);
    return computeFailure('compute_unavailable', 503);
  }
}

router.post('/internal/:action', c => answer(async () => {
  const secret = c.env.AGENT_COMPUTE_SECRET;
  if (!secret || secret.length < 32 || !constantTimeEqual(c.req.header('x-compute-control') ?? '', secret)) throw computeFailure('not_found', 404);
  const input = await body(c.req.raw, COMPUTE_BODY_CAP + 16384);
  return computeInternal(c.env, c.req.param('action'), input.job_uid, input.body);
}));

router.post('/tasks/:id/requests', c => answer(async () => {
  const user = await requireAuth(c), id = c.req.param('id');
  if (!/^[1-9][0-9]{0,15}$/.test(id)) throw computeFailure('task_not_found', 404);
  return createComputeRequest(c.env, user, Number(id), await body(c.req.raw, 16384));
}));
router.put('/requests/:uid/inputs/:name', c => answer(async () => uploadComputeInput(c.env, await requireAuth(c), c.req.param('uid'), c.req.param('name'), c.req.raw)));
router.post('/requests/:uid/ready', c => answer(async () => readyComputeRequest(c.env, await requireAuth(c), c.req.param('uid'))));

router.get('/artifacts/:uid', async c => {
  try {
    const user = await requireAuth(c), objectUid = c.req.param('uid');
    if (!computeUid(objectUid)) throw computeFailure('artifact_not_found', 404);
    const row = await c.env.DB.prepare(`SELECT o.r2_key, o.size_bytes, r.task_id, e.spec_json FROM agent_compute_objects o
      JOIN agent_compute_requests r ON r.uid = o.request_uid JOIN agent_compute_executions e ON e.job_uid = o.job_uid
      WHERE o.uid = ? AND o.owner_user_id = ? AND o.kind = 'output' AND datetime(o.expires_at) > datetime('now')`)
      .bind(objectUid, user.id).first<{ r2_key: string; size_bytes: number; task_id: number; spec_json: string }>();
    if (!row) throw computeFailure('artifact_not_found', 404);
    const { scope } = await computeTask(c.env, row.task_id, user), spec = JSON.parse(row.spec_json);
    if ((scope.kind === 'company' ? scope.id : scope.company_id) !== spec.company_id) throw computeFailure('artifact_not_found', 404);
    if (!c.env.FILES) throw computeFailure('compute_storage_unavailable', 503);
    const object = await c.env.FILES.get(row.r2_key);
    if (!object || object.size !== row.size_bytes) throw computeFailure('artifact_not_found', 404);
    return new Response(object.body, { headers: { 'content-type': 'application/json', 'content-length': String(object.size),
      'content-disposition': 'attachment; filename="result.json"', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  } catch (error) {
    if (error instanceof Error && AUTH_ERROR_STATUSES[error.message]) throw error;
    return error instanceof Response ? error : error instanceof HTTPException ? error.getResponse() : computeFailure('compute_unavailable', 503); }
});

export const mount = { path: '/api/agent-compute', router: router };

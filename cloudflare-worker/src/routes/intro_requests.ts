/** D7673 (#7673): introduction requests to people in the shared Network directory, for every member role, coordinated by an Axal operator. */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireHqAdmin } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import {
  IntroRefusal,
  assignRequest,
  createProvisionalTarget,
  createRequest,
  listForRequester,
  operatorMove,
  operatorQueue,
  provisionalQueue,
  putReadiness,
  readinessOf,
  readinessQueue,
  reconcileAttempt,
  recordContactAttempt,
  requestForOperator,
  requestForRequester,
  requireRequestOwner,
  reviewReadiness,
  setRecipient,
  submitRequest,
  updateDraft,
  withdrawRequest,
} from '../services/introductionRequests';

const router = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

/** Turn the service's refusals into refusal bodies; anything else is the app's error handler's. */
async function answer(c: C, work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof IntroRefusal) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: e.extra });
    throw e;
  }
}

async function body(c: C) {
  try {
    const b = await c.req.json();
    if (b && typeof b === 'object' && !Array.isArray(b)) return b;
  } catch {
    /* fall through */
  }
  throw new IntroRefusal(400, 'invalid_json', 'Send a JSON object.');
}

/** A writer: signed in and not a support session, which reads a member's requests but never acts as them. */
async function writer(c: C) {
  const user = await requireAuth(c);
  if ((user as any).support_session) throw new IntroRefusal(403, 'support_session_read_only', 'A support session can read requests but not change them.');
  return user;
}

// ── Operator (HQ admin) — registered first so no requester path takes /operator/… ────────────────────────────────

router.get('/operator/queue', (c) =>
  answer(c, async () => {
    const op = await requireHqAdmin(c);
    const q = c.req.query();
    return c.json(await operatorQueue(c.env.DB, { state: q.state, next_actor: q.next_actor, mine: q.mine === '1' ? op.id : null, cursor: q.cursor, limit: q.limit }));
  }),
);
router.get('/operator/readiness', (c) =>
  answer(c, async () => {
    await requireHqAdmin(c);
    return c.json(await readinessQueue(c.env.DB));
  }),
);
router.post('/operator/readiness/:userId/:key', (c) =>
  answer(c, async () => {
    const op = await requireHqAdmin(c);
    const userId = Number(c.req.param('userId'));
    if (!Number.isSafeInteger(userId) || userId < 1) throw new IntroRefusal(400, 'user_invalid', 'That is not a member reference.');
    await reviewReadiness(c.env.DB, op.id, userId, c.req.param('key'), (await body(c)).decision);
    return c.json({ ok: true });
  }),
);
router.get('/operator/provisional-targets', (c) =>
  answer(c, async () => {
    await requireHqAdmin(c);
    return c.json(await provisionalQueue(c.env.DB, { status: c.req.query('status') }));
  }),
);
router.get('/operator/requests/:uid', (c) =>
  answer(c, async () => {
    await requireHqAdmin(c);
    return c.json({ request: await requestForOperator(c.env.DB, c.req.param('uid')) });
  }),
);
router.post('/operator/requests/:uid/assign', (c) =>
  answer(c, async () => {
    const op = await requireHqAdmin(c);
    return c.json({ request: await assignRequest(c.env.DB, op.id, c.req.param('uid'), await body(c)) });
  }),
);
router.post('/operator/requests/:uid/move', (c) =>
  answer(c, async () => {
    const op = await requireHqAdmin(c);
    return c.json({ request: await operatorMove(c.env.DB, op.id, c.req.param('uid'), await body(c)) });
  }),
);
router.post('/operator/requests/:uid/recipient', (c) =>
  answer(c, async () => {
    const op = await requireHqAdmin(c);
    return c.json({ request: await setRecipient(c.env.DB, op.id, c.req.param('uid'), await body(c)) });
  }),
);
// Records contact the operator made. No transport is passed: this route never sends a message itself.
router.post('/operator/requests/:uid/contact-attempts', (c) =>
  answer(c, async () => {
    const op = await requireHqAdmin(c);
    const out = await recordContactAttempt(c.env.DB, op.id, c.req.param('uid'), await body(c));
    return c.json(out, out.replayed ? 200 : 201);
  }),
);
router.post('/operator/contact-attempts/:attemptUid/reconcile', (c) =>
  answer(c, async () => {
    const op = await requireHqAdmin(c);
    await reconcileAttempt(c.env.DB, op.id, c.req.param('attemptUid'), await body(c));
    return c.json({ ok: true });
  }),
);

// ── Requester (any signed-in member) ─────────────────────────────────────────────────────────────────────────────

router.get('/readiness', (c) =>
  answer(c, async () => {
    const user = await requireAuth(c);
    return c.json(await readinessOf(c.env.DB, user.id));
  }),
);
router.put('/readiness/:key', (c) =>
  answer(c, async () => {
    const user = await writer(c);
    return c.json(await putReadiness(c.env.DB, user.id, c.req.param('key'), await body(c)));
  }),
);
router.post('/provisional-targets', (c) =>
  answer(c, async () => {
    const user = await writer(c);
    return c.json(await createProvisionalTarget(c.env.DB, user.id, await body(c)), 201);
  }),
);
router.get('/', (c) =>
  answer(c, async () => {
    const user = await requireAuth(c);
    const q = c.req.query();
    return c.json(await listForRequester(c.env.DB, user.id, { state: q.state, cursor: q.cursor, limit: q.limit }));
  }),
);
router.post('/', (c) =>
  answer(c, async () => {
    const user = await writer(c);
    const out = await createRequest(c.env.DB, user.id, await body(c));
    return c.json({ request: out.request }, out.created ? 201 : 200);
  }),
);
router.get('/:uid', (c) =>
  answer(c, async () => {
    const user = await requireAuth(c);
    await requireRequestOwner(c.env.DB, user.id, c.req.param('uid'));
    return c.json({ request: await requestForRequester(c.env.DB, user.id, c.req.param('uid')) });
  }),
);
router.patch('/:uid', (c) =>
  answer(c, async () => {
    const user = await writer(c);
    await requireRequestOwner(c.env.DB, user.id, c.req.param('uid'));
    return c.json({ request: await updateDraft(c.env.DB, user.id, c.req.param('uid'), await body(c)) });
  }),
);
router.post('/:uid/submit', (c) =>
  answer(c, async () => {
    const user = await writer(c);
    await requireRequestOwner(c.env.DB, user.id, c.req.param('uid'));
    return c.json(await submitRequest(c.env.DB, user.id, c.req.param('uid'), await body(c)));
  }),
);
router.post('/:uid/withdraw', (c) =>
  answer(c, async () => {
    const user = await writer(c);
    await requireRequestOwner(c.env.DB, user.id, c.req.param('uid'));
    return c.json({ request: await withdrawRequest(c.env.DB, user.id, c.req.param('uid'), await body(c)) });
  }),
);

export default router;
export const mount: RouteMount = { path: '/api/intro-requests', router: router };

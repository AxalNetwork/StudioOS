// D4594 part 2 (#4594) — the deterministic inference stub for hosted Stage A.
//
//   1. The switch: on only when ENVIRONMENT is exactly `preview`, STUDIOOS_ENV does not say
//      production, and AGENT_INFERENCE_STUB is exactly `deterministic`. wrangler.toml declares the
//      variable nowhere, and both var blocks a production deploy uses say production.
//   2. The seam: with the stub on, a real manual sponsor run goes through the real router and
//      accounting (guard, hold, usage row, settlement, proposal) and the account's `AI` binding is
//      never called. With it off, the same run calls the Worker's own `AI`.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/inference_stub_4594.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, MODULE, OPTION, SPONSOR, hex, type World } from './_agent_engine_fixture.ts';
import { ledger, lifecycleWorld } from './_agent_lifecycle_fixture.ts';
import { __setEngineRouteDeps } from '../src/routes/agent_engine.ts';
import teamAgents from '../src/routes/team_agents.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import {
  INFERENCE_STUB_VALUE, INFERENCE_STUB_VAR, STUB_ANSWER, STUB_GUARD_MODEL, STUB_USAGE, inferenceStubOn, stubBinding,
} from '../src/services/ai/inferenceStub.ts';

test.after(() => { __setEngineRouteDeps(null); removeMigratedDatabases(); });

const ON = { ENVIRONMENT: 'preview', [INFERENCE_STUB_VAR]: INFERENCE_STUB_VALUE };

test('the switch: only a preview Worker with AGENT_INFERENCE_STUB exactly deterministic; production can never select it', () => {
  const on = (e: Record<string, unknown>) => inferenceStubOn(e as any);
  assert.equal(on(ON), true);
  // Mutation checked: the ENVIRONMENT test dropped → the production, unset and development rows answer true.
  for (const ENVIRONMENT of ['production', 'prod', 'PREVIEW', ' preview', 'development', '', undefined]) {
    assert.equal(on({ ...ON, ENVIRONMENT }), false, `ENVIRONMENT=${ENVIRONMENT}`);
  }
  // Mutation checked: the STUDIOOS_ENV test dropped → these fail.
  for (const STUDIOOS_ENV of ['production', 'Prod', ' production ']) assert.equal(on({ ...ON, STUDIOOS_ENV }), false, `STUDIOOS_ENV=${STUDIOOS_ENV}`);
  assert.equal(on({ ...ON, STUDIOOS_ENV: 'preview' }), true);
  for (const v of ['DETERMINISTIC', 'on', 'true', '1', 'stub', '', undefined]) assert.equal(on({ ENVIRONMENT: 'preview', [INFERENCE_STUB_VAR]: v }), false, `value ${v}`);
  // No D1 read: an env whose DB throws on any touch still answers.
  assert.equal(on({ ...ON, get DB() { throw new Error('the switch read D1'); } }), true);

  const toml = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  assert.doesNotMatch(toml, new RegExp(INFERENCE_STUB_VAR), 'declared in no environment: only the throwaway Worker sets it');
  const block = (header: string) => {
    const lines = toml.split('\n');
    const at = lines.findIndex((l) => l.trim() === header);
    assert.ok(at >= 0, header);
    const rest = lines.slice(at + 1);
    const end = rest.findIndex((l) => /^\s*\[/.test(l));
    return rest.slice(0, end < 0 ? undefined : end).join('\n');
  };
  for (const h of ['[vars]', '[env.production.vars]']) assert.match(block(h), /^ENVIRONMENT\s*=\s*"production"\s*$/m, h);
});

test('the stub answers the guard safe for free, every other model the fixed synthetic answer, and counts its calls', async () => {
  const s = stubBinding();
  assert.deepEqual(await s.run(STUB_GUARD_MODEL, {}), { response: 'safe', usage: { prompt_tokens: 0, completion_tokens: 0 } });
  const r: any = await s.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages: [] });
  assert.equal(r.response, STUB_ANSWER);
  assert.match(r.response, /synthetic inference stub/, 'it says what it is');
  assert.deepEqual(r.usage, STUB_USAGE);
  assert.deepEqual(s.seen, { calls: 2, guard: 1 });
});

// ── the seam, through the real route, router and accounting ─────────────────
// A production ENVIRONMENT or STUDIOOS_ENV is refused by the switch above; here it would also switch
// auth to production mode, so the run-level cases stay on a preview Worker.

function app(w: World) {
  __setEngineRouteDeps({ runtime: async () => w.runtime });
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error' }, 500);
  });
  a.route('/api/teams', teamAgents);
  return a;
}
async function call(w: World, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try {
    const r = await app(w).request(`/api/teams${path}`, {
      method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    }, w.env);
    const text = await r.text();
    return { status: r.status, body: (text ? JSON.parse(text) : null) as any };
  } finally { [console.warn, console.error, console.info] = saved; }
}

/** A manual sponsor run with the account's `AI` binding recording every call it is given. */
async function sponsorRun(vars: Record<string, string>) {
  const w = lifecycleWorld({ engine: 'off' });
  const account = { calls: 0 };
  (w.env as any).AI = { run: async () => { account.calls += 1; return { response: 'safe', usage: { prompt_tokens: 0, completion_tokens: 0 } }; } };
  Object.assign(w.env as any, vars);
  w.agent(AGENT);
  const ran = await call(w, SPONSOR, 'POST', `/agents/${hex(AGENT, 'b')}/run`, { module: MODULE, option: OPTION, prompt: 'Draft the plan for the next quarter.' });
  return { w, ran, account };
}

test('stub on: the real run path holds, charges, settles and proposes, and the account AI binding is never called', async () => {
  const { w, ran, account } = await sponsorRun({ ...ON });
  try {
    assert.equal(ran.status, 200, JSON.stringify(ran.body));
    // Mutation checked: `inferenceBinding` returning the real binding → the account binding is called and this fails.
    assert.equal(account.calls, 0, 'no call reached the account-wide Workers AI binding');
    const l = ledger(w);
    assert.equal(l.proposals.length, 1);
    const prop = w.db.prepare('SELECT payload_json FROM ai_rail_proposals WHERE uid = ?').get(l.proposals[0].uid) as any;
    assert.equal(JSON.parse(prop.payload_json).text, STUB_ANSWER, 'the proposal is the stub\'s answer');
    assert.equal(l.holds.length, 1);
    assert.equal(l.holds[0].status, 'settled');
    assert.ok(l.charged > 0, 'accounting ran: the stub\'s fixed usage was charged');
    assert.equal(l.holds[0].actual, l.charged, 'settled at exactly what was charged');
    assert.deepEqual(ran.body.charged, { available: true, value_microusd: l.charged });
  } finally { w.close(); }
});

test('stub off (no variable, or a value that is not exactly deterministic): the same run calls the Worker\'s own AI binding', async () => {
  for (const vars of [{ ENVIRONMENT: 'preview' }, { ...ON, [INFERENCE_STUB_VAR]: 'DETERMINISTIC' }]) {
    const { w, ran, account } = await sponsorRun(vars);
    try {
      assert.ok(account.calls > 0, `${JSON.stringify(vars)}: the account binding answered ${JSON.stringify(ran.body)}`);
    } finally { w.close(); }
  }
});

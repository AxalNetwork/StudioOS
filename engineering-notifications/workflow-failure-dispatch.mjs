// D6387: accept signed StudioOS workflow failures and dispatch a bounded batch to the main-branch issue reporter.
import { boundedBody, signed } from './ingress.mjs';
import catalog from './workflow-channels.json' with { type: 'json' };

const repo = catalog.repository;
const reporterId = catalog.workflows.find(row => row.path === '.github/workflows/github-alerts.yml').id;
const actionable = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);
const github = 'https://api.github.com/repos/' + repo + '/actions/workflows/github-alerts.yml/dispatches';
const positive = value => Number.isSafeInteger(value) && value > 0;
const validAttempt = value => Array.isArray(value) && value.length === 2 && value.every(positive);

export async function admitFailure(request, env) {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/github') return new Response('not found', { status: 404 });
  if (!env.WEBHOOK_SECRET || !/^[1-9]\d+$/.test(env.REPOSITORY_ID ?? '')) return new Response('not configured', { status: 503 });
  const signature = request.headers.get('x-hub-signature-256');
  if (!/^sha256=[a-f0-9]{64}$/.test(signature ?? '')) return new Response('signature required', { status: 401 });
  const rate = await env.INGRESS_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') || 'webhook' });
  if (!rate.success) return new Response('rate limited', { status: 429 });
  let bytes;
  try { bytes = await boundedBody(request); }
  catch { return new Response('body unavailable or too large', { status: 413 }); }
  if (!await signed(bytes, signature, env.WEBHOOK_SECRET)) return new Response('signature rejected', { status: 401 });
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return new Response('invalid JSON', { status: 400 }); }
  if (payload?.repository?.full_name !== repo || String(payload.repository?.id) !== env.REPOSITORY_ID) {
    return new Response('repository refused', { status: 403 });
  }
  const event = request.headers.get('x-github-event');
  if (event === 'ping') return new Response(null, { status: 204 });
  if (event !== 'workflow_run' || payload.action !== 'completed') return new Response(null, { status: 204 });
  const run = payload.workflow_run;
  if (!run || !positive(run.workflow_id) || !positive(run.id) || !positive(run.run_attempt) || run.status !== 'completed') {
    return new Response('invalid run', { status: 400 });
  }
  // A reporter failure can be picked up by the scheduled sweep without recursively starting another reporter.
  if (run.workflow_id === reporterId || !actionable.has(run.conclusion)) return new Response(null, { status: 204 });
  await env.FAILURES.send([run.id, run.run_attempt]);
  return new Response(null, { status: 202 });
}

export async function dispatchFailures(batch, env, fetcher = fetch) {
  if (!env.WORKFLOW_DISPATCH_TOKEN) throw new Error('workflow_dispatch_not_configured');
  const attempts = new Map();
  for (const message of batch.messages) {
    if (!validAttempt(message.body)) throw new Error('workflow_attempt_invalid');
    attempts.set(message.body.join(':'), message.body);
  }
  if (!attempts.size) return;
  if (attempts.size > 20) throw new Error('workflow_batch_too_large');
  const response = await fetcher(github, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { authorization: 'Bearer ' + env.WORKFLOW_DISPATCH_TOKEN, accept: 'application/vnd.github+json',
      'user-agent': 'StudioOS-workflow-failure-dispatch', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' },
    body: JSON.stringify({ ref: 'main', inputs: { check: 'workflow-failures', attempts: JSON.stringify([...attempts.values()]) } }),
  });
  if (!response.ok) throw new Error('workflow_dispatch_http_' + response.status);
  // Cloudflare acknowledges the batch on successful return. Retried dispatches use the same run/attempt identities.
}

export default {
  fetch: admitFailure,
  queue(batch, env) { return dispatchFailures(batch, env); },
};

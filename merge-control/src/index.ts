/** D5618: independent authenticated webhook ingress, queue dispatch, status and fenced issue claims. */
import { RepoControl } from './repoControl.ts';
import { limitedBody, ownerAuthorized, webhook } from './webhook.ts';
import type { Delivery, Env } from './types.ts';
import type { LeaseInput } from './lib/lease.ts';
export { RepoControl };
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/webhook' && request.method === 'POST') return await webhook(request, env);
      if (!ownerAuthorized(request, env.OWNER_TOKEN)) return new Response('unauthorized', { status: 401 });
      const control = env.REPO_CONTROL.getByName(env.REPOSITORY);
      if (path === '/status' && request.method === 'GET') return Response.json(await control.status());
      if (request.method !== 'POST' || !['/claims','/switch'].includes(path)) return new Response('not found', { status: 404 });
      let body: Record<string, unknown>;
      try { body = JSON.parse(new TextDecoder().decode(await limitedBody(request, 4096))); } catch { return new Response('invalid body', { status: 400 }); }
      if (!body || Array.isArray(body) || typeof body !== 'object') return new Response('invalid body', { status: 400 });
      if (path === '/switch') {
        if (typeof body.on !== 'boolean') return new Response('invalid switch', { status: 400 });
        return Response.json(await control.setKillSwitch(body.on));
      }
      if (!Number.isSafeInteger(body.issue) || Number(body.issue) <= 0 || !['acquire','renew','release'].includes(String(body.operation)) || typeof body.holder !== 'string') return new Response('invalid claim', { status: 400 });
      if (body.fence !== undefined && !Number.isSafeInteger(body.fence)) return new Response('invalid fence', { status: 400 });
      if (body.ttlSeconds !== undefined && (typeof body.ttlSeconds !== 'number' || !Number.isFinite(body.ttlSeconds) || body.ttlSeconds < 1 || body.ttlSeconds > 86400)) return new Response('invalid TTL', { status: 400 });
      if (!/^[\w .:@/-]{1,200}$/.test(body.holder)) return new Response('invalid holder', { status: 400 });
      const input: LeaseInput = { operation: body.operation as LeaseInput['operation'], holder: body.holder,
        ...(body.fence === undefined ? {} : { fence: Number(body.fence) }),
        ...(body.ttlSeconds === undefined ? {} : { ttlSeconds: Number(body.ttlSeconds) }) };
      const result = await control.claim(Number(body.issue), input);
      return Response.json(result, { status: result.status });
    } catch {
      console.error(JSON.stringify({ component: 'merge-control', event: 'request-failed' }));
      return Response.json({ error: 'operation unavailable' }, { status: 503 });
    }
  },
  async queue(batch: MessageBatch<Delivery>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try { await env.REPO_CONTROL.getByName(env.REPOSITORY).deliver(message.body); message.ack(); }
      catch { message.retry(); }
    }
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await env.REPO_CONTROL.getByName(env.REPOSITORY).reconcile();
  },
} satisfies ExportedHandler<Env, Delivery>;

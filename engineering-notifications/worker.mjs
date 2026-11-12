// D5664: separately deployed capture Worker; repository/visibility partitioned durable metadata, no GitHub writes or Slack credentials.
import { DurableObject } from 'cloudflare:workers';
import { receive } from './ingress.mjs';
import { EventLedger } from './ledger.mjs';
import { reconcile, githubReader } from './reconcile.mjs';
import { actionsSource } from './github-source.mjs';
export class EngineeringLedger extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => { this.ledger = new EventLedger(ctx.storage.sql, fn => ctx.storage.transactionSync(fn)); });
  }
  async append(event) { return this.ledger.append(event); }
  async history(after, limit) { return this.ledger.history(after, limit); }
  async counts() { return this.ledger.counts(); }
  async reject(code) { this.ledger.reject(code); }
  async gap(value) { this.ledger.recordGap(value); }
  async reconcileNow() {
    if (this.env.RECONCILE_ENABLED !== 'true') return { enabled: false };
    const until = Math.floor(Date.now() / 1000) * 1000, start = Math.max(0, until - 3_600_000);
    const read = githubReader({ token: this.env.GITHUB_READ_TOKEN });
    const repository = { id: this.env.REPOSITORY_ID, full_name: this.env.REPOSITORY, private: this.env.REPOSITORY_VISIBILITY !== 'public' };
    const source = actionsSource({ read, repository, start, gap: value => this.ledger.recordGap(value) });
    const complete = await reconcile({ ledger: this.ledger, source, until });
    // Scope remains explicit until the approved App feed and per-family REST scopes are installed.
    for (const scope of ['work', 'delivery', 'security']) this.ledger.recordGap({ scope, code: 'approved_feed_or_scope_not_verified', from: start, to: until });
    return { complete, ...this.ledger.counts() };
  }
}
const partition = (env, visibility) => env.LEDGER.getByName(`v1:${env.REPOSITORY_ID}:${visibility}`);
export default {
  async fetch(request, env) {
    if (request.method === 'GET' && new URL(request.url).pathname === '/health') return Response.json({ schema: 1, service: 'engineering-events', configured: Boolean(env.REPOSITORY_ID && env.INSTALLATION_ID), capture: env.CAPTURE_ENABLED === 'true', reconcile: env.RECONCILE_ENABLED === 'true' });
    if (env.CAPTURE_ENABLED !== 'true') return new Response('capture disabled', { status: 503 });
    try {
      const response = await receive(request, env);
      if (response.status >= 400) await partition(env, 'public').reject(response.status === 401 ? 'signature_rejected' : 'source_or_event_rejected');
      return response;
    }
    catch (error) {
      const code = ['payload_too_large', 'payload_missing', 'normalized_payload_too_large'].includes(error.message) ? error.message : 'capture_unavailable';
      const now = Date.now();
      await partition(env, 'public').gap({ scope: 'ingress', code, from: now, to: now });
      console.error(JSON.stringify({ service: 'engineering-events', code }));
      return new Response('capture unavailable; replay retained delivery after repair', { status: 503 });
    }
  },
  async queue(batch, env) {
    for (const item of batch.messages) {
      try { if (item.body.repositoryId !== env.REPOSITORY_ID) throw new Error('repository_mismatch'); await partition(env, item.body.visibility).append(item.body); item.ack(); }
      catch { item.retry({ delaySeconds: 30 }); }
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(partition(env, env.REPOSITORY_VISIBILITY === 'public' ? 'public' : 'restricted').reconcileNow().then(result => console.log(JSON.stringify({ service: 'engineering-events', complete: result.complete, enabled: result.enabled }))));
  },
};

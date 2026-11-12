// D5665: inactive independent sender actor; service-binding ingress only, no public enqueue or GitHub mutation API.
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { SlackOutbox } from './outbox.mjs';
import { slackTransport } from './transport.mjs';
import { registryOf } from './presentation-v1.mjs';
export class DeliveryActor extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.outbox = new SlackOutbox({ sql: ctx.storage.sql, transaction: fn => ctx.storage.transactionSync(fn), registry: JSON.parse(env.ROUTING_REGISTRY), deliver: slackTransport({ token: env.SLACK_BOT_TOKEN }) });
    });
  }
  async enqueue(event, policy) {
    const result = this.outbox.enqueue(event, policy);
    if (this.env.DELIVERY_ENABLED === 'true') await this.ctx.storage.setAlarm(Date.now() + 1000);
    return result;
  }
  async enqueueHealth(intent) {
    const result = this.outbox.enqueueHealth(intent);
    if (this.env.DELIVERY_ENABLED === 'true') await this.ctx.storage.setAlarm(Date.now() + 1000);
    return result;
  }
  async summary() { return this.outbox.summary(); }
  async receipt(key) { const row = this.outbox.get(key); return row ? { key, state: row.state, receipt: row.receipt } : { key, state: 'unknown' }; }
  async alarm() {
    if (this.env.DELIVERY_ENABLED !== 'true') return;
    const result = await this.outbox.tick();
    console.log(JSON.stringify({ service: 'engineering-slack', state: result.state }));
    // Durable polling also revisits Retry-After, kill switches and parent dependencies.
    const outstanding = this.outbox.summary();
    if (outstanding.unbatched || outstanding.states.some(s => ['pending', 'retry'].includes(s.state))) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }
}
function actor(env) { const registry = registryOf(JSON.parse(env.ROUTING_REGISTRY)); return env.OUTBOX.getByName(`workspace:${registry.teamId}`); }
export class SlackPublisher extends WorkerEntrypoint {
  async enqueue(event, policy) { return actor(this.env).enqueue(event, policy); }
  async enqueueHealth(intent) { return actor(this.env).enqueueHealth(intent); }
  async receipt(key) { return actor(this.env).receipt(key); }
  async summary() { return actor(this.env).summary(); }
}
export default {
  async fetch(request, env) {
    if (request.method !== 'GET' || new URL(request.url).pathname !== '/health') return new Response('not found', { status: 404 });
    return Response.json({ schema: 1, service: 'engineering-slack', enabled: env.DELIVERY_ENABLED === 'true', registryConfigured: env.ROUTING_REGISTRY !== 'null', heartbeatAt: new Date().toISOString() });
  },
};

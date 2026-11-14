// D5720: static Workers SQLite fixture; clocks and receipt keys enter as data bindings, never generated JavaScript.
import { CloudflareDeliveryActor } from '../../engineering-notifications/cloudflare-worker-5671.mjs';

export class FixtureActor extends CloudflareDeliveryActor {
  async add(event) {
    return this.delivery.accept(event);
  }

  async step(now) {
    this.clock = (this.clock ?? now + 300001) + 1001;
    this.delivery.now = () => this.clock;
    this.delivery.box.now = () => this.clock;
    this.delivery.box.deliver = async (request) => ({
      state: 'acknowledged',
      receipt: { channel: request.channel.id, ts: '1234.000001', status: 200, transport: 'adapter' },
    });
    return this.delivery.tick();
  }

  async receipt(key) {
    return this.delivery.box.get(key);
  }
}

export default {
  async fetch(request, env) {
    const actor = env.CF_DELIVERY.getByName('fixture');
    switch (new URL(request.url).pathname) {
      case '/status': return Response.json(await actor.status());
      case '/scheduled': return Response.json(await actor.recordScheduled());
      case '/add': return Response.json(await actor.add(await request.json()));
      case '/step': return Response.json(await actor.step(Number(env.FIXTURE_NOW)));
      default: return Response.json(await actor.receipt(env.FIXTURE_RECEIPT_KEY));
    }
  },
};

// D5671: disabled independent Cloudflare receiver/outbox actor, reusing the D5665 authenticated Slack transport.
import {DurableObject} from 'cloudflare:workers';
import {CloudflareDelivery} from './cloudflare-outbox-5671.mjs';
import {receiveCloudflare,authentic} from './cloudflare-receiver-5671.mjs';
import {cloudflareTransport} from './cloudflare-transport-5671.mjs';
export class CloudflareDeliveryActor extends DurableObject {
  constructor(ctx,env){super(ctx,env);ctx.blockConcurrencyWhile(async()=>{ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS cf_runtime (id INTEGER PRIMARY KEY, scheduled_at INTEGER NOT NULL)');this.delivery=new CloudflareDelivery({sql:ctx.storage.sql,transaction:fn=>ctx.storage.transactionSync(fn),registry:JSON.parse(env.ROUTING_REGISTRY),deliver:cloudflareTransport({token:env.SLACK_BOT_TOKEN})})})}
  async accept(event){const result=this.delivery.accept(event);await this.wake();return result}
  async wake(){if(this.env.CF_DELIVERY_ENABLED==='true'){const next=this.delivery.nextWake();if(next!==null)await this.ctx.storage.setAlarm(next)}return this.delivery.summary()}
  async recordScheduled(){this.ctx.storage.sql.exec('INSERT INTO cf_runtime (id,scheduled_at) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET scheduled_at=MAX(scheduled_at,excluded.scheduled_at)',Date.now());return this.wake()}
  async status(){return {enabled:this.env.CF_DELIVERY_ENABLED==='true',lastScheduledAt:[...this.ctx.storage.sql.exec('SELECT scheduled_at FROM cf_runtime WHERE id=1')][0]?.scheduled_at??null,summary:this.delivery.summary()}}
  async alarm(){if(this.env.CF_DELIVERY_ENABLED!=='true')return;await this.delivery.tick();await this.wake()}
}
function actor(env){const registry=JSON.parse(env.ROUTING_REGISTRY);return env.CF_DELIVERY.getByName(`cf:${registry.teamId}`)}
export default {
  async fetch(request,env){
    if(request.method==='GET'&&new URL(request.url).pathname==='/health')return Response.json({service:'cloudflare-notifications',enabled:env.CF_DELIVERY_ENABLED==='true'});
    if(request.method==='GET'&&new URL(request.url).pathname==='/status'){if(!await authentic(request.headers.get('cf-observer-auth'),env.CF_OBSERVER_SECRET))return new Response('unauthorized',{status:401});if(env.CF_DELIVERY_ENABLED!=='true')return Response.json({enabled:false});return Response.json(await actor(env).status())}
    if(env.CF_DELIVERY_ENABLED!=='true')return new Response('disabled',{status:503});
    try{return await receiveCloudflare(request,{secret:env.CF_WEBHOOK_SECRET,config:JSON.parse(env.PROVIDER_REGISTRY),accept:e=>actor(env).accept(e)})}catch{return new Response('configuration unavailable',{status:503})}
  },
  async scheduled(event,env,ctx){if(env.CF_DELIVERY_ENABLED==='true')ctx.waitUntil(actor(env).recordScheduled())},
};

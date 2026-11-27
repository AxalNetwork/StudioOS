// D5671: Cloudflare-only route instance reuses D5665 pacing/retries/receipts; no second transport implementation.
import {SlackOutbox} from '../engineering-slack/outbox.mjs';
import {cloudflareRow,validateCloudflare} from './cloudflare-receiver-5671.mjs';
export class CloudflareDelivery {
  constructor({sql,transaction,registry,deliver,now=Date.now,jitter}) {
    if(!registry || registry.purpose!=='cloudflare-notifications' || Object.keys(registry.channels||{}).some(role=>!['health','activity','prs'].includes(role)) || !['health','activity','prs'].every(role=>registry.channels[role]?.private===true && registry.channels[role]?.routeRole===({health:'cloudflare-health',activity:'cloudflare-activity',prs:'cloudflare-preview'})[role]) || registry.slackConnect!==false || registry.recipientAccessVerified!==true) throw Error('cloudflare_registry_unapproved');
    this.sql=sql;this.transaction=transaction;this.now=now;
    this.box=new SlackOutbox({sql,transaction,registry,deliver,now,jitter});
    sql.exec('CREATE TABLE IF NOT EXISTS cf_events (event_key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, payload TEXT NOT NULL, chunk_key TEXT)');
    sql.exec('CREATE TABLE IF NOT EXISTS cf_episodes (episode TEXT PRIMARY KEY, source_at INTEGER NOT NULL, phase TEXT NOT NULL)');
  }
  accept(e) {
    validateCloudflare(e);
    const text=cloudflareRow(e),role=e.environment==='preview'?'prs':'health',root=`cf:episode:${e.episode}`;
    return this.transaction(()=>{
      if(this.sql.exec('SELECT event_key FROM cf_events WHERE event_key = ?',e.key).toArray().length)return {accepted:true,key:e.key,duplicate:true};
      this.sql.exec('INSERT INTO cf_events (event_key,bucket,payload) VALUES (?,?,?)',e.key,Math.floor(e.observedAt/300000)*300000,JSON.stringify(e));
      if(e.phase!=='observation'){
      this.box.insert({key:root,role,text:`[cf] ${e.script} ${e.component} — current state follows`,priority:0});
      this.box.insert({key:`cf:transition:${e.key}`,role,text,parent:root,priority:0,items:[e.key]});
      const previous=this.sql.exec('SELECT * FROM cf_episodes WHERE episode = ?',e.episode).toArray()[0];
      if(!previous || e.sourceAt>previous.source_at || e.sourceAt===previous.source_at && e.phase==='recovery' && previous.phase!=='recovery'){
        this.sql.exec('INSERT INTO cf_episodes (episode,source_at,phase) VALUES (?,?,?) ON CONFLICT(episode) DO UPDATE SET source_at=excluded.source_at,phase=excluded.phase',e.episode,e.sourceAt,e.phase);
        this.sql.exec("UPDATE outbox SET state='superseded' WHERE state IN ('pending','retry') AND json_extract(payload,'$.parent')=? AND json_extract(payload,'$.operation')='update'",root);
        this.box.insert({key:`cf:update:${e.key}`,role,text,parent:root,operation:'update',priority:1,items:[e.key]});
      }
      }
      return {accepted:true,key:e.key};
    });
  }
  flush(){
    const rows=this.sql.exec('SELECT * FROM cf_events WHERE chunk_key IS NULL AND bucket+300000<=? ORDER BY bucket,event_key',this.now()).toArray(),groups=new Map();
    for(const row of rows){const e=JSON.parse(row.payload),role=e.environment==='preview'?'prs':'activity',key=`${role}:${row.bucket}`;if(!groups.has(key))groups.set(key,{role,bucket:row.bucket,items:[]});groups.get(key).items.push(e)}
    this.transaction(()=>{for(const {role,bucket,items}of groups.values()){
      const root=`cf:hour:${role}:${Math.floor(bucket/3600000)}`;this.box.insert({key:root,role,text:`[cf][activity] UTC:${new Date(Math.floor(bucket/3600000)*3600000).toISOString()}`,priority:10});
      let page=[],length=0,index=0;
      const save=()=>{if(!page.length)return;const key=`cf:batch:${role}:${bucket}:${items[0].key}:${++index}`;this.box.insert({key,role,parent:root,text:`[cf][activity] UTC:${new Date(bucket).toISOString()} page:${index} items:${page.length}\n${page.map(cloudflareRow).join('\n')}`,items:page.map(e=>e.key)});for(const e of page)this.sql.exec('UPDATE cf_events SET chunk_key=? WHERE event_key=?',key,e.key);page=[];length=0};
      for(const e of items){const size=cloudflareRow(e).length+1;if(length+size>7800)save();page.push(e);length+=size}save();
    }});return rows.length;
  }
  nextWake(){const pending=this.sql.exec('SELECT MIN(bucket+300000) AS due FROM cf_events WHERE chunk_key IS NULL').toArray()[0].due,base=this.box.nextWake();const due=[pending,base].filter(x=>x!==null);return due.length?Math.max(this.now()+1000,Math.min(...due)):null}
  async tick(){this.flush();return this.box.tick()}
  summary(){const base=this.box.summary(),oldest=this.sql.exec("SELECT MIN(json_extract(payload,'$.createdAt')) AS time FROM outbox WHERE state NOT IN ('acknowledged','superseded')").toArray()[0].time,unbatchedOldest=this.sql.exec("SELECT MIN(json_extract(payload,'$.observedAt')) AS time FROM cf_events WHERE chunk_key IS NULL").toArray()[0].time,times=[oldest,unbatchedOldest].filter(v=>v!==null),oldestTime=times.length?Math.min(...times):null,eligible=this.sql.exec('SELECT COUNT(*) AS count FROM cf_events').toArray()[0].count;return {...base,oldestUndeliveredAgeMs:oldestTime===null?null:oldestTime>this.now()?null:this.now()-oldestTime,undeliveredIntents:base.states.filter(s=>!['acknowledged','superseded'].includes(s.state)).reduce((n,s)=>n+s.count,0),itemCount:eligible,eligible:this.sql.exec('SELECT COUNT(*) AS count FROM cf_events').toArray()[0].count,unbatched:this.sql.exec('SELECT COUNT(*) AS count FROM cf_events WHERE chunk_key IS NULL').toArray()[0].count}}
}

/** D5673: D1 compare-and-swap source cursor + immutable redacted receipts; this is not a second incident or Slack outbox. */
import { parseCfReceipt, forwardCfReceipt, type CfDeliveryPort, type CfReceipt, type CfSourceStore } from './cloudflareSourceReceipt';
export function d1CfSourceStore(db:D1Database): CfSourceStore {
  const valid=(key:string)=>{if(!/^deployments:(studioos|studioos-meeting-bot|studioos-meeting-bot-preview|studioos-tail)$/.test(key))throw Error('invalid_cf_cursor');};
  return {
    async read(key){valid(key);await db.prepare('INSERT OR IGNORE INTO cf_source_cursors (source_key,revision,through_ms,active_id,active_versions,write_token) VALUES (?,0,0,NULL,?,?)').bind(key,'[]','').run();
      const row=await db.prepare('SELECT revision,through_ms,active_id,active_versions FROM cf_source_cursors WHERE source_key=?').bind(key).first<{revision:number;through_ms:number;active_id:string|null;active_versions:string}>();
      if(!row)throw Error('cf_cursor_unreadable');return {...row,active_versions:JSON.parse(row.active_versions)};
    },
    async commit(key,expected,next,receipts){valid(key);if(receipts.length>4000||!Number.isSafeInteger(expected)||expected<0)throw Error('cf_commit_invalid');
      const parsed=receipts.map(parseCfReceipt),token=crypto.randomUUID(),head=db.prepare('UPDATE cf_source_cursors SET revision=revision+1,through_ms=?,active_id=?,active_versions=?,write_token=? WHERE source_key=? AND revision=?')
        .bind(next.through_ms,next.active_id,JSON.stringify(next.active_versions),token,key,expected);
      // D1 batch rolls the cursor back if any insert fails. The token fences concurrent snapshots before their inserts.
      const chunks:CfReceipt[][]=[];let part:CfReceipt[]=[],size=0;
      for(const r of parsed){const bytes=JSON.stringify(r).length;if(size+bytes>512000){chunks.push(part);part=[];size=0;}part.push(r);size+=bytes;}
      if(part.length)chunks.push(part);
      const results=await db.batch([head,...chunks.map(rows=>db.prepare(`INSERT OR IGNORE INTO cf_source_receipts (receipt_id,source_key,observed_ms,receipt_json)
        SELECT json_extract(value,'$.id'),?,json_extract(value,'$.observed_ms'),value FROM json_each(?)
        WHERE EXISTS (SELECT 1 FROM cf_source_cursors WHERE source_key=? AND write_token=?)`).bind(key,JSON.stringify(rows),key,token))]);
      if(results.some(r=>(r.success as unknown)===false))throw Error('cf_commit_failed');return results[0].meta.changes===1;
    },
  };
}
export async function pendingCfSourceReceipts(db:D1Database,limit=100):Promise<CfReceipt[]> {
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('invalid_cf_page');
  const rows=await db.prepare('SELECT receipt_json FROM cf_source_receipts WHERE forwarded_ms IS NULL ORDER BY observed_ms,receipt_id LIMIT ?').bind(limit).all<{receipt_json:string}>();
  if((rows.success as unknown)===false||!Array.isArray(rows.results))throw Error('cf_receipts_unreadable');return rows.results.map(r=>parseCfReceipt(JSON.parse(r.receipt_json)));
}

/** Sender acceptance is durable enqueue only; the shared sender retains actual Slack receipts and owns retries. */
export async function forwardPendingCfSourceReceipts(db:D1Database,port:CfDeliveryPort,now=Date.now()):Promise<number>{
  const rows=await pendingCfSourceReceipts(db);let count=0;
  for(const row of rows){await forwardCfReceipt(port,row);
    const written=await db.prepare('UPDATE cf_source_receipts SET forwarded_ms=? WHERE receipt_id=? AND forwarded_ms IS NULL').bind(now,row.id).run();
    if((written.success as unknown)===false)throw Error('cf_forward_ack_failed');count+=written.meta.changes??0;
  }return count;
}

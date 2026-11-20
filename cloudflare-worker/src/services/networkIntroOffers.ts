/** D6637: atomically offer a mirrored proposition between two accepted ties, preserving closed consent history and existing responses. */
import type {Env} from '../types';
import {PROPOSITION_TTL_DAYS} from './introductions';
export async function acceptedOfferPeople(env:Env,owner:number,{after=0,targets=null}:{after?:number;targets?:[number,number]|null}={}){
 const r=await env.DB.prepare(`SELECT DISTINCT u.id,COALESCE(NULLIF(trim(u.name),''),'Unnamed member') AS name
   FROM partner_relationships p JOIN users u ON u.id=CASE WHEN p.partner_a_id=? THEN p.partner_b_id ELSE p.partner_a_id END
   WHERE (p.partner_a_id=? OR p.partner_b_id=?) AND p.status='accepted' AND u.is_active=1 AND u.id<>? AND u.id>? AND (? IS NULL OR u.id IN (?,?))
   ORDER BY u.id LIMIT 51`).bind(owner,owner,owner,owner,after,targets?.[0]??null,targets?.[0]??null,targets?.[1]??null).all<{id:number;name:string}>();
 if(!r.success)throw new Error('ties_unreadable');
 const people=(r.results||[]).slice(0,50);return{people,next_cursor:(r.results?.length??0)>50?people[people.length-1].id:null};
}
export async function offerBetweenTies(env:Env,owner:number,first:number,second:number){
 const token=crypto.randomUUID(),a=crypto.randomUUID(),b=crypto.randomUUID();
 const meta=JSON.stringify({offer_uid:token,offered_by:owner});
 const expires=new Date(Date.now()+PROPOSITION_TTL_DAYS*86400000).toISOString();
 const result=await env.DB.batch([
  env.DB.prepare(`UPDATE intro_propositions AS p SET status='expired'
   WHERE ((user_id=? AND target_user_id=?) OR (user_id=? AND target_user_id=?))
     AND p.status='pending' AND ((p.expires_at IS NOT NULL AND datetime(p.expires_at)<datetime('now')) OR EXISTS(
     SELECT 1 FROM intro_propositions m WHERE m.user_id=p.target_user_id AND m.target_user_id=p.user_id AND m.status IN ('declined','expired')
       AND ((p.source<>'offered' AND m.source<>'offered') OR (p.source='offered' AND m.source='offered'
         AND CASE WHEN json_valid(m.breakdown_json) THEN json_extract(m.breakdown_json,'$.offer_uid') END
           = CASE WHEN json_valid(p.breakdown_json) THEN json_extract(p.breakdown_json,'$.offer_uid') END))))
     AND EXISTS(SELECT 1 FROM partner_relationships r WHERE r.status='accepted' AND ((r.partner_a_id=? AND r.partner_b_id=?) OR(r.partner_b_id=? AND r.partner_a_id=?)))
     AND EXISTS(SELECT 1 FROM partner_relationships r WHERE r.status='accepted' AND ((r.partner_a_id=? AND r.partner_b_id=?) OR(r.partner_b_id=? AND r.partner_a_id=?)))`)
   .bind(first,second,second,first,owner,first,owner,first,owner,second,owner,second),
  env.DB.prepare(`WITH recipients(user_id,target_user_id,uid) AS (VALUES(?,?,?),(?,?,?))
   INSERT INTO intro_propositions(uid,user_id,target_user_id,status,score,breakdown_json,source,expires_at)
   SELECT uid,user_id,target_user_id,'pending',0,?,'offered',? FROM recipients
   WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1) AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1)
     AND EXISTS(SELECT 1 FROM partner_relationships r WHERE r.status='accepted' AND ((r.partner_a_id=? AND r.partner_b_id=?) OR(r.partner_b_id=? AND r.partner_a_id=?)))
     AND EXISTS(SELECT 1 FROM partner_relationships r WHERE r.status='accepted' AND ((r.partner_a_id=? AND r.partner_b_id=?) OR(r.partner_b_id=? AND r.partner_a_id=?)))
     AND NOT EXISTS(SELECT 1 FROM intro_propositions p WHERE ((p.user_id=? AND p.target_user_id=?) OR(p.user_id=? AND p.target_user_id=?)) AND p.status='pending')`)
   .bind(first,second,a,second,first,b,meta,expires,first,second,owner,first,owner,first,owner,second,owner,second,first,second,second,first),
  env.DB.prepare(`INSERT INTO activity_logs(user_id,action,details,entity_type,entity_id)
   SELECT ?,'network_intro_offered',?,'introduction',? WHERE EXISTS(SELECT 1 FROM intro_propositions WHERE uid=? AND source='offered')`)
   .bind(owner,JSON.stringify({offer_uid:token}),token,a),
 ]);
 return Number(result[1].meta?.changes)===2?{first_uid:a,second_uid:b}:null;
}

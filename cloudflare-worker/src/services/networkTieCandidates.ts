/** D6636: names from actual shared deal/data-room participation, never an account directory or email lookup. */
import type { Env } from '../types';
export async function networkTieCandidates(env:Env,viewer:number,{target=null,after=0,limit=50,sharedOnly=false}:{target?:number|null;after?:number;limit?:number;sharedOnly?:boolean}={}){
 const rows=await env.DB.prepare(`WITH
   granted(user_id,licence) AS (
     SELECT id,lower(role) FROM users WHERE lower(role) IN ('founder','investor','partner','admin')
     UNION SELECT user_id,licence FROM account_licences WHERE revoked_at IS NULL
   ), held(user_id,licence) AS (
     SELECT g.user_id,g.licence FROM granted g WHERE NOT EXISTS (
       SELECT 1 FROM licences l WHERE l.licence_family='user' AND l.holder_type='user' AND l.holder_id=CAST(g.user_id AS TEXT)
         AND CASE l.licence_type WHEN 'operating_partner' THEN 'partner' ELSE l.licence_type END=g.licence
         AND l.status NOT IN ('active','renewal_pending'))
   ), shared_founders(project_id,user_id) AS (
     SELECT p.id,u.id FROM projects p JOIN users u ON u.founder_id=p.founder_id
       JOIN held h ON h.user_id=u.id AND h.licence='founder'
       WHERE p.deleted_at IS NULL AND u.role<>'admin'
   ), deal_people(deal_id,user_id) AS (
     SELECT deal_id,investor_user_id FROM deal_invitations
     UNION SELECT deal_id,investor_user_id FROM commitments
     UNION SELECT deal_id,investor_user_id FROM investor_dealroom_members
     UNION SELECT d.id,f.user_id FROM deals d JOIN shared_founders f ON f.project_id=d.project_id
   ), readable_deal_people(deal_id,user_id) AS (
     SELECT a.deal_id,a.user_id FROM deal_people a JOIN deals d ON d.id=a.deal_id JOIN projects p ON p.id=d.project_id
       WHERE p.deleted_at IS NULL AND (EXISTS(SELECT 1 FROM held h WHERE h.user_id=a.user_id AND h.licence IN ('investor','partner','admin'))
         OR EXISTS(SELECT 1 FROM shared_founders f WHERE f.project_id=p.id AND f.user_id=a.user_id))
   ), room_people(project_id,user_id) AS (
     SELECT g.project_id,g.investor_user_id FROM data_room_grants g JOIN users u ON u.id=g.investor_user_id
       WHERE g.status='active' AND (g.expires_at IS NULL OR datetime(g.expires_at)>datetime('now')) AND u.role<>'admin'
     UNION SELECT project_id,user_id FROM shared_founders
     UNION SELECT m.project_id,m.user_id FROM project_members m JOIN users u ON u.id=m.user_id WHERE m.status='accepted' AND m.role='cofounder' AND u.role<>'admin'
   ), shared(user_id) AS (
     SELECT other.user_id FROM readable_deal_people me JOIN readable_deal_people other ON other.deal_id=me.deal_id WHERE me.user_id=?
     UNION SELECT other.user_id FROM room_people me JOIN room_people other ON other.project_id=me.project_id
       JOIN projects p ON p.id=me.project_id WHERE me.user_id=? AND p.deleted_at IS NULL
   )
 SELECT u.id,COALESCE(NULLIF(trim(u.name),''),'Unnamed member') AS name FROM shared s JOIN users u ON u.id=s.user_id
 WHERE u.id<>? AND u.is_active=1 AND u.id>? AND (? IS NULL OR u.id=?)
   AND (?=1 OR NOT EXISTS(SELECT 1 FROM partner_relationships r
     WHERE ((r.partner_a_id=? AND r.partner_b_id=u.id) OR (r.partner_b_id=? AND r.partner_a_id=u.id))
       AND (r.status IN ('pending','accepted') OR (r.status='declined' AND r.requested_by=?))))
 ORDER BY u.id LIMIT ?`).bind(viewer,viewer,viewer,after,target,target,sharedOnly?1:0,viewer,viewer,viewer,limit+1).all<{id:number;name:string}>();
 if(!rows.success)throw new Error('network_candidates_unreadable');
 const people=(rows.results||[]).slice(0,limit);
 return{people,next_cursor:(rows.results?.length??0)>limit?people[people.length-1].id:null};
}

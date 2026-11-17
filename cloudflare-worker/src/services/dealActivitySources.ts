/** D6430: bounded data-room, shared-deck and NDA-signature activity, each under its own existing read rule. */
import type { Env, User } from '../types';
import { activeGrant, projectNdaActive, roomProject } from '../routes/data_room';
import { liveFiles } from './dataRoomTrash';
import { grantFolderScope, investorCommitted, tierAdmits } from './dataRoomAccess';
import { isDealOwner } from './dealAccess';
import { holdsLicence } from './accountLicences';
import { activeCompanyFor } from '../middleware/activeCompany';
import { noteFirm, visibleDeal } from './dealNotes';

type Event = { type:string; kind:'documents'; label:string; at:string|null; mine:boolean };
export async function dealActivitySources(c: any, deal: any, user: User): Promise<Event[]> {
  const env:Env=c.env;const events:Event[]=[];
  const owner=isDealOwner(user,deal.project_founder_id);
  const append=async (name:string,fn:()=>Promise<Event[]>)=>{
    try {events.push(...await fn());} catch {events.push({type:'unreadable',kind:'documents',label:`${name} activity could not be read`,at:null,mine:false});}
  };
  await append('Data room',async()=>{
    if(user.role==='admin')return []; // Plain admin reads do not open a room (D1102).
    const project=await env.DB.prepare('SELECT uid FROM projects WHERE id = ?').bind(deal.project_id).first<{uid:string|null}>();
    const ownRoom=!!(project?.uid && await roomProject(c,user,project.uid));
    const grant=ownRoom?null:await activeGrant(env,deal.project_id,user.id);
    if(!ownRoom&&!grant)return [];
    const folders=grant?await grantFolderScope(env,grant.id,true):null;
    const committed=ownRoom?false:await investorCommitted(env,deal.project_id,user.id,true);
    const nda=ownRoom||await projectNdaActive(env,deal.project_id,user.id);
    // D6073: only the helper's fixed empty/live clause reaches SQL; ids stay bound.
    const live = await liveFiles(env.DB, 'f');
    const files=await env.DB.prepare(`SELECT id, name, visibility, access_tier, access_expires_at, folder_id FROM data_room_files f WHERE f.project_id = ?${live}`).bind(deal.project_id).all<any>();
    const allowed=(files.results||[]).filter(f=>ownRoom||(tierAdmits(f,committed,Date.now(),folders)&&(f.visibility==='open'||f.visibility==='nda'&&nda))).map(f=>Number(f.id));
    if(!allowed.length)return [];
    // Apply grants before the newest-N boundary, so hidden files cannot crowd out readable events.
    const rows=await env.DB.prepare(`SELECT type, name, at FROM (SELECT 'file_added' AS type, f.name, f.created_at AS at FROM data_room_files f
        WHERE f.project_id = ?${live} AND f.id IN (SELECT value FROM json_each(?))
      UNION ALL SELECT 'file_version' AS type, f.name, v.created_at AS at FROM data_room_file_versions v JOIN data_room_files f ON f.id = v.file_id
        WHERE f.project_id = ?${live} AND f.id IN (SELECT value FROM json_each(?))
      ) ORDER BY julianday(at) DESC LIMIT 50`).bind(deal.project_id,JSON.stringify(allowed),deal.project_id,JSON.stringify(allowed)).all<any>();
    return (rows.results||[]).map(r=>({type:r.type,kind:'documents',label:`${r.type==='file_added'?'File added:':'New version of'} ${r.name}`,at:r.at,mine:false}));
  });
  await append('Deck version',async()=>{
    const privileged=owner||user.role==='admin';
    if(!privileged&&!holdsLicence(user,'investor'))return [];
    const company=privileged?null:await noteFirm(env.DB,user.id,await activeCompanyFor(c,user),!!c.req.header('X-Company-Id'));
    if(!privileged&&(company===undefined||!await visibleDeal(env.DB,deal.id,user.id,company??null)))return [];
    const rows=await env.DB.prepare(`SELECT d.version, g.created_at AS at FROM deck_grants g JOIN pitch_decks d ON d.id = g.deck_id
      WHERE g.deal_id = ? AND d.project_id = ? AND (? = 1 OR (g.investor_user_id = ? AND g.company_id IS ? AND g.revoked_at IS NULL))
      ORDER BY julianday(g.created_at) DESC, g.id DESC LIMIT 50`).bind(deal.id,deal.project_id,privileged?1:0,user.id,company??null).all<any>();
    return (rows.results||[]).map(r=>({type:'deck_shared',kind:'documents',label:`Deck version ${r.version} shared`,at:r.at,mine:false}));
  });
  await append('NDA signature',async()=>{
    const privileged=owner||user.role==='admin';
    const rows=await env.DB.prepare(`SELECT r.signed_at AS at, n.party_b_user_id FROM pairwise_ndas n
      JOIN users founder ON founder.id = n.party_a_user_id JOIN projects p ON p.founder_id = founder.founder_id
      JOIN esign_envelopes e ON e.envelope_uuid = n.nda_envelope_uuid
      JOIN esign_recipients r ON r.envelope_id = e.id AND r.user_id = n.party_b_user_id
      WHERE p.id = ? AND r.status = 'signed' AND r.signed_at IS NOT NULL AND (? = 1 OR n.party_b_user_id = ?)
      ORDER BY julianday(r.signed_at) DESC, r.id DESC LIMIT 50`).bind(deal.project_id,privileged?1:0,user.id).all<any>();
    return (rows.results||[]).map(r=>({type:'nda_signed',kind:'documents',label:Number(r.party_b_user_id)===Number(user.id)?'You signed the NDA':'An investor signed the NDA',at:r.at,mine:Number(r.party_b_user_id)===Number(user.id)}));
  });
  return events;
}

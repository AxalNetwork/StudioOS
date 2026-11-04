/** D4492: venture customer pipeline, explicit marketing permissions and HMAC suppressions; never sends. */
import type { Env, User } from '../types';
import { CONTACT_STATUSES, prepareContactInsert } from '../routes/contacts';
import { parseCsv } from '../routes/imports';
import { indexHmac } from './columnCipher';

export const PROSPECT_STATUSES = CONTACT_STATUSES;
export const MARKETING_CHANNELS = ['email','whatsapp','telegram','sms','voice','linkedin'] as const;
export const CONSENT_BASES = ['opted_in','wrote_first','none'] as const;
export const PROSPECT_SOURCES = ['import','linkedin_csv','website','lovable','manual','update_ask','crm'] as const;
const REASONS = ['manual','opted_out','requested','bounced'];
type Body = Record<string, unknown>;
type Contact = { id: number; uid: string; project_id: number; name: string | null; organization: string | null; email: string; status: string; source: string | null; utm_json: string | null; message: string | null; created_at: string; updated_at: string };
export class ProspectsRefused extends Error {
  status:number; sentence:string; field?:string;
  constructor(status:number,sentence:string,field?:string) { super(sentence); this.status=status; this.sentence=sentence; this.field=field; }
}
const bad = (sentence: string, field: string): never => { throw new ProspectsRefused(400, sentence, field); };
const text = (v: unknown, max: number, field: string, required = false): string | null => {
  if (v == null || v === '') { if (required) return bad('This field is required.', field); return null; }
  if (typeof v !== 'string' || v.trim().length > max) return bad('This field is too long or is not text.', field);
  const s = v.trim(); if (!s && required) return bad('This field is required.', field); return s || null;
};
export function prospectEmail(v: unknown): string {
  const s = text(v, 254, 'email', true)!.toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return bad('Enter a valid email address.', 'email');
  return s;
}
const safeCardText = (v: unknown, max = 200): string | null => typeof v === 'string' && !/[^\s@]+@[^\s@]+/.test(v) ? v.trim().slice(0,max) || null : null;
const stamp = () => new Date().toISOString();
const audit = (env: Env, pid: number, user: User, action: string, details: object) => env.DB.prepare(
  'INSERT INTO activity_logs(user_id, project_id, action, details) VALUES(?, ?, ?, ?)').bind(user.id,pid,action,JSON.stringify(details));
const sourceSql = `CASE WHEN source IN ('landing','website','brand') THEN 'website' WHEN source IN ('lovable','lovable_signup') THEN 'lovable' WHEN source IN ('linkedin','linkedin_csv') THEN 'linkedin_csv' WHEN source IN ('import','csv','import_csv') THEN 'import' WHEN source IN ('manual','added_by_hand') THEN 'manual' WHEN source IN ('update_ask','update_call') THEN 'update_ask' ELSE 'crm' END`;
const sourceOf = (raw: string | null) => ({landing:'website',brand:'website',lovable_signup:'lovable',linkedin:'linkedin_csv',csv:'import',import_csv:'import',added_by_hand:'manual',update_call:'update_ask'} as Record<string,string>)[raw||''] || (raw && PROSPECT_SOURCES.includes(raw as any) ? raw : 'crm');
function utmOf(raw: string | null): Record<string,string> | null {
  try { const o = JSON.parse(raw || 'null'); if (!o || typeof o !== 'object') return null;
    const out: Record<string,string> = {}; for (const key of ['utm_source','utm_medium','utm_campaign','utm_term','utm_content']) {
      const value = safeCardText(o[key]); if (value) out[key] = value;
    } return Object.keys(out).length ? out : null;
  } catch { return null; }
}
export async function prospect(env: Env, pid: number, uid: string): Promise<Contact> {
  const row = await env.DB.prepare("SELECT id,uid,project_id,name,organization,email,status,source,utm_json,message,created_at,updated_at FROM contacts WHERE uid=? AND project_id=? AND audience='customer'").bind(uid,pid).first<Contact>();
  if (!row) throw new ProspectsRefused(404, 'No such prospect.');
  return row;
}
async function campaign(env: Env, pid: number, uid: unknown) {
  if (uid == null || uid === '') return null;
  if (typeof uid !== 'string' || uid.length > 80) return bad('Choose a campaign of this venture.', 'campaign');
  const row = await env.DB.prepare('SELECT uid,utm_campaign FROM grow_campaigns WHERE uid=? AND project_id=? AND archived_at IS NULL').bind(uid,pid).first<{uid:string;utm_campaign:string|null}>();
  if (!row) throw new ProspectsRefused(404, 'No such campaign.', 'campaign');
  return row;
}
export async function prospectPipeline(env: Env, pid: number, filter: {source?: string; campaign?: string; per_status?: string}) {
  const source = filter.source || '';
  if (source && !PROSPECT_SOURCES.includes(source as any)) return bad('Choose a recorded source.', 'source');
  const per = filter.per_status == null ? 20 : Number(filter.per_status);
  if (!Number.isInteger(per) || per < 1 || per > 100) return bad('Read from 1 to 100 prospects per status.', 'per_status');
  const selected = await campaign(env,pid,filter.campaign);
  if (selected && !selected.utm_campaign) return { available:false,reason:'Not recorded: this campaign has no UTM tag.',total:null,columns:[] };
  // json_valid guards malformed old attribution before json_extract. All request values are bound.
  const where = `project_id=? AND audience='customer' AND (?='' OR ${sourceSql}=?) AND (? IS NULL OR CASE WHEN json_valid(utm_json) THEN json_extract(utm_json,'$.utm_campaign') END=?)`;
  const args = [pid,source,source,selected?.utm_campaign ?? null,selected?.utm_campaign ?? null];
  const totals = await env.DB.prepare(`SELECT status,COUNT(*) AS n FROM contacts WHERE ${where} GROUP BY status`).bind(...args).all<{status:string;n:number}>();
  if ((totals.results||[]).some(row=>!PROSPECT_STATUSES.includes(row.status))) return {available:false,reason:'Not recorded: some prospects have an unsupported status.',total:null,columns:[]};
  const rows = await env.DB.prepare(`SELECT uid,name,organization,status,source,utm_json,created_at,updated_at,
    (SELECT MIN(due_date) FROM contact_tasks t WHERE t.contact_id=ranked.id AND t.done=0) AS due_date,
    (SELECT MAX(created_at) FROM contact_replies r WHERE r.contact_id=ranked.id AND r.direction='inbound') AS replied_at
    FROM (SELECT id,uid,name,organization,status,source,utm_json,created_at,updated_at,
      ROW_NUMBER() OVER (PARTITION BY status ORDER BY updated_at DESC,id DESC) AS position FROM contacts WHERE ${where}) ranked WHERE position<=?`).bind(...args,per).all<any>();
  const columns = PROSPECT_STATUSES.map(status => {
    const cards = (rows.results || []).filter(r=>r.status===status).map(r=>({uid:r.uid,name:safeCardText(r.name,120),company:safeCardText(r.organization),title:null,
      source:sourceOf(r.source),status:r.status,utm:utmOf(r.utm_json),due_date:typeof r.due_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.due_date)?r.due_date:null,replied_at:r.replied_at,created_at:r.created_at,updated_at:r.updated_at}));
    const count = Number(totals.results?.find(r=>r.status===status)?.n || 0);
    return {status,count,cards,more:Math.max(0,count-cards.length)};
  });
  return {available:true,total:columns.reduce((n,c)=>n+c.count,0),columns,per_status:per};
}
export function consentValue(channel: unknown, input: Body) {
  if (!MARKETING_CHANNELS.includes(channel as any)) return bad('Choose a supported marketing channel.', 'channel');
  if (!CONSENT_BASES.includes(input.basis as any)) return bad('Choose how this person agreed, or no consent yet.', 'basis');
  const basis = String(input.basis);
  const proof = basis === 'none' ? null : text(input.proof,280,'proof',true);
  return {channel:String(channel),basis,proof};
}
function consentStatement(env: Env, pid:number, uid: string, user: User, value: ReturnType<typeof consentValue>) {
  return env.DB.prepare(`INSERT INTO contact_marketing_consents(contact_id,channel,basis,proof,recorded_at,recorded_by)
    SELECT id,?,?,?,?,? FROM contacts WHERE uid=? AND project_id=? AND audience='customer'
    ON CONFLICT(contact_id,channel) DO UPDATE SET basis=excluded.basis,proof=excluded.proof,recorded_at=excluded.recorded_at,recorded_by=excluded.recorded_by`)
    .bind(value.channel,value.basis,value.proof,stamp(),user.id,uid,pid);
}
export async function saveProspectConsent(env: Env,pid:number,user:User,uid:string,channel:string,b:Body) {
  await prospect(env,pid,uid); const value=consentValue(channel,b);
  await env.DB.batch([consentStatement(env,pid,uid,user,value),audit(env,pid,user,'grow.prospect.consent',{uid,channel:value.channel,basis:value.basis})]);
  return {ok:true};
}
function creation(env:Env,pid:number,user:User,b:Body,tag:string|null) {
  const email=prospectEmail(b.email),name=text(b.name,120,'name',true),organization=text(b.company,200,'company'),note=text(b.note,2000,'note');
  const source=b.source == null ? 'manual' : String(b.source);
  if (!PROSPECT_SOURCES.includes(source as any)) return bad('Choose a recorded source.', 'source');
  const value=consentValue(b.channel || 'email',{basis:b.basis ?? 'none',proof:b.proof});
  const insert=prepareContactInsert(env,{projectId:pid,email,name,audience:'customer',source,message:note,utm:tag?{utm_campaign:tag}:null});
  return {uid:insert.uid,statements:[insert.statement,
    env.DB.prepare('UPDATE contacts SET organization=? WHERE uid=? AND project_id=?').bind(organization,insert.uid,pid),
    consentStatement(env,pid,insert.uid,user,value),audit(env,pid,user,'grow.prospect.add',{uid:insert.uid,source})]};
}
export async function addProspect(env:Env,pid:number,user:User,b:Body) {
  const selected=await campaign(env,pid,b.campaign);
  if (selected&&!selected.utm_campaign) return bad('Add a UTM tag to the campaign before linking a prospect.', 'campaign');
  const result=creation(env,pid,user,b,selected?.utm_campaign??null); await env.DB.batch(result.statements); return {uid:result.uid};
}
export async function setProspectStatus(env:Env,pid:number,user:User,uid:string,b:Body) {
  const row=await prospect(env,pid,uid); const status=String(b.status || '');
  if (!PROSPECT_STATUSES.includes(status)) return bad('Choose a contact status.', 'status');
  await env.DB.batch([env.DB.prepare('UPDATE contacts SET status=?,last_activity_at=?,updated_at=? WHERE id=? AND project_id=?').bind(status,stamp(),stamp(),row.id,pid),
    audit(env,pid,user,'grow.prospect.status',{uid,status})]); return {ok:true,status};
}
export async function prospectDetail(env:Env,pid:number,uid:string) {
  const row=await prospect(env,pid,uid);
  const [consents,replies,tasks]=await Promise.all([
    env.DB.prepare('SELECT channel,basis,proof,recorded_at FROM contact_marketing_consents WHERE contact_id=? ORDER BY channel').bind(row.id).all(),
    env.DB.prepare('SELECT direction,created_at FROM contact_replies WHERE contact_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(row.id).all(),
    env.DB.prepare('SELECT title,due_date,done,created_at FROM contact_tasks WHERE contact_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(row.id).all(),
  ]);
  return {uid:row.uid,name:row.name,company:row.organization,title:null,email:row.email,source:sourceOf(row.source),status:row.status,utm:utmOf(row.utm_json),note:row.message,
    created_at:row.created_at,consents:consents.results||[],replies:replies.results||[],tasks:tasks.results||[],sequence:null,sequence_reason:'Not recorded: no outreach sequence is linked.'};
}
export async function suppressionHash(env:Env,pid:number,address:string) {
  return indexHmac(env,'venture_suppressions','address_hash',`${pid}:${prospectEmail(address)}`);
}
const suppressionKeyTag=(env:Env,pid:number)=>indexHmac(env,'venture_suppressions','key_tag',String(pid));
export async function suppressionList(env:Env,pid:number) {
  const [count,rows]=await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM venture_suppressions WHERE project_id=?').bind(pid).first<{n:number}>(),
    env.DB.prepare('SELECT id,reason,created_at FROM venture_suppressions WHERE project_id=? ORDER BY id DESC LIMIT 200').bind(pid).all(),
  ]); return {count:Number(count?.n||0),entries:rows.results||[]};
}
export async function addSuppression(env:Env,pid:number,user:User,b:Body) {
  const [hash,keyTag]=await Promise.all([suppressionHash(env,pid,prospectEmail(b.email)),suppressionKeyTag(env,pid)]); const reason=String(b.reason||'manual');
  if (!REASONS.includes(reason)) return bad('Choose a suppression reason.', 'reason');
  await env.DB.batch([env.DB.prepare('INSERT INTO venture_suppressions(project_id,address_hash,key_tag,reason) VALUES(?,?,?,?) ON CONFLICT(project_id,address_hash) DO UPDATE SET reason=excluded.reason').bind(pid,hash,keyTag,reason),
    audit(env,pid,user,'grow.suppression.add',{reason})]); return {ok:true};
}
export async function removeSuppression(env:Env,pid:number,user:User,id:string) {
  if (!/^[1-9]\d*$/.test(id)) throw new ProspectsRefused(404,'No such suppression.');
  const row=await env.DB.prepare('SELECT id FROM venture_suppressions WHERE id=? AND project_id=?').bind(Number(id),pid).first();
  if (!row) throw new ProspectsRefused(404,'No such suppression.');
  await env.DB.batch([env.DB.prepare('DELETE FROM venture_suppressions WHERE id=? AND project_id=?').bind(Number(id),pid),audit(env,pid,user,'grow.suppression.remove',{id:Number(id)})]); return {ok:true};
}
export async function outreachSettings(env:Env,pid:number) {
  const row=await env.DB.prepare('SELECT quiet_from,quiet_to,tz_mode,updated_at FROM venture_outreach_settings WHERE project_id=?').bind(pid).first();
  return {settings:row,reason:row?null:'Not recorded: quiet hours have not been saved.'};
}
export async function saveOutreachSettings(env:Env,pid:number,user:User,b:Body) {
  const valid=(v:unknown)=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  if (!valid(b.quiet_from)||!valid(b.quiet_to)||b.quiet_from===b.quiet_to||b.tz_mode!=='recipient') return bad('Choose different HH:MM quiet hours in the recipient’s time.', 'quiet_from');
  await env.DB.batch([env.DB.prepare(`INSERT INTO venture_outreach_settings(project_id,quiet_from,quiet_to,tz_mode,updated_by) VALUES(?,?,?,'recipient',?)
    ON CONFLICT(project_id) DO UPDATE SET quiet_from=excluded.quiet_from,quiet_to=excluded.quiet_to,tz_mode='recipient',updated_by=excluded.updated_by,updated_at=datetime('now')`)
    .bind(pid,b.quiet_from,b.quiet_to,user.id),audit(env,pid,user,'grow.outreach.settings',{quiet_from:b.quiet_from,quiet_to:b.quiet_to,tz_mode:'recipient'})]); return outreachSettings(env,pid);
}
export async function marketingSummary(env:Env,pid:number,segment?:string) {
  if (segment) {
    if (!/^[1-9]\d*$/.test(segment)) return bad('Choose a segment of this venture.', 'segment');
    const row=await env.DB.prepare('SELECT id FROM customer_segments WHERE id=? AND project_id=?').bind(Number(segment),pid).first();
    if (!row) throw new ProspectsRefused(404,'No such segment.');
    return {available:false,per_channel:null,opted_in:null,no_consent:null,email_reachable:null,reason:'Not recorded: contacts are not linked to this segment.'};
  }
  const keyTag=await suppressionKeyTag(env,pid);
  const oldKey=await env.DB.prepare('SELECT id FROM venture_suppressions WHERE project_id=? AND key_tag<>? LIMIT 1').bind(pid,keyTag).first();
  if(oldKey)throw new ProspectsRefused(503,'Suppression records use a different key and must be checked before reachability can be read.');
  const [contacts,consents]=await Promise.all([
    env.DB.prepare("SELECT id,email FROM contacts WHERE project_id=? AND audience='customer' ORDER BY id LIMIT 5001").bind(pid).all<{id:number;email:string}>(),
    env.DB.prepare("SELECT m.contact_id,m.channel,m.basis FROM contact_marketing_consents m JOIN contacts c ON c.id=m.contact_id WHERE c.project_id=? AND c.audience='customer' LIMIT 30001").bind(pid).all<{contact_id:number;channel:string;basis:string}>(),
  ]);
  if((contacts.results||[]).length>5000)throw new ProspectsRefused(503,'The consent summary is too large to read here. Narrow the audience first.');
  const byContact=new Map<number,Array<{channel:string;basis:string}>>();
  for(const c of consents.results||[]){if(c.basis==='none')continue;const rows=byContact.get(c.contact_id)||[];rows.push(c);byContact.set(c.contact_id,rows);}
  const addressHashes=new Map<number,string>();
  await Promise.all((contacts.results||[]).map(async contact=>{
    if(!(byContact.get(contact.id)||[]).some(c=>c.channel==='email'))return;
    let address:string;try{address=prospectEmail(contact.email);}catch{return;}
    addressHashes.set(contact.id,await suppressionHash(env,pid,address));
  }));
  const suppressed=await env.DB.prepare('SELECT address_hash FROM venture_suppressions WHERE project_id=? AND address_hash IN (SELECT value FROM json_each(?))')
    .bind(pid,JSON.stringify([...addressHashes.values()])).all<{address_hash:string}>();
  const hashes=new Set((suppressed.results||[]).map(r=>r.address_hash));
  const per_channel=Object.fromEntries(MARKETING_CHANNELS.map(c=>[c,0])),opted_in={...per_channel}; let no_consent=0,email_reachable=0;
  for (const contact of contacts.results||[]) {
    const mine=byContact.get(contact.id)||[];
    if (!mine.length) no_consent++;
    for (const item of mine) { if (Object.hasOwn(per_channel,item.channel)) { per_channel[item.channel]++; if(item.basis==='opted_in') opted_in[item.channel]++; } }
    const hash=addressHashes.get(contact.id);
    if(hash&&!hashes.has(hash))email_reachable++;
  }
  return {available:true,per_channel,opted_in,no_consent,email_reachable,reason:null};
}
export async function importProspects(env:Env,pid:number,user:User,b:Body) {
  if (typeof b.csv!=='string'||new TextEncoder().encode(b.csv).byteLength>1_000_000) return bad('Import a CSV file up to 1 MB.', 'csv');
  const parsed=parseCsv(b.csv),headers=parsed.headers.map(h=>h.trim().toLowerCase());
  const allowed=['name','email','company','source','campaign','note','consent_channel','consent_basis','consent_proof'];
  if (!headers.includes('email')||!headers.includes('consent_basis')||new Set(headers).size!==headers.length||headers.some(h=>!allowed.includes(h))) return bad('Use the supported headers, including email and consent_basis.', 'csv');
  if (parsed.rows.length>1000) return bad('Import up to 1,000 prospects at a time.', 'csv');
  // Reject unterminated quoted fields, which the legacy parser otherwise tolerates.
  if ((b.csv.match(/"/g)||[]).length%2) return bad('The CSV has an unfinished quoted field.', 'csv');
  const campaigns=await env.DB.prepare('SELECT uid,utm_campaign FROM grow_campaigns WHERE project_id=? AND archived_at IS NULL').bind(pid).all<{uid:string;utm_campaign:string|null}>();
  const tags=new Map((campaigns.results||[]).map(c=>[c.uid,c.utm_campaign]));
  const errors:Array<{row:number;field:string;message:string}>=[],uids:string[]=[]; let statements:D1PreparedStatement[]=[];
  for (let i=0;i<parsed.rows.length;i++) {
    try {
      const cells=parsed.rows[i]; if(cells.length!==headers.length) throw new ProspectsRefused(400,'This row does not match the headers.','csv');
      const value=Object.fromEntries(headers.map((h,j)=>[h,cells[j]]));
      let tag:string|null=null;
      if (value.campaign) { if(!tags.has(value.campaign)||!tags.get(value.campaign)) throw new ProspectsRefused(400,'Choose a campaign with a UTM tag in this venture.','campaign'); tag=tags.get(value.campaign)!; }
      const made=creation(env,pid,user,{...value,source:value.source||'import',channel:value.consent_channel||'email',basis:value.consent_basis,proof:value.consent_proof},tag);
      statements.push(...made.statements);uids.push(made.uid);
    } catch(error) {
      if (!(error instanceof ProspectsRefused)) throw error;
      errors.push({row:i+2,field:error.field==='basis'?'consent_basis':error.field==='proof'?'consent_proof':error.field||'csv',message:'This row was not imported. Check this field.'});
    }
    if (statements.length>=80) { await env.DB.batch(statements); statements=[]; }
  }
  if (statements.length) await env.DB.batch(statements);
  return {imported:uids.length,uids,errors};
}

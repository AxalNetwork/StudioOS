/** D631: recorded fund facts and audited, immutable issued report periods. */
import type { Env } from '../types';
import { deleteReportWithoutStatement, reportHasStatement } from './mercury/investorFeeds';
import { effectiveDisplayName } from './profileExpansion';
import { fundFigures } from './fundReportBuild';
import { asTotals, capitalToDate, deployedAndSectors } from './fundSnapshotFigures';
const SENTENCES={
 not_found:'Fund or reporting period not found.',
 period:'Record a period label of up to 100 characters.',
 dates:'Record valid start and end dates, with the end on or after the start.',
 narrative:'Record paragraphs and dated entries within the report limits.',
 issued:'This period is issued and cannot be edited. Issue a correcting period instead.',
 conflict:'The period changed or its label is already used. Read it again before saving.',
 correction:'A correcting period must refer to an issued period of this fund.',
 linked_pack:'This draft is linked to a reporting pack and cannot be deleted.',
 linked_statement:'This draft has a linked bank statement and cannot be deleted.',
 missing:'This reporting period has not been recorded.',
} as const;
export class FundReportRefusal extends Error {
 publicMessage:string;status:number;
 constructor(kind:keyof typeof SENTENCES,status=400){const sentence=SENTENCES[kind]??'The report request could not be recorded.';super(sentence);this.publicMessage=sentence;this.status=status;}
}
export const reportId=(value:unknown):number|null=>typeof value==='string' && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value):null;
const parse=(raw:unknown)=>{if(typeof raw!=='string'||!raw)return {};try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw new Error('Report content unreadable');}};
const date=(value:unknown):value is string=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const instant=new Date(value+'T00:00:00Z');return Number.isFinite(instant.getTime())&&instant.toISOString().slice(0,10)===value;};
const text=(value:unknown,max:number)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
function narrative(value:any){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new FundReportRefusal('narrative');
 const paragraphs=(rows:any)=>{if(!Array.isArray(rows)||rows.length>50||rows.some(p=>!text(p,10000)))throw new FundReportRefusal('narrative');return rows.map((p:string)=>p.trim());};
 const entries=(rows:any,developments:boolean)=>{if(!Array.isArray(rows)||rows.length>100||rows.some(r=>!r||!date(developments?r.date:r.d)||!text(developments?r.body:r.e,10000)||(developments&&!text(r.title,200))))throw new FundReportRefusal('narrative');return rows.map((r:any)=>developments?{date:r.date,title:r.title.trim(),body:r.body.trim()}:{d:r.d,e:r.e.trim()});};
 const result={letter:paragraphs(value.letter??[]),developments:entries(value.developments??[],true),outlook:paragraphs(value.outlook??[]),subsequent:entries(value.subsequent??[],false)};
 if(JSON.stringify(result).length>200000)throw new FundReportRefusal('narrative');return result;
}
export function shapeFundPeriod(row:any){
 if(!row)return null;
 const notes=parse(row.notes);const { _receipt,...content }=notes;
 let recorded;try{recorded=narrative(content);}catch{throw new Error('Report content unreadable');}
 if(!['draft','issued'].includes(row.status))throw new Error('Report state unreadable');
 return {id:row.id,fund_id:row.fund_id,period:row.period,period_start:row.period_start,period_end:row.period_end,
  status:row.status,issued_at:row.issued_at,issued_by:row.issued_by,updated_at:row.updated_at,
  narrative:recorded,revision:_receipt?.write_uid??`legacy:${row.id}:${row.updated_at}`,
  corrects_period_id:_receipt?.corrects_period_id??null};
}
function dollars(value:unknown):number|null{
 if(value===null||value===undefined)return null;
 const cents=typeof value==='number'?Math.round(value*100):NaN;
 if(!Number.isSafeInteger(cents)||cents<0)throw new Error('Fund money unreadable');return cents;
}
export async function readFundPage(env:Env,fund:any,canManage:boolean){
 if(fund.fund_size_cents!==null&&fund.fund_size_cents!==undefined&&(!Number.isSafeInteger(fund.fund_size_cents)||fund.fund_size_cents<0))throw new Error('Fund size unreadable');
 const lps=await env.DB.prepare(`SELECT COUNT(*) AS lp_count,COUNT(commitment_amount) AS commitments_recorded,
  SUM(commitment_amount) AS committed FROM limited_partners WHERE fund_id=?`).bind(fund.id).first<any>();
 const positions=await env.DB.prepare(`SELECT COUNT(*) AS position_count,COUNT(invested_amount) AS investments_recorded,
  SUM(invested_amount) AS invested FROM portfolio_positions WHERE fund_id=?`).bind(fund.id).first<any>();
 if(!lps||!positions||!Number.isSafeInteger(lps.lp_count)||!Number.isSafeInteger(positions.position_count))throw new Error('Fund totals unreadable');
 const committed=lps.lp_count===0?0:lps.commitments_recorded===lps.lp_count?dollars(lps.committed):null;
 const invested=positions.position_count>0&&positions.investments_recorded===positions.position_count?dollars(positions.invested):null;
 let lpa=null;
 if(fund.lpa_doc_id){lpa=await env.DB.prepare('SELECT status,version,updated_at FROM legal_documents WHERE id=?').bind(fund.lpa_doc_id).first<any>();if(!lpa)throw new Error('Recorded LPA unreadable');}
 const periods=await env.DB.prepare("SELECT id,period,status,issued_at FROM fund_report_periods WHERE fund_id=? AND (?=1 OR status='issued') ORDER BY period_start DESC,id DESC").bind(fund.id,canManage?1:0).all();
 if(periods.success!==true||!Array.isArray(periods.results))throw new Error('Fund periods unreadable');
 return {periods:periods.results,fund:{id:fund.id,name:fund.name,status:fund.status,vintage_year:fund.vintage_year,
  size_cents:fund.fund_size_cents>0?fund.fund_size_cents:null,lp_count:lps.lp_count,
  gp:{name:fund.gp_name??null,title:fund.gp_title??null,entity:fund.gp_entity??null,email:fund.gp_email??null},
  providers:{fund_admin:fund.fund_admin??null,auditor:fund.auditor??null,legal_counsel:fund.legal_counsel??null,custodian:fund.custodian??null,valuation_policy:fund.valuation_policy??null}},
  totals:{committed_cents:committed,invested_cents:invested,
   committed_reason:committed===null?'Not every LP has a recorded commitment.':null,
   invested_reason:invested===null?'No complete invested amount is recorded for attributed positions.':null},
  lpa,can_manage:canManage,currency:'USD'};
}
export async function readFundPeriod(env:Env,fundId:number,periodId:number,canManage:boolean){
 const row=await env.DB.prepare('SELECT * FROM fund_report_periods WHERE fund_id=? AND id=?').bind(fundId,periodId).first<any>();
 if(!row||(!canManage&&row.status!=='issued'))throw new FundReportRefusal('not_found',404);
 let period:any=shapeFundPeriod(row);
 if(period?.corrects_period_id){const original=await env.DB.prepare("SELECT period FROM fund_report_periods WHERE fund_id=? AND id=? AND status='issued'").bind(fundId,period.corrects_period_id).first<any>();if(!original)throw new Error('Corrected period unreadable');period={...period,corrects_period:original.period};}
 // D6249: a draft reads as it did. An issued period adds what was frozen at issue, who issued it, and what corrects it.
 if(period.status!=='issued')return period;
 return {...period,...await issuedFigures(env,row),...await issuerName(env,row.issued_by),corrected_by_period_id:await correctedBy(env,fundId,row.id)};
}
const PACK_SCHEMA='lp_quarterly_report/1';
/** D6249: a frozen JSON object, or a throw. Unlike `parse`, an empty or absent string is not `{}`. */
function frozenObject(raw:unknown,what:string):Record<string,any>{
 try{const value=typeof raw==='string'?JSON.parse(raw):null;if(value&&typeof value==='object'&&!Array.isArray(value))return value;}catch{/* falls through */}
 throw new Error(`${what} unreadable`);
}
const cents=(v:unknown)=>v===null||(Number.isSafeInteger(v)&&(v as number)>=0);
/**
 * D6249: the issued pack's fund-level figures when the period was issued
 * through the reporting queue (the same rows `/lp-portal` reads), never its
 * statements list. Otherwise the two totals `readFundPage` froze into
 * `snapshot_json`, picked one by one: the rest of that snapshot is the
 * manager's page (drafts in its period list, `can_manage: true`). A failed
 * query or a corrupt record throws, so the route answers Unreadable.
 */
async function issuedFigures(env:Env,row:any){
 const packs=await env.DB.prepare(`SELECT figures_json FROM fund_report_drafts
   WHERE kind='lp_quarterly_report' AND status='issued' AND fund_id=? AND report_period_id=? ORDER BY id LIMIT 2`).bind(row.fund_id,row.id).all<any>();
 if(packs.success!==true||!Array.isArray(packs.results)||packs.results.length>1)throw new Error('Report pack unreadable');
 if(packs.results.length===1){
  const {statements:_statements,...figures}=frozenObject(packs.results[0].figures_json,'Report pack');
  if(figures.schema!==PACK_SCHEMA)throw new Error('Report pack unreadable');
  return {figures:{source:'report_pack',...figures},figures_reason:null};
 }
 if(row.snapshot_json===null||row.snapshot_json===undefined)return {figures:null,figures_reason:'Not recorded: no figures were frozen when this period was issued.'};
 const snapshot=frozenObject(row.snapshot_json,'Report snapshot'),t=snapshot.totals;
 // A pack-shaped snapshot whose issued pack is missing, or a snapshot of any other shape, fails these checks.
 if(snapshot.currency!=='USD'||!t||typeof t!=='object'||Array.isArray(t))throw new Error('Report snapshot unreadable');
 const totals:Record<string,number|string|null>={};
 for(const key of ['committed','invested']){
  const value=t[`${key}_cents`],reason=t[`${key}_reason`]??null;
  if(!cents(value)||(reason!==null&&typeof reason!=='string')||(value===null&&!reason))throw new Error('Report snapshot unreadable');
  totals[`${key}_cents`]=value;totals[`${key}_reason`]=value===null?reason:null;
 }
 // D6870: a snapshot issued since carries these too. One issued before keeps what it holds: the key is absent, never 0.
 for(const key of ['called','collected','nav']){
  if(!(`${key}_cents` in t))continue;
  const value=t[`${key}_cents`],reason=t[`${key}_reason`]??null;
  if(!cents(value)||(reason!==null&&typeof reason!=='string')||(value===null&&!reason))throw new Error('Report snapshot unreadable');
  totals[`${key}_cents`]=value;totals[`${key}_reason`]=value===null?reason:null;
 }
 const sectorMix=snapshot.sector_mix===undefined?undefined:sectorMixOf(snapshot.sector_mix);
 return {figures:{source:'issue_snapshot',currency:'USD',totals,...(sectorMix?{sector_mix:sectorMix}:{})},figures_reason:null};
}
/** D6870: a frozen sector mix, checked row by row, or a throw. */
function sectorMixOf(raw:any){
 if(!raw||typeof raw!=='object'||typeof raw.basis!=='string'||!Array.isArray(raw.items))throw new Error('Report snapshot unreadable');
 for(const item of raw.items){
  if(!item||(item.sector!==null&&typeof item.sector!=='string')||!Number.isSafeInteger(item.invested_cents)||item.invested_cents<0
   ||!Number.isSafeInteger(item.position_count)||item.position_count<1)throw new Error('Report snapshot unreadable');
 }
 return {basis:raw.basis,items:raw.items.map((i:any)=>({sector:i.sector,invested_cents:i.invested_cents,position_count:i.position_count}))};
}
/** D6249: the issuer's display name only, never their email or other account fields. */
async function issuerName(env:Env,issuedBy:unknown){
 if(issuedBy===null||issuedBy===undefined)return {issued_by_name:null,issued_by_name_reason:'Not recorded: the issuing account was not recorded.'};
 const user=await env.DB.prepare('SELECT name,display_name FROM users WHERE id=?').bind(issuedBy).first<any>();
 if(!user)return {issued_by_name:null,issued_by_name_reason:'Not recorded: the issuing account no longer exists.'};
 const name=effectiveDisplayName(user);
 return {issued_by_name:name,issued_by_name_reason:name?null:'Not recorded: the issuing account has no name.'};
}
/** D6249: the latest issued period of this fund that names this one as the period it corrects. A draft correction is not one. */
async function correctedBy(env:Env,fundId:number,periodId:number):Promise<number|null>{
 const next=await env.DB.prepare(`SELECT id FROM fund_report_periods WHERE fund_id=? AND status='issued' AND id<>?
   AND CASE WHEN json_valid(notes) THEN json_extract(notes,'$._receipt.corrects_period_id') END=? ORDER BY issued_at DESC,id DESC LIMIT 1`).bind(fundId,periodId,periodId).first<any>();
 return next?Number(next.id):null;
}
/**
 * D6870: what a GP's own issue freezes. The manager's page as before, with the
 * figures the overview chart plots added to its totals as of the period end:
 * called and collected to date, NAV (the pack's own working), and the
 * positions' sector mix. `invested_*` stays the deployed figure.
 */
async function issueSnapshot(env:Env,fund:any,p:{label:string;start:string;end:string}){
 const page=await readFundPage(env,fund,true);
 const {called,collected}=await capitalToDate(env,fund.id,p.end);
 const {nav}=await fundFigures(env,fund,p);
 const {sector_mix}=await deployedAndSectors(env,fund.id);
 return {...page,totals:{...page.totals,...asTotals('called',called),...asTotals('collected',collected),...asTotals('nav',nav)},sector_mix};
}
export async function saveFundPeriod(env:Env,fundId:number,actorId:number,body:any){
 if(!body||!text(body.period,100))throw new FundReportRefusal('period');
 if(!date(body.period_start)||!date(body.period_end)||body.period_end<body.period_start)throw new FundReportRefusal('dates');
 if(body.issue!==undefined&&typeof body.issue!=='boolean')throw new FundReportRefusal('narrative');
 const label=body.period.trim();
 const previous=await env.DB.prepare('SELECT * FROM fund_report_periods WHERE fund_id=? AND period=?').bind(fundId,label).first<any>();
 if(previous?.status==='issued')throw new FundReportRefusal('issued',409);
 if(body.id!==undefined&&(!Number.isSafeInteger(body.id)||body.id<=0||previous?.id!==body.id))throw new FundReportRefusal('conflict',409);
 if(body.revision!==undefined&&(!previous||body.revision!==shapeFundPeriod(previous)?.revision))throw new FundReportRefusal('conflict',409);
 const oldNotes=previous?parse(previous.notes):{};
 const content=narrative(body.narrative===undefined?oldNotes:body.narrative);
 const correction=body.corrects_period_id===undefined?(oldNotes._receipt?.corrects_period_id??null):body.corrects_period_id;
 if(correction!==null){
  if(!Number.isSafeInteger(correction)||correction<=0)throw new FundReportRefusal('correction');
  const source=await env.DB.prepare("SELECT id FROM fund_report_periods WHERE fund_id=? AND id=? AND status='issued'").bind(fundId,correction).first<any>();
  if(!source)throw new FundReportRefusal('correction');
 }
 if(previous&&correction!==(oldNotes._receipt?.corrects_period_id??null))throw new FundReportRefusal('correction');
 const writeUid=crypto.randomUUID(),notes=JSON.stringify({...content,_receipt:{write_uid:writeUid,corrects_period_id:correction}});
 const issue=body.issue===true,status=issue?'issued':'draft',issuedAt=issue?new Date().toISOString():null;
 // The snapshot is recorded by the server, never supplied by a client.
 const fund=await env.DB.prepare('SELECT * FROM vc_funds WHERE id=?').bind(fundId).first<any>();
 if(!fund)throw new FundReportRefusal('not_found',404);
 const snapshot=issue?JSON.stringify(await issueSnapshot(env,fund,{label,start:body.period_start,end:body.period_end})):(previous?.snapshot_json??null);
 const write=previous
  ?env.DB.prepare(`UPDATE fund_report_periods SET period_start=?,period_end=?,notes=?,snapshot_json=?,status=?,issued_at=?,issued_by=?,updated_at=datetime('now')
    WHERE fund_id=? AND id=? AND status='draft' AND notes IS ?`).bind(body.period_start,body.period_end,notes,snapshot,status,issuedAt,issue?actorId:null,fundId,previous.id,previous.notes)
  :env.DB.prepare(`INSERT OR IGNORE INTO fund_report_periods(fund_id,period,period_start,period_end,notes,snapshot_json,status,issued_at,issued_by)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(fundId,label,body.period_start,body.period_end,notes,snapshot,status,issuedAt,issue?actorId:null);
 const results=await env.DB.batch([write,env.DB.prepare(`INSERT INTO activity_logs(action,details,actor,user_id)
  SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM fund_report_periods WHERE fund_id=? AND period=? AND json_extract(notes,'$._receipt.write_uid')=?)`)
  .bind(issue?'fund_report_period_issued':'fund_report_draft_saved',JSON.stringify({fund_id:fundId,period:label,corrects_period_id:correction}),String(actorId),actorId,fundId,label,writeUid)]);
 if(results.length!==2||results.some(r=>r.success!==true))throw new Error('Report transaction unreadable');
 if(Number(results[0].meta.changes)!==1)throw new FundReportRefusal('conflict',409);
 const row=await env.DB.prepare('SELECT * FROM fund_report_periods WHERE fund_id=? AND period=?').bind(fundId,label).first<any>();
 if(!row)throw new Error('Saved report unreadable');return {created:!previous,period:shapeFundPeriod(row)};
}


export async function deleteFundPeriod(env: Env, fundId: number, periodId: number, actorId: number, revision: unknown) {
 const read = () => env.DB.prepare('SELECT * FROM fund_report_periods WHERE fund_id=? AND id=?').bind(fundId,periodId).first<any>();
 const row = await read();
 if(!row)throw new FundReportRefusal('not_found',404);
 if(row.status!=='draft')throw new FundReportRefusal('issued',409);
 const current = shapeFundPeriod(row);
 if(typeof revision!=='string'||revision!==current?.revision)throw new FundReportRefusal('conflict',409);
 const results = await deleteReportWithoutStatement(env, {
  fundId, periodId, actorId, notes: row.notes, updatedAt: row.updated_at,
  details: JSON.stringify({fund_id:fundId,period_id:periodId,period:current.period,corrects_period_id:current.corrects_period_id,revision:current.revision}),
 });
 if(results.length!==2||results.some(r=>r.success!==true)||results[0].meta.changes!==results[1].meta.changes)throw new Error('Report transaction unreadable');
 if(Number(results[1].meta.changes)===1)return;
 const latest=await read();
 if(!latest)throw new FundReportRefusal('not_found',404);
 if(latest.status!=='draft')throw new FundReportRefusal('issued',409);
 if(await env.DB.prepare('SELECT 1 FROM fund_report_drafts WHERE report_period_id=? LIMIT 1').bind(periodId).first())throw new FundReportRefusal('linked_pack',409);
 if(await reportHasStatement(env,fundId,periodId))throw new FundReportRefusal('linked_statement',409);
 throw new FundReportRefusal('conflict',409);
}

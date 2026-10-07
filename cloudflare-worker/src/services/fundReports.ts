/** D631: recorded fund facts and audited, immutable issued report periods. */
import type { Env } from '../types';
const SENTENCES={
 not_found:'Fund or reporting period not found.',
 period:'Record a period label of up to 100 characters.',
 dates:'Record valid start and end dates, with the end on or after the start.',
 narrative:'Record paragraphs and dated entries within the report limits.',
 issued:'This period is issued and cannot be edited. Issue a correcting period instead.',
 conflict:'The period changed or its label is already used. Read it again before saving.',
 correction:'A correcting period must refer to an issued period of this fund.',
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
 const period=shapeFundPeriod(row);
 if(period?.corrects_period_id){const original=await env.DB.prepare("SELECT period FROM fund_report_periods WHERE fund_id=? AND id=? AND status='issued'").bind(fundId,period.corrects_period_id).first<any>();if(!original)throw new Error('Corrected period unreadable');return {...period,corrects_period:original.period};}
 return period;
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
 const snapshot=issue?JSON.stringify(await readFundPage(env,fund,true)):(previous?.snapshot_json??null);
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

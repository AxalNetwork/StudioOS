/** D1176: each independently readable source retains its state, origin and date. */
import type { Env } from '../../types';
import { runwayMonths } from '../raiseCycle';
import { base, json, obj, scenario, view, type Scope } from './store';

export async function block<T>(read: () => Promise<T>) {
  try { return { state: 'ok' as const, value: await read(), reason: null }; }
  catch { return { state: 'unreadable' as const, value: null, reason: 'This block is Unreadable. Try again.' }; }
}
const cents = (n: unknown): number | null => n == null || typeof n !== 'number' || !Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n * 100)) ? null : Math.round(n * 100);
const integer = (n: unknown): number | null => typeof n === 'number' && Number.isSafeInteger(n) ? n : null;
const fact = (value: number | null, source: string, ref: string, as_of: string | null, reason: string | null = null) => ({
  value, source, ref, as_of, state: value === null ? 'not_recorded' : 'recorded', reason: value === null ? reason ?? 'Not recorded in this source.' : null,
});

export async function roundSources(env: Env, s: Scope, baseRow: any) {
  const [calls, record, cap] = await Promise.all([
    block(async () => (await env.DB.prepare(`SELECT rc.id,rc.name,rc.amount_cents,rc.counsel_approved_at,rc.updated_at,r.currency
      FROM round_calls rc LEFT JOIN raise_rounds r ON r.id=rc.round_id AND r.project_id=rc.project_id
      WHERE rc.project_id=? AND rc.state<>'draft' AND rc.state<>'awaiting_counsel'
        AND rc.counsel_approved_hash=rc.terms_hash AND rc.counsel_approved_at IS NOT NULL
      ORDER BY rc.updated_at DESC,rc.id DESC`).bind(s.projectId).all<any>()).results ?? []),
    block(() => env.DB.prepare("SELECT id,name,target_cents,target_amount,currency,updated_at FROM raise_rounds WHERE project_id=? AND status='active' ORDER BY updated_at DESC,id DESC LIMIT 1").bind(s.projectId).first<any>()),
    block(() => env.DB.prepare('SELECT id,uid,name,inputs_json,result_json,updated_at FROM cap_table_scenarios WHERE project_id=? AND COALESCE(is_variant,0)=0 ORDER BY updated_at DESC,id DESC LIMIT 1').bind(s.projectId).first<any>()),
  ]);
  const candidates: any[] = [];
  for (const c of calls.value ?? []) candidates.push({ ...fact(integer(c.amount_cents),'Document',`round_calls:${c.id}`,c.counsel_approved_at), kind:'round_call',name:c.name,currency:(c.currency??'USD').toLowerCase(),eligible:true });
  if (record.value) {
    const r=record.value;
    candidates.push({ ...fact(r.target_cents==null?cents(r.target_amount):integer(r.target_cents),'Typed',`raise_rounds:${r.id}`,r.updated_at),kind:'round_record',name:r.name,currency:(r.currency??'USD').toLowerCase(),eligible:true });
  }
  if (baseRow) candidates.push({ ...fact(baseRow.amount_to_raise_cents,baseRow.legacy_copied_at?'Recorded':'Typed',`uof_scenarios:${baseRow.id}`,baseRow.updated_at),kind:'plan',name:baseRow.name,currency:baseRow.currency,eligible:true });
  let capTable: any = cap;
  if (cap.value) {
    capTable=await block(async () => {
      const input=json(cap.value.inputs_json); const result=json(cap.value.result_json);
      if (!obj(input)) throw new Error('unreadable');
      const rounds=Array.isArray(input.rounds)?input.rounds:[];
      return { id:cap.value.id,uid:cap.value.uid,name:cap.value.name,source:'Modelled',as_of:cap.value.updated_at,
        rounds:rounds.map((r:any,i:number)=>({ ...fact(cents(r.investment),'Modelled',`cap_table_scenarios:${cap.value.id}:round:${i}`,cap.value.updated_at),name:typeof r.name==='string'?r.name:null })),
        // No scenario link column exists in migration 606. Do not invent one.
        link_state:'not_recorded',link_reason:'No explicit link between a Use of funds scenario and a cap-table scenario is stored.',result };
    });
    for (const c of capTable.value?.rounds??[]) candidates.push({...c,kind:'cap_table',currency:'usd',eligible:false});
  }
  const chosen=candidates.find(c=>c.eligible&&c.value!==null)??null;
  const disagreements=chosen?candidates.filter(c=>c.value!==null&&(c.value!==chosen.value||c.currency!==chosen.currency)).map(c=>({chosen,other:c})):[];
  return { precedence:['round_call','round_record','plan'],chosen,candidates,disagreements,sources:{calls,record,cap_table:capTable},
    reason:chosen?null:'No approved round call, active round target or plan raise is recorded.' };
}
export async function runwayToday(env:Env,s:Scope,mercuryAllowed:boolean) {
  const mercury=mercuryAllowed ? await block(() => env.DB.prepare(`SELECT f.id,f.amount_cents,f.burn_cents,f.as_of FROM mercury_raise_facts f JOIN integrations i ON i.id=f.integration_id
    WHERE f.project_id=? AND f.kind='runway' AND f.fact_key='runway' AND i.user_id=? AND i.provider_key='mercury' AND i.status='active'
    ORDER BY f.as_of DESC,f.id DESC LIMIT 1`).bind(s.projectId,s.user.id).first<any>())
    : {state:'founder_only' as const,value:null,reason:'Mercury figures are visible to the founder only.'};
  const metrics=await block(async ()=>(await env.DB.prepare(`SELECT id,cash_balance,net_burn,source,snapshot_date FROM project_metrics WHERE project_id=? AND (?=1 OR lower(COALESCE(source,''))<>'mercury') ORDER BY snapshot_date DESC,id DESC`).bind(s.projectId,mercuryAllowed?1:0).all<any>()).results??[]);
  const candidates:any[]=[];
  if (mercury.value) {
    const m=mercury.value; const cash=integer(m.amount_cents),burn=integer(m.burn_cents);
    candidates.push({...fact(runwayMonths(cash,burn),'Connector',`mercury_raise_facts:${m.id}`,m.as_of,'No positive recorded net burn.'),cash_cents:cash,burn_cents:burn,kind:'mercury'});
  }
  // Only known connector writers confer Connector provenance. Arbitrary source text cannot.
  const connector=(r:any)=>['stripe','mercury','quickbooks','xero'].includes(String(r.source??'').toLowerCase());
  const snapshots=metrics.value??[];
  for (const m of [...snapshots.filter(connector),...snapshots.filter(r=>!connector(r))]) {
    const cash=cents(m.cash_balance),burn=cents(m.net_burn);
    candidates.push({...fact(runwayMonths(cash,burn),connector(m)?'Connector':m.source==null||m.source==='manual'?'Typed':'Recorded',`project_metrics:${m.id}`,m.snapshot_date,'Cash or positive net burn is Not recorded.'),cash_cents:cash,burn_cents:burn,kind:'metrics'});
  }
  const chosen=candidates.find(c=>c.value!==null)??null;
  return {state:chosen?'recorded':mercury.state==='unreadable'||metrics.state==='unreadable'?'unreadable':'not_recorded',chosen,candidates,
    partial:mercury.state==='unreadable'||metrics.state==='unreadable',sources:{mercury,metrics},reason:chosen?null:'No measured cash and positive burn are recorded. A forecast never supplies runway today.'};
}
export async function planRead(env:Env,s:Scope,mercuryAllowed:boolean) {
  const baseBlock=await block(async ()=>scenario(env,s,await base(env,s)));
  const [round,runway,deck,forecast,projection]=await Promise.all([
    roundSources(env,s,baseBlock.value), runwayToday(env,s,mercuryAllowed),
    block(async ()=>{
      const deck=await env.DB.prepare('SELECT id,version FROM pitch_decks WHERE project_id=? ORDER BY version DESC,id DESC LIMIT 1').bind(s.projectId).first<any>();
      if (!deck) return {state:'not_recorded',reason:'No pitch deck is recorded.',synced_at:null,href:`/raise/pitch?project=${s.projectId}`};
      const p=await env.DB.prepare('SELECT use_of_funds_meta FROM projects WHERE id=?').bind(s.projectId).first<any>();
      const meta=json(p?.use_of_funds_meta,{}); if (!obj(meta)) throw new Error('unreadable');
      return {id:deck.id,version:deck.version,synced_at:meta.deck_synced_at??null,state:meta.deck_synced_at?'synced':'out_of_sync',href:`/raise/pitch?project=${s.projectId}`};
    }),
    block(async ()=>{
      const r=await env.DB.prepare('SELECT assumptions_json,computed_json,updated_at FROM financial_models WHERE project_id=?').bind(s.projectId).first<any>();
      return r?{source:'Modelled',as_of:r.updated_at,assumptions:json(r.assumptions_json),computed:json(r.computed_json),reason:'A forecast is never runway today.'}:null;
    }),
    baseBlock.value?block(()=>view(env,s,baseBlock.value)):Promise.resolve(baseBlock),
  ]);
  const needs_you:{code:string;reason:string}[]=[];
  if (baseBlock.state==='unreadable') needs_you.push({code:'plan_unreadable',reason:baseBlock.reason!});
  if (round.disagreements.length) needs_you.push({code:'round_disagreement',reason:'Recorded round sizes differ. Choose the size for this plan.'});
  if (!runway.chosen) needs_you.push({code:'runway_missing',reason:runway.reason!});
  if (deck.value?.state==='out_of_sync') needs_you.push({code:'deck_out_of_sync',reason:'The deck Ask slide has not been marked in sync with this plan.'});
  const model = (projection.value && ('model' in projection.value)) ? projection.value.model : null;
  if (model?.runway?.value===null) needs_you.push({code:'model_inputs_missing',reason:model.runway.reason});
  if (model?.milestones.value?.some((m:any)=>m.state==='Not costed')) needs_you.push({code:'milestones_not_costed',reason:'Some milestones are Not costed. Their affordability is unknown.'});
  if (model?.milestones.value?.some((m:any)=>m.state==='At risk')) needs_you.push({code:'milestones_at_risk',reason:'Some milestone costs exceed their section allocation.'});
  if (model?.runway.value?.relation==='exact'&&model.runway.value.months<baseBlock.value.target_runway_months) needs_you.push({code:'target_shortfall',reason:'The modelled cash runs out before your target.'});
  return {project_id:s.projectId,viewer:{kind:s.user.role==='admin'?'admin':'founder',can_write:true,mercury:mercuryAllowed},base:projection,round,
    runway_today:runway,forecast,ties:{deck,cap_table:round.sources.cap_table},needs_you};
}

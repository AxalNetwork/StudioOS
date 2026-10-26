/** D1263 (#3286): deterministic, local source adapters. Never calls a connector. */
import type { Env } from '../types';
import { loadPainGroupModel, normPhrase, resolvePhrase, safeParseStrings } from './painGroups';

export const EVIDENCE_AREAS = [
  'Fundraising readiness', 'Investor narrative and Pitch deck', 'Use of funds', 'Data room',
  'Cap table', 'Capital relationships', 'Legal', 'Capital model',
] as const;
export type EvidenceArea = typeof EVIDENCE_AREAS[number];
export type EvidenceSourceLabel = 'connector' | 'document' | 'recorded' | 'signed' | 'typed';
export type EvidenceStrength = 'anecdote' | 'pattern' | 'measured';
type DataRow = Record<string, unknown>;
type Dataset = keyof typeof QUERIES;
export type EvidenceRule = {
  kind: string; dataset: Dataset; source_table: string; areas: readonly EvidenceArea[];
  backs: readonly string[]; source: EvidenceSourceLabel | 'record'; days: 90 | 365; summary: string;
  private_reason?: 'bank' | 'quote';
};
const [READINESS, NARRATIVE, FUNDS, ROOM, CAP, CAPITAL, LEGAL, MODEL] = EVIDENCE_AREAS;
/** One row per evidence kind. Grades belong to SCORING; this table sets none. */
export const EVIDENCE_RULES: readonly EvidenceRule[] = [
  { kind:'revenue-receipt', dataset:'revenue', source_table:'revenue_entries', areas:[READINESS,NARRATIVE], backs:['revenue','traction_proof'], source:'record', days:90, summary:'A revenue receipt is recorded.' },
  { kind:'bank-runway', dataset:'bank', source_table:'mercury_raise_facts', areas:[READINESS], backs:['runway'], source:'connector', days:90, summary:'Runway derived from the company bank is recorded.', private_reason:'bank' },
  { kind:'founder-holding', dataset:'holders', source_table:'cap_table_holders', areas:[READINESS], backs:['team'], source:'record', days:365, summary:'A founder holding is recorded.' },
  { kind:'vesting-schedule', dataset:'vesting', source_table:'cap_table_vesting', areas:[READINESS,CAP], backs:['team','vesting'], source:'record', days:365, summary:'A vesting schedule is recorded.' },
  { kind:'founder-commits', dataset:'contributors', source_table:'github_contributors', areas:[READINESS], backs:['team','commits_90d'], source:'connector', days:90, summary:'Contributions over the recorded ninety-day window are counted.' },
  { kind:'skill-actions', dataset:'skills', source_table:'skill_evidence', areas:[READINESS], backs:['team'], source:'recorded', days:90, summary:'Recorded actions across the founding team are counted.' },
  { kind:'pain-theme', dataset:'themes', source_table:'pain_groups', areas:[NARRATIVE], backs:['interviews','customer_evidence'], source:'recorded', days:365, summary:'An interview-backed pain theme is recorded.' },
  { kind:'consented-quote', dataset:'interviews', source_table:'discovery_interviews', areas:[NARRATIVE], backs:['customer_evidence'], source:'recorded', days:365, summary:'An interview with consent to quote is recorded.', private_reason:'quote' },
  { kind:'icp-fit', dataset:'interviews', source_table:'discovery_interviews', areas:[NARRATIVE], backs:['icp_fit'], source:'recorded', days:365, summary:'An interview records an ICP fit.' },
  { kind:'demand-signal', dataset:'signals', source_table:'demand_signals', areas:[NARRATIVE], backs:['lois','waitlist','pilots','demand'], source:'record', days:365, summary:'A confirmed demand signal is recorded.' },
  { kind:'experiment-result', dataset:'experiments', source_table:'hypothesis_experiments', areas:[NARRATIVE], backs:['experiments'], source:'typed', days:90, summary:'An experiment has a recorded result.' },
  { kind:'validation-verdict', dataset:'verdicts', source_table:'validation_decisions', areas:[NARRATIVE], backs:['verdict'], source:'typed', days:90, summary:'A founder validation decision is recorded; it is not a score.' },
  { kind:'kpi-snapshot', dataset:'metrics', source_table:'project_metrics', areas:[NARRATIVE,MODEL], backs:['mrr','arr','paying_customers','growth','burn','churn','cac','headcount'], source:'record', days:90, summary:'A dated KPI value is recorded.' },
  { kind:'bank-revenue', dataset:'bank', source_table:'mercury_raise_facts', areas:[NARRATIVE], backs:['revenue','revenue_growth'], source:'connector', days:90, summary:'A bank-derived revenue fact is recorded.', private_reason:'bank' },
  { kind:'roadmap-release', dataset:'releases', source_table:'roadmap_releases', areas:[NARRATIVE], backs:['releases'], source:'connector', days:90, summary:'A published release is recorded.' },
  { kind:'must-have-done', dataset:'features', source_table:'mvp_features', areas:[NARRATIVE], backs:['product_delivery'], source:'record', days:90, summary:'A must-have is recorded as done.' },
  { kind:'mapped-bank-spend', dataset:'bankSpend', source_table:'mercury_raise_facts', areas:[FUNDS], backs:['use_of_funds_actuals'], source:'connector', days:90, summary:'Bank spend has a founder-accepted section mapping.', private_reason:'bank' },
  { kind:'hiring-plan', dataset:'hires', source_table:'use_of_funds_hires', areas:[FUNDS], backs:['hiring_plan'], source:'typed', days:90, summary:'A planned hire is recorded; it is not an actual cost.' },
  { kind:'roadmap-milestone', dataset:'milestones', source_table:'roadmap_okrs', areas:[FUNDS], backs:['milestones'], source:'record', days:90, summary:'A roadmap milestone target is recorded.' },
  { kind:'formation-proof', dataset:'formation', source_table:'formation_steps', areas:[ROOM], backs:['formation'], source:'document', days:365, summary:'A completed formation step has recorded proof.' },
  { kind:'filed-obligation', dataset:'obligations', source_table:'entity_obligations', areas:[ROOM,LEGAL], backs:['filings'], source:'signed', days:365, summary:'An entity obligation is recorded as filed.' },
  { kind:'signed-document', dataset:'documents', source_table:'documents', areas:[ROOM,LEGAL], backs:['legal_documents'], source:'signed', days:365, summary:'A document is recorded as signed.' },
  { kind:'github-ip-step', dataset:'ipSteps', source_table:'formation_steps', areas:[ROOM], backs:['ip_step'], source:'connector', days:90, summary:'The GitHub IP step is recorded; it is not a signed assignment.' },
  { kind:'bank-statement', dataset:'bankDocuments', source_table:'data_room_files', areas:[ROOM], backs:['financial_statements'], source:'connector', days:365, summary:'A founder-accepted bank statement is recorded.', private_reason:'bank' },
  { kind:'loi-file', dataset:'signals', source_table:'demand_signals', areas:[ROOM], backs:['lois'], source:'document', days:365, summary:'A letter of intent has a recorded evidence file.' },
  { kind:'revenue-proof', dataset:'revenue', source_table:'revenue_entries', areas:[ROOM], backs:['revenue_proof'], source:'document', days:365, summary:'A revenue receipt has a recorded proof document.' },
  { kind:'accepted-safe', dataset:'safes', source_table:'mercury_raise_proposals', areas:[CAP], backs:['safe'], source:'connector', days:365, summary:'A Mercury SAFE proposal has been accepted.', private_reason:'bank' },
  { kind:'filed-83b', dataset:'filings83b', source_table:'section_83b_trackers', areas:[CAP,LEGAL], backs:['83b'], source:'signed', days:365, summary:'An election has a recorded filing date.' },
  { kind:'signed-founder-equity', dataset:'documents', source_table:'documents', areas:[CAP], backs:['founder_agreement','equity_split'], source:'signed', days:365, summary:'A founder or equity document is recorded as signed.' },
  { kind:'confirmed-receipt', dataset:'receipts', source_table:'mercury_personal_matches', areas:[CAPITAL], backs:['received_capital'], source:'connector', days:90, summary:'A receipt matched to this venture is confirmed.', private_reason:'bank' },
  { kind:'round-call-response', dataset:'responses', source_table:'round_call_recipients', areas:[CAPITAL], backs:['indicative_commitment'], source:'recorded', days:90, summary:'A round-call response is recorded; it is indicative, not received money.' },
  { kind:'typed-commitment', dataset:'prospects', source_table:'raise_prospects', areas:[CAPITAL], backs:['typed_commitment'], source:'typed', days:90, summary:'A founder-recorded commitment is stated, not bank-verified.' },
  { kind:'model-assumption', dataset:'models', source_table:'financial_models', areas:[MODEL], backs:['growth','churn','cac','margin'], source:'typed', days:90, summary:'A saved model assumption is recorded; it is modelled, not an actual.' },
];

/** Static, venture-bound selectors. Sync timestamps are never observation dates. */
const QUERIES = {
  revenue: `SELECT r.id,r.amount_cents,r.currency,r.received_on,r.source,r.verification,r.source_ref,
    d.id AS proof_id,r.updated_at FROM revenue_entries r LEFT JOIN data_room_files d ON d.id=r.proof_document_id AND d.project_id=r.project_id WHERE r.project_id=?`,
  bank: `SELECT f.id,f.kind,f.fact_key,f.value,f.amount_cents,f.burn_cents,f.as_of,f.months FROM mercury_raise_facts f
    JOIN integrations i ON i.id=f.integration_id AND i.provider_key='mercury' AND i.status='active'
    JOIN users u ON u.id=i.user_id AND u.is_active=1 JOIN projects p ON p.id=f.project_id AND p.founder_id=u.founder_id
    WHERE f.project_id=? AND i.user_id=? AND f.kind IN ('runway','revenue')`,
  holders: `SELECT h.id,h.source,h.ownership_pct,h.shares,h.created_at,h.updated_at FROM cap_table_holders h WHERE h.project_id=? AND (h.kind='founder' OR h.founder_role IS NOT NULL)`,
  vesting: `SELECT v.id,v.source,v.start_date,v.total_shares,v.vested_shares,v.updated_at FROM cap_table_vesting v JOIN cap_table_holders h ON h.id=v.holder_id
    WHERE h.project_id=? AND (v.project_id IS NULL OR v.project_id=h.project_id)`,
  contributors: `SELECT g.id,g.commits_90d,g.repository FROM github_contributors g JOIN integrations i ON i.id=g.integration_id
    JOIN github_login_map m ON m.project_id=g.project_id AND m.login=g.login JOIN cap_table_holders h ON h.id=m.holder_id AND h.project_id=g.project_id AND h.founder_role IS NOT NULL
    WHERE g.project_id=? AND i.provider_key='github' AND i.status='active'`,
  skills: `SELECT s.axis,s.source,SUM(s.count_window) AS count_window,MAX(s.last_at) AS last_at FROM skill_evidence s
    JOIN users u ON u.id=s.user_id AND u.is_active=1 JOIN projects p ON p.id=? WHERE u.founder_id=p.founder_id OR EXISTS
    (SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=u.id AND m.status='accepted' AND m.role IN ('owner','cofounder')) GROUP BY s.axis,s.source`,
  themes: `SELECT id,title,updated_at FROM pain_groups WHERE project_id=?`,
  interviews: `SELECT id,interview_date,icp_fit,quote_consent,pains_json,notes,updated_at FROM discovery_interviews WHERE project_id=?`,
  signals: `SELECT id,kind,status,signal_date,source_kind,interview_id,session_id,evidence_file_key,amount_cents,currency,updated_at FROM demand_signals WHERE project_id=? AND status IN ('confirmed','counted')`,
  experiments: `SELECT id,status,result,updated_at FROM hypothesis_experiments WHERE project_id=? AND result IS NOT NULL AND trim(result)<>''`,
  verdicts: `SELECT id,decision,decided_at FROM validation_decisions WHERE project_id=? AND state='given' AND superseded_at IS NULL`,
  metrics: `SELECT id,snapshot_date,source,mrr,arr,cac,ltv,monthly_churn_pct,active_users,new_users,net_burn,headcount,nrr_pct,paying_accounts FROM project_metrics WHERE project_id=?`,
  releases: `SELECT r.id,r.published_at,r.tag,r.commit_sha FROM roadmap_releases r WHERE r.project_id=? AND r.published_at IS NOT NULL AND r.prerelease=0 AND EXISTS
    (SELECT 1 FROM connector_fed_items l JOIN integrations i ON i.id=l.integration_id AND i.provider_key='github' AND i.status='active' WHERE l.project_id=r.project_id AND l.local_table='roadmap_releases' AND l.local_id=r.id AND l.kind='release')`,
  features: `SELECT f.id,f.done_at,f.updated_at,EXISTS(SELECT 1 FROM connector_fed_items l JOIN integrations i ON i.id=l.integration_id AND i.status='active' AND i.provider_key='github'
    WHERE l.project_id=f.project_id AND l.local_table='mvp_features' AND l.local_id=f.id) AS from_github FROM mvp_features f WHERE f.project_id=? AND f.is_must_have=1 AND f.delivery_status='done'`,
  bankSpend: `SELECT f.id,f.fact_key,f.amount_cents,f.months,f.as_of,m.target FROM mercury_raise_facts f JOIN integrations i ON i.id=f.integration_id AND i.provider_key='mercury' AND i.status='active'
    JOIN users u ON u.id=i.user_id AND u.is_active=1 JOIN projects p ON p.id=f.project_id AND p.founder_id=u.founder_id
    JOIN mercury_raise_proposals m ON m.integration_id=f.integration_id AND m.project_id=f.project_id AND m.kind='fund_mapping' AND m.status='accepted' AND m.source_key=f.label
    WHERE f.project_id=? AND i.user_id=? AND f.kind='spend' AND f.months IN (3,6,12) AND m.target IN ('product','go-to-market','infrastructure','operations','reserve')`,
  hires: `SELECT id,role,annual_cents,currency,created_at,updated_at FROM use_of_funds_hires WHERE project_id=?`,
  milestones: `SELECT r.id,r.target_date,r.milestone_due,r.created_at,r.updated_at,EXISTS(SELECT 1 FROM connector_fed_items l JOIN integrations i ON i.id=l.integration_id AND i.provider_key='github' AND i.status='active' WHERE l.project_id=r.project_id AND l.local_table='roadmap_okrs' AND l.local_id=r.id) AS from_github FROM roadmap_okrs r WHERE r.project_id=? AND (r.target_date IS NOT NULL OR r.milestone_due IS NOT NULL)`,
  formation: `SELECT id,state,kind,proof_file_key,created_at,updated_at FROM formation_steps WHERE project_id=? AND state='done' AND proof_file_key IS NOT NULL`,
  obligations: `SELECT o.id,o.kind,o.status,o.resolved_on,o.proof_file_key FROM entity_obligations o JOIN projects p ON p.entity_id=o.entity_id WHERE p.id=? AND o.status='filed'`,
  documents: `SELECT id,doc_type,status,signed_at,updated_at FROM documents WHERE project_id=? AND status='signed'`,
  ipSteps: `SELECT f.id,f.state,f.kind,f.updated_at FROM formation_steps f WHERE f.project_id=? AND f.state='done' AND EXISTS
    (SELECT 1 FROM connector_fed_items l JOIN integrations i ON i.id=l.integration_id AND i.status='active' AND i.provider_key='github'
      WHERE l.project_id=f.project_id AND l.local_table='formation_steps' AND l.local_id=f.id AND l.kind='ip_step')`,
  bankDocuments: `SELECT d.id,m.id AS source_id,CASE WHEN json_valid(m.payload_json) THEN json_extract(m.payload_json,'$.month') END AS month,d.updated_at FROM data_room_files d
    JOIN mercury_raise_proposals m ON m.local_table='data_room_files' AND m.local_id=d.id AND m.project_id=d.project_id AND m.kind='statement' AND m.status='accepted'
    JOIN integrations i ON i.id=m.integration_id AND i.provider_key='mercury' AND i.status='active' JOIN users u ON u.id=i.user_id AND u.is_active=1
    JOIN projects p ON p.id=d.project_id AND p.founder_id=u.founder_id WHERE d.project_id=? AND i.user_id=?`,
  safes: `SELECT m.id,m.local_id,m.local_table,CASE WHEN json_valid(m.payload_json) THEN json_extract(m.payload_json,'$.amount_cents') END AS amount_cents,
    CASE WHEN json_valid(m.payload_json) THEN json_extract(m.payload_json,'$.date') END AS date FROM mercury_raise_proposals m
    JOIN integrations i ON i.id=m.integration_id AND i.provider_key='mercury' AND i.status='active' JOIN users u ON u.id=i.user_id AND u.is_active=1
    JOIN projects p ON p.id=m.project_id AND p.founder_id=u.founder_id WHERE m.project_id=? AND i.user_id=? AND m.kind='safe' AND m.status='accepted' AND m.local_id IS NOT NULL`,
  filings83b: `SELECT id,status,mailed_at,filing_method,election_doc_id,receipt_doc_id FROM section_83b_trackers WHERE project_id=? AND status='filed'`,
  receipts: `SELECT m.id,m.amount_cents,m.posted_on,m.target_id FROM mercury_personal_matches m JOIN raise_prospects r ON m.target_kind='raise_prospect' AND r.id=m.target_id
    JOIN integrations i ON i.id=m.integration_id AND i.provider_key='mercury' AND i.status='active' JOIN users u ON u.id=i.user_id AND u.is_active=1
    JOIN projects p ON p.id=r.project_id AND p.founder_id=u.founder_id WHERE r.project_id=? AND i.user_id=? AND m.state='confirmed'`,
  responses: `SELECT r.id,r.commitment_cents,r.responded_at,r.last_response_at,r.committed_at FROM round_call_recipients r JOIN round_calls c ON c.id=r.call_id WHERE c.project_id=? AND r.responded_at IS NOT NULL`,
  prospects: `SELECT id,amount_cents,currency,commit_status,created_at,updated_at FROM raise_prospects WHERE project_id=? AND stage='committed' AND commit_status IS NOT NULL`,
  models: `SELECT id,assumptions_json,updated_at FROM financial_models WHERE project_id=? AND updated_by IS NOT NULL`,
} as const;
const BANK_DATASETS = new Set<Dataset>(['bank','bankSpend','bankDocuments','safes','receipts']);
export type EvidenceCandidate = {
  area: EvidenceArea; kind: string; source_table: string; source_ref: string; provider: string | null;
  source_label: EvidenceSourceLabel; strength: EvidenceStrength; observed_on: string | null; summary: string;
  value_num: number | null; value_unit: string | null; currency: string | null; snapshot_hash: string;
  private_reason: 'bank' | 'quote' | null; backs: readonly string[]; stale: boolean | null; date_reason: string | null;
};
export type SourceBlock = { dataset: Dataset; state: 'recorded' | 'unreadable'; count: number | null; reason?: string };
export type CollectedEvidence = { candidates: EvidenceCandidate[]; blocks: SourceBlock[] };
const num = (v: unknown): number | null => typeof v==='number' && Number.isFinite(v) ? v : null;
const string = (v: unknown): string | null => typeof v==='string' && v.trim() ? v.trim() : null;
const parse = (v: unknown): Record<string,unknown> => { if(typeof v!=='string') return {}; const x:unknown=JSON.parse(v); if(!x||typeof x!=='object'||Array.isArray(x))throw new Error('source_unreadable'); return x as Record<string,unknown>; };
export function evidenceDate(v: unknown): string | null {
  const s=string(v); if(!s)return null;
  if(/^\d{4}-\d{2}$/.test(s))return Number(s.slice(5))>=1&&Number(s.slice(5))<=12?s:null;
  const d=s.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return null;
  const t=new Date(d+'T00:00:00Z');return Number.isFinite(t.getTime())&&t.toISOString().slice(0,10)===d?d:null;
}
export function evidenceStale(date: string | null, days: number, now: string): boolean | null {
  if(!date)return null;
  const cutoff=Date.parse(now)-days*86400000;
  if(date.length===7){const start=Date.parse(date+'-01T00:00:00Z');const end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);return end.getTime()<=cutoff?true:start>=cutoff?false:null;}
  return Date.parse(date+'T00:00:00Z')<cutoff;
}
export async function evidenceHash(value: unknown): Promise<string> {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export const candidateKey = (c: Pick<EvidenceCandidate,'area'|'source_table'|'source_ref'>) => JSON.stringify([c.area,c.source_table,c.source_ref]);

function provenance(row: DataRow): {label:EvidenceSourceLabel;provider:string|null} {
  const source=string(row.source)?.toLowerCase();
  const provider=source?.replace(/^connector[_:-]/,'');
  if(provider&&['mercury','stripe','carta'].includes(provider)) {
    if(row.verification!==undefined&&row.verification!=='verified')return {label:row.proof_id!=null?'document':'typed',provider:null};
    return {label:'connector',provider};
  }
  if(row.proof_id!=null||row.evidence_file_key!=null)return {label:'document',provider:null};
  if(row.interview_id!=null||row.session_id!=null)return {label:'recorded',provider:null};
  if(row.from_github===1)return {label:'connector',provider:'github'};
  return {label:'typed',provider:null};
}
const METRICS: Record<string,string> = {mrr:'money',arr:'money',cac:'money',ltv:'money',monthly_churn_pct:'percent',active_users:'people',new_users:'people',net_burn:'money',headcount:'people',nrr_pct:'percent',paying_accounts:'accounts'};
const DRIVERS: Record<string,string> = {monthly_growth_pct:'percent',monthly_churn_pct:'percent',cac:'money',gross_margin_pct:'percent'};

type Material = {row:DataRow;ref:string;date:unknown;value?:unknown;unit?:string;source?:EvidenceSourceLabel;provider?:string;privateReason?:'bank'|'quote';strength?:EvidenceStrength};
function materials(rule: EvidenceRule, rows: DataRow[]): Material[] {
  const out:Material[]=[];
  for(const row of rows){
    const id=String(row.id??'');
    const add=(date:unknown,value?:unknown,unit?:string,ref=id,extra:Partial<Material>={})=>out.push({row,ref,date,value,unit,...extra});
    switch(rule.kind){
      case 'revenue-receipt': add(row.received_on,row.amount_cents,'cents',id,{privateReason:row.source==='mercury'?'bank':undefined});break;
      case 'bank-runway': if(row.kind==='runway'&&row.fact_key==='runway'&&num(row.value)!=null)add(row.as_of,row.value,'months');break;
      case 'founder-holding': add(provenance(row).label==='typed'?row.created_at:null,row.ownership_pct??row.shares,row.ownership_pct!=null?'percent':'shares');break;
      case 'vesting-schedule': add(row.start_date,row.total_shares,'shares');break;
      case 'founder-commits': add(null,row.commits_90d,'commits');break;
      case 'skill-actions': add(row.last_at,row.count_window,'actions',String(row.axis)+':'+String(row.source));break;
      case 'pain-theme': if(num(row.mentions)!=null&&Number(row.mentions)>0)add(row.observed_on,row.mentions,'interviews',id,{strength:Number(row.mentions)>=2?'pattern':'anecdote'});break;
      case 'consented-quote': if(row.quote_consent===1&&string(row.notes))add(row.interview_date,null,undefined,id+':quote');break;
      case 'icp-fit': if(['strong','partial','none'].includes(String(row.icp_fit)))add(row.interview_date,null,undefined,id+':icp_fit');break;
      case 'demand-signal': add(row.signal_date,row.amount_cents,'cents');break;
      case 'experiment-result': add(null);break;
      case 'validation-verdict': add(row.decided_at);break;
      case 'kpi-snapshot': for(const [key,unit] of Object.entries(METRICS))if(num(row[key])!=null)add(row.snapshot_date,row[key],unit,id+':'+key,{privateReason:String(row.source).includes('mercury')?'bank':undefined});break;
      case 'bank-revenue': if(row.kind==='revenue')add(row.as_of,row.fact_key==='revenue:growth'?row.value:row.amount_cents,row.fact_key==='revenue:growth'?'percent':'cents');break;
      case 'roadmap-release': add(row.published_at,null,undefined,id,{provider:'github'});break;
      case 'must-have-done': add(row.done_at);break;
      case 'mapped-bank-spend': add(row.as_of,row.amount_cents,'cents');break;
      case 'hiring-plan': add(row.created_at,row.annual_cents,'cents');break;
      case 'roadmap-milestone': add(row.from_github===1?null:row.created_at,null);break;
      case 'formation-proof': add(null);break;
      case 'filed-obligation': add(row.resolved_on);break;
      case 'signed-document': add(row.signed_at);break;
      case 'github-ip-step': add(null,null,undefined,id+':ip',{provider:'github'});break;
      case 'bank-statement': add(row.month);break;
      case 'loi-file': if(row.kind==='loi'&&row.evidence_file_key!=null)add(row.signal_date);break;
      case 'revenue-proof': if(row.proof_id!=null)add(row.received_on,null,undefined,id,{privateReason:row.source==='mercury'?'bank':undefined});break;
      case 'accepted-safe': add(row.date,row.amount_cents,'cents');break;
      case 'filed-83b': if(row.mailed_at!=null)add(row.mailed_at);break;
      case 'signed-founder-equity': if(/cofounder|co_founder|founder|equity_split/.test(String(row.doc_type)))add(row.signed_at);break;
      case 'confirmed-receipt': add(row.posted_on,row.amount_cents,'cents');break;
      case 'round-call-response': add(row.last_response_at??row.responded_at,row.commitment_cents,'cents');break;
      case 'typed-commitment': add(null,row.amount_cents,'cents');break;
      case 'model-assumption': {const a=parse(row.assumptions_json);for(const [key,unit] of Object.entries(DRIVERS))if(num(a[key])!=null)add(row.updated_at??row.created_at,a[key],unit,id+':'+key);break;}
    }
  }
  return out;
}

/** bankUserId is an authenticated founder's own connection owner, never an investor ID supplied in a request. */
export async function collectEvidenceSources(env:Env, projectId:number, bankUserId:number, now=new Date().toISOString(),onlyKinds?:readonly string[]):Promise<CollectedEvidence>{
  const data=new Map<Dataset,DataRow[]>(); const blocks:SourceBlock[]=[];
  const requested = onlyKinds ? new Set(EVIDENCE_RULES.filter(r=>onlyKinds.includes(r.kind)).map(r=>r.dataset)) : null;
  if(requested?.has('themes')) requested.add('interviews');
  const queries=(Object.entries(QUERIES) as [Dataset,string][]).filter(([name])=>!requested||requested.has(name));
  const reads=await Promise.allSettled(queries.map(async ([name,sql])=>{
    const statement=env.DB.prepare(sql);
    const result=await (BANK_DATASETS.has(name)?statement.bind(projectId,bankUserId):statement.bind(projectId)).all<DataRow>();
    if(!Array.isArray(result.results))throw new Error('source_unreadable');
    return result.results;
  }));
  for(let i=0;i<queries.length;i++){
    const name=queries[i][0],result=reads[i];
    if(result.status==='fulfilled'){data.set(name,result.value);blocks.push({dataset:name,state:'recorded',count:result.value.length});}
    else blocks.push({dataset:name,state:'unreadable',count:null,reason:'This source could not be read. Try again.'});
  }
  if(data.has('themes')&&data.has('interviews')){
    try{const model=await loadPainGroupModel(env,projectId);const mentions=new Map<number,string[]>();
      for(const iv of data.get('interviews')!){if(iv.pains_json!=null){const pains:unknown=JSON.parse(String(iv.pains_json));if(!Array.isArray(pains)||pains.some(p=>typeof p!=='string'))throw new Error('source_unreadable');}const groups=new Set<number>();for(const pain of safeParseStrings(typeof iv.pains_json==='string'?iv.pains_json:null)){const normalized=normPhrase(pain);const group=normalized?resolvePhrase(normalized,pain,model).groupId:null;if(group!=null)groups.add(group);}
        for(const group of groups){if(!mentions.has(group))mentions.set(group,[]);mentions.get(group)!.push(evidenceDate(iv.interview_date)??'');}}
      data.set('themes',data.get('themes')!.map(row=>({...row,mentions:mentions.get(Number(row.id))?.length??0,observed_on:mentions.get(Number(row.id))?.filter(Boolean).sort().at(-1)??null})));
    }catch{data.delete('themes');const b=blocks.find(b=>b.dataset==='themes')!;b.state='unreadable';b.count=null;b.reason='This source could not be read. Try again.';}
  }
  const candidates:EvidenceCandidate[]=[];
  for(const rule of EVIDENCE_RULES){if(onlyKinds&&!onlyKinds.includes(rule.kind))continue;const rows=data.get(rule.dataset);if(!rows)continue;
    try{for(const m of materials(rule,rows)){
      if(!/^[A-Za-z0-9_:./-]{1,200}$/.test(m.ref))throw new Error('source_unreadable');
      const origin=provenance(m.row), label=m.source??(rule.source==='record'?origin.label:rule.source);
      const provider=m.provider??(label==='connector'?(origin.provider??(rule.private_reason==='bank'?'mercury':null)):null);
      const observed=evidenceDate(m.date), strength=m.strength??(label==='typed'?'anecdote':num(m.value)!=null||label==='signed'?'measured':label==='document'?'pattern':'anecdote');
      for(const area of rule.areas){const snapshot_hash=await evidenceHash({kind:rule.kind,area,source_table:rule.source_table,source_ref:m.ref,source_label:label,provider,observed_on:observed,material:m.row});
        candidates.push({kind:rule.kind,area,source_table:rule.source_table,source_ref:m.ref,provider,source_label:label,strength,observed_on:observed,summary:rule.summary,
          value_num:num(m.value),value_unit:m.unit??null,currency:string(m.row.currency),snapshot_hash,private_reason:m.privateReason??rule.private_reason??null,backs:rule.backs,
          stale:evidenceStale(observed,rule.days,now),date_reason:observed?null:'The source has no recorded observation date; a sync timestamp is not used.'});}
    }}catch{const b=blocks.find(b=>b.dataset===rule.dataset)!;b.state='unreadable';b.count=null;b.reason='This source could not be read. Try again.';}
  }
  const failed=new Set(blocks.filter(b=>b.state==='unreadable').map(b=>b.dataset));
  const validKinds=new Set(EVIDENCE_RULES.filter(r=>!failed.has(r.dataset)).map(r=>r.kind));
  return {candidates:candidates.filter(c=>validKinds.has(c.kind)),blocks};
}

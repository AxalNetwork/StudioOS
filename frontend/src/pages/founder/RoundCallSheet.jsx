import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { roundCallsApi } from '../../lib/api/roundCalls';
import { reportError } from '../../lib/log';
import { NOT_STORED } from './recordSetup';
import Lightbox from '../../ui/Lightbox';
import ActionSheet, { primary, ghost } from '../../ui/ActionSheet';
import { useCallRead, CallReadState, callButton, callInput, moneyCents, dollarsToCents, callDate } from './roundCallParts';

/**
 * D686 §5.6 (#1598) — Raise's Call for Capital: five steps, a draft resumed
 * instead of duplicated, and Send anyway as the acknowledgement. It is drawn
 * in the cycle lightbox (`<Lightbox size="tall">` around an `ActionSheet`,
 * D686 §5.1, #1596), wherever it opens: `/raise/call`, Continue draft on a
 * call, and Open a new call on the Raise call page.
 *
 * AVAILABILITY FIRST: the sheet reads `/round-calls/availability` before
 * anything else. While round calls are not enabled it says so and makes no
 * other call.
 */
export const ROUND_CALL_STEPS=['The round','Materials','Audience','Preview','Send'];

/** The fields S19-A stores (#1594, merged as #1626, migration 456). A read field renders when present. */
export const CALL_FIELDS=Object.freeze({key_terms:true,counsel_request:true,counsel_queue:true,audience_reasons:true,committed_at:true});

const INSTRUMENTS={safe:'SAFE',equity:'Equity',convertible_note:'Convertible note'};
const TERM_LABELS={cap:'Valuation cap · USD',discount:'Discount · %',pre_money:'Pre-money valuation · USD'};
const pill='rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] text-axal-muted';

/** "$8M", "$250k", "$900": the way counsel reads a term. */
export function shortUsd(value) {
  const n=Number(value);
  if(value==null||value===''||!Number.isFinite(n))return null;
  const trim=x=>String(Math.round(x*100)/100);
  if(Math.abs(n)>=1e6)return '$'+trim(n/1e6)+'M';
  if(Math.abs(n)>=1e3)return '$'+trim(n/1e3)+'k';
  return '$'+trim(n);
}
/** A stored 0.2 or 20 both read "20%". */
export function percent(value) {
  const n=Number(value);
  if(value==null||value===''||!Number.isFinite(n))return null;
  return String(Math.round((n<=1?n*100:n)*100)/100)+'%';
}
/** Which structured key terms an instrument takes (D578): a SAFE a cap, a note a cap and a discount, equity a pre-money. */
export const TERM_KEYS={safe:['cap'],convertible_note:['cap','discount'],equity:['pre_money']};
const dollars=cents=>cents==null?'':String(cents/100);
const pct=bps=>bps==null?'':String(bps/100);
/** The context's seeded terms for an instrument, as the inputs hold them (dollars, percent). */
export function termSeed(context,instrument) {
  const seed=context?.term_seeds?.[instrument]||{};
  return {cap:dollars(seed.valuation_cap_cents),discount:pct(seed.discount_bps),pre_money:dollars(seed.pre_money_cents)};
}
/** "Cap $8M" · "Cap $8M · discount 20%" · "Pre-money $12M", from the inputs; '' when none is set. */
export function keyTermsText(f) {
  const keys=TERM_KEYS[f.instrument]||[];
  return [keys.includes('cap')&&shortUsd(f.cap)&&'Cap '+shortUsd(f.cap),
    keys.includes('discount')&&percent(f.discount==null||f.discount===''?null:Number(f.discount)/100)&&'discount '+percent(Number(f.discount)/100),
    keys.includes('pre_money')&&shortUsd(f.pre_money)&&'Pre-money '+shortUsd(f.pre_money)].filter(Boolean).join(' · ');
}
/** The same line from a stored call's cents and basis points. */
export function callTermsText(c) {
  return keyTermsText({instrument:c.instrument,cap:dollars(c.valuation_cap_cents),discount:pct(c.discount_bps),pre_money:dollars(c.pre_money_cents)});
}
/** The structured terms the Worker takes: only the instrument's own, cents and basis points, else null. */
export function termsBody(f) {
  const keys=TERM_KEYS[f.instrument]||[];
  const bps=f.discount===''||f.discount==null?null:Math.round(Number(f.discount)*100);
  return {valuation_cap_cents:keys.includes('cap')?dollarsToCents(f.cap):null,
    discount_bps:keys.includes('discount')&&Number.isSafeInteger(bps)&&bps>=1&&bps<=9000?bps:null,
    pre_money_cents:keys.includes('pre_money')?dollarsToCents(f.pre_money):null};
}
export function recordedRoundFields(context,call=null) {
  let inputs={};try{inputs=JSON.parse(context.scenario?.inputs_json||'{}');}catch{/* Stored planner fields still seed independently. */}
  const priced=Array.isArray(inputs.rounds)?inputs.rounds.at(-1):null;
  const safe=Array.isArray(inputs.safes)?inputs.safes.at(-1):null;
  const round=context.round;
  const inferred=priced?'equity':safe?.instrument==='note'?'convertible_note':safe?'safe':'';
  const safeTerms=safe?[shortUsd(safe.cap)&&'Cap '+shortUsd(safe.cap),percent(safe.discount)&&'discount '+percent(safe.discount)].filter(Boolean).join(' · '):'';
  const recordedTerms=priced?(shortUsd(priced.pre_money)?'Pre-money '+shortUsd(priced.pre_money):''):safeTerms;
  const decks=context.decks||[];
  const deck=call?null:decks.find(d=>d.is_current)||decks.reduce((best,d)=>!best||d.version>best.version?d:best,null);
  return {name:call?.name||round?.name||priced?.name||safe?.name||context.project.name+' round',
    amount:call?String(call.amount_cents/100):round?.target_amount!=null?String(round.target_amount):priced?.investment!=null?String(priced.investment):safe?.amount!=null?String(safe.amount):'',
    instrument:call?.instrument||inferred,terms:call?.terms||round?.notes||recordedTerms,minimum:call?String(call.minimum_cheque_cents/100):'',target:call?.target_close||round?.close_date||'',
    deck_id:call?(call.deck_id!=null?String(call.deck_id):''):deck?String(deck.id):'',room:call?!!call.data_room_project_uid:!!context.data_room,
    ...(call?{cap:dollars(call.valuation_cap_cents),discount:pct(call.discount_bps),pre_money:dollars(call.pre_money_cents)}:termSeed(context,call?.instrument||inferred))};
}

/** "15 Jan", or null. */
export function shortDate(value) {
  if(!value)return null;
  const d=new Date(String(value).length===10?value+'T12:00:00Z':value);
  return Number.isNaN(d.valueOf())?null:d.toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
}
const wholeDollars=value=>{const c=dollarsToCents(value);return c==null?null:new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Math.round(c/100));};
export const ROUND_ROWS=[
  {key:'amount',label:'Amount',show:f=>wholeDollars(f.amount)},
  {key:'instrument',label:'Instrument',show:f=>INSTRUMENTS[f.instrument]||null},
  {key:'terms',label:'Key terms',show:f=>keyTermsText(f)||f.terms.trim()||null},
  {key:'minimum',label:'Minimum cheque',show:f=>wholeDollars(f.minimum)},
  {key:'target',label:'Target close',show:f=>shortDate(f.target)},
];
/** The first round row with nothing usable in it, or null. */
export function firstMissingRow(fields) {
  if(!fields.name.trim())return 'name';
  return ROUND_ROWS.find(row=>!row.show(fields))?.key??null;
}

const today=()=>new Date().toISOString().slice(0,10);
/** A call this venture already has open: sent and not past its close, or waiting on counsel. */
export function openCallOf(items,on=today()) {
  return (items||[]).find(c=>c.state==='awaiting_counsel'||(c.state==='sent'&&c.target_close>=on))||null;
}
/** Where a resumed draft opens. */
export function resumeStep(page,on=today()) {
  if(page.call.target_close&&page.call.target_close<on)return {step:0,reason:'The target close on this draft has passed. Choose a new date.'};
  if(page.counsel_approved)return {step:4,reason:null};
  if(page.recipients?.length)return {step:3,reason:null};
  return {step:1,reason:null};
}

/** Each readiness item's way to fix it: a step of this sheet, or the module that holds it. */
export function readinessTarget(key,projectId) {
  if(key==='round'||key==='terms'||key==='close')return {step:0};
  if(key==='deck')return {step:1};
  if(key==='data_room')return {href:'/raise/data-room?project_id='+projectId};
  if(key==='use_of_funds')return {href:'/raise/use-of-funds?project_id='+projectId};
  if(key==='traction')return {href:'/grow/revenue-and-traction?project_id='+projectId};
  return null;
}

const initial={name:'',amount:'',instrument:'',terms:'',minimum:'',target:'',deck_id:'',room:false,cap:'',discount:'',pre_money:''};
const ROUND_KEYS=['name','amount','instrument','terms','minimum','target','cap','discount','pre_money'];
const same=(a,b,keys)=>keys.every(k=>a[k]===b[k]);

export const CALL_SHEET=Object.freeze({eyebrow:'Raise',title:'Call for Capital',titleId:'round-call-title',
  sub:'Only investors verified on Axal can see a call. It is never public.',testId:'round-call-sheet'});

/** The cycle lightbox the sheet is drawn in. */
export function CallLightbox({onClose,children}) {
  return <Lightbox label={CALL_SHEET.title} size="tall" width={640} onClose={onClose} testId="round-call-lightbox">{children}</Lightbox>;
}

/** Availability's answer: `on`, `off` (not enabled, or the flag's 503), or the read's own state. */
export function availabilityOf(read) {
  if(read.loading)return 'loading';
  if(read.error)return read.error.code==='round_calls_disabled'?'off':'unreadable';
  return read.data?.enabled===true?'on':'off';
}

export default function RoundCallSheet({projectId,onClose,initialCall=null}) {
  const availability=useCallRead(()=>roundCallsApi.availability(),[]);
  const state=availabilityOf(availability);
  return <CallLightbox onClose={onClose}>{state==='on'
    ?<RoundCallFlow projectId={projectId} onClose={onClose} initialCall={initialCall}/>
    :<ActionSheet {...CALL_SHEET} onClose={onClose}>{state==='off'?<p role="status">Coming soon. Round calls are not enabled.</p>:<CallReadState read={availability}>{null}</CallReadState>}</ActionSheet>}</CallLightbox>;
}

function RoundCallFlow({projectId,onClose,initialCall}) {
  const context=useCallRead(()=>roundCallsApi.context(projectId),[projectId]);
  // Resume, never duplicate: only a sheet opened without a call looks for one.
  // "Continue draft" reads the call's page too, so its counsel approval and
  // recorded audience come back with it (S1 review of #1598).
  const resume=useCallRead(async()=>{
    if(initialCall)return {page:await roundCallsApi.page(initialCall.uid)};
    const {items}=await roundCallsApi.list(projectId);
    const open=openCallOf(items);
    if(open)return {open};
    const draft=(items||[]).find(c=>c.state==='draft');
    return draft?{page:await roundCallsApi.page(draft.uid)}:{};
  },[projectId,initialCall?.uid]);
  const [fields,setFields]=useState(initial),[uid,setUid]=useState(initialCall?.uid||null);
  const [step,setStep]=useState(0),[chosen,setChosen]=useState([]),[includeMatches,setIncludeMatches]=useState(false);
  const [matches,setMatches]=useState(null),[page,setPage]=useState(null),[editing,setEditing]=useState(null),[choosing,setChoosing]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[outcome,setOutcome]=useState(null),[note,setNote]=useState(null);
  const saved=useRef(null),touched=useRef(false),[matchRun,setMatchRun]=useState(0);
  useEffect(()=>{
    if(!context.data||!resume.data)return;
    const p=resume.data.page;
    const seeded=recordedRoundFields(context.data,p?p.call:resume.data.call||null);
    setFields(seeded);
    if(p){
      setUid(p.call.uid);setPage(p);saved.current=seeded;
      const at=resumeStep(p);setStep(at.step);setNote(at.reason);
      setIncludeMatches(p.recipients.some(r=>r.origin==='match'));
      const emails=new Set(p.recipients.filter(r=>r.origin==='chosen'&&r.email).map(r=>r.email.toLowerCase()));
      setChosen(context.data.chosen.filter(c=>emails.has(String(c.email).toLowerCase())).map(c=>c.prospect_id));
    } else if(resume.data.call)saved.current=seeded;
  },[context.data,resume.data]);
  useEffect(()=>{
    if(step!==2||!uid)return;
    let alive=true;setMatches({loading:true});
    roundCallsApi.previewAudience(uid,{chosen_prospect_ids:chosen,include_matches:true}).then(
      data=>{if(alive){setMatches({data});if(!data.matched)setIncludeMatches(false);}},
      e=>{reportError('round-calls:matches',e);if(alive)setMatches({error:e});});
    return()=>{alive=false;};
  },[step,uid,chosen,matchRun]);
  function change(key,value){setFields(current=>{
    const next={...current,[key]:value};
    // A new instrument takes its own seeded terms where none is typed yet.
    if(key==='instrument'){const seed=termSeed(context.data,value);for(const k of ['cap','discount','pre_money'])if(!next[k])next[k]=seed[k];}
    return next;});}
  async function run(action){setBusy(true);setError('');try{await action();}catch(e){reportError('round-calls:action',e);setError(e.code==='counsel_approval_required'?'Counsel has not approved the terms yet.':
      e.code==='nda_required'?'A signed NDA is required first.':e.code==='round_calls_disabled'?'Coming soon. Round calls are not enabled.':
      e.status>=500||!e.status?'The action could not be confirmed. Check the call before retrying.':e.message||'The action was refused. Check the recorded fields.');}finally{setBusy(false);}}
  async function persist(keys){
    if(uid&&saved.current&&same(fields,saved.current,keys))return uid;
    const amount=dollarsToCents(fields.amount),minimum=dollarsToCents(fields.minimum);
    const terms=fields.terms.trim()||keyTermsText(fields);
    if(amount==null||minimum==null||!fields.name.trim()||!terms||!fields.instrument||!fields.target)throw Object.assign(new Error('Complete the round name, amounts, instrument, terms and target close.'),{status:400});
    const deck=context.data.decks.find(d=>String(d.id)===fields.deck_id);
    const body={project_id:projectId,name:fields.name,amount_cents:amount,instrument:fields.instrument,terms,...termsBody(fields),
      minimum_cheque_cents:minimum,target_close:fields.target,deck_id:deck?.id??null,deck_version:deck?.version??null,
      data_room_project_uid:fields.room?context.data.data_room?.project_uid??null:null};
    const result=uid?await roundCallsApi.save(uid,body):await roundCallsApi.create(body);
    setUid(result.uid);saved.current=fields;return result.uid;
  }
  async function next(){
    if(step===0){const missing=firstMissingRow(fields);if(missing){setEditing(missing);return;}}
    await run(async()=>{
      if(step===0){await persist(ROUND_KEYS);setNote(null);setStep(1);}
      else if(step===1){await persist(['deck_id','room']);setStep(2);}
      else if(step===2){if(touched.current||!page)await roundCallsApi.audience(uid,{chosen_prospect_ids:chosen,include_matches:includeMatches});touched.current=false;setPage(await roundCallsApi.page(uid));setStep(3);}
      else if(step===3){setPage(await roundCallsApi.page(uid));setStep(4);}
    });
  }
  const missing=page?.readiness?.filter(item=>!item.ready)||[];
  async function send(){await run(async()=>{setOutcome(await roundCallsApi.send(uid,{acknowledge_missing:missing.length>0}));});}
  const on={change,next,send,back:()=>setStep(n=>Math.max(0,n-1)),goto:n=>setStep(n),edit:setEditing,choosing:()=>setChoosing(v=>!v),
    recheck:()=>run(async()=>setPage(await roundCallsApi.page(uid))),
    requestCounsel:()=>run(async()=>{await roundCallsApi.requestCounsel(uid,page.call.revision);setPage(await roundCallsApi.page(uid));}),retryMatches:()=>setMatchRun(n=>n+1),
    includeMatches:value=>{touched.current=true;setIncludeMatches(value);},
    choose:id=>{touched.current=true;setChosen(values=>values.includes(id)?values.filter(value=>value!==id):[...values,id]);}};
  const ready=context.data&&resume.data;
  if(ready&&!resume.data.open)return <RoundCallSheetView state={{step,fields,context:context.data,chosen,includeMatches,matches,page,busy,error,outcome,uid,editing,choosing,note,projectId}} on={on} onClose={onClose}/>;
  return <ActionSheet {...CALL_SHEET} onClose={onClose}><CallReadState read={context}><CallReadState read={resume}>{ready&&<OpenCallNotice call={resume.data.open}/>}</CallReadState></CallReadState></ActionSheet>;
}

export function OpenCallNotice({call}) {
  return <div role="status" className="space-y-3"><p className="font-semibold">This venture has an open call · {call.name} · closes {callDate(call.target_close)}</p>
    <Link className={primary} to={'/raise/calls/'+encodeURIComponent(call.uid)}>Open the call</Link></div>;
}

function Row({label,value,editing,onEdit,children,action='Edit'}) {
  return <div className="flex items-start justify-between gap-3 border-b border-axal-hairline py-2">
    <div className="min-w-0 flex-1"><p className="text-xs text-axal-muted">{label}</p>{editing?children:<p className="break-words">{value??'Not recorded'}</p>}</div>
    <button type="button" className={callButton} onClick={onEdit}>{editing?'Done':action}</button></div>;
}

function RoundStep({s,on}) {
  const f=s.fields,toggle=key=>()=>on.edit(s.editing===key?null:key);
  const input={amount:<input className={callInput} inputMode="decimal" aria-label="Target amount · USD" value={f.amount} onChange={e=>on.change('amount',e.target.value)}/>,
    instrument:<select className={callInput} aria-label="Instrument" value={f.instrument} onChange={e=>on.change('instrument',e.target.value)}><option value="">Choose an instrument</option><option value="safe">SAFE</option><option value="equity">Equity</option><option value="convertible_note">Convertible note</option></select>,
    terms:<>{(TERM_KEYS[f.instrument]||[]).map(k=><input key={k} className={callInput} inputMode="decimal" aria-label={TERM_LABELS[k]} placeholder={TERM_LABELS[k]}
        disabled={!CALL_FIELDS.key_terms} value={f[k]||''} onChange={e=>on.change(k,e.target.value)}/>)}
      {!f.instrument&&<p className="text-xs text-axal-muted">Choose an instrument for its cap, discount or pre-money.</p>}
      {!CALL_FIELDS.key_terms&&<p className="text-xs text-axal-muted">Cap, discount and pre-money as separate fields: {NOT_STORED}</p>}
      <textarea className={callInput} aria-label="Other terms" placeholder="Other terms" maxLength={20000} value={f.terms} onChange={e=>on.change('terms',e.target.value)}/></>,
    minimum:<input className={callInput} inputMode="decimal" aria-label="Minimum cheque · USD" value={f.minimum} onChange={e=>on.change('minimum',e.target.value)}/>,
    target:<input type="date" className={callInput} aria-label="Target close" value={f.target} onChange={e=>on.change('target',e.target.value)}/>};
  return <>
    <p className="text-xs text-axal-muted">Filled from your round planner</p>
    {s.note&&<p role="alert">{s.note}</p>}
    <label className="block">Round name<input className={callInput} value={f.name} maxLength={200} onChange={e=>on.change('name',e.target.value)}/></label>
    {ROUND_ROWS.map(row=><Row key={row.key} label={row.label} value={row.show(f)} editing={s.editing===row.key} onEdit={toggle(row.key)}>{input[row.key]}</Row>)}
  </>;
}

function MaterialsStep({s,on}) {
  const deck=s.context.decks.find(d=>String(d.id)===s.fields.deck_id);
  const room=s.context.data_room;
  return <>
    <Row label="Pitch deck" value={deck?['v'+deck.version,shortDate(deck.created_at),deck.slide_count!=null&&deck.slide_count+' slides'].filter(Boolean).join(' · '):s.context.decks.length?'No deck linked':'Not recorded · no pitch deck version exists for this venture.'}
      editing={s.editing==='deck'} action="Change" onEdit={()=>on.edit(s.editing==='deck'?null:'deck')}>
      <select className={callInput} aria-label="Pitch deck version" value={s.fields.deck_id} onChange={e=>on.change('deck_id',e.target.value)}><option value="">No deck linked</option>{s.context.decks.map(d=><option key={d.id} value={d.id}>{d.title||'Pitch deck'} · v{d.version}</option>)}</select>
    </Row>
    {room?<div className="flex items-start justify-between gap-3 border-b border-axal-hairline py-2"><div><p className="text-xs text-axal-muted">Data room</p>
        <p>{s.fields.room?'Linked behind its NDA gate. Files are never copied into the call.':'Not linked'}</p>{s.fields.room&&<span className={pill}>NDA gate on</span>}</div>
        <button type="button" className={callButton} onClick={()=>on.change('room',!s.fields.room)}>Change</button></div>
      :<div className="space-y-2 py-2"><p className="text-xs text-axal-muted">Data room</p><p>No data room yet. Investors will see the deck only.</p><span className={pill}>Not recorded</span>
        <div><Link className={primary} to={'/raise/data-room?project_id='+s.context.project.id}>Create a data room</Link></div></div>}
  </>;
}

/** Why no match can be made, by the preview's reason code. */
export const AUDIENCE_REASONS={sector_not_recorded:'Your venture has no recorded sector, so no match can be made.',stage_not_recorded:'Your venture has no recorded stage, so no match can be made.'};
/** " · Thesis fits Fintech, stage Seed, cheque $25k–$250k", from what the preview returns. */
export function matchLine(d) {
  const parts=[d.sector&&'Thesis fits '+d.sector,d.stage&&'stage '+d.stage,
    d.cheque_min_usd!=null&&d.cheque_max_usd!=null&&'cheque '+shortUsd(d.cheque_min_usd)+'–'+shortUsd(d.cheque_max_usd)].filter(Boolean);
  if(parts.length)return ' · '+parts.join(', ');
  return d.match_reasons?.length?' · '+d.match_reasons.join(', '):'';
}

function AudienceStep({s,on}) {
  const m=s.matches,data=m?.data;
  return <>
    <div className="flex items-start justify-between gap-3 border-b border-axal-hairline py-2"><div><p>{s.chosen.length} investors from Capital relationships</p><p className="text-xs text-axal-muted">Selected by hand</p></div>
      <button type="button" className={callButton} onClick={on.choosing}>Choose</button></div>
    {s.choosing&&(s.context.chosen.length?s.context.chosen.map(p=><label key={p.prospect_id} className="block"><input type="checkbox" checked={s.chosen.includes(p.prospect_id)} onChange={()=>on.choose(p.prospect_id)}/> {p.name} · {p.email}</label>):<p>No verified investor from this venture’s pipeline is available.</p>)}
    <div className="space-y-2 py-2" aria-live="polite">
      {!m||m.loading?<p role="status">Checking matches…</p>
        :m.error?<p role="alert">Matches are unreadable · <button type="button" className={callButton} onClick={on.retryMatches}>Try again</button></p>
        :data.matched>0?<><p>{data.matched} verified investors match{matchLine(data)}. Names appear only once they respond.</p>
          <span className={pill}>Verified only</span>
          <div><button type="button" className={primary} aria-pressed={s.includeMatches} onClick={()=>on.includeMatches(!s.includeMatches)}>{s.includeMatches?'Included':'Include'}</button></div></>
        :<><p>No matching investors yet · {AUDIENCE_REASONS[data.reason]||'No verified investor fits your stage, sector and cheque size. Widen the minimum cheque, or send to the investors you choose.'}</p><span className={pill}>None</span></>}
    </div>
    <p className="text-xs text-axal-muted">Only investors verified on the platform can see the call.</p>
  </>;
}

function PreviewStep({s}) {
  const c=s.page.call;
  return <>
    <p className="text-xs text-axal-muted">As an investor sees it</p>
    <p className="font-semibold">{s.context.project.name} · raising {moneyCents(c.amount_cents)}</p>
    <p>{[INSTRUMENTS[c.instrument]||c.instrument,callTermsText(c)||c.terms,'minimum '+moneyCents(c.minimum_cheque_cents),'closes '+(shortDate(c.target_close)||'Not recorded')].join(' · ')}</p>
    <p>{c.deck_version==null?'Pitch deck — Not recorded · no version linked':<>Pitch deck v{c.deck_version} — <Link className="underline" to="/raise/pitch">View</Link></>}</p>
    <p>{c.data_room_project_uid?'Data room — Request access · NDA first':'Data room — Not recorded · no room linked'}</p>
    <p>Ask a question — Answered by the founder in place</p>
  </>;
}

/** Counsel review was asked for these terms: a request whose hash is the current terms'. */
export function counselRequested(c) {
  return !!c?.counsel_requested_at&&(c.counsel_requested_hash==null||c.counsel_requested_hash===c.terms_hash);
}

function SendStep({s,on,missing,approved}) {
  const r=s.page.recipients||[],total=s.page.readiness.length;
  return <>
    <h3 className="font-semibold">Ready to send</h3>
    <p>To {r.filter(x=>x.origin==='chosen').length} chosen investors and {r.filter(x=>x.origin==='match').length} matching investors</p>
    {approved?<p>Terms — Approved by counsel · {callDate(s.page.call.counsel_approved_at)}</p>:<>
      <p role="alert">Counsel has not approved the terms yet. Send unlocks once they do.</p>
      <div className="flex flex-wrap items-center gap-2"><span>Terms</span><span className={pill}>Awaiting counsel</span>
        {counselRequested(s.page.call)?<span>Sent to Axal HQ for counsel review on {callDate(s.page.call.counsel_requested_at)}</span>
          :<button type="button" className={callButton} disabled={s.busy||!CALL_FIELDS.counsel_request} onClick={on.requestCounsel}>Request counsel review</button>}
        <button type="button" className={callButton} onClick={on.recheck}>Check again</button></div></>}
    <p>Readiness — {total-missing.length} of {total} items in place{!missing.length&&<> <span className={pill}>Ready</span></>}</p>
    {missing.length>0&&<section aria-label="Call readiness" className="space-y-2"><h4 className="font-semibold">Call readiness</h4>
      <p>{missing.length} of {total} call readiness items are missing. Send anyway, or finish them first.</p>
      <ul>{missing.map(item=>{const t=readinessTarget(item.key,s.projectId);return <li key={item.key} className="flex items-center justify-between gap-2 py-1"><span>{item.label} · Not yet</span>
        {t?.href?<Link className={callButton} to={t.href}>Open</Link>:t?<button type="button" className={callButton} onClick={()=>on.goto(t.step)}>Open</button>:null}</li>;})}</ul>
      <p className="text-xs text-axal-muted">This is the call’s own list. <Link className="underline" to={'/raise/fundraising-readiness?project_id='+s.projectId}>Fundraising readiness</Link> scores the venture and its items differ.</p></section>}
  </>;
}

export function RoundCallSheetView({state:s,on,onClose}) {
  const missing=s.page?.readiness?.filter(item=>!item.ready)||[];
  const approved=!!s.page?.counsel_approved;
  const footer=s.outcome?null:<>{s.step>0&&<button type="button" className={ghost} disabled={s.busy} onClick={on.back}>{s.step===4&&missing.length?'Finish them first':'Back'}</button>}
    {s.step<4?<button type="button" className={primary} disabled={s.busy} onClick={on.next}>Next</button>:<button type="button" className={primary} disabled={s.busy||!approved} onClick={on.send}>{missing.length?'Send anyway':'Send the call'}</button>}</>;
  return <ActionSheet {...CALL_SHEET} onClose={onClose} steps={ROUND_CALL_STEPS} step={s.step}
    banner={s.error?{tone:'error',text:s.error}:null} footNote={s.outcome?null:`Step ${s.step+1} of 5`} footer={footer}>
    <fieldset disabled={s.busy||!!s.outcome} className="space-y-3">
      {s.step===0&&<RoundStep s={s} on={on}/>}
      {s.step===1&&<MaterialsStep s={s} on={on}/>}
      {s.step===2&&<AudienceStep s={s} on={on}/>}
      {s.step===3&&s.page&&<PreviewStep s={s}/>}
      {s.step===4&&s.page&&<SendStep s={s} on={on} missing={missing} approved={approved}/>}
    </fieldset>
    {s.outcome&&<p role="status" className="mt-4">The call is available to {s.outcome.recipients} verified recipients; {s.outcome.notified} notified, {s.outcome.not_delivered} not delivered. <Link className="underline" to={'/raise/calls/'+s.uid}>Open the call</Link></p>}
  </ActionSheet>;
}

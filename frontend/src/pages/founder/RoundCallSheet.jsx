import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { roundCallsApi } from '../../lib/api/roundCalls';
import { reportError } from '../../lib/log';
import { callHref } from '../raise/calls/callsModel';
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
 *
 * D1224 (#3223) — the canvas's new-call sheet (CLS4–CLS7): the round with
 * each seeded field's source, materials, the pipeline with investors not on
 * Axal greyed, the preview with counsel's four states, and Send with what is
 * missing acknowledged one by one, then its result. A saved draft's address is
 * `callHref`'s, under Calls in the Raise shell. A refusal keeps every entry.
 */
export const ROUND_CALL_STEPS=['The round','Materials','Audience','Preview','Send'];

/** The fields S19-A stores (#1594, merged as #1626, migration 456). A read field renders when present. */
export const CALL_FIELDS=Object.freeze({key_terms:true,counsel_request:true,counsel_queue:true,audience_reasons:true,committed_at:true});

const INSTRUMENTS={safe:'SAFE',equity:'Equity',convertible_note:'Convertible note'};
const TERM_LABELS={cap:'Valuation cap · USD',discount:'Discount · %',pre_money:'Pre-money valuation · USD'};

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
  if(key==='data_room')return {href:'/raise/data-room/requests?project_id='+projectId};
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
export function CallLightbox({onClose,children,asPage}) {
  return <Lightbox label={CALL_SHEET.title} size="tall" width={640} onClose={onClose} testId="round-call-lightbox" {...asPage}>{children}</Lightbox>;
}

/** Availability's answer: `on`, `off` (not enabled, or the flag's 503), or the read's own state. */
export function availabilityOf(read) {
  if(read.loading)return 'loading';
  if(read.error)return read.error.code==='round_calls_disabled'?'off':'unreadable';
  return read.data?.enabled===true?'on':'off';
}

// D703 (#1665): `asPage` is the cycle route's page mode below 1024px; every other caller keeps the dialog.
export default function RoundCallSheet({projectId,onClose,initialCall=null,asPage}) {
  const availability=useCallRead(()=>roundCallsApi.availability(),[]);
  const state=availabilityOf(availability);
  return <CallLightbox onClose={onClose} asPage={asPage}>{state==='on'
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
  const [dismissed,setDismissed]=useState(false),[acks,setAcks]=useState([]),[cleared,setCleared]=useState(false),[savedDraft,setSavedDraft]=useState(false);
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
    // D1224: saving changed terms clears counsel's approval on the Worker; say so in the preview.
    if(page?.counsel_approved&&saved.current&&!same(fields,saved.current,ROUND_KEYS))setCleared(true);
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
  async function saveDraft(){
    const gap=firstMissingRow(fields);if(gap){setError('Complete the round name, amounts, instrument, terms and target close to save a draft.');return;}
    await run(async()=>{await persist(ROUND_KEYS);setSavedDraft(true);});
  }
  const on={change,next,send,saveDraft,
    acceptTerms:text=>{setFields(f=>acceptPlainTerms(f,text));},dismissTerms:()=>setDismissed(true),
    ack:key=>setAcks(list=>list.includes(key)?list.filter(k=>k!==key):[...list,key]),back:()=>setStep(n=>Math.max(0,n-1)),goto:n=>setStep(n),edit:setEditing,choosing:()=>setChoosing(v=>!v),
    recheck:()=>run(async()=>setPage(await roundCallsApi.page(uid))),
    requestCounsel:()=>run(async()=>{await roundCallsApi.requestCounsel(uid,page.call.revision);setCleared(false);setPage(await roundCallsApi.page(uid));}),retryMatches:()=>setMatchRun(n=>n+1),
    includeMatches:value=>{touched.current=true;setIncludeMatches(value);},
    choose:id=>{touched.current=true;setChosen(values=>values.includes(id)?values.filter(value=>value!==id):[...values,id]);}};
  const ready=context.data&&resume.data;
  if(ready&&!resume.data.open)return <RoundCallSheetView state={{step,fields,context:context.data,chosen,includeMatches,matches,page,busy,error,outcome,uid,editing,choosing,note,projectId,dismissed,acks,cleared,saved:savedDraft}} on={on} onClose={onClose}/>;
  return <ActionSheet {...CALL_SHEET} onClose={onClose}><CallReadState read={context}><CallReadState read={resume}>{ready&&<OpenCallNotice call={resume.data.open}/>}</CallReadState></CallReadState></ActionSheet>;
}

export function OpenCallNotice({call}) {
  return <div role="status" className="space-y-3"><p className="font-semibold">This venture has an open call · {call.name} · closes {callDate(call.target_close)}</p>
    <Link className={primary} to={callHref(call)}>Open the call</Link></div>;
}

/**
 * D1224 (#3223) — the plain-words terms, written only from the fields the
 * founder typed or a record filled: the amount, the instrument and its key
 * terms, the minimum cheque and the close. It adds no figure of its own, so a
 * money term is never proposed (#2431 `money_term`); null until every one of
 * those fields is set. Eadwyn's own wording waits for a Worker route (D1224 §3).
 */
export function plainTerms(f) {
  const amount=wholeDollars(f.amount),minimum=wholeDollars(f.minimum),close=longDate(f.target),kind=INSTRUMENT_PHRASE[f.instrument];
  if(!amount||!minimum||!close||!kind)return null;
  const keys=TERM_KEYS[f.instrument]||[];
  const terms=[keys.includes('cap')&&wholeDollars(f.cap)&&'a valuation cap of '+wholeDollars(f.cap),
    keys.includes('discount')&&percent(f.discount==null||f.discount===''?null:Number(f.discount)/100)&&'a discount of '+percent(Number(f.discount)/100),
    keys.includes('pre_money')&&wholeDollars(f.pre_money)&&'a pre-money valuation of '+wholeDollars(f.pre_money)].filter(Boolean);
  return `${kind} for up to ${amount}${terms.length?' with '+terms.join(' and '):''}. The smallest cheque is ${minimum}, and the call closes on ${close}.`;
}
const INSTRUMENT_PHRASE={safe:'A SAFE',convertible_note:'A convertible note',equity:'An equity round'};
/** Accepting the drafted words changes the plain-words terms and nothing else. */
export function acceptPlainTerms(fields,text) { return {...fields,terms:String(text||'')}; }
/** "15 Nov 2026", or null. */
export function longDate(value) {
  if(!value)return null;
  const d=new Date(String(value).length===10?value+'T12:00:00Z':value);
  return Number.isNaN(d.valueOf())?null:d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
}

/** Where each seeded field came from, for its chip; a field the founder changed loses it. */
export function seedChips(context,fields) {
  if(!context)return {};
  const seed={...recordedRoundFields(context),...termSeed(context,fields.instrument)};
  const planner=!context.round;
  const from={amount:context.round?.target_amount!=null?'From your round settings':planner&&seed.amount?'From your round planner':null,
    target:context.round?.close_date?'From your round settings':null,
    cap:seed.cap?'From your recorded terms':null,discount:seed.discount?'From your recorded terms':null,pre_money:seed.pre_money?'From your recorded terms':null};
  return Object.fromEntries(Object.entries(from).filter(([k,v])=>v&&fields[k]!==''&&fields[k]===seed[k]));
}

export const TERM_HELP='The key term of a SAFE. A convertible note asks for a cap and a discount; equity asks for the pre-money valuation.';
export const MINIMUM_HELP='Typed by you. Eadwyn never fills an amount, a term, a cap, a discount or a minimum cheque.';

const chip='rounded-full border border-axal-hairline bg-gray-50 px-2 py-0.5 text-[11px] text-axal-muted dark:bg-gray-800';
const card='space-y-2 rounded-xl border border-axal-hairline p-3';
const eyebrowCls='text-[11px] font-semibold uppercase tracking-wide text-axal-muted';

function Field({label,id,chipText,help,children}) {
  return <div className="space-y-1"><label htmlFor={id} className="block text-xs font-semibold">{label}</label>
    <div className="flex min-w-0 items-center gap-2"><div className="min-w-0 flex-1">{children}</div>{chipText&&<span className={chip} data-testid={'call-chip-'+id}>{chipText}</span>}</div>
    {help&&<p className="text-xs text-axal-muted">{help}</p>}</div>;
}

function RoundStep({s,on}) {
  const f=s.fields,chips=seedChips(s.context,f),drafted=plainTerms(f);
  return <>
    {s.note&&<p role="alert">{s.note}</p>}
    <Field label="Name" id="call-name"><input id="call-name" className={callInput} value={f.name} maxLength={200} onChange={e=>on.change('name',e.target.value)}/></Field>
    <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
      <Field label="Target amount" id="call-amount" chipText={chips.amount}><input id="call-amount" className={callInput} inputMode="decimal" value={f.amount} onChange={e=>on.change('amount',e.target.value)}/></Field>
      <Field label="Currency" id="call-currency"><input id="call-currency" className={callInput} value="USD" readOnly/></Field>
    </div>
    <div className="space-y-1"><p className="text-xs font-semibold" id="call-instrument">Instrument</p>
      <div role="group" aria-labelledby="call-instrument" className="flex flex-wrap gap-2">{[['safe','SAFE'],['convertible_note','Convertible note'],['equity','Equity']].map(([k,label])=>
        <button key={k} type="button" className={f.instrument===k?primary:ghost} aria-pressed={f.instrument===k} onClick={()=>on.change('instrument',k)}>{label}</button>)}</div></div>
    {(TERM_KEYS[f.instrument]||[]).map((k,i)=><Field key={k} label={TERM_LABELS[k]} id={'call-'+k} chipText={chips[k]} help={i===0?TERM_HELP:null}>
      <input id={'call-'+k} className={callInput} inputMode="decimal" value={f[k]||''} onChange={e=>on.change(k,e.target.value)}/></Field>)}
    {!f.instrument&&<p className="text-xs text-axal-muted">Choose an instrument for its cap, discount or pre-money.</p>}
    <Field label="Minimum cheque" id="call-minimum" help={MINIMUM_HELP}><input id="call-minimum" className={callInput} inputMode="decimal" value={f.minimum} onChange={e=>on.change('minimum',e.target.value)}/></Field>
    <Field label="Target close" id="call-target" chipText={chips.target}><input id="call-target" type="date" className={callInput} value={f.target} onChange={e=>on.change('target',e.target.value)}/></Field>
    <Field label="Terms in plain words" id="call-terms"><textarea id="call-terms" className={callInput} maxLength={20000} placeholder="Empty" value={f.terms} onChange={e=>on.change('terms',e.target.value)}/></Field>
    {!f.terms.trim()&&drafted&&!s.dismissed&&<div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950/30" data-testid="call-drafted-terms">
      <p className="text-xs font-bold text-violet-700 dark:text-violet-300">Drafted from the fields above</p>
      <p className="text-sm">{drafted}</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={callButton} onClick={()=>on.acceptTerms(drafted)}>Accept</button>
        <button type="button" className={callButton} onClick={()=>on.acceptTerms(drafted,true)}>Edit</button>
        <button type="button" className={callButton} onClick={on.dismissTerms}>Dismiss</button></div></div>}
    {s.saved&&<p role="status">Draft saved. <Link className="underline" to={callHref({uid:s.uid,state:'draft'})}>Its address</Link> opens it again.</p>}
  </>;
}

function MaterialsStep({s,on}) {
  const deck=s.context.decks.find(d=>String(d.id)===s.fields.deck_id);
  const room=s.context.data_room;
  return <>
    <section className={card} aria-label="Pitch deck"><p className={eyebrowCls}>Pitch deck</p>
      {deck?<><p className="font-semibold">{deck.title||s.context.project.name} · v{deck.version} · frozen when sent</p>
          <p className="text-xs text-axal-muted">Investors read this version. Changes you make to the deck later do not reach them.</p></>
        :<p>{s.context.decks.length?'No deck linked':'Not recorded · no pitch deck version exists for this venture.'}</p>}
      {s.context.decks.length>0&&(s.editing==='deck'
        ?<select className={callInput} aria-label="Pitch deck version" value={s.fields.deck_id} onChange={e=>on.change('deck_id',e.target.value)}><option value="">No deck linked</option>{s.context.decks.map(d=><option key={d.id} value={d.id}>{d.title||'Pitch deck'} · v{d.version}</option>)}</select>
        :<button type="button" className={callButton} onClick={()=>on.edit('deck')}>Change version</button>)}
    </section>
    <section className={card} aria-label="Data room"><p className={eyebrowCls}>Data room</p>
      {room?<><p className="font-semibold">{s.fields.room?'Linked behind its NDA gate':'Not linked'}</p>
          <p className="text-xs text-axal-muted">Investors see it only after an NDA and your grant. Files are never copied into the call.</p>
          <div className="flex flex-wrap items-center gap-3"><button type="button" role="switch" aria-checked={!!s.fields.room} className={callButton} onClick={()=>on.change('room',!s.fields.room)}>{s.fields.room?'Unlink':'Link the data room'}</button>
            <Link className="text-xs font-semibold underline" to={'/raise/data-room?project_id='+s.context.project.id}>Open Data room ›</Link></div></>
        :<><p>No data room yet. Investors will see the deck only.</p><Link className={primary} to={'/raise/data-room?project_id='+s.context.project.id}>Create a data room</Link></>}
    </section>
  </>;
}

/** Why no match can be made, by the preview's reason code. */
export const AUDIENCE_REASONS={sector_not_recorded:'Your venture has no recorded sector, so no match can be made.',stage_not_recorded:'Your venture has no recorded stage, so no match can be made.'};
/** " · stage Seed · sector Fintech · cheque range $25k–$250k", from what the preview returns. */
export function matchLine(d) {
  const parts=[d.stage&&'stage '+d.stage,d.sector&&'sector '+d.sector,
    d.cheque_min_usd!=null&&d.cheque_max_usd!=null&&'cheque range '+shortUsd(d.cheque_min_usd)+'–'+shortUsd(d.cheque_max_usd)].filter(Boolean);
  if(parts.length)return ' · '+parts.join(' · ');
  return d.match_reasons?.length?' · '+d.match_reasons.join(' · '):'';
}

function AudienceStep({s,on}) {
  const m=s.matches,data=m?.data,others=data?.not_on_axal||[];
  return <>
    <div><h3 className="font-semibold">From your pipeline</h3><p className="text-xs text-axal-muted">Investors with a verified Axal account can be chosen.</p></div>
    <ul className="divide-y divide-axal-hairline border-y border-axal-hairline" aria-label="Your pipeline">
      {s.context.chosen.map(p=><li key={p.prospect_id} className="flex items-center gap-3 py-2"><input type="checkbox" aria-label={'Choose '+(p.name||'this investor')} checked={s.chosen.includes(p.prospect_id)} onChange={()=>on.choose(p.prospect_id)}/>
        <span className="min-w-0 flex-1 font-semibold">{p.name||'Name not recorded'}</span><span className={chip}>Verified on Axal</span></li>)}
      {others.map(p=><li key={'n'+p.prospect_id} className="flex items-center gap-3 py-2 text-axal-muted" data-testid="call-not-on-axal"><input type="checkbox" disabled aria-label={(p.name||'This investor')+' is not on Axal'} checked={false} readOnly/>
        <span className="min-w-0 flex-1">{p.name||'Name not recorded'}</span><span className={chip}>Not on Axal</span>
        <button type="button" className={callButton} disabled title={INVITE_WAIT}>Invite to Axal</button></li>)}
      {!s.context.chosen.length&&!others.length&&<li className="py-2">No investor from this venture’s pipeline is available.</li>}
    </ul>
    {others.length>0&&<p className="text-xs text-axal-muted">Invite to Axal: {INVITE_WAIT}</p>}
    <div className={card} aria-live="polite">
      {!m||m.loading?<p role="status">Checking matches…</p>
        :m.error?<p role="alert">Matches are unreadable · <button type="button" className={callButton} onClick={on.retryMatches}>Try again</button></p>
        :data.matched>0?<><div className="flex items-center gap-3"><button type="button" role="switch" aria-checked={!!s.includeMatches} aria-label="Also invite investors whose published focus fits" className={callButton} onClick={()=>on.includeMatches(!s.includeMatches)}>{s.includeMatches?'On':'Off'}</button>
            <span className="font-semibold">Also invite investors whose published focus fits</span></div>
          <p className="text-sm">{data.matched} matching investors{matchLine(data)}</p>
          <p className="text-xs text-axal-muted">Their names stay hidden from you until they respond.</p></>
        :<p>No matching investors yet · {AUDIENCE_REASONS[data.reason]||'No verified investor fits your stage, sector and cheque size. Widen the minimum cheque, or send to the investors you choose.'}</p>}
    </div>
  </>;
}
export const INVITE_WAIT='not offered here yet. Axal has no route that invites a pipeline investor; they can sign up and verify, then be chosen.';

/** The four counsel states the preview draws, and the button each shows. */
export function counselState(page,cleared=false) {
  const c=page?.call||{};
  if(page?.counsel_approved)return {key:'approved',line:`Approved for these terms on ${callDate(c.counsel_approved_at)}.`,action:null};
  if(counselRequested(c))return {key:'requested',line:`Requested ${callDate(c.counsel_requested_at)}. Waiting for counsel.`,action:null};
  if(cleared||c.counsel_requested_at)return {key:'cleared',line:'Your changes cleared the approval.',action:'Request again'};
  return {key:'not_requested',line:'Not requested.',action:'Request counsel review'};
}
const COUNSEL_PILL={approved:'Approved',requested:'Requested',cleared:'Needs a new review',not_requested:'Not requested'};

function PreviewStep({s,on}) {
  const c=s.page.call,items=s.page.readiness||[],missing=items.filter(i=>!i.ready),counsel=counselState(s.page,s.cleared);
  return <>
    <section className={card} aria-label="What investors see"><p className={eyebrowCls}>What investors see</p>
      <p className="font-bold">{`A private round call from ${s.context.project.name}`}</p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">{[['Instrument',INSTRUMENTS[c.instrument]||'Not recorded'],['Target',moneyCents(c.amount_cents)],['Key terms',callTermsText(c)||'Not recorded'],['Minimum',moneyCents(c.minimum_cheque_cents)],['Closes',longDate(c.target_close)||'Not recorded']].map(([k,v])=>
        <div key={k} className="min-w-0"><dt className={eyebrowCls}>{k}</dt><dd className="font-mono text-xs font-semibold">{v}</dd></div>)}</dl>
      {c.terms?.trim()&&<p className="text-sm" data-testid="call-preview-terms">{c.terms}</p>}
      <p className="text-xs text-axal-muted">{[c.deck_version==null?'No deck linked':'Deck v'+c.deck_version,c.data_room_project_uid?'data room after an NDA':'no data room linked','indicate an amount','ask a question'].join(' · ')}</p>
    </section>
    <section className={card} aria-label="Readiness"><div className="flex items-baseline gap-2"><h3 className="font-semibold">Readiness</h3><span className="font-mono text-xs text-axal-muted">{items.length-missing.length} of {items.length} ready</span></div>
      {missing.length>0&&<ul>{missing.map(item=>{const t=readinessTarget(item.key,s.projectId);return <li key={item.key} className="flex items-center justify-between gap-2 py-1"><span>{item.label} · Not yet</span>
        {t?.href?<Link className={callButton} to={t.href}>Open</Link>:t?<button type="button" className={callButton} onClick={()=>on.goto(t.step)}>Open</button>:null}</li>;})}</ul>}
      <p className="text-xs text-axal-muted">You can send with items missing. Investors see what is there.</p>
    </section>
    <section className={card} aria-label="Counsel review" data-testid="call-counsel"><div className="flex items-center gap-2"><h3 className="font-semibold">Counsel review</h3><span className={chip}>{COUNSEL_PILL[counsel.key]}</span></div>
      <p>{counsel.line}</p>
      {counsel.key==='approved'&&<p className="text-xs text-axal-muted">Any change to the terms or the audience needs a new review.</p>}
      <div className="flex flex-wrap gap-2">{counsel.action&&<button type="button" className={callButton} disabled={s.busy||!CALL_FIELDS.counsel_request} onClick={on.requestCounsel}>{counsel.action}</button>}
        {counsel.key!=='approved'&&<button type="button" className={callButton} onClick={on.recheck}>Check again</button>}</div>
    </section>
  </>;
}

/** Counsel review was asked for these terms: a request whose hash is the current terms'. */
export function counselRequested(c) {
  return !!c?.counsel_requested_at&&(c.counsel_requested_hash==null||c.counsel_requested_hash===c.terms_hash);
}

/** Who the call goes to, from the recorded audience. */
export function audienceCounts(page) {
  const r=page?.recipients||[];
  const chosen=r.filter(x=>x.origin==='chosen').length,matched=r.filter(x=>x.origin==='match').length;
  return {chosen,matched,total:chosen+matched};
}
/** Send is offered once counsel approved these terms and every missing item is acknowledged. */
export function canSend(page,acks) {
  const missing=(page?.readiness||[]).filter(i=>!i.ready);
  return !!page?.counsel_approved&&missing.every(i=>acks.includes(i.key));
}

function SendStep({s,on}) {
  const missing=(s.page.readiness||[]).filter(item=>!item.ready),n=audienceCounts(s.page),approved=!!s.page.counsel_approved;
  return <>
    <h3 className="text-lg font-extrabold">Send {s.page.call.name} to {n.total} investors?</h3>
    <p className="text-sm text-axal-muted">{n.chosen} chosen from your pipeline and {n.matched} matching investors.</p>
    {missing.length>0&&<section aria-label="Missing from this call"><p className={eyebrowCls}>Missing from this call</p>
      <ul>{missing.map(item=><li key={item.key} className="flex items-center gap-3 border-t border-axal-hairline py-2"><span className="flex-1 font-semibold">{item.label}</span>
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" aria-label={'Send anyway without '+item.label} checked={(s.acks||[]).includes(item.key)} onChange={()=>on.ack(item.key)}/>Send anyway without it</label></li>)}</ul></section>}
    <section className={card} aria-label="What happens"><p className={eyebrowCls}>What happens</p>
      <ul className="list-disc space-y-1 pl-5 text-sm"><li>Each chosen investor is told on Axal.</li><li>Matching investors see the call. You see their names only when they respond.</li>
        <li>{approved?`Counsel approved these terms on ${callDate(s.page.call.counsel_approved_at)}.`:'Counsel has not approved these terms yet, so the call cannot be sent.'}</li></ul></section>
  </>;
}

/** The send's result, in the canvas's words. */
export function sendResult(o) {
  const told=Number(o?.notified),missed=Number(o?.not_delivered);
  if(!Number.isFinite(told))return 'Sent. Axal could not read how many investors were told.';
  return `Sent. ${told} investor${told===1?' was':'s were'} told on Axal.${missed>0?` ${missed} could not be told.`:''}`;
}

function SendResult({s}) {
  const missed=Number(s.outcome.not_delivered)>0;
  return <div role="status" className="space-y-2" data-testid="call-send-result">
    <p className="font-semibold">{sendResult(s.outcome)} {missed&&<Link className="underline" to={callHref({uid:s.uid,state:'sent'})}>See who</Link>}</p>
    <p className="text-xs text-axal-muted">Investors are told inside Axal. No email is sent.</p>
    {!missed&&<Link className="underline" to={callHref({uid:s.uid,state:'sent'})}>Open the call</Link>}
  </div>;
}

export function RoundCallSheetView({state:s,on,onClose}) {
  const sendable=s.page?canSend(s.page,s.acks||[]):false;
  const footer=s.outcome?null:<>
    {s.step===0?<button type="button" className={ghost} disabled={s.busy} onClick={on.saveDraft}>Save draft</button>
      :<button type="button" className={ghost} disabled={s.busy} onClick={on.back}>Back</button>}
    {s.step<4?<button type="button" className={primary} disabled={s.busy} onClick={on.next}>Next</button>
      :<button type="button" className={primary} disabled={s.busy||!sendable} onClick={on.send}>Send the call</button>}</>;
  return <ActionSheet eyebrow={`New call · step ${s.step+1} of 5`} title={ROUND_CALL_STEPS[s.step]} titleId={CALL_SHEET.titleId} sub={CALL_SHEET.sub} testId={CALL_SHEET.testId}
    onClose={onClose} steps={ROUND_CALL_STEPS} step={s.step} banner={s.error?{tone:'error',text:s.error}:null} footer={footer}>
    {s.outcome?<SendResult s={s}/>:<fieldset disabled={s.busy} className="space-y-3">
      {s.step===0&&<RoundStep s={s} on={on}/>}
      {s.step===1&&<MaterialsStep s={s} on={on}/>}
      {s.step===2&&<AudienceStep s={s} on={on}/>}
      {s.step===3&&s.page&&<PreviewStep s={s} on={on}/>}
      {s.step===4&&s.page&&<SendStep s={s} on={on}/>}
    </fieldset>}
  </ActionSheet>;
}

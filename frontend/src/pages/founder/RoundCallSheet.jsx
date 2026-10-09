import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { roundCallsApi } from '../../lib/api/roundCalls';
import { reportError } from '../../lib/log';
import { useCallRead, CallReadState, CallSheetFrame, callButton, callInput, moneyCents, dollarsToCents } from './roundCallParts';

export const ROUND_CALL_STEPS=['Round','Materials','Audience','Preview','Send'];
export function CallForCapitalButton({projectId}) {
  const availability=useCallRead(()=>roundCallsApi.availability());
  const [open,setOpen]=useState(false);
  return <div><RoundCallAvailability read={availability} projectId={projectId} onOpen={()=>setOpen(true)}/>{open&&<RoundCallSheet projectId={projectId} onClose={()=>setOpen(false)}/>}</div>;
}
export function RoundCallAvailability({read,projectId,onOpen}) {
  return <div>
    {read.error?<p role="alert">Call for Capital is unreadable. <button type="button" className={callButton} onClick={read.retry}>Try again</button></p>:
      <button type="button" className={callButton} disabled={read.loading||!read.data?.enabled||!projectId} onClick={onOpen}>{read.loading?'Checking availability…':read.data?.enabled?'Call for Capital':'Call for Capital · Coming soon'}</button>}
    {read.data?.enabled&&projectId&&<Link className="ml-3 text-xs underline" to={'/round-calls?project_id='+projectId}>View calls</Link>}
  </div>;
}
export function recordedRoundFields(context,call=null) {
  let inputs={};try{inputs=JSON.parse(context.scenario?.inputs_json||'{}');}catch{/* Stored planner fields still seed independently. */}
  const priced=Array.isArray(inputs.rounds)?inputs.rounds.at(-1):null;
  const safe=Array.isArray(inputs.safes)?inputs.safes.at(-1):null;
  const round=context.round;
  const inferred=priced?'equity':safe?.instrument==='note'?'convertible_note':safe?'safe':'';
  const recordedTerms=priced?`Pre-money USD ${priced.pre_money}`:safe?`Valuation cap USD ${safe.cap??'Not recorded'}; discount ${safe.discount??'Not recorded'}`:'';
  return {name:call?.name||round?.name||priced?.name||safe?.name||context.project.name+' round',
    amount:call?String(call.amount_cents/100):round?.target_amount!=null?String(round.target_amount):priced?.investment!=null?String(priced.investment):safe?.amount!=null?String(safe.amount):'',
    instrument:call?.instrument||inferred,terms:call?.terms||round?.notes||recordedTerms,minimum:call?String(call.minimum_cheque_cents/100):'',target:call?.target_close||round?.close_date||'',
    deck_id:call?.deck_id!=null?String(call.deck_id):'',room:!!call?.data_room_project_uid};
}
const initial={name:'',amount:'',instrument:'',terms:'',minimum:'',target:'',deck_id:'',room:false};
export default function RoundCallSheet({projectId,onClose,initialCall=null}) {
  const context=useCallRead(()=>roundCallsApi.context(projectId),[projectId]);
  const [fields,setFields]=useState(initial),[uid,setUid]=useState(initialCall?.uid||null);
  const [step,setStep]=useState(0),[chosen,setChosen]=useState([]),[includeMatches,setIncludeMatches]=useState(false);
  const [matches,setMatches]=useState(null),[page,setPage]=useState(null),[acknowledge,setAcknowledge]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[outcome,setOutcome]=useState(null);
  useEffect(()=>{
    if(!context.data)return;
    const seeded=recordedRoundFields(context.data,initialCall);
    setFields(seeded);
  },[context.data,initialCall]);
  useEffect(()=>{setMatches(null);},[chosen,includeMatches]);
  function change(key,value){setFields(current=>({...current,[key]:value}));}
  async function run(action){setBusy(true);setError('');try{await action();}catch(e){reportError('round-calls:action',e);setError(e.code==='counsel_approval_required'?'Counsel has not approved the terms yet.':
      e.code==='nda_required'?'A signed NDA is required first.':e.code==='round_calls_disabled'?'Coming soon. Round calls are not enabled.':
      e.status>=500||!e.status?'The action could not be confirmed. Check the call before retrying.':e.message||'The action was refused. Check the recorded fields.');}finally{setBusy(false);}}
  async function persist(){
    const amount=dollarsToCents(fields.amount),minimum=dollarsToCents(fields.minimum);
    if(amount==null||minimum==null||!fields.name.trim()||!fields.terms.trim()||!fields.instrument||!fields.target)throw Object.assign(new Error('Complete the round name, amounts, instrument, terms and target close.'),{status:400});
    const deck=context.data.decks.find(d=>String(d.id)===fields.deck_id);
    const body={project_id:projectId,name:fields.name,amount_cents:amount,instrument:fields.instrument,terms:fields.terms,
      minimum_cheque_cents:minimum,target_close:fields.target,deck_id:deck?.id??null,deck_version:deck?.version??null,
      data_room_project_uid:fields.room?context.data.data_room?.project_uid??null:null};
    const result=uid?await roundCallsApi.save(uid,body):await roundCallsApi.create(body);
    setUid(result.uid);return result.uid;
  }
  async function next(){await run(async()=>{
    if(step===0||step===1){await persist();setStep(step+1);}
    else if(step===2){await roundCallsApi.audience(uid,{chosen_prospect_ids:chosen,include_matches:includeMatches});setPage(await roundCallsApi.page(uid));setStep(3);}
    else if(step===3){setPage(await roundCallsApi.page(uid));setStep(4);}
  });}
  async function checkMatches(){await run(async()=>setMatches(await roundCallsApi.previewAudience(uid,{chosen_prospect_ids:chosen,include_matches:true})));}
  async function send(){await run(async()=>{const result=await roundCallsApi.send(uid,{acknowledge_missing:acknowledge});setOutcome(result);});}
  const on={change,next,send,checkMatches,back:()=>setStep(n=>Math.max(0,n-1)),acknowledge:setAcknowledge,includeMatches:setIncludeMatches,
    choose:id=>setChosen(values=>values.includes(id)?values.filter(value=>value!==id):[...values,id])};
  return <CallSheetFrame onClose={onClose}><CallReadState read={context}>{context.data&&<RoundCallSheetView state={{step,fields,context:context.data,chosen,includeMatches,matches,page,acknowledge,busy,error,outcome,uid}} on={on}/>}</CallReadState></CallSheetFrame>;
}
export function RoundCallSheetView({state:s,on}) {
  const missing=s.page?.readiness?.filter(item=>!item.ready)||[];
  const approved=!!s.page?.counsel_approved;
  return <div className="space-y-4">
    <ol aria-label="Round call steps" className="flex gap-2 text-xs">{ROUND_CALL_STEPS.map((label,index)=><li key={label} aria-current={index===s.step?'step':undefined} className={index===s.step?'font-bold text-violet-700 dark:text-violet-300':'text-axal-muted'}>{index+1}. {label}</li>)}</ol>
    <fieldset disabled={s.busy||!!s.outcome} className="space-y-3">
    {s.step===0&&<><h3 className="font-semibold">Round</h3><p className="text-xs text-axal-muted">Recorded planner fields fill where available. Every field below is editable; terms remain a draft.</p>
      <label className="block">Round name<input className={callInput} value={s.fields.name} maxLength={200} onChange={e=>on.change('name',e.target.value)}/></label>
      <label className="block">Target amount · USD<input className={callInput} inputMode="decimal" value={s.fields.amount} onChange={e=>on.change('amount',e.target.value)}/></label>
      <label className="block">Instrument<select className={callInput} value={s.fields.instrument} onChange={e=>on.change('instrument',e.target.value)}><option value="">Choose an instrument</option><option value="safe">SAFE</option><option value="equity">Equity</option><option value="convertible_note">Convertible note</option></select></label>
      <label className="block">Terms<textarea className={callInput} maxLength={20000} value={s.fields.terms} onChange={e=>on.change('terms',e.target.value)}/></label>
      <label className="block">Minimum cheque · USD<input className={callInput} inputMode="decimal" value={s.fields.minimum} onChange={e=>on.change('minimum',e.target.value)}/></label>
      <label className="block">Target close<input type="date" className={callInput} value={s.fields.target} onChange={e=>on.change('target',e.target.value)}/></label>
      <p className="text-xs text-axal-muted">Cap-table scenario: {s.context.scenario?.name||'Not recorded · no scenario exists for this venture and owner.'}</p>
    </>}
    {s.step===1&&<><h3 className="font-semibold">Materials</h3>
      <label className="block">Pitch deck version<select className={callInput} value={s.fields.deck_id} onChange={e=>on.change('deck_id',e.target.value)}><option value="">No deck linked</option>{s.context.decks.map(d=><option key={d.id} value={d.id}>{d.title||'Pitch deck'} · v{d.version}</option>)}</select></label>
      {!s.context.decks.length&&<p>Not recorded · no pitch deck version exists for this venture.</p>}
      {s.context.data_room?<label className="block"><input type="checkbox" checked={s.fields.room} onChange={e=>on.change('room',e.target.checked)}/> Link the data room behind its NDA gate. Files are never copied.</label>:<p>No data room yet. Investors will see the deck only. <Link className="underline" to={'/raise/data-room?project_id='+s.context.project.id}>Create a data room</Link></p>}
    </>}
    {s.step===2&&<><h3 className="font-semibold">Investors I choose</h3>
      {s.context.chosen.length?s.context.chosen.map(p=><label key={p.prospect_id} className="block"><input type="checkbox" checked={s.chosen.includes(p.prospect_id)} onChange={()=>on.choose(p.prospect_id)}/> {p.name} · {p.email}</label>):<p>No verified investor from this venture’s pipeline is available.</p>}
      <h3 className="font-semibold">Matching investors on Axal</h3><button type="button" className={callButton} onClick={on.checkMatches}>Check matches</button>
      {s.matches&&<><p>{s.matches.matched} verified investors match.</p>{s.matches.matched===0?<p>No matching investors yet. No verified investor fits the stage, sector, thesis and cheque range.</p>:<ul>{s.matches.match_reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>}</>}
      <label className="block"><input type="checkbox" checked={s.includeMatches} onChange={e=>on.includeMatches(e.target.checked)}/> Include verified matches</label><p className="text-xs text-axal-muted">Names appear only once an investor responds. There is no public URL.</p>
    </>}
    {s.step===3&&s.page&&<><h3 className="font-semibold">Preview</h3><p>{s.page.call.name} · {moneyCents(s.page.call.amount_cents)} · {s.page.call.instrument}</p>
      <p className="whitespace-pre-wrap">{s.page.call.terms}</p><p>Minimum cheque {moneyCents(s.page.call.minimum_cheque_cents)} · target close {s.page.call.target_close}</p>
      <p>Deck: {s.page.call.deck_version==null?'Not recorded · no version linked':'v'+s.page.call.deck_version}</p><p>Data room: {s.page.call.data_room_project_uid?'Linked · NDA first':'Not recorded · no room linked'}</p>
      <p>{s.page.progress.received} verified recipients. Matching identities stay private until a response.</p>
    </>}
    {s.step===4&&s.page&&<><h3 className="font-semibold">Ready to send</h3><p>To {s.page.progress.received} verified recipients</p>
      {!approved?<p role="alert">Counsel has not approved the terms yet. Send unlocks once they do. <Link className="underline" to={'/round-calls/'+s.uid}>Open the draft for counsel review</Link></p>:<p>Terms approved by counsel · {s.page.call.counsel_approved_at}</p>}
      {missing.length?<><p>{missing.length} of {s.page.readiness.length} readiness items are missing.</p><ul>{missing.map(item=><li key={item.key}>{item.label}</li>)}</ul><label className="block"><input type="checkbox" checked={s.acknowledge} onChange={e=>on.acknowledge(e.target.checked)}/> Send anyway with these readiness items missing</label></>:<p>{s.page.readiness.length} of {s.page.readiness.length} readiness items are in place.</p>}
    </>}
    </fieldset>
    {s.error&&<p role="alert" className="text-red-700 dark:text-red-300">{s.error}</p>}
    {s.outcome?<p role="status">The call is available to {s.outcome.recipients} verified recipients; {s.outcome.notified} notified, {s.outcome.not_delivered} not delivered. <Link className="underline" to={'/round-calls/'+s.uid}>Open the call</Link></p>:
      <div className="flex justify-between gap-2"><button type="button" className={callButton} disabled={s.busy||s.step===0} onClick={on.back}>{s.step===4&&missing.length?'Finish them first':'Back'}</button>
      {s.step<4?<button type="button" className={callButton} disabled={s.busy} onClick={on.next}>Next</button>:<button type="button" className={callButton} disabled={s.busy||!approved||(missing.length>0&&!s.acknowledge)} onClick={on.send}>{missing.length?'Send anyway':'Send the call'}</button>}</div>}
  </div>;
}

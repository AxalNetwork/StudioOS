import React, { useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { roundCallsApi } from '../../lib/api/roundCalls';
import { reportError } from '../../lib/log';
import RoundCallSheet from './RoundCallSheet';
import { useCallRead, CallReadState, callButton, callInput, moneyCents, dollarsToCents, callDate } from './roundCallParts';

export function RoundCallIndex() {
  const [params]=useSearchParams();
  const projectId=params.get('project_id');
  const read=useCallRead(()=>roundCallsApi.list(projectId),[projectId]);
  return <main className="p-5 space-y-4"><h1 className="text-2xl font-bold">Round calls</h1><CallReadState read={read}>{read.data&&(read.data.items.length?<ul>{read.data.items.map(call=><li key={call.uid}><Link className="underline" to={(projectId?'/raise/calls/':'/round-calls/')+call.uid}>{call.name}</Link> · {call.state} · closes {callDate(call.target_close)}</li>)}</ul>:<p>No round calls are recorded for this view.</p>)}</CallReadState></main>;
}
export default function RoundCallPage() {
  const {uid}=useParams();
  const read=useCallRead(()=>roundCallsApi.page(uid),[uid]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [amount,setAmount]=useState(''),[question,setQuestion]=useState(''),[answers,setAnswers]=useState({});
  const [target,setTarget]=useState(''),[reference,setReference]=useState(''),[showSheet,setShowSheet]=useState(false),[recipientPage,setRecipientPage]=useState(0);
  async function perform(action,label){setBusy(true);setError('');setMessage('');
    try{await action();setMessage(label);read.retry();}
    catch(e){reportError('round-calls:response',e);setError(e.code==='nda_required'?'A signed NDA is required before requesting the data room.':
      e.code==='step_up_required'?'Sign in again with a strong factor before recording counsel’s approval.':
      e.status>=500||!e.status?'The action could not be confirmed. Check the call before retrying.':'This change was refused. Check the recorded fields and the call’s current state.');}
    finally{setBusy(false);}}
  const on={
    amount:setAmount,question:setQuestion,target:setTarget,reference:setReference,
    answerValue:(key,value)=>setAnswers(values=>({...values,[key]:value})),page:setRecipientPage,
    commit:()=>perform(async()=>{const cents=dollarsToCents(amount);if(cents==null)throw Object.assign(new Error('Invalid amount'),{status:400});await roundCallsApi.respond(uid,{action:'commit',amount_cents:cents});},'Indicative commitment recorded in the founder’s pipeline.'),
    ask:()=>perform(()=>roundCallsApi.respond(uid,{action:'question',question}),'Question recorded in the founder’s pipeline.'),
    requestRoom:()=>perform(()=>roundCallsApi.respond(uid,{action:'data_room'}),'Data-room request recorded. The founder must still grant access.'),
    requestNda:()=>perform(()=>roundCallsApi.respond(uid,{action:'question',question:'Please send the NDA for this round’s data room.'}),'NDA request sent to the founder’s question list.'),
    answer:key=>perform(()=>roundCallsApi.answer(uid,key,answers[key]),'Answer recorded.'),
    extend:()=>perform(()=>roundCallsApi.manage(uid,{action:'extend',target_close:target}),'Target close extended. Responses are paused until counsel approves the extended terms.'),
    close:()=>perform(()=>roundCallsApi.manage(uid,{action:'close'}),'Call closed. It is now read-only.'),
    counsel:()=>perform(()=>roundCallsApi.counsel(uid,{reference,terms_hash:read.data.call.terms_hash,revision:read.data.call.revision}),'Counsel’s approval reference recorded for this version.'),
    edit:()=>setShowSheet(true),
  };
  // D686: a founder's call lives in the Raise shell; investors and counsel keep this page.
  if(read.data?.viewer==='founder'&&read.data.call.state!=='draft')return <Navigate to={'/raise/calls/'+encodeURIComponent(uid)} replace/>;
  return <main className="p-5 space-y-4 text-axal-ink dark:text-gray-100"><CallReadState read={read}>{read.data&&<RoundCallPageView state={{data:read.data,busy,error,message,amount,question,answers,target,reference,recipientPage}} on={on}/>}</CallReadState>
    {showSheet&&<RoundCallSheet projectId={read.data.call.project_id} initialCall={read.data.call.state==='draft'?read.data.call:null} onClose={()=>{setShowSheet(false);read.retry();}}/>}</main>;
}
function slideLines(value,depth=0) {
  if(depth>5||value==null)return [];
  if(typeof value==='string'||typeof value==='number')return [String(value)];
  if(Array.isArray(value))return value.flatMap(v=>slideLines(v,depth+1));
  if(typeof value==='object')return Object.entries(value).filter(([key])=>!['method_id','template','template_key','id','key','type','layout','image','image_url','background','color','style'].includes(key)).flatMap(([,v])=>slideLines(v,depth+1));
  return [];
}
export function RecordedCallDeck({deck}) {
  if(deck?.unreadable)return <p>Unreadable · the deck changed after approval. The founder must restore the approved deck or open a new call.</p>;
  if(!deck)return <p>Not recorded · no linked deck version could be read.</p>;
  let slides;
  try{slides=typeof deck.slides==='string'?JSON.parse(deck.slides):deck.slides;}catch{return <p>Unreadable · the recorded deck could not be decoded.</p>;}
  if(!Array.isArray(slides))return <p>Unreadable · this deck has no readable slide array.</p>;
  return <section className="space-y-3"><h2 className="font-semibold">{deck.title||'Pitch deck'} · v{deck.version}</h2><p className="text-xs text-axal-muted">The linked version’s recorded slide content. Visuals remain in the deck editor; no public share link is created.</p>
    {slides.map((slide,index)=><article key={index} className="rounded-xl border border-axal-hairline p-4"><h3 className="font-semibold">Slide {index+1}</h3>{slideLines(slide).length?slideLines(slide).map((line,i)=><p key={i} className="whitespace-pre-wrap break-words">{line}</p>):<p>Not recorded · this slide has no text content.</p>}</article>)}</section>;
}
export function RoundCallPageView({state:s,on}) {
  const d=s.data,c=d.call,founder=d.viewer==='founder',counsel=d.viewer==='counsel';
  const rows=d.recipients?.slice(s.recipientPage*25,s.recipientPage*25+25)||[];
  return <div className="space-y-4">
    <header><p className="text-xs text-axal-muted">Raise</p><h1 className="text-2xl font-bold">Call for Capital · {c.name}</h1><p>{c.instrument} · {moneyCents(c.amount_cents)} · closes {callDate(c.target_close)}</p></header>
    {d.read_only&&<p role="status">{c.state==='awaiting_counsel'?'Responses are paused until counsel approves the extended terms. This call is read-only.':'This call is closed or expired. It is read-only.'} Commitments remain indicative; no payment or security issuance is recorded here.</p>}
    <section className="rounded-xl border border-axal-hairline p-4"><h2 className="font-semibold">Terms</h2><p className="whitespace-pre-wrap">{c.terms}</p><p>Minimum cheque {moneyCents(c.minimum_cheque_cents)}</p></section>
    {(founder||counsel)&&<>
      <p>{d.counsel_approved?'Counsel approval recorded for these terms.':'Counsel has not approved the current terms. Send remains locked.'}</p>
      {c.state==='draft'&&founder&&<button type="button" className={callButton} disabled={s.busy} onClick={on.edit}>Continue draft</button>}
      {['draft','awaiting_counsel'].includes(c.state)&&counsel&&<section><h2 className="font-semibold">Record counsel’s approval</h2><p>Record an actual counsel approval reference for the terms shown above. A fresh strong-factor sign-in is required.</p><label className="block">Counsel approval reference<textarea className={callInput} maxLength={2000} value={s.reference} onChange={e=>on.reference(e.target.value)}/></label><button type="button" className={callButton} disabled={s.busy||s.reference.trim().length<10} onClick={on.counsel}>Record approved terms</button></section>}
      <section className="rounded-xl border border-axal-hairline p-4"><h2 className="font-semibold">Indicative commitments · {moneyCents(d.progress.committed_cents)} of {moneyCents(d.progress.target_cents)}</h2><progress className="w-full" value={Math.min(d.progress.committed_cents,d.progress.target_cents)} max={d.progress.target_cents}/>
        <p>{d.progress.received} recipients · {d.progress.opened} opened · {d.progress.data_room_requests} data-room requests · {d.progress.commitments} commitments</p></section>
      <section className="overflow-x-auto rounded-xl border border-axal-hairline"><table className="w-full text-left text-sm"><thead><tr><th>Investor</th><th>Opened</th><th>Data room</th><th>Commitment</th></tr></thead><tbody>{rows.map((r,index)=><tr key={r.investor_user_id||'match-'+index}><td>{r.name?r.name+' · '+r.email:'Matching investor · identity private until a response'}</td><td>{r.opened_at?callDate(r.opened_at):'No open recorded'}</td><td>{r.data_room_requested_at?callDate(r.data_room_requested_at):'No request recorded'}</td><td>{r.commitment_cents==null?'No commitment recorded':moneyCents(r.commitment_cents)}</td></tr>)}</tbody></table>
        {!d.recipients.length&&<p>No recipients are recorded yet.</p>}<div className="flex justify-between gap-2 p-3 text-xs"><span>{d.recipients.length?s.recipientPage*25+1:0}–{Math.min((s.recipientPage+1)*25,d.recipients.length)} of {d.recipients.length}</span><button type="button" className={callButton} disabled={s.recipientPage===0} onClick={()=>on.page(s.recipientPage-1)}>Previous</button><button type="button" className={callButton} disabled={(s.recipientPage+1)*25>=d.recipients.length} onClick={()=>on.page(s.recipientPage+1)}>Next</button></div>
      </section>
      {founder&&['sent','awaiting_counsel'].includes(c.state)&&<section className="space-y-2">{c.state==='sent'&&<><label className="block">Extend the date<input type="date" className={callInput} value={s.target} onChange={e=>on.target(e.target.value)}/></label><button type="button" className={callButton} disabled={s.busy||!s.target} onClick={on.extend}>Extend the date</button></>}<button type="button" className={callButton} disabled={s.busy} onClick={on.close}>Close the call</button></section>}
      {founder&&d.read_only&&c.state!=='awaiting_counsel'&&<button type="button" className={callButton} onClick={on.edit}>Open a new call</button>}
      {founder&&c.data_room_project_uid&&<Link className="underline" to={'/raise/data-room?project_id='+c.project_id}>Review data-room grants and NDA access</Link>}
    </>}
    {d.viewer==='investor'&&<>
      <RecordedCallDeck deck={d.deck}/>
      <section className="space-y-2"><h2 className="font-semibold">Data room</h2>
        {!d.data_room.recorded?<p>Not recorded · no data room is linked to this call.</p>:d.data_room.path&&d.data_room.nda_signed&&d.data_room.has_grant?<Link className="underline" to={d.data_room.path}>Open the NDA-gated data room</Link>:!d.data_room.nda_signed?<><p>A signed NDA is required first. The data room is not exposed here.</p>{!d.read_only&&<button type="button" className={callButton} disabled={s.busy} onClick={on.requestNda}>Request the NDA</button>}</>:<p>NDA signed. The founder must grant access before files can be read.</p>}
        {d.data_room.recorded&&d.data_room.nda_signed&&!d.read_only&&<button type="button" className={callButton} disabled={s.busy} onClick={on.requestRoom}>Request data-room access</button>}
      </section>
      {!d.read_only&&<section className="space-y-3"><p>A commitment is an indicative expression of interest, not a payment or a signed investment.</p>
        <label className="block">Commitment amount · USD<input className={callInput} inputMode="decimal" value={s.amount} onChange={e=>on.amount(e.target.value)}/></label><button type="button" className={callButton} disabled={s.busy||dollarsToCents(s.amount)==null} onClick={on.commit}>Commit with an amount</button>
        <label className="block">Ask a question<textarea className={callInput} maxLength={2000} value={s.question} onChange={e=>on.question(e.target.value)}/></label><button type="button" className={callButton} disabled={s.busy||!s.question.trim()} onClick={on.ask}>Ask a question</button>
      </section>}
    </>}
    <section className="space-y-3"><h2 className="font-semibold">Questions</h2>{d.questions.length?d.questions.map(q=><article key={q.uid} className="rounded-xl border border-axal-hairline p-3"><p>{q.question}</p>{q.name&&<p className="text-xs text-axal-muted">{q.name} · {callDate(q.asked_at)}</p>}{q.answer?<p>Answered: {q.answer}</p>:<p>Unanswered</p>}
      {q.update_uid&&<Link className="underline" to={'/updates/'+q.update_uid}>Reply on the source update</Link>}
      {founder&&!d.read_only&&!q.update_uid&&<><label className="block">Answer<textarea className={callInput} value={s.answers[q.uid]||''} maxLength={4000} onChange={e=>on.answerValue(q.uid,e.target.value)}/></label><button type="button" className={callButton} disabled={s.busy||!s.answers[q.uid]?.trim()} onClick={()=>on.answer(q.uid)}>Answer in place</button></>}</article>):<p>No questions are recorded.</p>}</section>
    {s.error&&<p role="alert" className="text-red-700 dark:text-red-300">{s.error}</p>}{s.message&&<p role="status">{s.message}</p>}
  </div>;
}

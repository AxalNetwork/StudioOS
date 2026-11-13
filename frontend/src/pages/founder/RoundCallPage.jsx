import React, { useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { roundCallsApi } from '../../lib/api/roundCalls';
import { reportError } from '../../lib/log';
import RoundCallSheet from './RoundCallSheet';
import { InvestorEvidence } from '../cycles/evidence/InvestorEvidence';
import { useCallRead, CallReadState, callButton, callInput, moneyCents, dollarsToCents, callDate } from './roundCallParts';

export function RoundCallIndex() {
  const [params]=useSearchParams();
  const projectId=params.get('project_id');
  const read=useCallRead(()=>roundCallsApi.list(projectId),[projectId]);
  return <main className="p-5 space-y-4"><h1 className="text-2xl font-bold">Round calls</h1><CallReadState read={read}>{read.data&&(read.data.items.length?<ul>{read.data.items.map(call=><li key={call.uid}><Link className="underline" to={(projectId&&call.state!=='draft'?'/raise/capital-relationships/calls/':'/round-calls/')+call.uid}>{call.name}</Link> · {call.state} · closes {callDate(call.target_close)}</li>)}</ul>:<p>No round calls are recorded for this view.</p>)}</CallReadState></main>;
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
    commit:()=>perform(async()=>{const cents=dollarsToCents(amount);if(cents==null)throw Object.assign(new Error('Invalid amount'),{status:400});await roundCallsApi.respond(uid,{action:'commit',amount_cents:cents});},'Indicated amount recorded. It is not a payment or a signed investment.'),
    ask:()=>perform(()=>roundCallsApi.respond(uid,{action:'question',question}),'Question recorded in the founder’s pipeline.'),
    requestRoom:()=>perform(()=>roundCallsApi.respond(uid,{action:'data_room'}),'Data-room request recorded. The founder must still grant access.'),
    requestNda:()=>perform(()=>roundCallsApi.respond(uid,{action:'question',question:'Please send the NDA for this round’s data room.'}),'NDA request sent to the founder’s question list.'),
    answer:key=>perform(()=>roundCallsApi.answer(uid,key,answers[key]),'Answer recorded.'),
    extend:()=>perform(()=>roundCallsApi.manage(uid,{action:'extend',target_close:target}),'Target close extended. Responses are paused until counsel approves the extended terms.'),
    close:()=>perform(()=>roundCallsApi.manage(uid,{action:'close'}),'Call closed. It is now read-only.'),
    counsel:()=>perform(()=>roundCallsApi.counsel(uid,{reference,terms_hash:read.data.call.terms_hash,revision:read.data.call.revision}),'Counsel’s approval reference recorded for this version.'),
    edit:()=>setShowSheet(true),
    retry:()=>read.retry(),
  };
  // D686: a founder's call lives in the Raise shell; investors and counsel keep this page.
  // D1224: a founder's call, a draft included, opens under Calls in the Raise shell.
  if(read.data?.viewer==='founder')return <Navigate to={'/raise/capital-relationships/calls/'+encodeURIComponent(uid)} replace/>;
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
  if(s.data.viewer==='investor')return <InvestorCallView state={s} on={on}/>;
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
      {founder&&c.data_room_project_uid&&<Link className="underline" to={'/raise/data-room/access?project_id='+c.project_id}>Review data-room grants and NDA access</Link>}
    </>}
    <section className="space-y-3"><h2 className="font-semibold">Questions</h2>{d.questions.length?d.questions.map(q=><article key={q.uid} className="rounded-xl border border-axal-hairline p-3"><p>{q.question}</p>{q.name&&<p className="text-xs text-axal-muted">{q.name} · {callDate(q.asked_at)}</p>}{q.answer?<p>Answered: {q.answer}</p>:<p>Unanswered</p>}
      {q.update_uid&&<Link className="underline" to={'/updates/'+q.update_uid}>Reply on the source update</Link>}
      {founder&&!d.read_only&&!q.update_uid&&<><label className="block">Answer<textarea className={callInput} value={s.answers[q.uid]||''} maxLength={4000} onChange={e=>on.answerValue(q.uid,e.target.value)}/></label><button type="button" className={callButton} disabled={s.busy||!s.answers[q.uid]?.trim()} onClick={()=>on.answer(q.uid)}>Answer in place</button></>}</article>):<p>No questions are recorded.</p>}</section>
    {s.error&&<p role="alert" className="text-red-700 dark:text-red-300">{s.error}</p>}{s.message&&<p role="status">{s.message}</p>}
  </div>;
}

const INSTRUMENT={safe:'A SAFE',convertible_note:'A convertible note',equity:'A priced equity round'};
const INSTRUMENT_NAME={safe:'SAFE',convertible_note:'Convertible note',equity:'Priced equity'};
const instrumentName=value=>INSTRUMENT_NAME[value]||'Not recorded';
/** CLS13's "In plain words": only the terms the call records, never a filled-in one. */
export function plainTerms(c) {
  if(!INSTRUMENT[c.instrument]||c.amount_cents==null)return null;
  const terms=[c.valuation_cap_cents!=null&&'a valuation cap of '+moneyCents(c.valuation_cap_cents),
    c.discount_bps!=null&&'a '+(c.discount_bps/100)+'% discount',c.pre_money_cents!=null&&'a pre-money valuation of '+moneyCents(c.pre_money_cents)].filter(Boolean);
  return INSTRUMENT[c.instrument]+' for up to '+moneyCents(c.amount_cents)+(terms.length?' with '+terms.join(' and '):'')+'.'+
    (c.minimum_cheque_cents!=null?' The smallest cheque is '+moneyCents(c.minimum_cheque_cents)+', and the call closes on '+callDate(c.target_close)+'.':' The call closes on '+callDate(c.target_close)+'.');
}
const card='rounded-xl border border-axal-hairline p-4 space-y-2';
/** Why an investor's call is read-only, in CLS13's words. */
function readOnlyNote(d) {
  if(d.call.state==='awaiting_counsel')return ['Responses are paused until counsel approves the extended terms.','You can still read the terms and the deck.'];
  if(d.deck?.unreadable&&d.call.state==='sent')return ['Responses are paused. The deck changed after approval.','You can still read the terms. The founder must restore the approved deck or open a new call.'];
  return ['This call is closed.','You can still read the terms and the deck. You can no longer indicate an amount or ask a question.'];
}
/**
 * D1226 (#3225), CLS13: the investor's page. Under Deals. It names the company
 * and no other investor: no recipient, and no name on a question. An amount is
 * Indicated, never committed (D653). The data room opens only with the NDA and
 * the founder's grant.
 */
export function InvestorCallView({state:s,on}) {
  const d=s.data,c=d.call,company=d.company?.name||null,room=d.data_room||{},mine=d.recipient||{};
  const cents=dollarsToCents(s.amount);
  const outOfRange=cents!=null&&((c.minimum_cheque_cents!=null&&cents<c.minimum_cheque_cents)||(c.amount_cents!=null&&cents>c.amount_cents));
  const status=d.read_only?(c.state==='awaiting_counsel'||d.deck?.unreadable&&c.state==='sent'?'Paused':'Closed'):'Open';
  const plain=plainTerms(c);
  const rows=[['Instrument',instrumentName(c.instrument)],['Target',moneyCents(c.amount_cents)],
    ...(c.instrument==='equity'?[['Pre-money valuation',moneyCents(c.pre_money_cents)]]:[['Valuation cap',moneyCents(c.valuation_cap_cents)]]),
    ...(c.instrument==='convertible_note'?[['Discount',c.discount_bps==null?'Not recorded':(c.discount_bps/100)+'%']]:[]),
    ['Minimum cheque',moneyCents(c.minimum_cheque_cents)],['Closes',callDate(c.target_close)]];
  return <div className="space-y-4" data-testid="investor-call">
    <header className="space-y-1">
      <nav aria-label="Breadcrumb" className="text-xs text-axal-muted"><Link className="underline" to="/deals">Deals</Link> › Round calls › <span>{company||c.name}</span></nav>
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold">{company?`A private round call from ${company}`:'A private round call'}</h1><span data-testid="call-status" className="rounded-full border border-axal-hairline px-2 py-0.5 text-xs font-semibold">{status}</span></div>
      <p className="text-sm text-axal-muted">{c.name} · sent to you on {callDate(c.sent_at)} · closes {callDate(c.target_close)}</p>
    </header>
    {d.read_only&&<section role="status" data-testid="read-only" className={card}>{readOnlyNote(d).map(line=><p key={line}>{line}</p>)}</section>}
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <section className={card} data-testid="call-terms"><h2 className="font-semibold">Terms</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">{rows.map(([k,v])=><React.Fragment key={k}><dt className="text-axal-muted">{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
          <h3 className="text-sm font-semibold">In plain words</h3><p data-testid="plain-terms">{plain||'Not recorded · this call has no readable instrument or target.'}</p>
          {c.terms&&<p className="whitespace-pre-wrap text-sm">{c.terms}</p>}
        </section>
        <div className="grid gap-4 md:grid-cols-2">
          <section className={card} data-testid="call-deck"><h2 className="font-semibold">Pitch deck</h2>
            <p className="text-sm text-axal-muted">{c.deck_version!=null?'v'+c.deck_version+' · frozen with this call':'Not recorded · no deck version is linked to this call.'}</p>
            {c.deck_version!=null&&<details><summary className={callButton+' inline-block cursor-pointer'}>Open the deck</summary><div className="mt-3"><RecordedCallDeck deck={d.deck}/></div></details>}
          </section>
          <section className={card} data-testid="call-data-room"><h2 className="font-semibold">Data room</h2>
            {!room.recorded?<p>Not recorded · no data room is linked to this call.</p>
              :room.path&&room.nda_signed&&room.has_grant?<><p>NDA signed. The founder granted you access.</p><Link className="underline" to={room.path}>Open the data room</Link></>
              :!room.nda_signed?<><p className="flex items-center gap-2"><Lock aria-hidden="true" size={14}/>Sign the NDA to ask for access</p><p className="text-sm text-axal-muted">Once signed: Ask for access. Your request reaches the founder in Data room › Requests.</p>
                {!d.read_only&&<button type="button" className={callButton} disabled={s.busy} onClick={on.requestNda}>Request the NDA</button>}</>
              :mine.data_room_requested_at?<p>NDA signed. You asked for access on {callDate(mine.data_room_requested_at)}. The founder must grant it before files can be read.</p>
              :<><p>NDA signed. The founder must grant access before files can be read.</p>{!d.read_only&&<button type="button" className={callButton} disabled={s.busy} onClick={on.requestRoom}>Ask for access</button>}</>}
          </section>
        </div>
        {/* D1268 (#3291): the founder's shared evidence as this recipient may see it (D1265); null when the read does not admit them. */}
        <InvestorEvidence read={d.evidence??null} company={company} onRetry={on.retry}/>
      </div>
      <div className="space-y-4">
        <section className={card} data-testid="call-indicate"><h2 className="font-semibold">Indicate an amount</h2>
          {mine.commitment_cents!=null&&<p data-testid="indicated">Indicated · {moneyCents(mine.commitment_cents)}.</p>}
          {!d.read_only&&<><label className="block text-sm">Amount · USD<input data-testid="indicate-amount" className={callInput} inputMode="decimal" value={s.amount} onChange={e=>on.amount(e.target.value)}/></label>
            <p className="text-xs text-axal-muted">Minimum cheque {moneyCents(c.minimum_cheque_cents)}.{outOfRange?' This amount is outside the call’s minimum cheque and target.':''}</p></>}
          <p className="text-xs text-axal-muted">This records your intention. It is not a payment or a signed investment.</p>
          {!d.read_only&&<button type="button" data-testid="indicate" className={callButton} disabled={s.busy||cents==null||outOfRange} onClick={on.commit}>Indicate an amount</button>}
        </section>
        <section className={card} data-testid="call-questions"><h2 className="font-semibold">Ask a question</h2>
          {!d.read_only&&<><textarea data-testid="question" aria-label="Your question" className={callInput} maxLength={2000} placeholder={'Your question for '+(company||'the founders')} value={s.question} onChange={e=>on.question(e.target.value)}/>
            <button type="button" data-testid="ask" className={callButton} disabled={s.busy||!s.question.trim()} onClick={on.ask}>Ask a question</button></>}
          <p className="text-xs text-axal-muted">The founders answer on Axal. Investors who asked see the answer.</p>
          {(d.questions||[]).length?<ul className="space-y-2">{d.questions.map(q=><li key={q.uid} className="rounded-lg border border-axal-hairline p-3 text-sm"><p>{q.question}</p><p className="text-xs text-axal-muted">You asked on {callDate(q.asked_at)}</p>{q.answer?<p>Answered: {q.answer}</p>:<p>Unanswered</p>}</li>)}</ul>:<p className="text-sm">You have not asked a question yet.</p>}
        </section>
      </div>
    </div>
    {s.error&&<p role="alert" className="text-red-700 dark:text-red-300">{s.error}</p>}{s.message&&<p role="status">{s.message}</p>}
  </div>;
}

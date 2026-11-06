/** D4488 (#4488): quoted drafts and form preview in the Ask panel; form acceptance stays local and campaign assets are explicit. */
import { useEffect, useMemo, useRef, useState } from 'react';
import AskIntent from '../../../ui/AskIntent.jsx';
import { useRailOption } from '../../../ui/railCrumbs';
import { ADD_TOKENS_PATH } from '../../../lib/aiTokens';
import { growDistributionAsk } from '../../../lib/api/growDistributionAsk.js';
import { SOURCE_CHOICES, holdLine, receiptLine, notifyDistribution, ACCEPT_LINE, OUT_OF_TOKENS } from './distributionAskModel.js';
import { BUTTON, ProposalCard } from './WaitingForYou.jsx';
const DEFAULT_KINDS = ['post','newsletter','outreach_email'];
export default function DistributionAskIntent({projectId,campaignUid,contactUid,target='form',kinds=DEFAULT_KINDS,channelNames={},now={},onAccept,onClose,api=growDistributionAsk}) {
  const [sources,setSources]=useState(['validate','research','distribution']);
  const [estimate,setEstimate]=useState(null),[refs,setRefs]=useState([]),[rows,setRows]=useState([]),[receipt,setReceipt]=useState(null);
  const [hasAccepted,setHasAccepted]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(null),[quoteBusy,setQuoteBusy]=useState(false);
  const kindKey=JSON.stringify(kinds);
  const request=useMemo(()=>({project:projectId,campaign_uid:campaignUid??null,...(contactUid?{contact_uid:contactUid}:{}),target,kinds:JSON.parse(kindKey),sources}),[projectId,campaignUid,contactUid,target,kindKey,sources]);
  const identity=JSON.stringify([projectId,campaignUid??null,contactUid??null,target,kindKey,sources]);
  const scope=useRef(identity);scope.current=identity;
  useEffect(()=>{setRows([]);setReceipt(null);setHasAccepted(false);setBusy(false);},[identity]);
  useEffect(()=>{let live=true;setEstimate(null);setRefs([]);setError(null);setQuoteBusy(true);api.quote(request).then(r=>{if(live){setEstimate(r.estimate);setRefs(r.sources??[]);}}).catch(e=>{if(live)setError(e?.status===402?'tokens':e?.code==='ai_paused'?'paused':e?.code==='assist_off'?'off':'quote');}).finally(()=>{if(live)setQuoteBusy(false);});return()=>{live=false;};},[request,api]);
  useRailOption(busy?'draft:distribution':null,'Draft Distribution text');
  const generate=async()=>{setBusy(true);setError(null);try{const r=await api.run({...request,quote:estimate});notifyDistribution(projectId);if(scope.current!==identity)return;setRows(prev=>[...prev,...r.proposals]);setReceipt(r.receipt);}catch(e){if(scope.current!==identity)return;setError(e?.status===402?'tokens':e?.code==='ai_paused'?'paused':e?.code==='assist_off'?'off':e?.status===409?'changed':'draft');if(e?.status===409){setEstimate(null);try{const q=await api.quote(request);if(scope.current===identity)setEstimate(q.estimate);}catch{if(scope.current===identity)setError('quote');}}}finally{if(scope.current===identity)setBusy(false);}};
  const decide=async(p,decision,edited)=>{setBusy(true);setError(null);try{const r=await api.decide(p.uid,{project:projectId,decision,edited});notifyDistribution(projectId);if(scope.current!==identity)return;if(decision!=='discard'){setHasAccepted(true);onAccept?.([r.proposal]);}setRows(prev=>prev.filter(v=>v.uid!==p.uid));}catch{if(scope.current===identity)setError('decision');}finally{if(scope.current===identity)setBusy(false);}};
  return <AskIntent exclusive label="Draft Distribution text" title={contactUid?'Draft a reply':'Draft for this campaign'} eyebrow="DISTRIBUTION · SOURCES AND PREVIEW" testId="distribution-ask" onClose={onClose} footer={<><p className="text-sm" data-testid="distribution-hold">{quoteBusy?'Reading the hold…':holdLine(estimate)}</p><button type="button" className={`${BUTTON} bg-axal-violet text-white`} disabled={busy || !estimate || !sources.length} onClick={generate}>{busy?'Drafting…':contactUid?'Ask Eadwyn to draft a reply':'Ask Eadwyn to draft for each channel'}</button><p className="text-xs text-axal-muted dark:text-gray-400">{target === 'form' ? ACCEPT_LINE : 'Accept keeps the text in this campaign. Nothing is posted, sent, scheduled or spent.'} {receipt?receiptLine(receipt):''}</p></>}>
    <p className="text-sm">Ask Eadwyn to draft for each channel. Nothing is saved until you accept.</p>
    <fieldset disabled={busy} className="space-y-1"><legend className="mb-2 text-xs font-semibold uppercase tracking-wide">Sources</legend>{SOURCE_CHOICES.map(s=><label key={s.key} className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" disabled={!!contactUid && s.key==='distribution'} checked={sources.includes(s.key)} onChange={e=>setSources(v=>e.target.checked?(v.includes(s.key)?v:[...v,s.key]):v.filter(k=>k!==s.key))}/>{s.label}{refs.find(r=>r.key===s.key)?` · ${refs.find(r=>r.key===s.key).count} recorded`:''}</label>)}</fieldset>
    <p className="text-xs text-axal-muted dark:text-gray-400">{contactUid ? 'The selected prospect thread and selected venture records are read.' : 'Only selected venture records are read.'} Team-only figures are never read. Dates and budgets stay manual.</p>
    {rows.length?<div className="distribution-asset-preview grid grid-cols-1 gap-3" aria-label="Preview">{rows.map(p=><ProposalCard key={p.uid} proposal={p} busy={busy} onDecide={decide} now={now} channelName={channelNames[p.payload?.channel_uid]}/>)}</div>:null}
    {target === 'form' && (rows.length || hasAccepted)?<span className="self-start rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">Not saved</span>:null}
    {error?<div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{error==='tokens'?OUT_OF_TOKENS:error==='paused'?'AI is paused on this account. Contact support.':error==='off'?'AI assistance is off for this page. You can still write it yourself.':error==='changed'?'The hold changed. Read the new hold before asking again.':error==='decision'?'That proposal could not be decided. Reload to check its state.':'Eadwyn could not prepare these drafts. Try again.'} {error==='tokens'?<a className="underline" href={ADD_TOKENS_PATH}>Add tokens</a>:null}<p className="mt-2">You can still write the post and the email yourself.</p></div>:null}
  </AskIntent>;
}

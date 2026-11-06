/** D4488 (#4488): Distribution's open proposals in an exclusive Ask intent, with safe text bulk acceptance. */
import { useCallback, useEffect, useRef, useState } from 'react';
import AskIntent from '../../../ui/AskIntent.jsx';
import { AskButtonView } from '../../../ui/AskButton.jsx';
import { useHeaderAskClaim } from '../../../ui/HeaderAsk.jsx';
import { closeAskPanel, useAskPanel } from '../../../ui/eadwynPanel.js';
import { ADD_TOKENS_PATH } from '../../../lib/aiTokens';
import { growDistributionAsk } from '../../../lib/api/growDistributionAsk.js';
import { waitingModel, proposalLabel, notifyDistribution, WAITING_OUT } from './distributionAskModel.js';
export const BUTTON = 'min-h-[44px] rounded-lg border border-axal-lavender-edge px-3 py-2 text-sm font-semibold disabled:opacity-45 dark:border-violet-700';
const PRIMARY = `${BUTTON} bg-axal-violet text-white`;

export function ProposalCard({ proposal, busy, onDecide, channelName, now = {} }) {
  const v = proposal.payload, fields = v.kind === 'campaign_fields';
  const [editing, setEditing] = useState(false), [value, setValue] = useState(v.text ?? '');
  const [values, setValues] = useState(v.values ?? {});
  const [selected, setSelected] = useState(() => Object.keys(v.values ?? {}).filter(k => now[k] == null || now[k] === ''));
  const chosen = Object.fromEntries(Object.entries(values).filter(([key]) => selected.includes(key)));
  return <article className="rounded-xl border border-axal-lavender-edge bg-white p-3 dark:border-violet-900 dark:bg-gray-950" data-testid={`distribution-proposal-${proposal.uid}`}>
    <h3 className="mb-2 text-sm font-semibold">{proposalLabel(proposal)}{channelName?` · ${channelName}`:''} · draft</h3>
    {fields ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Field','Now','Will place','Source','Select'].map(s=><th key={s} className="p-1">{s}</th>)}</tr></thead><tbody>{Object.entries(values).map(([key,val])=><tr key={key}><th className="p-1">{{name:'Name',goal:'Goal',segment_id:'Audience'}[key]}</th><td className="p-1">{now[key] == null || now[key] === '' ? 'Blank' : now[key]}</td><td className="p-1">{editing && key !== 'segment_id' ? <input aria-label={`Edit ${key}`} className="w-full min-w-16 border p-1 dark:bg-gray-900" value={val ?? ''} onChange={e=>setValues({...values,[key]:e.target.value})}/> : val ?? 'Not recorded'}</td><td className="p-1">Eadwyn</td><td className="p-1"><label className="flex min-h-[44px] min-w-[44px] items-center justify-center"><input type="checkbox" className="h-5 w-5" aria-label={`Select ${key}`} checked={selected.includes(key)} onChange={e=>setSelected(s=>e.target.checked?[...s,key]:s.filter(k=>k!==key))}/></label></td></tr>)}</tbody></table><p className="my-2 text-xs">Dates: Not placed here: you type them.</p></div>
      : editing ? <textarea className="min-h-28 w-full rounded-lg border p-2 text-sm dark:bg-gray-900" aria-label={`Edit ${proposalLabel(proposal)}`} value={value} maxLength={2000} onChange={e=>setValue(e.target.value)}/> : <p className="whitespace-pre-wrap break-words text-sm">{v.text}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className={PRIMARY} disabled={busy || fields && !selected.length || !fields && !value.trim()} onClick={()=>onDecide(proposal,fields || editing?'edit':'accept',fields?{values:chosen}:editing?{text:value}:undefined)}>{fields ? `Accept selected (${selected.length})` : editing ? 'Accept edit' : 'Accept'}</button>
      <button type="button" className={BUTTON} disabled={busy} onClick={()=>setEditing(!editing)}>{editing?'Cancel edit':'Edit'}</button>
      <button type="button" className={BUTTON} disabled={busy} onClick={()=>onDecide(proposal,'discard')}>Discard</button>
    </div>
  </article>;
}
function useWaiting(projectId,campaignUid,api) {
  const key = JSON.stringify([projectId,campaignUid===undefined?'all':campaignUid]);
  const [state,setState] = useState({key,rows:null,error:false});
  const seq = useRef(0);
  const reload = useCallback(async()=>{
    const request = ++seq.current;
    if(!Number.isSafeInteger(Number(projectId))||Number(projectId)<1){setState({key,rows:null,error:true});return;}
    try {
      const r = await api.proposals(projectId,campaignUid);
      if (!Array.isArray(r?.proposals)) throw new Error('Unreadable proposals');
      if (request === seq.current) setState({key,rows:campaignUid===null?r.proposals.filter(p=>p.payload?.campaign_uid==null):r.proposals,error:false});
    } catch { if (request === seq.current) setState({key,rows:null,error:true}); }
  },[projectId,campaignUid,api,key]);
  useEffect(()=>{
    setState({key,rows:null,error:false}); reload();
    const change=e=>{if(e.detail?.project===projectId)reload();};
    window.addEventListener('distribution-proposals-changed',change);
    return()=>{seq.current++;window.removeEventListener('distribution-proposals-changed',change);};
  },[projectId,key,reload]);
  const setRows = update => setState(s => s.key === key ? {...s,rows:typeof update === 'function'?update(s.rows??[]):update} : s);
  return { rows:state.key===key?state.rows:null,setRows,error:state.key===key&&state.error,reload };
}
export default function WaitingForYou({ projectId,campaignUid,onAccept,onClose,onRows,outOfTokens=false,api=growDistributionAsk }) {
  const {rows,setRows,error,reload} = useWaiting(projectId,campaignUid,api);
  const [busy,setBusy] = useState(false),[failed,setFailed] = useState(false);
  const identity=JSON.stringify([projectId,campaignUid===undefined?'all':campaignUid]);
  const scope=useRef(identity);scope.current=identity;
  useEffect(()=>{setBusy(false);setFailed(false);},[identity]);
  const model = waitingModel(rows);
  useEffect(()=>{onRows?.(rows === null ? null : model.count);},[rows,model.count,onRows]);
  const decide = async(p,decision,edited)=>{setBusy(true);setFailed(false);try{const r=await api.decide(p.uid,{project:projectId,decision,edited});notifyDistribution(projectId);if(scope.current!==identity)return;if(decision!=='discard')onAccept?.([r.proposal]);setRows(s=>s.filter(v=>v.uid!==p.uid));}catch{if(scope.current===identity){setFailed(true);await reload();}}finally{if(scope.current===identity)setBusy(false);}};
  const all = async()=>{setBusy(true);setFailed(false);try{const r=await api.acceptSafe({project:projectId,uids:model.safe.slice(0,50).map(p=>p.uid)});notifyDistribution(projectId);if(scope.current!==identity)return;const accepted=r.results.filter(v=>v.status===200).map(v=>v.proposal);onAccept?.(accepted);setFailed(r.results.some(v=>v.status!==200));await reload();}catch{if(scope.current===identity)setFailed(true);}finally{if(scope.current===identity)setBusy(false);}};
  return <AskIntent exclusive label="Waiting for you" title="Waiting for you" eyebrow={`DISTRIBUTION · ${rows === null?'Not recorded':`${model.count} PROPOSALS`}`} onClose={onClose} testId="distribution-waiting" footer={<><button className={PRIMARY} type="button" disabled={busy || !model.safe.length} onClick={all}>{rows === null ? 'Accept all safe' : `Accept all safe (${model.safe.length})`}</button><p className="text-xs text-axal-muted dark:text-gray-400">Replies and ad spend are accepted one by one. Bulk accepts post copy, subject lines and newsletter text only. Nothing sends or starts ads.</p></>}>
    {outOfTokens ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{WAITING_OUT} <a className="underline" href={ADD_TOKENS_PATH}>Add tokens</a></p> : null}
    {error ? <p role="alert">Unreadable: proposals could not be read. <button className={BUTTON} onClick={reload}>Try again</button></p> : rows === null ? <div role="status" aria-label="Loading proposals" className="space-y-3">{[1,2,3].map(n=><div key={n} className="h-28 animate-pulse rounded-xl bg-axal-lavender dark:bg-gray-800"/>)}</div> : model.count ? <div className="space-y-3">{model.rows.map(p=><ProposalCard key={p.uid} proposal={p} busy={busy} onDecide={decide}/>)}</div> : <p>Nothing waits for you.</p>}
    {failed ? <p role="alert">Some proposals could not be accepted. Check the remaining rows and try again.</p> : null}
  </AskIntent>;
}
/** Header owns its venture-scoped count; unreadable reads never become a badge. */
export function DistributionAskHeader({projectId,campaignUid,onAccept,state='rest',title,sub,disabled=false,ariaLabel,api=growDistributionAsk}) {
  const ask=useAskPanel(), available=ask.available;
  useHeaderAskClaim(available);
  const {rows} = useWaiting(projectId,campaignUid,api);
  const [open,setOpen] = useState(false);
  return available ? <><AskButtonView disabled={disabled} ariaLabel={ariaLabel} waiting={rows === null?null:waitingModel(rows).count} expanded={open && ask.open} onClick={()=>{if(open && ask.open)closeAskPanel();else setOpen(true);}} testId="distribution-ask" state={state} title={title} sub={sub}/>{open?<WaitingForYou projectId={projectId} campaignUid={campaignUid} onAccept={onAccept} outOfTokens={state==='out'} api={api} onClose={()=>setOpen(false)}/>:null}</> : null;
}

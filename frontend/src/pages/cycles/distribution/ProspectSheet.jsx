/** D4492: the sole prospect email read, with recorded activity and explicit permission/status edits. */
import React,{useEffect,useRef,useState} from 'react';
import { Pill,Sheet,Skeleton } from '../../../ui';
import { ConsentFields,PROSPECT_BUTTON } from './AddProspectSheet';
import { PROSPECT_COLUMNS,nextProspectStatus,prospectRefusal,sourceLabel } from './prospectsModel';
const checkedDetail=data=>{
  if(!data||typeof data.uid!=='string'||typeof data.email!=='string'||!PROSPECT_COLUMNS.some(([status])=>status===data.status)||!Array.isArray(data.consents)||!Array.isArray(data.replies)||!Array.isArray(data.tasks))throw new Error('Unreadable prospect');
  return data;
};
export default function ProspectSheet({uid,projectId,api,canWrite=false,onClose,onChanged}){
  const [state,setState]=useState({status:'loading'}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[basis,setBasis]=useState('none'),[proof,setProof]=useState('');const lock=useRef(false);
  const load=async()=>{const data=checkedDetail(await api.detail(uid,projectId));setState({status:'ready',data});const consent=data.consents?.find(c=>c.channel==='email');setBasis(consent?.basis||'none');setProof(consent?.proof||'');};
  useEffect(()=>{let live=true;setState({status:'loading'});api.detail(uid,projectId).then(checkedDetail).then(data=>{if(live){setState({status:'ready',data});const value=data.consents?.find(c=>c.channel==='email');setBasis(value?.basis||'none');setProof(value?.proof||'');}},err=>{if(live)setState({status:'unreadable',reason:prospectRefusal(err,'This prospect could not be read.')});});return()=>{live=false;};},[uid,projectId,api]);
  const save=async fn=>{if(!canWrite||lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();await load();onChanged?.();}catch(err){setError(prospectRefusal(err));}finally{lock.current=false;setBusy(false);}};
  const d=state.data,next=nextProspectStatus(d?.status);
  return <Sheet title={d?.name||'Prospect'} width={480} onClose={onClose} testId="prospect-sheet" footer={d&&next?<button type="button" className={PROSPECT_BUTTON} disabled={!canWrite||busy} onClick={()=>save(()=>api.status(uid,{project:projectId,status:next[0]}))}>Move to {next[1]}</button>:null}>
    {state.status==='loading'?<div className="p-5"><Skeleton.Text lines={5}/></div>:state.status!=='ready'?<p role="alert" className="p-5">{state.reason}</p>:<div className="space-y-4 p-5 text-sm">
      <Pill tone="info">{d.status}</Pill><p className="break-words font-mono text-xs">{d.utm?.utm_campaign||'UTM not recorded'}</p>
      <dl className="space-y-3"><div><dt className="text-axal-muted dark:text-gray-400">Company</dt><dd>{d.company||'Not recorded'} · Title not recorded</dd></div><div><dt className="text-axal-muted dark:text-gray-400">Email</dt><dd className="break-words" data-testid="prospect-email">{d.email}</dd></div><div><dt className="text-axal-muted dark:text-gray-400">Source</dt><dd>{sourceLabel(d.source)}</dd></div><div><dt className="text-axal-muted dark:text-gray-400">Sequence</dt><dd>{d.sequence_reason||'Not recorded'}</dd></div></dl>
      <section><h3 className="font-semibold">Consent</h3>{d.consents?.length?<ul>{d.consents.map(c=><li key={c.channel}>{c.channel} · {c.basis==='none'?'No consent yet':c.basis==='opted_in'?'Opted in':'Wrote first'} · Recorded {c.recorded_at||'date not recorded'}</li>)}</ul>:<p>Not recorded</p>}</section>
      <section><h3 className="font-semibold">Activity</h3><ul className="space-y-2">{(d.replies||[]).map((r,i)=><li key={i}>{r.direction==='inbound'?'Replied':'Outbound reply recorded'} · {r.created_at}</li>)}<li>Added · {d.created_at||'Date not recorded'}</li>{(d.tasks||[]).map((t,i)=><li key={`task-${i}`}>Follow-up · {t.done?'Done':t.due_date||'Due date not recorded'}</li>)}</ul></section>
      <section className="space-y-3 border-t border-axal-hairline pt-4 dark:border-gray-700"><h3 className="font-semibold">Email marketing permission</h3><ConsentFields basis={basis} proof={proof} onBasis={setBasis} onProof={setProof} disabled={!canWrite||busy}/><button type="button" className={PROSPECT_BUTTON} disabled={!canWrite||busy} onClick={()=>save(()=>api.consent(uid,'email',{project:projectId,basis,proof}))}>{busy?'Saving…':'Save permission'}</button></section>
      {!canWrite?<p className="text-xs text-axal-muted dark:text-gray-400">You can read this venture’s prospects but not change them.</p>:null}
      {error?<p role="alert" className="text-red-700 dark:text-red-300">{error}</p>:null}
    </div>}
  </Sheet>;
}

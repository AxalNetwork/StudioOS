/** D6154 DE22d: use only the meeting the scoped endpoint binds to this exact decision. */
import React,{useEffect,useState} from 'react';
import {api} from '../lib/api';
import {DataState} from '../ui/Honesty';
export default function ICDecisionMinutes({uid}){
 const [read,setRead]=useState(null),[readError,setReadError]=useState(null),[writeError,setWriteError]=useState(null),[retry,setRetry]=useState(0),[edit,setEdit]=useState(null),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;setRead(null);setReadError(null);setWriteError(null);setEdit(null);api.icCommitRoom().then(r=>{if(live)setRead(r);},e=>{if(live)setReadError(e);});return()=>{live=false;};},[uid,retry]);
 const linked=read?.current?.uid===uid,minutes=linked?read.minutes:null;
 const save=async()=>{setBusy(true);setWriteError(null);try{await api.icRecordMinutes(minutes.meeting_uid,edit);setEdit(null);setRetry(n=>n+1);}catch(e){setWriteError(e);}finally{setBusy(false);}};
 return <section className="lg:col-span-12 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"><h2 className="font-semibold">Minutes</h2>
  {readError?<DataState state={readError.status===403?'refused':'unavailable'} reason={readError.message||'The meeting could not be read.'} onRetry={()=>setRetry(n=>n+1)} retryLabel="Try again"/>:!read?<p role="status">Reading the linked meeting…</p>:!linked?<DataState state="not_recorded" reason="Minutes for this decision are not available here."/>:!minutes?.available?<DataState state="not_recorded" reason="No meeting minutes are linked."/>:<>
   <p className="text-sm text-gray-600 dark:text-gray-400">{minutes.meeting_title||'Meeting'}</p>
   {edit===null?<><div className="my-3 whitespace-pre-wrap text-sm">{minutes.recorded?minutes.minutes:<DataState state="not_recorded" reason="No minutes have been saved for this meeting."/>}</div>{minutes.may_record?<button className="min-h-11 underline" onClick={()=>setEdit(minutes.minutes||'')}>Edit minutes</button>:<p className="text-xs text-gray-600 dark:text-gray-400">The meeting’s organiser or an Admin edits minutes.</p>}</>:<form onSubmit={e=>{e.preventDefault();save();}}><label className="block text-sm">Meeting minutes<textarea className="w-full rounded-lg border border-gray-300 bg-transparent p-2 dark:border-gray-700" value={edit} onChange={e=>setEdit(e.target.value)} rows={5}/></label>{writeError&&<DataState state={writeError.status===403?'refused':'unavailable'} reason={writeError.message||'Minutes could not be saved. Your draft is kept.'}/>}<button className="min-h-11 underline" disabled={busy}>Save minutes</button><button type="button" className="min-h-11 px-3" onClick={()=>setEdit(null)} disabled={busy}>Cancel</button></form>}
  </>}
 </section>;
}

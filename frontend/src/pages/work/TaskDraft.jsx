// D1614 W7 part 2 (#4419): an agent's task proposal needs a manager's decision.
import React, { useState } from 'react';
import { workAdapter } from './workAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY } from '../team/teamUi.jsx';
import { reviewError } from './TaskTimeline.jsx';
export default function TaskDraft({ draft, projectId, canManage, onChanged, adapter=workAdapter }) {
  const [editing,setEditing]=useState(false),[title,setTitle]=useState(draft.title || ''),[body,setBody]=useState(draft.body || '');
  const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const decide=async(discard)=>{if(busy)return;if(discard&&!reason.trim()){setError('Say why this draft is being discarded.');return;}if(!discard&&!title.trim()){setError('Add a title.');return;}
    setBusy(true);setError('');try{const r=discard?await adapter.discardDraft(projectId,draft.uid,{reason:reason.trim()}):await adapter.acceptDraft(projectId,draft.uid,editing?{title:title.trim(),body}:undefined);
      if(!r.available){setError(r.reason);return;}onChanged?.(discard?null:r.data?.task??r.data);
    }catch(e){setError(reviewError(e));}finally{setBusy(false);}};
  return <section aria-label="Agent draft" className="rounded border border-teal-300 p-3 dark:border-teal-700">
    <h3 className="font-semibold">Agent draft · {draft.title || 'Unreadable title'}</h3>
    <p className="whitespace-pre-wrap">{draft.body}</p>
    {canManage && <>{editing && <><label>Draft title<input aria-label="Draft title" maxLength={200} value={title} onChange={(e)=>setTitle(e.target.value)} className="block w-full dark:bg-gray-900" /></label><label>Draft description<textarea aria-label="Draft description" value={body} onChange={(e)=>setBody(e.target.value)} className="block w-full dark:bg-gray-900" /></label></>}
      <div className="mt-2 flex gap-2"><button type="button" className={BTN_PRIMARY} disabled={busy || draft.readable===false} onClick={()=>decide(false)}>{editing?'Accept edited draft':'Accept'}</button>
        <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={()=>setEditing((v)=>!v)}>{editing?'Cancel edit':'Edit'}</button></div>
      <label className="mt-2 block">Discard reason<input aria-label="Discard reason" maxLength={500} value={reason} onChange={(e)=>setReason(e.target.value)} className="block w-full dark:bg-gray-900" /></label>
      <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={()=>decide(true)}>Discard</button></>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}

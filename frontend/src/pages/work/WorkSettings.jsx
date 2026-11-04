// D1614 WK9 (#4419): a project's label and milestone catalogues in Settings.
import React, { useEffect, useState } from 'react';
import { workAdapter } from './workAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT } from '../team/teamUi.jsx';
import { reviewError } from './TaskTimeline.jsx';
export const LABEL_COLORS = ['gray','red','orange','yellow','green','teal','blue','purple','pink'];
function Catalogue({ projectId, kind, canManage, adapter }) {
  const label = kind === 'labels', singular = label ? 'label' : 'milestone';
  const [rows,setRows] = useState(null), [edit,setEdit] = useState(null), [title,setTitle] = useState('');
  const [color,setColor] = useState('gray'), [due,setDue] = useState(''), [state,setState] = useState('open');
  const [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const load = async () => { const r=await adapter[kind](projectId); if (!r.available) {setError(r.reason);return;} setRows(r.data?.[kind] || []); };
  useEffect(() => { let live=true;setRows(null);adapter[kind](projectId).then((r)=>{if(live){if(r.available)setRows(r.data?.[kind] || []);else setError(r.reason);}},()=>{if(live)setError(`${kind} could not be read.`);});return()=>{live=false;};},[adapter,kind,projectId]);
  const change = async (fn) => {if(busy)return;setBusy(true);setError('');try{const r=await fn();if(!r.available){setError(r.reason);return;}await load();setEdit(null);setTitle('');}catch(e){setError(reviewError(e));}finally{setBusy(false);}};
  const choose = (r) => {setEdit(r.uid);setTitle(label?r.name:r.title);setColor(r.color || 'gray');setDue(r.due_on || '');setState(r.state || 'open');};
  return <section className="mt-3 space-y-2" aria-label={label?'Labels':'Milestones'}>
    <h3 className="font-semibold">{label?'Labels':'Milestones'}</h3>
    {rows === null && !error && <p>Reading…</p>}
    {rows?.length === 0 && <p>No {kind} yet.</p>}
    <ul>{rows?.map((r)=><li key={r.uid} className="flex flex-wrap items-center gap-2 py-1">
      <span>{label?r.name:r.title}{label?` · ${r.color}`:` · ${r.due_on || 'Due date not recorded'} · ${r.state}`}</span>
      {canManage && <><button type="button" disabled={busy} className={BTN_TEXT} aria-label={`Edit ${label?r.name:r.title}`} onClick={()=>choose(r)}>Edit</button>
        <button type="button" disabled={busy} className={BTN_TEXT} aria-label={`Delete ${label?r.name:r.title}`} onClick={()=>change(()=>adapter[label?'deleteLabel':'deleteMilestone'](projectId,r.uid))}>Delete</button></>}
    </li>)}</ul>
    {canManage && <form onSubmit={(e)=>{e.preventDefault();if(!title.trim())return;const payload=label?{name:title.trim(),color}:{title:title.trim(),due_on:due || null,state};
      change(()=>edit?adapter[label?'updateLabel':'updateMilestone'](projectId,edit,payload):adapter[label?'createLabel':'createMilestone'](projectId,payload));}} className="space-y-2">
      <label className="block">{label?'Label name':'Milestone title'}<input aria-label={label?'Label name':'Milestone title'} maxLength={label?80:120} required value={title} onChange={(e)=>setTitle(e.target.value)} className="block w-full rounded border p-2 dark:bg-gray-900 dark:border-gray-700" /></label>
      {label?<label>Color <select aria-label="Label color" value={color} onChange={(e)=>setColor(e.target.value)} className="dark:bg-gray-900">{LABEL_COLORS.map((c)=><option key={c}>{c}</option>)}</select></label>
        :<><label>Due date <input aria-label="Milestone due date" type="date" value={due} onChange={(e)=>setDue(e.target.value)} className="dark:bg-gray-900" /></label>
          <label>State <select aria-label="Milestone state" value={state} onChange={(e)=>setState(e.target.value)} className="dark:bg-gray-900"><option value="open">Open</option><option value="closed">Closed</option></select></label></>}
      <button type="submit" disabled={busy || !title.trim()} className={BTN_PRIMARY}>{edit?`Save ${singular}`:`Create ${singular}`}</button>
      {edit && <button type="button" className={BTN_SECONDARY} onClick={()=>{setEdit(null);setTitle('');}}>Cancel edit</button>}
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
export default function WorkSettings({ projectId, canManage, adapter=workAdapter }) {
  return <div><Catalogue projectId={projectId} kind="labels" canManage={canManage} adapter={adapter} /><Catalogue projectId={projectId} kind="milestones" canManage={canManage} adapter={adapter} /></div>;
}

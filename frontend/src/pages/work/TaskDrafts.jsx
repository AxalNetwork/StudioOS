// D1614 W7 part 2 (#4419): Triage shows proposals before any task exists.
import React, { useEffect, useState } from 'react';
import { Sheet } from '../../ui';
import TaskDraft from './TaskDraft.jsx';
import { workAdapter } from './workAdapter.js';
import { BTN_TEXT } from '../team/teamUi.jsx';
export default function TaskDrafts({ projectId, canManage, onChanged, adapter=workAdapter }) {
  const [read,setRead]=useState({status:'loading'}),[selected,setSelected]=useState(null);
  useEffect(()=>{let live=true;setSelected(null);setRead({status:'loading'});
    adapter.drafts(projectId).then((r)=>{if(live)setRead(r.available?{status:'ready',rows:r.data?.drafts || []}:{status:'off',reason:r.reason});},()=>{if(live)setRead({status:'error'});});return()=>{live=false;};},[adapter,projectId]);
  const changed=(task)=>{setRead((old)=>({...old,rows:old.rows.filter((r)=>r.uid!==selected.uid)}));setSelected(null);onChanged?.(task);};
  return <section aria-label="Agent task drafts">
    {read.status==='loading'&&<p>Reading drafts…</p>}
    {read.status==='off'&&<p>{read.reason}</p>}
    {read.status==='error'&&<p role="alert">Agent drafts could not be read.</p>}
    {read.rows?.map((d)=><button key={d.uid} type="button" className={`${BTN_TEXT} block w-full text-left`} onClick={()=>setSelected(d)}>Agent draft · {d.title || 'Unreadable title'}</button>)}
    {selected&&<Sheet title="Agent draft" width={560} onClose={()=>setSelected(null)} testId="work-draft-sheet">
      <TaskDraft key={selected.uid} draft={selected} projectId={projectId} canManage={canManage} onChanged={changed} adapter={adapter}/>
    </Sheet>}
  </section>;
}

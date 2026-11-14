// D4423 (#4423): HQ prepares the opt-in cohort; this card enables no switches.
import React, { useEffect, useState } from 'react';
import { Card } from '../../../ui';
import { adminAiAgentsApi } from '../../../lib/api/adminAiAgents';
const FIELD='w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BTN='rounded-lg border border-axal-hairline px-3 py-2 text-[12.5px] font-semibold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:text-gray-200';
export default function CohortCard({ api=adminAiAgentsApi }) {
  const [entries,setEntries]=useState(null),[email,setEmail]=useState(''),[more,setMore]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const apply=(r)=>{if(!Array.isArray(r?.entries))throw new Error('Unreadable');setEntries(r.entries);setMore(r.has_more===true);};
  useEffect(()=>{let live=true;api.cohort().then((r)=>{if(live){try{apply(r);}catch{setError('The cohort could not be read.');}}},()=>{if(live)setError('The cohort could not be read.');});return()=>{live=false;};},[api]);
  const change=async(fn)=>{if(busy)return;setBusy(true);setError('');try{await fn();setEmail('');apply(await api.cohort());}catch(e){setError(e?.data?.message || e?.message || 'The cohort change could not be saved.');}finally{setBusy(false);}};
  return <Card className="space-y-3 px-4 py-4" data-testid="agent-cohort-card">
    <h2 className="text-[14px] font-extrabold text-axal-ink dark:text-gray-100">Cohort</h2>
    <p className="text-[12.5px] text-axal-muted dark:text-gray-400">Opt-in founders selected by HQ. Membership does not switch agents on.</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e)=>{e.preventDefault();if(email.trim())change(()=>api.addCohort(email.trim()));}}>
      <label className="min-w-0 flex-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">Founder email<input aria-label="Founder email" type="email" required maxLength={254} autoComplete="off" value={email} disabled={busy} onChange={(e)=>setEmail(e.target.value)} className={FIELD} /></label>
      <button type="submit" className={BTN} disabled={busy || !email.trim()}>Add to cohort</button>
    </form>
    {entries===null&&!error&&<p role="status">Reading the cohort…</p>}
    {entries?.length===0&&<p>No cohort members yet.</p>}
    <ul className="space-y-2">{entries?.map((r)=><li key={r.uid} className="flex items-center justify-between gap-2 text-[13px] text-axal-ink dark:text-gray-200">
      <span>{r.name || 'Name not recorded'} · {r.kind==='user'?'Founder':r.kind==='company'?'Company':'Project'}</span>
      <button type="button" className={BTN} aria-label={`Remove ${r.name || 'cohort member'}`} disabled={busy} onClick={()=>change(()=>api.removeCohort(r.uid))}>Remove</button>
    </li>)}</ul>
    {more&&<p role="status">Only the first 1,000 entries are shown.</p>}
    {error&&<p role="alert" className="text-[13px] text-red-700 dark:text-red-300">{error}</p>}
  </Card>;
}

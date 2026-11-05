// D4487: venture-scoped Campaigns read, honest filters/attention rows and the URL detail sheet.
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cyclesWrite } from '../../../lib/api/cycles.js';
import CampaignCard from './CampaignCard.jsx';
import CampaignSheet from './CampaignSheet.jsx';
import { STATE, campaignPath, dateLabel, number, sortCampaigns } from './campaignModel.js';
const readWritePermission=projectId=>cyclesWrite.formOptions('grow',projectId,'distribution',{campaign:'permission'});
export function CampaignsList({read,status='all',query='',onStatus,onQuery,search=''}) {
  if(read.state==='loading')return <div className="cm-grid" role="status" aria-label="Loading campaigns">{[1,2,3].map(n=><div key={n} className="cm-card cm-skeleton"/>)}<span className="sr-only">Loading campaigns…</span></div>;
  if(read.state!=='ready')return <p role="alert">Unreadable: campaigns could not be read.</p>;
  const rows=sortCampaigns(read.campaigns||[]),all=read.counts?.all;
  return <div className="cm-root cm-stack">
    {rows.some(c=>!c.utm_campaign||(c.status==='paused'&&c.budget_used_pct>=100))&&<section className="cm-card"><h2>Needs you</h2>{rows.flatMap(c=>[!c.utm_campaign?{tag:'UTM',text:`${c.name} has no UTM tag, so its leads are not counted.`,action:'Add a UTM tag',step:'channels'}:null,c.status==='paused'&&c.budget_used_pct>=100?{tag:'BUDGET',text:`${c.name} is paused: its budget was reached. Date: ${dateLabel(c.budget_reached_at)}.`,action:'Change the budget',step:'budget'}:null].filter(Boolean).map(n=><div className="cm-needs-row" key={`${c.uid}:${n.tag}`}><span className="cm-tag">{n.tag}</span><p>{n.text}</p><Link className="cm-button" to={`${campaignPath('new',search)}${search?'&':'?'}edit=${encodeURIComponent(c.uid)}&step=${n.step}`}>{n.action}</Link></div>))}</section>}
    <div className="cm-filters"><div role="radiogroup" aria-label="Campaign status">{[['all','All'],...Object.entries(STATE).map(([key,state])=>[key,state.label])].map(([key,label])=><button type="button" key={key} className="cm-button" role="radio" aria-checked={status===key} onClick={()=>onStatus?.(key)}>{label} · {number(read.counts?.[key])}</button>)}</div><label className="cm-search"><span className="sr-only">Search campaigns</span><input className="cm-input" type="search" placeholder="Search campaigns" value={query} onChange={e=>onQuery?.(e.target.value)}/></label></div>
    {!rows.length?<section className="cm-card cm-empty"><h2>{all===0?'No campaigns yet.':'No campaigns match.'}</h2><p className="cm-muted">{all===0?'A campaign groups your channels, audience, budget and posts toward one goal.':'Try another status or search.'}</p>{all===0&&<Link className="cm-primary" to={campaignPath('new',search)}>+ New campaign</Link>}</section>:<div className="cm-grid">{rows.map(c=><CampaignCard key={c.uid} campaign={c} search={search}/>)}</div>}
  </div>;
}
export default function CampaignsTab({projectId,role,search='',campaignUid,api=cyclesWrite.grow,readPermission=readWritePermission}) {
  const navigate=useNavigate();const [status,setStatus]=useState('all'),[query,setQuery]=useState(''),[tick,setTick]=useState(0),[read,setRead]=useState({state:'loading'}),[permission,setPermission]=useState({state:'loading',can_write:false});
  useEffect(()=>{let live=true;setPermission({state:'loading',can_write:false});if(projectId)readPermission(projectId).then(data=>{if(live)setPermission(typeof data?.can_write==='boolean'?{state:'ready',can_write:data.can_write}:{state:'unreadable',can_write:false});},()=>{if(live)setPermission({state:'unreadable',can_write:false});});return()=>{live=false;};},[projectId,readPermission,tick]);
  useEffect(()=>{let live=true;setRead({state:'loading'});if(!projectId)return()=>{live=false;};const timer=setTimeout(()=>{api.campaigns(projectId,{status,q:query}).then(data=>{if(live)setRead({state:'ready',...data});},()=>{if(live)setRead({state:'unreadable'});});},query?180:0);return()=>{live=false;clearTimeout(timer);};},[projectId,status,query,tick,api]);
  return <div className="cm-root"><CampaignsList read={read} status={status} query={query} onStatus={setStatus} onQuery={setQuery} search={search}/>{(read.state==='unreadable'||permission.state==='unreadable')&&<button className="cm-button" onClick={()=>setTick(v=>v+1)}>Try again</button>}{campaignUid&&<CampaignSheet key={`${projectId}:${campaignUid}`} projectId={projectId} uid={campaignUid} role={role} canWrite={permission.can_write} permissionState={permission.state} search={search} api={api} onClose={()=>navigate(campaignPath('',search))} onChanged={()=>setTick(v=>v+1)}/>}</div>;
}

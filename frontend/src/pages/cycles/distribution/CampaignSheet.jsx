// D4487: the campaign's 480px detail and its explicit Archive/End confirmations.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../../ui/Sheet.jsx';
import Lightbox from '../../../ui/Lightbox.jsx';
import { cyclesWrite } from '../../../lib/api/cycles.js';
import { CampaignPill } from './CampaignCard.jsx';
import { READER_NOTE, campaignPath, dateLabel, dateRange, funnelValue, goalLabel, mayWrite, money, transitions } from './campaignModel.js';
import { campaignRefusal } from './campaignPlan.js';
export function CampaignConfirm({kind,name,busy=false,error,onClose,onConfirm}) {
  const end=kind==='end';
  return <Lightbox title={`${end?'End':'Archive'} ${name}?`} onClose={busy?()=>{}:onClose} width={480} testId="campaign-confirm"
    footer={<div className="cm-row"><button className="cm-button" disabled={busy} onClick={onClose}>Cancel</button><button className="cm-primary" disabled={busy} onClick={onConfirm}>{busy?'Saving…':end?'End campaign':'Archive'}</button></div>}>
    <div className="cm-root cm-confirm"><p>{end?'Ended campaigns can’t be restarted. Its results and links are kept.':'It leaves this list; its links are kept.'}</p>{error&&<p role="alert" className="cm-error">{error}</p>}</div>
  </Lightbox>;
}
export function CampaignDetail({campaign,role,canWrite,permissionState='ready',search='',busy=false,onTransition,onArchive,onRemoveChannel,onUnlink}) {
  const [menu,setMenu]=useState(false); const write=typeof canWrite==='boolean'?canWrite:mayWrite(role);
  return <div className="cm-root cm-detail">
    <div className="cm-row"><div className="cm-row"><span className="cm-goal">{goalLabel(campaign.goal)}</span><CampaignPill status={campaign.status}/></div>
      <div className="cm-row">{transitions(campaign.status).map(t=><button key={t.status} className={t.status==='active'?'cm-primary':'cm-button'} disabled={!write||busy} onClick={()=>onTransition?.(t.status)}>{t.label}</button>)}
        <button className="cm-button" aria-label="More: Edit, Archive" aria-expanded={menu} disabled={!write||busy} onClick={()=>setMenu(v=>!v)}>⋯</button></div></div>
    {!write&&<p className="cm-notice" role="status">{permissionState==='loading'?'Checking permission to change campaigns…':permissionState==='unreadable'?'Unreadable: permission to change campaigns could not be read.':READER_NOTE}</p>}
    {campaign.status==='ended'&&<p className="cm-muted">Ended campaigns can’t be restarted.</p>}
    {menu&&write&&<div className="cm-menu"><Link className="cm-button" to={`${campaignPath('new',search)}${search?'&':'?'}edit=${encodeURIComponent(campaign.uid)}`}>Edit</Link><button className="cm-button" disabled={busy} onClick={onArchive}>Archive</button></div>}
    <section className="cm-section"><h2>Dates and audience</h2><dl className="cm-detail-list"><dt>Dates</dt><dd className="cm-mono">{dateRange(campaign)}</dd><dt>Audience</dt><dd>{campaign.audience_kind==='none'?'No segment':campaign.audience_kind==='import'?'An imported list':campaign.segment?.name||'Not recorded'}</dd><dt>UTM tag</dt><dd className="cm-mono">{campaign.utm_campaign||'Not recorded'}</dd></dl></section>
    <section className="cm-section"><h2>Channels</h2>{(campaign.channels||[]).map(c=><div key={c.uid} className="cm-item-row"><div><strong>{c.name||'Not recorded'}</strong><p className="cm-muted">Planned {money(c.planned_budget_cents)} · Spent {c.spend_cents==null?'Not recorded':money(c.spend_cents)}</p></div><button className="cm-button" disabled={!write||busy} onClick={()=>onRemoveChannel?.(c.uid)}>Remove</button></div>)}{!campaign.channels?.length&&<p className="cm-muted">No channels linked.</p>}</section>
    <section className="cm-section"><h2>Linked pieces and drafts</h2>{(campaign.linked_items||[]).map(item=><div key={`${item.kind}:${item.uid}`} className="cm-item-row"><div><strong>{item.title||'Not recorded'}</strong><p className="cm-muted">{item.channel?.name||'Not recorded'} · {item.status||'Not recorded'}</p></div><button className="cm-button" disabled={!write||busy} onClick={()=>onUnlink?.(item)}>Unlink</button></div>)}{!campaign.linked_items?.length&&<p className="cm-muted">No pieces or drafts linked.</p>}</section>
    <section className="cm-section"><h2>Results</h2><dl className="cm-funnel">{['leads','demos','customers'].map(key=><div key={key}><dt>{key[0].toUpperCase()+key.slice(1)}</dt><dd>{campaign.utm_campaign?funnelValue({...campaign,status:'active'},key):'Not recorded'}</dd></div>)}</dl><p className="cm-muted">{campaign.utm_campaign?<>From contacts tagged <span className="cm-mono">{campaign.utm_campaign}</span> and their status.</>:'Not recorded: no UTM campaign tag'}</p></section>
  </div>;
}
export default function CampaignSheet({projectId,uid,role,canWrite=false,permissionState='ready',search='',onClose,onChanged,api=cyclesWrite.grow}) {
  const [read,setRead]=useState({state:'loading'}),[tick,setTick]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(null);
  useEffect(()=>{let live=true;setRead({state:'loading'});api.campaignDetail(projectId,uid).then(data=>{if(live)setRead({state:'ready',row:data.campaign??data});},()=>{if(live)setRead({state:'unreadable'});});return()=>{live=false;};},[projectId,uid,tick,api]);
  const mutate=async action=>{if(!canWrite||busy)return;setBusy(true);setError('');try{await action();setConfirm(null);setTick(v=>v+1);onChanged?.();}catch(e){setError(campaignRefusal(e));}finally{setBusy(false);}};
  const row=read.row;
  return <Sheet title={row?.name||'Campaign'} sub={row?`Campaign · created ${dateLabel(row.created_at)} by ${row.created_by||'Not recorded'}`:undefined} width={480} onClose={onClose} testId="campaign-sheet">
    {read.state==='loading'?<p role="status" className="cm-detail">Loading campaign…</p>:read.state==='unreadable'?<div className="cm-detail"><p role="alert">Unreadable: the campaign could not be read.</p><button className="cm-button" onClick={()=>setTick(v=>v+1)}>Try again</button></div>:<>
      {error&&!confirm&&<p role="alert" className="cm-error cm-detail">{error}</p>}
      <CampaignDetail campaign={row} role={role} canWrite={canWrite} permissionState={permissionState} search={search} busy={busy} onTransition={status=>status==='ended'?setConfirm('end'):mutate(()=>api.campaignUpdate(projectId,uid,{status}))} onArchive={()=>setConfirm('archive')}
        onRemoveChannel={channel=>mutate(()=>api.campaignChannelRemove(projectId,uid,channel))} onUnlink={item=>mutate(()=>api.campaignItemRemove(projectId,uid,item.kind,item.uid))}/>
      {confirm&&<CampaignConfirm kind={confirm} name={row.name} busy={busy} error={error} onClose={()=>{setConfirm(null);setError('');}} onConfirm={()=>mutate(async()=>{if(confirm==='end')await api.campaignUpdate(projectId,uid,{status:'ended'});else{await api.campaignArchive(projectId,uid);onClose?.();}})}/>}</>}
  </Sheet>;
}

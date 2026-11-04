import React, { useEffect, useState } from 'react';
import { growAdsApi } from '../../../lib/api/growAds.js';
import { cyclesWrite } from '../../../lib/api/cycles.js';
import { GroupedColumns } from '../../../ui/Charts.jsx';
import { AskButtonView } from '../../../ui/AskButton.jsx';
import { Card, Chip, StatusNote, Table } from './DistributionParts.jsx';
import { AD_MONEY_BANNER, LATER_COPY, PLATFORMS, PLACEMENTS, sliderAmount, amountSlider, budgetTotal, chartMonths } from './adsModel.js';
import './ads.css';
const money = value => value == null ? 'Not set' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
const EMPTY_CREATIVES = Object.freeze([]);
const sourceName = source => source === 'mercury' ? 'Mercury' : 'Entered by hand';
export function SpendChart({ channel, campaign }) {
  const rows=chartMonths(channel,campaign);
  return <Card><h2>Spend per month · {channel.name}</h2><div>{[...new Set(channel.months.map(m=>m.source))].map(s=><Chip key={s}>{sourceName(s)}</Chip>)}</div>
    {channel.spend_reason && <p>{channel.spend_reason}</p>}
    <div role="img" aria-label={`Monthly spent and planned for ${channel.name}; missing months have no bars`}><GroupedColumns rows={rows} series={[{label:'Spent',tone:'violet'},{label:'Planned',tone:'muted'}]} /></div>
    <p>Spent · Planned (lifetime amount, not a monthly allocation)</p>
    {rows.filter(r=>r.blank).map(r=><p key={r.label}>{r.note}</p>)}
    <details><summary>View as table</summary><Table label="Monthly spend" columns={[{key:'month',label:'Month'},{key:'spent',label:'Spent'},{key:'source',label:'Source'}]}>{rows.map(r=><tr key={r.label}><td>{r.label}</td><td>{r.blank ? 'Not recorded' : money(r.values[0]*100)}</td><td>{r.source ? sourceName(r.source) : 'Not recorded'}</td></tr>)}</Table></details>
  </Card>;
}
export function AdsContent({ data, onSaveBudget, creatives=EMPTY_CREATIVES, onSaveCreative, onAskCreatives, aiOff=false, busy=false }) {
  const [channels,setChannels]=useState(data.channels);
  const [texts,setTexts]=useState(Object.fromEntries(creatives.map(c=>[`${c.placement}:${c.field}`,c.text])));
  useEffect(()=>{setChannels(data.channels);setTexts(Object.fromEntries(creatives.map(c=>[`${c.placement}:${c.field}`,c.text])));},[data,creatives]);
  const update=(uid,patch)=>setChannels(all=>all.map(c=>c.uid===uid ? {...c,...patch}:c));
  const campaign=data.campaign, disabled=!data.can_write||busy;
  return <div className="ads-grid"><div className="ads-column">
    <Card><h2>Budget planner · {campaign.name}</h2><p>A plan only. Each platform charges your own account.</p>
      {channels.length===0 && <p>Not recorded: no paid channels in this campaign.</p>}
      {channels.map(c=><fieldset key={c.uid} disabled={disabled}><legend>{c.name}</legend>
        <div role="group" aria-label={`${c.name} budget type`}>{['daily','lifetime'].map(type=><button type="button" aria-pressed={c.budget_type===type} key={type} onClick={()=>update(c.uid,{budget_type:type})}>{type==='daily'?'Daily':'Lifetime'}</button>)}</div>
        <label>Budget share<input type="range" aria-label={`${c.name} budget share`} min="0" max="100" value={amountSlider(c.planned_budget_cents,campaign.budget_cents)} disabled={disabled||campaign.budget_cents==null} onChange={e=>update(c.uid,{planned_budget_cents:sliderAmount(e.target.value,campaign.budget_cents)})} /></label>
        <label>Amount in dollars<input type="number" min="0" step="0.01" value={c.planned_budget_cents==null?'':c.planned_budget_cents/100} onChange={e=>update(c.uid,{planned_budget_cents:e.target.value===''?null:Math.round(Number(e.target.value)*100)})} /></label>
        <span className="ads-mono">{money(c.planned_budget_cents)}{c.budget_type==='daily'?' a day':''}</span> <Chip>{c.budget_type==='daily'?'Daily':c.budget_type==='lifetime'?'Lifetime':'Not set'}</Chip>
        <label>Start<input type="date" value={c.starts_on||''} onChange={e=>update(c.uid,{starts_on:e.target.value||null})} /></label><label>End<input type="date" value={c.ends_on||''} onChange={e=>update(c.uid,{ends_on:e.target.value||null})} /></label>
        <button type="button" onClick={()=>onSaveBudget(c)}>Save budget</button>
      </fieldset>)}
      <p className="ads-mono">{campaign.starts_on||'Not set'} – {campaign.ends_on||'Not set'}</p>
      <p>{money(budgetTotal(channels))} of {money(campaign.budget_cents)} campaign budget</p>
      {channels.some(c=>c.budget_type==='daily')&&<p>Daily amounts are per day; this sum is not a lifetime commitment.</p>}
    </Card>
    <Card><h2>Targeting</h2><p>{data.targeting||'Not recorded: no audience segment'}</p><p>Estimated reach is an estimate from each platform.</p><p>Not recorded: no ad account connected</p></Card>
    <Card><h2>Rules <Chip>Later</Chip></h2><p>{LATER_COPY}</p><ul><li>Create and edit ads from here</li><li>Pause a channel from here</li><li>Rules, such as “Pause if cost per lead &gt; $50”</li></ul></Card>
  </div><div className="ads-column">
    {data.channels.filter(c=>c.budget_reached).map(c=><StatusNote tone="warn" key={c.uid}>{campaign.name} reached its {c.name} budget. Check the platform; no pause is performed here.</StatusNote>)}
    {data.channels.map(c=><SpendChart key={c.uid} channel={c} campaign={campaign} />)}
    <Card><h2>Connect your ad account to read spend and results</h2>{PLATFORMS.map(name=><div key={name}><h3>{name}</h3>{name==='YouTube'&&<p>Through your Google Ads account</p>}<Chip>Not offered yet</Chip><p>Waiting for the owner's decision on ad-platform access.</p></div>)}</Card>
    <Card><h2>Live performance</h2><p>Last 7 days · Leads from contacts tagged with UTM source. Clicks and seven-day spend are not recorded by a platform.</p><Table label="Live performance" columns={['Channel','Clicks','Leads','Spend','Cost/lead'].map(label=>({key:label,label}))}>{data.channels.map(c=><tr key={c.uid}><td>{c.name}</td><td>Not recorded</td><td>{c.leads??'Not recorded'} <Chip>Contacts · UTM source</Chip></td><td>Not recorded: monthly spend only</td><td>{c.cost_per_lead_reason}</td></tr>)}</Table></Card>
    <Card><h2>Creatives per placement</h2><p>One per placement. Accepted drafts join the campaign as drafts; nothing runs from here.</p>
      {PLACEMENTS.map(p=>{const key=`${p.key}:${p.field}`,text=texts[key]||'';return <div key={key}><label>{p.name}<textarea maxLength={2000} placeholder="Write it, or ask Eadwyn" value={text} disabled={disabled} onChange={e=>setTexts(t=>({...t,[key]:e.target.value}))} /></label>
        {!text&&<AskButtonView disabled={disabled||aiOff||!onAskCreatives} onClick={()=>onAskCreatives?.(p.key)} title={!onAskCreatives?'Creative proposals are not offered yet':undefined} />}
        <button type="button" disabled={disabled} onClick={()=>onSaveCreative(p,text)}>Save draft</button></div>;})}
      <p>Draft 4 creatives</p><AskButtonView disabled={disabled||aiOff||!onAskCreatives} onClick={()=>onAskCreatives?.()} sub={!onAskCreatives?'Creative proposals and their price quote are not offered yet.':null} />
    </Card>
  </div></div>;
}
export default function AdsTab({ projectId, aiOff=false, onAskCreatives }) {
  const [campaigns,setCampaigns]=useState([]),[uid,setUid]=useState(''),[data,setData]=useState(null),[creatives,setCreatives]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{let live=true;setCampaigns([]);setUid('');setData(null);setError('');if(projectId) cyclesWrite.grow.campaigns(projectId).then(r=>{if(live){setCampaigns(r.campaigns);setUid(r.campaigns[0]?.uid||'');}}).catch(()=>{if(live)setError('Unreadable: campaigns could not be read');});return()=>{live=false;};},[projectId]);
  useEffect(()=>{let live=true;setData(null);setError('');if(uid&&projectId) Promise.all([growAdsApi.read(projectId,uid),cyclesWrite.grow.campaignCreatives(projectId,uid)]).then(([d,c])=>{if(live){setData(d);setCreatives(c.creatives);}}).catch(()=>{if(live)setError('Unreadable: ads could not be read');});return()=>{live=false;};},[projectId,uid,revision]);
  const save=async run=>{setBusy(true);setError('');try{await run();setRevision(n=>n+1);}catch{setError('The draft could not be saved. Read it again and try once more.');}finally{setBusy(false);}};
  return <><StatusNote>{AD_MONEY_BANNER}</StatusNote><label>Campaign<select value={uid} onChange={e=>setUid(e.target.value)} disabled={busy}>{campaigns.map(c=><option key={c.uid} value={c.uid}>{c.name}</option>)}</select></label>
    {error&&<p role="alert">{error}</p>}{!uid&&!error&&<p>Choose or create a campaign to plan its ads.</p>}{uid&&!data&&!error&&<p role="status">Loading ads…</p>}
    {data&&<AdsContent key={`${projectId}:${uid}`} data={data} creatives={creatives} aiOff={aiOff} onAskCreatives={onAskCreatives} busy={busy}
      onSaveBudget={c=>save(()=>cyclesWrite.grow.campaignChannel(projectId,uid,c.uid,{planned_budget_cents:c.planned_budget_cents,budget_type:c.budget_type,starts_on:c.starts_on,ends_on:c.ends_on}))}
      onSaveCreative={(p,text)=>save(()=>cyclesWrite.grow.campaignCreative(projectId,uid,p.key,p.field,text))} />}</>;
}

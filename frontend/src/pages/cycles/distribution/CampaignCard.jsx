// D4487: a campaign card reads only recorded results, budgets and linked counts.
import React from 'react';
import { Link } from 'react-router-dom';
import { STATE, budgetLine, campaignPath, dateRange, funnelValue, goalLabel, goalMetric, number } from './campaignModel.js';
import './campaigns.css';
export function CampaignPill({status}) {const state=STATE[status];return <span className={`cm-pill is-${state?.tone||'muted'}`}><i aria-hidden="true"/>{state?.label||'Not recorded'}</span>;}
export default function CampaignCard({campaign,search=''}) {
  const state=STATE[campaign.status]; const needsTag=!campaign.utm_campaign;
  return <article className={`cm-card cm-campaign ${campaign.status==='ended'?'is-ended':''}`} style={{borderLeftColor:state?.edge}} data-testid={`campaign-${campaign.uid}`}>
    {campaign.warning && <p className="cm-warning">{campaign.warning}</p>}
    <div className="cm-row"><h2><Link to={campaignPath(campaign.uid,search)}>{campaign.name}</Link></h2><CampaignPill status={campaign.status}/></div>
    <div className="cm-row"><span className="cm-goal">{goalLabel(campaign.goal)}</span><span className="cm-mono cm-muted">{dateRange(campaign)}</span></div>
    <dl className="cm-funnel">{['leads','demos','customers'].map(key=><div key={key} data-emphasis={goalMetric(campaign.goal)===key?key:undefined}>
      <dt>{key==='leads'?'Leads':key==='demos'?'Demos':'Customers'}</dt><dd data-unrecorded={needsTag?'result':undefined}>{funnelValue(campaign,key)}</dd>
    </div>)}</dl>
    {needsTag && <p className="cm-muted">Not recorded: no UTM campaign tag<br/><Link className="cm-link" to={`${campaignPath('new',search)}${search?'&':'?'}edit=${encodeURIComponent(campaign.uid)}&step=channels`}>Add a UTM tag</Link></p>}
    <p className="cm-muted">{budgetLine(campaign)}</p>
    {Number.isFinite(campaign.budget_used_pct) && <div className={`cm-progress ${campaign.budget_used_pct>=100?'is-over':''}`} role="progressbar" aria-label="Budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100,Math.max(0,campaign.budget_used_pct))}><span style={{width:`${Math.min(100,Math.max(0,campaign.budget_used_pct))}%`}}/></div>}
    <footer className="cm-row"><span className="cm-chips">{(campaign.channels||[]).map(c=><span key={c.uid} className="cm-chip">{c.name||'Not recorded'}</span>)}</span><span className="cm-mono cm-muted">{number(campaign.items?.content)} pieces · {number(campaign.items?.drafts)} in draft</span></footer>
  </article>;
}

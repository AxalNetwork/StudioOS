// D4484: Distribution's shared module frame; campaign tabs read no data here.
import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { DistributionAskHeader } from './WaitingForYou.jsx';
import useAiBudget from '../../../hooks/useAiBudget.js';
import { ADD_TOKENS_PATH } from '../../../lib/aiTokens.js';
import { DISTRIBUTION_TABS, distributionPath, distributionAskState } from './distributionModel.js';
import { LoadingSkeleton } from './DistributionParts.jsx';
import './distribution.css';
export function DistributionAsk({ projectId,campaignUid,onAccept,aiOff = false }) {
  const reading = useAiBudget();
  const state = distributionAskState(aiOff, reading);
  const title = state === 'off' ? 'AI is switched off. Everything manual still works.' : state === 'out' ? 'Not enough AI tokens' : undefined;
  return <DistributionAskHeader projectId={projectId} campaignUid={campaignUid} onAccept={onAccept} state={state} title={title}
    sub={state==='out' ? <a href={ADD_TOKENS_PATH} className="underline">Add tokens</a> : null} />;
}
export default function DistributionTabs({ tab = 'overview', projectId, search = '', action, inboxCount = null, loading = false, aiOff = false, children }) {
  const refs = useRef([]);
  const active = DISTRIBUTION_TABS.find((t)=>t.key===tab) || DISTRIBUTION_TABS[0];
  const move = (event,index) => {
    const last=DISTRIBUTION_TABS.length-1;
    const next=event.key==='ArrowRight'?(index+1)%(last+1):event.key==='ArrowLeft'?(index+last)%(last+1):event.key==='Home'?0:event.key==='End'?last:null;
    if(next!=null){event.preventDefault();refs.current[next]?.focus();}
  };
  return <section className="distribution-shell" data-testid="distribution-shell">
    <header className="ds-header"><div><p className="ds-eyebrow">Grow · Distribution</p><h1>Distribution</h1><p className="ds-subtitle">Reach the customers your validation found, and see what turns into revenue.</p></div>
      <div className="ds-header-actions">{action && <Link className="ds-primary" to={action.href}>{action.label}</Link>}<DistributionAsk projectId={projectId} aiOff={aiOff} /></div>
    </header>
    <nav className="ds-tabs" aria-label="Distribution tabs" role="tablist">{DISTRIBUTION_TABS.map((t,index)=><Link key={t.key} ref={(el)=>{refs.current[index]=el;}} role="tab" id={`distribution-tab-${t.key}`} aria-controls="distribution-panel"
      aria-selected={t.key===active.key} aria-current={t.key===active.key?'page':undefined} tabIndex={t.key===active.key?0:-1} onKeyDown={(e)=>move(e,index)}
      to={distributionPath(t.key,search)}>{t.label}{t.key==='inbox'&&Number.isSafeInteger(inboxCount)&&inboxCount>=0 ? <span className="ds-count">{inboxCount}</span>:null}</Link>)}</nav>
    <div className="ds-body" role="tabpanel" id="distribution-panel" aria-labelledby={`distribution-tab-${active.key}`}>
      {loading ? <LoadingSkeleton label={active.label} /> : children}
    </div>
  </section>;
}

// D4484: Distribution's shared module frame; campaign tabs read no data here.
import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import HeaderAsk from '../../../ui/HeaderAsk.jsx';
import { useAuth } from '../../../hooks/useAuthSync.jsx';
import useAiBudget from '../../../hooks/useAiBudget.js';
import { ADD_TOKENS_PATH } from '../../../lib/aiTokens.js';
import { DISTRIBUTION_PAGE, DISTRIBUTION_TABS, distributionPath } from './distributionModel.js';
import DistributionStates from './DistributionStates.jsx';
import { distributionStates } from './distributionStates.js';
import useDistributionAccess from './useDistributionAccess.js';
import { useDistributionLayout } from './useDistributionLayout.js';
import { LoadingSkeleton } from './DistributionParts.jsx';
import './distribution.css';
function ConnectedDistributionAsk({ aiOff = false }) {
  const reading = useAiBudget();
  const model=distributionStates({aiOff,budgetReading:reading,canWrite:true});
  return <DistributionAsk model={model}/>;
}
export function DistributionAsk({aiOff=false,model}) {
  if(!model)return <ConnectedDistributionAsk aiOff={aiOff}/>;
  return <HeaderAsk page={DISTRIBUTION_PAGE} label="Distribution" testId="distribution-ask" state={model.ask.state} disabled={model.ask.disabled} title={model.ask.title} ariaLabel={model.ask.ariaLabel}
    sub={model.outOfTokens?<a href={ADD_TOKENS_PATH} className="underline">Add tokens</a>:null}/>;
}
export default function DistributionTabs({ tab = 'overview', search = '', action, inboxCount = null, loading = false, aiOff = false, projectId, role, children }) {
  const refs = useRef([]);
  const {user}=useAuth()||{};
  const raw=new URLSearchParams(search).get('project_id');
  const ventureId=projectId??(raw&&/^[1-9]\d*$/.test(raw)?Number(raw):null);
  const reading=useAiBudget(), permission=useDistributionAccess(ventureId);
  const {phone,tablet}=useDistributionLayout();
  const model=distributionStates({aiOff,budgetReading:reading,canWrite:permission.canWrite,role:role??user?.role});
  const active = DISTRIBUTION_TABS.find((t)=>t.key===tab) || DISTRIBUTION_TABS[0];
  const move = (event,index) => {
    const last=DISTRIBUTION_TABS.length-1;
    const next=event.key==='ArrowRight'?(index+1)%(last+1):event.key==='ArrowLeft'?(index+last)%(last+1):event.key==='Home'?0:event.key==='End'?last:null;
    if(next!=null){event.preventDefault();refs.current[next]?.focus();}
  };
  return <section className="distribution-shell" data-testid="distribution-shell" data-layout={phone?'phone':tablet?'tablet':'desktop'}>
    <header className="ds-header"><div><p className="ds-eyebrow">Grow · Distribution</p><h1>Distribution</h1><p className="ds-subtitle">Reach the customers your validation found, and see what turns into revenue.</p></div>
      <div className="ds-header-actions">{action && (model.manual.disabled?<button type="button" className="ds-primary" disabled title={model.manual.reason}>{action.label}</button>:<Link className="ds-primary" to={action.href}>{action.label}</Link>)}<DistributionAsk model={model} /></div>
    </header>
    <nav className="ds-tabs" aria-label="Distribution tabs" role="tablist">{DISTRIBUTION_TABS.map((t,index)=><Link key={t.key} ref={(el)=>{refs.current[index]=el;}} role="tab" id={`distribution-tab-${t.key}`} aria-controls="distribution-panel"
      aria-selected={t.key===active.key} aria-current={t.key===active.key?'page':undefined} tabIndex={t.key===active.key?0:-1} onKeyDown={(e)=>move(e,index)}
      to={distributionPath(t.key,search)}>{t.label}{t.key==='inbox'&&Number.isSafeInteger(inboxCount)&&inboxCount>=0 ? <span className="ds-count">{inboxCount}</span>:null}</Link>)}</nav>
    <div className="ds-body" role="tabpanel" id="distribution-panel" aria-labelledby={`distribution-tab-${active.key}`}>
      <DistributionStates model={model} onRetry={permission.retry}>{loading ? <LoadingSkeleton label={active.label} /> : children}</DistributionStates>
    </div>
  </section>;
}

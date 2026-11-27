// D4487: DS3's full-page six-step campaign planner; Schedule saves, never activates.
// D4496: the wizard takes Distribution's cross-tab states (reader, paused, out of tokens) and its phone layout.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import useAiBudget from '../../../hooks/useAiBudget.js';
import { distributionStates } from './distributionStates.js';
import DistributionStates, { DistributionReadError } from './DistributionStates.jsx';
import { useDistributionLayout } from './useDistributionLayout.js';
import { DistributionAsk } from './DistributionTabs.jsx';
import { cyclesWrite } from '../../../lib/api/cycles.js';
import { publishApi } from '../../../lib/api/publish.js';
import { ConsentSummaryView, reachableLabel, useProspectConsentSummary } from './ProspectConsentSummary.jsx';
import { CampaignStep } from './CampaignSteps.jsx';
import { READER_NOTE, STEPS, campaignPath, draftSaveReason, emptyDraft, firstReason, fromCampaign, stepReason } from './campaignModel.js';
import { campaignRefusal, saveCampaignPlan } from './campaignPlan.js';
import DistributionAskIntent from './DistributionAskIntent.jsx';
import CampaignDraftAsk from './CampaignDraftAsk.jsx';
import { acceptCampaignProposals } from './campaignAskModel.js';
import './campaigns.css';
/** The existing form-options route preserves venture and writer gates. */
export async function campaignOptions(projectId) {
  const data=await cyclesWrite.formOptions('grow',projectId,'distribution',{campaign:1});
  if(data?.can_write!==true||!['channels','segments','pieces','drafts'].every(key=>Array.isArray(data?.[key])))throw new Error('campaign_options_unreadable');
  return data;
}
/** D4496: when the selectors are refused, the venture's own permission read says whether this is a reader or an unreadable read. */
export const campaignPermission=projectId=>cyclesWrite.formOptions('grow',projectId,'distribution',{campaign:'permission'});
export function CampaignWizard({draft,step,onChange,onStep,onSave,onCancel,busy=false,error='',notice='',options={},readOnly=false,search='',projectId,campaignUid,onAccept,fieldAskSlot,assetsAskSlot,consentSlot,aiOff=false,model=null}) {
  const {phone}=useDistributionLayout();
  // D4496: a write the state refuses is disabled with its reason; Ask follows the state, manual work does not.
  const blocked=model?.manual.disabled?model.manual.reason:null, askOff=aiOff||Boolean(model?.ask.disabled);
  const progress=useRef(null);
  useEffect(()=>{progress.current?.scrollIntoView?.({block:'nearest',inline:'center'});},[step]);
  const reason=blocked||(step===5?firstReason(draft):stepReason(step,draft)),saveReason=blocked||draftSaveReason(draft),editing=Boolean(draft.status&&draft.status!=='draft');
  return <div className="cm-root cm-editor dark:text-gray-200" data-testid="new-campaign-page" data-layout={phone?'phone':undefined}>
    {phone&&<Link className="cm-link cm-phone-back" to={campaignPath('',search)} data-testid="new-campaign-back">‹ Campaigns</Link>}
    <header className="cm-editor-header cm-row"><div><p className="cm-eyebrow">Grow · Distribution · {editing?'Edit campaign':'New campaign'}</p><h1>{draft.name||'New campaign'}</h1></div><div className="cm-row"><button type="button" className="cm-button" disabled={busy||readOnly||Boolean(saveReason)} onClick={()=>onSave?.(false)}>{editing?'Save changes':'Save draft'}</button>{model?<DistributionAsk model={model} projectId={projectId} campaignUid={campaignUid} onAccept={onAccept}/>:<DistributionAsk canWrite={!readOnly} projectId={projectId} campaignUid={campaignUid} onAccept={onAccept} aiOff={aiOff}/>}{saveReason&&<span className="cm-muted">{saveReason}</span>}</div></header>
    {model?<DistributionStates model={model}/>:readOnly&&<p className="cm-notice">{READER_NOTE}</p>}{error&&<p className="cm-error" role="alert">{error}</p>}{notice&&<p className="cm-notice" role="status">{notice}</p>}{draft.askUnsaved&&<p className="cm-notice" role="status">Not saved</p>}
    <div className="cm-wizard"><ol className="cm-steps" aria-label="Campaign steps">{STEPS.map((label,index)=><li key={label} ref={index===step?progress:null} className={index<step?'is-done':undefined} aria-current={index===step?'step':undefined}><span className="cm-step-number" aria-hidden="true">{index<step?'✓':index+1}</span>{label}</li>)}</ol>
      <section className="cm-card cm-step-body"><fieldset disabled={busy||readOnly} className="min-w-0 border-0 p-0 m-0"><CampaignStep step={step} draft={draft} onChange={onChange} options={options} search={search} readOnly={readOnly} fieldAskSlot={fieldAskSlot} assetsAskSlot={assetsAskSlot} consentSlot={consentSlot} aiOff={askOff}/></fieldset>
        <footer className="cm-footer" data-testid="new-campaign-footer"><button type="button" className="cm-button" disabled={busy} onClick={()=>step?onStep?.(step-1):onCancel?.()}>{step?'Back':'Cancel'}</button><div className="cm-footer-right"><button type="button" className="cm-primary" disabled={busy||readOnly||Boolean(reason)} onClick={()=>step===5?onSave?.(true):onStep?.(step+1)}>{busy?'Saving…':step===5?(editing?'Save changes':'Schedule'):'Continue'}</button>{reason&&<p className="cm-error" role="status">{reason}</p>}</div></footer>
      </section></div>
  </div>;
}
export default function NewCampaignPage({projectId,role,search='',api=cyclesWrite.grow,publish=publishApi,loadOptions=campaignOptions,readPermission=campaignPermission,askApi,assetsAskSlot,consentSlot,aiOff=false}) {
  const navigate=useNavigate(),[params]=useSearchParams();const edit=params.get('edit');
  const [draft,setDraft]=useState(emptyDraft),[step,setStep]=useState(0),[options,setOptions]=useState({}),[state,setState]=useState('loading'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const consent=useProspectConsentSummary(projectId,['icp','segment'].includes(draft.audience_kind)?draft.segment_id:null);
  const audienceConsent=draft.audience_kind==='import'||(['icp','segment'].includes(draft.audience_kind)&&!draft.segment_id)?{status:'ready',data:{available:false}}:consent;
  const journal=useRef({uid:null,links:[],assets:{}}),live=useRef(true);
  const [attempt,setAttempt]=useState(0),retry=useCallback(()=>setAttempt(n=>n+1),[]),budget=useAiBudget();
  // D4496: 'reader' is a recorded can_write:false, never inferred from a failed read.
  const model=distributionStates({aiOff,budgetReading:budget,canWrite:state==='ready'?options.can_write===true:state==='reader'?false:null,role});
  const identity=`${projectId}/${edit||''}`,scope=useRef(identity);scope.current=identity;
  const campaignUid=edit||journal.current.uid||null;
  const accept=rows=>{if(!live.current||scope.current!==identity)return;setDraft(current=>acceptCampaignProposals(current,rows,projectId,options,campaignUid));setNotice('');};
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  useEffect(()=>{let active=true;setState('loading');setDraft(emptyDraft());journal.current={uid:null,links:[],assets:{}};setStep(0);setBusy(false);setNotice('');setError('');Promise.all([loadOptions(projectId),edit?api.campaignDetail(projectId,edit):Promise.resolve(null)]).then(([choices,data])=>{
    if(!active)return;setOptions(choices);if(data){const row=data.campaign??data;setDraft(fromCampaign(row));journal.current={uid:row.uid,links:row.linked_items||[],assets:{}};setStep(params.get('step')==='channels'?2:params.get('step')==='budget'?3:0);}setState('ready');
  },()=>{if(!active)return;Promise.resolve().then(()=>readPermission(projectId)).then(p=>{if(active)setState(p?.can_write===false?'reader':'unreadable');},()=>{if(active)setState('unreadable');});});return()=>{active=false;};},[projectId,edit,api,loadOptions,readPermission,attempt]); // query step only chooses the initial editing position
  const save=async finish=>{
    if(options.can_write!==true||busy)return;const reason=finish?firstReason(draft):draftSaveReason(draft);if(reason){setError(reason);return;}
    setBusy(true);setError('');setNotice('');
    try{const uid=await saveCampaignPlan({projectId,draft,api,publish,journal:journal.current});if(live.current&&scope.current===identity){if(finish)navigate(campaignPath(uid,search));else {setNotice('Draft saved. Nothing is posted, sent or spent.');setDraft(current=>current===draft?{...current,askUnsaved:false}:current);}}}
    catch(e){if(live.current&&scope.current===identity){setError(campaignRefusal(e));if(journal.current.uid)setNotice('Some changes may already be saved. Retry here to finish.');if(e?.data?.field==='utm_campaign'){setDraft(d=>({...d,utm_conflict:true}));setStep(2);}}}
    finally{if(live.current&&scope.current===identity)setBusy(false);}
  };
  if(state==='loading')return <p role="status" className="cm-root cm-editor">Loading campaign choices…</p>;
  const back=<Link className="cm-link" to={campaignPath('',search)}>‹ Campaigns</Link>;
  if(state==='unreadable')return <div className="cm-root cm-editor dark:text-gray-200" data-testid="new-campaign-unreadable">{back}<DistributionReadError onRetry={retry}/></div>;
  if(state==='reader')return <div className="cm-root cm-editor dark:text-gray-200" data-testid="new-campaign-reader">{back}<DistributionStates model={model}/></div>;
  return <CampaignWizard model={model} draft={draft} step={step} options={{...options,reachableLabel:reachableLabel(audienceConsent)}} busy={busy} error={error} notice={notice} readOnly={options.can_write!==true} search={search} projectId={projectId} campaignUid={campaignUid} onAccept={accept} fieldAskSlot={aiOff||model.ask.disabled?null:({onClose})=><DistributionAskIntent projectId={projectId} campaignUid={edit||journal.current.uid} target="form" kinds={['campaign_fields']} now={{name:draft.name,goal:draft.goal,segment_id:draft.segment_id}} onAccept={accept} onClose={onClose} api={askApi}/>} onChange={next=>{setDraft(next);setNotice('');}} onStep={setStep} onSave={save} onCancel={()=>navigate(campaignPath('',search))} assetsAskSlot={typeof assetsAskSlot==='function'?assetsAskSlot({projectId,campaignUid:edit||journal.current.uid,draft,options,updateDraft:setDraft}):assetsAskSlot??<CampaignDraftAsk projectId={projectId} campaignUid={edit||journal.current.uid} draft={draft} onAccept={accept} api={askApi} disabled={aiOff||model.ask.disabled||options.can_write!==true||busy}/>} consentSlot={consentSlot??<ConsentSummaryView state={audienceConsent}/>} aiOff={aiOff}/>;
}

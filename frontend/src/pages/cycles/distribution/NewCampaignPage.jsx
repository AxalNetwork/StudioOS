// D4487: DS3's full-page six-step campaign planner; Schedule saves, never activates.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DistributionAsk } from './DistributionTabs.jsx';
import { cyclesWrite } from '../../../lib/api/cycles.js';
import { publishApi } from '../../../lib/api/publish.js';
import { ConsentSummaryView, reachableLabel, useProspectConsentSummary } from './ProspectConsentSummary.jsx';
import { CampaignStep } from './CampaignSteps.jsx';
import { READER_NOTE, STEPS, campaignPath, draftSaveReason, emptyDraft, firstReason, fromCampaign, stepReason } from './campaignModel.js';
import { campaignRefusal, saveCampaignPlan } from './campaignPlan.js';
import './campaigns.css';
/** The existing form-options route preserves venture and writer gates. */
export async function campaignOptions(projectId) {
  const data=await cyclesWrite.formOptions('grow',projectId,'distribution',{campaign:1});
  if(data?.can_write!==true||!['channels','segments','pieces','drafts'].every(key=>Array.isArray(data?.[key])))throw new Error('campaign_options_unreadable');
  return data;
}
export function CampaignWizard({draft,step,onChange,onStep,onSave,onCancel,busy=false,error='',notice='',options={},readOnly=false,search='',assetsAskSlot,consentSlot,aiOff=false}) {
  const progress=useRef(null);
  useEffect(()=>{progress.current?.scrollIntoView?.({block:'nearest',inline:'center'});},[step]);
  const reason=step===5?firstReason(draft):stepReason(step,draft),saveReason=draftSaveReason(draft),editing=Boolean(draft.status&&draft.status!=='draft');
  return <div className="cm-root cm-editor" data-testid="new-campaign-page">
    <header className="cm-editor-header cm-row"><div><p className="cm-eyebrow">Grow · Distribution · {editing?'Edit campaign':'New campaign'}</p><h1>{draft.name||'New campaign'}</h1></div><div className="cm-row"><button type="button" className="cm-button" disabled={busy||readOnly||Boolean(saveReason)} onClick={()=>onSave?.(false)}>{editing?'Save changes':'Save draft'}</button><DistributionAsk aiOff={aiOff}/>{saveReason&&<span className="cm-muted">{saveReason}</span>}</div></header>
    {readOnly&&<p className="cm-notice">{READER_NOTE}</p>}{error&&<p className="cm-error" role="alert">{error}</p>}{notice&&<p className="cm-notice" role="status">{notice}</p>}
    <div className="cm-wizard"><ol className="cm-steps" aria-label="Campaign steps">{STEPS.map((label,index)=><li key={label} ref={index===step?progress:null} className={index<step?'is-done':undefined} aria-current={index===step?'step':undefined}><span className="cm-step-number" aria-hidden="true">{index<step?'✓':index+1}</span>{label}</li>)}</ol>
      <section className="cm-card cm-step-body"><fieldset disabled={busy||readOnly} className="min-w-0 border-0 p-0 m-0"><CampaignStep step={step} draft={draft} onChange={onChange} options={options} search={search} readOnly={readOnly} assetsAskSlot={assetsAskSlot} consentSlot={consentSlot}/></fieldset>
        <footer className="cm-footer"><button type="button" className="cm-button" disabled={busy} onClick={()=>step?onStep?.(step-1):onCancel?.()}>{step?'Back':'Cancel'}</button><div className="cm-footer-right"><button type="button" className="cm-primary" disabled={busy||readOnly||Boolean(reason)} onClick={()=>step===5?onSave?.(true):onStep?.(step+1)}>{busy?'Saving…':step===5?(editing?'Save changes':'Schedule'):'Continue'}</button>{reason&&<p className="cm-error" role="status">{reason}</p>}</div></footer>
      </section></div>
  </div>;
}
export default function NewCampaignPage({projectId,search='',api=cyclesWrite.grow,publish=publishApi,loadOptions=campaignOptions,assetsAskSlot,consentSlot,aiOff=false}) {
  const navigate=useNavigate(),[params]=useSearchParams();const edit=params.get('edit');
  const [draft,setDraft]=useState(emptyDraft),[step,setStep]=useState(0),[options,setOptions]=useState({}),[state,setState]=useState('loading'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const consent=useProspectConsentSummary(projectId,['icp','segment'].includes(draft.audience_kind)?draft.segment_id:null);
  const audienceConsent=draft.audience_kind==='import'||(['icp','segment'].includes(draft.audience_kind)&&!draft.segment_id)?{status:'ready',data:{available:false}}:consent;
  const journal=useRef({uid:null,links:[],assets:{}}),live=useRef(true);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  useEffect(()=>{let active=true;setState('loading');Promise.all([loadOptions(projectId),edit?api.campaignDetail(projectId,edit):Promise.resolve(null)]).then(([choices,data])=>{
    if(!active)return;setOptions(choices);if(data){const row=data.campaign??data;setDraft(fromCampaign(row));journal.current={uid:row.uid,links:row.linked_items||[],assets:{}};setStep(params.get('step')==='channels'?2:params.get('step')==='budget'?3:0);}setState('ready');
  },()=>{if(active)setState('unreadable');});return()=>{active=false;};},[projectId,edit,api,loadOptions]); // query step only chooses the initial editing position
  const save=async finish=>{
    if(options.can_write!==true||busy)return;const reason=finish?firstReason(draft):draftSaveReason(draft);if(reason){setError(reason);return;}
    setBusy(true);setError('');setNotice('');
    try{const uid=await saveCampaignPlan({projectId,draft,api,publish,journal:journal.current});if(live.current){if(finish)navigate(campaignPath(uid,search));else setNotice('Draft saved. Nothing is posted, sent or spent.');}}
    catch(e){if(live.current){setError(campaignRefusal(e));if(journal.current.uid)setNotice('Some changes may already be saved. Retry here to finish.');if(e?.data?.field==='utm_campaign'){setDraft(d=>({...d,utm_conflict:true}));setStep(2);}}}
    finally{if(live.current)setBusy(false);}
  };
  if(state==='loading')return <p role="status" className="cm-root cm-editor">Loading campaign choices…</p>;
  if(state==='unreadable')return <p role="alert" className="cm-root cm-editor">Unreadable: the campaign choices could not be read.</p>;
  return <CampaignWizard draft={draft} step={step} options={{...options,reachableLabel:reachableLabel(audienceConsent)}} busy={busy} error={error} notice={notice} readOnly={options.can_write!==true} search={search} onChange={next=>{setDraft(next);setNotice('');}} onStep={setStep} onSave={save} onCancel={()=>navigate(campaignPath('',search))} assetsAskSlot={assetsAskSlot} consentSlot={consentSlot??<ConsentSummaryView state={audienceConsent}/>} aiOff={aiOff}/>;
}

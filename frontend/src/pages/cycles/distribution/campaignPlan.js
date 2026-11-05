// D4487: explicit manual saves to the existing campaign and Publish stores; never sends.
import { campaignBody, centsInput } from './campaignModel.js';
import { readRefusal } from '../../../lib/api.js';
export const campaignRefusal = error => readRefusal(error?.data).message || 'The campaign could not be saved. Try again.';
/** Retain saved identifiers after each successful request, so a partial save can retry safely. */
export async function saveCampaignPlan({projectId,draft,api,publish,journal,onProgress}) {
  const body=campaignBody(draft);
  if(!journal.uid) {
    const made=await api.campaign(projectId,body);
    journal.uid=made.uid??made.campaign?.uid;
    if(!journal.uid) throw new Error('Campaign read-back did not include a uid');
    onProgress?.({...journal});
  } else await api.campaignUpdate(projectId,journal.uid,body);
  for(const channel of draft.channels) await api.campaignChannel(projectId,journal.uid,channel.uid,{planned_budget_cents:centsInput(channel.amount),budget_type:channel.budget_type||null,starts_on:channel.starts_on||null,ends_on:channel.ends_on||null});
  const wanted=new Set(draft.links.map(item=>`${item.kind}:${item.uid}`));
  for(const item of journal.links||[]) if(!wanted.has(`${item.kind}:${item.uid}`)) {
    await api.campaignItemRemove(projectId,journal.uid,item.kind,item.uid);
    journal.links=journal.links.filter(row=>row.kind!==item.kind||row.uid!==item.uid);
    onProgress?.({...journal});
  }
  for(const item of draft.links) await api.campaignItem(projectId,journal.uid,{kind:item.kind,uid:item.uid});
  journal.links=[...draft.links];
  journal.assets??={};
  for(const [channel,asset] of Object.entries(journal.assets)) if(!draft.channels.some(c=>c.uid===channel)) {
    await api.campaignItemRemove(projectId,journal.uid,'publish_draft',asset.uid);
    delete journal.assets[channel];onProgress?.({...journal});
  }
  for(const channel of draft.channels) {
    const text=String(draft.assets?.[channel.uid]||'').trim();
    const existing=journal.assets[channel.uid];
    if(!text) {
      if(existing?.uid){await api.campaignItemRemove(projectId,journal.uid,'publish_draft',existing.uid);delete journal.assets[channel.uid];onProgress?.({...journal});}
      continue;
    }
    let uid=existing?.uid;
    if(uid)await publish.saveDraft(uid,{text});
    else {const saved=await publish.createDraft({project_id:projectId,module:'distribution',text});uid=saved.uid;journal.assets[channel.uid]={uid};onProgress?.({...journal});}
    await api.campaignItem(projectId,journal.uid,{kind:'publish_draft',uid});
  }
  return journal.uid;
}

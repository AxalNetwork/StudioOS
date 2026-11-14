/** D4488 (#4488): accepted form proposals place only selected text; money, dates and saved state stay manual. */
import { GOALS, utmSlug } from './campaignModel.js';
export const AD_PLACEMENTS=[['google_search_text','Google Search'],['youtube_16_9','YouTube 16:9'],['meta_feed_4_5','Meta Feed 4:5'],['x_promoted_post','X promoted post']];
export const AD_FIELDS=['headline','body','script'];
export const TEXT_FORMATS=[['post','Post'],['newsletter','Newsletter section'],['outreach_email','Outreach email'],['subject_line','Subject line'],['reply','Reply']];
/** Channel kind is recorded by the server; an unclassified channel needs an explicit format. */
export function assetRequests(channels,formats={}) {
  return channels.map(c=>{
    const choice=formats[c.uid]||{},kind=c.kind==='ads'?'ad_creative':({organic:'post',newsletter:'newsletter',outreach:'outreach_email'}[c.kind]||choice.kind);
    if(kind==='ad_creative')return AD_PLACEMENTS.some(([p])=>p===choice.placement)&&AD_FIELDS.includes(choice.field)?{kind,channel_uid:c.uid,placement:choice.placement,field:choice.field}:null;
    return TEXT_FORMATS.some(([k])=>k===kind)?{kind,channel_uid:c.uid}:null;
  });
}
export const creativeKey = p => `${p.placement}:${p.creative_field??p.field}`;
export function acceptCampaignProposals(draft,rows,projectId,options={},campaignUid=null) {
  let next=draft;
  for(const row of rows){
    const p=row.decided_payload??row.payload;
    if(!['accepted','edited'].includes(row.status)||p?.target!=='form'||p.project!==projectId||p.campaign_uid!==(campaignUid??null))continue;
    if(p.kind==='campaign_fields'){
      const values=p.values||{},change={};
      if(typeof values.name==='string'&&values.name.trim()&&values.name.length<=120){change.name=values.name;if(!next.utm_typed)change.utm_campaign=utmSlug(values.name);}
      if(GOALS.some(g=>g.key===values.goal))change.goal=values.goal;
      if(values.segment_id===null){change.segment_id='';change.audience_kind='none';}
      else if(values.segment_id!==undefined){const segment=options.segments?.find(s=>Number(s.id)===Number(values.segment_id));if(segment){change.segment_id=segment.id;change.audience_kind=segment.source==='icp_definition'?'icp':'segment';}}
      next={...next,...change};
    } else if(typeof p.text==='string'&&next.channels.some(c=>c.uid===p.channel_uid)){
      if(p.kind==='ad_creative'&&AD_PLACEMENTS.some(([v])=>v===p.placement)&&AD_FIELDS.includes(p.creative_field)){
        next={...next,creatives:{...next.creatives,[creativeKey(p)]:{channel_uid:p.channel_uid,placement:p.placement,field:p.creative_field,text:p.text}}};
      } else if(TEXT_FORMATS.some(([k])=>k===p.kind))next={...next,assets:{...next.assets,[p.channel_uid]:p.text}};
    }
  }
  return next===draft?draft:{...next,askUnsaved:true};
}

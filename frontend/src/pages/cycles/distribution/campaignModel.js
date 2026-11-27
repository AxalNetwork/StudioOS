// D4487: pure Campaigns presentation, wizard gates and draft-plan payloads.
export const GOALS = Object.freeze([
  {key:'awareness',label:'Awareness',note:'Reach and clicks'},
  {key:'signups',label:'Sign-ups',note:'Waitlist and trial sign-ups'},
  {key:'demos',label:'Demos',note:'Booked demos'},
  {key:'sales',label:'Sales',note:'Paying customers'},
]);
export const STEPS = ['Goal','Audience','Channels','Budget and dates','Assets','Schedule'];
export const STATE = Object.freeze({
  active:{label:'Active',edge:'#10b981',tone:'positive',order:0},
  draft:{label:'Draft',edge:'#a1a1aa',tone:'draft',order:1},
  paused:{label:'Paused',edge:'#f59e0b',tone:'amber',order:2},
  ended:{label:'Ended',edge:'#a1a1aa',tone:'muted',order:3},
});
export const SCHEDULE_NOTE = 'Saves a Draft plan. Nothing is posted, sent or spent. Press Activate on the campaign when you are ready; you still confirm every post.';
export const READER_NOTE = 'You can read this venture’s campaigns but not change them.';
export const mayWrite = role => role === 'founder' || role === 'admin';
export const goalLabel = key => GOALS.find(g=>g.key===key)?.label || 'Not recorded';
export const goalMetric = key => ({signups:'leads',demos:'demos',sales:'customers'}[key] || null);
export const sortCampaigns = rows => [...rows].sort((a,b)=>(STATE[a.status]?.order??4)-(STATE[b.status]?.order??4)||String(a.name).localeCompare(String(b.name)));
export const number = value => Number.isFinite(value) ? value.toLocaleString('en-GB') : 'Not recorded';
export const money = cents => Number.isSafeInteger(cents) ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:cents%100?2:0}).format(cents/100) : 'Not set';
export function dateLabel(value,year=false) {
  if(!/^\d{4}-\d{2}-\d{2}/.test(String(value||''))) return 'Not recorded';
  const day=new Date(`${String(value).slice(0,10)}T00:00:00Z`);
  return Number.isNaN(day.valueOf())?'Not recorded':day.toLocaleDateString('en-GB',{day:'numeric',month:'short',...(year?{year:'numeric'}:{}),timeZone:'UTC'});
}
export const dateRange = row => `${dateLabel(row.starts_on)} – ${dateLabel(row.ends_on,true)}`;
export function funnelValue(campaign,key) {
  if(!campaign.utm_campaign) return 'Not recorded';
  if(campaign.status==='draft') return campaign.starts_on ? `Starts ${dateLabel(campaign.starts_on)}` : 'Not recorded';
  return number(campaign[key]);
}
export function totalSpend(row) {
  if(!Array.isArray(row.channels)||!row.channels.length||row.channels.some(c=>!Number.isSafeInteger(c.spend_cents))) return null;
  return row.channels.reduce((sum,c)=>sum+c.spend_cents,0);
}
export function budgetLine(row) {
  if(row.budget_cents==null) return 'Budget Not set';
  if(row.status==='draft') return `Budget ${money(row.budget_cents)} · nothing spent yet`;
  const spent=totalSpend(row);
  return spent==null?`Budget used Not recorded of ${money(row.budget_cents)}`:`Budget used ${money(spent)} of ${money(row.budget_cents)}`;
}
export const transitions = status => ({draft:[{label:'Activate',status:'active'}],active:[{label:'Pause',status:'paused'}],paused:[{label:'Resume',status:'active'},{label:'End campaign',status:'ended'}],ended:[]}[status] || []);
export function utmSlug(name) {
  return String(name||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80).replace(/-$/,'');
}
export function centsInput(value) {
  if(value==null||value==='') return null;
  const text=String(value).trim();
  if(!/^\d+(\.\d{1,2})?$/.test(text)) return NaN;
  const [whole,fraction='']=text.split('.'); const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  return Number.isSafeInteger(cents)?cents:NaN;
}
function datesValid(row) {
  const real = value => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value);
  try { return real(row.starts_on)&&real(row.ends_on)&&(!row.starts_on||!row.ends_on||row.ends_on>=row.starts_on); } catch { return false; }
}
export function stepReason(step,draft) {
  if(step===0) return !String(draft.name||'').trim()?'Name your campaign':draft.name.length>120?'Keep the name to 120 characters':!GOALS.some(g=>g.key===draft.goal)?'Pick a goal':null;
  if(step===1) return !['icp','segment','import','none'].includes(draft.audience_kind)||(['icp','segment'].includes(draft.audience_kind)&&!draft.segment_id)?'Pick an audience, or No segment':null;
  if(step===2) return draft.utm_conflict||draft.utm_campaign.length>80||!/^[a-z0-9][a-z0-9_-]*$/.test(draft.utm_campaign||'')?'Choose another UTM tag':null;
  if(step===3) {
    if(!datesValid(draft)||(draft.channels||[]).some(c=>!datesValid(c))) return 'Fix the dates first';
    if(Number.isNaN(centsInput(draft.budget))||(draft.channels||[]).some(c=>Number.isNaN(centsInput(c.amount)))) return 'Use a valid budget amount';
  }
  return null;
}
export const firstReason = draft => [0,1,2,3].map(step=>stepReason(step,draft)).find(Boolean)||null;
export const draftSaveReason = draft => stepReason(0,draft)||stepReason(3,draft)||(draft.utm_conflict?'Choose another UTM tag':null)||(['icp','segment'].includes(draft.audience_kind)&&!draft.segment_id?'Pick an audience, or No segment':null);
/** The create route itself assigns Draft; sending status on POST is refused. */
export function campaignBody(draft) {
  return {name:String(draft.name||'').trim(),goal:draft.goal,starts_on:draft.starts_on||null,ends_on:draft.ends_on||null,budget_cents:centsInput(draft.budget),
    utm_campaign:draft.utm_campaign||null,audience_kind:draft.audience_kind||null,segment_id:['icp','segment'].includes(draft.audience_kind)?Number(draft.segment_id):null,channel_uids:(draft.channels||[]).map(c=>c.uid)};
}
export const campaignPath = (uid='',search='') => `/grow/distribution/campaigns${uid?`/${encodeURIComponent(uid)}`:''}${search?(String(search).startsWith('?')?'':'?')+search:''}`;
export function emptyDraft() { return {name:'',goal:'',audience_kind:'',segment_id:'',utm_campaign:'',utm_typed:false,budget:'',starts_on:'',ends_on:'',channels:[],assets:{},creatives:{},links:[]}; }
export function fromCampaign(row) {
  return {...emptyDraft(),...row,budget:row.budget_cents==null?'':String(row.budget_cents/100),segment_id:row.segment?.id??'',utm_campaign:row.utm_campaign||'',utm_typed:true,
    channels:(row.channels||[]).map(c=>({...c,amount:c.planned_budget_cents==null?'':String(c.planned_budget_cents/100)})),links:row.linked_items||[]};
}
export function reviewRows(draft,options={}) {
  const segment=options.segments?.find(s=>Number(s.id)===Number(draft.segment_id));
  const audience={icp:'ICP from Validate',segment:'A saved segment',import:'An imported list',none:'No segment'}[draft.audience_kind]||'Not recorded';
  return [['Goal',goalLabel(draft.goal)],['Audience',`${audience}${segment?` · ${segment.name}`:''}${draft.audience_kind!=='none'?` · ${options.reachableLabel??`${number(options.reachable)} reachable`}`:''}`],
    ['Channels',draft.channels.map(c=>c.name||'Not recorded').join(', ')||'Not recorded'],['Budget',draft.budget===''||draft.budget==null?'Not set':`${money(centsInput(draft.budget))} across ${draft.channels.length} channels · charged by each platform`],
    ['UTM tag',draft.utm_campaign||'Not recorded'],['Assets',`${Object.values(draft.creatives||{}).filter(c=>draft.channels.some(ch=>ch.uid===c.channel_uid)).length+(draft.links||[]).length+Object.values(draft.assets||{}).filter(t=>String(t).trim()).length} accepted · ${number(options.waiting)} waiting`],['Dates',dateRange(draft)]];
}

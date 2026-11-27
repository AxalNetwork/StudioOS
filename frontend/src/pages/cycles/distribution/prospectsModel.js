/** D4492: seven contact stages, safe card words and recorded marketing permission summaries. */
export const PROSPECT_COLUMNS=[['new','New'],['invited','Invited'],['contacted','Contacted'],['replied','Replied'],['qualified','Qualified'],['active','Active'],['passed','Passed']];
export const SOURCE_CHIPS=[['','All sources'],['import','Import'],['linkedin_csv','LinkedIn CSV'],['website','Website sign-up'],['lovable','Lovable sign-up'],['manual','Added by hand'],['update_ask','Update ask']];
export const CONSENT_CHOICES=[
  {value:'opted_in',label:'Opted in on a form',hint:'Keep the form and date as proof'},
  {value:'wrote_first',label:'Wrote to you first',hint:'Their message is the proof'},
  {value:'none',label:'No consent yet',hint:'Steps stay blocked until they agree'},
];
export const sourceLabel=value=>SOURCE_CHIPS.find(([key])=>key===value)?.[1]||'CRM';
export const nextProspectStatus=status=>PROSPECT_COLUMNS[PROSPECT_COLUMNS.findIndex(([key])=>key===status)+1]||null;
export const initials=name=>String(name||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
export function consentLine(state){
  const d=state?.status==='ready'?state.data:null;
  if(!d?.available||![d.email_reachable,d.opted_in?.whatsapp,d.opted_in?.sms,d.no_consent].every(Number.isFinite))return 'Consent: Not recorded';
  return `Consent: ${d.email_reachable} can be emailed · ${d.opted_in.whatsapp} opted into WhatsApp · ${d.opted_in.sms} into SMS · ${d.no_consent} have no consent recorded and are left out of messaging.`;
}
export const reachableLabel=state=>state?.status==='ready'&&state.data?.available&&Number.isFinite(state.data.email_reachable)?`${state.data.email_reachable} reachable`:'Not recorded';
export function prospectStatusLine(row,now=new Date()){
  if(row.due_date){const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;return row.due_date===today?'Follow-up due today':`Follow-up due ${row.due_date}`;}
  if(row.replied_at){const d=new Date(row.replied_at);if(Number.isFinite(d.getTime()))return `Replied · ${new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short'}).format(d)}`;}
  return PROSPECT_COLUMNS.find(([key])=>key===row.status)?.[1]||'Status not recorded';
}
/** The server's own bounded refusal sentence, never Error.message. */
export const prospectRefusal=(error,fallback='This could not be saved. Reload before trying again.')=>typeof error?.data?.detail==='string'?error.data.detail:fallback;

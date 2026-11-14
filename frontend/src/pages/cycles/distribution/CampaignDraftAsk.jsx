/** D4488 (#4488): wizard Assets Ask uses explicit channel formats and placements, then returns unsaved text. */
import { useState } from 'react';
import DistributionAskIntent from './DistributionAskIntent.jsx';
import { AD_FIELDS, AD_PLACEMENTS, TEXT_FORMATS, assetRequests } from './campaignAskModel.js';
import { BUTTON } from './WaitingForYou.jsx';
export default function CampaignDraftAsk({projectId,campaignUid,draft,onAccept,api,disabled=false}) {
  const [open,setOpen]=useState(false),[formats,setFormats]=useState({});
  const kinds=assetRequests(draft.channels,formats);
  const reason=!kinds.length?'Choose channels first.':kinds.some(k=>!k)?'Choose the format and placement for each channel.':kinds.length>8?'Draft up to eight channels at a time.':null;
  const choose=(uid,key,value)=>setFormats(f=>({...f,[uid]:{...f[uid],[key]:value}}));
  return <div className="cm-stack">
    {draft.channels.filter(c=>c.kind==='ads'||!['organic','newsletter','outreach'].includes(c.kind)).map(c=><div key={c.uid} className="cm-choices">{c.kind==='ads'?<><label className="cm-field">{c.name} placement<select className="cm-input" value={formats[c.uid]?.placement||''} disabled={disabled} onChange={e=>choose(c.uid,'placement',e.target.value)}><option value="">Choose placement</option>{AD_PLACEMENTS.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="cm-field">{c.name} text field<select className="cm-input" value={formats[c.uid]?.field||''} disabled={disabled} onChange={e=>choose(c.uid,'field',e.target.value)}><option value="">Choose text field</option>{AD_FIELDS.map(k=><option key={k} value={k}>{k}</option>)}</select></label></>:<label className="cm-field">{c.name} format<select className="cm-input" value={formats[c.uid]?.kind||''} disabled={disabled} onChange={e=>choose(c.uid,'kind',e.target.value)}><option value="">Choose format</option>{TEXT_FORMATS.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}</div>)}
    <button type="button" className={BUTTON} disabled={disabled||Boolean(reason)} onClick={()=>setOpen(true)}>Ask Eadwyn to draft for each channel</button>{reason&&<p className="cm-muted">{reason}</p>}
    {open&&!disabled?<DistributionAskIntent projectId={projectId} campaignUid={campaignUid} target="form" channelNames={Object.fromEntries(draft.channels.map(c=>[c.uid,c.name]))} kinds={kinds.filter(Boolean)} onAccept={onAccept} api={api} onClose={()=>setOpen(false)}/>:null}
  </div>;
}

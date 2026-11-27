/** D4496 (#4496): Distribution state selection from recorded permissions, reads and AI budget; never raw errors. */
import { distributionAskState } from './distributionModel.js';
import { hasTier } from '../../../sidebarConfig.js';
export const DISTRIBUTION_COPY = Object.freeze({
  off: 'AI is switched off. Everything manual still works.',
  offCaption: 'Ask is greyed; writing, scheduling and sending by hand still work.',
  paused: 'AI is paused for your studio',
  out: 'Not enough AI tokens',
  waitingOut: 'You are out of AI tokens. New proposals pause; the ones below stay. Add tokens to draft more.',
  advisor: 'You can read this venture’s campaigns but not change them.',
  admin: 'Read only: you are reading a founder’s record',
  adminAi: 'Eadwyn is off while you read a founder’s record.',
  permission: 'Write access could not be verified. Read it again before making changes.',
  readError: 'Couldn’t be read. This is not a claim that there are none.',
  formError: 'Unreadable: Eadwyn’s suggestions for this form could not be read. Type the values, or Try again',
});
const PROVIDERS = Object.freeze({ linkedin:'LinkedIn', meta:'Meta', x:'X', google:'Google', youtube:'YouTube' });
const PLAN_NAMES = Object.freeze({ growth:'Growth', studio:'Studio' });
export const PHONE_KPIS = Object.freeze(['leads','replies','cost_per_lead','spend_vs_budget']);
export const TABLET_KPIS = Object.freeze(['leads','cost_per_lead','spend_vs_budget']);
export const distributionKpis = width => width < 640 ? PHONE_KPIS : width < 1024 ? TABLET_KPIS : null;
/** A plan gate is drawn only when a real required tier was supplied by the caller, never from a design sample. */
export function distributionStates({ aiOff=false, budgetReading, running=false, canWrite=null, role, adminAccess=null, requiredTier=null, user=null, readState, formState, connection, campaign, consent, providerFailure }={}) {
  const locked=Object.hasOwn(PLAN_NAMES,requiredTier) && !hasTier(user,requiredTier);
  const readOnlyAdmin=role==='admin' && canWrite===false;
  const writeReason=locked ? `Campaigns and outreach are part of the ${PLAN_NAMES[requiredTier]} plan.` : readOnlyAdmin ? DISTRIBUTION_COPY.admin : canWrite===false ? DISTRIBUTION_COPY.advisor : canWrite!==true ? DISTRIBUTION_COPY.permission : null;
  const paused=budgetReading?.budget?.ai_paused===true;
  const base=distributionAskState(aiOff,budgetReading);
  const state=readOnlyAdmin||paused||aiOff ? 'off' : base==='out' ? 'out' : running ? 'running' : 'rest';
  const title=readOnlyAdmin?DISTRIBUTION_COPY.adminAi:paused?DISTRIBUTION_COPY.paused:aiOff?DISTRIBUTION_COPY.off:base==='out'?DISTRIBUTION_COPY.out:running?'Ask Eadwyn · busy':writeReason??undefined;
  const askDisabled=Boolean(writeReason)||state==='off'||state==='out'||running;
  const notes=[];
  if(writeReason)notes.push({key:'permission',tone:readOnlyAdmin?'amber':'info',text:writeReason});
  if(readOnlyAdmin)notes.push({key:'admin-ai',tone:'info',text:DISTRIBUTION_COPY.adminAi});
  else if(paused)notes.push({key:'paused',tone:'amber',text:`${DISTRIBUTION_COPY.paused}. Nothing else changes.`});
  else if(aiOff)notes.push({key:'off',tone:'info',text:DISTRIBUTION_COPY.offCaption});
  if(readState==='unreadable')notes.push({key:'read',tone:'negative',text:DISTRIBUTION_COPY.readError,retry:true});
  if(formState==='unreadable')notes.push({key:'form',tone:'info',text:DISTRIBUTION_COPY.formError,retry:true});
  if(connection?.key==='linkedin' && connection.status==='not_connected')notes.push({key:'connection',tone:'info',text:'LinkedIn is not connected. Connect it to schedule posts there.'});
  // Suspension is intentionally absent: the platform does not have an ad-account reader.
  if(campaign?.status==='paused' && Number.isFinite(campaign.budget_used_pct) && campaign.budget_used_pct>=100)notes.push({key:'budget',tone:'amber',text:`${campaign.name||'This campaign'} reached its budget and is paused.`});
  if(consent?.channel==='whatsapp' && consent.basis==='none')notes.push({key:'consent',tone:'amber',text:`Message blocked: ${consent.name||'this prospect'} has not opted into WhatsApp.`});
  if(providerFailure?.failed===true && Object.hasOwn(PROVIDERS,providerFailure.provider))notes.push({key:'provider',tone:'negative',text:`${PROVIDERS[providerFailure.provider]} did not answer. Nothing was posted.`,retry:true});
  return {manual:{disabled:Boolean(writeReason),reason:writeReason},ask:{state,disabled:askDisabled,title,ariaLabel:paused?'Ask Eadwyn, unavailable: AI is paused for your studio':undefined},notes,outOfTokens:base==='out'&&!paused&&!readOnlyAdmin&&!aiOff,locked,adminAccess:readOnlyAdmin?adminAccess:null};
}

/** D4492: reusable Audience-step consent read and Schedule reachable label for the campaign wizard handoff. */
import React,{useEffect,useState} from 'react';
import { growProspectsApi } from '../../../lib/api/growProspects';
import { consentLine,reachableLabel } from './prospectsModel';
export function useProspectConsentSummary(projectId,segment,api=growProspectsApi){
  const [state,setState]=useState({status:'loading'});
  useEffect(()=>{let live=true;setState({status:'loading'});api.summary({project:projectId,segment:segment||undefined}).then(data=>{if(live)setState({status:'ready',data});},()=>{if(live)setState({status:'unreadable'});});return()=>{live=false;};},[projectId,segment,api]);
  return state;
}
export function ConsentSummaryView({state}){return <p className="text-sm text-axal-muted dark:text-gray-400" data-testid="prospect-consent-summary">{state.status==='loading'?'Reading consent…':consentLine(state)}</p>;}
export default function ProspectConsentSummary({projectId,segment,api}){const state=useProspectConsentSummary(projectId,segment,api);return <ConsentSummaryView state={state}/>;}
export {reachableLabel};

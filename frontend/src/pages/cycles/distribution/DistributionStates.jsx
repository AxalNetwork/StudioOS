/** D4496 (#4496): fixed Distribution notes and truthful retry/plan states, with the shared HQ access banner. */
import React, { createContext, useContext } from 'react';
import { AccessBanner } from '../../../ui/ReasonGate.jsx';
import { ADD_TOKENS_PATH } from '../../../lib/aiTokens.js';
import { DISTRIBUTION_COPY } from './distributionStates.js';
import './distributionStates.css';
export const DistributionStateContext=createContext(null);
export const useDistributionState=()=>useContext(DistributionStateContext);
export function DistributionReadError({onRetry, form=false}) {
  return <div role="status" className="ds-state-note is-negative dark:text-red-300"><p>{form?DISTRIBUTION_COPY.formError:DISTRIBUTION_COPY.readError}</p>{onRetry&&<button type="button" className="ds-state-action min-h-[44px] dark:border-gray-700" onClick={onRetry}>Try again</button>}</div>;
}
export function DistributionWaitingNote({outOfTokens}) {
  return outOfTokens ? <p role="status" className="ds-state-note is-amber dark:text-amber-200">{DISTRIBUTION_COPY.waitingOut} <a className="ds-state-action min-h-[44px]" href={ADD_TOKENS_PATH}>Add tokens</a></p> : null;
}
export default function DistributionStates({model,onRetry,onEndAccess,onExpireAccess,children}) {
  const access=model.adminAccess;
  return <DistributionStateContext.Provider value={model}><div className="ds-states dark:text-gray-200" data-testid="distribution-states">
    {access?.reason&&<AccessBanner viewer="admin" reason={access.reason} endsAt={access.endsAt} onEnd={onEndAccess} onExpire={onExpireAccess}/>}
    {model.notes.map(note=><div key={note.key} role="status" className={`ds-state-note is-${note.tone}`} data-state={note.key}><p>{note.text}</p>{note.retry&&onRetry&&<button type="button" className="ds-state-action min-h-[44px] dark:border-gray-700" onClick={onRetry}>Try again</button>}</div>)}
    {model.locked ? <section className="ds-state-lock dark:bg-gray-900"><div aria-hidden="true" className="ds-state-placeholders"><div/><div/><div/></div><p>{model.manual.reason}</p><a className="ds-state-action min-h-[44px]" href="/pricing">Upgrade to unlock</a></section> : children}
  </div></DistributionStateContext.Provider>;
}

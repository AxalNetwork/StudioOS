import { useEffect, useRef, useState } from 'react';
import { aiBudgetApi } from '../lib/api/aiBudget';
import { aiTokenState, topUpLine } from '../lib/aiTokens';

/** Add the owner's catalog line to the existing checkout; never grants credit. */
export default function useAiTopupCart(cart,enabled) {
  const items=useRef(cart.items);items.current=cart.items;
  const [state,setState]=useState(enabled?'loading':'idle');
  useEffect(()=>{
    if (!enabled) {setState('idle');return undefined;}
    let live=true;setState('loading');
    aiBudgetApi.topUp().then(result=>{
      if (!live) return;
      // D755: the one model (lib/aiTokens.js). Nothing on sale is configuration
      // HQ must fix, never "Unreadable".
      const state=aiTokenState({data:result});
      if (state==='not_ready') {setState('not-configured');return;}
      const line=topUpLine(result);
      if (state!=='ready' || !line) throw new Error('Unreadable');
      if (!items.current.some(item=>item.price_id===line.price_id)) cart.add(line,1);
      setState('ready');
    }).catch(()=>{if(live)setState('unreadable');});
    return ()=>{live=false;};
  },[enabled,cart.add]);
  return state;
}

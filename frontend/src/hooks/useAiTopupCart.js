import { useEffect, useRef, useState } from 'react';
import { aiBudgetApi } from '../lib/api/aiBudget';

/** Add the owner's catalog line to the existing checkout; never grants credit. */
export default function useAiTopupCart(cart,enabled) {
  const items=useRef(cart.items);items.current=cart.items;
  const [state,setState]=useState(enabled?'loading':'idle');
  useEffect(()=>{
    if (!enabled) {setState('idle');return undefined;}
    let live=true;setState('loading');
    aiBudgetApi.topUp().then(result=>{
      if (!live) return;
      // D750: unset or not_ready is configuration HQ must fix, never "Unreadable".
      if (result?.configured===false || (result?.configured===true && result.state==='not_ready')) {setState('not-configured');return;}
      const line=result?.product;
      if (result?.configured!==true || result.state!=='ready' || !line || !/^price_[A-Za-z0-9]+$/.test(line.price_id) || line.currency!=='usd' || !Number.isSafeInteger(line.unit_amount) || line.unit_amount<=0) throw new Error('Unreadable');
      if (!items.current.some(item=>item.price_id===line.price_id)) cart.add(line,1);
      setState('ready');
    }).catch(()=>{if(live)setState('unreadable');});
    return ()=>{live=false;};
  },[enabled,cart.add]);
  return state;
}

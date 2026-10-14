import React, { useCallback, useEffect, useState } from 'react';
import { reportError } from '../../lib/log';
export const callButton='rounded-lg border border-axal-hairline px-3 py-2 text-xs font-semibold disabled:opacity-40';
export const callInput='w-full rounded-lg border border-axal-hairline bg-white dark:bg-gray-900 px-3 py-2 text-sm';
export function useCallRead(load,dependencies=[]) {
  const [revision,setRevision]=useState(0);
  const [state,setState]=useState({loading:true,data:null,error:null});
  useEffect(()=>{let alive=true;setState({loading:true,data:null,error:null});
    Promise.resolve().then(load).then(data=>{if(alive)setState({loading:false,data,error:null});},error=>{
      reportError('round-calls:read',error);if(alive)setState({loading:false,data:null,error});});
    return()=>{alive=false;};
  // Callers supply the primitive values that define the request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[...dependencies,revision]);
  const retry=useCallback(()=>setRevision(n=>n+1),[]);
  return {...state,retry};
}
export function CallReadState({read,children}) {
  if(read.loading)return <p role="status">Loading…</p>;
  if(read.error)return read.error.code==='round_calls_disabled'?<p>Coming soon. Round calls are not enabled.</p>:<p role="alert">Unreadable. <button type="button" className={callButton} onClick={read.retry}>Try again</button></p>;
  return children;
}
/** "$100,000", or "$1,234.50" when there are cents; never "US$" (D686 §5.6). */
export function moneyCents(value) {
  if(value==null)return 'Not recorded';
  const whole=value%100===0;
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:whole?0:2,maximumFractionDigits:whole?0:2}).format(value/100);
}
export function dollarsToCents(value) {
  if(!/^\d+(?:\.\d{1,2})?$/.test(String(value)))return null;
  const cents=Math.round(Number(value)*100);
  return Number.isSafeInteger(cents)&&cents>0?cents:null;
}
export function callDate(value) {if(!value)return 'Not recorded';const d=new Date(value.length===10?value+'T12:00:00Z':value.replace(' ','T')+(value.includes('T')?'':'Z'));return Number.isNaN(d.valueOf())?'Not recorded':d.toLocaleDateString('en-GB',{timeZone:'Europe/Zurich'});}


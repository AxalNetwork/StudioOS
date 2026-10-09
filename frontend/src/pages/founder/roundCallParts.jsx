import React, { useCallback, useEffect, useState } from 'react';
import { reportError } from '../../lib/log';
import { useEscapeClose } from '../../components/useEscapeClose';
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
export function moneyCents(value) {return value==null?'Not recorded':new Intl.NumberFormat('en-GB',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value/100);}
export function dollarsToCents(value) {
  if(!/^\d+(?:\.\d{1,2})?$/.test(String(value)))return null;
  const cents=Math.round(Number(value)*100);
  return Number.isSafeInteger(cents)&&cents>0?cents:null;
}
export function callDate(value) {if(!value)return 'Not recorded';const d=new Date(value.length===10?value+'T12:00:00Z':value.replace(' ','T')+(value.includes('T')?'':'Z'));return Number.isNaN(d.valueOf())?'Not recorded':d.toLocaleDateString('en-GB',{timeZone:'Europe/Zurich'});}
export function CallSheetFrame({onClose,children}) {
  useEscapeClose(onClose);
  return <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose}><section role="dialog" aria-modal="true" aria-label="Call for Capital" className="absolute right-0 top-0 flex h-full w-full max-w-[480px] flex-col bg-white dark:bg-gray-900 shadow-xl" onClick={e=>e.stopPropagation()}>
    <header className="flex items-center justify-between border-b border-axal-hairline p-4"><div><p className="text-xs text-axal-muted">Raise</p><h2 className="text-lg font-bold">Call for Capital</h2><p className="text-xs text-axal-muted">Only investors verified on Axal can see a call. It is never public.</p></div><button type="button" className={callButton} onClick={onClose}>Close</button></header>
    <div className="overflow-y-auto p-4 space-y-4">{children}</div></section></div>;
}

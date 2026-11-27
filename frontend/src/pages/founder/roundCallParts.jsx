import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
export function CallReadState({ read, children, index = false }) {
  if (read.loading) return <p role="status">Loading…</p>;
  if (!read.error) return children;
  const { code, status } = read.error;
  if (code === 'round_calls_disabled') return <p>Coming soon. Round calls are not enabled.</p>;
  if (code === 'verified_investor_required') return <p role="alert">Round calls require investor verification. <Link className="underline" to="/kyc">Verify your identity</Link>.</p>;
  if (code === 'invalid_project' && index) return <p role="alert">Choose a venture. <Link className="underline" to="/raise">Open Raise</Link>.</p>;
  if (code === 'project_not_found') return <p role="alert">Venture not found.{index && <> <Link className="underline" to="/raise">Open Raise</Link>.</>}</p>;
  if (code === 'call_not_found' || status === 404) return <p role="alert">Round call not found.</p>;
  if (!status || status >= 500) return <p role="alert">Unreadable. <button type="button" className={callButton} onClick={read.retry}>Try again</button></p>;
  return <p role="alert">This request to read round calls was refused.</p>;
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


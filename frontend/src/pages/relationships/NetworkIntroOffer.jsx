/** D6637: offer an introduction between two accepted ties, with names-only pickers and independent consent. */
import React,{useCallback,useEffect,useState} from 'react';
import Sheet from '../../ui/Sheet.jsx';
import {networkIntroOffersApi} from '../../lib/api/networkIntroOffers';
export default function NetworkIntroOffer({onClose,onOffered}){
 const [people,setPeople]=useState([]),[first,setFirst]=useState(''),[second,setSecond]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(null),[cursor,setCursor]=useState(null);
 const load=useCallback(async(after=0)=>{setLoading(true);setError(null);try{const d=await networkIntroOffersApi.people(after);setPeople(p=>after?[...p,...d.people]:d.people);setCursor(d.next_cursor);}catch{setError('Your accepted ties could not be read. Try again.');}finally{setLoading(false);}},[]);
 useEffect(()=>{load();},[load]);
 const valid=first&&second&&first!==second&&[first,second].every(v=>people.some(p=>String(p.id)===v));
 async function offer(e){e.preventDefault();if(!valid||busy)return;setBusy(true);setError(null);try{await networkIntroOffersApi.offer(Number(first),Number(second));onOffered?.();}catch(e){setError(e?.message||'The introduction could not be offered.');}finally{setBusy(false);}}
 return <Sheet title="Offer an introduction" open onClose={busy?undefined:onClose} width={480}><form onSubmit={offer} className="space-y-4 p-4" data-testid="network-intro-offer">
 <p className="text-sm text-gray-600 dark:text-gray-400">Choose two of your accepted ties. Each person decides whether to accept; sending this offer spends no introduction credits.</p>
 {loading&&<p role="status">Reading accepted ties…</p>}{error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error} <button type="button" onClick={()=>load()} disabled={busy||loading} className="min-h-[44px] underline">Try again</button></p>}
 {!loading&&!error&&people.length<2&&<p>You need two accepted ties before you can offer an introduction.</p>}
 {[['First person',first,setFirst,second],['Second person',second,setSecond,first]].map(([label,value,setValue,other])=><label key={label} className="block text-sm font-medium">{label}<select aria-label={label} value={value} onChange={e=>setValue(e.target.value)} disabled={busy||loading} className="mt-1 block min-h-[44px] w-full rounded border border-gray-300 bg-white px-2 dark:border-gray-700 dark:bg-gray-900"><option value="">Choose a person</option>{people.filter(p=>String(p.id)!==other).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}
 {cursor!==null&&<button type="button" disabled={busy||loading} onClick={()=>load(cursor)} className="min-h-[44px] underline">More accepted ties</button>}
 <div className="flex gap-2"><button type="submit" disabled={!valid||busy||loading||!!error} className="min-h-[44px] rounded bg-indigo-600 px-3 font-semibold text-white disabled:opacity-50">{busy?'Offering…':'Offer introduction'}</button><button type="button" disabled={busy} onClick={onClose} className="min-h-[44px] rounded border border-gray-300 px-3 dark:border-gray-700">Cancel</button></div>
 </form></Sheet>;
}

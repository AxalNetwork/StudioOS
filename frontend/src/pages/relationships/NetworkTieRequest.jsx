/** D6636: choose a shared-resource person by name and ask them to accept a tie; never enter an email or raw account id. */
import React,{useCallback,useEffect,useState} from 'react';
import Sheet from '../../ui/Sheet.jsx';
import {api} from '../../lib/api';
import {networkTieCandidatesApi} from '../../lib/api/networkTieCandidates';
export default function NetworkTieRequest({onClose,onSent}){
 const [people,setPeople]=useState([]);const [cursor,setCursor]=useState(null);const [selected,setSelected]=useState('');const [relationshipType,setRelationshipType]=useState('');const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState(null);
 const load=useCallback(async(after=0)=>{setLoading(true);setError(null);try{const d=await networkTieCandidatesApi.list(after);setPeople(p=>after?[...p,...d.people]:d.people);setCursor(d.next_cursor);}catch{setError('Shared people could not be read. Try again.');}finally{setLoading(false);}},[]);
 useEffect(()=>{load();},[load]);
 async function send(e){e.preventDefault();if(!selected||!relationshipType||busy||!people.some(p=>String(p.id)===selected))return;setBusy(true);setError(null);try{await api.createRelationship({partner_id:Number(selected),relationship_type:relationshipType});onSent?.();}catch(e){setError(e?.message||'The tie request could not be sent.');}finally{setBusy(false);}}
 return <Sheet title="Add person" open onClose={busy?undefined:onClose} width={480}><form onSubmit={send} className="space-y-4 p-4" data-testid="network-tie-request">
 <p className="text-sm text-gray-600 dark:text-gray-400">Choose someone you already share a deal or data room with. They decide whether to accept the tie.</p>
 {loading&&<p role="status">Reading shared people…</p>}{error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error} <button type="button" onClick={()=>load()} disabled={busy||loading} className="min-h-[44px] underline">Try again</button></p>}
 {!loading&&!error&&!people.length&&<p>No eligible shared people are recorded. Existing ties and pending requests are excluded.</p>}
 <label className="block text-sm font-medium">Person<select aria-label="Person" value={selected} onChange={e=>setSelected(e.target.value)} disabled={busy||loading} className="mt-1 block min-h-[44px] w-full rounded border border-gray-300 bg-white px-2 dark:border-gray-700 dark:bg-gray-900"><option value="">Choose a person</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 <label className="block text-sm font-medium">Relationship type<select aria-label="Relationship type" value={relationshipType} onChange={e=>setRelationshipType(e.target.value)} disabled={busy} className="mt-1 block min-h-[44px] w-full rounded border border-gray-300 bg-white px-2 dark:border-gray-700 dark:bg-gray-900"><option value="">Choose a relationship</option>{[['co_investor','Co-investors'],['advisor_founder','Advisor and founder'],['operator_partner','Operator and partner'],['strategic_alliance','Strategic alliance'],['advisor_mentee','Advisor and mentee']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
 {cursor!==null&&<button type="button" onClick={()=>load(cursor)} disabled={busy||loading} className="min-h-[44px] underline">More shared people</button>}
 <div className="flex gap-2"><button type="submit" disabled={busy||loading||!!error||!selected||!relationshipType} className="min-h-[44px] rounded bg-indigo-600 px-3 font-semibold text-white disabled:opacity-50">{busy?'Requesting…':'Request tie'}</button><button type="button" onClick={onClose} disabled={busy} className="min-h-[44px] rounded border border-gray-300 px-3 dark:border-gray-700">Cancel</button></div>
 </form></Sheet>;
}

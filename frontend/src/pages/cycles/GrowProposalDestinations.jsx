/** #6315: durable destination links beside existing Grow source proposals, with guarded undo. */
import { useEffect,useRef,useState } from 'react';
import { growProposalsApi } from '../../lib/api/growProposals';
export default function GrowProposalDestinations({projectId,source,revision,onChanged,api=growProposalsApi,canUndo=true}){
  const[state,setState]=useState({status:'loading'}),[round,setRound]=useState(0),[busy,setBusy]=useState(null),[error,setError]=useState('');
  const generation=useRef(0),lock=useRef(false);
  useEffect(()=>{const current=++generation.current;setState({status:'loading'});setError('');
    api.receipts(projectId,source).then(data=>{
      if(!Array.isArray(data?.receipts))throw Error('Destination shape');
      if(current===generation.current)setState({status:'ready',rows:data.receipts});
    }).catch(()=>{if(current===generation.current)setState({status:'unreadable'});});
    return()=>{generation.current++;};
  },[projectId,source,revision,round,api]);
  const undo=async row=>{if(lock.current||!canUndo)return;const current=generation.current;lock.current=true;setBusy(row.uid);setError('');
    try{await api.undo(projectId,row.uid,row.source,row.source_id);if(current===generation.current){setRound(n=>n+1);onChanged?.();}}
    catch(e){if(current===generation.current)setError(e?.data?.detail||e?.message||'Undo could not be saved. Reload before trying again.');}
    finally{lock.current=false;if(current===generation.current)setBusy(null);}
  };
  if(state.status==='loading')return null;
  return <div className="flex flex-col gap-2 text-xs" data-testid="grow-proposal-destinations">
    {state.status==='unreadable'?<p role="alert">Accepted destinations could not be read. <button type="button" className="min-h-11 underline" onClick={()=>setRound(n=>n+1)}>Try again</button></p>:state.rows.map(row=><p key={row.uid} className="m-0 flex flex-wrap items-center gap-2">
      <span>Accepted into <a className="min-h-11 content-center font-semibold underline" href={row.href}>{row.label}</a>.</span>
      {canUndo&&row.can_undo!==false?<button type="button" className="min-h-11 font-semibold underline disabled:opacity-50" disabled={busy!==null} onClick={()=>undo(row)}>{busy===row.uid?'Undoing…':'Undo'}</button>:null}
      <span className="text-axal-muted dark:text-gray-400">{row.can_undo===false?'Undo unavailable: creation provenance was not recorded.':row.created_record?'Undo removes the created record only while unchanged.':'Undo removes this link and keeps the existing record.'}</span>
    </p>)}
    {error?<p role="alert" className="text-red-700 dark:text-red-300">{error}</p>:null}
  </div>;
}

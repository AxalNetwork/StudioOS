import { useCallback, useEffect, useState } from 'react';
import { fundLedgerApi } from './api/fundLedger.js';
export function useFundLedger() {
  const [state,setState]=useState({items:[],loading:true,error:null});
  const [revision,setRevision]=useState(0);
  const reload=useCallback(()=>setRevision(n=>n+1),[]);
  useEffect(()=>{
    let cancelled=false;
    setState({items:[],loading:true,error:null});
    fundLedgerApi.list().then(data=>{
      if (!Array.isArray(data?.items)) throw new Error('The fund ledger response could not be read.');
      if (!cancelled) setState({items:data.items,loading:false,error:null});
    }).catch(error=>{if(!cancelled) setState({items:[],loading:false,error:error?.message || 'Please retry.'});});
    return ()=>{cancelled=true;};
  },[revision]);
  return {...state,reload};
}

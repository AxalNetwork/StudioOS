import { useCallback, useEffect, useState } from 'react';
import { aiBudgetApi } from '../lib/api/aiBudget';

export default function useAiBudget() {
  const [budget,setBudget]=useState(null),[product,setProduct]=useState(null);
  const [budgetError,setBudgetError]=useState(false),[productError,setProductError]=useState(false);
  const [loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0);
  const reload=useCallback(()=>setAttempt(n=>n+1),[]);
  useEffect(()=>{
    let live=true;setLoading(true);setBudget(null);setProduct(null);
    Promise.allSettled([aiBudgetApi.mine(),aiBudgetApi.topUp()]).then(([b,p])=>{
      if (!live) return;
      setBudget(b.status==='fulfilled'?b.value:null);setBudgetError(b.status==='rejected');
      setProduct(p.status==='fulfilled'?p.value:null);setProductError(p.status==='rejected');setLoading(false);
    });
    return ()=>{live=false;};
  },[attempt]);
  return {budget,product,budgetError,productError,loading,reload};
}

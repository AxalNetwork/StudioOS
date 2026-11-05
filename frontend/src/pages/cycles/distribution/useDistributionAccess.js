/** D4496 (#4496): fail-closed presentation of the existing venture writer permission, without a new API or role policy. */
import { useCallback, useEffect, useState } from 'react';
import { cyclesWrite } from '../../../lib/api/cycles.js';
const readPermission=projectId=>cyclesWrite.formOptions('grow',projectId,'distribution',{campaign:'permission'});
export default function useDistributionAccess(projectId, read=readPermission) {
  const [attempt,setAttempt]=useState(0);
  const [reading,setReading]=useState({projectId:null,canWrite:null,state:'loading'});
  const retry=useCallback(()=>setAttempt(n=>n+1),[]);
  useEffect(()=>{
    let live=true;
    setReading({projectId,canWrite:null,state:'loading'});
    if(projectId)read(projectId).then(data=>{
      if(live)setReading({projectId,canWrite:typeof data?.can_write==='boolean'?data.can_write:null,state:typeof data?.can_write==='boolean'?'ready':'unreadable'});
    },()=>{if(live)setReading({projectId,canWrite:null,state:'unreadable'});});
    return()=>{live=false;};
  },[projectId,read,attempt]);
  return {...(reading.projectId===projectId?reading:{projectId,canWrite:null,state:'loading'}),retry};
}

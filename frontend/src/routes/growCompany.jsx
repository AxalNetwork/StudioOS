/** D6122 GR-26: Company alone admits advisor/partner readers; other Grow routes retain their existing gates. */
import React,{lazy} from 'react';
import {Route} from 'react-router-dom';
const CycleRoute=lazy(()=>import('../pages/cycles/CycleRoute'));
export default function growCompanyRoutes({guard}){return <>
      <Route path="/grow/durable-company-building" element={guard(['admin', 'founder', 'advisor', 'partner'], <CycleRoute cycle="grow" slug="durable-company-building"/>)} />
      <Route path="/grow/durable-company-building/new" element={guard(['admin', 'founder'], <CycleRoute cycle="grow" slug="durable-company-building" adding/>)} />
      <Route path="/grow/durable-company-building/:id" element={guard(['admin', 'founder', 'advisor', 'partner'], <CycleRoute cycle="grow" slug="durable-company-building" record/>)} />
</>;}

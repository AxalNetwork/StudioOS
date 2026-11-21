/** D6154: explicit Commit routes admit partners without opening other Deals zones. */
import React,{lazy} from 'react';
import {Route} from 'react-router-dom';
const Decision=lazy(()=>import('../pages/ICDecisionPage'));
const Shell=lazy(()=>import('../pages/ICCommitShell'));
export default function icDecisionsRoutes({guard}){return <>
      <Route path="/deals/commit/:uid" element={guard(['admin', 'partner', 'investor'], <Shell><Decision/></Shell>)} />
</>;}

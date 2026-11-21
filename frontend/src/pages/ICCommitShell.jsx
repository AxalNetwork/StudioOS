/** D6154: IC records stay inside Deals; partner access covers Commit only. */
import React from 'react';
import {Link} from 'react-router-dom';
import WorkspaceShell from '../workspaces/WorkspaceShell';
import {useAuth} from '../hooks/useAuthSync';
export default function ICCommitShell({children}){
 const {role}=useAuth();
 return <WorkspaceShell role="investor" bucketPath="/deals" activeSlug="commit" title="Investment committee" intro="Decisions, votes, reasons and conditions." sectionNav={role==='partner'?<nav aria-label="Deals"><Link className="inline-flex min-h-11 items-center text-sm font-bold" to="/deals/commit">Commit</Link></nav>:undefined}>{children}</WorkspaceShell>;
}

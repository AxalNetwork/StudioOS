import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuthSync';
import { branchOfUser } from '../../../lib/shellRole';
import { licenceProgramsApi } from '../../../lib/api/licencePrograms';
import { CARD, H2, LINK, SUB, useRead } from './labParts';
import { ReadState } from './labOperationsParts';
/** SL16e. HQ-held pages have no subsidiary grant. Branches read their copy. */
export function BranchGrant({ children }) {
  const [tick, setTick] = useState(0);
  const read = useRead('lab-program-grant', tick, () => licenceProgramsApi.mine().then(r => {
    if (!Array.isArray(r?.programs)) throw new Error('program_grant_unreadable');
    return r;
  }));
  const grant = read.data?.programs.find(p => p.program_key === 'spinout-lab');
  if (read.status === 'ready' && grant?.standing === 'in_force') return children;
  return <section className={`${CARD} mx-auto my-8 flex max-w-2xl flex-col gap-3 p-6`} data-testid="lab-grant-boundary">
    <ReadState read={read} what="The studio’s Lab grant" claim="The studio’s grant could not be read, so its tools are not opened." onRetry={() => setTick(n => n + 1)} testId="lab-grant-boundary" />
    {read.status === 'ready' && <><h1 className={H2}>{!grant || grant.standing === 'not_recorded' ? 'Spin-Out Lab has not been granted to this studio.' : 'Spin-Out Lab is not in force for this studio.'}</h1><p className={SUB}>{grant?.line || 'Once HQ grants it, the queue, the calendar and every tool open here.'}</p><Link className={LINK} to="/admin/my-licence/programs">Request it</Link></>}
    <Link className={LINK} to="/admin/programs">Programs</Link>
  </section>;
}
export default function LabGrantBoundary({ children }) {
  const { user } = useAuth();
  return branchOfUser(user) ? <BranchGrant>{children}</BranchGrant> : children;
}

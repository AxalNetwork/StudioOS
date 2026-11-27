import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuthSync';
import { branchOfUser } from '../../../lib/shellRole';
import { licenceProgramsApi } from '../../../lib/api/licencePrograms';
import { CARD, H2, LINK, useRead } from './labParts';
import { ReadState } from './labOperationsParts';
import StudioProgramAccess from '../programs/StudioProgramAccess';
/** SL16e. HQ-held pages have no subsidiary grant. Branches read their copy. */
export function BranchGrant({ children }) {
  const [tick, setTick] = useState(0);
  const read = useRead('lab-program-grant', tick, () => licenceProgramsApi.mine().then(r => {
    if (!Array.isArray(r?.programs)) throw new Error('program_grant_unreadable');
    return r;
  }));
  const grant = read.data?.programs.find(p => p.program_key === 'spinout-lab');
  if (read.status === 'ready' && grant?.standing === 'in_force') return typeof children === 'function' ? children(read.data) : children;
  return <section className={`${CARD} mx-auto my-8 flex max-w-2xl flex-col gap-3 p-6`} data-testid="lab-grant-boundary">
    <ReadState read={read} what="The studio’s Lab grant" claim="The studio’s grant could not be read, so its tools are not opened." onRetry={() => setTick(n => n + 1)} testId="lab-grant-boundary" />
    {read.status === 'ready' && <>
      <h1 className={H2}>Spin-Out Lab is not in force for this studio.</h1>
      <StudioProgramAccess programKey="spinout-lab" snapshot={read.data} />
    </>}
    <Link className={LINK} to="/admin/programs">Programs</Link>
  </section>;
}
export default function LabGrantBoundary({ children }) {
  const { user } = useAuth();
  const branch = branchOfUser(user);
  if (branch) return <BranchGrant key={JSON.stringify([user?.id, branch])}>{children}</BranchGrant>;
  return typeof children === 'function' ? children(null) : children;
}

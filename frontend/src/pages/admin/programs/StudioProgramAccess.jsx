// #6960: a program's studio licence and next action, using the Administrator's own read.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuthSync';
import { branchOfUser } from '../../../lib/shellRole';
import { licenceProgramsApi } from '../../../lib/api/licencePrograms';
import { licenceRequestsApi } from '../../../lib/api/licenceRequests';
import { studioLicenceEnquiryPath } from '../../../lib/siteFirm';
import { tabPath } from '../../../lib/licencePage';
import { copyStamp, serviceTermLine, studioProgramAccess, studioProgramAccessPath } from '../../../lib/studioPrograms';
import { GRANTS_PATH } from '../../../lib/programGrants';
import { CARD, H2, LINK, SUB } from './parts';
import { useRead } from './useProgramReads';

const nextAction = { request: 'Request for my studio', view_request: 'View request', check_history: 'View request history', open: 'View terms' };

function StudioAccess({ programKey, user, snapshot }) {
  const [tick, setTick] = useState(0);
  const actor = JSON.stringify([user.id, branchOfUser(user)]);
  const own = useRead('studio-licence', actor, tick, !snapshot, () => licenceProgramsApi.mine());
  const data = snapshot || own.data;
  const row = Array.isArray(data?.programs) && data.programs.find((p) => p.program_key === programKey);
  const requests = useRead('studio-requests', JSON.stringify([actor, data?.licence?.uid, programKey]),
    tick, data?.linked === true && Boolean(row), () => licenceRequestsApi.list(programKey));
  const retry = <button type="button" className={LINK} onClick={() => setTick((n) => n + 1)} aria-label="Retry studio licence reads">Try again</button>;

  if (!data && own.status === 'loading') return <p className={SUB}>Reading your studio licence…</p>;
  if (data?.linked === false) return <>
    <p className={SUB}>Your account is not linked to a studio licence.</p>
    <Link to={studioLicenceEnquiryPath(programKey)} className={LINK} data-testid="studio-licence-enquiry">Request a studio licence</Link>
  </>;
  if (data?.linked !== true || !Array.isArray(data.programs)) {
    return <><p className={SUB}>{data?.reason || 'Your studio’s program access could not be read.'}</p>{retry}</>;
  }

  const { status, action } = row ? studioProgramAccess(row,
    requests.status === 'ready' ? requests.data : requests.status === 'error' ? null : undefined) : {};
  const unreadableRequests = requests.status === 'error' || (requests.status === 'ready' &&
    (!Array.isArray(requests.data?.items) || requests.data.available === false));
  const stamp = copyStamp(data);
  const services = Array.isArray(data.hq_services) ? data.hq_services.filter((s) => s.program_key === programKey) : [];
  return <>
    <p className="m-0 text-sm font-semibold">{data.licence?.brand_name || data.licence?.licence_ref || 'Your studio'}{status ? ` · ${status.word}` : ''}</p>
    {status?.line ? <p className={SUB}>{status.line}</p> : null}
    {!row && !services.length ? <p className={SUB}>This program is not listed on your studio licence.</p> : null}
    {services.length > 0 && <div className="space-y-1.5" data-testid="studio-program-services">
      <h3 className="text-sm font-semibold">Services delivered by HQ</h3>
      <ul>
        {services.map((s) => <li key={JSON.stringify([s.package_name, s.package_version, s.starts_on, s.ends_on])}>
          <p className="text-sm">{s.description}</p><p className={SUB}>{serviceTermLine(s)}</p>
        </li>)}
      </ul>
      <Link to={`${tabPath('programs')}#hq-services`} className={LINK}>View on my studio licence</Link>
    </div>}
    {stamp ? <p className={SUB}>{stamp}</p> : null}
    {row && unreadableRequests ? retry : null}
    {action && nextAction[action.kind] ? <Link to={studioProgramAccessPath(programKey, action.kind)} className={LINK} data-testid="studio-program-action">{nextAction[action.kind]}</Link> : null}
  </>;
}

export default function StudioProgramAccess({ programKey, superAdmin = false, snapshot = null }) {
  const user = useAuth()?.user;
  if (superAdmin && !branchOfUser(user)) return <Link to={`${GRANTS_PATH}?program=${encodeURIComponent(programKey)}#grants-grid`} className={`${LINK} self-start`} data-testid="programs-generic-manage-grants">Manage studio grants</Link>;
  if (user?.role !== 'admin') return null;
  return (
    <section className={`${CARD} flex flex-col items-start gap-1.5 px-4 py-3`} aria-label="Your studio’s access" data-testid="studio-program-access">
      <h2 className={H2}>Your studio’s access</h2>
      <StudioAccess programKey={programKey} user={user} snapshot={snapshot} />
    </section>
  );
}

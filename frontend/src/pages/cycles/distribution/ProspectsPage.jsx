// D4492: mounted Prospects tab with server-derived write permission and the wizard's import door. D4493: the sequence builder below it.
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cyclesWrite } from '../../../lib/api/cycles.js';
import ProspectsTab from './ProspectsTab.jsx';
import SequenceBuilder from './SequenceBuilder.jsx';
const readWritePermission = projectId => cyclesWrite.formOptions('grow', projectId, 'distribution', { campaign: 'permission' });
export default function ProspectsPage({ projectId, readPermission = readWritePermission }) {
  const [params] = useSearchParams();
  const [permission, setPermission] = useState({ status: 'loading', canWrite: false });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setPermission({ status: 'loading', canWrite: false });
    readPermission(projectId).then(data => {
      if (live) setPermission(typeof data?.can_write === 'boolean'
        ? { status: 'ready', canWrite: data.can_write }
        : { status: 'unreadable', canWrite: false });
    }, () => { if (live) setPermission({ status: 'unreadable', canWrite: false }); });
    return () => { live = false; };
  }, [projectId, readPermission, retry]);
  return <>
    {permission.status === 'unreadable' && <p role="alert">Unreadable: permission to change prospects could not be read. <button type="button" className="cm-button" onClick={() => setRetry(n => n + 1)}>Try again</button></p>}
    <ProspectsTab projectId={projectId} canWrite={permission.canWrite} importing={params.get('import') === '1'} />
    {/* D4493: DS7's right column, the sequence builder, beside the pipeline it enrols from. */}
    <SequenceBuilder projectId={projectId} canWrite={permission.canWrite} />
  </>;
}

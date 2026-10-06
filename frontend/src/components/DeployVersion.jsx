// The deploy SHA a branch row shows (D452, D457), or "Not recorded" with the
// reason — never an empty space. D515 made it one component for HQ's
// Platform page and Admin · Licences, so the absent state is drawn the same
// way on both and can be rendered by a test (both pages load in effects).
import React from 'react';
import { Unrecorded } from '../ui';
import { deployVersionDisplay, DEPLOY_VERSION_ABSENT_REASON } from '../lib/deployVersion';

export default function DeployVersion({ row, codeClassName }) {
  const v = deployVersionDisplay(row);
  return v
    ? <code className={codeClassName}>{v}</code>
    : <Unrecorded reason={DEPLOY_VERSION_ABSENT_REASON} />;
}

/**
 * D8730 (#8730): marks this tab's writes while an admin previews the Founder
 * or Exploring role, so the Worker's advisor routes refuse them
 * (`X-Axal-Preview-Shell`). Draws nothing; `ViewModeProvider` mounts it beside
 * `InvestorPreviewRefusal`.
 */
import { useLayoutEffect } from 'react';
import { setRolePreviewShell } from '../lib/investorPreview';
import { rolePreviewOf } from '../lib/previewShells';

export default function RolePreviewMarker({ mode }) {
  const shell = rolePreviewOf(mode);
  useLayoutEffect(() => {
    setRolePreviewShell(shell);
    return () => setRolePreviewShell(null);
  }, [shell]);
  return null;
}

import React from 'react';
import Sheet from '../../ui/Sheet.jsx';
import { REQUIREMENTS, day, requirementLabel } from './memberTrustModel';
import { SUB, MemberUnreadable } from './MemberOverview';
/**
 * One requirement, at `?requirement=` (or `?member=`), over the member's
 * Trust page. D1317: a detail panel, so it opens as the shared Sheet (560px);
 * its × and Escape drop the address back to the page.
 */
export default function RequirementDialog({ row, onClose, action, status, unreadable = false, onRetry }) {
  const info = row && REQUIREMENTS[row.obligation_key];
  const label = row ? requirementLabel(row) : unreadable ? 'Requirement unreadable' : 'Requirement unavailable';
  return <Sheet label={label} eyebrow="Requirement" width={560} onClose={onClose} testId="trust-requirement-dialog"
    title={row ? requirementLabel(row) : unreadable ? 'Requirement unreadable' : 'Only your own requirements are available here.'}
    footer={action ? <div className="flex flex-wrap justify-end gap-3">{action}</div> : null}>
    <div className="space-y-5 p-5">
      {status ? <div>{status}</div> : null}
      {unreadable ? <MemberUnreadable what="Your requirements" onRetry={onRetry} /> : !row ? <p className={SUB}>This address does not identify a requirement returned for your account. No other member’s requirement has been read.</p> : <>
        <section><h3 className="font-semibold">What this is</h3><p className={SUB}>{info?.[1] || 'Not recorded: no explanation is recorded for this requirement.'}</p></section>
        <section><h3 className="font-semibold">Why you are asked</h3><p className={SUB}>{row.required ? info?.[2] || 'The platform marks this requirement as required.' : 'Not required for your account today.'}</p></section>
        <section><h3 className="font-semibold">Where it stands</h3><dl className="grid grid-cols-2 gap-2 text-sm"><dt>Asked on</dt><dd>{day(row.created_at)}</dd><dt>Done on</dt><dd>Not recorded: a completion date is not returned here.</dd><dt>Updated on</dt><dd>{day(row.updated_at)}</dd><dt>Expires on</dt><dd>{day(row.expires_at)}</dd><dt>State from</dt><dd>{row.source || 'Not recorded: no evidence source was returned.'}</dd></dl></section>
        {row.obligation_key === 'accreditation_v1' && <p className={SUB}>Evidence upload is not available here. The fund team tells you what evidence they need.</p>}
      </>}
    </div>
  </Sheet>;
}

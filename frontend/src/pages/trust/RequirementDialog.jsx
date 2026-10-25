import React from 'react';
import Lightbox from '../../ui/Lightbox';
import { REQUIREMENTS, day, requirementLabel } from './memberTrustModel';
import { LINK, SUB } from './MemberOverview';
export default function RequirementDialog({ row, onClose, action, status }) {
  const info = row && REQUIREMENTS[row.obligation_key];
  return <Lightbox label={row ? requirementLabel(row) : 'Requirement unavailable'} onClose={onClose}>
    <div className="flex h-full max-h-[100dvh] min-h-0 flex-col p-5 sm:h-auto sm:max-h-[85vh] sm:w-full" data-testid="trust-requirement-dialog">
      <header className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase text-slate-500 dark:text-slate-400">Requirement</p><h2 className="text-xl font-bold">{row ? requirementLabel(row) : 'Only your own requirements are available here.'}</h2>{status}</div><button type="button" className={LINK} onClick={onClose} aria-label="Close requirement">Close</button></header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-5">
        {!row ? <p className={SUB}>This address does not identify a requirement returned for your account. No other member’s requirement has been read.</p> : <>
          <section><h3 className="font-semibold">What this is</h3><p className={SUB}>{info?.[1] || 'Not recorded: no explanation is recorded for this requirement.'}</p></section>
          <section><h3 className="font-semibold">Why you are asked</h3><p className={SUB}>{row.required ? info?.[2] || 'The platform marks this requirement as required.' : 'Not required for your account today.'}</p></section>
          <section><h3 className="font-semibold">Where it stands</h3><dl className="grid grid-cols-2 gap-2 text-sm"><dt>Asked on</dt><dd>{day(row.created_at)}</dd><dt>Done on</dt><dd>Not recorded: a completion date is not returned here.</dd><dt>Updated on</dt><dd>{day(row.updated_at)}</dd><dt>Expires on</dt><dd>{day(row.expires_at)}</dd><dt>State from</dt><dd>{row.source || 'Not recorded: no evidence source was returned.'}</dd></dl></section>
          {row.obligation_key === 'accreditation_v1' && <p className={SUB}>Evidence upload is not available here. The fund team tells you what evidence they need.</p>}
        </>}
      </div>
      <footer className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-slate-200 bg-white pt-4 dark:border-slate-700 dark:bg-slate-900">{action}</footer>
    </div>
  </Lightbox>;
}

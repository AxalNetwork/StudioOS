import React from 'react';
import { programEntitlementsApi } from '../../lib/api/programEntitlements.js';
import { Skeleton, Unreadable } from '../../ui';
import { PanelCard, useAccountRead } from './AccountCenter.jsx';

const STATUS = {
  in_force: 'In force',
  granted_not_in_force: 'Granted · not in force',
  eligible_not_granted: 'Eligible · not granted',
  paused: 'Paused',
  ended: 'Ended',
  not_eligible: 'Not eligible',
};

export default function AccountProgramAccess() {
  const read = useAccountRead(programEntitlementsApi.mine);
  const programs = read.data?.programs;
  const invalid = read.status === 'ready' && !Array.isArray(programs);
  return (
    <PanelCard title="Program access" data-testid="account-program-access">
      {read.status === 'loading' && <Skeleton.Text lines={2} />}
      {(read.status === 'unreadable' || invalid) && <Unreadable what="Your program access" onRetry={read.reload} />}
      {!invalid && programs?.length === 0 && (
        <p className="text-sm text-axal-muted dark:text-gray-400">No program access is recorded for your account.</p>
      )}
      {!invalid && programs?.length > 0 && (
        <ul className="divide-y divide-axal-hairline text-sm dark:divide-gray-800">
          {programs.map((program) => (
            <li key={program.program_key} className="space-y-1 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h3 className="font-semibold">{program.program_name}</h3>
                <span className="text-axal-muted dark:text-gray-400">{STATUS[program.status] ?? 'Status unavailable'}</span>
              </div>
              {program.sources.length > 0 && (
                <p className="text-axal-muted dark:text-gray-400">
                  {program.sources.map((source) => `${source.licence_type_label} · ${source.licence_ref}`).join(', ')}
                </p>
              )}
              {program.blockers.length > 0 && (
                <ul className="list-disc pl-4 text-axal-muted dark:text-gray-400">
                  {program.blockers.map((blocker) => (
                    <li key={`${blocker.code}:${blocker.licence_uid ?? ''}`}>{blocker.sentence}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

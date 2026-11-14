import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { channelsApi } from '../../lib/api/channels';
import { useAuth } from '../../hooks/useAuthSync';
import { Pill } from '../../ui';
import { BTN } from './AccountCenter';
import { teamsCapabilityRows } from './teamsConnector';
import { pendingRecordReturn } from '../founder/recordDraft';

/**
 * D5810 (#5810) — Microsoft Teams' own section on its connector page
 * (`/account/connectors/teams`): what the shared Microsoft connection does for
 * Teams, row by row (`teamsCapabilityRows`), the link to the same connection
 * on Microsoft 365's page, and, when Record a session sent the member here
 * (D5811), the way back to that setup.
 *
 * The capability read is the signed-in member's own
 * (`GET /founder/validate/meetings/capabilities`). It is read again whenever
 * the tab comes back into view, and an answer that arrives after a newer one
 * is dropped. A failed read says "Unreadable", never "Off".
 */
export default function TeamsSection({ p, source = channelsApi, initialCaps, memberId }) {
  const [caps, setCaps] = useState(initialCaps);
  const authId = useAuth()?.user?.id ?? null;
  const [back] = useState(() => pendingRecordReturn(memberId !== undefined ? memberId : authId));
  useEffect(() => {
    if (typeof source?.meetingCapabilities !== 'function') { setCaps(null); return undefined; }
    let alive = true;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      try { const r = await source.meetingCapabilities(); if (alive && current === request) setCaps(r ?? null); }
      catch { if (alive && current === request) setCaps(null); }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', onVisible); };
  }, [source]);
  const rows = teamsCapabilityRows(p, caps);
  return (
    <section aria-labelledby="teams-section-title" data-testid="teams-section" className="rounded-axal-sm border border-axal-hairline bg-white p-5 text-[13px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
      <h2 id="teams-section-title" className="text-[15px] font-extrabold text-axal-ink dark:text-gray-100">What Teams can do here</h2>
      <p className="mt-1 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="teams-shared-note">
        Microsoft Teams uses your Microsoft connection, the same one as <Link className={BTN.link} to="/account/connectors/microsoft" data-testid="teams-shared-link">Microsoft 365</Link>. Connecting or disconnecting either page changes both.
      </p>
      <ul className="mt-3 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800" data-testid="teams-rows">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5" data-testid={`teams-row-${r.id}`} data-value={r.value}>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{r.label}</div>
              {r.note && <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">{r.note}</p>}
            </div>
            <Pill tone={r.tone}>{r.value}</Pill>
          </li>
        ))}
      </ul>
      {caps === null && (
        <button type="button" className={`${BTN.link} mt-2 max-sm:min-h-[44px]`} onClick={() => { setCaps(undefined); source.meetingCapabilities?.().then((r) => setCaps(r ?? null), () => setCaps(null)); }} data-testid="teams-retry">Try again</button>
      )}
      {back && (
        <p className="mt-3 text-[12.5px]" data-testid="teams-record-return">
          <Link className={`${BTN.link} max-sm:inline-flex max-sm:min-h-[44px] max-sm:items-center`} to={back} data-testid="teams-record-return-link">← Back to Record a session</Link>
          <span className="ml-1.5 text-axal-muted dark:text-gray-400">Your setup is kept. Nothing records until you press Start.</span>
        </p>
      )}
    </section>
  );
}

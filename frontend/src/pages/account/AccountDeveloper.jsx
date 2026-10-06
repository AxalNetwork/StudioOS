import { useState } from 'react';
import { api } from '../../lib/api';
import { EmptyState, Pill, Unrecorded, Unreadable } from '../../ui';
import { BTN, LoadingRows, Outcome, PanelCard, Switch, useAccountRead } from './AccountCenter';
import { dayLabel, timeLabel } from './accountCenterModel';

/**
 * D568 — Developer: shown only where the developer routes answer.
 *
 * `GET/PUT /settings/developer` and `POST /settings/developer/resync-indices`
 * refuse every role but `admin` with a 403, and there is no per-account
 * "developer mode" flag anywhere in the store — the admin role IS the switch.
 * So the section is listed for admins only, and a 403 still hides it rather
 * than drawing an error for a section the reader was never meant to see.
 *
 * WHAT THE ROUTE SERVES: the account's stored feature flags and a few columns
 * of the account row. WHAT THE CANVAS DRAWS THAT NOTHING HOLDS: an API key, a
 * webhook URL, a rate limit (there is no key store — D433, T20 — and no
 * webhook or rate-limit setting per account), and the indexes' last run (the
 * re-sync route logs the request and returns no run time). Each reads "Not
 * recorded" with its reason.
 */

const API_ROWS = [
  ['API key', 'there is no key store yet; the API tier (T20) has not shipped'],
  ['Webhook URL', 'no webhook address is stored per account'],
  ['Rate limit', 'no rate limit is stored per account'],
];

const RAW_FIELDS = [
  ['id', 'Account id'], ['uid', 'Public handle'], ['email', 'Email'], ['name', 'Name'], ['role', 'Role'],
  ['email_verified', 'Email verified'], ['kyc_status', 'KYC status'], ['created_at', 'Created'], ['last_active_at', 'Last active'],
];

function rawValue(key, value) {
  if (value === null || value === undefined || value === '') return null;
  if (key === 'email_verified') return value ? 'Yes' : 'No';
  if (key === 'created_at' || key === 'last_active_at') return dayLabel(value) || String(value);
  return String(value);
}

export function DeveloperPanel({ dev, onToggleFlag, flagBusy, flagOutcome, onResync, resync }) {
  const flags = dev.status === 'ready' && dev.data?.feature_flags && typeof dev.data.feature_flags === 'object' ? dev.data.feature_flags : {};
  const flagKeys = Object.keys(flags).sort();
  const raw = dev.status === 'ready' ? dev.data?.raw_user : null;
  return (
    <div className="space-y-3" data-testid="account-developer">
      <div className="flex flex-wrap items-center gap-2.5 rounded-axal-md border border-axal-hairline bg-white px-3.5 py-2.5 text-[12.5px] text-axal-muted dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
        <Pill tone="info">Developer</Pill>
        Shown because your account holds the admin role, which is what the developer routes require.
      </div>

      <PanelCard title="API settings" data-testid="card-api-settings">
        <dl className="divide-y divide-axal-hairline text-[13px] dark:divide-gray-800">
          {API_ROWS.map(([label, reason]) => (
            <div key={label} className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3 py-2">
              <dt className="text-axal-muted dark:text-gray-400">{label}</dt>
              <dd><Unrecorded reason={reason}>Not recorded</Unrecorded> <span className="text-[12px] text-axal-muted dark:text-gray-400">· {reason}.</span></dd>
            </div>
          ))}
        </dl>
      </PanelCard>

      {dev.status === 'loading' ? <PanelCard title="Feature flags"><LoadingRows lines={2} /></PanelCard>
        : dev.status === 'unreadable' ? (
          <PanelCard title="Feature flags">
            <Unreadable what="Your developer settings" claim={dev.message || 'This is not a claim that none is set.'} onRetry={dev.reload} />
          </PanelCard>
        ) : (
          <>
            <PanelCard title="Feature flags" aside={`${flagKeys.length} stored`} data-testid="card-feature-flags" footer="Stored on your account. No part of the product reads these flags yet, so a switch changes the stored value and nothing else.">
              {flagKeys.length === 0 ? (
                <EmptyState size="sm" data-testid="feature-flags-empty" title="No feature flags are stored on your account." />
              ) : (
                <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
                  {flagKeys.map((k) => (
                    <li key={k} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                      <span className="font-mono text-[12.5px] text-axal-ink dark:text-gray-100">{k}</span>
                      <Switch checked={flags[k] === true} onChange={(next) => onToggleFlag(k, next)} disabled={flagBusy} label={`Feature flag ${k}`} data-testid={`switch-flag-${k}`} />
                    </li>
                  ))}
                </ul>
              )}
              <Outcome outcome={flagOutcome} />
            </PanelCard>

            <PanelCard title="Account record" aside="Read-only" data-testid="card-account-record">
              {raw ? (
                <dl className="divide-y divide-axal-hairline text-[13px] dark:divide-gray-800">
                  {RAW_FIELDS.map(([k, label]) => (
                    <div key={k} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-1.5">
                      <dt className="text-axal-muted dark:text-gray-400">{label}</dt>
                      <dd className="break-all font-mono text-[12.5px] text-axal-ink dark:text-gray-100">{rawValue(k, raw[k]) ?? <Unrecorded>Not recorded</Unrecorded>}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-[13px]"><Unrecorded reason="the developer route returned no account row">Not recorded</Unrecorded></p>
              )}
            </PanelCard>
          </>
        )}

      <PanelCard data-testid="card-search-indexes">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-axal-ink dark:text-gray-100">Search indexes</div>
            <div className="mt-0.5 font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="value-last-run">
              last run <Unrecorded reason="no route returns when the indexes were last re-synced">not recorded</Unrecorded>
              {resync.requestedAt && <> · requested from this page at {timeLabel(resync.requestedAt)}</>}
            </div>
          </div>
          <button type="button" className={BTN.ghost} onClick={onResync} disabled={resync.busy} data-testid="button-resync-indexes">
            {resync.busy ? 'Requesting…' : 'Re-sync search indexes'}
          </button>
        </div>
        <div className="mt-2"><Outcome outcome={resync.outcome} /></div>
      </PanelCard>
    </div>
  );
}

/** The container. Renders nothing for a role the routes refuse. */
export default function DeveloperSection({ role }) {
  const isAdmin = String(role || '').toLowerCase() === 'admin';
  const dev = useAccountRead(() => api.getDeveloperSettings(), { enabled: isAdmin });
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagOutcome, setFlagOutcome] = useState(null);
  const [resync, setResync] = useState({ busy: false, outcome: null, requestedAt: null });

  if (!isAdmin) return null;
  // The routes' own answer to a non-admin. Hidden, not shown as a failure.
  if (dev.status === 'unreadable' && dev.httpStatus === 403) return null;

  const toggleFlag = async (key, next) => {
    const current = dev.data?.feature_flags || {};
    setFlagBusy(true);
    setFlagOutcome(null);
    try {
      const res = await api.updateDeveloperSettings({ feature_flags: { ...current, [key]: next } });
      dev.set({ ...dev.data, feature_flags: res?.feature_flags || {} });
      setFlagOutcome({ tone: 'ok', text: `${key} is ${next ? 'on' : 'off'}.` });
    } catch (e) {
      setFlagOutcome({ tone: 'error', text: e?.message || 'The flag was not saved.' });
    } finally { setFlagBusy(false); }
  };

  const runResync = async () => {
    setResync((r) => ({ ...r, busy: true, outcome: null }));
    try {
      const res = await api.resyncDeveloperIndices();
      setResync({ busy: false, requestedAt: new Date(), outcome: { tone: 'ok', text: res?.message || 'Re-sync requested.' } });
    } catch (e) {
      setResync((r) => ({ ...r, busy: false, outcome: { tone: 'error', text: e?.message || 'The re-sync was not requested.' } }));
    }
  };

  return <DeveloperPanel dev={dev} onToggleFlag={toggleFlag} flagBusy={flagBusy} flagOutcome={flagOutcome} onResync={runResync} resync={resync} />;
}

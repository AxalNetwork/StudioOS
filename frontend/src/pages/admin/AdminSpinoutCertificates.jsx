// The Spin-Out Lab's certificate admin tab (D382) — canvas
// `design/canvases/out-of-scope/Graduation Certificate.dc.html`, its admin
// artboard: KPIs, the issuance table, "Issue all eligible", the activity log
// and the issuance states.
//
// EVERY ROW IS A READ. `GET /spinout-lab/certificates` returns the registry
// (who holds a credential, issued or revoked, and who issued it) and the
// graduates with none — `incorporation_completed` on record, the one
// definition of "graduated" the automatic path and the backfill share.
//
// WHAT THE CANVAS DRAWS THAT NO STORE HOLDS, and what this tab does instead:
//   · Emailed / Downloaded — nothing sends `spinout_graduated` and the PDF is
//     built in the graduate's browser, so neither is recorded. Both columns
//     and both KPIs say so rather than drawing a count.
//   · Resend — there is no send to repeat. Not drawn; the Emailed column says why.
//   · Reissue — `credential_id` is derived from the cohort, the date and the
//     account, so a same-date reissue collides with the revoked row. The
//     worker refuses it (`reissue_blocked`) and the row says so instead of
//     offering a button that would fail.
//   · Badge awarded / Template updated in the activity log — no badge is
//     minted and no template history is kept; the log is built from the
//     registry's own issued and revoked timestamps and says what it omits.
import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Unrecorded, Unreadable } from '../../ui';

export const NOT_EMAILED_REASON =
  'Nothing sends the graduation email yet, so no delivery is recorded.';
export const NOT_DOWNLOADED_REASON =
  'The certificate PDF is built in the graduate’s browser; no download is recorded.';
export const REISSUE_REASON =
  'Reissue is not available: the credential id is derived from the cohort, the date and the account, so a same-date reissue would collide with this revoked row.';

function parseUtc(ts) {
  if (!ts) return null;
  const s = String(ts);
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
const fmtDay = (ts) => {
  const d = parseUtc(ts);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
};

/**
 * One table row per graduate: awaiting ones first (they are the work), then
 * the registry's rows newest first, as the worker orders them.
 */
export function certificateRows(data) {
  const awaiting = (data?.awaiting || []).map((a) => ({
    key: `awaiting-${a.user_id}`, kind: 'awaiting', userId: a.user_id,
    name: a.name || null, company: null, credentialId: null, token: null,
    shareOn: false, conferredAt: a.conferred_at || null,
  }));
  const issued = (data?.certificates || []).map((c) => ({
    key: `cert-${c.id}`, kind: c.status === 'issued' ? 'issued' : 'revoked', id: c.id, userId: c.user_id,
    name: c.public_name || null, company: c.public_company || null, credentialId: c.credential_id,
    token: c.public_token || null, shareOn: Number(c.public_share_enabled) === 1,
    conferredAt: c.public_issued_on || null,
  }));
  return [...awaiting, ...issued];
}

/** The activity log, from the registry's own timestamps — nothing else is kept. */
export function certificateActivity(certs, limit = 8) {
  const events = [];
  (certs || []).forEach((c) => {
    const who = [c.public_name, c.public_company].filter(Boolean).join(' · ');
    if (c.issued_at) {
      events.push({
        key: `i-${c.id}`, at: c.issued_at, tone: 'issued', title: 'Certificate issued',
        detail: `${who} · ${c.issued_by_name ? `issued by ${c.issued_by_name}` : 'issued automatically on graduation'}`,
      });
    }
    if (c.revoked_at) {
      events.push({
        key: `r-${c.id}`, at: c.revoked_at, tone: 'revoked', title: 'Credential revoked',
        detail: `${who}${c.revocation_reason ? ` · ${c.revocation_reason}` : ''}`,
      });
    }
  });
  return events
    .sort((a, b) => (parseUtc(b.at)?.getTime() ?? 0) - (parseUtc(a.at)?.getTime() ?? 0))
    .slice(0, limit);
}

const STATUS = {
  awaiting: { label: 'Awaiting issue', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  issued: { label: 'Issued', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  revoked: { label: 'Revoked', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
};
const CARD = 'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900';
const BTN = 'h-8 px-3 rounded-lg text-[12px] font-semibold disabled:opacity-50';
const BTN_GHOST = `${BTN} border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800`;
const BTN_SOLID = `${BTN} bg-violet-600 text-white hover:bg-violet-700`;

export default function AdminSpinoutCertificates() {
  const [data, setData] = useState(null); // null = loading
  const [readError, setReadError] = useState(false);
  const [onlyAwaiting, setOnlyAwaiting] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [rowError, setRowError] = useState({});
  const [batch, setBatch] = useState(null);
  const [batchError, setBatchError] = useState(null);

  const load = useCallback(async () => {
    setReadError(false);
    try {
      setData(await api.spinoutCertificateList());
    } catch (e) {
      reportError('admin:certificates-list', e);
      setReadError(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (row, fn) => {
    setBusyKey(row.key);
    setRowError((m) => ({ ...m, [row.key]: null }));
    try {
      await fn();
      await load();
    } catch (e) {
      reportError('admin:certificate-action', e);
      setRowError((m) => ({ ...m, [row.key]: e?.message || 'That did not go through. Nothing changed.' }));
    } finally {
      setBusyKey(null);
    }
  };
  const issue = (row) => act(row, () => api.spinoutCertificateIssue({ user_id: row.userId }));
  const revoke = (row) => {
    const reason = window.prompt(
      `Why is ${row.name || 'this graduate'}'s credential being revoked?\n\n`
      + 'The verification page will say it was revoked. This cannot be reissued on the same date.',
      '',
    );
    if (reason === null) return;
    // The registry's integer row id, as a number: CodeQL's clear-text-storage
    // check reads anything under `certificates` as sensitive, and this id
    // reaches api.js's session-expiry and timeout logs inside the request
    // path. A row id is not a secret; coercing it says so (D382).
    act(row, () => api.spinoutCertificateRevoke(Number(row.id), reason.trim()));
  };
  const issueAll = async () => {
    setBatchError(null);
    setBusyKey('batch');
    try {
      setBatch(await api.spinoutCertificateBackfill(100));
      await load();
    } catch (e) {
      reportError('admin:certificate-backfill', e);
      setBatchError(e?.message || 'The batch did not run. Nothing was issued.');
    } finally {
      setBusyKey(null);
    }
  };

  if (data === null && !readError) {
    return <p className="text-sm text-gray-400 dark:text-gray-500" data-testid="certificates-loading">Reading the certificate registry…</p>;
  }
  if (readError) {
    return (
      <div data-testid="certificates-unreadable">
        <Unreadable what="The certificate registry" claim="This is not a statement that no certificate exists." onRetry={load} />
      </div>
    );
  }

  return (
    <CertificatesBoard
      data={data}
      onlyAwaiting={onlyAwaiting}
      onToggleBatch={() => setOnlyAwaiting((x) => !x)}
      busyKey={busyKey}
      rowError={rowError}
      batch={batch}
      batchError={batchError}
      onIssue={issue}
      onRevoke={revoke}
      onIssueAll={issueAll}
      onRefresh={load}
    />
  );
}

/**
 * The tab's view, pure: the registry read in, the admin's actions out. Split
 * from the loader so what an admin reads can be rendered and asserted on.
 */
export function CertificatesBoard({
  data, onlyAwaiting = false, onToggleBatch, busyKey = null, rowError = {},
  batch = null, batchError = null, onIssue, onRevoke, onIssueAll, onRefresh,
}) {
  const rows = certificateRows(data);
  const activity = certificateActivity(data?.certificates);
  const certs = data?.certificates || [];
  const issuedCount = certs.filter((c) => c.status === 'issued').length;
  const revokedCount = certs.filter((c) => c.status !== 'issued').length;
  const sharingOff = certs.filter((c) => c.status === 'issued' && Number(c.public_share_enabled) !== 1).length;
  const awaitingKnown = Array.isArray(data?.awaiting);
  const awaitingCount = awaitingKnown ? data.awaiting.length : null;
  const awaitingReason = data?.unavailable?.awaiting || null;

  const shown = onlyAwaiting ? rows.filter((r) => r.kind === 'awaiting') : rows;
  const kpis = [
    { k: 'Eligible (graduated)', v: data.eligible_total ?? null, unreadable: !awaitingKnown, testid: 'cert-kpi-eligible' },
    { k: 'Issued', v: issuedCount, testid: 'cert-kpi-issued' },
    { k: 'Emailed', v: null, reason: NOT_EMAILED_REASON, testid: 'cert-kpi-emailed' },
    { k: 'Downloaded', v: null, reason: NOT_DOWNLOADED_REASON, testid: 'cert-kpi-downloaded' },
  ];

  return (
    <div data-testid="admin-spinout-certificates">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {kpis.map((k) => (
          <div key={k.k} className={`${CARD} p-4`} data-testid={k.testid}>
            <div className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-50">
              {k.v != null ? k.v : k.unreadable
                ? <Unreadable what="The graduate count" claim={awaitingReason || 'This is not a statement that nobody graduated.'} onRetry={onRefresh} />
                : <Unrecorded reason={k.reason} />}
            </div>
            <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5">{k.k}</div>
            {k.v == null && !k.unreadable && k.reason ? <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 leading-snug">{k.reason}</div> : null}
          </div>
        ))}
      </div>

      <div className={`${CARD} p-4 mb-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[14px] font-bold text-gray-900 dark:text-gray-100">Issuance</div>
            <div className="text-[12px] text-gray-500 dark:text-gray-400 tabular-nums" data-testid="cert-issuance-sub">
              {awaitingKnown
                ? `${data.eligible_total} ${data.eligible_total === 1 ? 'founder has' : 'founders have'} reached graduation · ${awaitingCount} awaiting a certificate`
                : <Unreadable what="The graduate list" claim="This is not a statement that nobody is waiting." onRetry={onRefresh} />}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className={BTN_GHOST} onClick={onToggleBatch}
              aria-pressed={onlyAwaiting} data-testid="button-preview-batch">
              {onlyAwaiting ? 'Show all' : 'Preview batch'}
            </button>
            <button type="button" className={BTN_SOLID} onClick={onIssueAll}
              disabled={busyKey === 'batch' || awaitingCount === 0} data-testid="button-backfill-certificates">
              {busyKey === 'batch' ? 'Issuing…' : 'Issue all eligible'}
            </button>
          </div>
        </div>
        {batch ? (
          <p className="text-[12px] text-gray-600 dark:text-gray-300 mb-2 tabular-nums" data-testid="backfill-result">
            Issued {batch.issued} of {batch.scanned} scanned
            {batch.skipped ? ` · ${batch.skipped} could not be issued (no name or date on the record, or a revoked credential holds the id)` : ''}
            {batch.remaining ? ` · ${batch.remaining}+ still pending — run again` : ''}
          </p>
        ) : null}
        {batchError ? <p className="text-[12px] text-red-600 dark:text-red-400 mb-2">{batchError}</p> : null}

        {shown.length === 0 ? (
          <p className="text-[12.5px] text-gray-500 dark:text-gray-400 py-3" data-testid="cert-table-empty">
            {onlyAwaiting ? 'No graduate is waiting for a certificate.' : 'No graduate has reached certification yet.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]" data-testid="cert-table">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800">
                  <th className="py-2 pr-3 font-bold">Graduate</th>
                  <th className="py-2 pr-3 font-bold">Credential</th>
                  <th className="py-2 pr-3 font-bold">Status</th>
                  <th className="py-2 pr-3 font-bold">Emailed</th>
                  <th className="py-2 pr-3 font-bold">Downloaded</th>
                  <th className="py-2 font-bold text-right"> </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key} className="border-b border-gray-50 dark:border-gray-800/60 align-top" data-testid={`cert-row-${r.kind}`}>
                    <td className="py-2.5 pr-3">
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{r.name || <Unrecorded reason="The account has no name on record." />}</div>
                      <div className="text-[11.5px] text-gray-500 dark:text-gray-400">
                        {r.company || (r.kind === 'awaiting' ? `Graduated ${fmtDay(r.conferredAt) || ''}`.trim() : <Unrecorded reason="No company was on record when this was issued." />)}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11.5px]">
                      {r.credentialId || <Unrecorded reason="Not generated until the certificate is issued.">Not generated</Unrecorded>}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${STATUS[r.kind].cls}`}>{STATUS[r.kind].label}</span>
                      {r.kind === 'issued' && !r.shareOn ? (
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">Public verification off (the graduate’s choice)</div>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3"><Unrecorded reason={NOT_EMAILED_REASON} /></td>
                    <td className="py-2.5 pr-3"><Unrecorded reason={NOT_DOWNLOADED_REASON} /></td>
                    <td className="py-2.5 text-right">
                      <div className="flex justify-end gap-2 flex-wrap">
                        {r.kind === 'issued' && r.shareOn && r.token ? (
                          <a href={`/verify/${encodeURIComponent(r.token)}`} target="_blank" rel="noreferrer"
                            className={`${BTN_GHOST} inline-flex items-center gap-1`} data-testid="cert-preview">
                            Preview <ExternalLink size={11} />
                          </a>
                        ) : null}
                        {r.kind === 'awaiting' ? (
                          <button type="button" className={BTN_SOLID} disabled={busyKey === r.key}
                            onClick={() => onIssue(r)} data-testid="cert-issue">
                            {busyKey === r.key ? 'Issuing…' : 'Issue'}
                          </button>
                        ) : null}
                        {r.kind === 'issued' ? (
                          <button type="button" className={BTN_GHOST} disabled={busyKey === r.key}
                            onClick={() => onRevoke(r)} data-testid="cert-revoke">
                            {busyKey === r.key ? 'Revoking…' : 'Revoke'}
                          </button>
                        ) : null}
                        {r.kind === 'revoked' ? (
                          <span className="text-[11px] text-gray-500 dark:text-gray-400 max-w-[240px] text-left" data-testid="cert-reissue-unavailable">
                            {REISSUE_REASON}
                          </span>
                        ) : null}
                      </div>
                      {rowError[r.key] ? <p className="text-[11.5px] text-red-600 dark:text-red-400 mt-1 text-right">{rowError[r.key]}</p> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${CARD} p-4`} data-testid="cert-activity">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Activity log</div>
            <button type="button" onClick={onRefresh} className="text-[11.5px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 inline-flex items-center gap-1">
              <RefreshCw size={11} /> Refresh
            </button>
          </div>
          {activity.length === 0 ? (
            <p className="text-[12.5px] text-gray-500 dark:text-gray-400">Nothing issued or revoked yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {activity.map((a) => (
                <li key={a.key} className="flex items-start gap-2.5">
                  <span className={`mt-1.5 w-2 h-2 rounded-full flex-none ${a.tone === 'revoked' ? 'bg-red-500' : 'bg-violet-500'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-100">{a.title}</div>
                    <div className="text-[11.5px] text-gray-500 dark:text-gray-400">{a.detail}</div>
                  </div>
                  <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums whitespace-nowrap">{fmtDay(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
            Built from the registry’s issued and revoked records. Downloads, emails, badge awards and template edits are not recorded, so they are not listed.
          </p>
        </div>

        <div className={`${CARD} p-4`} data-testid="cert-states">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Issuance states</div>
          {[
            ['Awaiting issue', awaitingCount, null, !awaitingKnown],
            ['Issued', issuedCount],
            ['Revoked', revokedCount],
            ['Public verification off', sharingOff],
            ['Emailed', null, NOT_EMAILED_REASON],
            ['Downloaded', null, NOT_DOWNLOADED_REASON],
          ].map(([label, n, reason, unreadable]) => (
            <div key={label} className="flex items-center justify-between py-1.5 text-[12.5px] border-b border-gray-50 dark:border-gray-800/60 last:border-0">
              <span className="text-gray-600 dark:text-gray-300">{label}</span>
              <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                {n != null ? n : unreadable
                  ? <Unreadable what="The graduate list" claim="This is not a statement that nobody is waiting." onRetry={onRefresh} />
                  : <Unrecorded reason={reason} />}
              </span>
            </div>
          ))}
          <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
            Revoking marks the credential revoked, and its public verification page then says so. No profile badge is minted, so none is removed. {REISSUE_REASON}
          </p>
        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { Unrecorded, actionPrimary } from '../../../ui';
import {
  BACKFILL_LIMIT, CERTS_CAP, CERT_REFUSALS, CERT_STATUSES, GRAD_SORTS, NOT_DOWNLOADED, NOT_EMAILED, NO_REISSUE, PUBLIC_PAGE_FILTERS,
  REVOKE_BODY, REVOKE_REASON_MAX, awaitingCount, backfillLine, dataOf, filterGrads, gradRows, gradTiles, pageOf, plural, refusalText,
  verifyHref,
} from './labDesksModel';
import {
  CARD, Dialog, Field, INPUT, LINK, MONO, Pager, Pill, ReadState, SUB, Select, TD, TH, Tile, hasRows, useRead, useWrite,
} from './labParts';

/**
 * D970 (#2755) — Graduation (SL11; SL11r's revoke dialog). One read
 * (`GET /api/spinout-lab/certificates`): the registry, the graduates with no
 * certificate, and how many are eligible. Emailed and Downloaded are "Not
 * recorded" with their lines: nothing sends the email, and the PDF is built in
 * the graduate's browser. Issue, Issue all eligible and Revoke each open a
 * dialog that says what it changes; Revoke needs a reason, and its refusal or
 * result stays in the dialog. There is no browser pop-up. On a phone each
 * graduate is a card.
 */

function IssueDialog({ row, onClose, onChanged }) {
  const w = useWrite(onChanged, CERT_REFUSALS, refusalText);
  return (
    <Dialog title={`Issue ${row.name}’s certificate?`} onClose={onClose} w={w} action="Issue" testId="lab-cert-issue"
      onAction={() => w.run(() => api.spinoutCertificateIssue({ user_id: row.userId }))} done={`${row.name}’s certificate is issued.`}>
      <p className="m-0 text-[13px] leading-normal text-axal-ink dark:text-gray-100">A credential ID is generated and a verification page is created. The graduate decides whether that page is public.</p>
    </Dialog>
  );
}

function IssueAllDialog({ waiting, onClose, onChanged, onResult }) {
  const w = useWrite(onChanged, CERT_REFUSALS, refusalText);
  const line = backfillLine(w.reply);
  return (
    <Dialog title="Issue every eligible certificate?" onClose={onClose} w={w} action="Issue all eligible" testId="lab-cert-all"
      onAction={() => w.run(async () => { const r = await api.spinoutCertificateBackfill(BACKFILL_LIMIT); onResult(r); return r; })} done={line}>
      <p className="m-0 text-[13px] leading-normal text-axal-ink dark:text-gray-100">
        {`${plural(waiting, 'graduate has', 'graduates have')} no certificate. Up to ${BACKFILL_LIMIT} are issued now, each with a credential ID and a verification page the graduate controls. A graduate with no name or date on record is skipped and said.`}
      </p>
    </Dialog>
  );
}

function RevokeDialog({ row, onClose, onChanged }) {
  const [reason, setReason] = useState('');
  const w = useWrite(onChanged, CERT_REFUSALS, refusalText);
  return (
    <Dialog title={`Revoke ${row.name}’s certificate?`} sub={REVOKE_BODY} onClose={onClose} w={w} action="Revoke" tone="danger" disabled={!reason.trim()} testId="lab-cert-revoke"
      onAction={() => w.run(() => api.spinoutCertificateRevoke(Number(row.id), reason.trim()))} done={`${row.name}’s certificate is revoked. Its verification page says so.`}>
      <Field label="Reason · required">
        <textarea value={reason} rows={3} maxLength={REVOKE_REASON_MAX} disabled={Boolean(w.reply)} onChange={(e) => setReason(e.target.value.slice(0, REVOKE_REASON_MAX))}
          className={`${INPUT} py-2 leading-normal`} data-testid="lab-cert-revoke-reason" />
      </Field>
    </Dialog>
  );
}

export default function LabGraduation({ now = Date.now() }) {
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [publicPage, setPublicPage] = useState('');
  const [sort, setSort] = useState('graduated');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  const [batch, setBatch] = useState(null);
  const reload = () => setTick((t) => t + 1);
  const read = useRead('certificates', tick, () => api.spinoutCertificateList().then((r) => {
    if (!Array.isArray(r?.certificates)) throw new Error('The certificates did not come back as a list.');
    return r;
  }));
  const data = dataOf(read);
  const waiting = awaitingCount(read);
  const rows = filterGrads(gradRows(data, now), { q, status, publicPage, sort });
  const shown = pageOf(rows, page);
  const set = (fn) => (v) => { fn(v); setPage(1); };
  const action = (r) => {
    if (r.action === 'issue') return <button type="button" className={LINK} onClick={() => setDialog({ kind: 'issue', row: r })} data-testid={`lab-cert-issue-${r.userId}`}>Issue</button>;
    if (r.action === 'revoke') return <button type="button" className={LINK} onClick={() => setDialog({ kind: 'revoke', row: r })} data-testid={`lab-cert-revoke-${r.id}`}>Revoke</button>;
    return <span className="text-[11.5px] text-axal-muted dark:text-gray-400" title={NO_REISSUE}>No reissue</span>;
  };
  const credential = (r) => (r.credentialId ? <span className={MONO}>{r.credentialId}</span> : <Unrecorded reason="Not generated until the certificate is issued.">Not generated</Unrecorded>);
  const publicCell = (r) => {
    if (r.publicPage === null) return <Unrecorded reason="There is no page until the certificate is issued.">No page yet</Unrecorded>;
    if (r.publicPage === 'on' && r.token) return <a href={verifyHref(r.token)} target="_blank" rel="noreferrer" className={LINK}>On</a>;
    return r.status.key === 'revoked' ? 'Says revoked' : 'Off';
  };

  return (
    <div className="flex flex-col gap-3.5" data-testid="lab-graduation">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="lab-grad-tiles">
        {gradTiles(read).map((t) => <Tile key={t.key} t={t} onRetry={reload} />)}
      </div>

      <section className={`${CARD} flex flex-wrap items-center justify-between gap-3 px-4 py-3`} data-testid="lab-grad-issue-all">
        <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="lab-grad-issue-all-line">
          {batch ? backfillLine(batch) : waiting === null ? (data ? 'Who is still waiting for a certificate could not be read.' : 'Reading…') : waiting ? `${plural(waiting, 'graduate is', 'graduates are')} waiting for a certificate.` : 'Every eligible graduate has a certificate.'}
        </span>
        <button type="button" className={actionPrimary}
          disabled={!waiting} onClick={() => setDialog({ kind: 'all' })} data-testid="lab-grad-issue-all-open">Issue all eligible</button>
      </section>

      <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label="Graduates">
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" value={q} onChange={(e) => set(setQ)(e.target.value)} placeholder="Search graduate or company" aria-label="Search graduate or company" className={`${INPUT} min-w-[14rem] flex-1`} data-testid="lab-grad-search" />
          <Select label="Status" value={status} onChange={set(setStatus)} testId="lab-grad-status"
            options={[{ value: '', label: 'Status: any' }, ...CERT_STATUSES.map((s) => ({ value: s.key, label: `Status: ${s.word}` }))]} />
          <Select label="Public page" value={publicPage} onChange={set(setPublicPage)} testId="lab-grad-public"
            options={[{ value: '', label: 'Public page: any' }, ...PUBLIC_PAGE_FILTERS.map((f) => ({ value: f.key, label: `Public page: ${f.word}` }))]} />
          <Select label="Sort" value={sort} onChange={set(setSort)} testId="lab-grad-sort" options={GRAD_SORTS.map((s) => ({ value: s.key, label: `Sort: ${s.label}` }))} />
        </div>
        <ReadState read={read} what="The certificates" claim="No graduate is shown as awaiting while they cannot be read." onRetry={reload} testId="lab-grad-read" />
        {hasRows(read) ? (
          <>
            {data.unavailable?.awaiting ? <p className="m-0 text-[12px] font-semibold text-amber-800 dark:text-amber-300" data-testid="lab-grad-awaiting-unread">{`${data.unavailable.awaiting} Only issued and revoked certificates are listed.`}</p> : null}
            {data.certificates.length >= CERTS_CAP ? <p className={`m-0 ${SUB}`} data-testid="lab-grad-cap">{`The newest ${CERTS_CAP} certificates. Search and filters cover only these.`}</p> : null}
            {!rows.length ? (
              <p className={`m-0 ${SUB}`} data-testid="lab-grad-empty">{gradRows(data, now).length ? 'No graduate matches these filters.' : 'No one has graduated yet.'}</p>
            ) : (
              <>
                <div className="hidden lg:block">
                  <table className="w-full border-collapse" data-testid="lab-grad-table">
                    <thead><tr className="border-b border-axal-hairline dark:border-gray-700">
                      {['Graduate', 'Credential ID', 'Status', 'Public page', 'Emailed', 'Downloaded', ''].map((c, i) => <th key={c || i} scope="col" className={TH}>{c || <span className="sr-only">Actions</span>}</th>)}
                    </tr></thead>
                    <tbody>
                      {shown.rows.map((r) => (
                        <tr key={r.key} className="border-b border-axal-hairline last:border-b-0 dark:border-gray-700" data-testid={`lab-grad-row-${r.key}`}>
                          <td className={TD}><span className="block font-bold">{r.name}</span><span className={SUB}>{[r.company, r.graduated ? `graduated ${r.graduated}` : null].filter(Boolean).join(' · ')}</span></td>
                          <td className={TD}>{credential(r)}</td>
                          <td className={TD}><Pill tone={r.status.tone}>{r.status.word}</Pill></td>
                          <td className={TD}>{publicCell(r)}</td>
                          <td className={TD}><Unrecorded reason={NOT_EMAILED} /></td>
                          <td className={TD}><Unrecorded reason={NOT_DOWNLOADED} /></td>
                          <td className={TD}>{action(r)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="m-0 flex list-none flex-col gap-2 p-0 lg:hidden">
                  {shown.rows.map((r) => (
                    <li key={r.key} className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline px-3.5 py-3 text-[13px] text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid={`lab-grad-card-${r.key}`}>
                      <span className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-bold">{r.name}</span><Pill tone={r.status.tone}>{r.status.word}</Pill></span>
                      {r.company || r.graduated ? <span className={SUB}>{[r.company, r.graduated ? `graduated ${r.graduated}` : null].filter(Boolean).join(' · ')}</span> : null}
                      <span>{credential(r)}</span>
                      <span>Public page: {publicCell(r)}</span>
                      <span className={SUB}>Emailed and downloaded are not recorded.</span>
                      {action(r)}
                    </li>
                  ))}
                </ul>
                <Pager shown={shown} onPage={setPage} testId="lab-grad-pager" />
              </>
            )}
          </>
        ) : null}
      </section>
      {dialog?.kind === 'issue' ? <IssueDialog key={`i-${dialog.row.key}`} row={dialog.row} onClose={() => setDialog(null)} onChanged={reload} /> : null}
      {dialog?.kind === 'revoke' ? <RevokeDialog key={`r-${dialog.row.key}`} row={dialog.row} onClose={() => setDialog(null)} onChanged={reload} /> : null}
      {dialog?.kind === 'all' ? <IssueAllDialog waiting={waiting || 0} onClose={() => setDialog(null)} onChanged={reload} onResult={setBatch} /> : null}
    </div>
  );
}

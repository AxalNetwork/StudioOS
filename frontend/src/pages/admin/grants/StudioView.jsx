import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { programGrantsApi } from '../../../lib/api/programGrants.js';
import { partnerDealTypesApi } from '../../../lib/api/partnerDealTypes.js';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, actionGhost, usePhoneWidth } from '../../../ui';
import { kindWord, statusWord } from '../../../lib/programGrants';
import { AnswerDialog, GrantLightbox, ReasonDialog } from './GrantDialogs';
import { Tile } from './GridView';
import {
  FROZEN_LINE, GRANTS_PATH, NOT_RECORDED, dayWord, historyRow, requestRow, studioCsv, studioRows, studioTiles,
} from './grantsModel';

/**
 * D987 (#2778) — GR3: one studio at /admin/licences/programs/studio/:uid.
 * Its tiles, the nine programs against its grants (Grant, Period, Key terms,
 * Schedule, In use and the row's acts), its partner deal types (D986), its
 * requests and its recent changes. Reads: the licence (D982), the defaults
 * (D982), the page's requests (D983) and the deal types (D986), each its own
 * block. "In use" waits on the studios' program figures (#3061).
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const ERR = 'text-[12.5px] text-axal-destructive dark:text-red-400';
const ALERT = 'flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint px-3.5 py-3 text-[13px] text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300';
const LINKBTN = 'text-[12.5px] font-bold text-axal-violet hover:underline disabled:cursor-not-allowed disabled:text-axal-faint dark:text-violet-300';
const idle = { status: 'loading', data: null };

function useRead(load, deps) {
  const [read, setRead] = useState(idle);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead((r) => ({ status: 'loading', data: r.data }));
    load().then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      (e) => { reportError('program-grants:studio', e); if (live) setRead({ status: e?.status === 404 ? 'missing' : 'error', data: null }); },
    );
    return () => { live = false; };
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return [read, useCallback(() => setTick((t) => t + 1), [])];
}

function Unreadable({ text, onRetry, testId }) {
  return (
    <div role="alert" className={ALERT} data-testid={testId}>
      <span>{text}</span>
      <button type="button" className={actionGhost} onClick={onRetry}>Try again</button>
    </div>
  );
}

function saveCsv(name, body) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click?.(); a.remove?.();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

/** D986's switches: which partner deal types this studio may offer. Each switch asks for a reason. */
function DealTypes({ uid, studio }) {
  const [read, reload] = useRead(() => partnerDealTypesApi.licence(uid), [uid]);
  const [asking, setAsking] = useState(null);
  const [done, setDone] = useState('');
  const d = read.data;
  const open = d ? (d.recorded ? new Set(d.types || []) : new Set((d.catalogue || []).map((c) => c.type))) : new Set();
  return (
    <section className={`${CARD} flex flex-col gap-2.5 px-[18px] py-4`} data-testid="studio-deal-types">
      <h2 className={H2}>Partner deal types this studio may offer</h2>
      {read.status === 'loading' && !d ? <span className={SUB}>Reading…</span> : null}
      {read.status === 'error' ? <Unreadable text="Partner deal types could not be read." onRetry={reload} testId="studio-deal-types-unreadable" /> : null}
      {d ? (
        <>
          {!d.recorded ? <p className={`m-0 ${SUB}`} data-testid="studio-deal-types-unrecorded">{d.reason || NOT_RECORDED}</p> : null}
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {(d.catalogue || []).map((c) => (
              <li key={c.type} className="flex items-center justify-between gap-2 text-[13px] text-axal-ink dark:text-gray-100">
                <span>{c.label}</span>
                <button type="button" role="switch" aria-checked={open.has(c.type)} onClick={() => setAsking(c)} data-testid={`studio-deal-${c.type}`}
                  className={`relative h-5 w-9 rounded-full transition ${open.has(c.type) ? 'bg-axal-violet' : 'bg-axal-hairline dark:bg-gray-700'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${open.has(c.type) ? 'left-[18px]' : 'left-0.5'}`} />
                  <span className="sr-only">{open.has(c.type) ? 'Allowed' : 'Not allowed'}</span>
                </button>
              </li>
            ))}
          </ul>
          {done ? <p role="status" className={`m-0 ${SUB}`} data-testid="studio-deal-done">{done}</p> : null}
          <span className={SUB}>The studio’s partner invitations offer only the types allowed here. Each switch opens a dialog that asks for a reason.</span>
        </>
      ) : null}
      {asking ? (() => {
        const on = open.has(asking.type);
        const next = [...open].filter((t) => t !== asking.type);
        if (!on) next.push(asking.type);
        return (
          <ReasonDialog testId="deal-dialog" title={`${on ? 'Stop allowing' : 'Allow'} ${asking.label} for ${studio}?`}
            body={on ? `${studio}’s partner invitations stop offering ${asking.label}. Deals already signed keep their terms.${d.recorded ? '' : ' Saving records the list, so every other type stays allowed.'}` : `${studio}’s partner invitations may offer ${asking.label}.`}
            button={on ? 'Stop allowing' : 'Allow'} danger={on}
            run={(reason) => partnerDealTypesApi.save(uid, { types: next, reason })}
            onClose={() => setAsking(null)} onDone={() => { setDone(`${asking.label} ${on ? 'is no longer allowed' : 'is allowed'}.`); setAsking(null); reload(); }} />
        );
      })() : null}
    </section>
  );
}

export default function StudioView({ uid, requests, reloadAll }) {
  const phone = usePhoneWidth();
  const [now] = useState(() => Date.now());
  const [licence, reloadLicence] = useRead(() => programGrantsApi.licence(uid), [uid]);
  const [defaults, reloadDefaults] = useRead(() => programGrantsApi.defaults(), []);
  const [act, setAct] = useState(null);
  const [done, setDone] = useState('');
  const [historyOf, setHistoryOf] = useState(null);
  const read = licence.data;
  const items = requests.status === 'ready' ? requests.data?.items || [] : [];
  const list = defaults.data?.programs || [];
  const rows = useMemo(() => (read ? studioRows(read, list, items) : []), [read, list, items]);
  const tiles = useMemo(() => (read ? studioTiles(rows, items, read.licence.uid, now) : null), [read, rows, items, now]);
  const lic = read?.licence;
  const studio = lic?.brand_name || lic?.licence_ref || 'This studio';
  const frozen = lic?.status === 'suspended' ? FROZEN_LINE : null;
  const mine = items.filter((r) => r.licence?.uid === uid && r.status === 'open').map((r) => requestRow(r, now));
  const history = (read?.history || []).filter((e) => !historyOf || e.program_key === historyOf).map(historyRow);
  const after = (line) => { setAct(null); setDone(line); reloadLicence(); reloadAll(); };
  const defaultsOf = (key) => list.find((d) => d.program_key === key);

  if (licence.status === 'missing') {
    return (
      <div className="flex flex-col gap-3" data-testid="studio-missing">
        <p className="m-0 text-[14px] text-axal-ink dark:text-gray-100">No licence has this reference. It may have been removed from the ledger.</p>
        <Link to={GRANTS_PATH} className="font-bold text-axal-violet dark:text-violet-300">Back to Program grants</Link>
      </div>
    );
  }

  const actions = !phone && read ? (
    <>
      <Link to="/admin/licences" className={actionGhost}>Open the licence</Link>
      <button type="button" className={actionGhost} onClick={() => { saveCsv(`program-grants-${lic.licence_ref || uid}.csv`, studioCsv(rows)); setDone('The CSV of this studio’s programs is downloaded.'); }} data-testid="studio-csv">Download CSV</button>
    </>
  ) : null;

  return (
    <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="program-grants-studio">
      <AdminPageHeader
        crumb={{ label: 'Program grants', to: GRANTS_PATH, current: studio }}
        title={read ? studio : licence.status === 'error' ? 'Program grants' : 'Reading…'}
        pills={read ? [{ label: kindWord(lic.kind) }, { label: statusWord(lic.status), tone: lic.status === 'suspended' ? 'danger' : undefined }] : []}
        actions={actions}
        line={read ? `Licence ${lic.licence_ref || NOT_RECORDED}${lic.renews_on ? ` · renews ${dayWord(lic.renews_on)}` : ''}. The programs this studio may run, and on what terms.` : null}
        data-testid="studio-header"
      />
      {licence.status === 'error' ? <Unreadable text="This studio’s grants could not be read. That is not the same as none." onRetry={reloadLicence} testId="studio-unreadable" /> : null}
      {done ? <p role="status" className="m-0 rounded-[9px] bg-axal-ground px-3 py-2 text-[12.5px] text-axal-ink dark:bg-gray-800 dark:text-gray-100" data-testid="studio-done">{done}</p> : null}
      {frozen ? <p role="alert" className={`m-0 font-semibold ${ERR}`} data-testid="studio-frozen">{frozen}</p> : null}
      {read ? (
        <>
          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="studio-tiles">
            {tiles.map((t) => <Tile key={t.key} t={t} testId={`studio-tile-${t.key}`} />)}
          </div>
          {defaults.status === 'error' ? <Unreadable text="The default terms could not be read, so whether a grant is on its own terms is unknown." onRetry={reloadDefaults} testId="studio-defaults-unreadable" /> : null}
          {requests.status === 'error' ? <p className={`m-0 ${SUB}`} data-testid="studio-requests-unread">Requests could not be read, so a requested program shows as not granted here until they are.</p> : null}
          <div className="grid grid-cols-12 gap-3.5">
            <section className={`${CARD} col-span-12 flex min-w-0 flex-col gap-3 px-[18px] py-4 xl:col-span-8`} data-testid="studio-programs">
              <div className="flex items-baseline justify-between"><h2 className={H2}>Programs</h2><span className={SUB}>{rows.length} programs</span></div>
              {phone ? (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {rows.map((r) => (
                    <li key={r.program.key} className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid={`studio-card-${r.program.key}`}>
                      <span className="font-bold text-axal-ink dark:text-gray-100">{r.program.name}</span>
                      <span className={SUB}>{r.terms.join(' · ')}</span>
                      <span className="text-[12px] font-bold text-axal-ink dark:text-gray-100">{r.grantWord}</span>
                      <span className="flex flex-wrap gap-2">{r.actions.filter((a) => a.key !== 'history').map((a) => <button key={a.key} type="button" disabled={a.disabled} className={LINKBTN} onClick={() => setAct({ key: a.key, row: r })}>{a.label}</button>)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[880px] border-collapse text-left text-[12.5px]">
                    <thead>
                      <tr className={EYE}>
                        {['Program', 'Grant', 'Period', 'Key terms', 'Schedule', 'In use', ''].map((h, i) => <th key={h || i} scope="col" className="py-1.5 pr-3 font-bold">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.program.key} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid={`studio-row-${r.program.key}`}>
                          <th scope="row" className="py-2 pr-3 font-normal"><span className="block font-bold text-axal-ink dark:text-gray-100">{r.program.name}</span><span className={SUB}>{r.program.group}</span></th>
                          <td className="py-2 pr-3 font-semibold text-axal-ink dark:text-gray-100">{r.grantWord}{r.cell.waiting ? <span className="block text-[11.5px] font-normal text-amber-800 dark:text-amber-300">{r.cell.sub}</span> : null}</td>
                          <td className={`py-2 pr-3 ${MONO}`}>{r.period}</td>
                          <td className="py-2 pr-3">
                            {r.terms.map((t, i) => <span key={t} className={`block ${i ? SUB : 'text-axal-ink dark:text-gray-100'}`}>{t}</span>)}
                            {r.changed.length ? <span className="mt-0.5 inline-flex rounded-full bg-axal-lavender px-2 py-0.5 text-[11px] font-bold text-axal-violet dark:bg-violet-950/50 dark:text-violet-300" title={r.changed.join(', ')}>Changed</span> : null}
                          </td>
                          <td className={`py-2 pr-3 ${MONO}`}>{r.schedule}</td>
                          <td className="py-2 pr-3" data-testid={`studio-inuse-${r.program.key}`}>{r.inUse ? <><span className="block font-semibold text-axal-muted">{r.inUse.text}</span><span className={SUB}>{r.inUse.reason}</span></> : '—'}</td>
                          <td className="py-2">
                            <span className="flex flex-col items-start gap-1">
                              {r.actions.map((a) => (
                                <button key={a.key} type="button" disabled={a.disabled} title={a.disabled ? FROZEN_LINE : undefined} className={LINKBTN}
                                  onClick={() => (a.key === 'history' ? setHistoryOf(r.program.key) : setAct({ key: a.key, row: r }))} data-testid={`studio-act-${r.program.key}-${a.key}`}>{a.label}</button>
                              ))}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <span className={SUB}>HQ only and not-ready programs show their reason and no action. In use waits for the studios’ program figures.</span>
            </section>

            <div className="col-span-12 flex flex-col gap-3.5 xl:col-span-4">
              <DealTypes uid={uid} studio={studio} />
              <section className={`${CARD} flex flex-col gap-2 px-[18px] py-4`} data-testid="studio-requests">
                <div className="flex items-baseline justify-between"><h2 className={H2}>Requests from {studio}</h2><span className={SUB}>{requests.status === 'ready' ? mine.length : ''}</span></div>
                {requests.status === 'error' ? <span className={ERR}>Requests could not be read.</span> : !mine.length ? <span className={SUB}>No request is waiting.</span> : mine.map((m) => (
                  <div key={m.uid} className="flex items-start justify-between gap-2" data-testid={`studio-request-${m.uid}`}>
                    <span><b className="text-[13px] text-axal-ink dark:text-gray-100">{m.program} · {m.asksFor}</b><span className={`block ${m.sla === 'past' ? `font-semibold ${ERR}` : SUB}`}>Sent {m.sent} · waiting {m.waiting}{m.slaWord ? ` · ${m.slaWord.toLowerCase()}` : ''}</span></span>
                    <button type="button" className={actionGhost} onClick={() => setAct({ key: 'answer', request: m })}>Answer</button>
                  </div>
                ))}
              </section>
              <section className={`${CARD} flex flex-col gap-2 px-[18px] py-4`} data-testid="studio-history">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className={H2}>Recent changes</h2>
                  {historyOf ? <button type="button" className={LINKBTN} onClick={() => setHistoryOf(null)}>Show every program</button> : null}
                </div>
                {!history.length ? <span className={SUB}>No change is recorded{historyOf ? ' for this program' : ''}.</span> : (
                  <ol className="m-0 flex list-none flex-col gap-2 p-0">
                    {history.map((h) => (
                      <li key={h.id} className="text-[12.5px] text-axal-ink dark:text-gray-100">
                        <span className={`block ${EYE}`}>{h.when}</span>{h.what}{h.reason ? <span className={`block ${SUB}`}>{h.reason}</span> : null}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </div>
        </>
      ) : null}

      {act ? (() => {
        const r = act.row;
        const name = r?.program.name;
        const close = () => setAct(null);
        if (act.key === 'answer') {
          const row = act.request || requestRow(r.request, now);
          return <AnswerDialog row={row} onClose={close} onDone={(choice) => after(choice === 'decline' ? `${row.program}: the request is declined.` : `${row.program}: the request is approved.`)} />;
        }
        if (act.key === 'grant' || act.key === 'change') {
          return (
            <GrantLightbox mode={act.key} licence={lic} defaults={defaultsOf(r.program.key)} grant={r.grant}
              startTerms={r.grant?.state === 'draft' ? r.grant.terms : undefined} request={r.request}
              onClose={close} onDone={() => after(act.key === 'change' ? `${name}: terms saved.` : `${name} granted to ${studio}.`)} />
          );
        }
        const copy = {
          pause: { title: `Pause ${name} for ${studio}?`, body: 'New sign-ups stop. People already in keep their access. The studio sees ‘Paused by HQ’ with your reason.', button: 'Pause', danger: true, run: (reason) => programGrantsApi.pause(uid, r.program.key, { reason }), line: `${name} is paused.` },
          resume: { title: `Resume ${name} for ${studio}?`, body: 'Sign-ups open again on the grant’s terms.', button: 'Resume', run: (reason) => programGrantsApi.resume(uid, r.program.key, { reason }), line: `${name} is resumed.` },
          end: { title: `End ${name} for ${studio}?`, body: 'No new cohort or sign-up opens. To run it again, HQ grants it again.', button: 'End grant', danger: true, run: (reason) => programGrantsApi.end(uid, r.program.key, { reason }), line: `${name} is ended.` },
          schedule: { title: `Send ${name}’s schedule to ${studio}?`, body: 'The schedule is built from this grant’s terms and sent for signature to the licence’s principal administrator. The grant is in force once it is signed.', button: 'Send schedule', run: (reason) => programGrantsApi.sendSchedule(uid, r.program.key, { reason }), line: `${name}’s schedule is sent for signature.` },
        }[act.key];
        if (!copy) return null;
        const frozenHere = act.key === 'resume' || act.key === 'schedule' ? frozen : null;
        return <ReasonDialog testId={`studio-${act.key}-dialog`} {...copy} frozen={frozenHere} onClose={close} onDone={() => after(copy.line)} />;
      })() : null}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Unrecorded } from '../../ui/Honesty.jsx';
import { companyEinApi } from '../../lib/api/companyEin.js';
import { PACKET_NOT_BUILT, PACKET_NOT_BUILT_STATUSES } from '../../lib/incorporationPricing.js';
import { companyPathFor } from '../account/companies/companiesModel.js';
import { BTN_TEXT, FIELD } from '../team/teamUi.jsx';
import { orderCompany } from './incorporateAdapter.js';
import { timeline } from './incorporateModel.js';

/**
 * D1414 (#3696, INC3b, INC5c, INC5h3) — the order's status, then two rows
 * that are not statuses.
 *
 *   Submitted · Packet ready · Filed   from the order's own row (D601), each
 *                                      done or waiting, never guessed
 *   EIN                                `GET /api/company-ein/:projectId` (D579):
 *                                      "•••• 1234", or Not recorded with Add EIN
 *   the company                        "[Company] now appears in Portfolio …
 *                                      Filing in progress" with Open company,
 *                                      only when the order carries
 *                                      `company_uid` (#3855, through
 *                                      `incorporateAdapter.orderCompany`)
 *
 * There is no bank row (owner answer Q7).
 */

function EinRow({ projectId }) {
  const [read, setRead] = useState({ status: 'loading' });
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const [said, setSaid] = useState('');
  const load = () => {
    if (!projectId) { setRead({ status: 'none' }); return; }
    companyEinApi.read(projectId).then((r) => setRead({ status: 'ready', value: r })).catch(() => setRead({ status: 'error' }));
  };
  useEffect(load, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setSaid('');
    try { await companyEinApi.save(projectId, value.trim()); setAdding(false); setValue(''); load(); } catch (e) {
      setSaid(e?.code === 'ein_invalid' ? 'Enter the EIN as NN-NNNNNNN.' : 'The EIN could not be saved. Try again.');
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-axal-hairline pt-3 dark:border-gray-800" data-testid="timeline-ein">
      <span className="w-[120px] font-mono text-[10.5px] uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">EIN</span>
      {read.status === 'loading' ? <span className="text-[12.5px] text-axal-muted dark:text-gray-400">Reading…</span>
        : read.status === 'error' ? <span className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="timeline-ein-unread">The EIN could not be read</span>
          : read.value?.recorded ? <span className="font-mono text-[13px] text-axal-ink dark:text-gray-100" data-testid="timeline-ein-masked">{read.value.masked}</span>
            : (
              <span className="flex flex-wrap items-center gap-2">
                <Unrecorded />
                {read.value?.can_edit && !adding ? <button type="button" className={BTN_TEXT} onClick={() => setAdding(true)} data-testid="timeline-ein-add">Add EIN</button> : null}
                {adding ? (
                  <>
                    <input aria-label="EIN" className={`${FIELD} !w-[150px]`} value={value} onChange={(e) => setValue(e.target.value)} placeholder="NN-NNNNNNN" autoComplete="off" />
                    <button type="button" className={BTN_TEXT} onClick={save}>Save</button>
                  </>
                ) : null}
              </span>
            )}
      {said ? <span role="alert" className="text-[12.5px] text-axal-destructive dark:text-red-300">{said}</span> : null}
    </div>
  );
}

export default function IncorporationTimeline({ order, projectId, projectName = null }) {
  const steps = timeline(order);
  const company = orderCompany(order);
  return (
    <section className="rounded-axal-lg border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-700 dark:bg-gray-900" data-testid="incorporation-timeline">
      <h2 className="m-0 mb-3 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">Status</h2>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {steps.map((s) => (
          <li key={s.key} className="flex items-start gap-3" data-testid={`timeline-${s.key}`} data-done={s.done ? 'true' : 'false'}>
            <span aria-label={s.done ? 'Done' : 'Waiting'} role="img"
              className={`inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${s.done ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'}`}>
              {s.done ? '✓' : '…'}
            </span>
            <span className="flex flex-col">
              <b className="text-[13.5px] text-axal-ink dark:text-gray-100">{s.label}</b>
              <span className="text-[12.5px] text-axal-muted dark:text-gray-400">{s.line}</span>
            </span>
          </li>
        ))}
      </ol>
      {order && PACKET_NOT_BUILT_STATUSES.includes(order.status) ? <p className="m-0 mt-3 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="timeline-packet-not-built">{`${PACKET_NOT_BUILT} Your receipt is in Billing.`}</p> : null}
      <div className="mt-3 flex flex-col gap-3">
        <EinRow projectId={projectId} />
      </div>
      {company.available ? (
        <p className="m-0 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-axal-md border border-violet-200 bg-axal-lavender px-3 py-2.5 text-[13px] text-axal-ink dark:border-violet-800 dark:bg-violet-900/20 dark:text-gray-100" data-testid="timeline-company">
          <span>{company.value.name || 'The company'} now appears in Portfolio{projectName ? `, linked to ${projectName}` : ''}. Filing in progress.</span>
          <Link to={companyPathFor(company.value.uid)} className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" data-testid="timeline-open-company">Open company</Link>
        </p>
      ) : null}
    </section>
  );
}

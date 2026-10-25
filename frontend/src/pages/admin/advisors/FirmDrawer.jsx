import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { adminPartnerFirmsApi } from '../../../lib/api/adminPartnerFirms.js';
import { reportError } from '../../../lib/log';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../../ui';
import { DEALS_PATH, dealHref, refusalText } from '../partners/partnersDeskModel';
import { DealStatePill, Done, EYE, Fact, LINK, MONO, Pill, Refusal, SUB, TD, TH } from '../partners/parts';
import FirmAttachDialog from './FirmAttachDialog';
import {
  DEALS_ELSEWHERE, LIST_FIRST, SETTLEMENTS_ELSEWHERE, detachCopy, detachDone, directoryCopy, directorySavedLine, drawerOf, profileOwner,
} from './firmsModel';

/**
 * D979 (#2765) — AP6, one firm's drawer on Advisors & Partners › Firms, from
 * `GET /api/admin/partners/firms/:id`. Each block answers alone: a failed
 * block says "Could not be read" with Try again, and the rest stand.
 *
 * Two kinds of change are made here, each behind a dialog that says what it
 * changes (never a browser pop-up): the directory switches (the existing
 * `POST /api/admin/partners/:id/directory`; Featured needs listing, so on an
 * unlisted firm it is unavailable and reads "List the firm first.") and
 * attaching or detaching an account (D952's firm link, AP9d and AP10). Deals
 * are read here and ended on Partner invitations; settlements are HQ's, read
 * here and drafted in Contracts.
 */

const SECTION = 'flex flex-col gap-2.5 border-t border-axal-hairline pt-3.5 first:border-t-0 first:pt-0 dark:border-gray-700';

function Section({ title, meta, children, testId }) {
  return (
    <section className={SECTION} data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={EYE}>{title}</h3>
        {meta ? <span className={`${MONO} text-axal-muted`}>{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

function BlockFailed({ what, onRetry, testId }) {
  return (
    <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-[12.5px] text-red-700 dark:text-red-300" data-testid={testId}>
      {`${what} could not be read. That is not the same as none.`}
      <button type="button" className="font-semibold underline" onClick={onRetry}>Try again</button>
    </p>
  );
}

/** A confirm that says what it changes; the refusal stays inside it. */
function Confirm({ copy, onClose, onConfirm, danger, testId }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const go = async () => {
    setBusy(true); setRefusal(null);
    try { await onConfirm(); } catch (e) { setRefusal(refusalText(e, 'firm')); setBusy(false); }
  };
  const close = () => { if (!busy) onClose(); };
  return (
    <Lightbox label={copy.title} title={copy.title} onClose={close} testId={testId}
      footer={(
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={actionGhost} onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className={danger ? actionDanger : actionPrimary} onClick={go} disabled={busy} data-testid={`${testId}-go`}>{busy ? 'Saving…' : copy.action}</button>
          </div>
          <Refusal text={refusal} testId={`${testId}-refusal`} />
        </div>
      )}>
      <p className="m-0 px-5 py-4 text-[13px] leading-normal text-axal-ink dark:text-gray-100" data-testid={`${testId}-body`}>{copy.body}</p>
    </Lightbox>
  );
}

function Switch({ label, on, disabled, note, onAsk, testId }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="flex flex-col">
        <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{label}</span>
        <span className={SUB} data-testid={`${testId}-note`}>{note}</span>
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onAsk} data-testid={testId}
        className={`relative h-6 w-11 flex-none rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'border-axal-violet bg-axal-violet' : 'border-axal-hairline bg-axal-ground dark:border-gray-700 dark:bg-gray-800'}`}>
        <span aria-hidden="true" className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

export default function FirmDrawer({ firmId, links, onClose, onChanged }) {
  const [read, setRead] = useState({ status: 'loading', data: null, error: null });
  const [tick, setTick] = useState(0);
  const [ask, setAsk] = useState(null);
  const [attaching, setAttaching] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let live = true;
    setRead((r) => ({ ...r, status: 'loading' }));
    adminPartnerFirmsApi.get(firmId).then(
      (data) => { if (live) setRead({ status: 'ready', data, error: null }); },
      (error) => { reportError('advisors-partners:firm', error); if (live) setRead({ status: 'error', data: null, error }); },
    );
    return () => { live = false; };
  }, [firmId, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const changed = (line) => { setAsk(null); setAttaching(false); setDone(line); reload(); onChanged(); };

  const d = read.data ? drawerOf(read.data) : null;
  const firm = read.data?.firm || null;
  const title = d ? d.title : 'Firm';

  const askDirectory = (which) => {
    const next = !d.directory[which];
    const copy = directoryCopy(firm, which, next, d.directory);
    setAsk({ kind: 'directory', copy, run: async () => changed(directorySavedLine(await api.adminSetPartnerDirectory(firm.id, copy.payload))) });
  };
  const askDetach = (account) => {
    const copy = detachCopy(account, firm);
    setAsk({ kind: 'detach', copy, run: async () => { await api.adminPartners.setFirmLink(account.id, null); changed(detachDone(account, firm)); } });
  };

  return (
    <Lightbox label={title} eyebrow="Firm" title={title} sub={d ? [d.sub, d.specialization].filter(Boolean).join(' · ') || null : null} onClose={onClose} width={720} testId="ap-firm-drawer"
      footer={<div className="flex justify-end"><button type="button" className={actionGhost} onClick={onClose}>Close</button></div>}>
      <div className="flex flex-col gap-3.5 px-5 py-4">
        {read.status === 'loading' && !d ? <span className="font-mono text-[12px] text-axal-muted" data-testid="ap-firm-reading">Reading…</span> : null}
        {read.status === 'error' ? (
          Number(read.error?.status) === 404
            ? <p className={`m-0 ${SUB}`} data-testid="ap-firm-gone">This firm no longer exists.</p>
            : <BlockFailed what="This firm" onRetry={reload} testId="ap-firm-unreadable" />
        ) : null}
        {done ? <Done testId="ap-firm-done"><span>{done}</span></Done> : null}
        {d ? (
          <>
            {d.inactive ? <Pill tone="muted" testId="ap-firm-inactive">Inactive firm</Pill> : null}
            <Section title="Accounts" meta={d.accounts.state === 'ready' ? String(d.accounts.rows.length) : null} testId="ap-firm-accounts">
              {d.accounts.state === 'unreadable' ? <BlockFailed what="The accounts" onRetry={reload} testId="ap-firm-accounts-unreadable" /> : null}
              {d.accounts.state === 'ready' && d.accounts.rows.length === 0 ? <p className={`m-0 ${SUB}`}>No account is attached to this firm.</p> : null}
              {d.accounts.state === 'ready' ? (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {d.accounts.rows.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 text-[13px] text-axal-ink dark:text-gray-100" data-testid={`ap-firm-account-${a.id}`}>
                      <span className="flex flex-col"><span className="font-bold">{a.name}</span><span className={SUB}>{a.inactive ? `${a.sub} · account inactive` : a.sub}</span></span>
                      <button type="button" className={actionGhost} onClick={() => askDetach(a)} data-testid={`ap-firm-detach-${a.id}`}>Detach</button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <button type="button" className={`${actionGhost} self-start`} onClick={() => setAttaching(true)} disabled={!links} data-testid="ap-firm-attach">Attach an account</button>
              {!links ? <span className={SUB}>The partner accounts are still being read, or could not be; attaching waits for them.</span> : null}
            </Section>

            <Section title="Public directory" testId="ap-firm-directory">
              <Switch label="Listed" on={d.directory.listed} onAsk={() => askDirectory('listed')} testId="ap-firm-listed"
                note={d.directory.listed ? 'The firm shows in the public directory.' : 'The firm does not show in the public directory.'} />
              <Switch label="Featured" on={d.directory.featured} disabled={!d.directory.listed} onAsk={() => askDirectory('featured')} testId="ap-firm-featured"
                note={!d.directory.listed ? LIST_FIRST : d.directory.featured ? 'Drawn above the standard rows, marked as featured.' : 'Among the standard rows.'} />
              <span className={SUB}>{d.directory.decided ? `Each switch opens a confirm dialog. Last changed ${d.directory.decided}.` : 'Each switch opens a confirm dialog.'}</span>
            </Section>

            <Section title="Deals" testId="ap-firm-deals">
              {d.deals.state === 'unreadable' ? <BlockFailed what="The deals" onRetry={reload} testId="ap-firm-deals-unreadable" /> : null}
              {d.deals.state === 'ready' && d.deals.rows.length === 0 ? <p className={`m-0 ${SUB}`}>No deal is on record for this firm’s accounts.</p> : null}
              {d.deals.state === 'ready' ? d.deals.rows.map((x) => (
                <div key={x.id} className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid={`ap-firm-deal-${x.id}`}>
                  <span className="flex flex-wrap items-center gap-1.5"><Pill tone="violet">{x.type}</Pill><DealStatePill status={x.status} /></span>
                  <span className={`${MONO} font-semibold`}>{x.term}</span>
                  <span className={SUB}>{`Tiers granted: ${x.tiers} · Referral redemptions ${x.redemptions}`}</span>
                  <Link to={dealHref(x.id)} className={`${LINK} self-start`}>Open the deal ›</Link>
                </div>
              )) : null}
              {d.deals.state === 'ready' && d.deals.more ? <span className={SUB}>The newest 50 deals are drawn.</span> : null}
              <Link to={DEALS_PATH} className={`${actionGhost} self-start`} data-testid="ap-firm-deals-open">Open on Partner invitations ›</Link>
              <span className={SUB}>{DEALS_ELSEWHERE}</span>
            </Section>

            <Section title="Settlements" testId="ap-firm-settlements">
              {d.settlements.state === 'hq' ? <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="ap-firm-settlements-hq">{d.settlements.text}</p> : null}
              {d.settlements.state === 'unreadable' ? <BlockFailed what="The settlements" onRetry={reload} testId="ap-firm-settlements-unreadable" /> : null}
              {d.settlements.state === 'ready' && d.settlements.rows.length === 0 ? <p className={`m-0 ${SUB}`}>No settlement is on record for this firm’s deals.</p> : null}
              {d.settlements.state === 'ready' && d.settlements.rows.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
                    <caption className="sr-only">Settlements for this firm’s deals</caption>
                    <thead><tr className="border-b border-axal-hairline dark:border-gray-700">{['Kind', 'Direction', 'Amount', 'Due', 'State'].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
                    <tbody>
                      {d.settlements.rows.map((s) => (
                        <tr key={s.id} className="border-b border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid={`ap-firm-settlement-${s.id}`}>
                          <td className={TD}>{s.kind}</td><td className={TD}>{s.direction}</td><td className={`${TD} ${MONO}`}>{s.amount}</td><td className={`${TD} ${MONO}`}>{s.due}</td>
                          <td className={TD}><Pill tone={s.state.tone}><span aria-hidden="true">{s.state.glyph}</span>{s.state.word}</Pill></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {d.settlements.state === 'ready' && d.settlements.more ? <span className={SUB}>The latest 50 by due date are drawn.</span> : null}
              {d.settlements.state !== 'hq' ? <span className={SUB}>{SETTLEMENTS_ELSEWHERE}</span> : null}
            </Section>

            <Section title="Partner profile" testId="ap-firm-profile">
              {d.profiles.state === 'unreadable' ? <BlockFailed what="The partner profiles" onRetry={reload} testId="ap-firm-profile-unreadable" /> : null}
              {d.profiles.state === 'ready' && d.profiles.rows.length === 0 ? <p className={`m-0 ${SUB}`}>No partner profile is recorded for this firm’s accounts.</p> : null}
              {d.profiles.state === 'ready' ? d.profiles.rows.map((p) => (
                <div key={p.userId} className="flex flex-col gap-2" data-testid={`ap-firm-profile-${p.userId}`}>
                  {d.profiles.rows.length > 1 ? <span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">{profileOwner(d, p.userId)}</span> : null}
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">{p.facts.map(([k, v]) => <Fact key={k} label={k}>{v}</Fact>)}</div>
                </div>
              )) : null}
            </Section>

            <Section title="Office hours" testId="ap-firm-office-hours">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">{d.officeHours.map(([k, v]) => <Fact key={k} label={k}>{v}</Fact>)}</div>
            </Section>
          </>
        ) : null}
      </div>

      {ask ? <Confirm copy={ask.copy} onClose={() => setAsk(null)} onConfirm={ask.run} danger={ask.kind === 'detach'} testId={`ap-firm-${ask.kind}-confirm`} /> : null}
      {attaching && links ? <FirmAttachDialog links={links} firm={firm} onClose={() => setAttaching(false)} onDone={changed} /> : null}
    </Lightbox>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOfFundsApi } from '../../../lib/api/useOfFunds';
import Sheet from '../../../ui/Sheet.jsx';
import { BTN_GHOST, Card, DialogButtons, EYEBROW, H3, LINK, MONO, MUTED, NotRecorded, Pill, REVIEWED, ReviewLatest, Skeleton, isStale, refusal } from './UseOfFundsParts';
import { foundersView, linkBody, paidForBy, pickerRows, raiseDiffers, suggestion } from './capTableLinkModel';

/**
 * D6085 (#6085) — the plan's link to the cap-table scenario that pays for it
 * (Raise v2 addendum, RA-32 to RA-34): "Paid for by" in the plan's header
 * with Change, Founders after the round (Modelled), and the picker. Linking
 * changes neither the plan nor the scenario; a raise that differs is shown,
 * with both amounts.
 */

const STATE_TONE = { linked: 'neutral', not_linked: 'dashed', empty: 'dashed', deleted: 'amber', unreadable: 'red' };

/** "Paid for by" (RA-32 A, RA-33): the linked scenario, or why there is none, and the one action that fits. */
export function PaidForBy({ link, latest, canWrite, onPick, onRetry }) {
  const v = paidForBy(link, latest);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-axal-hairline bg-white px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900" data-testid="uof-paid-for-by" data-state={v.state}>
      <span className={EYEBROW}>Paid for by</span>
      {v.name ? (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <Link to={v.href} className={`${LINK} text-[13px]`} data-testid="uof-paid-for-by-name">{v.name}</Link>
          <Pill tone="dashed" testId="uof-paid-for-by-tag">◇ {v.tag}</Pill>
        </span>
      ) : <Pill tone={STATE_TONE[v.state] === 'red' ? 'amber' : STATE_TONE[v.state]} testId="uof-paid-for-by-state">{v.state === 'deleted' ? '! ' : v.state === 'unreadable' ? '✕ ' : ''}{v.label}</Pill>}
      <span className={`min-w-0 text-[11.5px] ${MUTED}`} data-testid="uof-paid-for-by-sub">{v.sub}</span>
      {v.state === 'empty' ? <Link to={v.href} className={`${LINK} text-[12.5px]`} data-testid="uof-paid-for-by-model">Model a round in Cap table</Link> : null}
      {v.action === 'Try again' ? <button type="button" className={`${BTN_GHOST} ml-auto`} onClick={onRetry} data-testid="uof-paid-for-by-retry">Try again</button> : null}
      {v.action && v.action !== 'Try again' && canWrite ? <button type="button" className={`${BTN_GHOST} ml-auto max-md:w-full`} onClick={onPick} data-testid="uof-paid-for-by-act">{v.action}</button> : null}
      {v.differs ? (
        <p className="m-0 basis-full text-[11.5px] font-semibold text-amber-800 dark:text-amber-300" data-testid="uof-paid-for-by-differs">
          <Pill tone="amber">! Raise differs</Pill> {v.differs.text} Linking changes neither.
        </p>
      ) : null}
    </div>
  );
}

/** Founders after the round (RA-32 A; RA-34 D stacks it into cards on a phone). Nothing is drawn until a scenario is linked. */
export function FoundersAfterCard({ link, phone = false, onRetry }) {
  const v = foundersView(link);
  if (v.state === 'hidden') return null;
  const title = <span className="flex items-center gap-2">Founders after the round <Pill tone="dashed">◇ Modelled</Pill></span>;
  if (v.state === 'unavailable') {
    return (
      <Card title={title} testId="uof-founders">
        <p role="status" className={`m-0 text-[12.5px] ${MUTED}`} data-testid="uof-founders-unavailable">✕ Unavailable. {v.reason}</p>
        {onRetry ? <button type="button" className={`${BTN_GHOST} w-fit`} onClick={onRetry}>Try again</button> : null}
      </Card>
    );
  }
  if (v.state === 'not_recorded') return <Card title={title} testId="uof-founders"><NotRecorded reason={v.reason} testId="uof-founders-not-recorded" /></Card>;
  return (
    <Card title={title} meta={<Link to={v.href} className={`${LINK} text-[12.5px]`} data-testid="uof-founders-open">Open in Cap table</Link>} testId="uof-founders">
      {phone ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={v.caption} data-testid="uof-founders-cards">
          {[...v.rows, ...(v.together ? [{ founder: 'Founders together', ...v.together }] : [])].map((r) => (
            <li key={r.founder} className="flex flex-col gap-1 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800">
              <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.founder}</span>
              <span className={`${MONO} text-[12.5px] text-axal-ink dark:text-gray-200`}>Before {r.before} · After {v.round} {r.after} · {r.change}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12.5px]" data-testid="uof-founders-table">
            <caption className="sr-only">{v.caption}</caption>
            <thead><tr>{['Founder', 'Before the round · Founding', `After ${v.round}`, 'Change'].map((h, i) => <th key={h} className={`border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800 ${EYEBROW} ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody>
              {v.rows.map((r) => (
                <tr key={r.founder} data-testid="uof-founders-row">
                  <td className="border-b border-axal-hairline px-2 py-1.5 text-axal-ink dark:border-gray-800 dark:text-gray-100">{r.founder}</td>
                  <td className={`border-b border-axal-hairline px-2 py-1.5 text-right ${MONO} dark:border-gray-800`}>{r.before}</td>
                  <td className={`border-b border-axal-hairline px-2 py-1.5 text-right ${MONO} dark:border-gray-800`}>{r.after}</td>
                  <td className={`border-b border-axal-hairline px-2 py-1.5 text-right ${MONO} dark:border-gray-800`}>{r.change}</td>
                </tr>
              ))}
              {v.together ? (
                <tr className="font-bold" data-testid="uof-founders-together">
                  <td className="px-2 py-1.5 text-axal-ink dark:text-gray-100">Founders together</td>
                  <td className={`px-2 py-1.5 text-right ${MONO}`}>{v.together.before}</td>
                  <td className={`px-2 py-1.5 text-right ${MONO}`}>{v.together.after}</td>
                  <td className={`px-2 py-1.5 text-right ${MONO}`}>{v.together.change}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <p className={`m-0 text-[11.5px] ${MUTED}`}>{v.note}</p>
    </Card>
  );
}

/**
 * The picker (RA-32 B; a bottom sheet on a phone, RA-34 E): this venture's
 * cap-table scenarios, each with its investment, date and Raise differs; the
 * one whose investment matches the plan's raise is suggested. Link scenario
 * writes the pick with the revision the scenario was read at; Unlink clears it.
 */
export function CapTableLinkDialog({ projectId, scenario, onClose, onSaved, api = useOfFundsApi }) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [pick, setPick] = useState(scenario?.cap_table_scenario_uid ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setRead({ status: 'loading', data: null });
    api.capTableScenarios(projectId, scenario?.id).then(
      (d) => { if (alive) setRead({ status: 'ready', data: d }); },
      (e) => { if (alive) setRead({ status: e?.status === 403 ? 'refused' : 'unreadable', data: null, error: e }); },
    );
    return () => { alive = false; };
  }, [api, projectId, scenario?.id, tick]);
  const rows = pickerRows(read.data);
  const hint = suggestion(read.data);
  const current = scenario?.cap_table_scenario_uid ?? null;
  const chosen = rows.find((r) => r.uid === pick) || null;
  const save = async (uid) => {
    setBusy(true); setError(''); setStale(false);
    try {
      const body = linkBody(uid, scenario?.revision);
      await api.linkCapTable(projectId, scenario.id, body.cap_table_scenario_uid, body.expected_revision);
      onSaved(uid ? `${scenario?.name || 'This plan'} is now paid for by ${chosen?.name || 'the scenario you picked'}. Neither figure changed.` : 'The cap-table scenario is unlinked. The plan and the scenario are unchanged.');
    } catch (e) { setError(refusal(e)); setStale(isStale(e)); }
    setBusy(false);
  };
  return (
    <Sheet label="Which round pays for this plan?" title={`Which round pays for ${scenario?.name || 'this plan'}?`} sub="Cap-table scenarios are Modelled. Linking changes neither scenario nor the plan."
      onClose={onClose} width={640} phone="sheet" testId="uof-captable-picker"
      footer={(
        <div className="flex flex-wrap justify-between gap-2">
          {current ? <button type="button" className={BTN_GHOST} onClick={() => save(null)} disabled={busy} data-testid="uof-captable-unlink">Unlink</button> : <span />}
          <DialogButtons busy={busy} onClose={onClose} go={() => save(pick)} goLabel="Link scenario" disabled={!pick || pick === current || !scenario?.id} testId="uof-captable-save" />
        </div>
      )}>
      <div className="flex flex-col gap-2 text-axal-ink dark:text-gray-100">
        {read.status === 'loading' ? <Skeleton lines={3} testId="uof-captable-loading" /> : null}
        {read.status === 'refused' ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="uof-captable-refused">🔒 Use of funds is available to the venture founder or an admin.</p> : null}
        {read.status === 'unreadable' ? (
          <div className="flex flex-col gap-2" data-testid="uof-captable-unreadable">
            <p className={`m-0 text-[12.5px] ${MUTED}`}>✕ The cap-table scenarios couldn’t be read. Nothing was changed.</p>
            <button type="button" className={`${BTN_GHOST} w-fit`} onClick={() => setTick((n) => n + 1)}>Try again</button>
          </div>
        ) : null}
        {read.status === 'ready' && !rows.length ? (
          <div className="flex flex-col gap-1" data-testid="uof-captable-empty">
            <h3 className={H3}>No cap-table scenarios yet.</h3>
            <p className={`m-0 text-[12.5px] ${MUTED}`}>Model a round to see what founders keep.</p>
            <Link to="/raise/cap-table" className={`${LINK} text-[12.5px]`}>Model a round in Cap table</Link>
          </div>
        ) : null}
        {hint ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] dark:border-violet-800 dark:bg-violet-950" data-testid="uof-captable-suggestion">
            <span className="font-bold">{hint.text}</span><span className={MUTED}>{hint.why}</span>
            <button type="button" className={`${BTN_GHOST} ml-auto`} onClick={() => setPick(hint.uid)} data-testid="uof-captable-suggestion-pick">Pick it</button>
          </div>
        ) : null}
        {rows.length ? (
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" data-testid="uof-captable-options">
            <legend className="sr-only">Cap-table scenarios</legend>
            {rows.map((r) => (
              <label key={r.uid} className="flex min-h-[44px] items-start gap-2 rounded-lg border border-axal-hairline px-3 py-2 text-[13px] dark:border-gray-800" data-testid={`uof-captable-option-${r.uid}`}>
                <input type="radio" name="captable" checked={pick === r.uid} onChange={() => setPick(r.uid)} className="mt-1" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 font-bold">{r.name} <Pill tone="dashed">◇ Modelled</Pill>{r.differs ? <Pill tone="amber">! Raise differs</Pill> : null}{r.linked ? <span className={`text-[11px] ${MUTED}`}>· linked now</span> : null}</span>
                  <span className={`text-[11.5px] ${MUTED}`}>{r.sub}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {chosen?.differs ? (
          <p className="m-0 text-[12px] text-amber-800 dark:text-amber-300" data-testid="uof-captable-differs">{raiseDiffers(chosen.raise, chosen.name).text} Linking changes neither scenario nor the plan.</p>
        ) : null}
        {error ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="uof-captable-error">{error}</p> : null}
        {stale ? <ReviewLatest onReview={() => onSaved(REVIEWED)} /> : null}
      </div>
    </Sheet>
  );
}

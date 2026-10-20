import React, { useCallback, useEffect, useState } from 'react';
import { Pill } from '../../ui';
import {
  APPLICATION_LABEL, MAIL_NOTE, canDecline, canPick, isPickable, placesLine, refusalText, statusLabel, statusTone,
} from './programmeModel';

/**
 * D815 (#2261) — one programme's applicants, for its owner: a partner (D4) or
 * HQ on its own programme (D5).
 *
 * Each applicant shows their name, role, answers and availability, with Pick
 * and Decline once the programme has opened. The counter is "[n] of [n] places
 * filled", from the Worker. Picks are held to the places by the Worker
 * (D812): a pick past them is refused, and its sentence is shown here.
 *
 * NO EMAIL ADDRESS. The Worker sends none to an owner; testers are written to
 * from Axal VC Mail, which this page says (MAIL_NOTE).
 *
 * `api` is `{ applicants(uid), pick(appUid), decline(appUid) }`: the partner's
 * or HQ's methods from `lib/api/productTesting.js`.
 */
const ghost = 'rounded-lg border border-axal-hairline px-2.5 py-1 text-[12px] font-semibold hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800';
const baseButton = 'rounded-lg bg-axal-violet px-2.5 py-1 text-[12px] font-semibold text-white disabled:opacity-50';

export default function ProgrammeApplicants({ uid, api, classes = {}, onChanged }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [busy, setBusy] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const button = classes.button || baseButton;

  const load = useCallback(() => {
    setState((s) => ({ status: 'loading', data: s.data }));
    return Promise.resolve()
      .then(() => api.applicants(uid))
      .then((data) => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'unreadable', data: null }));
  }, [api, uid]);
  useEffect(() => { load(); }, [load]);

  async function decide(appUid, decision) {
    setBusy(appUid);
    setRefusal(null);
    try {
      await api[decision](appUid);
      await load();
      onChanged?.();
    } catch (err) {
      setRefusal(refusalText(err, decision === 'pick'
        ? 'Axal could not pick this tester. Try again.'
        : 'Axal could not decline this application. Try again.'));
    } finally {
      setBusy(null);
    }
  }

  if (state.status === 'loading' && !state.data) {
    return <p className="text-[12.5px] text-axal-muted" aria-busy="true" data-testid="applicants-loading">Loading applicants…</p>;
  }
  if (state.status === 'unreadable') {
    return (
      <div role="alert" className="text-[12.5px] text-red-700 dark:text-red-300" data-testid="applicants-unreadable">
        The applicants could not be read. This is not a sign that there are none.{' '}
        <button type="button" onClick={load} className="font-semibold underline" data-testid="applicants-retry">Try again</button>
      </div>
    );
  }
  const programme = state.data?.programme || null;
  const items = Array.isArray(state.data?.items) ? state.data.items : [];
  const pickable = isPickable(programme);

  return (
    <div className="space-y-3" data-testid="programme-applicants">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-bold tabular-nums" data-testid="applicants-places">{placesLine(programme)}</span>
        {programme && <Pill tone={statusTone(programme.status)}>{statusLabel(programme.status)}</Pill>}
      </div>
      <p className="text-[12px] text-axal-muted" data-testid="applicants-mail-note">{MAIL_NOTE}</p>
      {!pickable && programme && (
        <p className="text-[12px] text-axal-muted" data-testid="applicants-not-open">Testers are picked once the programme has opened.</p>
      )}
      {refusal && <p role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid="applicants-refusal">{refusal}</p>}
      {items.length === 0 ? (
        <p className="text-[12.5px] text-axal-muted" data-testid="applicants-empty">No one has applied yet.</p>
      ) : (
        <ul className="divide-y divide-axal-hairline rounded-xl border border-axal-hairline dark:divide-gray-800 dark:border-gray-800">
          {items.map((a) => (
            <li key={a.uid} className="space-y-2 p-3" data-testid={`applicant-${a.uid}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-[13px] font-bold">{a.name || 'Name not recorded'}</span>
                  <span className="ml-2 text-[11.5px] capitalize text-axal-muted">{a.role}</span>
                  {!a.consented && <span className="ml-2 text-[11px] text-axal-faint">Not agreed to be emailed</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={a.status === 'picked' ? 'ok' : a.status === 'declined' ? 'neutral' : 'info'}>{APPLICATION_LABEL[a.status] || a.status}</Pill>
                  {pickable && canPick(a) && (
                    <button type="button" disabled={busy === a.uid} onClick={() => decide(a.uid, 'pick')} className={button}
                      data-testid={`applicant-pick-${a.uid}`}>Pick</button>
                  )}
                  {pickable && canDecline(a) && (
                    <button type="button" disabled={busy === a.uid} onClick={() => decide(a.uid, 'decline')} className={ghost}
                      data-testid={`applicant-decline-${a.uid}`}>Decline</button>
                  )}
                </div>
              </div>
              {(programme?.questions || []).length > 0 && (
                <dl className="space-y-1 text-[12.5px]">
                  {programme.questions.map((q, i) => (
                    <div key={i}>
                      <dt className="text-[11px] font-semibold text-axal-faint">{q}</dt>
                      <dd>{(Array.isArray(a.answers) && a.answers[i]) || 'No answer recorded'}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {a.availability && <p className="text-[12px] text-axal-muted">Availability: {a.availability}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

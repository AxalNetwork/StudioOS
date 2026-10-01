import React, { useCallback, useEffect, useState } from 'react';
import { Card, Pill } from '../../../ui';
import { api } from '../../../lib/api';
import {
  NothingYet, StatedLimit, Unrecorded, ZoneBody, ZoneHeading, ghostButtonClass,
} from '../expertise/kit';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { ConsentLog, consentRecord, stateOf } from '../../IntroductionsPanel';

/**
 * Network · Introductions — the propositions this advisor may answer.
 *
 * BOTH SIDES OF THE CONSENT, BECAUSE THE RESPONSE CARRIES BOTH (D392). This
 * docblock used to say `propositionDto` returns only your row, so "accepted"
 * could not tell "waiting on them" from "connected", and the chip said "You
 * accepted" for that reason. The endpoint this page calls has returned the
 * counterpart's answer beside yours — `counterpart_status` and
 * `counterpart_responded_at`, read from their mirror row — since the partner
 * side's consent work, and `IntroductionsPanel` has drawn the gate from it. This
 * page now uses the same `stateOf` and `consentRecord`, so an advisor and a
 * partner see one introduction in the same state:
 * Requested · One side · Both agreed · Made, with Declined and Lapsed terminal.
 * A proposition with no mirror row (hand-curated) says the other side "has not
 * been asked", never "not answered".
 *
 * `Made` IS A RECORD, NOT AN INFERENCE. Two consents mean the introduction MAY
 * happen; `intro_terms.made_at` says it did. `PUT /propositions/:uid/terms`
 * writes only the caller's own row, so an advisor records it here once both
 * sides have agreed — and the Made chip selects rows somebody marked, not rows
 * the page guessed at.
 *
 * WHAT AN ADVISOR MAY DO HERE. Answer propositions, and read their own credit
 * balance. They may NOT ask for an introduction: `/introductions/request`,
 * `/introductions/` and `/introductions/quota` are all `investor_only` and 403
 * every other role. That is a boundary, stated below rather than rendered as
 * an absent button nobody can explain.
 */

const STATE_TONE = {
  Made: 'ok', 'Both agreed': 'ok', 'One side': 'warn', Requested: 'warn',
  Declined: 'danger', Lapsed: 'neutral',
};

/** The canvas's four chips, over the shared state — the same narrowing the partner panel uses. */
export const NARROW = {
  gated: (p) => ['Requested', 'One side'].includes(stateOf(p)),
  made: (p) => stateOf(p) === 'Made',
  declined: (p) => stateOf(p) === 'Declined',
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Record that an introduction happened. Offered once both sides have agreed
 * (or to edit one already made). `kind` is required by the store: a favour, or
 * a referral that must state its fee — the CHECK refuses one without the other,
 * so the form does too rather than surfacing a constraint failure.
 */
function MadeForm({ row, onSaved, onCancel }) {
  const t = row.terms || {};
  const [madeAt, setMadeAt] = useState(t.made_at || today());
  const [kind, setKind] = useState(t.kind || 'favour');
  const [pct, setPct] = useState(t.fee_bps ? String(t.fee_bps / 100) : '');
  const [outcome, setOutcome] = useState(t.outcome || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const bps = Math.round(Number(pct) * 100);
  const feeOk = kind !== 'referral' || (Number.isInteger(bps) && bps > 0 && bps <= 10000);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await api.introSetTerms(row.uid, {
        kind, fee_bps: kind === 'referral' ? bps : null, made_at: madeAt, outcome: outcome.trim() || null,
      });
      onSaved?.();
    } catch (e) {
      setErr(e?.message || 'That did not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-axal-hairline p-3 text-[12px] dark:border-gray-800" data-testid="intro-made-form">
      <label className="block">Made on{' '}
        <input type="date" value={madeAt} onChange={(e) => setMadeAt(e.target.value)} className="ml-1 rounded border px-1 py-0.5" />
      </label>
      <label className="block">Kind{' '}
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="ml-1 rounded border px-1 py-0.5">
          <option value="favour">A favour</option>
          <option value="referral">A referral with a fee</option>
        </select>
      </label>
      {kind === 'referral' && (
        <label className="block">Fee, % of the engagement{' '}
          <input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" className="ml-1 w-20 rounded border px-1 py-0.5" />
        </label>
      )}
      <label className="block">What came of it (optional)
        <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2} maxLength={2000} className="mt-1 w-full rounded border px-2 py-1" />
      </label>
      {!feeOk && <p className="text-red-700 dark:text-red-300">A referral states its fee: more than 0 and at most 100.</p>}
      {err && <p className="font-semibold text-red-700 dark:text-red-300">{err}</p>}
      <div className="flex gap-2">
        <button type="button" className={ghostButtonClass} disabled={busy || !madeAt || !feeOk} onClick={save}>
          {busy ? 'Saving…' : 'Record as made'}
        </button>
        <button type="button" className={ghostButtonClass} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function PropositionCard({ row, onAnswered }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const [recording, setRecording] = useState(false);
  const state = stateOf(row);
  const tone = STATE_TONE[state] || 'neutral';
  const theirName = row.target?.name || 'They';

  const answer = async (verb) => {
    setBusy(verb);
    setErr(null);
    try {
      if (verb === 'accept') await api.introAccept(row.uid);
      else await api.introDecline(row.uid);
      onAnswered?.();
    } catch (e) {
      // 402 is not a failure of the page — it is the product saying the
      // balance is spent. Show the worker's own sentence rather than "Error".
      setErr(e?.message || 'That did not go through.');
    } finally {
      setBusy('');
    }
  };

  return (
    <Card padding="md" className="mt-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-extrabold tracking-tight">
            {row.target?.name || <Unrecorded>Name not recorded</Unrecorded>}
          </div>
          <div className="mt-0.5 text-[11.5px] text-axal-faint">
            {[row.target?.role, row.target?.headline, row.target?.country].filter(Boolean).join(' · ') || null}
          </div>
        </div>
        <Pill tone={tone}>{state}</Pill>
      </div>
      {/* The consent record, one clause per side, in the partner panel's words. */}
      <p className="mt-1.5 text-[11.5px] text-axal-muted" data-testid="intro-consent-record">{consentRecord(row, theirName)}</p>
      {state === 'Made' && row.terms?.made_at && (
        <p className="mt-1 text-[11.5px] text-axal-muted">
          Made {row.terms.made_at}{row.terms.outcome ? ` · ${row.terms.outcome}` : ' · no outcome recorded'}
        </p>
      )}

      {row.status === 'pending' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={ghostButtonClass} disabled={!!busy}
            onClick={() => answer('accept')}>
            {busy === 'accept' ? 'Accepting…' : 'Accept — spends one credit'}
          </button>
          <button type="button" className={ghostButtonClass} disabled={!!busy}
            onClick={() => answer('decline')}>
            {busy === 'decline' ? 'Declining…' : 'Decline'}
          </button>
        </div>
      )}
      {(state === 'Both agreed' || state === 'Made') && !recording && (
        <div className="mt-3">
          <button type="button" className={ghostButtonClass} onClick={() => setRecording(true)}>
            {state === 'Made' ? 'Edit what was made' : 'Record as made'}
          </button>
        </div>
      )}
      {recording && (
        <MadeForm row={row} onCancel={() => setRecording(false)} onSaved={() => { setRecording(false); onAnswered?.(); }} />
      )}
      {err && <p className="mt-2 text-[12px] font-semibold text-red-700 dark:text-red-300">{err}</p>}
    </Card>
  );
}

export default function IntroductionsZone({ role = 'advisor', zoneFilters = null }) {
  const [state, setState] = useState({ loading: true, error: null, rows: [], credits: null });
  // `Gated` is the canvas's word again (D392): both halves of the consent are in
  // the response, so a gate is a state this page can actually see.
  const [view, setView] = useState('all');
  const [logOpen, setLogOpen] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await api.networkIntroductionsList();
      setState({
        loading: false,
        error: null,
        rows: Array.isArray(res?.propositions) ? res.propositions : [],
        credits: res?.credits ?? null,
      });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The introductions desk did not load.', rows: [], credits: null });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const balance = state.credits?.balance;

  const visible = NARROW[view] ? state.rows.filter(NARROW[view]) : state.rows;

  return (
    <div className="space-y-6">
      <section>
        <ZoneHeading
          title="Introductions proposed to you"
          blurb="Double opt-in: an introduction only becomes one when both sides accept. Each side's answer is shown with its date; a decline sends no notification."
          action={(
            <span className="text-[12px] text-axal-muted">
              Credits:{' '}
              {balance == null ? <Unrecorded /> : <span className="font-extrabold">{balance}</span>}
            </span>
          )}
        />
        {/* THE ROW IS HOISTED OUT OF `ZoneBody`, and only here. `ZoneBody`
            renders `actions` above all four of its states, which is the right
            guarantee — a header row is as true while the store is loading as
            when rows are on screen — and this keeps it, one level up. What it
            avoids is teaching `ZoneBody` about filters: a dozen Expertise and
            Practice zones mount it, and giving it a `ZoneToolbar` would change
            the row on every one of them for a change that belongs to three. */}
        <ZoneToolbar
          className="mb-3"
          role={role}
          filters={zoneFilters ? zoneFilters({ value: view, onChange: setView }) : []}
          actions={advisorZoneActions('network/introductions', {
            view: { header: ['Counterpart', 'Role', 'Country', 'Headline', 'State', 'Consent'], rows: visible, cells: (r) => [r.target?.name, r.target?.role, r.target?.country, r.target?.headline, stateOf(r), consentRecord(r, r.target?.name || 'They')] },
            handlers: {
              consentLog: {
                onClick: () => setLogOpen(true),
                disabled: state.rows.length === 0,
                title: 'every consent recorded on these introductions, both sides, with its date',
              },
            },
          })}
        />
        <ZoneBody
          loading={state.loading}
          error={state.error}
          isEmpty={!state.rows.length}
          onRetry={load}
          empty={(
            <NothingYet
              title="No introduction has been proposed to you"
              body={
                'The matching engine writes these; they are not something you request. Propositions '
                + 'appear here when someone on the platform is a match worth putting in front of you.'
              }
            />
          )}
        >
          {/* A narrowed view that finds nothing says which view it is. The
              empty state above asserts that nobody has proposed an
              introduction, which stops being true the moment a chip is on. */}
          {state.rows.length > 0 && visible.length === 0 && (
            <p className="text-[12.5px] text-gray-600 dark:text-gray-300">
              {`No introduction is in this state. ${state.rows.length} proposed to you in total.`}
            </p>
          )}
          {visible.map((r) => <PropositionCard key={r.uid} row={r} onAnswered={load} />)}
        </ZoneBody>
      </section>

      <StatedLimit title="What each side has said, and what it does not tell you">
        Both answers are shown, each with its date: yours, and the other person&apos;s from their own
        row. An introduction is Made only when you record that it happened — two yeses mean it may,
        not that it did. Declines stay private to the person who declined and are never sent to the
        other side as a notification; they appear here because the answer is part of your own
        introduction&apos;s record.
      </StatedLimit>

      <StatedLimit title="Asking for an introduction is not open to your licence">
        Advisors answer propositions; they cannot open one. Requesting an introduction, the request
        quota and the request history are all restricted to investor accounts and refuse every other
        role, so there is no button here for it rather than a button that would fail.
      </StatedLimit>
      {logOpen && <ConsentLog rows={state.rows} onClose={() => setLogOpen(false)} />}
    </div>
  );
}

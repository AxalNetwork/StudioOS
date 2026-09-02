import React, { useCallback, useEffect, useState } from 'react';
import { Card, Pill } from '../../../ui';
import { api } from '../../../lib/api';
import {
  NothingYet, StatedLimit, Unrecorded, ZoneBody, ZoneHeading, ghostButtonClass,
} from '../expertise/kit';

/**
 * Network · Introductions — the propositions this advisor may answer.
 *
 * THE CHIP SAYS "YOU ACCEPTED", NOT "CONNECTED", AND THAT IS THE POINT.
 * An introduction is two rows: yours and the counterpart's mirror, each owned
 * by one side (`services/introductions.ts` writes both). `propositionDto`
 * returns only YOUR row, so `status: 'accepted'` means you accepted — it
 * cannot distinguish "waiting on them" from "you are already connected". The
 * worker knows the difference and sends a notification when both sides accept;
 * this page does not, so it must not imply it. Labelling the chip "Connected"
 * would be a claim the response cannot support.
 *
 * WHAT AN ADVISOR MAY DO HERE. Answer propositions, and read their own credit
 * balance. They may NOT ask for an introduction: `/introductions/request`,
 * `/introductions/` and `/introductions/quota` are all `investor_only` and 403
 * every other role. That is a boundary, stated below rather than rendered as
 * an absent button nobody can explain.
 */

const CHIP = {
  pending: ['warn', 'Awaiting your answer'],
  accepted: ['ok', 'You accepted'],
  declined: ['neutral', 'You declined'],
  expired: ['neutral', 'Expired'],
};

function PropositionCard({ row, onAnswered }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const [tone, label] = CHIP[row.status] || ['neutral', row.status];

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
          <div className="mt-0.5 text-[11.5px] text-axal-ink-3">
            {[row.target?.role, row.target?.headline, row.target?.country].filter(Boolean).join(' · ') || null}
          </div>
        </div>
        <Pill tone={tone}>{label}</Pill>
      </div>

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
      {err && <p className="mt-2 text-[12px] font-semibold text-red-700 dark:text-red-300">{err}</p>}
    </Card>
  );
}

export default function IntroductionsZone() {
  const [state, setState] = useState({ loading: true, error: null, rows: [], credits: null });

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

  return (
    <div className="space-y-6">
      <section>
        <ZoneHeading
          title="Introductions proposed to you"
          blurb="Double opt-in: an introduction only becomes one when both sides accept, and a decline is never reported back."
          action={(
            <span className="text-[12px] text-axal-ink-2">
              Credits:{' '}
              {balance == null ? <Unrecorded /> : <span className="font-extrabold">{balance}</span>}
            </span>
          )}
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
          {state.rows.map((r) => <PropositionCard key={r.uid} row={r} onAnswered={load} />)}
        </ZoneBody>
      </section>

      <StatedLimit title="“You accepted” is as far as this page can see">
        Each side owns its own row, and the response only ever carries yours. So an accepted
        proposition here means you said yes — it cannot tell you whether the other person has
        answered, or already has. You are notified when both sides accept; until then this page
        deliberately claims nothing about theirs. Declines stay private by design and are never
        reported to the other side.
      </StatedLimit>

      <StatedLimit title="Asking for an introduction is not open to your licence">
        Advisors answer propositions; they cannot open one. Requesting an introduction, the request
        quota and the request history are all restricted to investor accounts and refuse every other
        role, so there is no button here for it rather than a button that would fail.
      </StatedLimit>
    </div>
  );
}

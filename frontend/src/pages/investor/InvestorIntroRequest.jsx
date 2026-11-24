import { useState } from 'react';
import { INTRO_MESSAGE_MAX, quotaLine, upgradeLabel } from '../../lib/investorIntroRequest';

const BUTTON = 'rounded-md border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)] disabled:cursor-default disabled:opacity-60';

/** The quota line above the action: the count, the read in progress, or why nothing can be sent. */
function QuotaNote({ quota }) {
  if (quota?.status === 'ready' && quota.value) {
    return <small data-testid="intro-quota">{quotaLine(quota.value)}{quota.value.remaining === 0 ? '. None left to send until next quarter.' : ''}</small>;
  }
  if (quota?.status === 'unreadable') {
    return <small role="alert" data-testid="intro-quota">Unreadable: your asks left this quarter could not be read, so an ask cannot be sent.</small>;
  }
  return <small data-testid="intro-quota">Reading your asks left this quarter…</small>;
}

/** A 402's own sentence and the plan it names. */
function Refusal({ state }) {
  const plan = upgradeLabel(state.upgrade?.to);
  return <small role="status">{state.message}{state.upgrade && (plan
    ? <> <a href="/pricing?for=investor" className="font-semibold underline" data-testid="intro-upgrade">Upgrade to {plan}</a></>
    : ' No higher plan raises this cap.')}</small>;
}

/**
 * D550's one action, now in two steps (D6260): "Request an intro" opens a
 * confirm step with an optional message; only "Send ask" spends a quota slot.
 * The proposition consent controls stay separate.
 */
export default function InvestorIntroRequest({ targets, states, request, ready, asked, quota }) {
  const [chosen, setChosen] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const target = targets.length === 1 ? targets[0] : targets.find(t => t.key === chosen);
  const state = target && (states[target.key] || (asked.has(target.key) ? { status: 'pending' } : null));
  if (!targets.length) return <small>Not recorded: no founder account or project is attached to this row.</small>;
  const quotaReady = quota?.status === 'ready' && !!quota.value;
  const left = quotaReady ? quota.value.remaining : null;
  const blocked = !ready || !target || ['sending', 'pending'].includes(state?.status) || !quotaReady || left <= 0;
  const send = () => { setConfirming(false); request(target, message); setMessage(''); };
  return <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-[11px]" style={{ flexBasis: '100%' }}>
    {targets.length > 1 && <select aria-label="Founder or project for introduction" value={chosen} onChange={e => { setChosen(e.target.value); setConfirming(false); }} className="max-w-full">
      <option value="">Choose a founder or project</option>{targets.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
    </select>}
    {!confirming && <button type="button" className={BUTTON} disabled={blocked} onClick={() => setConfirming(true)} aria-label={target ? `Request an intro to ${target.label}` : 'Request an intro'}>
      {state?.status === 'sending' ? 'Requesting…' : state?.status === 'pending' ? 'Request pending' : 'Request an intro'}
    </button>}
    <QuotaNote quota={quota} />
    {confirming && target && <div className="flex min-w-0 max-w-full flex-col gap-1" style={{ flexBasis: '100%' }} data-testid="intro-confirm">
      <label className="flex min-w-0 max-w-full flex-col gap-1">Message to go with the ask (optional)
        <textarea value={message} maxLength={INTRO_MESSAGE_MAX} rows={3} onChange={e => setMessage(String(e.target.value).slice(0, INTRO_MESSAGE_MAX))} className="max-w-full" />
      </label>
      <small>{message.length.toLocaleString('en-US')} of {INTRO_MESSAGE_MAX.toLocaleString('en-US')} characters</small>
      <small>An ask is not consent. It records your request to be introduced to {target.label}; neither person has agreed, and no introduction has been made.</small>
      <small>Sending tells the founder in the app, with your name and message. They may accept or decline; until they answer, you may withdraw it.</small>
      {quotaReady && <small>Sending uses one of your {left} {left === 1 ? 'ask' : 'asks'} left{quota.value.quarter ? ` for ${quota.value.quarter}` : ' this quarter'}.</small>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON} disabled={blocked} onClick={send}>Send ask</button>
        <button type="button" className={BUTTON} onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    </div>}
    {!ready && <small>Recorded asks must be readable before requesting another.</small>}
    {state?.status === 'refused' ? <Refusal state={state} /> : state?.message && <small role="status">{state.message}</small>}
    {state?.status === 'pending' && !state.message && <small>Awaiting introduction; consent is not recorded by this ask.</small>}
  </div>;
}

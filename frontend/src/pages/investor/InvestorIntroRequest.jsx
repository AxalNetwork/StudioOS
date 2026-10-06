import { useState } from 'react';

/** Only D550's new action; the proposition consent controls stay separate. */
export default function InvestorIntroRequest({ targets, states, request, ready, asked }) {
  const [chosen, setChosen] = useState('');
  const target = targets.length === 1 ? targets[0] : targets.find(t => t.key === chosen);
  const state = target && (states[target.key] || (asked.has(target.key) ? { status: 'pending' } : null));
  if (!targets.length) return <small>Not recorded: no founder account or project is attached to this row.</small>;
  return <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-[11px]" style={{ flexBasis: '100%' }}>
    {targets.length > 1 && <select aria-label="Founder or project for introduction" value={chosen} onChange={e => setChosen(e.target.value)} className="max-w-full">
      <option value="">Choose a founder or project</option>{targets.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
    </select>}
    <button type="button" className="rounded-md border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)] disabled:cursor-default disabled:opacity-60" disabled={!ready || !target || ['sending', 'pending'].includes(state?.status)} onClick={() => request(target)} aria-label={target ? `Request an intro to ${target.label}` : 'Request an intro'}>
      {state?.status === 'sending' ? 'Requesting…' : state?.status === 'pending' ? 'Request pending' : 'Request an intro'}
    </button>
    {!ready && <small>Recorded asks must be readable before requesting another.</small>}
    {state?.message && <small role="status">{state.message}</small>}
    {state?.status === 'pending' && !state.message && <small>Awaiting introduction; consent is not recorded by this ask.</small>}
  </div>;
}

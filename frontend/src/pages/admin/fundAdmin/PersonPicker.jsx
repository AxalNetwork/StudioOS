import { useId, useState } from 'react';
import { Lightbox, Pill } from '../../../ui';
import { BTN, INPUT, LoadingRows } from '../../account/AccountCenter';
import { refusalText } from './fundAdminModel';
import { ConfirmAct, NotOffered } from './MoneyFlow';
import { actGate } from './moneyFlowModel';
import { ROLES, REASON_MAX, checkChange } from './fundPageModel';
import { ReadFailure } from './parts';
import { useRead } from './useRead';

/**
 * D4812 part 3 (#4812, FA-04 B) — the reusable person/entity picker, for the
 * two people a fund names (`role` 'gp' or 'ledger'), and for any later fund
 * role that reads its candidates the same way.
 *
 * Search, then each account by name and kind with its eligibility: the
 * current holder is marked, an eligible one can be chosen, and one who
 * cannot hold the role says why and cannot be chosen. Then the confirmation
 * names the change ("Replace A with B?"), says what it does, asks a reason
 * where the Worker keeps one, and the authenticator code (both are Super
 * Admin acts), on the button "Make B …". The Worker decides; its refusal is
 * shown. Nothing here shows an email.
 */
export function PersonPicker({ apis, access, fund, role, current, onClose, onDone }) {
  const r = ROLES[role];
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState(undefined);
  const [step, setStep] = useState('choose');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listId = useId();
  const gate = actGate(access, r.act);
  const people = useRead(() => apis.fundAdmin.people(fund.id, role, query), [apis, fund.id, role, query]);
  const candidates = people.status === 'ready' ? people.data?.candidates : null;
  const fromName = current?.name || null;
  const toName = pick ? pick.name : null;

  const next = () => {
    const out = checkChange(role, pick, r.reason ? 'x'.repeat(10) : '');
    if (out.error) { setError(out.error); return; }
    setError(''); setStep('confirm');
  };
  const run = async () => {
    const out = checkChange(role, pick, reason);
    if (out.error) { setError(out.error); return; }
    setBusy(true); setError('');
    try {
      if (role === 'gp') await apis.funds.update(fund.id, out.body);
      else await apis.ledger.setAdministrator(fund.id, out.body.user_id);
      await onDone(`${r.label}: ${toName || 'no one'}.`);
    } catch (e) { setError(refusalText(e, `The ${r.label.toLowerCase()} could not be changed.`)); } finally { setBusy(false); }
  };

  return (
    <Lightbox label={`Change ${r.label.toLowerCase()}`} title={step === 'confirm' ? (fromName ? `Replace ${fromName} with ${toName || 'no one'}?` : `Make ${toName} ${r.label.toLowerCase()}?`) : `Change ${r.label.toLowerCase()}`}
      sub={`${fund.name || `Fund #${fund.id}`} · Super Admin act`} testId={`picker-${role}`} onClose={onClose} width={560}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {gate.state !== 'allowed' && <NotOffered gate={gate} onRetry={null} testId={`picker-${role}-refused`} />}
        {gate.state === 'allowed' && step === 'choose' && <>
          <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setPick(undefined); setQuery(q.trim()); }}>
            <label className="sr-only" htmlFor={`${listId}-q`}>Search people</label>
            <input id={`${listId}-q`} className={`${INPUT} min-w-0 flex-1`} placeholder="⌕ Search people" value={q} maxLength={60}
              onChange={(e) => setQ(e.target.value)} data-testid={`picker-${role}-search`} />
            <button type="submit" className={BTN.ghost} data-testid={`picker-${role}-search-submit`}>Search</button>
          </form>
          {people.status === 'loading' && <LoadingRows lines={3} />}
          {people.status === 'unreadable' && <ReadFailure what="The people" claim="This is not a claim that no one is eligible." onRetry={people.reload} />}
          {people.status === 'ready' && candidates && (
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" data-testid={`picker-${role}-list`}>
              <legend className="sr-only">{`Choose the ${r.label.toLowerCase()}`}</legend>
              {role === 'ledger' && current && (
                <PersonRow name="No one" kind="HQ admins keep the books" state="eligible" checked={pick === null}
                  onPick={() => setPick(null)} testId={`picker-${role}-none`} group={listId} />
              )}
              {candidates.length === 0 && <p className="m-0 text-[13px] text-axal-muted dark:text-gray-400" data-testid={`picker-${role}-empty`}>{query ? `No admin or investor account matches “${query}”.` : 'No admin or investor account is active.'}</p>}
              {candidates.map((p) => (
                <PersonRow key={p.id} name={p.name} kind={p.kind} reason={p.reason} group={listId}
                  state={p.current ? 'current' : p.eligible ? 'eligible' : 'ineligible'}
                  checked={pick?.id === p.id} onPick={() => setPick(p)} testId={`picker-${role}-person-${p.id}`} />
              ))}
            </fieldset>
          )}
          {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid={`picker-${role}-error`}>{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button>
            <button type="button" className={BTN.primary} onClick={next} disabled={pick === undefined} data-testid={`picker-${role}-next`}>Continue</button>
          </div>
        </>}
        {gate.state === 'allowed' && step === 'confirm' && <>
          {r.reason && (
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">Reason · required
              <textarea className={INPUT} rows={3} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`picker-${role}-reason`} />
              <span className="text-[12px] font-normal text-axal-muted dark:text-gray-400">Kept on the audit record with the old and new GP.</span>
            </label>
          )}
          <ConfirmAct apis={apis} needsCode testId={`picker-${role}-confirm`} label={r.verb(toName)} busy={busy} error={error}
            consequences={r.effects(fromName, toName)} run={run} onBack={() => { setError(''); setStep('choose'); }} />
        </>}
      </div>
    </Lightbox>
  );
}

function PersonRow({ name, kind, reason = null, state, checked, onPick, testId, group }) {
  const off = state === 'ineligible' || state === 'current';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <label className={`flex min-h-[52px] items-center gap-3 rounded-[9px] border px-3 py-2 ${checked ? 'border-axal-violet bg-axal-lavender dark:bg-violet-950/40' : 'border-axal-hairline dark:border-gray-800'} ${off ? 'cursor-not-allowed' : 'cursor-pointer'}`} data-testid={testId}>
      <input type="radio" name={group} className="sr-only" checked={checked} disabled={off} onChange={onPick} />
      <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-axal-muted dark:bg-gray-800 dark:text-gray-300">{initials || '—'}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{name}</span>
        <span className="block text-[12px] text-axal-muted dark:text-gray-400">{reason ? `${kind} · ${reason}` : kind}</span>
      </span>
      {state === 'current' ? <Pill tone="info">Current</Pill> : state === 'eligible' ? <Pill tone="ok">Eligible</Pill> : <Pill tone="neutral">Not eligible</Pill>}
    </label>
  );
}

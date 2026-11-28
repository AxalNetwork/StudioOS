/**
 * D6257 (#6257) — NW3.1, NW3.1B and NW8.1 of the Network v2 Investor canvas
 * (D6256): Request introduction, started from the investor's Introductions
 * page. Three steps, then the investor's branch when no teammate knows them.
 *
 *   1 Who         Person, Company or Fund, and the one thing the who-knows
 *                 read takes (D1356): a LinkedIn URL or an email for a person,
 *                 a name for a company or a fund.
 *   2 Introducer  `GET /api/relationships/who-knows`: the teammates who chose
 *                 to share that they know them. Choose one, and a note they
 *                 read (optional). "Draft the reason" quotes Eadwyn's run
 *                 first (D4330) and places the text in the note.
 *   3 Review      Target, teammate, note, and the cost: none. Send request is
 *                 `POST /api/relationships/intro-request`; the sent panel opens
 *                 the request's record (#5310, `IntroRecordSheet`).
 *
 *   No teammate knows them:
 *     ask         The investor has a founder or a startup on Axal among their
 *                 ties (`introTarget`): an ask can name one of them, with the
 *                 quarter's quota shown first. "Use 1 ask and send" is
 *                 `POST /api/introductions/request` (D550, D6260).
 *     no_ask      Nothing nameable: an ask cannot be used here, said plainly.
 *
 * A failed who-knows read is Unavailable with Try again, never "nobody knows
 * them"; a refused one is Refused. Nothing is sent to the target by any step.
 * Below 640px the shared `Sheet` is a full-screen page with the action in its
 * footer, which is NW8.1's phone flow.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { relationshipsApi } from '../../lib/api/relationships.js';
import { reportError } from '../../lib/log';
import { Sheet, Unreadable } from '../../ui';
import DraftFlow, { useDraftFlow } from '../relationships/DraftFlow.jsx';
import IntroRecordSheet from '../relationships/IntroRecordSheet.jsx';
import { NOTE_MAX, stripRows } from '../relationships/relationshipsModel';
import { INTRO_MESSAGE_MAX, quotaLine } from '../../lib/investorIntroRequest';
import { SEARCH_KINDS, requestBranch, searchQuery } from './investorNetworkModel';

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'm-0 text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const LABEL = 'text-[12px] font-bold text-axal-ink dark:text-gray-100';
const BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] px-3 text-[12.5px] font-bold disabled:opacity-50 max-sm:min-h-[44px]';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep dark:bg-violet-500 dark:hover:bg-violet-400`;
const QUIET = `${BTN} text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100`;
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 max-sm:min-h-[44px]';
const NOTE = 'flex gap-2 rounded-[10px] border border-axal-hairline bg-axal-ground p-3 text-[12.5px] leading-[1.45] text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
const WARN = 'flex gap-2 rounded-[10px] border border-amber-300 bg-amber-50 p-3 text-[12.5px] leading-[1.45] text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200';
const GOOD = 'flex gap-2 rounded-[10px] border border-emerald-300 bg-emerald-50 p-3 text-[12.5px] leading-[1.45] text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
const STEPS = ['Who', 'Introducer', 'Review'];

/** The steps strip: done steps carry ✓, the current one is `aria-current`. */
function Steps({ at, testId }) {
  return (
    <ol className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Steps" data-testid={`${testId}-steps`}>
      {STEPS.map((label, i) => {
        const n = i + 1;
        const on = n === at;
        return (
          <li key={label} aria-current={on ? 'step' : undefined}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${on ? 'border-axal-violet bg-violet-50 text-axal-violet dark:border-violet-500 dark:bg-violet-950 dark:text-violet-200' : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`}>
            {n < at ? '✓ ' : ''}{n} {label}
          </li>
        );
      })}
    </ol>
  );
}

export default function InvestorNetworkRequestSheet({
  onClose, askTargets = [], quota = { status: 'loading', value: null }, asksReady = false, askStates = {}, requestAsk,
  asked = new Set(), api = relationshipsApi, testId = 'request-intro',
}) {
  const [step, setStep] = useState('who');
  const [kind, setKind] = useState('person');
  const [value, setValue] = useState('');
  const [read, setRead] = useState({ status: 'idle', people: [], message: '' });
  const [chosen, setChosen] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sent, setSent] = useState(null);
  const [recordUid, setRecordUid] = useState('');
  const [askKey, setAskKey] = useState('');
  const [askMessage, setAskMessage] = useState('');

  const query = searchQuery(kind, value);
  const field = SEARCH_KINDS.find((k) => k.key === kind) || SEARCH_KINDS[0];
  const rows = useMemo(() => stripRows(read.people, read.people.length), [read.people]);
  const pick = rows[chosen] || null;
  const branch = read.status === 'ok' ? requestBranch({ people: read.people, askTargets }) : null;
  const askTarget = askTargets.length === 1 ? askTargets[0] : askTargets.find((t) => t.key === askKey) || null;
  const askState = askTarget ? (askStates[askTarget.key] || (asked.has(askTarget.key) ? { status: 'pending' } : null)) : null;
  const quotaReady = quota?.status === 'ready' && !!quota.value;
  const left = quotaReady ? quota.value.remaining : null;
  const askBlocked = !asksReady || !askTarget || !quotaReady || left <= 0 || ['sending', 'pending'].includes(askState?.status);

  const find = useCallback(async () => {
    if (!query) return;
    setStep('introducer');
    setRead({ status: 'loading', people: [], message: '' });
    setChosen(0);
    try {
      const data = await api.whoKnows(query);
      setRead({ status: 'ok', people: Array.isArray(data?.people) ? data.people : [], message: '' });
    } catch (e) {
      reportError('relationships:who-knows', e);
      // 400: the query itself was refused (a name alone never matches a person) — say why, on step 1.
      if (e?.status === 400) { setStep('who'); setRead({ status: 'idle', people: [], message: e?.data?.message || 'Give a LinkedIn profile URL or an email address.' }); return; }
      setRead({ status: e?.status === 403 ? 'refused' : 'error', people: [], message: '' });
    }
  }, [api, query]);

  // Moving off a step is the only way back to it: a new search starts clean.
  useEffect(() => { setSendError(''); }, [step]);

  const send = async () => {
    if (!pick || note.length > NOTE_MAX) return;
    setBusy(true); setSendError('');
    try {
      const r = await api.requestIntro({ teammate: pick.teammateId, ref: pick.ref, ...(note.trim() ? { note: note.trim() } : {}) });
      setSent({ teammate: pick.teammate, uid: r?.request?.uid || '' });
      setStep('sent');
      // The From your team section reads its own log; it re-reads on this.
      if (typeof window !== 'undefined' && typeof CustomEvent === 'function') window.dispatchEvent?.(new CustomEvent('network:intro-requested'));
    } catch (e) {
      setSendError(e?.data?.message || 'The request could not be sent. Nothing was sent.');
      reportError('relationships:request', e);
    } finally { setBusy(false); }
  };

  const draftRun = useCallback((body) => api.draftAskReason({ teammate: pick?.teammateId, ref: pick?.ref, ...body }), [api, pick?.teammateId, pick?.ref]);
  const { state: draftState, ask: askDraft, confirm: confirmDraft, cancel: cancelDraft } = useDraftFlow(draftRun);
  const onConfirmDraft = async () => {
    const draft = await confirmDraft();
    if (draft?.text) setNote(String(draft.text).slice(0, NOTE_MAX));
  };

  if (recordUid) return <IntroRecordSheet uid={recordUid} side="asker" onClose={onClose} />;

  const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'them';
  let eyebrow = 'Request introduction';
  let title = 'Who do you want to meet?';
  let body = null;
  let footer = null;

  if (step === 'who') {
    eyebrow = 'Request introduction · step 1 of 3';
    body = (
      <div className="flex flex-col gap-3">
        <Steps at={1} testId={testId} />
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Search for">
          {SEARCH_KINDS.map((k) => (
            <button key={k.key} type="button" role="radio" aria-checked={kind === k.key}
              className={`${BTN} flex-1 border ${kind === k.key ? 'border-axal-violet bg-violet-50 text-axal-violet dark:border-violet-500 dark:bg-violet-950 dark:text-violet-200' : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}
              onClick={() => { setKind(k.key); setRead({ status: 'idle', people: [], message: '' }); }} data-testid={`${testId}-kind-${k.key}`}>{k.label}</button>
          ))}
        </div>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{field.field}</span>
          <input className={FIELD} value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} data-testid={`${testId}-value`} />
        </label>
        {read.message ? <p className="m-0 text-[12.5px] font-semibold text-axal-destructive dark:text-red-400" role="alert" data-testid={`${testId}-refused-query`}>{read.message}</p> : null}
        <p className={MUTED}>Only teammates who share their book are searched. Their private notes and email addresses are never shown.</p>
      </div>
    );
    footer = (
      <div className="flex w-full flex-wrap justify-end gap-2">
        <button type="button" className={QUIET} onClick={onClose}>Cancel</button>
        <button type="button" className={PRIMARY} disabled={!query} onClick={find} data-testid={`${testId}-find`}>Find who knows them</button>
      </div>
    );
  } else if (step === 'introducer' && (read.status === 'loading' || read.status === 'error' || read.status === 'refused' || branch === 'pick')) {
    eyebrow = 'Request introduction · step 2 of 3';
    title = 'Who can introduce you?';
    body = (
      <div className="flex flex-col gap-3">
        <Steps at={2} testId={testId} />
        {read.status === 'loading' ? <div className="flex flex-col gap-2" role="status" aria-busy="true" data-testid={`${testId}-loading`}><span className="h-12 animate-pulse rounded-[10px] bg-axal-hairline dark:bg-gray-800" /><span className="h-12 animate-pulse rounded-[10px] bg-axal-hairline dark:bg-gray-800" /><span className={MUTED}>Reading who knows them…</span></div> : null}
        {read.status === 'error' ? <div data-testid={`${testId}-unreadable`}><Unreadable what="Who knows them" claim="This is not a claim that nobody does." onRetry={find} /></div> : null}
        {read.status === 'refused' ? <p className={`${MUTED} font-semibold`} data-testid={`${testId}-refused`}>⊘ Refused · you can search only teams you are on.</p> : null}
        {branch === 'pick' ? (
          <>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Teammate">
              {rows.map((r, i) => (
                <button key={r.key} type="button" role="radio" aria-checked={i === chosen} onClick={() => setChosen(i)} data-testid={`${testId}-pick-${i}`}
                  className={`flex min-h-[44px] items-start gap-3 rounded-[10px] border p-3 text-left ${i === chosen ? 'border-axal-violet bg-violet-50 dark:border-violet-500 dark:bg-violet-950' : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'}`}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={`text-[13px] font-bold ${INK}`}>{r.teammate}</span>
                    <span className={MUTED}>{[r.knows, r.detail].filter(Boolean).join(' · ')}</span>
                  </span>
                  {i === chosen ? <span className="text-[11px] font-bold text-axal-violet dark:text-violet-200">✓ Chosen</span> : null}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Note to {firstName(pick?.teammate)} (optional)</span>
              <textarea className={`${FIELD} min-h-[88px]`} maxLength={NOTE_MAX} value={note} placeholder={`Why you want to meet ${firstName(pick?.person)}…`} onChange={(e) => setNote(e.target.value)} data-testid={`${testId}-note`} />
              <span className={MUTED}>{note.length.toLocaleString('en-US')} / {NOTE_MAX.toLocaleString('en-US')} · {firstName(pick?.teammate)} reads it.</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={GHOST} disabled={!pick || draftState.status === 'estimating' || draftState.status === 'running'} onClick={askDraft} data-testid={`${testId}-draft`}>Draft the reason with Eadwyn</button>
              <span className={MUTED}>The cost is quoted before drafting.</span>
            </div>
            <DraftFlow state={draftState} onConfirm={onConfirmDraft} onCancel={cancelDraft} testId={`${testId}-draft`} confirmLabel="Draft the reason" />
          </>
        ) : null}
      </div>
    );
    footer = (
      <div className="flex w-full flex-wrap justify-end gap-2">
        <button type="button" className={QUIET} onClick={() => setStep('who')} data-testid={`${testId}-back`}>Back</button>
        <button type="button" className={PRIMARY} disabled={branch !== 'pick' || !pick} onClick={() => setStep('review')} data-testid={`${testId}-continue`}>Continue</button>
      </div>
    );
  } else if (step === 'introducer' && branch === 'ask') {
    eyebrow = 'Request introduction · no teammate knows them';
    title = 'Ask Axal for an introduction';
    body = (
      <div className="flex flex-col gap-3" data-testid={`${testId}-ask`}>
        <div className={NOTE}><span aria-hidden="true">i</span><span>No teammate who shares their book knows them. An ask can name a founder or a startup on Axal that one of your ties links.</span></div>
        {askTargets.length > 1 ? (
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Founder or startup on Axal</span>
            <select className={FIELD} value={askKey} onChange={(e) => setAskKey(e.target.value)} data-testid={`${testId}-ask-target`}>
              <option value="">Choose a founder or startup</option>
              {askTargets.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
        ) : <p className={`m-0 text-[13px] font-bold ${INK}`}>{askTargets[0]?.label}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700" data-testid={`${testId}-quota`}>
          {quotaReady
            ? <span className={`text-[12.5px] ${INK}`}>{quotaLine(quota.value)}{quota.value.quarter ? ` (${quota.value.quarter})` : ''}</span>
            : quota?.status === 'unreadable'
              ? <span className={`text-[12.5px] font-semibold ${INK}`}>? Asks this quarter could not be read. Ask Axal is off until they can be.</span>
              : <span className={MUTED}>Reading your asks left this quarter…</span>}
          {quotaReady ? <span className={MUTED}>{left > 0 ? 'this uses 1' : 'none left this quarter'}</span> : null}
        </div>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Message to Axal (optional)</span>
          <textarea className={`${FIELD} min-h-[88px]`} maxLength={INTRO_MESSAGE_MAX} value={askMessage} onChange={(e) => setAskMessage(String(e.target.value).slice(0, INTRO_MESSAGE_MAX))} data-testid={`${testId}-ask-message`} />
          <span className={MUTED}>{askMessage.length.toLocaleString('en-US')} / {INTRO_MESSAGE_MAX.toLocaleString('en-US')}</span>
        </label>
        <p className={`m-0 text-[12.5px] ${INK}`}><b>An ask is not consent from the founder.</b> The founder accepts or declines it; until they answer, you may withdraw it.</p>
        {!asksReady ? <p className={MUTED}>Your recorded asks must be readable before you send another.</p> : null}
        {askState?.message ? <p className={`m-0 text-[12.5px] ${INK}`} role="status" data-testid={`${testId}-ask-state`}>{askState.message}</p> : null}
      </div>
    );
    footer = (
      <div className="flex w-full flex-wrap justify-end gap-2">
        <button type="button" className={QUIET} onClick={() => setStep('who')}>Search someone else</button>
        <button type="button" className={PRIMARY} disabled={askBlocked} onClick={() => { requestAsk?.(askTarget, askMessage); setAskMessage(''); }} data-testid={`${testId}-ask-send`}>
          {askState?.status === 'sending' ? 'Sending…' : askState?.status === 'pending' ? 'Ask pending' : 'Use 1 ask and send'}
        </button>
      </div>
    );
  } else if (step === 'introducer') {
    eyebrow = 'Request introduction · no teammate knows them';
    title = 'No warm path';
    body = (
      <div className="flex flex-col gap-3" data-testid={`${testId}-no-ask`}>
        <div className={NOTE}><span aria-hidden="true">○</span><span><b>No teammate knows them.</b> Nobody on your teams who shares their book has them recorded.</span></div>
        <div className={WARN}><span aria-hidden="true">!</span><span><b>An ask cannot be used here.</b> An ask can name only a founder or a startup on Axal, and none of your ties links one.</span></div>
        {quotaReady ? <p className={MUTED}>Your asks stay at {quotaLine(quota.value)}.</p> : null}
      </div>
    );
    footer = (
      <div className="flex w-full flex-wrap justify-end gap-2">
        <button type="button" className={QUIET} onClick={onClose}>Close</button>
        <button type="button" className={GHOST} onClick={() => setStep('who')} data-testid={`${testId}-search-again`}>Search someone else</button>
      </div>
    );
  } else if (step === 'review') {
    eyebrow = 'Request introduction · step 3 of 3';
    title = 'Review and send';
    body = (
      <div className="flex flex-col gap-3">
        <Steps at={3} testId={testId} />
        <dl className="m-0 grid grid-cols-[minmax(88px,auto)_1fr] gap-x-3 gap-y-2 text-[13px]" data-testid={`${testId}-review`}>
          <dt className={MUTED}>Target</dt><dd className={`m-0 ${INK}`}>{[pick?.person, value.trim()].filter(Boolean)[0]}</dd>
          <dt className={MUTED}>Teammate</dt><dd className={`m-0 ${INK}`}>{pick?.teammate}</dd>
          <dt className={MUTED}>Note</dt><dd className={`m-0 ${INK}`}>{note.trim() ? `“${note.trim()}”` : '— Not recorded'}</dd>
          <dt className={MUTED}>Cost</dt><dd className={`m-0 font-bold ${INK}`}>No credit is used for a team request</dd>
        </dl>
        <div className={NOTE}><span aria-hidden="true">i</span><span><b>What happens next.</b> {firstName(pick?.teammate)} accepts or says Not now, and you can read their note. If they accept, they write the introduction from their Email composer, and it is recorded as Made when they send it.</span></div>
        {sendError ? <p className="m-0 text-[12.5px] font-semibold text-axal-destructive dark:text-red-400" role="alert" data-testid={`${testId}-error`}>{sendError}</p> : null}
      </div>
    );
    footer = (
      <div className="flex w-full flex-wrap justify-end gap-2">
        <button type="button" className={QUIET} onClick={() => setStep('introducer')}>Back</button>
        <button type="button" className={PRIMARY} disabled={busy || !pick} onClick={send} data-testid={`${testId}-send`}>{busy ? 'Sending…' : 'Send request'}</button>
      </div>
    );
  } else if (step === 'sent') {
    title = 'Request sent';
    body = (
      <div className="flex flex-col gap-3" data-testid={`${testId}-sent`}>
        <div className={GOOD}><span aria-hidden="true">✓</span><span><b>Sent to {sent?.teammate}.</b> It shows in Introductions under From your team · Sent, as Asked.</span></div>
        {sent?.uid ? <button type="button" className={`${GHOST} self-start`} onClick={() => setRecordUid(sent.uid)} data-testid={`${testId}-open-record`}>Open the request →</button> : null}
      </div>
    );
    footer = <div className="flex w-full justify-end"><button type="button" className={PRIMARY} onClick={onClose} data-testid={`${testId}-done`}>Done</button></div>;
  }

  return (
    <Sheet label="Request introduction" eyebrow={eyebrow} title={title} onClose={onClose} width={520} footer={footer} testId={testId} focusKey={step}>
      {body}
    </Sheet>
  );
}

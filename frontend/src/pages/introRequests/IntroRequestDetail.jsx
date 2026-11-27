/**
 * D9068 (#9068): one request through Axal, the member's receipt and status, to the canvas
 * `design/incoming/Network External Introduction Requests Page.dc.html` (D7678, boards NIE08, NIE10, NIE10B, NIE11,
 * NIE17, NIE21, NIE22), at `/network/introductions/requests/:uid`. The address names the request, so a notification
 * or a shared link opens the exact record.
 *
 * WHAT IT READS. `GET /api/intro-requests/:uid` answers the requester's own projection: the state, who acts next,
 * the target, the purpose and brief, the private note, and the requester-visible events. Request, target response,
 * contact and introduction are four separate fields, each read from its own field or event. Contact detail and
 * operator notes are not in this projection and are never shown.
 *
 * WHAT IT WRITES. Withdraw (`POST /:uid/withdraw`) with the revision it read; a request that moved meanwhile is
 * re-read and shown, not withdrawn blind. An answer to Axal's question edits the purpose or brief (`PATCH`) and
 * returns the request to review (`POST /:uid/submit`). Neither contacts anybody.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { DataState } from '../../ui/Honesty';
import { introRequestsApi } from '../../lib/api/introRequests.js';
import { reportError } from '../../lib/log';
import {
  EDITABLE, LIMITS, WITHDRAWABLE, eventSentence, fourFields, nextLine, openQuestion, refusalSentence, shortUid, stamp,
  stateWord, targetLine, withdrawCopy,
} from './introRequestModel.js';
import { BTN, BTN_PRIMARY, Card, Chip, EYE, Facts, Frame, HINT, INPUT, LABEL, Note, PageHeader, focusEl } from './introKit.jsx';

function FourFields({ r }) {
  const f = fourFields(r);
  const cells = [
    ['Request', f.request, r.state === 'submitted' && !r.operator_assigned ? 'no operator named yet' : null],
    ['Target response', f.response, null],
    ['Contact attempt', f.contact, f.contact.at ? stamp(f.contact.at) : null],
    ['Introduction', f.introduction, null],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Request, target response, contact and introduction">
      {cells.map(([k, s, small]) => (
        <div key={k} className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
          <dt className={EYE}>{k}</dt>
          <dd className="flex flex-col items-start gap-1"><Chip s={s} />{small ? <small className="font-mono text-[11.5px] text-gray-600 dark:text-gray-400">{small}</small> : null}</dd>
        </div>
      ))}
    </dl>
  );
}

function WithdrawPanel({ r, onDone, onCancel }) {
  const [state, setState] = useState({ status: 'idle' });
  const copy = withdrawCopy(r);
  const f = fourFields(r);
  const go = async () => {
    setState({ status: 'busy' });
    try {
      const out = await introRequestsApi.withdraw(r.uid, r.revision);
      onDone(out.request, null);
    } catch (e) {
      reportError('intro-requests:withdraw', e);
      if (e?.code === 'revision_conflict' || e?.code === 'request_not_withdrawable') {
        // A race: the request moved before this withdrawal. Read it again and say what happened first.
        const fresh = await introRequestsApi.get(r.uid).then((d) => d.request).catch(() => null);
        if (fresh) { onDone(fresh, 'The request changed before your withdrawal arrived. Its newer state is shown; read it before you withdraw again.'); return; }
      }
      setState({ status: 'error', sentence: refusalSentence(e) });
    }
  };
  return (
    <Card title={`Withdraw your request${targetLine(r).name ? ` to ${targetLine(r).name}` : ''}?`} id="ir-withdraw" tone="warn">
      <Facts rows={[
        ['Stage', <Chip s={stateWord(r.state)} extra={copy.stage} />],
        ['Contact', <Chip s={f.contact} />],
        ['Effect', copy.effect],
        ['Cost', 'Nothing was charged'],
      ]} />
      <p className="text-[13px] text-gray-700 dark:text-gray-300">Withdrawn is final. You can submit a new request later.</p>
      {state.status === 'error' ? <Note tone="bad" glyph="!" role="alert"><b>Not withdrawn.</b> {state.sentence}</Note> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN} onClick={onCancel}>Back</button>
        <button type="button" className={BTN_PRIMARY} onClick={go} disabled={state.status === 'busy'} aria-busy={state.status === 'busy' || undefined}>{state.status === 'busy' ? 'Withdrawing…' : 'Withdraw request'}</button>
      </div>
    </Card>
  );
}

/** NIE10B: Axal asked something. The answer edits what Axal reads (purpose, brief) and returns the request to review. */
function AnswerPanel({ r, onDone }) {
  const q = openQuestion(r);
  const [text, setText] = useState({ purpose: r.purpose || '', shareable_brief: r.shareable_brief || '' });
  const [state, setState] = useState({ status: 'idle' });
  const send = async () => {
    setState({ status: 'busy' });
    try {
      let base = r;
      if (text.purpose !== (r.purpose || '') || text.shareable_brief !== (r.shareable_brief || '')) {
        base = (await introRequestsApi.update(r.uid, { expected_revision: r.revision, ...text })).request;
      }
      const out = await introRequestsApi.submit(base.uid, base.revision);
      onDone(out.request, 'Answer sent. Your request is back with Axal.');
    } catch (e) {
      reportError('intro-requests:answer', e);
      setState({ status: 'error', sentence: refusalSentence(e) });
    }
  };
  return (
    <Card title="Axal asked you something" id="ir-answer" tone="warn">
      <Note tone="warn" glyph="?">
        <span className={EYE}>From Axal{q?.at ? ` · ${stamp(q.at)}` : ''}</span><br />
        {q?.text ? `“${q.text}”` : <DataState state="not_recorded" reason="the question was not recorded with the request" />}
      </Note>
      <div>
        <label htmlFor="ir-ans-purpose" className={LABEL}>Purpose</label>
        <textarea id="ir-ans-purpose" rows={4} className={`${INPUT} mt-1`} maxLength={LIMITS.purpose} value={text.purpose} onChange={(e) => setText({ ...text, purpose: e.target.value })} />
      </div>
      <div>
        <label htmlFor="ir-ans-brief" className={LABEL}>Shareable brief</label>
        <textarea id="ir-ans-brief" rows={4} className={`${INPUT} mt-1`} maxLength={LIMITS.shareable_brief} value={text.shareable_brief} onChange={(e) => setText({ ...text, shareable_brief: e.target.value })} />
      </div>
      <p className={HINT}>Your answer goes to Axal as your updated purpose and brief. Nothing is sent to the person.</p>
      {state.status === 'error' ? <Note tone="bad" glyph="!" role="alert"><b>Your answer was not sent.</b> {state.sentence} It is kept here.</Note> : null}
      <button type="button" className={`${BTN_PRIMARY} self-start`} onClick={send} disabled={state.status === 'busy'} aria-busy={state.status === 'busy' || undefined}>{state.status === 'busy' ? 'Sending…' : state.status === 'error' ? 'Try again' : 'Send answer to Axal'}</button>
    </Card>
  );
}

export default function IntroRequestDetail() {
  const { uid } = useParams();
  const [params] = useSearchParams();
  const [read, setRead] = useState({ status: 'loading', request: null });
  const [panel, setPanel] = useState(null);
  const [notice, setNotice] = useState(params.get('submitted') ? 'submitted' : null);
  const titleRef = useRef(null);

  const load = useCallback(() => {
    let live = true;
    setRead((x) => ({ ...x, status: 'loading' }));
    introRequestsApi.get(uid)
      .then((d) => { if (live) setRead({ status: 'ok', request: d.request }); })
      .catch((e) => { if (live) setRead({ status: e?.status === 404 ? 'refused' : 'error', request: null }); reportError('intro-requests:detail', e); });
    return () => { live = false; };
  }, [uid]);
  useEffect(load, [load]);
  useEffect(() => { if (read.status === 'ok' && notice) focusEl(titleRef.current); }, [read.status, notice]);

  const r = read.request;
  const onDone = (fresh, sentence) => { setRead({ status: 'ok', request: fresh }); setPanel(null); setNotice(sentence ? { text: sentence } : fresh.state === 'withdrawn' ? { text: 'Withdrawn. Axal has stopped.' } : null); };

  if (read.status === 'refused') {
    return (
      <Frame>
        <PageHeader crumb={[{ label: 'Introductions', to: '/network/introductions/requests' }, { label: 'Request' }]} eye="Network · Introductions · Through Axal" title="This request is not available to you" />
        <DataState state="refused" size="block" claim="It is not yours to read, or it does not exist. Nothing about it is shown." accessRoute={<Link to="/network/introductions/requests" className={BTN}>Back to your requests</Link>} />
      </Frame>
    );
  }
  if (read.status === 'error' && !r) {
    return (
      <Frame>
        <PageHeader crumb={[{ label: 'Introductions', to: '/network/introductions/requests' }, { label: 'Request' }]} eye="Network · Introductions · Through Axal" title="Your request" />
        <DataState state="unavailable" size="block" what="This request" claim="It is not shown as missing." onRetry={load} retryLabel="Try again" />
      </Frame>
    );
  }
  if (!r) {
    return (
      <Frame>
        <div aria-busy="true" aria-label="Loading the request" className="flex flex-col gap-3">
          <span className="block h-6 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <span key={i} className="block h-16 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />)}</div>
          <span className="block h-40 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />
        </div>
      </Frame>
    );
  }

  const t = targetLine(r);
  const canWithdraw = WITHDRAWABLE.includes(r.state);
  const isDraft = EDITABLE.includes(r.state);
  const draftHref = `/network/introductions/requests/new?draft=${encodeURIComponent(r.uid)}&step=4`;
  const events = Array.isArray(r.events) ? r.events : [];
  const who = t.name || 'the person';

  const actions = (
    <>
      {isDraft ? <Link to={draftHref} className={BTN_PRIMARY}>Continue the draft</Link> : null}
      {canWithdraw && panel !== 'withdraw' ? <button type="button" className={BTN} onClick={() => setPanel('withdraw')}>Withdraw request</button> : null}
    </>
  );

  return (
    <Frame bar={isDraft || canWithdraw ? <>{canWithdraw && panel !== 'withdraw' ? <button type="button" className={`${BTN} flex-1`} onClick={() => setPanel('withdraw')}>Withdraw</button> : null}{isDraft ? <Link to={draftHref} className={`${BTN_PRIMARY} flex-1`}>Continue the draft</Link> : <Link to="/network/introductions/requests" className={`${BTN_PRIMARY} flex-1`}>Back to Introductions</Link>}</> : null}>
      <PageHeader
        crumb={[{ label: 'Network', to: '/network' }, { label: 'Introductions', to: '/network/introductions/requests' }, { label: `Through Axal · ${shortUid(r.uid)}` }]}
        eye={`Through Axal · request ${shortUid(r.uid)}`}
        title={t.name ? `Your request to meet ${t.name}` : 'Your request'}
        titleRef={titleRef}
        sub={[t.kind, r.submitted_at ? `submitted ${stamp(r.submitted_at)}` : 'not submitted'].filter(Boolean).join(' · ')}
        actions={<div className="hidden flex-wrap gap-2 lg:flex">{actions}</div>}
      />

      {notice === 'submitted' && !isDraft ? (
        <Note tone="good" glyph="✓" role="status"><b>Request submitted.</b> Request <span className="font-mono">{shortUid(r.uid)}</span>. Nothing has been sent to {who}.</Note>
      ) : null}
      {notice && notice.text ? <Note tone={r.state === 'withdrawn' ? 'plain' : 'warn'} glyph={r.state === 'withdrawn' ? '⊘' : '!'} role="status">{notice.text}</Note> : null}

      <FourFields r={r} />
      <Note glyph="→"><b>Next: {nextLine(r)}.</b> {r.next_actor === 'operator' && !r.operator_assigned ? 'No operator is named until one is assigned, and no time is promised.' : 'This is a plan, not a promised response time.'}</Note>

      {panel === 'withdraw' ? <WithdrawPanel r={r} onDone={onDone} onCancel={() => setPanel(null)} /> : null}
      {r.state === 'needs_information' && panel !== 'withdraw' ? <AnswerPanel r={r} onDone={onDone} /> : null}
      {r.state === 'readiness_needed' ? (
        <Note tone="warn" glyph="!"><b>Not submitted.</b> The server found readiness items to finish. Your draft is kept. <Link to={`/network/introductions/readiness?draft=${encodeURIComponent(r.uid)}`} className="font-semibold text-violet-700 underline dark:text-violet-300">Resolve readiness</Link></Note>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Receipt" id="ir-receipt">
            <Facts rows={[
              ['Request', <span className="font-mono text-[12.5px]">{r.uid}</span>],
              ['Submitted', r.submitted_at ? <span className="font-mono">{stamp(r.submitted_at)}</span> : <DataState state="not_applicable" reason="not submitted yet" />],
              ['Person', <>{t.name || <DataState state="not_recorded" reason="Axal identifies the person" />}{t.kind ? <span className="text-gray-600 dark:text-gray-400"> · {t.kind}</span> : null}</>],
              t.organization ? ['Organisation', `${t.organization} · context only`] : null,
              ['Readiness', r.policy_version != null ? `Checked at submit against policy v${r.policy_version}` : <DataState state="not_applicable" reason="checked when you submit" />],
              ['Owner', r.operator_assigned ? 'An Axal operator' : r.next_actor === 'operator' ? <Chip s={{ word: 'Awaiting assignment', glyph: '◷', tone: 'warn' }} /> : 'No operator yet'],
              ['Cost', 'No charge · this service spends no credit'],
              ['Outcome', r.outcome_note || <DataState state="not_recorded" reason="after an introduction" />],
            ]} />
          </Card>
          <Card title="Activity" id="ir-activity" aside="visible to you">
            {events.length ? (
              <ol className="flex flex-col">
                {events.map((e, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 border-t border-gray-200 py-2 first:border-t-0 dark:border-gray-700">
                    <span className="flex items-start gap-2 text-[13px] text-gray-900 dark:text-gray-100"><span aria-hidden="true" className="text-emerald-700 dark:text-emerald-400">✓</span>{eventSentence(e)}</span>
                    <span className="flex-none font-mono text-[11.5px] text-gray-600 dark:text-gray-400">{stamp(e.at)}</span>
                  </li>
                ))}
              </ol>
            ) : <DataState state="none" size="block">No activity recorded yet.</DataState>}
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Shareable brief" id="ir-brief-card" aside="shared with the person only after review">
            <Facts rows={[
              ['Purpose', r.purpose || <DataState state="not_recorded" reason="not written" />],
              ['Brief', r.shareable_brief || <DataState state="not_recorded" reason="not written" />],
            ]} />
          </Card>
          <Card title="Notes" id="ir-notes">
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"><b className="block text-[13px] text-gray-900 dark:text-gray-100">Your private note · only you</b><span className="text-[13px] text-gray-700 dark:text-gray-300">{r.private_notes || 'None written.'}</span></div>
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-500/40 dark:bg-violet-500/10"><b className="block text-[13px] text-gray-900 dark:text-gray-100">Shared with {who} · after review</b><span className="text-[13px] text-gray-700 dark:text-gray-300">The brief above and your shareable profile.</span></div>
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"><b className="block text-[13px] text-gray-900 dark:text-gray-100">Axal operator notes</b><span className="text-[13px] text-gray-700 dark:text-gray-300">Kept by Axal. Not shown to you or to {who}.</span></div>
          </Card>
        </div>
      </div>
    </Frame>
  );
}

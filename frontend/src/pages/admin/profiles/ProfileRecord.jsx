import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, usePhoneWidth } from '../../../ui';
import { api } from '../../../lib/api';
import { partnerProfilesApi } from '../../../lib/api/partnerProfiles';
import { reportError } from '../../../lib/log';
import { useWebSocket } from '../../../hooks/useWebSocket';
import { SENSITIVE } from '../../../components/hqReview/hqReviewCopy';
import { reviewedView, statusWord, sourceWords } from './ppModel';
import {
  EADWYN_FIELDS, INVITATION_FIELDS, NOT_GIVEN, RECORD_LINE, TAX_SHOWN_SECONDS, TURNS_SHOWN, accountLine, agreementChoices, agreementRowLine, answers,
  historyLine, neighbours, recordShape, refusalOf, sendResult, summaryOf, taxLine, trackDetails, transcript, turnsLine, whoFacts,
} from './profileModel';
import { DecisionDialog, ReopenDialog, UnbindDialog } from './ProfileDialogs';
import { CARD, DANGER_GHOST, EYE, GHOST, H2, INPUT, MONO, OUTLINE, PRIMARY, STICKY_BAR, SUB, TAP, TONE, TONE_GLYPH } from './ppStyles';

/**
 * D995 (#2806) — one partner profile as PRF3's lightbox, at its own address
 * (`/admin/partner-profiles/<ref>`), over the list it was opened from.
 *
 * LEFT, what they said: Who they are (with the tax ID, masked, shown for 60
 * seconds on a logged Show), Founder track details for a Strategic Scale
 * founder, Eadwyn's summary, the onboarding conversation (live while the
 * member is in the chat), an invitation's answers, the answers to Eadwyn's
 * questions, and History (D991). A Draft says there is nothing to review.
 *
 * RIGHT, the sticky Decision card: the account and the identity check (read
 * only), the first agreement (or the invitation's, PRF4), how it is sent,
 * notes only admins see, and Verify… and Reject… (or Reopen… once decided).
 * A Super Admin can Unbind a profile whose address moved; an Admin reads one
 * sentence instead. Each opens PRF5's dialog; PRF6's result is said here.
 *
 * Each read answers alone: a block whose read failed says "Could not be read"
 * with Try again, and never blanks the record.
 *
 * D996 (#2807) — ON A PHONE (below 1024px, PRF11b and c) the record is a
 * full-screen page in the list's place: a back link to the list, the same
 * blocks in one column, the account and identity check, and an "Agreement
 * and notes" row that opens its own page (Back keeps what was there, Done
 * keeps the change). Verify… and Reject… (or Reopen…) sit in a bar fixed to
 * the bottom of the screen. Every tap target is at least 44 by 44 px.
 */

function useRead(fn, deps) {
  const [read, setRead] = useState({ status: 'loading', data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead((r) => ({ status: 'loading', data: r.data, error: null }));
    fn().then(
      (data) => { if (live) setRead({ status: 'ready', data, error: null }); },
      (e) => { reportError('partner-profiles:record-read', e); if (live) setRead({ status: 'error', data: null, error: e }); },
    );
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return [read, () => setTick((t) => t + 1)];
}

function Section({ title, meta, children, foot, testId, tone = 'card' }) {
  return (
    <section className={`${tone === 'lav' ? 'rounded-[12px] border border-axal-lavender-edge bg-axal-lavender dark:border-violet-700 dark:bg-violet-900/30' : CARD} flex min-w-0 flex-col gap-2.5 px-[18px] py-4`} data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={H2}>{title}</h3>
        {meta ? <span className={`${MONO} text-[11.5px] font-semibold text-axal-muted dark:text-gray-400`}>{meta}</span> : null}
      </div>
      {children}
      {foot ? <p className={`m-0 ${SUB}`}>{foot}</p> : null}
    </section>
  );
}

function Facts({ facts, testId }) {
  return (
    <dl className="m-0 grid grid-cols-1 gap-x-5 gap-y-2.5 sm:grid-cols-2" data-testid={testId}>
      {facts.map((f) => (
        <div key={f.k} className="flex min-w-0 flex-col gap-0.5">
          <dt className={EYE}>{f.k}</dt>
          <dd className={`m-0 text-[13px] font-semibold leading-[1.45] [overflow-wrap:anywhere] ${f.v === NOT_GIVEN ? 'text-axal-muted dark:text-gray-400' : 'text-axal-ink dark:text-gray-100'}`}>{f.v}</dd>
          {f.sub ? <dd className={`m-0 ${SUB}`}>{f.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

function Failed({ what, onRetry, testId }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2.5" data-testid={testId}>
      <span className="text-[13px] font-bold text-axal-destructive dark:text-red-400">Could not be read</span>
      <span className={SUB}>{what}</span>
      <button type="button" className={GHOST} onClick={onRetry}>Try again</button>
    </div>
  );
}

/** PRF5e: the tax ID, masked; Show is logged by the Worker and the value masks again after 60 seconds. */
function TaxRow({ profile }) {
  const masked = profile.masked?.ein ?? null;
  const [shown, setShown] = useState(null);
  const [left, setLeft] = useState(TAX_SHOWN_SECONDS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!shown) return undefined;
    setLeft(TAX_SHOWN_SECONDS);
    const t = setInterval(() => setLeft((s) => {
      if (s <= 1) { setShown(null); return TAX_SHOWN_SECONDS; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [shown]);
  const show = async () => {
    setBusy(true);
    setErr('');
    try { setShown(await api.adminShowProfileField(profile.email, 'ein')); } catch (e) { setErr(refusalOf(e, 'The tax ID could not be shown. Nothing was logged; try again.')); }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-1 border-t border-axal-hairline pt-2.5 dark:border-gray-700" data-testid="pp-tax">
      <span className={EYE}>Tax ID</span>
      {masked == null ? <span className={SUB} data-testid="pp-tax-nr">{SENSITIVE.nrEin}</span> : (
        <>
          <span className="flex flex-wrap items-center gap-2">
            <span className={`${MONO} text-[13px] font-bold tracking-[.04em] text-axal-ink dark:text-gray-100`} data-testid="pp-tax-value">{shown ? shown.value : masked}</span>
            <button type="button" className={GHOST} disabled={busy} onClick={shown ? () => setShown(null) : show} data-testid="pp-tax-toggle">{shown ? 'Hide' : 'Show'}</button>
          </span>
          <span className={SUB} data-testid="pp-tax-line">{taxLine(shown, left)}</span>
        </>
      )}
      {err ? <span role="alert" className="text-[12px] text-axal-destructive dark:text-red-300">{err}</span> : null}
    </div>
  );
}

/** The onboarding conversation: the stored transcript, joined live by the member's chat room while they are in it. */
function Conversation({ profile, name }) {
  const [turns, setTurns] = useState(() => transcript(profile));
  const [all, setAll] = useState(false);
  const seen = useRef(new Set(turns.map((m) => `${m.ts || ''}:${m.role}:${m.content}`)));
  const add = (list) => {
    const fresh = list.filter((m) => m && m.content).map((m) => ({ role: m.role === 'user' ? 'member' : 'eadwyn', content: String(m.content), ts: m.ts ?? null }))
      .filter((m) => { const k = `${m.ts || ''}:${m.role}:${m.content}`; if (seen.current.has(k)) return false; seen.current.add(k); return true; });
    if (fresh.length) setTurns((t) => [...t, ...fresh]);
  };
  const { status } = useWebSocket(profile.user_id ? `/api/onboarding/ws/${profile.user_id}` : null, {
    enabled: Boolean(profile.user_id),
    onMessage: (msg) => {
      if (msg?.type === 'hello' && Array.isArray(msg.recent)) add(msg.recent);
      else if (msg?.type === 'chat_message' && msg.message) add([msg.message]);
    },
  });
  const live = status === 'open';
  const showing = all ? turns : turns.slice(-TURNS_SHOWN);
  return (
    <Section title="Onboarding conversation" meta={turns.length ? turnsLine(turns.length, live) : null} testId="pp-conversation">
      {turns.length === 0 ? <span className={SUB}>No turns were stored for this conversation.</span> : (
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {showing.map((m, i) => (
            <li key={`${m.ts || i}:${i}`} className={`flex flex-col gap-0.5 ${m.role === 'member' ? 'items-end' : 'items-start'}`}>
              <span className={EYE}>{m.role === 'member' ? (name || 'Member') : 'Eadwyn'}</span>
              <span className={`max-w-[80%] whitespace-pre-wrap rounded-[12px] border px-3 py-2 text-[13px] leading-[1.5] text-axal-ink dark:text-gray-100 ${m.role === 'member' ? 'border-axal-lavender-edge bg-axal-lavender dark:border-violet-700 dark:bg-violet-900/40' : 'border-axal-hairline bg-axal-ground dark:border-gray-700 dark:bg-gray-800'}`}>{m.content}</span>
            </li>
          ))}
        </ol>
      )}
      {turns.length > TURNS_SHOWN ? (
        <button type="button" className={`${GHOST} self-start`} onClick={() => setAll((a) => !a)} data-testid="pp-conversation-all">
          {all ? `Show the last ${TURNS_SHOWN}` : `Show all ${turns.length} turns`}
        </button>
      ) : null}
    </Section>
  );
}

function History({ read, retry }) {
  return (
    <Section title="History" testId="pp-history" foot="Verified or Rejected, by whom, and Reopened are added here as they happen.">
      {read.status === 'loading' ? <span className={SUB}>Reading…</span> : null}
      {read.status === 'error' ? <Failed what="This profile’s history could not be read. That is not the same as none." onRetry={retry} testId="pp-history-failed" /> : null}
      {read.status === 'ready' && !(read.data?.items || []).length ? <span className={SUB} data-testid="pp-history-none">Nothing recorded yet.</span> : null}
      {read.status === 'ready' && (read.data?.items || []).length ? (
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {read.data.items.map((it, i) => {
            const l = historyLine(it);
            return (
              <li key={i} className="flex items-baseline gap-2.5" data-testid="pp-history-item">
                <span aria-hidden="true" className="w-3.5 flex-none text-center text-[13px] text-axal-violet dark:text-violet-300">{l.glyph}</span>
                <span className="min-w-0 flex-1 text-[13px] font-medium leading-[1.45] text-axal-ink dark:text-gray-100">{l.text}</span>
                <span className={`${MONO} whitespace-nowrap text-[12px] font-semibold text-axal-muted dark:text-gray-400`}>{l.when}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </Section>
  );
}

/** PRF6: what a decision did, said in the record. */
function Result({ result }) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;
  return (
    <div role="status" className={`flex flex-col gap-2 rounded-[10px] border px-3.5 py-3 ${TONE[result.tone]}`} data-testid="pp-result">
      <span className="flex gap-2.5 text-[13px] font-semibold leading-[1.5]"><span aria-hidden="true">{TONE_GLYPH[result.tone]}</span><span>{result.text}</span></span>
      {result.link ? (
        <span className="flex flex-wrap items-center gap-2">
          <span className={`${MONO} min-w-0 break-all text-[12px]`} data-testid="pp-result-link">{result.link}</span>
          <button type="button" className={GHOST} onClick={async () => { try { await navigator.clipboard.writeText(result.link); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Copied' : 'Copy'}</button>
        </span>
      ) : null}
      {result.contracts ? <Link to="/admin/contracts" className={`${GHOST} self-start`}>Open in Contracts</Link> : null}
    </div>
  );
}

function Row({ eye, testId, children }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-axal-hairline py-2.5 first:border-t-0 first:pt-0 dark:border-gray-700" data-testid={testId}>
      <span className={EYE}>{eye}</span>
      {children}
    </div>
  );
}

const isDecided = (shape) => shape.status === 'verified' || shape.status === 'rejected';

/** The account and the identity check, read only. */
function AccountRows({ profile }) {
  const listed = profile.listed || {};
  const acc = accountLine(listed);
  const id = listed.identity_check;
  return (
    <>
      <Row eye="Account" testId="pp-decision-account">
        {acc.has ? <span className={`${OUTLINE} self-start`}>{acc.text}</span> : <span className={SUB}>{acc.text}</span>}
        {acc.sub ? <span className={SUB}>{acc.sub}</span> : null}
        {acc.exploring ? <Link to="/admin/exploring" className={`${GHOST} self-start`} data-testid="pp-decision-exploring">Open the Exploring board</Link> : null}
      </Row>
      <Row eye="Identity check · read only" testId="pp-decision-identity">
        {id
          ? <><span className={`${OUTLINE} self-start`}>{id.label}</span><span className={SUB}>KYC &amp; KYB decides it. This page never does.</span></>
          : <span className={SUB}>No account yet</span>}
      </Row>
    </>
  );
}

/** The first agreement, how it is sent and the notes: the Decision card's, and PRF11c's page on a phone. */
function AgreementFields({ shape, agreements, retryAgreements, docusign, choice, setChoice }) {
  const decided = isDecided(shape);
  const groups = agreements.status === 'ready' ? agreementChoices(agreements.data) : [];
  const radio = `flex items-center gap-2 text-[13px] font-semibold ${TAP}`;
  return (
    <>
      {shape.invitation ? (
        <Row eye="First agreement" testId="pp-decision-agreement">
          <span className="text-[13px] font-medium leading-[1.5] text-axal-ink dark:text-gray-100">The partner agreement is sent by the invitation. See it on Partner invitations.</span>
          <Link to="/admin/partner-invitations" className={`${GHOST} self-start`} data-testid="pp-decision-invitations">Open Partner invitations</Link>
        </Row>
      ) : (
        <Row eye="First agreement · optional" testId="pp-decision-agreement">
          {agreements.status === 'error' ? <Failed what="The agreements could not be read, so none can be picked." onRetry={retryAgreements} testId="pp-agreements-failed" /> : (
            <select value={choice.agreement} disabled={agreements.status !== 'ready' || decided} onChange={(e) => {
              const opt = groups.flatMap((g) => g.options).find((o) => o.value === e.target.value);
              setChoice((c) => ({ ...c, agreement: e.target.value, agreementLabel: opt?.label || null }));
            }} className={INPUT} data-testid="pp-agreement">
              <option value="">No agreement</option>
              {groups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.options.map((o) => <option key={o.value} value={o.value} disabled={!o.ready}>{`${o.label} · ${o.note}`}</option>)}
                </optgroup>
              ))}
            </select>
          )}
          <span className={SUB}>Grouped as in Contracts. A not-ready agreement cannot be picked.</span>
        </Row>
      )}
      {!shape.invitation ? (
        <Row eye="Send with" testId="pp-decision-send">
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" disabled={decided}>
            <legend className="sr-only">Send with</legend>
            <label className={`${radio} text-axal-ink dark:text-gray-100`}>
              <input type="radio" name="pp-provider" checked={choice.provider !== 'docusign'} onChange={() => setChoice((c) => ({ ...c, provider: 'native' }))} /> StudioOS signing
            </label>
            <label className={`${radio} ${docusign ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-500'}`}>
              <input type="radio" name="pp-provider" disabled={!docusign} checked={choice.provider === 'docusign'} onChange={() => setChoice((c) => ({ ...c, provider: 'docusign' }))} data-testid="pp-provider-docusign" /> DocuSign
            </label>
            {!docusign ? (
              <span className={SUB}>
                DocuSign is not offered here: it needs a connected DocuSign account on the Raise + Grow plan.{' '}
                <Link to="/account/connectors/docusign" className={`inline-flex items-center font-bold text-axal-violet dark:text-violet-300 ${TAP}`}>connect DocuSign</Link>
              </span>
            ) : null}
          </fieldset>
        </Row>
      ) : null}
      <Row eye="Notes only admins see" testId="pp-decision-notes">
        <textarea value={choice.notes} onChange={(e) => setChoice((c) => ({ ...c, notes: e.target.value }))} rows={3} placeholder="Write a note…" className={INPUT} disabled={decided} data-testid="pp-notes" />
        {choice.notes && !decided ? <button type="button" className={`${GHOST} self-start`} onClick={() => setChoice((c) => ({ ...c, notes: '' }))} data-testid="pp-notes-clear">Clear</button> : null}
      </Row>
    </>
  );
}

/** Verify… and Reject…, or the verdict and Reopen… once decided. `bar` lays them out as PRF11b's sticky bar. */
function DecisionButtons({ profile, shape, onDialog, bar = false }) {
  const decided = isDecided(shape);
  const verdict = decided ? reviewedView(profile.listed || {}) : null;
  if (decided) {
    return (
      <>
        <span className={`${bar ? 'min-w-0 flex-1 self-center' : 'w-full'} ${SUB}`} data-testid="pp-decision-verdict">{`${statusWord(shape.status)}${verdict?.recorded ? ` ${verdict.text}` : ': its date was not recorded.'}`}</span>
        <button type="button" className={PRIMARY} onClick={() => onDialog('reopen')} data-testid="pp-decision-reopen">Reopen…</button>
      </>
    );
  }
  // PRF11b: Reject on the left, Verify wider on the right.
  return bar ? (
    <>
      <button type="button" className={`${DANGER_GHOST} flex-[1]`} onClick={() => onDialog('reject')} data-testid="pp-decision-reject">Reject…</button>
      <button type="button" className={`${PRIMARY} flex-[1.4]`} onClick={() => onDialog('verify')} data-testid="pp-decision-verify">Verify…</button>
    </>
  ) : (
    <>
      <button type="button" className={PRIMARY} onClick={() => onDialog('verify')} data-testid="pp-decision-verify">Verify…</button>
      <button type="button" className={DANGER_GHOST} onClick={() => onDialog('reject')} data-testid="pp-decision-reject">Reject…</button>
    </>
  );
}

function Unbind({ profile, viewerSuper, onDialog }) {
  if (!profile.unbind?.eligible) return null;
  return viewerSuper
    ? <button type="button" className={`${DANGER_GHOST} mt-2 self-start`} onClick={() => onDialog('unbind')} data-testid="pp-decision-unbind">Unbind…</button>
    : <p className={`m-0 mt-2 ${SUB}`} data-testid="pp-decision-unbind-admin">This profile’s address now belongs to another account. Only a Super Admin can unbind a profile from an account.</p>;
}

function DecisionCard({ profile, shape, agreements, retryAgreements, docusign, choice, setChoice, viewerSuper, result, onDialog }) {
  return (
    <section className={`${CARD} flex flex-col px-[18px] py-4 lg:sticky lg:top-0`} data-testid="pp-decision">
      <h3 className={`${H2} pb-2.5`}>Decision</h3>
      <AccountRows profile={profile} />
      <AgreementFields shape={shape} agreements={agreements} retryAgreements={retryAgreements} docusign={docusign} choice={choice} setChoice={setChoice} />
      <Result result={result} />
      <div className="flex flex-wrap gap-2 pt-3">
        <DecisionButtons profile={profile} shape={shape} onDialog={onDialog} />
      </div>
      <Unbind profile={profile} viewerSuper={viewerSuper} onDialog={onDialog} />
    </section>
  );
}

/** PRF11b's door to PRF11c: what is chosen, whether it is ready, and whether a note is written. */
function AgreementRow({ shape, agreements, choice, onOpen }) {
  const groups = agreements.status === 'ready' ? agreementChoices(agreements.data) : null;
  return (
    <section className={CARD} data-testid="pp-phone-agreement-row">
      <button type="button" onClick={onOpen} className="flex min-h-[56px] w-full items-center gap-3 px-[18px] py-3 text-left" data-testid="pp-phone-agreement-open">
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold text-axal-ink dark:text-gray-100">Agreement and notes</span>
          <span className={`block ${SUB}`}>{agreements.status === 'error' && !shape.invitation ? 'The agreements could not be read.' : agreementRowLine(choice, groups, { invitation: shape.invitation })}</span>
        </span>
        <span aria-hidden="true" className="text-[18px] text-axal-muted dark:text-gray-400">›</span>
      </button>
    </section>
  );
}

/** D996: a phone page's head: the back link, the title, and what sits under it. */
function PhoneHead({ back, onBack, title, children, testId }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-axal-hairline px-4 pb-3 pt-1 dark:border-gray-700" data-testid={testId}>
      <button type="button" onClick={onBack} className={`self-start font-mono text-[11px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400 ${TAP} inline-flex items-center`} data-testid={`${testId}-back`}>{`‹ ${back}`}</button>
      <h1 className="m-0 text-[20px] font-extrabold leading-[1.25] tracking-[-.02em] text-axal-ink dark:text-gray-100">{title}</h1>
      {children}
    </div>
  );
}

/**
 * The record. `rows` is the list it was opened from (for Previous, Next and
 * "3 of 7"). `onGo(ref)` opens another record; `onClose()` returns to the
 * list; `onDecided(note, advance)` tells the page what changed, and whether
 * to move on to the next waiting profile. `backLabel` names that list on a
 * phone's back link.
 */
export default function ProfileRecord({ refId, rows, viewerSuper = false, onGo, onClose, onDecided, onChanged, backLabel = 'To review' }) {
  const phone = usePhoneWidth();
  const [profile, retryProfile] = useRead(() => partnerProfilesApi.get(refId), [refId]);
  const [history, retryHistory] = useRead(() => partnerProfilesApi.history(refId), [refId]);
  const [agreements, retryAgreements] = useRead(() => partnerProfilesApi.agreements(), []);
  const [docusign, setDocusign] = useState(false);
  useEffect(() => {
    let live = true;
    api.integrationsList().then(
      (rowsIn) => {
        const list = Array.isArray(rowsIn) ? rowsIn : (rowsIn?.integrations || rowsIn?.items || []);
        if (live) setDocusign(list.some((r) => (r.provider_key || r.provider) === 'docusign' && r.status === 'active'));
      },
      () => { if (live) setDocusign(false); },
    );
    return () => { live = false; };
  }, []);
  const p = profile.status === 'ready' ? profile.data : null;
  const [choice, setChoice] = useState({ agreement: '', agreementLabel: null, notes: '', provider: 'native' });
  useEffect(() => {
    if (p) setChoice({ agreement: p.agreement_type || '', agreementLabel: p.agreement_type || null, notes: p.admin_notes || '', provider: 'native' });
  }, [p]);
  const [dialog, setDialog] = useState(null);
  const [result, setResult] = useState(null);
  // D996 (PRF11c): on a phone the agreement and notes are their own page. Its
  // changes are a draft until Done; Back leaves the record's choice as it was.
  const [view, setView] = useState('record');
  const [draft, setDraft] = useState(null);
  useEffect(() => { setResult(null); setDialog(null); setView('record'); }, [refId]);
  const openAgreement = () => { setDraft(choice); setView('agreement'); };
  const keepAgreement = () => { setChoice(draft); setView('record'); };

  const place = neighbours(rows, refId);
  const shape = p ? recordShape(p) : null;
  const name = p ? (p.listed?.user_name || p.listed?.full_name || p.user_name || p.full_name || null) : null;
  const label = name || p?.email || 'Partner profile';

  const decided = useCallback((res, status) => {
    setDialog(null);
    const r = sendResult(res, { status, email: p?.email });
    onChanged?.();
    // Sent, or rejected: the next waiting profile opens and the page says what changed.
    // A link to copy, or an agreement not sent, stays here to be read.
    if (r.tone === 'green') onDecided?.(r, true);
    else { setResult(r); retryProfile(); retryHistory(); }
  }, [p, onChanged, onDecided, retryProfile, retryHistory]);

  const head = (
    <div className="flex flex-col gap-2 border-b border-axal-hairline px-5 pb-3.5 pt-1 dark:border-gray-700" data-testid="pp-record-head">
      <span className={EYE}>Partner profile</span>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[18px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{label}</h2>
        <span className={`${MONO} text-[12px] font-semibold text-axal-muted dark:text-gray-400`} data-testid="pp-record-place">{place.label ? `${place.label} · Esc to close` : 'Esc to close'}</span>
      </div>
      {p ? <span className={`${MONO} text-[12.5px] text-axal-muted dark:text-gray-400`}>{`${p.email} · ${p.ref || refId}`}</span> : null}
      {p ? (
        <span className="flex flex-wrap gap-1.5" data-testid="pp-record-tags">
          <span className={OUTLINE}>{statusWord(shape.status)}</span>
          {sourceWords(shape.sources).map((s) => <span key={s} className={OUTLINE}>{s}</span>)}
        </span>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {!shape?.draft ? (
          <>
            <button type="button" className={GHOST} disabled={!place.prev} onClick={() => onGo(place.prev)} data-testid="pp-record-prev">‹ Previous</button>
            <button type="button" className={GHOST} disabled={!place.next} onClick={() => onGo(place.next)} data-testid="pp-record-next">Next ›</button>
          </>
        ) : null}
        <span className={SUB}>{RECORD_LINE}</span>
      </div>
    </div>
  );

  const phoneHead = (
    <PhoneHead back={backLabel} onBack={onClose} title={label} testId="pp-record-head">
      {p ? (
        <span className="flex flex-wrap gap-1.5" data-testid="pp-record-tags">
          <span className={OUTLINE}>{statusWord(shape.status)}</span>
          {sourceWords(shape.sources).map((s) => <span key={s} className={OUTLINE}>{s}</span>)}
        </span>
      ) : null}
      <p className={`m-0 [overflow-wrap:anywhere] ${SUB}`}>{p ? `${p.email} · ${p.ref || refId} · ${RECORD_LINE}` : RECORD_LINE}</p>
    </PhoneHead>
  );

  let body;
  if (profile.status === 'loading' && !p) body = <div className="px-5 py-6"><span className={SUB}>Reading…</span></div>;
  else if (profile.status === 'error') {
    body = (
      <div className="px-5 py-6" data-testid="pp-record-failed">
        {Number(profile.error?.status) === 404
          ? <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">No partner profile has this address.</p>
          : <Failed what="This profile could not be read." onRetry={retryProfile} testId="pp-record-failed-retry" />}
      </div>
    );
  } else if (shape.draft) {
    body = (
      <div className="flex flex-col items-center gap-2 px-6 py-8 text-center" data-testid="pp-record-draft">
        <p className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">Nothing to review yet.</p>
        <p className={`m-0 ${SUB}`}>{`Eadwyn opened this record when ${name || 'they'} started answering. It joins the queue when they finish.`}</p>
      </div>
    );
  } else {
    const details = trackDetails(p);
    const summary = summaryOf(p);
    body = (
      <div className="grid grid-cols-1 items-start gap-3.5 px-5 py-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3.5">
          {shape.who ? (
            <Section title="Who they are" testId="pp-who">
              <Facts facts={whoFacts(p)} testId="pp-who-facts" />
              <TaxRow profile={p} />
            </Section>
          ) : null}
          {details ? <Section title="Founder track details" testId="pp-track" foot="Shown only for a Strategic Scale founder."><Facts facts={details} /></Section> : null}
          {summary ? (
            <Section title="Eadwyn’s summary" tone="lav" testId="pp-summary" foot="Written by Eadwyn from the conversation. Check it against the conversation below.">
              <p className="m-0 text-[13.5px] font-semibold leading-[1.55] text-axal-ink dark:text-gray-100">{summary}</p>
            </Section>
          ) : null}
          {shape.chat ? <Conversation key={refId} profile={p} name={name} /> : null}
          {shape.invitation ? <Section title="Invitation answers" testId="pp-invitation"><Facts facts={answers(p, INVITATION_FIELDS)} /></Section> : null}
          {shape.eadwyn ? (
            <Section title="Answers to Eadwyn" testId="pp-eadwyn">
              {shape.chat ? <p className="m-0 text-[12.5px] font-semibold text-axal-violet dark:text-violet-300">These answers came in after the onboarding chat.</p> : null}
              <Facts facts={answers(p, EADWYN_FIELDS)} />
            </Section>
          ) : null}
          {phone ? null : <History read={history} retry={retryHistory} />}
          {phone ? (
            <>
              <section className={`${CARD} flex flex-col px-[18px] py-4`} data-testid="pp-phone-account">
                <AccountRows profile={p} />
                <Unbind profile={p} viewerSuper={viewerSuper} onDialog={setDialog} />
              </section>
              <AgreementRow shape={shape} agreements={agreements} choice={choice} onOpen={openAgreement} />
              <Result result={result} />
              <History read={history} retry={retryHistory} />
            </>
          ) : null}
        </div>
        {phone ? null : (
          <DecisionCard profile={p} shape={shape} agreements={agreements} retryAgreements={retryAgreements} docusign={docusign}
            choice={choice} setChoice={setChoice} viewerSuper={viewerSuper} result={result} onDialog={setDialog} />
        )}
      </div>
    );
  }

  // D996 (PRF11c): the agreement and notes on their own phone page, Back and Done in the bar.
  const agreementPage = phone && view === 'agreement' && p && draft;
  const pageHead = agreementPage ? (
    <PhoneHead back={label} onBack={() => setView('record')} title="Agreement and notes" testId="pp-agreement-head">
      <p className={`m-0 ${SUB}`}>Choose a first agreement if one fits, and leave a note for other admins.</p>
    </PhoneHead>
  ) : phoneHead;
  const phoneBody = agreementPage ? (
    <>
      <div className="px-4 py-4" data-testid="pp-agreement-page">
        <section className={`${CARD} flex flex-col px-[18px] py-4`}>
          <AgreementFields shape={shape} agreements={agreements} retryAgreements={retryAgreements} docusign={docusign} choice={draft} setChoice={setDraft} />
        </section>
      </div>
      <div className={STICKY_BAR} data-testid="pp-agreement-bar">
        <button type="button" className={`${GHOST} flex-[1]`} onClick={() => setView('record')} data-testid="pp-agreement-back">Back</button>
        <button type="button" className={`${PRIMARY} flex-[1.4]`} onClick={keepAgreement} data-testid="pp-agreement-done">Done</button>
      </div>
    </>
  ) : (
    <>
      {body}
      {p && !shape.draft ? (
        <div className={STICKY_BAR} data-testid="pp-record-bar">
          <DecisionButtons profile={p} shape={shape} onDialog={setDialog} bar />
        </div>
      ) : null}
    </>
  );

  return (
    <Lightbox label={label} onClose={onClose} testId="pp-record" size="tall" pageBelow="lg" bar={phone ? () => pageHead : undefined}>
      {phone ? phoneBody : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {head}
          {body}
        </div>
      )}
      {p && (dialog === 'verify' || dialog === 'reject') ? <DecisionDialog kind={dialog} profile={p} choice={choice} onClose={() => setDialog(null)} onDone={decided} /> : null}
      {p && dialog === 'reopen' ? (
        <ReopenDialog row={{ ...p.listed, ref: p.ref || refId }} onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); onChanged?.(); setResult({ tone: 'green', text: 'Back in the queue.' }); retryProfile(); retryHistory(); }} />
      ) : null}
      {p && dialog === 'unbind' ? (
        <UnbindDialog profile={{ ...p, ref: p.ref || refId }} onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); onChanged?.(); setResult({ tone: 'green', text: 'Unbound. The right account can answer now. This is recorded in Governance.' }); retryProfile(); }} />
      ) : null}
    </Lightbox>
  );
}

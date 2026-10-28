import React, { useState } from 'react';
import Sheet from '../../../ui/Sheet.jsx';
import Pill from '../../../ui/Pill.jsx';
import {
  AVAILABILITY, answerPairs, applicationRow as rowFor, applyBody, canLeave, dateRange, fmtDate, isOpenApplication, joinBody,
  placesLine, refusalText, testerCard, withdrawQuestion, withdrawnNote,
} from './testerModel.js';

/**
 * D1337 (#3542) — the member's four Product testing sheets, each D1317's one
 * right Sheet (a full-screen page below 640px):
 *   · BecomeSheet (PT-M1): what testers do, who can apply, the consent with
 *     its version, Availability and Apply;
 *   · PoolSheet: the member's own place in the pool, and Leave behind a confirm;
 *   · ProgrammeSheet (PT-M2): the programme, its questions and Apply;
 *   · ApplicationSheet (PT-M3, PT-M4): the application, its answers, and
 *     Withdraw behind the confirm, then the result.
 * Every change asks first, in place: no pop-up. No email and no other
 * tester's name is drawn.
 */

export const TONE = { wait: 'warn', pos: 'ok', neg: 'danger', mut: 'neutral', vio: 'info' };
export const BTN = 'inline-flex min-h-11 items-center justify-center rounded-lg px-3.5 text-[13.5px] font-semibold sm:min-h-10 disabled:opacity-50';
export const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep dark:bg-violet-600 dark:hover:bg-violet-500`;
export const SECONDARY = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const DANGER = `${BTN} bg-red-700 text-white hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-500`;
const DANGER_TEXT = `${BTN} px-1.5 text-red-700 hover:underline dark:text-red-400`;
const EYEBROW = 'text-[10.5px] font-medium uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const P = 'm-0 text-[13px] leading-relaxed text-gray-700 dark:text-gray-300';
const MUTED = 'm-0 text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

function Section({ label, children }) {
  return <div className="flex flex-col gap-2"><div className={EYEBROW}>{label}</div>{children}</div>;
}

function Tiles({ items }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5 rounded-lg border border-axal-hairline px-3 py-2.5 dark:border-gray-800">
          <span className="text-[12px] text-axal-muted dark:text-gray-400">{k}</span>
          <span className="text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Refusal({ text, testId }) {
  return text ? <p role="alert" data-testid={testId} className="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{text}</p> : null;
}

function Done({ text, testId }) {
  return <div role="status" data-testid={testId} className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-[13px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"><span aria-hidden="true">✓</span>{text}</div>;
}

/** The in-place confirm a change asks first with (PT-M3's alertdialog). */
function Confirm({ question, keep, go, busy, onKeep, onGo, testId }) {
  return (
    <div role="alertdialog" aria-label={question} data-testid={testId} className="flex w-full flex-col gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 dark:border-red-900 dark:bg-red-950/40">
      <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid={`${testId}-says`}>{question}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={SECONDARY} onClick={onKeep} disabled={busy} data-testid={`${testId}-keep`}>{keep}</button>
        <button type="button" className={DANGER} onClick={onGo} disabled={busy} data-testid={`${testId}-go`}>{busy ? 'Working…' : go}</button>
      </div>
    </div>
  );
}

/** PT-M1: Become a Product tester. `read` is `GET /api/testing/tester`. */
export function BecomeSheet({ read, api, onClose, onJoined }) {
  const [agreed, setAgreed] = useState(false);
  const [availability, setAvailability] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const body = joinBody(read, { agreed, availability });
  const blocked = read?.can_apply === false ? (read?.cannot_apply?.message || 'You can’t apply right now.') : '';
  const apply = async () => {
    if (!body || busy) return;
    setBusy(true); setRefusal('');
    try { onJoined?.(await api.joinPool(body)); } catch (e) { setRefusal(refusalText(e, 'Your application could not be sent. Try again.')); } finally { setBusy(false); }
  };
  const version = read?.consent?.version || null;
  return (
    <Sheet title="Become a Product tester" eyebrow="Product testing" onClose={onClose} width={560} testId="pt-become"
      footer={(
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="flex-1 text-[12.5px] text-axal-muted dark:text-gray-400">An Axal VC admin decides. You’re told in Inbox.</span>
          {!blocked && <button type="button" className={PRIMARY} onClick={apply} disabled={!body || busy} data-testid="pt-become-apply">{busy ? 'Sending…' : 'Apply'}</button>}
        </div>
      )}>
      <div className="flex flex-col gap-[18px] px-5 py-[18px]">
        <Section label="What testers do">
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-[18px] text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">
            <li>Try a product before it launches, usually 1 to 3 hours a week.</li>
            <li>Answer a few questions and say what worked and what didn’t.</li>
            <li>Firms pick testers from the pool for each programme. You choose which programmes to apply to.</li>
          </ul>
        </Section>
        <Section label="Who can apply"><p className={P}>Any member with a profile can apply, Explorers included. Admin accounts can’t.</p></Section>
        {blocked ? <Refusal text={blocked} testId="pt-become-blocked" /> : (
          <>
            <Section label="Consent">
              <div className="flex flex-col gap-2 rounded-lg border border-axal-hairline bg-gray-50 px-3.5 py-3 dark:border-gray-800 dark:bg-gray-900">
                <p className={P} data-testid="pt-become-consent">{read?.consent?.text || 'The consent text could not be read.'}</p>
                <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">Version {version || 'not recorded'}</span>
              </div>
              <label className="flex min-h-11 items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
                <input type="checkbox" className="h-4 w-4 accent-violet-600" checked={agreed} disabled={!version}
                  onChange={(e) => setAgreed(e.target.checked)} data-testid="pt-become-agree" />
                I agree to consent version {version || 'not recorded'}.
              </label>
            </Section>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-axal-ink dark:text-gray-100">
              Availability <span className="font-normal text-axal-muted dark:text-gray-400">Optional</span>
              <select className={`${FIELD} min-h-11 sm:min-h-10`} value={availability} onChange={(e) => setAvailability(e.target.value)} data-testid="pt-become-availability">
                <option value="">Not given</option>
                {AVAILABILITY.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
          </>
        )}
        <Refusal text={refusal} testId="pt-become-refusal" />
      </div>
    </Sheet>
  );
}

/** The member's own place in the pool: what HQ decided, and Leave the tester pool behind a confirm. */
export function PoolSheet({ read, api, onClose, onChanged }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [left, setLeft] = useState(false);
  const card = testerCard(read);
  const t = read?.tester || {};
  const leave = async () => {
    setBusy(true); setRefusal('');
    try { const next = await api.leavePool(); setLeft(true); setAsking(false); onChanged?.(next); } catch (e) { setRefusal(refusalText(e, 'Leaving the pool did not go through. Try again.')); } finally { setBusy(false); }
  };
  const tiles = [['Applied', fmtDate(t.applied_at) || 'Not recorded'], ['Decided', fmtDate(t.decided_at) || (t.status === 'applied' ? 'Not yet' : 'Not recorded')], ['Availability', t.availability || 'Not given']];
  return (
    <Sheet title="Your place in the tester pool" eyebrow="Product testing" onClose={onClose} width={560} testId="pt-pool"
      footer={asking ? (
        <Confirm testId="pt-leave-confirm" busy={busy} onKeep={() => setAsking(false)} onGo={leave} keep="Stay in the pool" go="Leave the pool"
          question="Leave the tester pool? You won’t be picked for new programmes. Programmes you’re already in carry on." />
      ) : (
        <div className="flex items-center gap-2">
          {canLeave(read) && !left && <button type="button" className={DANGER_TEXT} onClick={() => setAsking(true)} data-testid="pt-pool-leave">Leave the tester pool</button>}
          <span className="flex-1" />
          <button type="button" className={SECONDARY} onClick={onClose} data-testid="pt-pool-done">Close</button>
        </div>
      )}>
      <div className="flex flex-col gap-[18px] px-5 py-[18px]">
        {left && <Done testId="pt-pool-left" text="You left the tester pool. Programmes you’re already in carry on." />}
        <div className="flex flex-wrap items-center gap-2.5"><Pill tone={TONE[card.tone]} data-testid="pt-pool-pill">{card.pill}</Pill><span className="text-[13px] text-gray-700 dark:text-gray-300" data-testid="pt-pool-text">{card.text}</span></div>
        <Tiles items={tiles} />
        <Section label="Consent">
          <p className={P}>{t.consent_version ? `You agreed to consent version ${t.consent_version}.` : 'No consent is recorded.'}{t.consent_version && t.consent_current === false ? ' The consent has changed since; you’re asked again when you next apply.' : ''}</p>
        </Section>
        <Refusal text={refusal} testId="pt-pool-refusal" />
      </div>
    </Sheet>
  );
}

/** PT-M2: one open programme, its questions and Apply. `consent` is the programmes read's D812 email consent. */
export function ProgrammeSheet({ programme: p, consent, api, onClose, onApplied }) {
  const qs = Array.isArray(p?.questions) ? p.questions : [];
  const [answers, setAnswers] = useState(() => qs.map(() => ''));
  const [emailOk, setEmailOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const applied = p?.my_status != null && p.my_status !== 'withdrawn';
  const body = applyBody(p, answers, emailOk);
  const firm = p?.owner_name || 'the firm';
  const apply = async () => {
    if (!body || busy) return;
    setBusy(true); setRefusal('');
    try { const r = await api.apply(p.uid, body); onApplied?.(r?.application || null); } catch (e) { setRefusal(refusalText(e, 'Your application could not be sent. Try again.')); } finally { setBusy(false); }
  };
  const closes = fmtDate(p?.closes_at);
  return (
    <Sheet title={p?.product_name || 'Open programme'} eyebrow="Open programme" onClose={onClose} width={560} testId="pt-programme"
      footer={(
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="flex-1 text-[12.5px] text-axal-muted dark:text-gray-400">{closes ? `Applications close ${closes}.` : 'No closing date is set.'}</span>
          {applied ? <Pill tone="warn" data-testid="pt-programme-applied">You applied</Pill>
            : <button type="button" className={PRIMARY} onClick={apply} disabled={!body || busy} data-testid="pt-programme-apply">{busy ? 'Sending…' : 'Apply'}</button>}
        </div>
      )}>
      <div className="flex flex-col gap-[18px] px-5 py-[18px]">
        <Tiles items={[['Run by', p?.owner_name || 'Not recorded'], ['Testing', dateRange(p?.testing_starts, p?.testing_ends) || 'Dates not set'], ['Places left', placesLine(p)]]} />
        <Section label="What the test asks">
          <p className={P}>{p?.tester_tasks || p?.summary || 'Not described yet.'}{p?.time_needed ? ` Time needed: ${p.time_needed}.` : ''}</p>
        </Section>
        {qs.length > 0 && !applied && (
          <Section label="Questions">
            {qs.map((q, i) => (
              <label key={i} className="flex flex-col gap-1.5 text-[13px] font-semibold text-axal-ink dark:text-gray-100">
                {q}
                <textarea rows={3} maxLength={2000} className={FIELD} value={answers[i] || ''} placeholder="Write a few lines" data-testid={`pt-programme-answer-${i}`}
                  onChange={(e) => setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))} />
              </label>
            ))}
          </Section>
        )}
        {!applied && consent?.text && (
          <label className="flex min-h-11 items-start gap-2 text-[13px] text-axal-ink dark:text-gray-100">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-600" checked={emailOk} onChange={(e) => setEmailOk(e.target.checked)} data-testid="pt-programme-email" />
            <span>{consent.text} <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">Optional · version {consent.version}</span></span>
          </label>
        )}
        <p className={MUTED}>Your answers go to {firm} only. Other testers can’t see them, and no one sees your email.</p>
        <Refusal text={refusal} testId="pt-programme-refusal" />
      </div>
    </Sheet>
  );
}

/** PT-M3 / PT-M4: one of my applications, and Withdraw behind its confirm. `ask` opens with the confirm showing (the Inbox's Withdraw). */
export function ApplicationSheet({ application: a, api, onClose, onWithdrawn, ask = false }) {
  const [asking, setAsking] = useState(ask && isOpenApplication(a));
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [done, setDone] = useState(null);
  const shown = done || a;
  const row = shown ? rowFor(shown) : null;
  const withdraw = async () => {
    setBusy(true); setRefusal('');
    try {
      const r = await api.withdraw(a.uid);
      const next = { ...a, ...(r?.application || {}), status: 'withdrawn', withdrawn_by: 'member', owner_name: a.owner_name, questions: a.questions };
      setDone(next); setAsking(false); onWithdrawn?.(next);
    } catch (e) { setRefusal(refusalText(e, 'Withdrawing did not go through. Try again.')); } finally { setBusy(false); }
  };
  if (!a) return null;
  const firm = a.owner_name || 'the firm';
  return (
    <Sheet title={a.product_name || 'My application'} eyebrow="My application" onClose={onClose} width={560} testId="pt-application"
      footer={asking ? (
        <Confirm testId="pt-withdraw-confirm" busy={busy} onKeep={() => setAsking(false)} onGo={withdraw} keep="Keep my place" go="Withdraw"
          question={withdrawQuestion(a.product_name || 'this programme')} />
      ) : (
        <div className="flex items-center gap-2">
          {!done && isOpenApplication(a) && <button type="button" className={DANGER_TEXT} onClick={() => setAsking(true)} data-testid="pt-application-withdraw">Withdraw</button>}
          <span className="flex-1" />
          <button type="button" className={SECONDARY} onClick={onClose} data-testid="pt-application-close">Close</button>
        </div>
      )}>
      <div className="flex flex-col gap-[18px] px-5 py-[18px]">
        {done && <Done testId="pt-application-withdrawn" text={withdrawnNote(done)} />}
        <div className="flex flex-wrap items-center gap-2.5"><Pill tone={TONE[row.tone]} data-testid="pt-application-pill">{row.pill}</Pill><span className="text-[13px] text-gray-700 dark:text-gray-300" data-testid="pt-application-line">{row.line}</span></div>
        <Tiles items={[['Run by', a.owner_name || 'Not recorded'], ['Testing', dateRange(a.testing_starts, a.testing_ends) || 'Dates not set'], ['Applied', fmtDate(a.applied_at) || 'Not recorded']]} />
        <Section label="Your answers">
          <div className="flex flex-col" data-testid="pt-application-answers">
            {answerPairs(a).length ? answerPairs(a).map(({ q, a: ans }, i) => (
              <div key={i} className="flex flex-col gap-0.5 border-t border-axal-hairline py-2 dark:border-gray-800">
                <span className="text-[12.5px] text-axal-muted dark:text-gray-400">{q}</span>
                <span className="text-[13.5px] text-axal-ink dark:text-gray-100">{ans}</span>
              </div>
            )) : <p className={P}>This programme asked no questions.</p>}
          </div>
        </Section>
        <p className={MUTED}>Only {firm} sees your answers. No one sees your email.</p>
        <Refusal text={refusal} testId="pt-application-refusal" />
      </div>
    </Sheet>
  );
}

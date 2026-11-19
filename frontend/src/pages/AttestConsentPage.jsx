import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { proofDate, proofKindLabel } from './advisor/expertise/proofModel';

/**
 * The attester's side of an advisor's proof claim (EX-10, D4825). Public,
 * unauthenticated, reached by a link the advisor handed over.
 *
 * THREE STAGES, AS THE CANVAS DRAWS THEM. A · Arrive: what they are asked,
 * how they will appear, what confirming means, how it is used and how to
 * withdraw, and Email me a code to the masked address. B · Code: the six
 * digits, then Confirm this statement or I can’t confirm this. C · Confirmed:
 * the date, the history, and Withdraw my confirmation (with a new code).
 * Nothing here says "verified": a confirmation is this person's word, given
 * with a code sent to the address the advisor named, and it stays private
 * until the advisor publishes it.
 *
 * WHY IT IS NOT BEHIND A LOGIN. An attester is usually not a user of this
 * product — a former manager, a client, a co-founder somewhere else. Requiring
 * an account would mean the only confirmable claims are the ones a colleague
 * already inside Axal can vouch for, which is the wrong set.
 *
 * THE LINK SHOWS, A CODE ANSWERS (D4670). The advisor holds this link too, so
 * the link alone must not be able to answer. It shows the claim exactly as the
 * attester is asked to confirm it, who asked, and the history of answers.
 * Confirming, declining, withdrawing or reconfirming needs a six-digit code
 * that Axal emails, when the attester presses the button, to the address the
 * advisor named. The page shows that address masked.
 *
 * WHAT IS AND IS NOT ASKED. The wording of what is being agreed to is captured
 * as `consent_text` and stored with the answer, because a consent record that
 * does not say what was consented to is not a record of anything — that is the
 * shape `reference_checks` established and migration 204 copied. The public
 * statement is optional and separate: agreeing that something is true is not
 * the same act as writing a quote for someone's storefront.
 *
 * DECLINING IS RECORDED, NOT DISCARDED. Saying no leaves a row saying no, and
 * every answer stays in the history, so a withdrawal cannot quietly become a
 * yes again.
 *
 * A FAILURE READS AS A FIXED SENTENCE keyed on the Worker's code
 * (`ATTEST_REFUSALS`), never the raw error text.
 */

const CONSENT_TEXT =
  'I confirm this is accurate, and I agree to it being shown as confirmed on this '
  + 'advisor’s public profile.';

export const ATTEST_REFUSALS = Object.freeze({
  consent_not_found: 'This request does not exist, or the claim it was about was removed.',
  code_required: 'Enter the six-digit code we emailed you.',
  code_wrong: 'That code is not right. Check the latest email and try again.',
  code_expired: 'That code has expired or was already used. Ask for a new one.',
  code_rate_limited: 'Several codes were sent in the last hour. Use the latest one, or try again later.',
  code_unsent: 'The code could not be emailed just now. Try again in a few minutes.',
  attester_email_missing: 'This request names no email address, so no code can be sent. Ask the advisor to send a new request.',
  claim_changed: 'The claim has changed since you were asked. Nothing was recorded; the advisor needs to ask again.',
  requester_cannot_attest: 'You cannot answer a request about your own claim.',
  consent_text_required: 'Tick the confirmation to say what you agree to.',
});
const fixed = (e, fallback) => ATTEST_REFUSALS[e?.code] || fallback;

const STATE_LABELS = {
  pending: 'Not answered yet',
  confirmed: 'You confirmed this',
  declined: 'You declined',
  withdrawn: 'You withdrew your confirmation',
  cancelled: 'The advisor cancelled this request',
  needs_reconfirmation: 'Your earlier confirmation needs confirming again',
};
const EVENT_LABELS = { asked: 'Asked', confirmed: 'Confirmed by you', declined: 'Declined by you', withdrawn: 'Withdrawn by you', reconfirmed: 'Confirmed again by you' };
const when = (iso) => { const t = Date.parse(iso || ''); return Number.isNaN(t) ? null : new Date(t).toLocaleString(); };

const inputClass =
  'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] '
  + 'focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 '
  + 'dark:border-gray-700 dark:bg-gray-900';
// Every button is a 44px target (EX-10 is a phone-first page: most attesters open it from an email or a message).
const tap = 'inline-flex min-h-[44px] items-center justify-center';
const primary = `${tap} rounded-lg bg-emerald-700 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50`;
const secondary = `${tap} rounded-lg border border-axal-hairline px-3.5 py-2 text-[13px] font-semibold hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800`;
const linkish = 'min-h-[44px] text-[12.5px] font-semibold text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300';

export default function AttestConsentPage() {
  const { token } = useParams();
  const enc = encodeURIComponent(token || '');
  const [read, setRead] = useState({ loading: true, error: '', data: null });
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(null); // { email_hint }
  const [entering, setEntering] = useState(false); // B · the code field is open
  const [withdrawing, setWithdrawing] = useState(false);
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const load = useCallback(async () => {
    setRead((r) => ({ ...r, loading: true, error: '' }));
    try { setRead({ loading: false, error: '', data: await api.getAdvisorProofConsentClaim(enc) }); }
    catch (e) { setRead({ loading: false, error: fixed(e, 'This request could not be read. Try again.'), data: null }); }
  }, [enc]);
  useEffect(() => { load(); }, [load]);

  const askCode = async () => {
    setBusy(true); setError('');
    try { setSent(await api.requestAdvisorProofConsentCode(enc)); setEntering(true); }
    catch (e) { setError(fixed(e, 'The code could not be sent. Try again.')); }
    finally { setBusy(false); }
  };

  const send = async (consentGiven) => {
    setBusy(true); setError('');
    try {
      await api.respondToAdvisorProofConsent(enc, consentGiven
        ? { code: code.trim(), consent_text: CONSENT_TEXT, statement: statement.trim() || null, claim_sha256: read.data?.claim_sha256 }
        : { code: code.trim(), consent_given: false });
      setDone(consentGiven ? 'given' : 'declined');
      setCode(''); setSent(null); setEntering(false); setWithdrawing(false);
      load();
    } catch (e) {
      setError(fixed(e, 'That could not be recorded. Nothing was saved.'));
    } finally {
      setBusy(false);
    }
  };

  const d = read.data;
  const advisor = d?.advisor_name || 'The advisor';
  const confirmedNow = d?.state === 'confirmed';
  const closed = d?.state === 'cancelled';
  const confirmedAt = [...(d?.history || [])].reverse().find((h) => h.kind === 'confirmed' || h.kind === 'reconfirmed')?.created_at;
  const where = [d?.claim?.organization, d?.claim?.period_note].filter(Boolean).join(' · ');
  const codeOpen = entering && (!confirmedNow || withdrawing);
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
      <div className="rounded-axal-lg border border-axal-hairline bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-5 w-5 rounded-md bg-emerald-700" />
          <b className="text-[13px]">Axal VC</b>
          <span className="ml-auto text-[11.5px] text-axal-faint">Confirmation request</span>
        </div>
        {read.loading && <p role="status" className="mt-3 text-[13px]">Loading the claim…</p>}
        {!read.loading && read.error && (
          <div role="alert" className="mt-3 text-[13px]">
            <p>{read.error}</p>
            <button type="button" className={`${secondary} mt-3`} onClick={load}>Try again</button>
          </div>
        )}
        {d && (
          <>
            <h1 className="mt-3 text-lg font-extrabold tracking-tight sm:text-xl">
              {d.advisor_name || 'An advisor'} asked you to confirm a statement
            </h1>
            <section aria-label="The claim" className="mt-3 rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700 dark:bg-gray-950" data-testid="attest-claim">
              <p className="text-[11px] font-semibold text-axal-faint">{proofKindLabel(d.claim?.kind)}</p>
              <p className="mt-0.5 text-[14px] font-extrabold">{d.claim?.title}</p>
              {where && <p className="text-[12px] text-axal-muted">{where}</p>}
              {d.claim?.detail && <p className="mt-1.5 text-[12.5px] leading-relaxed">{d.claim.detail}</p>}
            </section>
            {d.claim_changed && (
              <p role="alert" className="mt-3 text-[12.5px] font-semibold text-amber-700 dark:text-amber-300">
                The advisor has changed this claim since asking you. It cannot be confirmed as it was; they need to ask again.
              </p>
            )}

            <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-[170px_minmax(0,1fr)]" data-testid="attest-terms">
              <dt className="font-semibold text-axal-faint">You’ll appear as</dt>
              <dd className="mb-2 sm:mb-0">{d.attester_name || 'The name the advisor gave'}</dd>
              <dt className="font-semibold text-axal-faint">What confirming means</dt>
              <dd className="mb-2 sm:mb-0">You say this statement is true, as written. It does not verify anyone’s identity, yours or {advisor}’s.</dd>
              <dt className="font-semibold text-axal-faint">How it’s used</dt>
              <dd className="mb-2 sm:mb-0">
                Kept private to {advisor}. Only if they choose to publish it is it shown on their profile as
                “Confirmed by {d.attester_name || 'you'}”.
              </dd>
              <dt className="font-semibold text-axal-faint">Withdrawing</dt>
              <dd>Any time, from this page, with a new code. A withdrawal takes it off their profile.</dd>
            </dl>

            {confirmedNow && (
              <div role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[12.5px] dark:border-emerald-900 dark:bg-emerald-950/30" data-testid="attest-confirmed">
                <b>{STATE_LABELS.confirmed}{proofDate(confirmedAt) ? ` on ${proofDate(confirmedAt)}` : ''}.</b>
                <div>{advisor} sees “Confirmed by {d.attester_name || 'you'}”.</div>
              </div>
            )}
            {!confirmedNow && <p className="mt-4 text-[12.5px]"><b>{STATE_LABELS[d.state] || 'Not recorded'}</b></p>}
            {Array.isArray(d.history) && d.history.length > 0 && (
              <ol className="mt-1 space-y-0.5 text-[11.5px] text-axal-muted" aria-label="History">
                {d.history.map((h, i) => (
                  <li key={i}>
                    <span className="tabular-nums">{when(h.created_at) || 'time not recorded'}</span>
                    {' · '}{h.kind === 'asked' ? `Asked by ${advisor}` : (EVENT_LABELS[h.kind] || h.kind)}
                  </li>
                ))}
              </ol>
            )}
            {done && <p role="status" className="mt-3 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300">
              {done === 'given' ? 'Thank you — recorded.' : 'Recorded. The claim stays the advisor’s own statement, unconfirmed.'}
            </p>}

            {!d.claim_changed && !closed && (
              <div className="mt-5 space-y-3 border-t border-axal-hairline pt-4 dark:border-gray-700">
                {confirmedNow && !withdrawing && (
                  <button type="button" className={secondary} onClick={() => setWithdrawing(true)}>Withdraw my confirmation…</button>
                )}
                {(!confirmedNow || withdrawing) && !codeOpen && (
                  <div data-testid="attest-arrive">
                    <p className="text-[12.5px] leading-relaxed text-axal-muted">
                      To answer, we’ll email a one-time code to <b>{d.email_hint || 'the address the advisor gave'}</b>, the
                      address {advisor} named. Only someone who reads that inbox can answer, so nobody can answer for you with this link.
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <button type="button" className={primary} disabled={busy} onClick={askCode}>Email me a code</button>
                      <button type="button" className={linkish} onClick={() => setEntering(true)}>I already have a code</button>
                    </div>
                    <p className="mt-2 text-[11.5px] text-axal-faint">Not you? Do nothing: nothing is recorded unless someone answers with the code.</p>
                  </div>
                )}
                {codeOpen && (
                  <div className="space-y-3" data-testid="attest-code">
                    {sent && <p role="status" className="text-[12px]">A code was sent to {sent.email_hint}. It lasts 15 minutes.</p>}
                    <label className="block">
                      <span className="text-[12px] font-semibold">Code</span>
                      <span className="text-[11.5px] text-axal-faint"> · the 6 digits sent to {d.email_hint || 'the address the advisor gave'}, valid 15 minutes, 5 tries each</span>
                      <input className={`${inputClass} tracking-[.4em] tabular-nums`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                    </label>
                    <button type="button" className={linkish} disabled={busy} onClick={askCode}>Email me a new code</button>
                    {!withdrawing && (
                      <label className="block">
                        <span className="text-[12px] font-semibold">Add a sentence (optional)</span>
                        <textarea rows={3} className={inputClass} value={statement} onChange={(e) => setStatement(e.target.value)}
                          placeholder="Anything you want shown alongside the confirmation." />
                        <span className="mt-1 block text-[11.5px] leading-relaxed text-axal-faint">
                          Shown with your name if {advisor} publishes the confirmation. Leave it blank to confirm without a quote.
                        </span>
                      </label>
                    )}
                    {!withdrawing && (
                      <p className="text-[11.5px] leading-relaxed text-axal-muted" data-testid="attest-consent-text">
                        Confirm this statement records, in your words: “{CONSENT_TEXT}”
                      </p>
                    )}
                    {error && <p role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">{error}</p>}
                    <div className="flex flex-wrap gap-2">
                      {withdrawing ? (
                        <>
                          <button type="button" className={primary} disabled={code.length !== 6 || busy} onClick={() => send(false)}>
                            {busy ? 'Recording…' : 'Withdraw my confirmation'}
                          </button>
                          <button type="button" className={secondary} onClick={() => { setWithdrawing(false); setEntering(false); setError(''); }}>Keep my confirmation</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className={primary} disabled={code.length !== 6 || busy} onClick={() => send(true)}>
                            {busy ? 'Recording…' : 'Confirm this statement'}
                          </button>
                          <button type="button" className={secondary} disabled={code.length !== 6 || busy} onClick={() => send(false)}>
                            I can’t confirm this
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {!codeOpen && error && <p role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">{error}</p>}
                <p className="text-[11.5px] leading-relaxed text-axal-faint">
                  Every answer is kept in the history above. No answer creates an account for you or signs you up to anything.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

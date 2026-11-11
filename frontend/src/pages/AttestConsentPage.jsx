import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '../ui';
import { api } from '../lib/api';

/**
 * The attester's side of an advisor's proof claim. Public, unauthenticated,
 * reached by a link the advisor handed over.
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

const KIND_LABELS = { engagement: 'Engagement', outcome: 'Outcome', role: 'Role', credential: 'Credential' };
const STATE_LABELS = {
  pending: 'Not answered yet',
  confirmed: 'You confirmed this',
  declined: 'You declined',
  withdrawn: 'You withdrew your confirmation',
  needs_reconfirmation: 'Your earlier confirmation needs confirming again',
};
const EVENT_LABELS = { asked: 'Asked', confirmed: 'Confirmed', declined: 'Declined', withdrawn: 'Withdrawn', reconfirmed: 'Confirmed again' };
const when = (iso) => { const t = Date.parse(iso || ''); return Number.isNaN(t) ? null : new Date(t).toLocaleString(); };

const inputClass =
  'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] '
  + 'focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 '
  + 'dark:border-gray-700 dark:bg-gray-900';
const primary = 'rounded-lg bg-emerald-700 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'rounded-lg border border-axal-hairline px-3.5 py-2 text-[13px] font-semibold hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800';

export default function AttestConsentPage() {
  const { token } = useParams();
  const enc = encodeURIComponent(token || '');
  const [read, setRead] = useState({ loading: true, error: '', data: null });
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(null); // { email_hint }
  const [statement, setStatement] = useState('');
  const [agreed, setAgreed] = useState(false);
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
    try { setSent(await api.requestAdvisorProofConsentCode(enc)); }
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
      setCode(''); setSent(null);
      load();
    } catch (e) {
      setError(fixed(e, 'That could not be recorded. Nothing was saved.'));
    } finally {
      setBusy(false);
    }
  };

  const d = read.data;
  const confirmedNow = d?.state === 'confirmed';
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <Card padding="lg">
        <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Confirm a claim</div>
        {read.loading && <p role="status" className="mt-2 text-[13px]">Loading the claim…</p>}
        {!read.loading && read.error && (
          <div role="alert" className="mt-2 text-[13px]">
            <p>{read.error}</p>
            <button type="button" className={`${secondary} mt-3`} onClick={load}>Try again</button>
          </div>
        )}
        {d && (
          <>
            <h1 className="mt-2 text-lg font-extrabold tracking-tight">
              {d.advisor_name || 'An advisor'} asked you to confirm this
            </h1>
            <section aria-label="The claim" className="mt-3 rounded-lg border border-axal-hairline p-3 dark:border-gray-700" data-testid="attest-claim">
              <p className="text-[11px] font-semibold text-axal-faint">{KIND_LABELS[d.claim?.kind] || 'Claim'}</p>
              <p className="mt-0.5 text-[14px] font-extrabold">{d.claim?.title}</p>
              {(d.claim?.organization || d.claim?.period_note) && (
                <p className="text-[12px] text-axal-muted">{[d.claim.organization, d.claim.period_note].filter(Boolean).join(' · ')}</p>
              )}
              {d.claim?.detail && <p className="mt-1.5 text-[12.5px] leading-relaxed">{d.claim.detail}</p>}
            </section>
            {d.claim_changed && (
              <p role="alert" className="mt-3 text-[12.5px] font-semibold text-amber-700 dark:text-amber-300">
                The advisor has changed this claim since asking you. It cannot be confirmed as it was; they need to ask again.
              </p>
            )}
            <p className="mt-3 text-[12.5px]"><b>{STATE_LABELS[d.state] || 'Not recorded'}</b></p>
            {Array.isArray(d.history) && d.history.length > 0 && (
              <ol className="mt-1 space-y-0.5 text-[11.5px] text-axal-muted" aria-label="History">
                {d.history.map((h, i) => <li key={i}>{EVENT_LABELS[h.kind] || h.kind} · {when(h.created_at) || 'time not recorded'}</li>)}
              </ol>
            )}
            {done && <p role="status" className="mt-3 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300">
              {done === 'given' ? 'Thank you — recorded.' : 'Recorded. The claim stays the advisor’s own statement, unconfirmed.'}
            </p>}

            {!d.claim_changed && (
              <div className="mt-5 space-y-3 border-t border-axal-hairline pt-4 dark:border-gray-700">
                <p className="text-[12.5px] leading-relaxed text-axal-muted">
                  To answer, we email a six-digit code to {d.email_hint || 'the address the advisor gave'}. Only someone
                  who reads that inbox can answer, so nobody can answer for you with this link.
                </p>
                <button type="button" className={secondary} disabled={busy} onClick={askCode}>
                  {sent ? 'Send another code' : 'Email me a code'}
                </button>
                {sent && <p role="status" className="text-[12px]">A code was sent to {sent.email_hint}. It lasts 15 minutes.</p>}
                <label className="block">
                  <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Code</span>
                  <input className={inputClass} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                </label>
                {!confirmedNow && (
                  <>
                    <label className="block">
                      <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Add a sentence (optional)</span>
                      <textarea rows={3} className={inputClass} value={statement} onChange={(e) => setStatement(e.target.value)}
                        placeholder="Anything you want shown alongside the confirmation." />
                      <span className="mt-1 block text-[11.5px] leading-relaxed text-axal-faint">
                        This is shown publicly with your name. Leave it blank to confirm without a quote.
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-[12.5px] leading-relaxed">
                      <input type="checkbox" className="mt-0.5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                      <span>{CONSENT_TEXT}</span>
                    </label>
                  </>
                )}
                {error && <p role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">{error}</p>}
                <div className="flex flex-wrap gap-2">
                  {!confirmedNow && (
                    <button type="button" className={primary} disabled={!agreed || code.length !== 6 || busy} onClick={() => send(true)}>
                      {busy ? 'Recording…' : d.state === 'pending' ? 'Confirm' : 'Confirm again'}
                    </button>
                  )}
                  <button type="button" className={secondary} disabled={code.length !== 6 || busy} onClick={() => send(false)}>
                    {confirmedNow ? 'Withdraw my confirmation' : 'I would rather not'}
                  </button>
                </div>
                <p className="text-[11.5px] leading-relaxed text-axal-faint">
                  Every answer is kept in the history above. Neither answer creates an account for you or signs you up to anything.
                </p>
              </div>
            )}
          </>
        )}
      </Card>
    </main>
  );
}

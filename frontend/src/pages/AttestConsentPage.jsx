import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '../ui';
import { api } from '../lib/api';

/**
 * The attester's side of an advisor's proof claim. Public, unauthenticated,
 * reached only by a link the advisor handed over.
 *
 * WHY IT IS NOT BEHIND A LOGIN. An attester is usually not a user of this
 * product — a former manager, a client, a co-founder somewhere else. Requiring
 * an account would mean the only confirmable claims are the ones a colleague
 * already inside Axal can vouch for, which is the wrong set. The token is the
 * credential: 128 bits, issued once, and the advisor cannot read it back off
 * any later API response, so the subject of a claim cannot confirm their own.
 *
 * WHAT IS AND IS NOT ASKED. The wording of what is being agreed to is captured
 * as `consent_text` and stored with the answer, because a consent record that
 * does not say what was consented to is not a record of anything — that is the
 * shape `reference_checks` established and migration 204 copied. The public
 * statement is optional and separate: agreeing that something is true is not
 * the same act as writing a quote for someone's storefront.
 *
 * DECLINING IS RECORDED, NOT DISCARDED. Saying no leaves a row saying no. A
 * request that vanished on refusal would let an advisor re-ask until they got
 * a yes, with nothing on the record.
 *
 * IT DOES NOT SHOW THE CLAIM. The worker's response carries the consent row,
 * not the advisor's item — a token that leaked would otherwise disclose one
 * person's private record to whoever held it. What is being confirmed is what
 * the advisor told the attester when they sent the link.
 */

const CONSENT_TEXT =
  'I confirm this is accurate, and I agree to it being shown as confirmed on this '
  + 'advisor’s public profile.';

const inputClass =
  'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] '
  + 'focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 '
  + 'dark:border-gray-700 dark:bg-gray-900';

export default function AttestConsentPage() {
  const { token } = useParams();
  const [statement, setStatement] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');

  const send = async (consentGiven) => {
    setBusy(true);
    setError('');
    try {
      // Through `lib/api` rather than a bare fetch, so this endpoint stays
      // visible to `check-api-drift`. It sends no credentials when there are
      // none, which is the case this page is for.
      await api.respondToAdvisorProofConsent(
        encodeURIComponent(token),
        consentGiven
          ? { consent_text: CONSENT_TEXT, statement: statement.trim() || null }
          : { consent_given: false },
      );
      setDone(consentGiven ? 'given' : 'declined');
    } catch (e) {
      setError(e?.message || 'That could not be recorded. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <Card padding="lg">
        {done === 'given' && (
          <>
            <h1 className="text-lg font-extrabold tracking-tight">Thank you — recorded</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-axal-ink-2">
              Your confirmation is on the record and the claim now shows as confirmed by you.
              If you change your mind, ask the advisor to send this link again — answering it a
              second time replaces your answer, and a withdrawal is kept on the record too.
            </p>
          </>
        )}
        {done === 'declined' && (
          <>
            <h1 className="text-lg font-extrabold tracking-tight">Recorded — you declined</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-axal-ink-2">
              The claim stays marked as the advisor’s own statement, unconfirmed. Your answer is
              kept so the request cannot simply be asked again as though it never happened.
            </p>
          </>
        )}
        {!done && (
          <>
            <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
              Confirm a claim
            </div>
            <h1 className="mt-2 text-lg font-extrabold tracking-tight">
              Someone has asked you to confirm something about their work
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-axal-ink-2">
              An advisor on Axal has recorded a claim about work they did and named you as
              someone who can confirm it. The claim itself is not shown here — they will have
              told you what it is when they sent you this link. If you are not sure what you are
              being asked to confirm, ask them before answering.
            </p>

            <label className="mt-5 block">
              <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                Add a sentence (optional)
              </span>
              <textarea rows={3} className={inputClass} value={statement}
                onChange={(e) => setStatement(e.target.value)}
                placeholder="Anything you want shown alongside the confirmation." />
              <span className="mt-1 block text-[11.5px] leading-relaxed text-axal-ink-3">
                This is shown publicly with your name. Leave it blank to confirm without a quote —
                agreeing that something is true is a different act from writing a testimonial.
              </span>
            </label>

            <label className="mt-4 flex items-start gap-2 text-[12.5px] leading-relaxed">
              <input type="checkbox" className="mt-0.5" checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)} />
              <span>{CONSENT_TEXT}</span>
            </label>

            {error && (
              <p className="mt-3 text-[12.5px] font-semibold text-red-700 dark:text-red-300">{error}</p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={!agreed || busy}
                onClick={() => send(true)}
                className="rounded-lg bg-emerald-700 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? 'Recording…' : 'Confirm'}
              </button>
              <button type="button" disabled={busy} onClick={() => send(false)}
                className="rounded-lg border border-axal-hairline px-3.5 py-2 text-[13px] font-semibold hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800">
                I would rather not
              </button>
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-axal-ink-3">
              Declining is recorded too. Neither answer creates an account for you or signs you up
              to anything.
            </p>
          </>
        )}
      </Card>
    </main>
  );
}

import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '../ui';
import { api } from '../lib/api';

/**
 * The client's side of a partner firm's proof claim. Public, unauthenticated,
 * reached only by a link the firm handed over.
 *
 * WHY THIS PAGE EXISTS AT ALL. Migration 209 gave Offers · Proof a consent
 * table, and the firm's side of it can record an ask and hand over a token —
 * but a token nobody can answer is not a consent mechanism, it is a field that
 * will never be set. An ask that can never be answered is worse than no ask:
 * it makes every item on that zone permanently self-stated while looking like
 * a process that is under way. So the ask and the answer land together.
 *
 * WHY IT IS NOT BEHIND A LOGIN. The counterparty on an engagement is often not
 * a user of this product — a client's general counsel, a marketing lead, a
 * founder who has since moved on. Requiring an account would mean the only
 * publishable outcomes are the ones a client who already has an Axal login will
 * vouch for, which is the wrong set. The token is the credential, and the firm
 * cannot read it back off any later API response, so the subject of a claim
 * cannot confirm their own.
 *
 * IT DOES NOT SHOW THE CLAIM, and that is deliberate rather than an omission.
 * The worker's response carries the consent row, not the firm's proof item — a
 * token that leaked would otherwise disclose one firm's unpublished case study
 * to whoever held it. What is being agreed to is what the firm told this person
 * when they sent the link, which is also the only version of it that person
 * actually saw.
 *
 * DECLINING IS RECORDED, NOT DISCARDED. Saying no leaves a row saying no. A
 * request that vanished on refusal would let a firm re-ask until it got a yes,
 * with nothing on the record — and the record is the entire product here.
 *
 * SEPARATE FROM `/attest/:token`, which is the advisor twin against a different
 * table (204's `attester_*` columns, not 209's `consenter_*`). Two segments
 * rather than one, so neither route can shadow the other; `isPublicPath` already
 * whitelists everything under `/attest/`.
 */

const CONSENT_TEXT =
  'I confirm this is accurate, and I agree to this firm showing it publicly as '
  + 'work they did for us.';

const inputClass =
  'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] '
  + 'focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 '
  + 'dark:border-gray-700 dark:bg-gray-900';

export default function PartnerAttestConsentPage() {
  const { token } = useParams();
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
      // none, which is exactly the case this page is for.
      await api.respondToPartnerProofConsent(
        encodeURIComponent(token),
        consentGiven ? { consent_text: CONSENT_TEXT } : { consent_given: false },
      );
      setDone(consentGiven ? 'given' : 'declined');
    } catch (e) {
      setError(e?.message || 'That could not be recorded. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Card padding="lg">
          <h1 className="text-lg font-extrabold tracking-tight">
            {done === 'given' ? 'Thank you — that is recorded' : 'Recorded — nothing will be published'}
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-axal-ink-2">
            {done === 'given'
              ? 'The firm can now show this as work they did for you. If you change '
                + 'your mind, tell them and they can record the withdrawal — the '
                + 'record keeps both, so nothing quietly disappears.'
              : 'Your answer is on the record, so the firm cannot simply ask again '
                + 'as though nothing happened. Nothing about this will be shown.'}
          </p>
          <p className="mt-3 text-[12px] text-axal-ink-3">
            You can close this page. There is nothing to sign up for.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <Card padding="lg">
        <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
          A firm has asked for your confirmation
        </div>
        <h1 className="mt-2 text-lg font-extrabold tracking-tight">
          May they show this work publicly?
        </h1>
        <p className="mt-3 text-[13px] leading-relaxed text-axal-ink-2">
          A firm you worked with would like to publish an account of it. They will
          have described what they want to show when they sent you this link —
          this page deliberately does not repeat it, because a link that carried
          their unpublished write-up would disclose it to anyone who got hold of
          the link.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-axal-ink-2">
          If what they described is not accurate, or you simply would rather they
          did not, decline. Your answer is recorded either way, so they cannot
          re-ask as though it had not been given.
        </p>

        <div className="mt-5 rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
          <label className="flex items-start gap-2.5 text-[13px] leading-relaxed">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>{CONSENT_TEXT}</span>
          </label>
        </div>

        {error && (
          <p className="mt-3 text-[13px] font-semibold text-red-700 dark:text-red-300">{error}</p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !agreed}
            onClick={() => send(true)}
            className="rounded-lg bg-amber-700 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Yes, they may
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => send(false)}
            className="rounded-lg border border-axal-hairline px-3.5 py-2 text-[13px] font-semibold hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            No
          </button>
        </div>

        <p className="mt-4 text-[12px] leading-relaxed text-axal-ink-3">
          The tick is required for “yes” and not for “no”: agreeing is an act and
          declining is not, so only one of them needs a box confirming you meant
          it. You do not need an account here for either.
        </p>
      </Card>
    </div>
  );
}

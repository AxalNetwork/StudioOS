import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '../ui';
import { api } from '../lib/api';

/**
 * The client's side of a partner firm's proof claim. Public, unauthenticated,
 * reached by a link the firm handed over.
 *
 * WHY IT IS NOT BEHIND A LOGIN. The counterparty on an engagement is often not
 * a user of this product — a client's general counsel, a marketing lead, a
 * founder who has since moved on. Requiring an account would mean the only
 * publishable outcomes are the ones a client who already has an Axal login will
 * vouch for, which is the wrong set.
 *
 * THE LINK SHOWS, A CODE ANSWERS (D4672). The firm holds this link too, so the
 * link alone must not be able to answer. It shows the claim exactly as this
 * request pinned it — the revision the firm asked about — and the history of
 * the request. Confirming, declining or withdrawing needs a six-digit code that
 * Axal emails, when the client presses the button, to the address the firm
 * named; the page shows that address masked. Before D4672 this page did not
 * show the claim at all, so what was agreed to was whatever the firm had said
 * when it sent the link; now the approval is bound to the exact words shown.
 *
 * CLOSED STAYS CLOSED. Declining or withdrawing closes the request: the page
 * says so and offers nothing that could reopen it. A request the firm changed
 * the claim under, or one whose link has lapsed, answers nothing either.
 *
 * SEPARATE FROM `/attest/:token`, which is the advisor twin against a different
 * table. A FAILURE READS AS A FIXED SENTENCE keyed on the Worker's code
 * (`PARTNER_ATTEST_REFUSALS`), never the raw error text.
 */

const CONSENT_TEXT =
  'I confirm this is accurate, and I agree to this firm showing it publicly as '
  + 'work they did for us.';

export const PARTNER_ATTEST_REFUSALS = Object.freeze({
  consent_not_found: 'This request does not exist, or the claim it was about was removed.',
  code_required: 'Enter the six-digit code we emailed you.',
  code_wrong: 'That code is not right. Check the latest email and try again.',
  code_expired: 'That code has expired or was already used. Ask for a new one.',
  code_rate_limited: 'Several codes were sent in the last hour. Use the latest one, or try again later.',
  code_unsent: 'The code could not be emailed just now. Try again in a few minutes.',
  consenter_email_missing: 'This request names no email address, so no code can be sent. Ask the firm to send a new request.',
  claim_changed: 'The firm changed this claim after asking you. Nothing was recorded; they need to send a new request.',
  consent_closed: 'This request is closed: it was declined or withdrawn, and that stays on the record.',
  request_expired: 'This request has expired. Ask the firm to send a new one.',
  already_confirmed: 'You have already confirmed this.',
  requester_cannot_confirm: 'The firm cannot answer a request about its own claim.',
  consent_text_required: 'Tick the confirmation to say what you agree to.',
});
const fixed = (e, fallback) => PARTNER_ATTEST_REFUSALS[e?.code] || fallback;

const KIND_LABELS = { case_study: 'Case study', outcome: 'Outcome', testimonial: 'Testimonial' };
/** The request as the client reads it, one sentence per state the Worker can return. */
export const PARTNER_CONSENT_STATE_LABELS = Object.freeze({
  requested: 'Not answered yet',
  confirmed: 'You confirmed this',
  declined: 'You declined. This request is closed.',
  withdrawn: 'You withdrew your confirmation. This request is closed.',
  superseded: 'The firm changed this claim after asking, so this request no longer applies to it.',
  expired: 'This request has expired.',
});
const EVENT_LABELS = { asked: 'Asked', confirmed: 'Confirmed', declined: 'Declined', withdrawn: 'Withdrawn', superseded: 'Claim changed by the firm' };
const when = (iso) => { const t = Date.parse(iso || ''); return Number.isNaN(t) ? null : new Date(t).toLocaleString(); };

const inputClass =
  'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] '
  + 'focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600 '
  + 'dark:border-gray-700 dark:bg-gray-900';
const primary = 'rounded-lg bg-amber-700 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'rounded-lg border border-axal-hairline px-3.5 py-2 text-[13px] font-semibold hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800';

export default function PartnerAttestConsentPage() {
  const { token } = useParams();
  const enc = encodeURIComponent(token || '');
  const [read, setRead] = useState({ loading: true, error: '', data: null });
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(null); // { email_hint }
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const load = useCallback(async () => {
    setRead((r) => ({ ...r, loading: true, error: '' }));
    try { setRead({ loading: false, error: '', data: await api.getPartnerProofConsentClaim(enc) }); }
    catch (e) { setRead({ loading: false, error: fixed(e, 'This request could not be read. Try again.'), data: null }); }
  }, [enc]);
  useEffect(() => { load(); }, [load]);

  const askCode = async () => {
    setBusy(true); setError('');
    try { setSent(await api.requestPartnerProofConsentCode(enc)); }
    catch (e) { setError(fixed(e, 'The code could not be sent. Try again.')); }
    finally { setBusy(false); }
  };

  const send = async (consentGiven) => {
    setBusy(true); setError('');
    try {
      // Through `lib/api` rather than a bare fetch, so this endpoint stays
      // visible to `check-api-drift`. It sends no credentials when there are
      // none, which is exactly the case this page is for.
      await api.respondToPartnerProofConsent(enc, consentGiven
        ? { code: code.trim(), consent_text: CONSENT_TEXT, claim_sha256: read.data?.claim_sha256 }
        : { code: code.trim(), consent_given: false });
      setDone(consentGiven ? 'given' : 'declined');
      setCode(''); setSent(null);
      load();
    } catch (e) {
      setError(fixed(e, 'That could not be recorded. Nothing was saved.'));
      if (e?.code === 'claim_changed' || e?.code === 'consent_closed' || e?.code === 'request_expired') load();
    } finally {
      setBusy(false);
    }
  };

  const d = read.data;
  const state = d?.state;
  // Only an open request (to confirm or decline) or a live confirmation (to
  // withdraw) can be answered. Every other state is closed for good.
  const answerable = state === 'requested' || state === 'confirmed';
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <Card padding="lg">
        <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">A firm has asked for your confirmation</div>
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
              {d.firm_name || 'A firm'} asked whether they may show this publicly
            </h1>
            {d.claim ? (
              <section aria-label="The claim" className="mt-3 rounded-lg border border-axal-hairline p-3 dark:border-gray-700" data-testid="partner-attest-claim">
                <p className="text-[11px] font-semibold text-axal-faint">
                  {KIND_LABELS[d.claim.kind] || 'Claim'}{d.revision ? ` · version ${d.revision}` : ''}
                </p>
                <p className="mt-0.5 text-[14px] font-extrabold">{d.claim.title}</p>
                {d.claim.outcome_note && <p className="mt-1 text-[13px] font-semibold">{d.claim.outcome_note}</p>}
                {d.claim.detail && <p className="mt-1.5 text-[12.5px] leading-relaxed">{d.claim.detail}</p>}
              </section>
            ) : (
              <p className="mt-3 text-[12.5px] text-axal-muted">
                This request was made before requests recorded the exact claim, so there is nothing here to confirm. Ask the firm to send a new request.
              </p>
            )}
            <p className="mt-3 text-[12.5px]" data-testid="partner-attest-state"><b>{PARTNER_CONSENT_STATE_LABELS[state] || 'Not recorded'}</b></p>
            {Array.isArray(d.history) && d.history.length > 0 && (
              <ol className="mt-1 space-y-0.5 text-[11.5px] text-axal-muted" aria-label="History">
                {d.history.map((h, i) => <li key={i}>{EVENT_LABELS[h.kind] || h.kind} · {when(h.created_at) || 'time not recorded'}</li>)}
              </ol>
            )}
            {done && (
              <p role="status" className="mt-3 text-[12.5px] font-semibold text-amber-800 dark:text-amber-300">
                {done === 'given'
                  ? 'Thank you — recorded. If you change your mind, come back to this link to withdraw.'
                  : 'Recorded. Nothing about this will be shown, and the request is closed.'}
              </p>
            )}

            {answerable && d.claim && (
              <div className="mt-5 space-y-3 border-t border-axal-hairline pt-4 dark:border-gray-700">
                <p className="text-[12.5px] leading-relaxed text-axal-muted">
                  To answer, we email a six-digit code to {d.email_hint || 'the address the firm gave'}. Only someone
                  who reads that inbox can answer, so nobody can answer for you with this link — including the firm.
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
                {state === 'requested' && (
                  <label className="flex items-start gap-2 text-[12.5px] leading-relaxed">
                    <input type="checkbox" className="mt-0.5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                    <span>{CONSENT_TEXT}</span>
                  </label>
                )}
                {error && <p role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">{error}</p>}
                <div className="flex flex-wrap gap-2">
                  {state === 'requested' && (
                    <button type="button" className={primary} disabled={!agreed || code.length !== 6 || busy} onClick={() => send(true)}>
                      {busy ? 'Recording…' : 'Yes, they may'}
                    </button>
                  )}
                  <button type="button" className={secondary} disabled={code.length !== 6 || busy} onClick={() => send(false)}>
                    {state === 'confirmed' ? 'Withdraw my confirmation' : 'No'}
                  </button>
                </div>
                <p className="text-[11.5px] leading-relaxed text-axal-faint">
                  Declining or withdrawing closes this request for good; the firm would have to ask again, on the record.
                  Neither answer creates an account for you or signs you up to anything.
                </p>
              </div>
            )}
            {!answerable && error && <p role="alert" className="mt-3 text-[12.5px] font-semibold text-red-700 dark:text-red-300">{error}</p>}
          </>
        )}
      </Card>
    </main>
  );
}

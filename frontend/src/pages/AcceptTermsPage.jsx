import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthShell, { AuthCard, authV2 } from '../components/auth/AuthShell';
import { api } from '../lib/api';
import useForcedLightTheme from '../hooks/useForcedLightTheme';
import { TERMS_ACCEPTED_EVENT } from '../lib/onboarding';
import { OWNERSHIP_NOTICE, LEGAL_LINKS } from '../lib/legalNotice';

/**
 * Task #178 — the one screen that asks an existing account for the agreement
 * nobody ever recorded.
 *
 * WHY IT EXISTS AT ALL. PR #549 made the consent real, but only at the
 * onboarding licence gate, and only fresh Auth-v2 signups pass through that
 * gate. Every account older than #549 — plus admins, impersonated sessions,
 * `limited` accounts and the legacy `flow='chat'` rows — still has `tos_v1` and
 * `privacy_v1` sitting `pending`. The product had been showing those people
 * "By continuing you agree" in 10px under a submit button, which is a notice
 * and not an act. Marking the obligations satisfied on the strength of it would
 * have asserted something nobody did.
 *
 * It is rendered IN PLACE by `RequireAuth`, not navigated to. Two reasons, and
 * the second is the load-bearing one:
 *   · it blocks every path including `/onboarding/*`, with no exemption list to
 *     keep in step with the KYC gate's;
 *   · `onLogout` is already in scope there, so Decline runs the app's real
 *     session teardown rather than a second copy of it that drifts.
 * The reader keeps their URL, so accepting puts them exactly where they were
 * going.
 *
 * THE CHECKBOX STARTS FALSE AND THE BUTTON STAYS DISABLED UNTIL IT IS TICKED.
 * `ChooseLicencePage` records why in its own words, and it is the same reason
 * here: pre-ticking would make the checkbox decoration and the record a
 * fiction, which is the state this product previously shipped in.
 *
 * NO VERSION IS CLAIMED. Migration 245 deliberately stores no document hash
 * (`245_legal_acceptances.sql:22-32`) because `/terms` and `/privacy` are JSX
 * and the `tos_v1`/`privacy_v1` templates are different documents. So this copy
 * says what was accepted and links to it; it never says "version 3".
 *
 * Presentation is `ChooseLicencePage`'s, minus `wide`: that prop exists for its
 * two-column licence grid and would leave one column of prose stranded in an
 * 840px card.
 */
export default function AcceptTermsPage({ email, onDecline }) {
  useForcedLightTheme();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!accepted) return;
    setBusy(true);
    setError('');
    try {
      await api.acceptTerms();
      // The shell reads this fact once per session, in an effect keyed on the
      // user id. Without the announcement it would re-render this very screen
      // over the page the reader was heading for.
      window.dispatchEvent(new CustomEvent(TERMS_ACCEPTED_EVENT));
    } catch (e) {
      setError(e?.message || 'Could not record your acceptance.');
      setBusy(false);
    }
  };

  return (
    <AuthShell
      email={email}
      platformNote="Before you continue"
      backgroundSrc="/auth/login-background.webp"
    >
      <AuthCard>
        <h1 className="m-0 text-[25px] font-extrabold tracking-tight leading-tight text-[#241f38] sm:text-[29px]">
          One thing we never asked you properly
        </h1>
        {/* The honest version of why an existing member is being interrupted.
            It names the platform's own failure rather than implying the terms
            changed — they did not, and saying they had would be the same kind
            of convenient untruth as the passing notice this replaces. */}
        <p className="mt-3 text-[13.5px] leading-relaxed text-[#6b6577] sm:text-[14.5px]">
          Axal VC keeps a record of every member&rsquo;s agreement to its Terms of
          Service and Privacy Policy. Yours is missing. Nothing about the
          documents has changed &mdash; the platform simply used to mention them in
          passing instead of asking, and a mention is not an agreement.
        </p>
        <p className="mt-3 text-[13.5px] leading-relaxed text-[#6b6577] sm:text-[14.5px]">
          Please read them and tell us where you stand. It takes one click, and
          we would rather ask than assume.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <label
          className="mt-6 flex cursor-pointer items-start gap-2.5 text-left"
          style={{ maxWidth: '62ch' }}
        >
          <input
            type="checkbox"
            data-testid="checkbox-accept-terms"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#6d28d9]"
          />
          <span className="text-[12.5px] leading-relaxed text-[#4a4458]">
            I have read and agree to the{' '}
            <Link to="/terms" className="font-semibold text-[#5b21b6] underline underline-offset-2">
              Terms of Service
            </Link>{' '}
            and the{' '}
            <Link to="/privacy" className="font-semibold text-[#5b21b6] underline underline-offset-2">
              Privacy Policy
            </Link>
            .
          </span>
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="button-accept-terms"
            disabled={busy || !accepted}
            onClick={submit}
            className={authV2.btnPrimary}
            style={{ background: authV2.purple, borderColor: authV2.purple, width: 'auto', paddingLeft: 28, paddingRight: 28 }}
          >
            {busy ? 'Recording…' : 'Agree and continue'}
          </button>
          {/* A CONSENT SCREEN WITH NO EXIT IS NOT CONSENT. Clickwrap was chosen
              over implied acceptance because it is the stronger record, and a
              record collected from someone with nowhere else to go is weaker
              than the notice it replaced. Signing out deletes nothing; the
              question is simply asked again next time. */}
          <button
            type="button"
            data-testid="button-decline-terms"
            disabled={busy}
            onClick={onDecline}
            className="text-[12.5px] font-semibold text-[#6b6577] underline underline-offset-2 hover:text-[#241f38]"
          >
            Not now &mdash; sign me out
          </button>
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-[#8b8496]">
          Signing out changes nothing about your account or your data. You will
          be asked again the next time you sign in.
        </p>
      </AuthCard>

      <footer className="mt-6 flex flex-col items-center gap-2 text-center">
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {LEGAL_LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="text-[12px] font-medium text-white/85 underline-offset-2 hover:text-white hover:underline"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <p className="m-0 max-w-[56ch] font-mono text-[10.5px] leading-relaxed text-white/70">
          {OWNERSHIP_NOTICE}
        </p>
      </footer>
    </AuthShell>
  );
}

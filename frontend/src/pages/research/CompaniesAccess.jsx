import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { StateChip } from '../../ui/Honesty.jsx';
import { isRestoredArrival, spendRestoredArrival } from '../../lib/pendingNext.js';

/**
 * D7178 (#7178, canvas #7044, boards RS-16) — Research › Companies access, the three screens the canvas adds:
 *
 *   - `CompaniesBoundary` (RCL09, RCL09B, RCL15I): what a signed-in account without a held Founder or Advisor
 *     licence reads on a Companies address, drawn by App.jsx's RoleGuard (D914's route boundaries) where it used to
 *     redirect to `/studio` in silence. It names the licences that open Companies and offers places this account
 *     can use (the owner's answer A: Open Markets, then See licences, then Home). It never shows the company or the
 *     search that was asked for. A support session is not offered a licence on the member's behalf.
 *   - `DestinationReady` (RCL04B, RCL15G): after required setup, "Your account is ready · Continue to Companies".
 *   - `RestoredStatus` (RCL05, RCL05B, RCL15E): the page a member asked for before sign-in, opened after it, says
 *     so once ("Signed in. This is the page you asked for."), as a status that does not take focus.
 *
 * The Worker answers the same rule (`cloudflare-worker/src/services/researchCompaniesAccess.ts`).
 */

/** The roles RoleGuard draws this boundary for on a Companies address. The route admits every other one. */
export const COMPANIES_BOUNDARY_ROLES = new Set(['investor', 'partner', 'exploring']);

const LICENCE_WORD = { founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Partner' };

export const COMPANIES_BOUNDARY = Object.freeze({
  crumb: 'Companies',
  title: 'Companies is open to Founder and Advisor licences',
  open: 'Markets and Library are open to you.',
  none: 'This account holds no licence that includes Companies, so nothing from that page is shown.',
  support: 'The account you are supporting holds neither licence, so Companies is not open to it.',
  markets: 'Open Markets',
  licences: 'See licences',
  home: 'Go to your home',
});

/** The licences named in the refusal, in licence order: the ones this account holds. */
function heldWords(held) {
  const words = ['founder', 'investor', 'advisor', 'partner']
    .filter((l) => (Array.isArray(held) ? held : []).includes(l))
    .map((l) => LICENCE_WORD[l]);
  return words;
}

/** The refusal's sentence. Pure, so a test can read every case without a renderer. */
export function companiesRefusalLine({ held = [], impersonating = false } = {}) {
  if (impersonating) return COMPANIES_BOUNDARY.support;
  const words = heldWords(held);
  if (!words.length) return COMPANIES_BOUNDARY.none;
  const named = words.length === 1 ? `the ${words[0]} licence, which does not` : `the ${words.slice(0, -1).join(', ')} and ${words.at(-1)} licences, which do not`;
  return `This account holds ${named} include Companies, so nothing from that page is shown. ${COMPANIES_BOUNDARY.open}`;
}

const BTN = 'inline-flex min-h-[44px] items-center rounded-[9px] px-3.5 py-2 text-[13px] font-bold';
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const SECOND = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const QUIET = `${BTN} text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100`;

export function CompaniesBoundary({ home = '/studio', impersonating = false, held = [] }) {
  const h1 = useRef(null);
  // RS-16 C (RCL16): the refusal moves focus to its h1.
  useEffect(() => { h1.current?.focus?.(); }, []);
  // Markets is open to every licence; an account that holds none is not offered it.
  const markets = heldWords(held).length > 0;
  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8" data-testid="companies-boundary">
      <nav aria-label="Breadcrumb" className="mb-3 text-[12.5px] text-axal-muted dark:text-gray-400">
        <Link to="/research" className="hover:underline">Research</Link>
        <span aria-hidden="true" className="mx-1.5">/</span>
        <b className="font-semibold text-axal-ink dark:text-gray-100">{COMPANIES_BOUNDARY.crumb}</b>
      </nav>
      <section className="rounded-xl border border-axal-hairline bg-white p-5 dark:border-gray-800 dark:bg-gray-900" role="status">
        <StateChip kind="refused" />
        <h1 ref={h1} tabIndex={-1} className="m-0 mt-3 text-[18px] font-extrabold tracking-tight text-axal-ink outline-none dark:text-gray-100">
          {COMPANIES_BOUNDARY.title}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-axal-muted dark:text-gray-400">
          {companiesRefusalLine({ held, impersonating })}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {markets && <Link to="/research/markets" className={PRIMARY}>{COMPANIES_BOUNDARY.markets}</Link>}
          {!impersonating && <Link to="/account/licences#add-licence" className={markets ? SECOND : PRIMARY}>{COMPANIES_BOUNDARY.licences}</Link>}
          <Link to={home} className={QUIET}>{COMPANIES_BOUNDARY.home}</Link>
        </div>
      </section>
    </main>
  );
}

/**
 * RCL04B / RCL15G — the one screen between required setup and the kept destination. `area` is
 * `destinationArea(path)` (lib/pendingNext.js): only its name is shown, never the query or the company.
 */
export function DestinationReady({ area, onContinue, onHome, home = '/studio' }) {
  const button = useRef(null);
  // RS-16 C: "Continue to Companies" is focused on arrival; "go to your home" is a link.
  useEffect(() => { button.current?.focus?.(); }, []);
  return (
    <main className="flex min-h-screen items-center justify-center bg-axal-ground px-4 py-10 dark:bg-gray-950" data-testid="destination-ready">
      <section className="w-full max-w-[420px] rounded-2xl border border-axal-hairline bg-white p-6 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900" aria-labelledby="destination-ready-h">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
        <h1 id="destination-ready-h" className="mt-4 text-[22px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Your account is ready</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-axal-muted dark:text-gray-400">You asked for a page in Research. It opens now.</p>
        <button
          ref={button}
          type="button"
          onClick={onContinue}
          className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center rounded-[10px] bg-axal-violet px-4 py-2.5 text-[14px] font-bold text-white hover:bg-axal-violet-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
        >
          {`Continue to ${area?.name || 'your page'}`}
        </button>
        <p className="mt-3 text-[12.5px] text-axal-muted dark:text-gray-400">
          Or <Link to={home} onClick={onHome} className="font-semibold text-axal-violet hover:underline dark:text-violet-300">go to your home</Link>
        </p>
      </section>
    </main>
  );
}

export const RESTORED_LINES = Object.freeze({
  page: 'Signed in. This is the page you asked for.',
  filters: 'Signed in. Your search and filters are back.',
});

/**
 * RCL05 / RCL05B / RCL15E — shown once, on the page sign-in returned to. `path` is the page's path and query; `filters`
 * picks the directory's line. Dismissing it returns focus to the page's h1 (RS-16 C).
 */
export function RestoredStatus({ path, filters = false }) {
  const [shown, setShown] = useState(() => isRestoredArrival(path));
  // Spent on mount: a later visit in this page load (Back to Companies, then the profile again) says nothing.
  useEffect(() => { if (shown) spendRestoredArrival(); }, [shown]);
  if (!shown) return null;
  const dismiss = () => {
    setShown(false);
    if (typeof document !== 'undefined') document.querySelector('main h1')?.focus?.();
  };
  return (
    <div
      role="status"
      data-testid="restored-status"
      className="mb-3 flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[13px] text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
    >
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
        Restored
      </span>
      <span className="min-w-0 flex-1">{filters ? RESTORED_LINES.filters : RESTORED_LINES.page}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-emerald-800 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}

export default CompaniesBoundary;

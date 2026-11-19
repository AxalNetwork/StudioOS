import Card from './account/AccountCard.jsx';
import InvestorMyThesisCard from './account/InvestorMyThesisCard.jsx';
import { InvestorSignalsContributionCard, InvestorThesisEditorCard } from './account/InvestorProfileCards.jsx';
import { useInvestorProfile } from './account/useInvestorProfile.js';
import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { api, refusalError } from '../lib/api';
import { EXPLAINERS } from '../lib/explainers';
import { normalizePhoneInput, phoneCountry, phonePlaceholder, PHONE_COUNTRIES, PHONE_ERROR } from '../lib/phoneNumber';
import { loadRecaptcha, invisibleToken } from '../lib/recaptcha';
import { useToast } from '../components/useToast';
import DsrOutcomeNotice from '../components/DsrOutcomeNotice';
import { toUtcInstant } from '../lib/notices';
import {
  AlertTriangle, CheckCircle2, Download, Trash2,
  Plus, KeyRound,
  Sun, Moon,
} from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../hooks/useAuthSync';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import TrustScoreBadge, { computeTrustScore } from '../components/TrustScoreBadge';
import { verdictFor, outstandingCounts, scoreLine } from '../lib/trustCenter';
import { RailFrame, SectionLabel, Skeleton, Unreadable, Unrecorded, usePhoneWidth } from '../ui';
// D568 — the Account center canvas (`ac-*`): its section list, the five
// profile cards, the push devices and sessions cards, the plan line and
// orders, and the two sections the page did not have (Following, Developer, now Builder: D1315).
import { AccountPhoneFrame, AccountPhoneIndex, AccountSectionNav, useAccountRead } from './account/AccountCenter';
// D700 — the phone's `/account`: A1m's bar copy and the address rules.
import { accountPathFor, accountViewFor, connectorKeyFor } from './account/accountPhone';
import ProfileIdentityCanvas from './account/AccountProfile';
import { PushDevices, SessionsCard } from './account/AccountDevices';
import AccountProgramAccess from './account/AccountProgramAccess';
import AccountNewsletters from './account/AccountNewsletters';
import { useBillingStatus } from './account/AccountBilling';
import FollowingSection from './account/AccountFollowing';
import UsageSection from './account/UsageOverview';
import CompaniesProjects from './account/companies/CompaniesProjects';
import { ProfileMovedNotice } from './account/companies/CompaniesMoved';
import { companiesTabFor, companyUidFor, portfolioProjectFor } from './account/companies/companiesModel';
import CostPage from './account/CostPage';
// D807 (#2246) — `/account/usage/limits`, Usage's Limits page.
import LimitsPage from './account/LimitsPage';
import StoragePage from './account/StoragePage';
import AiTokensPage from './account/AiTokensPage';
import { USAGE_PAGES, usagePageFor } from './account/limitsModel';
import ConnectorsSection from './account/AccountConnectors';
import ConnectorPage from './account/ConnectorPage';
// D1315 (#2418): Account › Builder replaced Developer; its pages and drawers are addresses under /account/builder.
import BuilderSection from './account/builder/BuilderSection';
import { BUILDER_PAGES, builderViewFor, builderPathFor } from './account/builder/builderModel';
// D4618 part 2 (#4618): the profile, entity, privacy, notification and billing
// controllers live in their own account modules; this page keeps the route,
// the section list, the panes' order and Sign-in and security (#4614). Profile
// and the entity records are static (Profile is the desktop landing pane);
// Privacy, Notifications and Billing load with their section (`lazySection`),
// each card behind its own loading line and Unreadable boundary.
import { Field, inputCls } from './account/SettingsFields';
import { DocumentsAgreementsSection, ProfileEditors, RolesAccessCard } from './account/ProfileSections';
import { CorporateEntityCard, YourCompaniesSection } from './account/AccountEntityRecords';
import { lazySection, scrollToHash } from './account/lazySection';
// Task #6 (IF) — Onboarding tab (checklist + tour re-run + reset).
import OnboardingSettingsTab from '../components/OnboardingSettingsTab';
// Task #11 — shared first-time optional TOTP enrolment wizard (also used on
// the email-verification page).
import TotpEnrollment from '../components/TotpEnrollment';
import { isSuperAdminUser } from '../lib/shellRole';
import { sessionRowState } from '../lib/sessionRows';

// Each card keeps its own boundary, as each kept its own read: a card fails alone.
const loadPrivacy = () => import('./account/PrivacySections');
const loadNotifications = () => import('./account/NotificationSections');
const PrivacyCoreCard = lazySection(loadPrivacy, 'Profile visibility', 'PrivacyCoreCard');
const CohortAdvisorAccessCard = lazySection(loadPrivacy, 'Cohort advisor access', 'CohortAdvisorAccessCard');
const MarketIntelContributionCard = lazySection(loadPrivacy, 'Market intelligence contribution', 'MarketIntelContributionCard');
const PrivacySection = lazySection(loadPrivacy, 'Public profile', 'PrivacySection');
const NotificationsSection = lazySection(loadNotifications, 'Your notification settings', 'NotificationsSection');
const DigestQuietHoursCard = lazySection(loadNotifications, 'Digest and quiet hours', 'DigestQuietHoursCard');
const BillingTab = lazySection(() => import('./account/BillingSection'), 'Billing and orders', 'BillingTab');
import { appleSignInApi } from '../lib/api/appleSignIn.js';

// D433 — THE COMPLIANCE BRIDGE. The Account canvas puts a trust-score strip
// above every pane: the write side of Trust Center, on the page whose data the
// score is computed from. Task #4's `ProfileTrustBadge` drew the same score as
// a 36px ring inside the Profile card and RENDERED NOTHING on a failed read,
// which told a reader with a failed /trust/me that they had no score at all.
// The strip has three states, and the failed one says so with a retry.
//
// The number and the verdict are Trust Center's own: `computeTrustScore` over
// the same obligation rows, `verdictFor` for the word beside the ring,
// `outstandingCounts` and `scoreLine` for the sentence. Two surfaces, one
// formula — the parity test on the worker's copy covers this one too.
function ComplianceBridge() {
  const [state, setState] = useState({ phase: 'loading', obligations: [], message: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState((s) => (s.phase === 'failed' ? { ...s, phase: 'loading' } : s));
    api.trustMe()
      .then((m) => { if (!cancelled) setState({ phase: 'ready', obligations: m?.obligations || [], message: null }); })
      .catch((e) => { if (!cancelled) setState({ phase: 'failed', obligations: [], message: e?.message || null }); });
    return () => { cancelled = true; };
  }, [attempt]);

  if (state.phase === 'loading') return null;
  if (state.phase === 'failed') {
    return (
      <div data-testid="compliance-bridge-unreadable" className="mb-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-5 py-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Trust score</div>
        <Unreadable what="Your trust score" claim={state.message || ''} onRetry={() => setAttempt((n) => n + 1)} />
      </div>
    );
  }
  const obs = state.obligations;
  const score = computeTrustScore(obs);
  const required = obs.filter((o) => o.required);
  const missing = required
    .filter((o) => o.status !== 'satisfied' && o.status !== 'waived')
    .map((o) => o.obligation_key);
  const line = scoreLine(outstandingCounts(required));
  return (
    <div data-testid="compliance-bridge" className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-5 py-4">
      {/* The ring only: the strip prints its own "Trust score" label beside the verdict. */}
      <TrustScoreBadge size="md" score={score} missing={missing} label={false} />
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Trust score</div>
        <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100" data-testid="compliance-verdict">{verdictFor(score)}</div>
      </div>
      <div className="flex-1 min-w-[200px] text-sm text-gray-700 dark:text-gray-300" data-testid="compliance-line">
        {line}{' '}Trust Center reports on the data held here.
      </div>
      <Link to="/trust/me" className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-violet-400 whitespace-nowrap">
        Open Trust Center →
      </Link>
    </div>
  );
}

const ActivityPage = lazy(() => import('./ActivityPage'));

// Task #1 — Settings expansion (tabbed). `roles` controls visibility per
// signed-in role; absence = visible to all.
//
// D568 — THE ACCOUNT CENTER'S SECTION LIST, in the canvas's order and with its
// names (`acNav` in `design/incoming/ops-data.js`): Profile and identity,
// Notifications, Sign-in and security, Billing and orders, Following, and
// Developer for the one role its routes answer (Builder for every profile since D1315). The ids did not change, so
// every deep link that names a section still lands on it. The four sections
// the canvas does not draw are kept, under "More" (`group: 'more'`), rather
// than dropped with the screens they hold.
const SECTIONS = [
  { id: 'account', label: 'Profile and identity' },
  // D1134 (#2422) — Companies and projects, second, as the owner asked ("below Profile and identity").
  // D1413 (#3696 Q1): the section is "Portfolio" for every profile, at /account/portfolio.
  { id: 'companies', label: 'Portfolio' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'security-privacy', label: 'Sign-in and security' },
  { id: 'billing', label: 'Billing and orders' },
  // D642 (#1435) — Usage, after Billing and orders, as the Usage canvas draws it.
  { id: 'usage', label: 'Usage' },
  // D651 (#1463) — Connectors replace Integrations (D649), after Usage, as the
  // Connectors canvas draws the list. Integrations left "More" with it.
  { id: 'connectors', label: 'Connectors' },
  { id: 'following', label: 'Following' },
  // D1315 (#2418): Builder, for every profile (owner question 2, A): MCP and services, API keys, API usage, Activity.
  { id: 'builder', label: 'Builder' },
  { id: 'onboarding', label: 'Onboarding', group: 'more' },
  { id: 'appearance', label: 'Appearance', group: 'more' },
  { id: 'activity', label: 'Activity Log', group: 'more' },
];

// ---------- Page ------------------------------------------------------------

// D700 (#1662) — the deep-link map (`PATH_TO_SECTION`) and the two address
// rules (`accountViewFor`, `accountPathFor`) moved to `account/accountPhone.js`,
// so the map and the rules are tested together.

export default function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // D700 — below 1024px `/account` is the A1m index and each section is its
  // own page. One hook over `PHONE_QUERY` decides it (D699).
  const phone = usePhoneWidth();
  // The open section, or the phone's index, read from the address on every
  // path or hash change. It used to be read once, at mount: `/account` and
  // `/account/:section` render this same component, so React kept the page
  // when the path moved between them and the pane did not follow.
  const active = accountViewFor({ pathname: location.pathname, hash: location.hash, phone });
  // D753 — `/account/connectors/<key>` is that connector's page.
  const connectorKey = active === 'connectors' ? connectorKeyFor(location.pathname) : null;
  // D807 — which Usage page the address opens: the overview, or Limits.
  const usagePage = active === 'usage' ? usagePageFor(location.pathname) : null;
  // D1315 — Builder's page and drawer, read from the address.
  const builderView = active === 'builder' ? builderViewFor(location.pathname) : null;
  // D1138 — Companies and projects' tabs are addresses of their own; the canonicalising effect keeps them.
  const companiesTab = active === 'companies' ? companiesTabFor(location.pathname) : null;
  // D1139 — `/account/portfolio/<uid>` (D1415 part 4) is that company's page (D1413, PF2), kept by the same effect.
  const companyUid = active === 'companies' ? companyUidFor(location.pathname) : null;
  // D1413 (#3696, PF3) — `/account/portfolio/projects/<id>` is that project's page.
  const projectId = active === 'companies' ? portfolioProjectFor(location.pathname) : null;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const investorProfile = useInvestorProfile(active === 'security-privacy' && !loading && !!data);

  // A click in the section column, or a row on the phone's index, opens the
  // section through its address. On a phone each section is a page of its own,
  // so it is pushed and Back returns to the index; on desktop it replaces, as
  // the column always has.
  const setActive = (id, page = null) => navigate({ pathname: id === 'builder' ? builderPathFor({ page: page ?? 'services' }) : accountPathFor({ section: id, phone, usagePage: page }) }, { replace: !phone });

  // Keep the URL in lockstep with the open section so deep links work both
  // ways (bell → /account/notifications, sidebar click → URL update).
  //
  // This effect CANONICALISES: it rewrites whatever alias you arrived on to
  // the section's own path (`accountPathFor`), so /account/security becomes
  // /account/security-privacy and the four legacy aliases in PATH_TO_SECTION
  // resolve to their real tab. That is deliberate and predates the rename.
  //
  // The landing pane has no segment of its own on desktop — it IS the page,
  // so `/account/profile` and `/account/account` rewrite to `/account`. On a
  // phone bare `/account` is the index, so the pane keeps `/account/profile`
  // (D700), and `/account#security-recovery-codes` becomes
  // `/account/security-privacy#security-recovery-codes`.
  //
  // And the rewrite keeps the query and the hash: /settings?tab=… arrives from
  // the Google OAuth link callback and /settings#security-recovery-codes from
  // account recovery. A canonicalising hop must not eat the part of the link
  // that said why it was sent.
  useEffect(() => {
    const want = accountPathFor({ section: active, phone, key: connectorKey, usagePage, companiesTab, companyUid, projectId, builderView });
    if (location.pathname !== want && /^\/(?:account|settings)\b/.test(location.pathname)) {
      navigate({ pathname: want, search: location.search, hash: location.hash }, { replace: true, state: location.state });
    }
  }, [active, phone, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  // T19 — useToast handles cleanup on unmount; replaces inline `window.setTimeout(setToast, 4500)`.
  const { toast, showToast: setToastSafe } = useToast(4500);

  // After settings load, if the address names a section the user's role
  // isn't allowed to see, send them back to bare /account: the profile pane
  // on desktop, the index on a phone.
  useEffect(() => {
    if (!data || active === 'index') return;
    const r = (data.role || '').toLowerCase();
    const allowed = new Set(SECTIONS.filter(s => !s.roles || s.roles.includes(r)).map(s => s.id));
    if (!allowed.has(active)) navigate({ pathname: '/account', search: location.search }, { replace: true });
  }, [data, active, location.hash]);

  // D568 — an anchor in the address names a card that only exists once the
  // page has read the account and drawn the pane, which is after the browser
  // has given up looking for it. Scroll to it then.
  // A section loaded with its module (`lazySection`) looks again once it is in.
  useEffect(() => {
    if (!data) return;
    scrollToHash(location.hash);
  }, [data, active, location.hash]);

  // D568 — a failed root read is retried in place instead of leaving a red box
  // and a reload as the only way back.
  const [attempt, setAttempt] = useState(0);
  // Bumped when the profile cards save, so the editors under them remount and
  // re-read instead of holding a copy the cards just replaced.
  const [profileRev, setProfileRev] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const d = await api.getSettings();
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  const flash = (message, kind = 'success') => setToastSafe({ message, kind });

  const patch = async (delta) => {
    try {
      await api.updateSettings(delta);
      // Some settings are top-level (name, jurisdictions, …) while others live
      // under `profile` (bio, headline, socials). Merge each into the right
      // place so the canonical `data` stays in sync — otherwise the onBlur
      // "changed?" guards compare against stale `data.profile.*` and re-PATCH
      // on every blur.
      const PROFILE_KEYS = new Set(['bio', 'headline', 'socials']);
      setData(prev => {
        const next = { ...prev, ...delta };
        const profileDelta = {};
        for (const k of Object.keys(delta)) {
          if (PROFILE_KEYS.has(k)) profileDelta[k] = delta[k];
        }
        if (Object.keys(profileDelta).length) {
          next.profile = { ...prev.profile, ...profileDelta };
        }
        return next;
      });
      flash('Saved');
    } catch (e) {
      flash(e.message || 'Failed to save', 'error');
    }
  };

  if (loading && !data) {
    return (
      <div className="max-w-5xl space-y-4" data-testid="settings-page-loading">
        <Skeleton h={28} w="30%" />
        <Skeleton h={14} w="55%" />
        <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
          <Skeleton.Card />
          <div className="space-y-4"><Skeleton.Card /><Skeleton.Card /></div>
        </div>
      </div>
    );
  }
  if (error && !data) return (
    <div className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30" data-testid="settings-page-unreadable">
      <Unreadable what="Your account settings" claim={error} onRetry={() => setAttempt((n) => n + 1)} />
    </div>
  );
  if (!data) return null;

  const role = (data.role || '').toLowerCase();
  const sections = SECTIONS.filter(s => !s.roles || s.roles.includes(role));
  // Render-time gate: a role that deep-links to a section it may not open
  // must not get that section rendered just because the URL parsed `active`
  // before role was known. Mirror the nav filter on the content side.
  const allowedIds = new Set(sections.map(s => s.id));
  const safeActive = allowedIds.has(active) ? active : 'account';
  const reloadAccount = () => api.getSettings().then(setData);
  const paneProps = { location, data, setData, flash, patch, reloadAccount, profileRev, setProfileRev, onSelect: setActive, role, allowedIds, connectorKey, usagePage, builderView, investorProfile };

  const toastNote = toast && (
    <div className={`mb-4 rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 ${
      toast.kind === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    }`}>
      {toast.kind === 'error' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
      {toast.message}
    </div>
  );
  // D433 — the trust strip and the completeness banner sit above every pane
  // on desktop, and above the sections on a phone's index (D700).
  const top = (
    <>
      <ComplianceBridge />
      <ProfileCompletionBanner onJump={() => setActive('account')} />
    </>
  );

  // The owner requested no AI rail on Account or its sections. The shared
  // frame renders the body alone, without a rail column or phone trigger.
  return (
    <RailFrame>
    {phone ? (
      <AccountPhoneFrame
        view={active} sections={sections} top={top} toast={toastNote}
        index={<AccountPhoneIndexReads role={role} />}
        renderPane={(id) => <AccountPanes safeActive={id} {...paneProps} />}
      />
    ) : (
    <div className="min-w-0" data-testid="settings-page" data-active-section={safeActive}>
      {/* D753 — on a connector's page its name is the one <h1>. */}
      {!connectorKey && <>
        <h1 className="mb-1 text-2xl font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">Account</h1>
        <p className="mb-6 text-[13.5px] leading-relaxed text-axal-muted dark:text-gray-400">Who you are on the platform, how it reaches you, how you sign in, what you pay for and who you follow.</p>
      </>}

      {toastNote}

      {top}

      <div className="grid lg:grid-cols-[200px_1fr] gap-6">
        <AccountSectionNav sections={sections} active={safeActive} onSelect={setActive}
          subpages={{ usage: USAGE_PAGES, builder: BUILDER_PAGES }} activeSubpage={safeActive === 'usage' ? usagePage : safeActive === 'builder' ? builderView?.page ?? 'services' : null} />
        <AccountPanes safeActive={safeActive} {...paneProps} />
      </div>
    </div>
    )}
    </RailFrame>
  );
}

/** One section's pane: the same cards at every width. */
function AccountPanes({ safeActive, location, data, setData, flash, patch, reloadAccount, profileRev, setProfileRev, onSelect, role, allowedIds, connectorKey = null, usagePage = null, builderView = null, investorProfile }) {
  return (
    <div className="min-w-0 space-y-6">
      {safeActive === 'account' && (
        <>
          <ProfileIdentityCanvas
            data={data}
            onAccountChange={(delta) => setData((prev) => ({ ...prev, ...delta }))}
            onSaved={() => setProfileRev((n) => n + 1)}
          />
          <ProfileEditors key={profileRev} data={data} onSaved={(d) => setData(prev => ({ ...prev, ...d }))} flash={flash} patch={patch} />
          <EmailSection data={data} flash={flash} reload={reloadAccount} />
          {/* D1140 (#3020, CMP19b): Your companies moved to Companies and projects; this line says so once. */}
          <ProfileMovedNotice />
          <RolesAccessCard data={data} onJump={() => onSelect('billing')} />
          <AccountProgramAccess />
          <DocumentsAgreementsSection />
          <AccountDeletionCard data={data} flash={flash} reload={reloadAccount} />
        </>
      )}
      {safeActive === 'security-privacy' && (
        <>
          {location.hash === '#my-thesis' && <InvestorMyThesisCard investorProfile={investorProfile} key={location.key} flash={flash} role={data?.role} linked />}
          <AuthSection data={data} flash={flash} reload={reloadAccount} />
          {/* The canvas draws no privacy section. These cards stay on this
              pane, under their own label: the worker's cohort-access
              notice links `/account/security-privacy` to one of them. */}
          <SectionLabel as="h2" className="pt-2">Privacy</SectionLabel>
          <PrivacyCoreCard flash={flash} />
          <CohortAdvisorAccessCard flash={flash} />
          <InvestorSignalsContributionCard investorProfile={investorProfile} flash={flash} role={data?.role} />
          {location.hash !== '#my-thesis' && <InvestorMyThesisCard investorProfile={investorProfile} flash={flash} role={data?.role} />}
          <InvestorThesisEditorCard investorProfile={investorProfile} flash={flash} role={data?.role} />
          <MarketIntelContributionCard flash={flash} />
          <PrivacySection data={data} patch={patch} flash={flash} />
        </>
      )}
      {safeActive === 'notifications' && (
        <>
          <NotificationsSection data={data} flash={flash} />
          <AccountNewsletters />
          <PushDevices />
          <DigestQuietHoursCard flash={flash} />
        </>
      )}
      {/* D1140: the companies, each with its entity record, live on Companies and projects' Companies tab. */}
      {safeActive === 'companies' && <CompaniesProjects role={role} entityRecords={<><YourCompaniesSection flash={flash} /><CorporateEntityCard flash={flash} /></>} />}
      {safeActive === 'following' && <FollowingSection />}
      {safeActive === 'usage' && (usagePage === 'storage' ? <StoragePage role={role} /> : usagePage === 'ai-tokens' ? <AiTokensPage /> : usagePage === 'limits' ? <LimitsPage /> : usagePage === 'cost' ? <CostPage role={role} /> : <UsageSection role={role} />)}
      {safeActive === 'builder' && <BuilderSection view={builderView ?? undefined} />}
      {safeActive === 'onboarding' && <OnboardingSettingsTab />}
      {safeActive === 'connectors' && <ConnectorsTab connectorKey={connectorKey} />}
      {safeActive === 'billing' && allowedIds.has('billing') && <BillingTab data={data} flash={flash} />}
      {safeActive === 'appearance' && <AppearanceTab flash={flash} />}
      {safeActive === 'activity' && (
        <Suspense fallback={<div className="py-8 text-center text-gray-500 dark:text-gray-400 text-sm">Loading…</div>}>
          <ActivityPage />
        </Suspense>
      )}
    </div>
  );
}

/** D700 — the A1m index's two reads, the Following list and the role's plan status. */
function AccountPhoneIndexReads({ role }) {
  const follows = useAccountRead(() => api.followsMine());
  const billing = useBillingStatus(role);
  return <AccountPhoneIndex role={role} follows={follows} billing={billing} />;
}

// ---------- Sections --------------------------------------------------------

function CompletionRing({ pct, hint }) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  const r = 22, c = 2 * Math.PI * r;
  const off = c * (1 - v / 100);
  return (
    <div className="flex items-center gap-3">
      <svg width="56" height="56" viewBox="0 0 56 56" className="flex-shrink-0">
        <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-gray-200 dark:text-gray-700" />
        <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeWidth="5"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          transform="rotate(-90 28 28)"
          className={v >= 80 ? 'text-emerald-500' : v >= 50 ? 'text-violet-500' : 'text-amber-500'} />
        <text x="28" y="32" textAnchor="middle" fontSize="12" fontWeight="600" className="fill-gray-900 dark:fill-gray-100">{v}%</text>
      </svg>
      <div className="text-xs text-gray-600 dark:text-gray-400 leading-snug">{hint}</div>
    </div>
  );
}

// AE-2 — Top-of-Settings completion banner. The `/profile/identity`
// endpoint returns BOTH `profile_completion_pct` AND the authoritative
// `missing_required_fields` array (computed server-side with the same
// rules as the percentage), so the banner can never drift from the
// ring. Silent on error (anonymous / network) — banner is decorative,
// not blocking.
function ProfileCompletionBanner({ onJump }) {
  const [row, setRow] = useState(null);
  // D433 — a failed read used to be silent, which drew exactly what a complete
  // profile draws: nothing. Held apart from `row` so the two cannot be confused.
  const [failed, setFailed] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => api.getIdentitySettings()
      .then(r => { if (!cancelled) { setRow(r); setFailed(null); } })
      .catch((e) => { if (!cancelled) setFailed(e?.message || ''); });
    load();
    const onSaved = () => load();
    window.addEventListener('axal:profile_saved', onSaved);
    return () => { cancelled = true; window.removeEventListener('axal:profile_saved', onSaved); };
  }, []);
  if (failed !== null && !row) {
    return (
      <div data-testid="profile-completion-unreadable" className="mb-6">
        <Unreadable what="Your profile completeness" claim={failed} onRetry={() => window.dispatchEvent(new Event('axal:profile_saved'))} />
      </div>
    );
  }
  if (!row) return null;
  const pct = Number(row.profile_completion_pct || 0);
  if (pct >= 100) return null;
  const missing = Array.isArray(row.missing_required_fields)
    ? row.missing_required_fields.map(m => m?.label).filter(Boolean)
    : [];
  return (
    <div data-card className="mb-6 bg-violet-50/60 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-xl px-5 py-4 flex items-start gap-4">
      <CompletionRing pct={pct} hint={
        missing.length === 0
          ? <span>A few more fields to unlock contract auto-fill.</span>
          : <span>
              Still missing: <span className="font-medium text-gray-800 dark:text-gray-200">{missing.slice(0, 4).join(', ')}{missing.length > 4 ? `, +${missing.length - 4} more` : ''}</span>.
              <button onClick={onJump} className="ml-2 underline text-violet-700 dark:text-violet-300 hover:no-underline">Jump to Profile</button>
            </span>
      } />
    </div>
  );
}

function EmailSection({ data, flash, reload }) {
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = data.pending_email_change;

  const submit = async () => {
    if (!newEmail.trim()) return;
    setBusy(true);
    try {
      const res = await api.requestEmailChange(newEmail.trim());
      const msg = res.email_sent
        ? `Confirmation link sent to ${res.new_email}. A revocation link was also sent to your current email.`
        : `Confirmation link generated. Open it from your inbox or this dev URL: ${res.confirm_url || '(check server logs)'}`;
      flash(msg);
      setNewEmail('');
      reload();
    } catch (e) {
      flash(e.message || 'Failed to start email change', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Email address" description="The new address must confirm within 24 hours. The old address can revoke the change within 24 hours of the request.">
      <div className="space-y-3">
        <Field label="Current email">
          <input value={data.email} disabled className={`${inputCls} bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400`} />
        </Field>
        {pending ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            Pending change to <span className="font-medium">{pending.new_email}</span> — confirm by{' '}
            {new Date(pending.expires_at).toLocaleString()}.
          </div>
        ) : (
          <Field label="New email" hint="We'll send a confirmation link to this address.">
            <div className="flex gap-2">
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className={inputCls} />
              <button onClick={submit} disabled={busy || !newEmail}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium whitespace-nowrap">
                {busy ? 'Sending…' : 'Send confirmation'}
              </button>
            </div>
          </Field>
        )}
      </div>
    </Card>
  );
}

// BLOCK-AUTH-02 — passkey (WebAuthn) management. Register a platform/roaming
// authenticator, list registered passkeys, and remove them. A passkey is a
// strong factor: signing in with one mints a full-assurance session that also
// satisfies step-up, so it's a phishing-resistant alternative to the TOTP code.
function PasskeyPanel({ flash }) {
  const [passkeys, setPasskeys] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [label, setLabel] = useState('');
  const supported = typeof window !== 'undefined' && browserSupportsWebAuthn();

  const load = async () => {
    setErr('');
    try {
      const r = await api.passkey.list();
      setPasskeys(r?.passkeys || []);
    } catch (e) { setErr(e?.message || 'Failed to load passkeys'); }
  };
  useEffect(() => { if (supported) load(); else setPasskeys([]); }, [supported]);

  const addPasskey = async () => {
    setBusy(true); setErr('');
    try {
      const options = await api.passkey.registerOptions();
      const attResp = await startRegistration({ optionsJSON: options });
      await api.passkey.registerVerify(attResp, label.trim() || 'Passkey');
      setLabel('');
      flash && flash('Passkey added.');
      await load();
    } catch (e) {
      // User-cancelled / no authenticator surfaces as a DOMException; keep it quiet.
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') {
        setErr('Passkey setup was cancelled.');
      } else {
        setErr(e?.message || 'Could not add passkey.');
      }
    } finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Remove this passkey? You will no longer be able to sign in with it.')) return;
    setRemovingId(id); setErr('');
    try {
      await api.passkey.remove(id);
      flash && flash('Passkey removed.');
      await load();
    } catch (e) { setErr(e?.message || 'Could not remove passkey.'); }
    finally { setRemovingId(null); }
  };

  return (
    <Card title="Passkeys"
      description="Sign in with Face ID, Touch ID, Windows Hello, or a security key — no code to type. Passkeys are phishing-resistant and count as a strong factor.">
      {!supported ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          This browser doesn't support passkeys. Try a recent version of Safari, Chrome, or Edge.
        </div>
      ) : (
        <>
          {err && <div className="text-sm text-red-600 mb-3">{err}</div>}
          {passkeys === null ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
          ) : passkeys.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">No passkeys yet. Add one to sign in without a code.</div>
          ) : (
            <ul className="space-y-2 mb-4">
              {passkeys.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <KeyRound size={16} className="text-violet-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.name || 'Passkey'}</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">
                        Added {p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'}
                        {p.last_used_at ? ` · last used ${new Date(p.last_used_at).toLocaleDateString()}` : ''}
                        {Number(p.backed_up) === 1 ? ' · synced' : ''}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => remove(p.id)} disabled={removingId === p.id}
                    className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-400 shrink-0">
                    {removingId === p.id ? 'Removing…' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, 60))}
              placeholder="Name this passkey (e.g. MacBook Touch ID)"
              className={inputCls + ' flex-1'}
            />
            <button onClick={addPasskey} disabled={busy}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 shrink-0">
              <Plus size={14} /> {busy ? 'Waiting for authenticator…' : 'Add passkey'}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

// SMS as a backup 2FA factor (Google Cloud Identity Platform). Phone numbers
// at rest server-side; the UI only ever sees the last 4 digits.
// D568 — `onChanged` tells the pane an enrolment or removal landed, so the SMS
// factor row above (read from GET /settings/security) re-reads with it.
function SmsPanel({ data, flash, onChanged }) {
  // The keys page is Super Admin only (the owner's ruling, 2026-10-20), so
  // only the Super Admin gets the link to it.
  const { user: liveUser } = useAuth();
  const isSuperAdmin = isSuperAdminUser(liveUser);
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState('idle');           // idle | enroll | verify
  const [country, setCountry] = useState('US');
  const [countryReady, setCountryReady] = useState(false);
  const [countryReadError, setCountryReadError] = useState(false);
  const [phone, setPhone] = useState('');
  const [session, setSession] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkReady, setCheckReady] = useState(false);
  const [last4, setLast4] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [checking, setChecking] = useState(false);
  const recaptchaRef = useRef(null);
  const pendingCheck = useRef(null);
  useEffect(() => () => pendingCheck.current?.abort(), []);

  const refresh = async () => {
    try { setStatus(await api.smsStatus()); }
    catch { setStatus({ unreadable: true }); }
  };
  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    let cancelled = false;
    setCheckReady(false);
    if (!status?.sms_ready || step === 'idle') return;
    if (!status.recaptcha_site_key) { setCheckReady(true); return; }
    loadRecaptcha().then(() => { if (!cancelled) setCheckReady(true); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [status?.sms_ready, status?.recaptcha_site_key, step]);

  useEffect(() => {
    if (step !== 'verify') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [step]);

  useEffect(() => {
    let cancelled = false;
    api.getPersonalProfile().then(profile => {
      if (!cancelled) setCountry(phoneCountry(profile?.country));
    }).catch(() => { if (!cancelled) setCountryReadError(true); })
      .finally(() => { if (!cancelled) setCountryReady(true); });
    return () => { cancelled = true; };
  }, []);

  const normalizedPhone = normalizePhoneInput(phone, country);
  const countryOk = !normalizedPhone || status?.allowed_countries === null || (Array.isArray(status?.allowed_countries) && status.allowed_countries.includes(normalizedPhone.country));
  const canSend = countryReady && !busy && !!normalizedPhone && countryOk && checkReady;
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const refusal = async (e, fallback) => {
    const message = e?.message || fallback;
    setError(message);
    flash(message, 'error');
    if (e?.code === 'session_expired') { setCode(''); setResendAt(0); }
    if (e?.code === 'sms_unavailable' || e?.code === 'phone_auth_disabled') await refresh();
  };
  const start = async () => {
    if (!countryReady) return;
    if (!normalizedPhone) { flash(PHONE_ERROR, 'error'); return; }
    if (!canSend || (step === 'verify' && resendSeconds > 0)) return;
    const controller = new AbortController();
    pendingCheck.current = controller;
    setBusy(true);
    setChecking(true);
    setError('');
    try {
      const token = status.recaptcha_site_key ? await invisibleToken(recaptchaRef.current, status.recaptcha_site_key, controller.signal) : null;
      setChecking(false);
      if (controller.signal.aborted) return;
      const res = await api.smsStartEnrollment(normalizedPhone.e164, normalizedPhone.country, token);
      setSession(res.session_info);
      setLast4(res.last4);
      setCode('');
      setNow(Date.now());
      setResendAt(Date.now() + (res.resend_after_s ?? 60) * 1000);
      setStep('verify');
      flash('Verification code sent.');
    } catch (e) {
      if (!controller.signal.aborted) await refusal(e, 'Could not send verification code.');
    } finally { pendingCheck.current = null; setChecking(false); setBusy(false); }
  };

  const confirm = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    setError('');
    try {
      await api.smsConfirmEnrollment(session, code);
      flash('SMS 2FA enabled.');
      setStep('idle'); setPhone(''); setCode(''); setSession(null);
      await refresh();
      onChanged?.();
    } catch (e) {
      await refusal(e, 'Verification failed.');
    } finally { setBusy(false); }
  };

  const disable = async () => {
    if (!data.totp_configured) {
      flash('Configure your authenticator first — every account must keep at least one 2FA method.', 'error');
      return;
    }
    if (!window.confirm('Remove SMS as a sign-in method?')) return;
    setBusy(true);
    try {
      await api.smsDisable();
      flash('SMS 2FA disabled.');
      await refresh();
      onChanged?.();
    } catch (e) {
      flash(e?.message || 'Could not disable SMS.', 'error');
    } finally { setBusy(false); }
  };

  const errorNotice = error && <p role="alert" data-testid="sms-error" className="text-sm text-red-700 dark:text-red-300 mb-3">{error}</p>;
  if (!status) {
    return <Card title="SMS as a backup factor" description="Loading…"><div className="text-sm text-gray-500">…</div></Card>;
  }
  if (status.unreadable) return <Card title="SMS as a backup factor" description="SMS status could not be read.">{errorNotice}<button onClick={refresh} className="text-sm text-violet-700">Try again</button></Card>;
  if (!status.sms_available) {
    return (
      <Card title="SMS as a backup factor" description="SMS verification is not enabled on this server yet.">
        {errorNotice}
        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-2">
          <p>
            A Super Admin needs to add Google Cloud Identity Platform credentials
            under HQ → Integration keys → Google Identity (SMS). That stores the
            Web API key (<span className="font-mono">GCIP_API_KEY</span>) so you can
            add a phone number here as a backup factor for account recovery.
          </p>
          {isSuperAdmin && (
            <a
              href="/admin/integration-keys"
              data-testid="sms-admin-keys-link"
              className="inline-flex text-violet-700 hover:underline font-medium"
            >
              Open Integration Keys
            </a>
          )}
        </div>
      </Card>
    );
  }

  if (!status.sms_ready && !status.configured) return (
    <Card title="SMS as a backup factor" description="SMS backup isn't available yet — set-up isn't finished on this server.">
      {errorNotice}
      <button onClick={refresh} className="text-sm text-violet-700 mr-3">Try again</button>
      {isSuperAdmin && <a href="/admin/integration-keys" data-testid="sms-admin-keys-link" className="text-sm text-violet-700">Open Integration Keys</a>}
    </Card>
  );

  return (
    <Card
      title="SMS as a backup factor"
      description="Add a phone number as a backup verification factor. You'll receive a 6-digit code by text to confirm the number — used only for account recovery, never as a primary sign-in method."
    >
      <div ref={recaptchaRef} data-testid="sms-recaptcha" />
      {errorNotice}
      <div className="text-xs text-amber-800 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300 border border-amber-200 dark:border-amber-900 rounded-lg p-3 mb-3">
        <strong>SIM-swap warning:</strong> SMS is less secure than your authenticator app — anyone who takes over your phone number can use it to sign in.
        Billing changes, impersonation and other sensitive actions will always still require your authenticator code.
      </div>

      {status.configured && step === 'idle' && (
        <div className="space-y-3">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            Status: <span className="text-emerald-700 font-medium">Enrolled</span>
            <span className="text-gray-500 dark:text-gray-400"> · ending in {status.last4} ({status.country})</span>
          </div>
          <button onClick={disable} disabled={busy}
            className="px-4 py-2 border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 rounded-lg text-sm font-medium">
            {busy ? 'Removing…' : 'Remove SMS factor'}
          </button>
        </div>
      )}

      {!status.configured && step === 'idle' && (
        <button onClick={() => setStep('enroll')}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium">
          Add a phone number
        </button>
      )}

      {step === 'enroll' && (
        <div className="space-y-3">
          <Field label="Country">
            <select value={country} onChange={e => setCountry(e.target.value)} disabled={busy || !countryReady}
              className={inputCls} data-testid="sms-phone-country">
              {PHONE_COUNTRIES.map(option => <option key={option.country} value={option.country}>{option.label}</option>)}
            </select>
            {countryReadError && <p className="text-xs text-amber-700">Profile country unreadable. Choose the country for this number.</p>}
          </Field>
          <Field label="Phone" hint="Your mobile number, any country">
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} disabled={busy || !countryReady}
              placeholder={phonePlaceholder(country)} className={`${inputCls} font-mono`} data-testid="sms-phone-input" />
            {phone.trim() && !normalizedPhone && <p className="text-xs text-red-700 mt-1">{PHONE_ERROR}</p>}
            {normalizedPhone && !countryOk && <p className="text-xs text-amber-700 mt-1">Texts to {PHONE_COUNTRIES.find(c => c.country === normalizedPhone.country)?.label.split(' (+')[0] || normalizedPhone.country} aren't offered yet.</p>}
            {normalizedPhone && <p className="text-xs text-gray-500 mt-1" role="status">We'll text {normalizedPhone.international}.</p>}
          </Field>
          {!checkReady && !error && <p className="text-xs text-gray-500">Loading the security check…</p>}
          <div className="flex gap-2">
            <button onClick={start} disabled={!canSend}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium">
              {busy ? (checking ? 'Checking…' : 'Sending…') : 'Send verification code'}
            </button>
            <button disabled={busy && !checking} onClick={() => { pendingCheck.current?.abort(); setStep('idle'); setPhone(''); setError(''); }}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'verify' && (
        <div className="space-y-3">
          <div className="text-sm text-gray-700 dark:text-gray-300">We texted a 6-digit code to the number ending {last4}.</div>
          <div className="flex gap-2">
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000" inputMode="numeric" autoComplete="one-time-code" aria-label="Six-digit SMS code" data-testid="sms-code-input"
              className={`${inputCls} font-mono text-center tracking-widest`} />
            <button onClick={confirm} disabled={busy || code.length !== 6}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium whitespace-nowrap">
              {busy ? 'Verifying…' : 'Verify'}
            </button>
          </div>
          <button onClick={start} disabled={busy || resendSeconds > 0 || !checkReady} className="text-sm text-violet-700 disabled:text-gray-500 mr-3" data-testid="sms-resend">
            {resendSeconds > 0 ? `Resend in ${Math.floor(resendSeconds / 60)}:${String(resendSeconds % 60).padStart(2, '0')}` : 'Resend'}
          </button>
          <button disabled={busy && !checking} onClick={() => { pendingCheck.current?.abort(); setStep('enroll'); setCode(''); setSession(null); setError(''); setResendAt(0); }}
            className="text-xs text-gray-500 hover:text-gray-700">Use a different number</button>
        </div>
      )}
    </Card>
  );
}

// Task #50 — Trusted contacts management (Layer 3f, 2-of-2 social recovery).
function TrustedContactsPanel({ flash }) {
  const [contacts, setContacts] = useState(null);
  const [err, setErr] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setErr('');
    try {
      const r = await fetch('/api/auth/recover/trusted-contacts', { credentials: 'include' });
      // D258 — `r.ok` first: a refusal is read by `refusalError`, which takes
      // the body's sentence ahead of its code. Parsing first threw a JSON error
      // on any non-JSON answer, and `j.error` printed the code.
      if (!r.ok) throw await refusalError(r, 'Failed to load');
      const j = await r.json();
      setContacts(j.contacts || []);
    } catch (e) { setErr(e?.message || 'Failed to load'); }
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/auth/recover/trusted-contacts', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contact_email: email.trim(), display_name: name.trim() || null }),
      });
      if (!r.ok) throw await refusalError(r, 'Failed to add');
      setEmail(''); setName('');
      flash && flash('Trusted contact added.');
      await load();
    } catch (e) { setErr(e?.message || 'Failed to add'); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/auth/recover/trusted-contacts/${id}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!r.ok) throw await refusalError(r, 'Failed to remove');
      flash && flash('Removed.');
      await load();
    } catch (e) { setErr(e?.message || 'Failed to remove'); }
    finally { setBusy(false); }
  };

  return (
    <Card title="Trusted contacts (recovery)"
      description="Two trusted contacts together can vouch for you if you lose your authenticator. Both must sign in to Axal VC with their own two-factor to approve.">
      {err && <div className="text-sm text-red-600 mb-3">{err}</div>}
      {contacts === null ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
      ) : (
        <>
          {contacts.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              No trusted contacts yet. Add at least two to enable the social-recovery layer.
            </div>
          ) : (
            <ul className="space-y-2 mb-4">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {c.display_name || c.contact_email}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{c.contact_email}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {c.status === 'active' ? 'Active Axal VC user' : 'Pending invite — they\'ll be linked once they sign up'}
                    </div>
                  </div>
                  <button onClick={() => remove(c.id)} disabled={busy}
                    className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50">Remove</button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
            <input value={email} onChange={(e) => setEmail(e.target.value)}
              type="email" placeholder="contact@company.com" className={inputCls} />
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Display name (optional)" className={inputCls} />
          </div>
          <button onClick={add} disabled={busy || !email.trim()}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
            {busy ? 'Adding…' : 'Add trusted contact'}
          </button>
        </>
      )}
    </Card>
  );
}

// Task #50 — Per-user recovery activity feed.
function RecoveryActivityPanel() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/recover/activity', { credentials: 'include' });
        if (!r.ok) throw await refusalError(r, 'Failed to load');
        const j = await r.json();
        setRows(j.activity || []);
      } catch (e) { setErr(e?.message || 'Failed to load'); }
    })();
  }, []);
  return (
    <Card title="Recovery activity"
      description="Every recovery attempt on your account, including ones in progress. Contact security@axal.vc if you don't recognise one.">
      {err && <div className="text-sm text-red-600 mb-3">{err}</div>}
      {rows === null ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">No recovery attempts on file.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="text-left px-2 py-2 font-medium">Layer</th>
                <th className="text-left px-2 py-2 font-medium">Status</th>
                <th className="text-left px-2 py-2 font-medium">Started</th>
                <th className="text-left px-2 py-2 font-medium">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="px-2 py-2 font-mono text-xs">{r.layer}</td>
                  <td className="px-2 py-2">{r.status}</td>
                  <td className="px-2 py-2 text-xs">{r.created_at}</td>
                  <td className="px-2 py-2 text-xs">{r.resolved_at || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// Task #51 — Connected sign-in accounts (Google). Renders inline inside
// the Security tab so the user can link / unlink Google alongside their
// TOTP + SMS + recovery state. The unlink button is hidden when the
// worker reports `unlinkable=false` (no other sign-in path) — see
// /api/settings/connected-accounts.
// D6957 — what each Apple link return code means, in our words.
const APPLE_LINK_ERRORS = {
  already_linked: 'An Apple ID is already linked to this account.',
  sub_owned_by_other: 'That Apple ID is linked to a different Axal VC account.',
  caller_email_unverified: 'Confirm your email before linking Apple.',
  account_inactive: 'This account is inactive. Contact support.',
  cancelled: 'Apple linking cancelled.',
  provider_error: 'Apple could not link the account. Please try again.',
  exchange_failed: "Apple didn't confirm the link. Please try again.",
  token_invalid: "We couldn't verify your Apple ID. Please try again.",
  email_unverified: 'Apple has not verified the email on this Apple ID.',
  not_configured: 'Sign in with Apple is not available here yet.',
  bad_state: 'That linking attempt expired. Please retry.',
  missing_code: 'Apple returned without a sign-in. Please retry.',
  user_gone: 'This account no longer exists.',
  internal_error: 'Something went wrong on our side. Please try again.',
};

function ConnectedAccountsPanel({ flash }) {
  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setRow(await api.getConnectedAccounts()); }
    catch (e) { flash(e.message || 'Failed to load connected accounts', 'error'); }
  };
  useEffect(() => {
    load();
    // Honour the ?google_linked=1 / ?google_error=… query params the
    // /callback bounce drops on us, so the user sees a confirmation
    // toast right after returning from Google.
    const params = new URLSearchParams(window.location.search);
    if (params.get('google_linked') === '1') {
      flash('Google account linked.');
    }
    const err = params.get('google_error');
    if (err) {
      const copy = {
        already_linked: 'A Google account is already linked to this user.',
        sub_owned_by_other: 'That Google account is linked to a different Axal VC user.',
        caller_email_unverified: 'Verify your email before linking Google.',
        cancelled: 'Google linking cancelled.',
        provider_error: 'Google could not link the account. Please try again.',
        exchange_failed: 'Could not verify your Google account. Please try again.',
        email_unverified_at_google: 'Your Google email is not verified at Google.',
        bad_state: 'Linking link expired. Please retry.',
        internal_error: 'Something went wrong on our side. Please try again.',
      };
      flash(copy[err] || 'Google linking failed.', 'error');
    }
    // D6957 — the same for Sign in with Apple's link return.
    if (params.get('apple_linked') === '1') flash('Apple ID linked.');
    const appleErr = params.get('apple_error');
    if (appleErr) flash(APPLE_LINK_ERRORS[appleErr] || 'Apple linking failed. Please try again.', 'error');
    const keys = ['google_linked', 'google_error', 'apple_linked', 'apple_error'];
    if (keys.some((k) => params.has(k))) {
      const url = new URL(window.location.href);
      for (const k of keys) url.searchParams.delete(k);
      window.history.replaceState({}, '', url.pathname + (url.search ? `?${url.searchParams}` : ''));
    }
  }, []);

  const link = async () => {
    setBusy(true);
    try {
      const { url } = await api.googleStartUrl({ action: 'link', redirect: '/account/security' });
      if (!url) throw new Error('No redirect URL.');
      window.location.href = url;
    } catch (e) {
      flash(e.message || 'Google linking unavailable', 'error');
      setBusy(false);
    }
  };
  const unlink = async () => {
    if (!window.confirm('Unlink Google sign-in from this account?')) return;
    setBusy(true);
    try {
      await api.unlinkGoogle();
      flash('Google sign-in unlinked.');
      await load();
    } catch (e) {
      flash(e.message || 'Unlink failed', 'error');
    } finally { setBusy(false); }
  };
  const linkApple = async () => {
    setBusy(true);
    try {
      const { url } = await appleSignInApi.startUrl({ action: 'link', redirect: '/account/security' });
      if (!url) throw new Error('No redirect URL.');
      window.location.href = url;
    } catch (e) {
      flash(e.message || 'Apple linking unavailable', 'error');
      setBusy(false);
    }
  };
  const unlinkApple = async () => {
    if (!window.confirm('Unlink Sign in with Apple from this account?')) return;
    setBusy(true);
    try {
      await appleSignInApi.unlink();
      flash('Apple sign-in unlinked.');
      await load();
    } catch (e) {
      flash(e.message || 'Unlink failed', 'error');
    } finally { setBusy(false); }
  };

  if (!row) return null;
  const googleOn = !!row.available?.configured;
  const appleOn = !!row.available?.apple_configured;
  if (!googleOn && !appleOn) return null; // env not set — hide the card entirely
  const google = (row.accounts || []).find(a => a.provider === 'google') || { connected: false };
  const apple = (row.accounts || []).find(a => a.provider === 'apple') || { connected: false };

  return (
    <Card
      title="Connected sign-in accounts"
      description="Link Google or Apple for one-click sign-in. Each counts as one factor — sensitive actions still ask for your authenticator.">
      {googleOn && (
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-3">
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.2-8l-6.6 5.1C9.6 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2c-.4.4 6.7-4.9 6.7-14.8 0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          <div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Google</div>
            <div className={`text-xs ${google.connected ? 'text-emerald-700' : 'text-gray-500 dark:text-gray-400'}`}>
              {google.connected ? 'Linked' : 'Not linked'}
            </div>
          </div>
        </div>
        {google.connected ? (
          google.unlinkable ? (
            <button onClick={unlink} disabled={busy}
              className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-400">
              {busy ? 'Working…' : 'Unlink'}
            </button>
          ) : (
            <span className="text-xs text-amber-700" title="Set up TOTP, SMS, or verify your email first.">
              Cannot unlink — only sign-in path
            </span>
          )
        ) : (
          <button onClick={link} disabled={busy}
            className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
            {busy ? 'Redirecting…' : 'Link Google'}
          </button>
        )}
      </div>
      )}
      {appleOn && (
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className="text-gray-900 dark:text-gray-100">
              <path fill="currentColor" d="M16.37 12.6c-.02-2.1 1.72-3.11 1.8-3.16-0.98-1.43-2.5-1.63-3.04-1.65-1.29-.13-2.52.76-3.18.76-.66 0-1.67-.74-2.74-.72-1.41.02-2.71.82-3.44 2.08-1.47 2.54-.38 6.3 1.05 8.37.7 1.01 1.53 2.14 2.62 2.1 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.63.68 2.74.66 1.13-.02 1.85-1.03 2.54-2.04.8-1.17 1.13-2.3 1.15-2.36-.03-.01-2.2-.84-2.22-3.36zM14.3 6.42c.58-.7.97-1.68.86-2.65-.83.03-1.84.55-2.44 1.25-.53.62-1 1.61-.88 2.57.93.07 1.88-.47 2.46-1.17z" />
            </svg>
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Apple</div>
              <div className={`text-xs ${apple.connected ? 'text-emerald-700' : 'text-gray-500 dark:text-gray-400'}`}>
                {apple.connected ? (apple.private_email ? 'Linked · Hide My Email' : 'Linked') : 'Not linked'}
              </div>
            </div>
          </div>
          {apple.connected ? (
            apple.unlinkable ? (
              <button onClick={unlinkApple} disabled={busy}
                className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-400">
                {busy ? 'Working…' : 'Unlink'}
              </button>
            ) : (
              <span className="text-xs text-amber-700" title="Set up TOTP or SMS first.">
                Cannot unlink — only sign-in path
              </span>
            )
          ) : (
            <button onClick={linkApple} disabled={busy}
              className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
              {busy ? 'Redirecting…' : 'Link Apple'}
            </button>
          )}
        </div>
      )}
      {google.connected && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800 pt-3">
          Heads up: signing out of Axal VC does <strong>not</strong> sign you out of Google
          globally. If you're on a shared device, also sign out of your Google account
          in the browser.
        </p>
      )}
    </Card>
  );
}

// D433 — SIGN-IN & FACTORS AS STATUS ROWS, the canvas's shape: each row is a
// status with a date, and its flow lives in the panel below it. Two rows are
// honest absences rather than statuses: there is no password credential on
// this platform (sign-in is a magic link, Google or a passkey, with an
// authenticator code for step-up), and a passkey's or SMS row's own panel
// already reads its own store — a second fetch here would only let them
// disagree.
function factorDate(iso) {
  if (!iso) return null;
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}
// D568 — the canvas's "Sign-in factors" card is this one, extended rather than
// drawn twice. It gains the SMS row the canvas draws (from `security`, the
// page's one read of GET /settings/security, passed down so this card still
// makes no fetch of its own) and a button per row that takes the reader to the
// flow for that factor further down the pane.
function scrollToCard(id) {
  if (typeof document === 'undefined') return;
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function SignInFactorsCard({ data, remaining, security }) {
  const paired = factorDate(data.totp_paired_at);
  const sec = security?.status === 'ready' ? security.data || {} : null;
  const rows = [
    {
      key: 'password',
      label: 'Password',
      status: null,
      reason: 'this platform issues no password credential; sign-in is by magic link, Google or passkey, with an authenticator code for sensitive actions',
    },
    {
      key: 'totp',
      label: 'Authenticator app (TOTP)',
      status: data.totp_configured ? 'Configured' : 'Not configured',
      tone: data.totp_configured ? 'ok' : 'warn',
      meta: data.totp_configured
        ? (paired ? `Paired ${paired} · required for sensitive actions` : 'Paired — date not recorded for this enrolment · required for sensitive actions')
        : 'Set one up below — the strongest everyday protection for your account.',
      action: { label: data.totp_configured ? 'Re-pair' : 'Set up', target: 'account-authenticator' },
    },
    {
      key: 'sms',
      label: 'SMS',
      status: !sec ? (security?.status === 'unreadable' ? 'Unreadable' : 'Reading…') : (sec.sms_configured ? 'Verified' : 'Not set up'),
      tone: !sec ? (security?.status === 'unreadable' ? 'danger' : 'neutral') : (sec.sms_configured ? 'ok' : 'neutral'),
      meta: !sec
        ? (security?.status === 'unreadable' ? 'Whether an SMS number is set could not be read.' : '')
        : (sec.sms_configured
          ? `Ending ${sec.sms_last4 || '(last digits not recorded)'}${sec.sms_country ? ` · ${sec.sms_country}` : ''} · backup only`
          : 'A backup factor: a 6-digit code by text.'),
      action: { label: sec?.sms_configured ? 'Change number' : 'Add a number', target: 'account-sms' },
    },
    {
      key: 'recovery',
      label: 'Recovery codes',
      status: remaining > 0 ? `${remaining} remaining` : 'None generated',
      tone: remaining > 0 ? 'ok' : 'warn',
      meta: remaining > 0
        ? 'Each code signs you in once if you lose your authenticator.'
        : 'No codes generated — you could be locked out if you lose your authenticator.',
      action: { label: remaining > 0 ? 'Regenerate' : 'Generate', target: 'security-recovery-codes' },
    },
    {
      key: 'email',
      label: 'Email address',
      status: data.email_verified ? 'Verified' : 'Unverified',
      tone: data.email_verified ? 'ok' : 'warn',
      meta: data.email || '',
    },
  ];
  const toneCls = (t) => ({
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
    neutral: 'bg-axal-ground text-axal-muted border-axal-hairline dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
    danger: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  }[t] || 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800');
  return (
    <div data-card className="overflow-hidden rounded-axal-lg border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <h2 className="text-sm font-bold text-axal-ink dark:text-gray-100">Sign-in factors</h2>
      </div>
      <div className="divide-y divide-axal-hairline px-4 dark:divide-gray-800" data-testid="signin-factors">
        {rows.map((r) => (
          <div key={r.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2.5" data-testid={`factor-${r.key}`}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.label}</span>
                {r.status !== null && (
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${toneCls(r.tone)}`}>
                    {r.status}
                  </span>
                )}
              </div>
              {r.status === null
                ? <div className="text-xs text-gray-500 dark:text-gray-400"><Unrecorded reason={r.reason}>Not recorded</Unrecorded> — {r.reason}.</div>
                : r.meta ? <div className="text-xs text-axal-muted dark:text-gray-400">{r.meta}</div> : null}
            </div>
            {r.action && (
              <button
                type="button"
                onClick={() => scrollToCard(r.action.target)}
                data-testid={`factor-action-${r.key}`}
                className="whitespace-nowrap rounded-axal-sm border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:border-axal-violet/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              >
                {r.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AuthSection({ data, flash, reload }) {
  const [code, setCode] = useState('');
  const [qrPayload, setQrPayload] = useState(null);
  const [busy, setBusy] = useState(false);
  // Task #11 — first-time optional enrolment (magic-link / Google / classic
  // signups that skipped the authenticator step).
  const [enrolling, setEnrolling] = useState(false);
  // D568 — the pane's one read of GET /settings/security: the SMS factor row
  // and the active-session count come from it. Re-read when SMS changes.
  const security = useAccountRead(() => api.getSecuritySettings());

  // Sessions list (per-device revocation, populated from /settings/sessions).
  const [sessions, setSessions] = useState(null);
  const [sessionsErr, setSessionsErr] = useState(null);
  const [sessionBusyId, setSessionBusyId] = useState(null);

  // Recovery codes
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState(null);
  const remaining = data.totp_recovery_codes_remaining ?? 0;

  const loadSessions = async () => {
    try {
      const res = await api.listSessions();
      setSessions(res?.sessions || []);
      setSessionsErr(null);
    } catch (e) {
      setSessionsErr(e.message || 'Failed to load sessions');
    }
  };
  useEffect(() => { loadSessions(); }, []);

  const repair = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const res = await api.repairTotp(code.trim());
      setQrPayload(res);
      setCode('');
      flash('TOTP re-paired. Scan the new QR with your authenticator before signing in again.');
    } catch (e) {
      flash(e.message || 'TOTP repair failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  // D568 — "Sign out everywhere" moved to the canvas's Sessions and alerts card
  // (`SessionsCard`, POST /auth/sign-out-everywhere, the same jwt_min_iat bump
  // as the revoke-all route this button used), confirmed in place rather than
  // through `window.confirm`. One button, one place.

  const revokeOne = async (sess) => {
    if (sess.is_current && !window.confirm('This is your current session — revoking will sign you out. Continue?')) return;
    setSessionBusyId(sess.id);
    try {
      await api.revokeSession(sess.id);
      flash('Session revoked.');
      if (sess.is_current) {
        window.setTimeout(() => {
          try { localStorage.clear(); } catch {}
          window.location.href = '/login';
        }, 800);
      } else {
        await loadSessions();
      }
    } catch (e) {
      flash(e.message || 'Failed to revoke session', 'error');
    } finally {
      setSessionBusyId(null);
    }
  };

  const regenerateRecovery = async () => {
    if (!recoveryCode.trim()) return;
    if (remaining > 0 && !window.confirm('This invalidates any existing recovery codes. Continue?')) return;
    setRecoveryBusy(true);
    try {
      const res = await api.regenerateRecoveryCodes(recoveryCode.trim());
      setGeneratedCodes(res?.codes || []);
      setRecoveryCode('');
      flash('Recovery codes generated — save them now.');
    } catch (e) {
      flash(e.message || 'Failed to generate recovery codes', 'error');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const downloadCodes = () => {
    if (!generatedCodes) return;
    const txt = `Axal VC — TOTP recovery codes (${data.email})\nGenerated ${new Date().toISOString()}\n\n${generatedCodes.join('\n')}\n\nEach code can be used exactly once if you lose access to your authenticator app.\nDo not share these. Store somewhere safe (password manager, sealed envelope, etc.).\n`;
    const blob = new Blob([txt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `axal-recovery-codes-${(data.uid || data.id)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // D568 — the canvas's order: the factor rows, then the authenticator, the
  // SMS number and the sessions card, then the flows the canvas does not draw
  // (Google sign-in, recovery codes, passkeys, trusted contacts, the recovery
  // log, the per-device session list), all kept. Each factor row's button
  // scrolls to the card that holds its flow, by these ids.
  return (
    <>
      <SignInFactorsCard data={data} remaining={remaining} security={security} />
      <div id="account-authenticator" className="scroll-mt-4">
      <Card title={data.totp_configured ? 'Authenticator app' : 'Set up an authenticator app'}
        description={data.totp_configured
          ? 'Re-pair your authenticator if you lost or replaced your device.'
          : 'Scan the QR code in your authenticator app, enter the 6-digit code it shows, and you are set. Recovery codes are shown once, at the end.'}>
        {!qrPayload ? (
          <div className="space-y-3">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              Status: {data.totp_configured
                ? <span className="text-emerald-700 font-medium">Configured</span>
                : <span className="text-amber-700 font-medium">Not configured</span>}
            </div>
            {data.totp_configured && (
              <Field label="Enter your current 6-digit code to re-pair">
                <div className="flex gap-2">
                  <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456" inputMode="numeric" className={inputCls} />
                  <button onClick={repair} disabled={busy || code.length !== 6}
                    className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium whitespace-nowrap">
                    {busy ? 'Verifying…' : 'Re-pair'}
                  </button>
                </div>
              </Field>
            )}
            {!data.totp_configured && !enrolling && (
              <div className="space-y-2">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Add an authenticator app so signing in asks for a rotating 6-digit
                  code — the strongest everyday protection for your account.
                </p>
                <button onClick={() => setEnrolling(true)}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium">
                  Set up authenticator
                </button>
              </div>
            )}
            {!data.totp_configured && enrolling && (
              <div className="max-w-md">
                <TotpEnrollment
                  onDone={() => {
                    setEnrolling(false);
                    flash('Authenticator enrolled — your account is now protected.');
                    reload?.();
                  }}
                  onCancel={() => setEnrolling(false)}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-gray-700 dark:text-gray-300">Scan with your authenticator. After scanning, sign out and back in to confirm.</div>
            {qrPayload.qr_code ? (
              <img src={`data:image/png;base64,${qrPayload.qr_code}`} alt="TOTP QR"
                className="w-48 h-48 border border-gray-200 dark:border-gray-700 rounded-lg p-2 bg-white dark:bg-gray-900" />
            ) : (
              <div className="text-xs text-gray-600 dark:text-gray-400 break-all p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">{qrPayload.provisioning_uri}</div>
            )}
            <Field label="Manual entry secret">
              <input value={qrPayload.totp_secret} readOnly className={`${inputCls} font-mono`} onFocus={e => e.target.select()} />
            </Field>
          </div>
        )}
      </Card>
      </div>

      <div id="account-sms" className="scroll-mt-4">
        <SmsPanel data={data} flash={flash} onChanged={security.reload} />
      </div>

      <SessionsCard security={security} />

      <ConnectedAccountsPanel flash={flash} />

      {/* `/account#security-recovery-codes` is where account recovery sends
          the reader (auth_recover.ts); this id is what that anchor names. */}
      <div id="security-recovery-codes" className="scroll-mt-4">
      <Card title="Recovery codes"
        description="One-time codes you can use to sign in if you lose access to your authenticator app.">
        {generatedCodes ? (
          <div className="space-y-3">
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              These codes will not be shown again. Save them somewhere safe before you leave this page.
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {generatedCodes.map((c, i) => (
                <div key={i} className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 select-all">{c}</div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={downloadCodes}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium">
                Download as .txt
              </button>
              <button onClick={() => setGeneratedCodes(null)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 hover:border-gray-400 text-gray-700 dark:text-gray-300 rounded-lg text-sm">
                I've saved them
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              {remaining > 0
                ? <>You have <span className="font-semibold">{remaining}</span> unused recovery code{remaining === 1 ? '' : 's'}.</>
                : <span className="text-amber-700">You don't have any recovery codes yet — generate a set and store them somewhere safe.</span>}
            </div>
            {data.totp_configured ? (
              <Field label="Enter your current 6-digit TOTP code to generate 10 new recovery codes">
                <div className="flex gap-2">
                  <input value={recoveryCode}
                    onChange={e => setRecoveryCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456" inputMode="numeric" className={inputCls} />
                  <button onClick={regenerateRecovery} disabled={recoveryBusy || recoveryCode.length !== 6}
                    className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium whitespace-nowrap">
                    {recoveryBusy ? 'Generating…' : (remaining > 0 ? 'Regenerate codes' : 'Generate codes')}
                  </button>
                </div>
              </Field>
            ) : (
              <div className="text-sm text-gray-500 dark:text-gray-400">Configure TOTP first.</div>
            )}
          </div>
        )}
      </Card>
      </div>

      <PasskeyPanel flash={flash} />

      <TrustedContactsPanel flash={flash} />

      <RecoveryActivityPanel />

      <Card title="Active sessions" description="Every device signed in to this account, newest first. Revoke an active one here; a past session says why it ended. Sign out everywhere is in Sessions and alerts above.">
        {sessionsErr && <div className="text-sm text-red-600 mb-3">{sessionsErr}</div>}
        {sessions === null ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-3">No tracked sessions yet. New sign-ins will appear here.</div>
        ) : (
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  <th className="text-left px-2 py-2 font-medium">Device</th>
                  <th className="text-left px-2 py-2 font-medium">IP</th>
                  <th className="text-left px-2 py-2 font-medium">First seen</th>
                  <th className="text-left px-2 py-2 font-medium">Last seen</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => {
                  const row = sessionRowState(s);
                  return (
                    <tr key={s.id} className={`border-b border-gray-100 dark:border-gray-800 ${row.live ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400'}`}>
                      <td className="px-2 py-2 max-w-xs truncate" title={s.user_agent || ''}>
                        {s.user_agent || 'Unknown device'}
                        {s.is_current && (
                          <span className="ml-2 inline-block text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            This device
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs">{s.ip || '—'}</td>
                      <td className="px-2 py-2 text-xs">{s.created_at ? new Date(s.created_at).toLocaleString() : '—'}</td>
                      <td className="px-2 py-2 text-xs">{s.last_seen_at ? new Date(s.last_seen_at).toLocaleString() : '—'}</td>
                      <td className="px-2 py-2 text-right">
                        {!row.live ? (
                          <span className="text-xs text-gray-400">{row.label}</span>
                        ) : (
                          <button onClick={() => revokeOne(s)} disabled={sessionBusyId === s.id}
                            className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-400">
                            {sessionBusyId === s.id ? 'Revoking…' : 'Revoke'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/** D753 — a connector's own page when the address names one, else the hub. */
function ConnectorsTab({ connectorKey = null }) {
  return connectorKey ? <ConnectorPage connectorKey={connectorKey} /> : <ConnectorsHubTab />;
}

function ConnectorsHubTab() {
  // D651 (#1463) — the Connectors section (AccountConnectors.jsx) replaces the
  // embedded Integrations marketplace. We still fetch the integration settings
  // for the API-keys card's server flag; the section owns its own reads.
  //
  // D433 — THE API-KEYS CARD IS DRAWN, AND SAYS WHAT IT LACKS. The canvas
  // draws scoped tokens with Create and Revoke; the platform has no key store,
  // and the worker's `api_keys_enabled` is hard-coded false until the API tier
  // ships (T20). The card used to hide behind that flag, and had it flipped it
  // would have printed "No keys yet." over a store that does not exist. It now
  // reads "Not recorded" with the reason, in either state of the flag.
  const [flag, setFlag] = useState({ phase: 'loading', enabled: false });

  useEffect(() => {
    let cancelled = false;
    api.getIntegrationSettings()
      .then((r) => { if (!cancelled) setFlag({ phase: 'ready', enabled: !!r?.api_keys_enabled }); })
      .catch(() => { if (!cancelled) setFlag({ phase: 'failed', enabled: false }); });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <ConnectorsSection />
      <Card title="API keys"
        description="Scoped tokens for programmatic access.">
        <div data-testid="api-keys-card" className="text-sm text-gray-500 dark:text-gray-400">
          <Unrecorded reason="no key store yet">Not recorded</Unrecorded>
          {' — '}
          {flag.enabled
            ? 'the API tier is switched on for this account but no key store exists yet, so no key can be created or listed.'
            : 'no key store yet; the API tier (T20) has not shipped, and its flag is off for this account.'}
        </div>
      </Card>
    </>
  );
}

function AppearanceTab({ flash }) {
  const { appearance, effectiveTheme, setAppearance, loading } = useSettings();
  const [busy, setBusy] = useState(false);

  const set = async (delta) => {
    setBusy(true);
    try {
      await setAppearance(delta);
      flash('Saved');
    } catch (e) {
      flash(e.message || 'Failed to save', 'error');
    } finally { setBusy(false); }
  };

  if (loading) return <Card title="Appearance"><div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div></Card>;

  const themes = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
  ];

  return (
    <>
      <Card title="Theme"
        description={`Choose Light or Dark. Currently rendering as ${effectiveTheme}.`}>
        <div className="grid grid-cols-2 gap-2">
          {themes.map(t => {
            const active = appearance.theme === t.value;
            const Icon = t.icon;
            return (
              <button key={t.value} disabled={busy} onClick={() => set({ theme: t.value })}
                className={`flex flex-col items-center gap-2 px-4 py-4 rounded-lg border text-sm transition-colors ${
                  active ? 'border-violet-600 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900'
                }`}>
                <Icon size={20} />
                {t.label}
              </button>
            );
          })}
        </div>
      </Card>

      <HelpExplainersCard flash={flash} />
    </>
  );
}

// Task #15 — restore previously-dismissed page explainers.
function HelpExplainersCard({ flash }) {
  const [dismissed, setDismissed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getExplainersDismissed();
      const list = Array.isArray(res?.dismissed) ? res.dismissed : [];
      setDismissed(list);
      try { localStorage.setItem('dismissed_explainers', JSON.stringify(list)); } catch {}
      try { window.dispatchEvent(new CustomEvent('axal:explainers_synced')); } catch {}
    } catch { /* noop */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const restore = async (key) => {
    setBusy(true);
    try {
      const res = await api.restoreExplainer(key);
      const list = Array.isArray(res?.dismissed) ? res.dismissed : [];
      setDismissed(list);
      try { localStorage.setItem('dismissed_explainers', JSON.stringify(list)); } catch {}
      try { window.dispatchEvent(new CustomEvent('axal:explainers_synced')); } catch {}
      flash(key === 'all' ? 'Restored all explainers' : 'Restored');
    } catch (e) {
      flash(e.message || 'Failed to restore', 'error');
    } finally { setBusy(false); }
  };

  return (
    <Card title="Help & explainers"
      description="Page explainers you've dismissed. Restore one to see it again on its page.">
      {loading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
      ) : dismissed.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">Nothing dismissed yet.</div>
      ) : (
        <>
          <div className="space-y-1">
            {dismissed.map((key) => {
              const entry = EXPLAINERS[key];
              return (
                <div key={key}
                  className="flex items-center gap-2 text-sm border border-gray-100 dark:border-gray-800 rounded-lg px-3 py-2">
                  <span className="flex-1 truncate text-gray-900 dark:text-gray-100">
                    {entry ? entry.title : key}
                  </span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 hidden sm:inline">{key}</span>
                  <button onClick={() => restore(key)} disabled={busy}
                    className="px-2.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800">
                    Restore
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-3">
            <button onClick={() => restore('all')} disabled={busy}
              className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg">
              Restore all
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

function AccountDeletionCard({ data, flash, reload }) {
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const exportData = async () => {
    setExporting(true);
    try {
      const blob = await api.exportMyData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `axal-data-export-${data.uid || data.id}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      flash('Export downloaded');
    } catch (e) {
      flash(e.message || 'Export failed', 'error');
    } finally { setExporting(false); }
  };

  const requestDelete = async () => {
    if (!window.confirm('Submit an account deletion request? Hard delete after a 30-day grace period; our team will reach out within 7 days to confirm.')) return;
    setDeleting(true);
    try {
      const res = await api.requestAccountDeletion();
      flash(res.message || 'Deletion request submitted');
      reload();
    } catch (e) { flash(e.message || 'Failed to submit request', 'error'); }
    finally { setDeleting(false); }
  };

  const cancelDelete = async () => {
    setDeleting(true);
    try {
      await api.cancelAccountDeletion();
      flash('Deletion request cancelled');
      reload();
    } catch (e) { flash(e.message || 'Failed to cancel', 'error'); }
    finally { setDeleting(false); }
  };

  return (
    <Card title="Account & data" description="Export your data, or request account deletion (30-day grace period before hard delete).">
      <div className="flex flex-wrap gap-3">
        {/* #7002: /trust/data's "Request a copy of your data" lands here (#account-data-export). */}
        <span id="account-data-export" className="contents" />
        <button onClick={exportData} disabled={exporting}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 hover:border-gray-400 text-gray-800 dark:text-gray-200 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50">
          <Download size={14} /> {exporting ? 'Preparing…' : 'Download my data (JSON)'}
        </button>
        {/* #7002: /trust/data's "Request deletion" lands here (#account-deletion). */}
        <span id="account-deletion" className="contents" />
        {data.deletion_requested_at ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-amber-700">Deletion requested {new Date(toUtcInstant(data.deletion_requested_at)).toLocaleDateString()}</span>
            <button onClick={cancelDelete} disabled={deleting}
              className="px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancel request</button>
          </div>
        ) : (
          <button onClick={requestDelete} disabled={deleting}
            className="px-4 py-2 border border-red-200 hover:border-red-400 text-red-700 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50">
            <Trash2 size={14} /> Request account deletion
          </button>
        )}
      </div>
      {/*
        D169 — ONLY WHILE NOTHING IS OPEN, which is the whole point: the amber
        line above IS the current state when a request is live, and the closed
        row behind it is then a PREVIOUS ask. Rendering both would put a stale
        denial beside a request the subject has just filed again — asking twice
        after a refusal opens a new row and leaves the old outcome in place, so
        this is reachable rather than theoretical.
      */}
      {!data.deletion_requested_at && <DsrOutcomeNotice outcome={data.dsr_outcome} />}
    </Card>
  );
}

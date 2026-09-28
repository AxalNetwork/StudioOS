import React, { useEffect, useState } from 'react';
import InfoStrip from '../components/InfoStrip';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { RefreshCw, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { trackOnce } from '../lib/funnel';
import { reportError } from '../lib/log';
import FounderStudioHome from './founder/FounderStudioHome';
import InvestorStudioHome from './investor/InvestorStudioHome';
import AdvisorStudioHome from './advisor/AdvisorStudioHome';
import PartnerStudioHome from './partner/PartnerStudioHome';
import AdminStudioHome from './admin/AdminStudioHome';
// Task #6 (IF) — first-login product tour (the onboarding checklist panel
// was removed 2026-05-22: signup flow already runs the persona chatbot and
// the page already surfaces the Personal Advisor, so the checklist
// duplicated guidance the user already had).
import ProductTour from '../components/ProductTour';

export default function Dashboard({ activeRole, authUser }) {
  const location = useLocation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Task #81 — investor deal lifecycle. `undefined` = not yet loaded, `null` =
  // loaded-but-empty/error, object = funnel payload.
  const [investorLC, setInvestorLC] = useState(undefined);
  // Task #51 — one-time "Google sign-out scope" notice after a fresh
  // Google signup (?google_signup=1 stamped by /api/auth/google/callback).
  // sessionStorage gate keeps the banner from re-firing on refresh.
  const [googleNotice, setGoogleNotice] = useState(false);
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get('google_signup') === '1' && !sessionStorage.getItem('google_signup_notice_shown')) {
        setGoogleNotice(true);
        sessionStorage.setItem('google_signup_notice_shown', '1');
      }
      if (u.searchParams.has('google_signup') || u.searchParams.has('google')) {
        u.searchParams.delete('google_signup');
        u.searchParams.delete('google');
        window.history.replaceState({}, '', u.pathname + (u.search ? `?${u.searchParams}` : ''));
      }
    } catch { /* noop */ }
  }, []);
  // Task #6 (IF) — tour fires once when /api/onboarding/checklist returns
  // meta.tour_seen_at === null. Checked on every mount; the
  // first POST /api/onboarding/meta {tour_seen:true} closes the loop.
  const [tourEnabled, setTourEnabled] = useState(false);

  const load = async (fresh = false) => {
    try {
      setError('');
      const d = await api.getDashboard(fresh);
      setData(d);
    } catch (e) {
      // Task #10 — capture the failure (prod-visible) instead of letting it
      // vanish, then surface a persistent, actionable error state below.
      reportError('Dashboard:load', e);
      setError(e.message || 'Something went wrong loading your dashboard.');
    }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Task #2 — funnel: activation endpoint. trackOnce de-dupes per browser
  // (localStorage) so only the FIRST dashboard render after signup counts.
  useEffect(() => {
    trackOnce('dashboard_first_view');
  }, []);

  // Task #81 — once we know the viewer is an investor, pull their read-only
  // deal-lifecycle funnel. Silent on error so the deal desk still renders.
  useEffect(() => {
    const viewingInvestor = (activeRole || data?.role_view) === 'investor';
    const ownsInvestorScope = data?.user?.role === 'investor';
    if (!viewingInvestor || !ownsInvestorScope) {
      setInvestorLC(undefined);
      return;
    }
    let cancelled = false;
    api.investorLifecycle()
      .then((d) => { if (!cancelled) setInvestorLC(d); })
      .catch((e) => { if (!cancelled) { setInvestorLC(null); reportError('Dashboard:investorLifecycle', e); } });
    return () => { cancelled = true; };
  }, [activeRole, data?.role_view, data?.user?.role]);

  // Task #10 — a 200 response with no `user` is a malformed payload. Capture it
  // so it's debuggable; the render below shows a recoverable state rather than
  // throwing on the destructure / blanking.
  useEffect(() => {
    if (data && !data.user) reportError('Dashboard:malformed', new Error('dashboard payload missing user'));
  }, [data]);

  // Task #6 (IF) — decide whether to fire the 5-step product tour. We
  // wait until after the main content has mounted so the
  // `data-tour` anchors exist when the tooltip queries them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.getOnboardingChecklist();
        if (!cancelled && d && !d?.meta?.tour_seen_at) setTourEnabled(true);
      } catch { /* tour silently skipped if endpoint unreachable */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // The admin profile does not wait on the founder dashboard, and it does not
  // fall through to skills, values and archetype. Eadwyn and the Admin page
  // cards render from the branch reads, which answer on their own.
  if (activeRole === 'admin' && authUser) {
    return (
      <div className="space-y-6">
        {googleNotice && (
          <InfoStrip variant="info" inline={false} onDismiss={() => setGoogleNotice(false)}>
            <strong>You're signed in with Google.</strong> Signing out of Axal VC will not
            sign you out of Google globally — if you're on a shared device, also sign
            out of your Google account in this browser. You can manage this anytime
            under <Link to="/account/security" className="underline">Settings → Security → Connected accounts</Link>.
          </InfoStrip>
        )}
        <ProductTour enabled={tourEnabled} onDone={() => setTourEnabled(false)} />
        <AdminStudioHome user={authUser} />
      </div>
    );
  }

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-20 justify-center">
      <Loader2 className="animate-spin" size={16} /> Loading your studio…
    </div>
  );
  if (error && activeRole === 'investor' && authUser) {
    const previewingInvestor = authUser.role !== 'investor';
    return (
      <div className="space-y-6">
        <ProductTour enabled={tourEnabled} onDone={() => setTourEnabled(false)} />
        <InvestorStudioHome
          user={authUser}
          dashboard={null}
          lifecycle={null}
          previewing={previewingInvestor}
          dashboardUnavailable={previewingInvestor ? '' : error}
          onRetryDashboard={() => { setLoading(true); load(); }}
        />
      </div>
    );
  }
  if (error && activeRole === 'advisor' && authUser) {
    const previewingAdvisor = authUser.role !== 'advisor';
    return (
      <div className="space-y-6">
        <ProductTour enabled={tourEnabled} onDone={() => setTourEnabled(false)} />
        <AdvisorStudioHome
          user={authUser}
          dashboard={null}
          previewing={previewingAdvisor}
          dashboardUnavailable={previewingAdvisor ? '' : error}
          onRetryDashboard={() => { setLoading(true); load(); }}
        />
      </div>
    );
  }
  if (error && activeRole === 'partner' && authUser) {
    const previewingPartner = authUser.role !== 'partner';
    return (
      <div className="space-y-6">
        <ProductTour enabled={tourEnabled} onDone={() => setTourEnabled(false)} />
        <PartnerStudioHome
          user={authUser}
          dashboard={null}
          previewing={previewingPartner}
          dashboardUnavailable={error}
          onRetryDashboard={() => { setLoading(true); load(); }}
        />
      </div>
    );
  }
  if (error) return (
    <DashboardFallback
      title="We couldn't load your dashboard"
      message={error}
      onRetry={() => { setLoading(true); load(); }}
    />
  );
  // Task #10 — never render a bare `null` (a silent white page). A falsy or
  // malformed payload now shows a persistent, actionable recovery state.
  if (!data || !data.user) return (
    <DashboardFallback
      title="Your dashboard isn't available right now"
      message="We received an unexpected response from the server. Please try again."
      onRetry={() => { setLoading(true); load(); }}
    />
  );

  const { user, role_view } = data;

  if ((activeRole || role_view) === 'founder') {
    return (
      <div className="space-y-6">
        {googleNotice && (
          <InfoStrip variant="info" inline={false} onDismiss={() => setGoogleNotice(false)}>
            <strong>You're signed in with Google.</strong> Signing out of Axal VC will not
            sign you out of Google globally — if you're on a shared device, also sign
            out of your Google account in this browser. You can manage this anytime
            under <Link to="/account/security" className="underline">Settings → Security → Connected accounts</Link>.
          </InfoStrip>
        )}
        <ProductTour enabled={tourEnabled} onDone={() => setTourEnabled(false)} />
        <FounderStudioHome user={user} />
      </div>
    );
  }

  if ((activeRole || role_view) === 'investor') {
    const previewingInvestor = user.role !== 'investor';
    return (
      <div className="space-y-6">
        {googleNotice && (
          <InfoStrip variant="info" inline={false} onDismiss={() => setGoogleNotice(false)}>
            <strong>You're signed in with Google.</strong> Signing out of Axal VC will not sign you out of Google globally — manage connected accounts under <Link to="/account/security" className="underline">Settings → Security</Link>.
          </InfoStrip>
        )}
        <ProductTour enabled={tourEnabled} onDone={() => setTourEnabled(false)} />
        <InvestorStudioHome
          user={user}
          dashboard={previewingInvestor ? null : data}
          lifecycle={previewingInvestor ? null : investorLC}
          previewing={previewingInvestor}
          onRetryDashboard={() => { setLoading(true); load(); }}
          onRetryLifecycle={() => {
            setInvestorLC(undefined);
            api.investorLifecycle()
              .then((d) => setInvestorLC(d))
              .catch((e) => { setInvestorLC(null); reportError('Dashboard:investorLifecycle', e); });
          }}
        />
      </div>
    );
  }

  if ((activeRole || role_view) === 'advisor') {
    const previewingAdvisor = user.role !== 'advisor';
    return (
      <div className="space-y-6">
        {googleNotice && (
          <InfoStrip variant="info" inline={false} onDismiss={() => setGoogleNotice(false)}>
            <strong>You're signed in with Google.</strong> Signing out of Axal VC will not sign you out of Google globally — manage connected accounts under <Link to="/account/security" className="underline">Settings → Security</Link>.
          </InfoStrip>
        )}
        <ProductTour enabled={tourEnabled} onDone={() => setTourEnabled(false)} />
        <AdvisorStudioHome
          user={user}
          dashboard={previewingAdvisor ? null : data}
          previewing={previewingAdvisor}
          onRetryDashboard={() => { setLoading(true); load(); }}
        />
      </div>
    );
  }

  if ((activeRole || role_view) === 'partner') {
    const previewingPartner = user.role !== 'partner';
    return (
      <div className="space-y-6">
        {googleNotice && (
          <InfoStrip variant="info" inline={false} onDismiss={() => setGoogleNotice(false)}>
            <strong>You're signed in with Google.</strong> Signing out of Axal VC will not sign you out of Google globally — manage connected accounts under <Link to="/account/security" className="underline">Settings → Security</Link>.
          </InfoStrip>
        )}
        <ProductTour enabled={tourEnabled} onDone={() => setTourEnabled(false)} />
        <PartnerStudioHome
          user={user}
          dashboard={previewingPartner ? null : data}
          previewing={previewingPartner}
          onRetryDashboard={() => { setLoading(true); load(); }}
        />
      </div>
    );
  }

  // D323 — the old "Welcome back" page is retired. Only two kinds of viewer
  // reached it: an exploring account admitted to the Spin-Out Lab (labRoles in
  // App.jsx lets a Lab member onto /studio whatever their role), and an admin
  // viewing as a role with no Studio home of its own. A Lab member is on the
  // founder track, so /studio is the founder home, which does every job the old
  // page did. Anyone else holds at /exploring, with the query string kept.
  if (authUser?.spinout_lab_active === 1 || user?.spinout_lab_active === 1) {
    return (
      <div className="space-y-6">
        {googleNotice && (
          <InfoStrip variant="info" inline={false} onDismiss={() => setGoogleNotice(false)}>
            <strong>You're signed in with Google.</strong> Signing out of Axal VC will not
            sign you out of Google globally — if you're on a shared device, also sign
            out of your Google account in this browser. You can manage this anytime
            under <Link to="/account/security" className="underline">Settings → Security → Connected accounts</Link>.
          </InfoStrip>
        )}
        <ProductTour enabled={tourEnabled} onDone={() => setTourEnabled(false)} />
        <FounderStudioHome user={user} />
      </div>
    );
  }
  return <Navigate to={{ pathname: '/exploring', search: location.search, hash: location.hash }} replace />;
}

function DashboardFallback({ title, message, onRetry }) {
  return (
    <div className="max-w-lg mx-auto mt-10 border border-red-200 dark:border-red-900/50 bg-red-50/70 dark:bg-red-950/30 rounded-xl p-6">
      <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{title}</h1>
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">{message}</p>
      <div className="flex flex-col sm:flex-row gap-2.5">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
        >
          <RefreshCw size={15} /> Try again
        </button>
        <a
          href="/studio"
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Reload
        </a>
      </div>
    </div>
  );
}

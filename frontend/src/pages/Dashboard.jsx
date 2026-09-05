import React, { useEffect, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import InfoStrip from '../components/InfoStrip';
import { Link } from 'react-router-dom';
import { Bell, RefreshCw, Loader2, Briefcase, ChevronRight, Sparkles, TrendingUp, Eye, Handshake, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import { trackOnce } from '../lib/funnel';
import { reportError } from '../lib/log';
import SemanticSearch from '../components/SemanticSearch';
import InvestorTrialBanner from '../components/InvestorTrialBanner';
import InvestorQuotaBars from '../components/InvestorQuotaBars';
import PersonalAdvisor from '../components/advisor/PersonalAdvisor';
import ProfileFitSection from '../components/profile/ProfileFitSection';
import VentureNextStep from '../components/VentureNextStep';
import FounderStudioHome from './founder/FounderStudioHome';
import InvestorStudioHome from './investor/InvestorStudioHome';
import AdvisorStudioHome from './advisor/AdvisorStudioHome';
import PartnerStudioHome from './partner/PartnerStudioHome';
// Task #81 — reuse the founder command-center lifecycle rail for the investor
// deal desk (rendered read-only: canEdit={false}).
import LifecycleModule from '../components/command-center/LifecycleModule';
// Task #6 (IF) — first-login product tour (the onboarding checklist panel
// was removed 2026-05-22: signup flow already runs the persona chatbot and
// the page already surfaces the Personal Advisor, so the checklist
// duplicated guidance the user already had).
import ProductTour from '../components/ProductTour';

export default function Dashboard({ activeRole, authUser }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
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
    finally { setLoading(false); setRefreshing(false); }
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

  const refresh = async () => {
    setRefreshing(true);
    try { await api.refreshDashboardScores(); } catch {}
    // Task #81 — the lifecycle effect is keyed on role_view (unchanged by a
    // manual refresh), so re-pull the funnel here to keep it in step with the
    // freshly-aggregated dashboard payload.
    if ((activeRole || data?.role_view) === 'investor') {
      api.investorLifecycle()
        .then((d) => setInvestorLC(d))
        .catch((e) => { setInvestorLC(null); reportError('Dashboard:investorLifecycle', e); });
    }
    load(true);
  };

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

  const { user, operator_workspace, notifications, role_view } = data;

  const isInvestor = role_view === 'investor';
  const isOperator = role_view === 'founder' || role_view === 'admin' || (operator_workspace?.assigned_tasks?.length > 0);
  const unreadNotifs = notifications?.length || 0;

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
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Welcome back, {user.name?.split(' ')[0] || user.email?.split('@')[0] || 'there'}</h1>
        <PageExplainer pageKey="dashboard" />
            <RoleBadge role={user.role} />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">Here's your venture studio at a glance.</p>
          <div className="mt-3" data-tour="search"><SemanticSearch /></div>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex items-center gap-2">
            <div className="relative" data-tour="notifications">
              <button onClick={() => setShowNotifs(s => !s)} className="relative p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                <Bell size={16} className="text-gray-700 dark:text-gray-300" />
                {unreadNotifs > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{unreadNotifs}</span>}
              </button>
              {showNotifs && <NotifDropdown items={notifications} onClose={() => setShowNotifs(false)} />}
            </div>
            <button onClick={refresh} disabled={refreshing} className="flex items-center gap-2 text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg">
              {refreshing ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} Refresh Scores
            </button>
          </div>
        </div>
      </div>
      <ProductTour enabled={tourEnabled} onDone={() => setTourEnabled(false)} />

      {/* Task #7 (W-2) — investor trial countdown banner (auto-hides) */}
      <InvestorTrialBanner user={user} />

      <PersonalAdvisor />

      {isInvestor ? (
        /* Task #81 — Investor deal desk: quota bars, deal-lifecycle funnel,
           scored-opportunity strip, and quick stats. No ProfileFitSection. */
        <InvestorHome data={data} lifecycle={investorLC} user={user} />
      ) : (
        <>
          {/* Venture progress comes FIRST. This page used to open straight onto
              ProfileFitSection — skills, values, archetype — so a founder's
              front door said nothing about their company. This strip carries
              the same next-action LifecycleModule shows and links into Command
              Center, which nothing on this page reached before. */}
          <VentureNextStep />

          {/* Task #20 — Best-Fit: skills/values/archetype/completion + matches range. */}
          <ProfileFitSection />

          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
            </div>

            <div className="space-y-6">
              <IndependentSubsidiariesWidget />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Task #81 — Investor deal desk ----------

// The investor home surface. Composes the quota bars, the read-only deal
// lifecycle funnel (reusing the founder LifecycleModule), a scored-opportunity
// strip rendered as actionable cards, and a quick-stats row. Deliberately
// simple so the Actionable-Matches task can re-skin the scored strip later.
function InvestorHome({ data, lifecycle, user }) {
  const opportunities = data?.ai_scored_opportunities || [];
  const dealFlowCount = data?.proprietary_deal_flow?.length || 0;
  return (
    <div className="space-y-6">
      <InvestorQuotaBars user={user} />
      <DealLifecycle lifecycle={lifecycle} />
      <InvestorStats quickStats={data?.quick_stats} counts={lifecycle?.counts} dealFlowCount={dealFlowCount} />
      <ScoredOpportunities items={opportunities} />
    </div>
  );
}

// Maps the /dashboard/investor-lifecycle payload into the shape LifecycleModule
// expects and renders it read-only. `undefined` lifecycle = still loading.
function DealLifecycle({ lifecycle }) {
  if (lifecycle === undefined) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Loader2 className="animate-spin" size={14} /> Loading your deal lifecycle…
      </div>
    );
  }
  const stages = lifecycle?.stages || [];
  if (!stages.length) return null;
  // Task #83 — open DD reviewer items (assigned to me) lead the checklist so the
  // module's "next best action" points at concrete diligence work, then the
  // funnel-stage rollup follows.
  const nextActions = (lifecycle?.next_actions || []).map((a) => ({
    key: a.key,
    label: a.label,
    done: !!a.done,
    manual: !!a.manual,
    href: a.href,
  }));
  const lc = {
    stage: lifecycle.current_stage || stages[0].id,
    stored: true,
    stages: stages.map((s) => ({ id: s.id, label: s.label, goal: `${s.count} ${s.count === 1 ? 'deal' : 'deals'} at this stage` })),
    checklist: [
      ...nextActions,
      ...stages.map((s) => ({
        key: s.id,
        label: `${s.label} · ${s.count}`,
        done: !!s.reached,
        manual: false,
        href: s.href,
      })),
    ],
    suggestions: [],
  };
  return <LifecycleModule lifecycle={lc} canEdit={false} />;
}

// Compact quick-stats row for the investor home.
function InvestorStats({ quickStats, counts, dealFlowCount }) {
  const scoreAvg = quickStats?.ai_score_avg;
  const items = [
    { icon: TrendingUp, label: 'Deals in flow', value: dealFlowCount },
    { icon: Sparkles, label: 'Avg AI match', value: scoreAvg != null ? `${scoreAvg}` : '—' },
    { icon: Eye, label: 'Watching', value: counts?.watching ?? '—' },
    { icon: Handshake, label: 'Active deal rooms', value: counts?.dealrooms ?? '—' },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map((it) => (
        <div key={it.label} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <it.icon size={15} />
            <span className="text-xs font-medium uppercase tracking-wide">{it.label}</span>
          </div>
          <p className="mt-1.5 text-xl font-bold text-gray-900 dark:text-gray-100">{it.value}</p>
        </div>
      ))}
    </div>
  );
}

// The AI-scored deal strip. Each card links out (navigation only) — the
// Actionable-Matches task owns the shared card primitive + intro-quota actions.
function ScoredOpportunities({ items }) {
  const list = (items || []).filter((o) => o && (o.deal_name || o.deal_id)).slice(0, 6);
  return (
    <Card title="AI-scored opportunities" icon={Sparkles} link="/deals" linkLabel="View deal flow">
      {list.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4">
          No scored opportunities yet. As deals are matched to your thesis, they'll appear here.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {list.map((o) => <ScoredCard key={o.id ?? o.deal_id} o={o} />)}
        </div>
      )}
    </Card>
  );
}

function ScoredCard({ o }) {
  const score = typeof o.score === 'number' ? Math.round(o.score) : null;
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{o.deal_name || 'Confidential deal'}</div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
            {[o.sector, o.stage].filter(Boolean).join(' • ') || '—'}
          </div>
        </div>
        {score != null && (
          <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
            {score}
          </span>
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-3 text-[11px] font-medium">
        {o.deal_id && (
          <Link to={`/projects/${o.deal_id}`} className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-300 hover:underline">
            Open <ArrowRight size={11} />
          </Link>
        )}
        <Link to="/watchlist" className="text-gray-500 dark:text-gray-400 hover:text-violet-600 dark:hover:text-violet-300">Watchlist</Link>
        <Link to="/deals" className="text-gray-500 dark:text-gray-400 hover:text-violet-600 dark:hover:text-violet-300">Request intro</Link>
      </div>
    </div>
  );
}

function IndependentSubsidiariesWidget() {
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { setSubs(await api.independentSubsidiaries()); } finally { setLoading(false); } })(); }, []);
  if (loading) return null;
  if (!subs.length) return null;
  return (
    <Card title="Independent Subsidiaries" icon={Briefcase} link="/legal-capital" linkLabel="Manage">
      <div className="space-y-2">
        {subs.slice(0, 5).map(s => (
          <div key={s.id} className="border border-emerald-100 bg-emerald-50/40 rounded-lg p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-sm truncate">{s.subsidiary_name}</div>
              <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded">SCALING</span>
            </div>
            <div className="text-[10px] text-gray-600 dark:text-gray-400 mt-0.5">{s.jurisdiction} {s.ein && `• EIN ${s.ein}`}</div>
            {s.equity_allocation_json && Object.keys(s.equity_allocation_json).length > 0 && (
              <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Studio: {s.equity_allocation_json.studio_pct}% • Founders: {s.equity_allocation_json.founders_pct}%</div>
            )}
            {s.post_spinout_dashboard_url && (
              <a href={s.post_spinout_dashboard_url} className="text-[10px] text-violet-600 hover:underline">Open dashboard →</a>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------- Subcomponents ----------

// Task #10 — persistent, recoverable fallback shown when the dashboard payload
// fails to load or comes back malformed. Replaces the old `return null` (a
// silent white blank) and the bare error <div>. Always actionable: retry the
// fetch in-place, or hard-reload /studio.
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

function Card({ title, icon: Icon, link, linkLabel, children }) {
  return (
    <div data-card className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2"><Icon size={16} className="text-violet-600 dark:text-violet-400" /> {title}</h3>
        {link && <Link to={link} className="text-xs text-violet-600 dark:text-violet-400 hover:text-violet-700 flex items-center gap-1">{linkLabel} <ChevronRight size={12} /></Link>}
      </div>
      {children}
    </div>
  );
}

function PriorityDot({ p }) {
  const c = p === 'high' ? 'bg-red-500' : p === 'medium' ? 'bg-amber-500' : 'bg-gray-400';
  return <span className={`w-2 h-2 rounded-full ${c} flex-shrink-0`} />;
}

function RoleBadge({ role }) {
  // Task #81 — investors get their own indigo badge instead of the gray fallback.
  const styles = {
    admin: 'bg-violet-600 text-white',
    partner: 'bg-blue-100 text-blue-700',
    founder: 'bg-emerald-100 text-emerald-700',
    investor: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  };
  return <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${styles[role] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'}`}>{role}</span>;
}

function NotifDropdown({ items, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-lg z-50 max-h-96 overflow-y-auto">
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-800 font-semibold text-sm flex items-center gap-2 dark:text-gray-100"><Bell size={14} /> Recent Activity</div>
        {(!items || items.length === 0) ? (
          <div className="text-xs text-gray-500 dark:text-gray-400 text-center py-6">No recent activity.</div>
        ) : items.map((n, i) => (
          <div key={i} className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800">
            <div className="flex items-start gap-2">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${n.kind === 'commission' ? 'bg-emerald-500' : 'bg-violet-500'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-900 dark:text-gray-100 truncate">{n.title}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <span>{n.kind === 'commission' ? '💰' : '🤝'} {n.kind}</span>
                  {n.amount_cents != null && <span className="font-bold text-emerald-600">+${(n.amount_cents/100).toFixed(2)}</span>}
                  <span>{new Date(n.created_at).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------- Re-exported helpers used by other pages ----------

function StatusBadge({ status }) {
  const styles = {
    intake: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
    scoring: 'bg-amber-100 text-amber-700',
    tier_1: 'bg-emerald-100 text-emerald-700',
    tier_2: 'bg-blue-100 text-blue-700',
    rejected: 'bg-red-100 text-red-700',
    spinout: 'bg-violet-100 text-violet-700',
    active: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-medium ${styles[status] || styles.intake}`}>
      {status?.replace('_', ' ')}
    </span>
  );
}

function WeekBadge({ week }) {
  if (!week || week === 'complete') return week === 'complete' ? <span className="text-[10px] text-emerald-400">Complete</span> : null;
  const num = week.replace('week_', 'W');
  return <span className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{num}</span>;
}

export { StatusBadge, WeekBadge };

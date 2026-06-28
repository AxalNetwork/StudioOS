import React, { useEffect, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import InfoStrip from '../components/InfoStrip';
import { Link } from 'react-router-dom';
import { Bell, RefreshCw, Loader2, Briefcase, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import SemanticSearch from '../components/SemanticSearch';
import InvestorTrialBanner from '../components/InvestorTrialBanner';
import PersonalAdvisor from '../components/advisor/PersonalAdvisor';
import ProfileFitSection from '../components/profile/ProfileFitSection';
// Task #6 (IF) — first-login product tour (the onboarding checklist panel
// was removed 2026-05-22: signup flow already runs the persona chatbot and
// the page already surfaces the Personal Advisor, so the checklist
// duplicated guidance the user already had).
import ProductTour from '../components/ProductTour';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [error, setError] = useState('');
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
    } catch (e) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);

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
    load(true);
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-20 justify-center">
      <Loader2 className="animate-spin" size={16} /> Loading your studio…
    </div>
  );
  if (error) return <div className="bg-red-50 border border-red-200 text-red-700 rounded p-4 text-sm">{error}</div>;
  if (!data) return null;

  const { user, operator_workspace, notifications, role_view } = data;

  const isOperator = role_view === 'founder' || role_view === 'admin' || (operator_workspace?.assigned_tasks?.length > 0);
  const unreadNotifs = notifications?.length || 0;

  return (
    <div className="space-y-6">
      {googleNotice && (
        <InfoStrip variant="info" inline={false} onDismiss={() => setGoogleNotice(false)}>
          <strong>You're signed in with Google.</strong> Signing out of Axal VC will not
          sign you out of Google globally — if you're on a shared device, also sign
          out of your Google account in this browser. You can manage this anytime
          under <Link to="/settings/security" className="underline">Settings → Security → Connected accounts</Link>.
        </InfoStrip>
      )}
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Welcome back, {user.name?.split(' ')[0] || user.email.split('@')[0]}</h1>
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

      {/* Task #12 (AC-3) — Personal Advisor replaces the legacy persona tile. */}
      <PersonalAdvisor />

      {/* Task #20 — Best-Fit: skills/values/archetype/completion + matches range. */}
      <ProfileFitSection />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {isOperator && operator_workspace?.assigned_tasks?.length > 0 && (
            <Card title="My Studio Ops Tasks" icon={Briefcase} link="/studio-ops" linkLabel="Open Studio Ops">
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {operator_workspace.assigned_tasks.slice(0, 6).map(t => (
                  <div key={t.id} className="py-2 flex items-center gap-3 text-sm">
                    <PriorityDot p={t.priority} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{t.title}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{t.workflow_title} • {t.type}</div>
                    </div>
                    <span className="text-[10px] uppercase text-gray-500 dark:text-gray-400">{t.status}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <IndependentSubsidiariesWidget />
        </div>
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
  const styles = { admin: 'bg-violet-600 text-white', partner: 'bg-blue-100 text-blue-700', founder: 'bg-emerald-100 text-emerald-700' };
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

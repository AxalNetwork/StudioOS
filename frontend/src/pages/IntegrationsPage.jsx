import React, { useEffect, useMemo, useState } from 'react';
import {
  Plug, Plus, RefreshCw, Trash2, FileText, X, AlertCircle, Check,
  ExternalLink, Webhook, Database, Shield, Calendar, Cloud, PieChart,
  MessageSquare, PenTool, Network, Building2, Lock, Bell, Sparkles,
  Mail, Send,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/useToast';
import { useEscapeClose } from '../components/useEscapeClose';
import { safeReadJSON, safeWriteJSON } from '../lib/storage';
import { parseLinkedInCsv, PENDING_LINKEDIN_IMPORT_KEY } from '../lib/linkedinCsv';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuthSync';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import Skeleton from '../components/Skeleton';

// lucide-react in this repo predates the `Linkedin` glyph, so we ship
// a tiny inline SVG (same approach as the Twitter glyph in
// ReferEarnPage.jsx). Sized + coloured via currentColor so it matches
// the surrounding tile typography.
const Linkedin = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.024-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.049c.476-.9 1.637-1.85 3.37-1.85 3.602 0 4.268 2.37 4.268 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.778 13.019H3.555V9h3.56v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);

const ICON_MAP = {
  Building2, Calendar, Cloud, PieChart, MessageSquare, PenTool, Database,
  Network, Webhook, Plug,
};

const TIER_PILL = {
  free:   { label: 'Free',   cls: 'bg-gray-100 text-gray-700 border border-gray-200' },
  growth: { label: 'Growth', cls: 'bg-violet-50 text-violet-700 border border-violet-200' },
  studio: { label: 'Studio', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
};

const STATUS_PILL = {
  active:       'bg-emerald-100 text-emerald-700',
  paused:       'bg-amber-100 text-amber-700',
  error:        'bg-red-100 text-red-700',
  disconnected: 'bg-gray-100 text-gray-600',
};

const BYPASS_ROLES = new Set(['admin', 'partner', 'investor', 'mentor']);

function ProviderIcon({ name, size = 18 }) {
  const Icon = ICON_MAP[name] || Plug;
  return <Icon size={size} />;
}

export default function IntegrationsPage({ embedded = false }) {
  const [providers, setProviders] = useState([]);     // registry, includes tier_locked
  const [items, setItems] = useState([]);             // user's connections
  const [waitlist, setWaitlist] = useState([]);       // user's waitlist entries
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connectFor, setConnectFor] = useState(null);
  const [logsFor, setLogsFor] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  // Task #70 — Google (Calendar + Gmail / Continue with Google) and
  // LinkedIn (OIDC + CSV import) tiles. These don't sit in the
  // backend REGISTRY because they wire to first-party routes
  // (`/api/calendar/google/*`, `/api/linkedin/*`) — calendar tokens
  // are the single source of truth per replit.md, so we render
  // synthetic tiles instead of duplicating the providers contract.
  const [googleStatus, setGoogleStatus] = useState(null);
  const [linkedinStatus, setLinkedinStatus] = useState(null);
  // Outlook / Microsoft 365 — wires to /api/calendar/microsoft/* via
  // the same synthetic-tile pattern as Google. Backend has full
  // OAuth + token store already; only the tile was missing.
  const [microsoftStatus, setMicrosoftStatus] = useState(null);
  const [microsoftTileError, setMicrosoftTileError] = useState(null);
  // Telegram — there is no per-user connection state, just a request-
  // to-join queue. We fetch the channels visible to the caller's role
  // so the tile can say WHICH channel they'll be joining.
  const [telegramChannels, setTelegramChannels] = useState(null);
  const [telegramRequested, setTelegramRequested] = useState(false);
  const [telegramTileError, setTelegramTileError] = useState(null);
  // One-shot return-flash from the OAuth round-trip cookie redirect.
  // Parsed from query params on mount, then the URL is cleaned so a
  // refresh doesn't keep replaying the banner.
  const [returnFlash, setReturnFlash] = useState(null);
  // Task #70 — per-tile inline error/warn slots so OAuth failures
  // surface ON the tile that owns them, not as a generic banner
  // somewhere up the page. `{ kind: 'error'|'warn', text }`.
  const [googleTileError, setGoogleTileError] = useState(null);
  const [linkedinTileError, setLinkedinTileError] = useState(null);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  // Task #2 — HubSpot pipeline picker modal target.
  const [configFor, setConfigFor] = useState(null);
  const { toast, showToast } = useToast(2500);
  const navigate = useNavigate();

  // Task #18 — `bypassesTier` lets admin/partner/investor/mentor unlock
  // tier-gated providers, so we MUST read the live AuthProvider role
  // (re-fetched from /api/auth/me on every navigation) instead of the
  // cached localStorage user. Otherwise a former admin who was just
  // demoted keeps seeing tier-locked providers as connectable until a
  // hard refresh. localStorage stays only as a first-paint fallback
  // while the auth context is hydrating.
  const { role: liveRole } = useAuth();
  const me = safeReadJSON('user') || {};
  const role = (liveRole || me.role || '').toLowerCase();
  const bypassesTier = BYPASS_ROLES.has(role);

  // Task #8 (AN): distinguish a hard load failure (5xx, network) from
  // an inline action error. A hard failure replaces the whole page with
  // an inline "Couldn't load integrations — Retry" panel rather than a
  // dismissable banner, since none of the sections can render without
  // the catalogue.
  const [loadError, setLoadError] = useState('');
  const refresh = async () => {
    try {
      setError('');
      setLoadError('');
      const [av, mine, wl, gs, ls, ms, tg] = await Promise.all([
        api.integrationsAvailable(),
        api.integrationsList(),
        api.integrationsWaitlist().catch(() => ({ items: [] })),
        // Google/LinkedIn/Microsoft status are best-effort — a missing/legacy
        // worker must not collapse the marketplace into an error.
        api.googleCalStatus().catch(() => ({ configured: false, connected: false })),
        api.linkedinStatus().catch(() => ({ configured: false, connected: false })),
        api.microsoftCalStatus().catch(() => ({ configured: false, connected: false })),
        api.telegramJoinChannels().catch(() => ({ channels: [], default_slug: null })),
      ]);
      setProviders(av.providers || []);
      setItems(mine.items || []);
      setWaitlist(wl.items || []);
      setGoogleStatus(gs || null);
      setLinkedinStatus(ls || null);
      setMicrosoftStatus(ms || null);
      setTelegramChannels(tg || null);
    } catch (e) {
      const status = Number(e?.status) || 0;
      if (status >= 500 || status === 0) {
        setLoadError(e.message || "Couldn't load integrations.");
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  // Task #70 — one-shot return-flash from the OAuth round-trip.
  // The callback redirects to /integrations with one of:
  //   ?google=connected                          → success on Google tile
  //   ?google=connected&warn=google_email_mismatch&google_email=… (legacy /calendar flow only)
  //   ?google=error&reason=email_mismatch&google_email=… → INLINE tile error
  //   ?google=error&reason=email_unverified&google_email=…
  //   ?google=error&reason=<bucket>              → INLINE tile error
  //   ?linkedin=connected                        → success on LinkedIn tile
  //   ?linkedin=error&linkedin_error=<code>      → INLINE tile error
  // We parse + clean the URL so a refresh doesn't keep replaying. Email
  // mismatch is routed to the tile-local error slot (not the top banner)
  // so the user sees exactly which connection failed and why.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    let tileGoogle = null, tileLi = null, topFlash = null;
    if (p.get('google') === 'connected') {
      const warn = p.get('warn');
      if (warn === 'google_email_mismatch') {
        // Legacy /calendar flow: connection succeeded but sign-in wasn't linked.
        const ge = p.get('google_email') || '';
        tileGoogle = {
          kind: 'warn',
          text: ge
            ? `Connected, but the Google account ${ge} doesn't match your StudioOS email — "Continue with Google" sign-in was not linked.`
            : `Connected, but the Google account doesn't match your StudioOS email — "Continue with Google" sign-in was not linked.`,
        };
      } else {
        topFlash = { type: 'success', text: 'Google connected — Calendar, Gmail, and "Continue with Google" sign-in are now enabled.' };
      }
    } else if (p.get('google') === 'error') {
      const reason = p.get('reason') || 'unknown';
      const ge = p.get('google_email') || '';
      if (reason === 'email_mismatch') {
        tileGoogle = {
          kind: 'error',
          text: ge
            ? `That Google account (${ge}) doesn't match your StudioOS email. Sign in to Google with the same email and try again — nothing was saved.`
            : `That Google account doesn't match your StudioOS email. Sign in to Google with the same email and try again — nothing was saved.`,
        };
      } else if (reason === 'google_already_linked_other_user') {
        // Task #1 — collision guard: same Google account is already
        // attached to a different Axal VC user. Nothing was written.
        tileGoogle = {
          kind: 'error',
          text: ge
            ? `That Google account (${ge}) is already connected to another Axal VC user — disconnect it there first, then try again.`
            : `That Google account is already connected to another Axal VC user — disconnect it there first, then try again.`,
        };
      } else if (reason === 'email_unverified') {
        tileGoogle = {
          kind: 'error',
          text: ge
            ? `Google reports ${ge} as unverified. Verify the address with Google, then try connecting again — nothing was saved.`
            : `Google reports your account email as unverified. Verify it with Google, then try connecting again — nothing was saved.`,
        };
      } else {
        tileGoogle = { kind: 'error', text: `Google connection failed (${reason}). Please try again.` };
      }
    }
    if (p.get('linkedin') === 'connected') {
      topFlash = { type: 'success', text: 'LinkedIn connected.' };
    } else if (p.get('linkedin') === 'error') {
      tileLi = { kind: 'error', text: `LinkedIn connection failed (${p.get('linkedin_error') || 'unknown'}). Please try again.` };
    }
    if (tileGoogle || tileLi || topFlash) {
      if (tileGoogle) setGoogleTileError(tileGoogle);
      if (tileLi) setLinkedinTileError(tileLi);
      if (topFlash) setReturnFlash(topFlash);
      ['google', 'warn', 'google_email', 'reason', 'linkedin', 'linkedin_error']
        .forEach(k => p.delete(k));
      const qs = p.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }, []);

  const connectGoogle = async () => {
    setGoogleTileError(null);
    try {
      const res = await api.googleCalConnect({ return_to: 'integrations' });
      const url = res?.redirect_url || res?.auth_url;
      if (!url) throw new Error(res?.error?.message || 'Could not start Google connect.');
      window.location.href = url;
    } catch (e) { setGoogleTileError({ kind: 'error', text: e?.message || 'Could not start Google connect.' }); }
  };
  const disconnectGoogle = async () => {
    if (!confirm('Disconnect Google? This removes Calendar + Gmail access AND unlinks "Continue with Google" sign-in. You can reconnect at any time.')) return;
    setGoogleTileError(null);
    try { await api.googleCalDisconnect(); await refresh(); showToast('Google disconnected.'); }
    catch (e) { setGoogleTileError({ kind: 'error', text: e?.message || 'Could not disconnect Google.' }); }
  };
  const connectLinkedin = async () => {
    setLinkedinTileError(null);
    try {
      const res = await api.linkedinOAuthStart({ return_to: 'integrations' });
      if (!res?.authorize_url) throw new Error(res?.detail || 'Could not start LinkedIn connect.');
      window.location.href = res.authorize_url;
    } catch (e) { setLinkedinTileError({ kind: 'error', text: e?.message || 'Could not start LinkedIn connect.' }); }
  };
  const disconnectLinkedin = async () => {
    if (!confirm('Disconnect LinkedIn? Any imported CSV contacts already saved to Refer & Earn stay there.')) return;
    setLinkedinTileError(null);
    try { await api.linkedinDisconnect(); await refresh(); showToast('LinkedIn disconnected.'); }
    catch (e) { setLinkedinTileError({ kind: 'error', text: e?.message || 'Could not disconnect LinkedIn.' }); }
  };

  const connectMicrosoft = async () => {
    setMicrosoftTileError(null);
    try {
      const res = await api.microsoftCalConnect({ return_to: 'integrations' });
      const url = res?.redirect_url || res?.auth_url || res?.authorize_url;
      if (!url) throw new Error(res?.error?.message || 'Could not start Microsoft connect.');
      window.location.href = url;
    } catch (e) { setMicrosoftTileError({ kind: 'error', text: e?.message || 'Could not start Microsoft connect.' }); }
  };
  const disconnectMicrosoft = async () => {
    if (!confirm('Disconnect Microsoft 365? Outlook calendar sync will stop. You can reconnect at any time.')) return;
    setMicrosoftTileError(null);
    try { await api.microsoftCalDisconnect(); await refresh(); showToast('Microsoft 365 disconnected.'); }
    catch (e) { setMicrosoftTileError({ kind: 'error', text: e?.message || 'Could not disconnect Microsoft 365.' }); }
  };

  const requestTelegramJoin = async () => {
    setTelegramTileError(null);
    const defaultSlug = telegramChannels?.default_slug;
    if (!defaultSlug) {
      setTelegramTileError({ kind: 'error', text: 'No Telegram channel is available for your role yet.' });
      return;
    }
    try {
      await api.telegramJoinRequest({ channel_slug: defaultSlug });
      setTelegramRequested(true);
      showToast('Request sent — an admin will message you the invite link.');
    } catch (e) {
      const msg = e?.message || 'Could not send the request.';
      const friendly = /slack_webhook_unconfigured/i.test(msg)
        ? 'The studio Slack inbox isn\'t configured on this deployment yet — please ping an admin directly.'
        : msg;
      setTelegramTileError({ kind: 'error', text: friendly });
    }
  };
  // Task #70 — hand-off after the CSV modal parses a file. We stash the
  // parsed rows in localStorage under a known key and navigate to /refer,
  // where the existing send-invites flow picks them up on mount. Keeping
  // the actual send pipeline in one place avoids duplicating the
  // mailto-template + per-row personalisation logic.
  const onCsvImported = (rows) => {
    try {
      safeWriteJSON(PENDING_LINKEDIN_IMPORT_KEY, { rows, at: Date.now() });
    } catch { /* storage quota etc — best-effort */ }
    setCsvModalOpen(false);
    showToast(`Imported ${rows.length} contacts. Opening Refer & Earn…`);
    setTimeout(() => navigate('/refer'), 600);
  };

  const onConnect = async (form) => {
    setBusy(true);
    try {
      await api.integrationsConnect(form);
      setConnectFor(null);
      await refresh();
      showToast('Integration connected.');
    } catch (e) {
      // 402 path is auto-handled by api.js (PaywallModal opens). For
      // everything else, RE-THROW so ConnectModal can surface the
      // message inline in its own red banner (Task #17 — page-level
      // error is hidden behind the modal overlay).
      if (e.status !== 402) throw e;
    } finally {
      setBusy(false);
    }
  };

  const onSync = async (uid) => {
    try {
      await api.integrationsSync(uid);
      await refresh();
      showToast('Sync triggered.');
    } catch (e) {
      if (e.status !== 402) setError(e.message);
    }
  };

  const onDisconnect = async (uid) => {
    if (!confirm('Disconnect this integration? Stored credentials will be removed.')) return;
    try {
      await api.integrationsDisconnect(uid);
      await refresh();
      showToast('Integration removed.');
    } catch (e) { setError(e.message); }
  };

  const openLogs = async (integ) => {
    setLogsFor(integ);
    setLogsLoading(true);
    setLogs([]);
    try {
      const res = await api.integrationsLogs(integ.uid, { limit: 100 });
      setLogs(res.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLogsLoading(false);
    }
  };

  const onJoinWaitlist = async (provider) => {
    try {
      await api.integrationsWaitlistJoin({ provider_key: provider.key });
      await refresh();
      showToast(`We'll let you know when ${provider.display_name} is ready.`);
    } catch (e) { setError(e.message); }
  };

  const onLeaveWaitlist = async (provider) => {
    try {
      await api.integrationsWaitlistLeave(provider.key);
      await refresh();
      showToast('Removed from waitlist.');
    } catch (e) { setError(e.message); }
  };

  const connectedByProvider = useMemo(() => {
    const m = {};
    for (const it of items) m[it.provider_key] = it;
    return m;
  }, [items]);

  const waitlistKeys = useMemo(() => new Set(waitlist.map(w => w.provider_key)), [waitlist]);

  const sections = useMemo(() => {
    const live = [];
    const coming = [];
    for (const p of providers) {
      if (p.status === 'coming_soon' || !p.has_implementation) coming.push(p);
      // Skip providers the user has already connected — they render in
      // the "Connected" section above, so listing them again in
      // "Available" makes the same provider look like it's both
      // connected AND unconnected (Calendly bug).
      else if (!connectedByProvider[p.key]) live.push(p);
    }
    return { live, coming };
  }, [providers, connectedByProvider]);

  if (loading) {
    return (
      <div className={embedded ? '' : 'p-6 max-w-6xl mx-auto'} data-density-target>
        {!embedded && <Skeleton h={28} w="33%" className="mb-6" />}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton.Card key={i} />)}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={embedded ? '' : 'p-6 max-w-6xl mx-auto'} data-density-target>
        {!embedded && (
          <header className="flex items-start gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center"><Plug size={20} /></div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 leading-snug">
              Integrations <span className="text-gray-500 dark:text-gray-400 font-normal">— Connect your CRM, legal providers, and data feeds. Push deals out, receive webhooks back.</span>
            </h1>
          </header>
        )}
        <ErrorState
          message={`Couldn't load integrations — ${loadError}`}
          onRetry={() => { setLoading(true); refresh(); }}
          supportTopic="integrations"
        />
      </div>
    );
  }

  return (
    <div className={embedded ? '' : 'p-6 max-w-6xl mx-auto'} data-density-target data-testid="integrations-page">
      {!embedded && (
        <header className="flex items-start gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center"><Plug size={20} /></div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 leading-snug">
            Integrations <span className="text-gray-500 dark:text-gray-400 font-normal">— Connect your CRM, legal providers, and data feeds. Push deals out, receive webhooks back.</span>
          </h1>
        </header>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2 flex items-center gap-2">
          <AlertCircle size={14} /> {error}
          <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-700"><X size={14} /></button>
        </div>
      )}
      {toast && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg px-4 py-2 flex items-center gap-2">
          <Check size={14} /> {toast}
        </div>
      )}
      {returnFlash && (
        <div
          data-testid="integrations-return-flash"
          data-flash-type={returnFlash.type}
          className={`mb-4 text-sm rounded-lg px-4 py-2 flex items-start gap-2 border ${
            returnFlash.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : returnFlash.type === 'warn'  ? 'bg-amber-50 border-amber-200 text-amber-900'
            :                                'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {returnFlash.type === 'success' ? <Check size={14} className="mt-0.5" />
           : <AlertCircle size={14} className="mt-0.5" />}
          <span className="flex-1">{returnFlash.text}</span>
          <button onClick={() => setReturnFlash(null)} className="opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {/* Identity & Calendar — Task #70 synthetic tiles wired to
          /api/calendar/google and /api/linkedin (calendar tokens are
          the single source of truth; LinkedIn handles OIDC + CSV). */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Identity &amp; Calendar</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ExternalProviderCard
            testId="google"
            icon={Mail}
            title="Google — Calendar &amp; Gmail"
            type="identity / calendar"
            description="Sync your Google Calendar, read Gmail-linked event invites, and enable Continue with Google sign-in."
            capabilities={['Calendar', 'Gmail', 'Sign in with Google']}
            status={googleStatus}
            connectedLabel={googleStatus?.google_email}
            onConnect={connectGoogle}
            onDisconnect={disconnectGoogle}
            inlineError={googleTileError}
            onDismissError={() => setGoogleTileError(null)}
          />
          <ExternalProviderCard
            testId="linkedin"
            icon={Linkedin}
            title="LinkedIn — Contacts"
            type="identity / contacts"
            description="Sign in with LinkedIn to verify your identity, then upload your Connections.csv to import contacts for referrals."
            capabilities={['OIDC sign-in', 'CSV contact import']}
            status={linkedinStatus}
            connectedLabel={linkedinStatus?.linkedin_email}
            onConnect={connectLinkedin}
            onDisconnect={disconnectLinkedin}
            inlineError={linkedinTileError}
            onDismissError={() => setLinkedinTileError(null)}
            secondaryAction={{ label: 'Import contacts (CSV)', onClick: () => setCsvModalOpen(true) }}
          />
          <ExternalProviderCard
            testId="microsoft"
            icon={Calendar}
            title="Microsoft 365 — Outlook Calendar"
            type="calendar"
            description="Two-way sync with Outlook / Microsoft 365 Calendar so Axal VC sessions land on your work calendar."
            capabilities={['Calendar', 'Two-way sync']}
            status={microsoftStatus}
            connectedLabel={microsoftStatus?.microsoft_email}
            onConnect={connectMicrosoft}
            onDisconnect={disconnectMicrosoft}
            inlineError={microsoftTileError}
            onDismissError={() => setMicrosoftTileError(null)}
          />
          <TelegramJoinCard
            channels={telegramChannels}
            requested={telegramRequested}
            inlineError={telegramTileError}
            onDismissError={() => setTelegramTileError(null)}
            onRequest={requestTelegramJoin}
          />
        </div>
      </section>

      {/* Connected */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
          Connected <span className="text-xs font-normal text-gray-500">({items.length})</span>
        </h2>
        {items.length === 0 ? (
          <EmptyState
            icon={Plug}
            title="No integrations connected yet"
            body="Pick one from the marketplace below to start syncing deals, contacts, and calendar."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {items.map(it => {
              const desc = providers.find(p => p.key === it.provider_key);
              return (
                <div key={it.uid} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
                      <ProviderIcon name={desc?.icon} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{it.display_name || it.provider_key}</div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_PILL[it.status] || 'bg-gray-100 text-gray-600'}`}>{it.status}</span>
                        {desc?.tier && desc.tier !== 'free' && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${TIER_PILL[desc.tier].cls}`}>{TIER_PILL[desc.tier].label}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 capitalize">{(it.integration_type || '').replace(/_/g, ' ')}</div>
                      {it.api_key_preview && (
                        <div className="text-[11px] text-gray-500 font-mono mt-1">key: {it.api_key_preview}</div>
                      )}
                      {it.external_account_name && (
                        <div className="text-[11px] text-gray-500 mt-1">account: {it.external_account_name}</div>
                      )}
                      {!!(it.capabilities || []).length && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {it.capabilities.map(cap => (
                            <span key={cap} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">{cap}</span>
                          ))}
                        </div>
                      )}
                      {it.last_synced_at && (
                        <div className="text-[11px] text-gray-500 mt-1">last synced {new Date(it.last_synced_at).toLocaleString()}</div>
                      )}
                      {it.last_error && (
                        it.last_error.startsWith('rate_limited') ? (() => {
                          // last_error format: `rate_limited[:<epoch_ms>]`. The
                          // epoch suffix is written by the Crunchbase provider
                          // so the UI can render an exact reset time instead
                          // of a vague "tomorrow".
                          const tail = it.last_error.split(':')[1] || '';
                          const epoch = Number(tail);
                          const resetAt = Number.isFinite(epoch) && epoch > 0
                            ? new Date(epoch).toLocaleString()
                            : null;
                          return (
                            <div className="mt-2 text-[11px] flex items-start gap-1.5 px-2 py-1.5 rounded border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200">
                              <AlertCircle size={11} className="mt-0.5 shrink-0" />
                              <span>
                                {it.provider_key === 'crunchbase'
                                  ? 'Crunchbase daily limit reached — try again tomorrow.'
                                  : 'Daily API limit reached for this connection. New lookups will resume after the reset.'}
                                {resetAt && (
                                  <span className="block mt-0.5 text-amber-700 dark:text-amber-300">Resumes at {resetAt}.</span>
                                )}
                              </span>
                            </div>
                          );
                        })() : (
                          <div className="text-[11px] text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={10} /> {it.last_error}</div>
                        )
                      )}
                    </div>
                  </div>
                  {it.provider_key === 'hubspot' && it.config && (it.config.portal_id || it.config.pipeline_label) && (
                    <div className="text-[11px] text-gray-500 mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
                      {it.config.portal_id && <span>portal #{it.config.portal_id}</span>}
                      {it.config.pipeline_label && <span>pipeline: {it.config.pipeline_label}</span>}
                    </div>
                  )}
                  {it.provider_key === 'salesforce' && it.config && (
                    <div className="text-[11px] text-gray-500 mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>{it.config.is_sandbox ? 'Sandbox' : 'Production'}</span>
                      {it.config.username && <span>{it.config.username}</span>}
                      {it.config.organization_id && <span>org #{it.config.organization_id}</span>}
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                    {/* Update opens the ConnectModal in update-mode so users can
                        rotate credentials / change config without disconnecting
                        first. Required since the marketplace section below now
                        excludes already-connected providers (dedupe fix). */}
                    {desc && (
                      <button onClick={() => setConnectFor(desc)} className="text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-2 py-1">
                        <RefreshCw size={12} /> Update
                      </button>
                    )}
                    {it.provider_key === 'hubspot' && (
                      <button onClick={() => setConfigFor(it)} className="text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-2 py-1">
                        <PieChart size={12} /> Pipeline
                      </button>
                    )}
                    {it.provider_key === 'salesforce' && (
                      <button onClick={() => setConfigFor(it)} className="text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-2 py-1">
                        <PieChart size={12} /> Mapping
                      </button>
                    )}
                    <button onClick={() => openLogs(it)} className="text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-2 py-1">
                      <FileText size={12} /> Logs
                    </button>
                    <button onClick={() => onSync(it.uid)} className="text-xs text-violet-600 hover:text-violet-700 flex items-center gap-1 px-2 py-1">
                      <RefreshCw size={12} /> Sync
                    </button>
                    <button onClick={() => onDisconnect(it.uid)} className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1 px-2 py-1">
                      <Trash2 size={12} /> Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Available marketplace */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Available</h2>
        {sections.live.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 text-sm text-gray-500 text-center">
            All current providers are still rolling out — see Coming Soon below.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sections.live.map(p => (
              <ProviderCard
                key={p.key}
                provider={p}
                connected={!!connectedByProvider[p.key]}
                bypassesTier={bypassesTier}
                onConnect={() => setConnectFor(p)}
              />
            ))}
          </div>
        )}
        <p className="text-[11px] text-gray-500 mt-3 flex items-center gap-1">
          <Shield size={11} /> All API keys, OAuth tokens, and webhook secrets are encrypted at rest with AES-GCM.
        </p>
      </section>

      {/* Coming Soon */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
          <Sparkles size={14} className="text-violet-500" /> Coming soon
        </h2>
        {sections.coming.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 text-sm text-gray-500 text-center">
            Nothing on the horizon yet — check back soon.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sections.coming.map(p => (
              <ComingSoonCard
                key={p.key}
                provider={p}
                joined={waitlistKeys.has(p.key)}
                onJoin={() => onJoinWaitlist(p)}
                onLeave={() => onLeaveWaitlist(p)}
              />
            ))}
          </div>
        )}
      </section>

      {connectFor && (
        <ConnectModal
          provider={connectFor}
          existing={connectedByProvider[connectFor.key]}
          bypassesTier={bypassesTier}
          onClose={() => setConnectFor(null)}
          onSubmit={onConnect}
          busy={busy}
        />
      )}

      {configFor && configFor.provider_key === 'hubspot' && (
        <HubspotConfigModal
          integration={configFor}
          onClose={() => setConfigFor(null)}
          onSaved={async () => { setConfigFor(null); await refresh(); showToast('Pipeline saved.'); }}
        />
      )}

      {configFor && configFor.provider_key === 'salesforce' && (
        <SalesforceConfigModal
          integration={configFor}
          onClose={() => setConfigFor(null)}
          onSaved={async () => { setConfigFor(null); await refresh(); showToast('Mapping saved.'); }}
        />
      )}

      {logsFor && (
        <LogsModal
          integration={logsFor}
          logs={logs}
          loading={logsLoading}
          onClose={() => { setLogsFor(null); setLogs([]); }}
        />
      )}

      {csvModalOpen && (
        <LinkedInCsvImportModal
          onClose={() => setCsvModalOpen(false)}
          onImported={onCsvImported}
        />
      )}
    </div>
  );
}

function ProviderCard({ provider, connected, bypassesTier, onConnect }) {
  const tierLocked = !bypassesTier && provider.tier_locked;
  const beta = provider.status === 'beta';
  return (
    <div data-testid="integration-provider-card" data-provider-key={provider.key} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 flex flex-col">
      <div className="flex items-start gap-3 mb-2">
        <div className="w-10 h-10 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 flex items-center justify-center">
          <ProviderIcon name={provider.icon} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="font-medium text-gray-900 dark:text-gray-100">{provider.display_name}</div>
            {beta && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">Beta</span>}
            {!bypassesTier && provider.tier !== 'free' && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${TIER_PILL[provider.tier].cls}`}>{TIER_PILL[provider.tier].label}</span>
            )}
          </div>
          <div className="text-[11px] text-gray-500 uppercase tracking-wide capitalize">{provider.integration_type.replace(/_/g, ' ')}</div>
        </div>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400 flex-1">{provider.description}</p>
      {!!provider.capabilities?.length && (
        <div className="flex flex-wrap gap-1 mt-2">
          {provider.capabilities.map(cap => (
            <span key={cap} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">{cap}</span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
        {provider.docs_url ? (
          <a href={provider.docs_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-500 hover:text-violet-600 flex items-center gap-1">
            Docs <ExternalLink size={10} />
          </a>
        ) : <span />}
        <button
          onClick={onConnect}
          className={`text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${
            connected ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200'
            : tierLocked ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
            : 'bg-violet-600 text-white hover:bg-violet-700'
          }`}
        >
          {connected ? <><RefreshCw size={12} /> Update</>
            : tierLocked ? <><Lock size={12} /> Upgrade to connect</>
            : <><Plus size={12} /> Connect</>}
        </button>
      </div>
    </div>
  );
}

// Task #70 — synthetic tile for providers that wire to first-party
// routes (Google Calendar/Gmail, LinkedIn) rather than the integrations
// REGISTRY. Renders the same visual language as ProviderCard but talks
// to `/api/calendar/google` and `/api/linkedin` via custom handlers.
// Honors the missing-secrets disabled state via `status.configured`.
function ExternalProviderCard({
  testId, icon: Icon, title, type, description, capabilities,
  status, connectedLabel, onConnect, onDisconnect, secondaryAction,
  inlineError, onDismissError,
}) {
  // status may be null while the parallel fetch is in flight — treat
  // that as "loading" and disable the action so we don't kick off a
  // round-trip against a provider we haven't probed yet.
  const loading = status === null || status === undefined;
  const configured = !loading && status.configured !== false;
  const connected = !!status?.connected;
  return (
    <div
      data-testid="integration-external-card"
      data-provider-key={testId}
      data-connected={connected ? '1' : '0'}
      data-configured={configured ? '1' : '0'}
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 flex flex-col"
    >
      <div className="flex items-start gap-3 mb-2">
        <div className="w-10 h-10 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 flex items-center justify-center">
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="font-medium text-gray-900 dark:text-gray-100">{title}</div>
            {connected && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Connected</span>
            )}
            {!loading && !configured && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200 dark:border-gray-800" title="Server secrets are not configured on this deployment.">
                Not configured
              </span>
            )}
          </div>
          <div className="text-[11px] text-gray-500 uppercase tracking-wide">{type}</div>
        </div>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400 flex-1">{description}</p>
      {connectedLabel && (
        <div className="text-[11px] text-gray-500 mt-1">account: {connectedLabel}</div>
      )}
      {!!capabilities?.length && (
        <div className="flex flex-wrap gap-1 mt-2">
          {capabilities.map(cap => (
            <span key={cap} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">{cap}</span>
          ))}
        </div>
      )}
      {inlineError && (
        <div
          data-testid="integration-tile-error"
          data-tile-error-kind={inlineError.kind}
          className={`mt-2 text-[11px] rounded-md border px-2 py-1.5 flex items-start gap-1.5 ${
            inlineError.kind === 'warn'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span className="flex-1">{inlineError.text}</span>
          {onDismissError && (
            <button onClick={onDismissError} className="opacity-60 hover:opacity-100" aria-label="Dismiss"><X size={11} /></button>
          )}
        </div>
      )}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
        {/* secondaryAction is shown on a connected tile and may be either
            a link (href) or an in-place handler (onClick) — the LinkedIn
            CSV import opens a modal so we want an onClick. */}
        {secondaryAction && connected ? (
          secondaryAction.onClick ? (
            <button onClick={secondaryAction.onClick} className="text-[11px] text-violet-600 hover:text-violet-700 flex items-center gap-1">
              <FileText size={10} /> {secondaryAction.label}
            </button>
          ) : (
            <a href={secondaryAction.href} className="text-[11px] text-violet-600 hover:text-violet-700 flex items-center gap-1">
              {secondaryAction.label} <ExternalLink size={10} />
            </a>
          )
        ) : <span />}
        {connected ? (
          <button
            onClick={onDisconnect}
            className="text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-red-600 hover:bg-red-50"
          >
            <Trash2 size={12} /> Disconnect
          </button>
        ) : (
          <button
            onClick={onConnect}
            disabled={loading || !configured}
            title={!configured ? 'Server secrets are missing — ask an admin to configure this provider.' : undefined}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${
              loading || !configured
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-violet-600 text-white hover:bg-violet-700'
            }`}
          >
            <Plus size={12} /> Connect
          </button>
        )}
      </div>
    </div>
  );
}

// Telegram channel-join tile. Telegram bots can't add users to invite-only
// channels without prior interaction, so the only reliable path is a
// human-in-the-loop request: the user clicks "Request to join", the
// backend pings the studio Slack inbox, and an admin sends them the
// invite link out-of-band. The tile shows WHICH channel they'll be
// joining so the request is unambiguous.
function TelegramJoinCard({ channels, requested, inlineError, onDismissError, onRequest }) {
  const loading = channels === null || channels === undefined;
  const defaultChannel = (channels?.channels || []).find(c => c.slug === channels?.default_slug)
    || (channels?.channels || [])[0];
  const hasChannel = !!defaultChannel;
  return (
    <div
      data-testid="integration-external-card"
      data-provider-key="telegram"
      data-connected={requested ? '1' : '0'}
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 flex flex-col"
    >
      <div className="flex items-start gap-3 mb-2">
        <div className="w-10 h-10 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 flex items-center justify-center">
          <Send size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="font-medium text-gray-900 dark:text-gray-100">Telegram — Axal VC channels</div>
            {requested && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Requested</span>
            )}
          </div>
          <div className="text-[11px] text-gray-500 uppercase tracking-wide">community / broadcasts</div>
        </div>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400 flex-1">
        Get the invite link to your role's private Telegram channel for studio updates and broadcasts.
        {hasChannel && (
          <> You'll be requesting access to <span className="font-medium text-gray-900 dark:text-gray-100">{defaultChannel.label}</span>.</>
        )}
      </p>
      {inlineError && (
        <div
          data-testid="integration-tile-error"
          data-tile-error-kind={inlineError.kind}
          className={`mt-2 text-[11px] rounded-md border px-2 py-1.5 flex items-start gap-1.5 ${
            inlineError.kind === 'warn'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span className="flex-1">{inlineError.text}</span>
          {onDismissError && (
            <button onClick={onDismissError} className="opacity-60 hover:opacity-100" aria-label="Dismiss"><X size={11} /></button>
          )}
        </div>
      )}
      <div className="flex items-center justify-end mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
        {requested ? (
          <span className="text-xs text-emerald-700 flex items-center gap-1.5">
            <Check size={12} /> An admin will message you the invite link.
          </span>
        ) : (
          <button
            onClick={onRequest}
            disabled={loading || !hasChannel}
            title={!hasChannel ? 'No Telegram channel is available for your role.' : undefined}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${
              loading || !hasChannel
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-violet-600 text-white hover:bg-violet-700'
            }`}
          >
            <Send size={12} /> Request to join
          </button>
        )}
      </div>
    </div>
  );
}

// Task #70 — LinkedIn CSV import modal lives directly inside Settings →
// Integrations so users can preview and import their Connections.csv in
// place. After parsing we hand the rows off to /refer via
// PENDING_LINKEDIN_IMPORT_KEY (localStorage) so the existing referral
// send flow stays the single owner of the personalised-mailto + invite
// pipeline. Keeps responsibilities clean: Integrations imports, Refer
// sends. Max 2 MB file size mirrors the ReferEarnPage check.
function LinkedInCsvImportModal({ onClose, onImported }) {
  useEscapeClose(onClose);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = React.useRef(null);

  const handleFile = async (e) => {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      setError('File too large (max 2 MB). LinkedIn exports above this size are unusual — please trim before re-uploading.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = parseLinkedInCsv(text);
      if (parsed.length === 0) {
        setError('No emailed contacts found. LinkedIn only includes email for connections who chose to share theirs — you may need to invite them manually.');
        setRows(null);
      } else {
        setRows(parsed);
      }
    } catch (err) {
      setError('Could not parse the CSV: ' + (err?.message || 'unknown error'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" data-testid="linkedin-csv-modal" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Linkedin size={16} className="text-[#0a66c2]" />
            <h3 className="font-medium text-gray-900 dark:text-gray-100 text-sm">Import LinkedIn contacts</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Export your connections from LinkedIn: <span className="font-medium">Settings → Data privacy → Get a copy of your data → Connections</span>.
            Upload the <code className="text-[11px] bg-gray-100 dark:bg-gray-800 px-1 rounded">Connections.csv</code> file below.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            disabled={busy}
            data-testid="linkedin-csv-input"
            className="block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
          />
          {error && (
            <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-md px-2 py-1.5 flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
          {rows && rows.length > 0 && (
            <div data-testid="linkedin-csv-preview" className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
              <div className="text-[11px] px-3 py-2 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 flex items-center justify-between">
                <span><span className="font-semibold">{rows.length}</span> contacts ready to import</span>
                <span className="text-gray-500">showing first {Math.min(5, rows.length)}</span>
              </div>
              <table className="w-full text-[11px]">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500">
                  <tr><th className="text-left px-3 py-1.5 font-normal">Name</th><th className="text-left px-3 py-1.5 font-normal">Email</th></tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-3 py-1.5 text-gray-900 dark:text-gray-100 truncate max-w-[180px]">{r.name || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 truncate max-w-[220px]">{r.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="text-xs font-medium px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800">Cancel</button>
          <button
            onClick={() => rows && onImported(rows)}
            disabled={!rows || rows.length === 0}
            data-testid="linkedin-csv-import-btn"
            className={`text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${
              !rows || rows.length === 0
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-violet-600 text-white hover:bg-violet-700'
            }`}
          >
            <Check size={12} /> Import {rows ? `${rows.length} contacts` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

function ComingSoonCard({ provider, joined, onJoin, onLeave }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex flex-col opacity-90">
      <div className="flex items-start gap-3 mb-2">
        <div className="w-10 h-10 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex items-center justify-center">
          <ProviderIcon name={provider.icon} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="font-medium text-gray-900 dark:text-gray-100">{provider.display_name}</div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">Soon</span>
            {provider.tier !== 'free' && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${TIER_PILL[provider.tier].cls}`}>{TIER_PILL[provider.tier].label}</span>
            )}
          </div>
          <div className="text-[11px] text-gray-500 uppercase tracking-wide capitalize">{provider.integration_type.replace(/_/g, ' ')}</div>
        </div>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400 flex-1">{provider.description}</p>
      {!!provider.capabilities?.length && (
        <div className="flex flex-wrap gap-1 mt-2">
          {provider.capabilities.map(cap => (
            <span key={cap} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">{cap}</span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-end mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
        {joined ? (
          <button onClick={onLeave} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 flex items-center gap-1.5">
            <Check size={12} /> On the waitlist
          </button>
        ) : (
          <button onClick={onJoin} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 flex items-center gap-1.5">
            <Bell size={12} /> Notify me
          </button>
        )}
      </div>
    </div>
  );
}

function ConnectModal({ provider, existing, bypassesTier, onClose, onSubmit, busy }) {
  useEscapeClose(onClose);
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [displayName, setDisplayName] = useState(existing?.display_name || provider.display_name);
  const [configText, setConfigText] = useState(existing?.config ? JSON.stringify(existing.config, null, 2) : '');
  const [sfSandbox, setSfSandbox] = useState(false);
  const [err, setErr] = useState('');
  // HubSpot OAuth is gated behind an "Advanced" disclosure because the
  // public app is pending HubSpot Marketplace review — the PAT (Private
  // App access token) path is the only one that works on non-test
  // portals today. Defaults closed; clicking the link expands it.
  const [showAdvancedOauth, setShowAdvancedOauth] = useState(false);
  const tierLocked = !bypassesTier && provider.tier_locked;
  const isHubspotPatPrimary = provider.key === 'hubspot' && provider.auth_type === 'oauth2' && provider.supports_pat && !existing;

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    let config = {};
    if (configText.trim()) {
      try { config = JSON.parse(configText); }
      catch { setErr('Config must be valid JSON.'); return; }
    }
    try {
      await onSubmit({
        provider_key: provider.key,
        display_name: displayName,
        api_key: apiKey || undefined,
        webhook_secret: webhookSecret || undefined,
        config,
      });
    } catch (ex) {
      // Surface backend validation errors (e.g.
      // hubspot_invalid_private_app_token, hubspot_requires_oauth_code_or_pat)
      // inline in the modal's red banner so the user can correct and retry
      // without losing the open form.
      setErr(ex?.message || 'Connect failed.');
    }
  };

  const startOauth = async () => {
    setErr('');
    try {
      const params = provider.key === 'salesforce' ? { sandbox: sfSandbox ? '1' : '' } : {};
      const res = await api.integrationsOauthStart(provider.key, params);
      if (res.authorize_url) window.location.href = res.authorize_url;
    } catch (e) {
      setErr(e.message);
    }
  };

  const inputCls = "w-full text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-md px-3 py-2 focus:ring-2 focus:ring-violet-100 focus:border-violet-300 outline-none";

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-900">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">{existing ? 'Update' : 'Connect'} {provider.display_name}</h3>
            <p className="text-xs text-gray-500">{provider.description}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        {tierLocked ? (
          <div className="p-5">
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
              <Lock size={16} className="mt-0.5" />
              <div>
                <div className="font-medium">{TIER_PILL[provider.tier].label} plan required</div>
                <p className="text-xs text-amber-800 mt-1">Upgrade your subscription to connect {provider.display_name}.</p>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 px-4 py-2">Close</button>
              <a href="/billing" className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg">View plans</a>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
            <Field label="Display name">
              <input className={inputCls} value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </Field>
            {/* HubSpot: PAT is the primary path (see disclosure below). OAuth
                is moved into an "Advanced" toggle since the public app is
                pending HubSpot Marketplace review and the redirect URI on
                non-test portals fails. */}
            {isHubspotPatPrimary && (
              <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-xs text-violet-900">
                <p className="font-medium mb-1">Recommended: Private App access token</p>
                <p>
                  Create one in HubSpot → <strong>Settings → Integrations → Private Apps → Create private app</strong>.
                  Required scopes: <code className="bg-white px-1 rounded dark:bg-gray-900">crm.objects.deals.read/write</code>, <code className="bg-white px-1 rounded dark:bg-gray-900">crm.objects.contacts.read</code>.
                  Paste the token in the field below.
                </p>
              </div>
            )}
            {provider.auth_type === 'oauth2' && !existing && !isHubspotPatPrimary && (
              <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-xs text-gray-700 dark:text-gray-300">
                <p className="mb-2">{provider.display_name} uses OAuth — sign in to authorize StudioOS:</p>
                {provider.key === 'salesforce' && (
                  <div className="mb-3 flex items-center gap-3 text-xs">
                    <span className="text-gray-700 dark:text-gray-300">Org type:</span>
                    <label className="inline-flex items-center gap-1 cursor-pointer">
                      <input type="radio" name="sf_env" checked={!sfSandbox} onChange={() => setSfSandbox(false)} />
                      Production
                    </label>
                    <label className="inline-flex items-center gap-1 cursor-pointer">
                      <input type="radio" name="sf_env" checked={sfSandbox} onChange={() => setSfSandbox(true)} />
                      Sandbox
                    </label>
                  </div>
                )}
                <button type="button" onClick={startOauth} className="bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium px-3 py-1.5 rounded inline-flex items-center gap-1.5">
                  <ExternalLink size={12} /> Continue with {provider.display_name}
                  {provider.key === 'salesforce' && sfSandbox && <span className="ml-1 opacity-80">(Sandbox)</span>}
                </button>
                {provider.supports_pat && (
                  <p className="mt-2 text-[11px] text-gray-500">
                    {provider.key === 'hubspot'
                      ? 'Or paste a Private App access token below — recommended while our public app is pending HubSpot Marketplace review.'
                      : 'Or paste a Personal Access Token below — useful if your workspace blocks third-party OAuth apps.'}
                  </p>
                )}
              </div>
            )}
            {provider.auth_type === 'api_key' && (
              <Field label={existing ? 'New API key (leave blank to keep current)' : 'API key'}>
                <input type="password" className={inputCls} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={existing?.api_key_preview || ''} required={!existing} />
              </Field>
            )}
            {provider.auth_type === 'oauth2' && provider.supports_pat && !existing && (
              <Field label={provider.key === 'hubspot' ? 'Private App access token' : 'Personal Access Token (optional)'}>
                <input
                  type="password"
                  className={inputCls}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={provider.key === 'hubspot' ? 'pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' : 'cal_pat_...'}
                  autoComplete="off"
                />
                {provider.key !== 'hubspot' && (
                  <p className="text-[11px] text-gray-500 mt-1">
                    Generate one in {provider.display_name} → Integrations → API & Webhooks.
                  </p>
                )}
              </Field>
            )}
            {isHubspotPatPrimary && (
              <div className="text-xs">
                <button
                  type="button"
                  onClick={() => setShowAdvancedOauth(v => !v)}
                  className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline underline-offset-2"
                >
                  {showAdvancedOauth ? 'Hide advanced (OAuth)' : 'Advanced: connect with OAuth instead'}
                </button>
                {showAdvancedOauth && (
                  <div className="mt-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-xs text-gray-700 dark:text-gray-300">
                    <p className="mb-2">
                      HubSpot's public OAuth app is pending Marketplace review — connecting via OAuth currently fails on non-test portals with a redirect URI mismatch. Use the Private App token above unless your portal is whitelisted.
                    </p>
                    <button
                      type="button"
                      onClick={startOauth}
                      className="bg-gray-700 hover:bg-gray-800 text-white text-xs font-medium px-3 py-1.5 rounded inline-flex items-center gap-1.5"
                    >
                      <ExternalLink size={12} /> Try OAuth anyway
                    </button>
                  </div>
                )}
              </div>
            )}
            <Field label="Webhook secret (optional)">
              <input type="password" className={inputCls} value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} placeholder={existing?.has_webhook_secret ? '••••••••' : ''} />
              <p className="text-[11px] text-gray-500 mt-1">Used to validate inbound webhooks at <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">/api/integrations/webhook/{provider.key}/{'{uid}'}</code> using HMAC-SHA256 in the <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">X-Axal-Signature</code> header.</p>
            </Field>
            <Field label="Config (JSON, optional)">
              <textarea rows={4} className={`${inputCls} font-mono text-xs`} value={configText} onChange={e => setConfigText(e.target.value)} placeholder='{"portal_id": "12345"}' />
            </Field>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 px-4 py-2">Cancel</button>
              {provider.auth_type !== 'oauth2' || existing || provider.supports_pat ? (
                <button
                  type="submit"
                  disabled={busy}
                  className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
                >
                  {busy ? 'Saving…' : (existing ? 'Update' : 'Connect')}
                </button>
              ) : null}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function LogsModal({ integration, logs, loading, onClose }) {
  useEscapeClose(onClose);
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Logs — {integration.display_name || integration.provider_key}</h3>
            <p className="text-xs text-gray-500">Most recent activity (newest first).</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-sm text-gray-500">Loading…</div>
          ) : logs.length === 0 ? (
            <div className="p-6 text-sm text-gray-500 text-center">No log entries yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                <tr className="text-left text-xs text-gray-600 dark:text-gray-300">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Direction</th>
                  <th className="px-4 py-2 font-medium">Event</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {logs.map(l => (
                  <tr key={l.id} className="align-top">
                    <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded ${l.direction === 'inbound' ? 'bg-blue-100 text-blue-700' : l.direction === 'outbound' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-700'}`}>{l.direction}</span>
                    </td>
                    <td className="px-4 py-2 text-xs font-mono text-gray-700 dark:text-gray-300">{l.event_type}</td>
                    <td className="px-4 py-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded ${l.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{l.status}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400">{l.response_summary || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</div>
      {children}
    </label>
  );
}

// ─────────────────────────────────────────────── HubSpot pipeline picker

const STUDIO_STAGES = ['applied', 'scored', 'active', 'funded', 'rejected'];

function HubspotConfigModal({ integration, onClose, onSaved }) {
  useEscapeClose(onClose);
  const [loading, setLoading] = useState(true);
  const [pipelines, setPipelines] = useState([]);
  const [pipelineId, setPipelineId] = useState(integration?.config?.pipeline_id || 'default');
  const [stageMap, setStageMap] = useState(integration?.config?.dealstage_map || {});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.integrationsAction(integration.uid, 'list_pipelines');
        if (!alive) return;
        setPipelines(res?.result?.pipelines || []);
      } catch (e) {
        if (alive) setError(e.message || 'Failed to load pipelines');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [integration.uid]);

  const selected = pipelines.find(p => p.id === pipelineId);
  const stages = (selected?.stages || []).slice().sort((a, b) => a.order - b.order);

  const onSelectPipeline = (id) => {
    setPipelineId(id);
    // Reset map when pipeline changes — old stage IDs won't exist on a different pipeline.
    if (id !== integration?.config?.pipeline_id) setStageMap({});
  };

  const setStage = (studio, hubspotId) => setStageMap(m => ({ ...m, [studio]: hubspotId }));

  const onSave = async () => {
    setSaving(true);
    setError('');
    try {
      await api.integrationsPatchConfig(integration.uid, {
        pipeline_id: pipelineId,
        pipeline_label: selected?.label || pipelineId,
        dealstage_map: stageMap,
      });
      onSaved?.();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-lg w-full p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">HubSpot pipeline</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><X size={18} /></button>
        </div>
        {loading ? (
          <div className="text-sm text-gray-500 py-6 text-center">Loading pipelines…</div>
        ) : error ? (
          <div className="text-sm text-red-600 flex items-center gap-2"><AlertCircle size={14} /> {error}</div>
        ) : (
          <div className="space-y-4">
            <Field label="Pipeline">
              <select
                value={pipelineId}
                onChange={e => onSelectPipeline(e.target.value)}
                className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2"
              >
                {pipelines.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
                {!pipelines.find(p => p.id === pipelineId) && (
                  <option value={pipelineId}>{pipelineId} (current)</option>
                )}
              </select>
            </Field>
            <div>
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Map StudioOS stages → HubSpot</div>
              <div className="space-y-2">
                {STUDIO_STAGES.map(s => (
                  <div key={s} className="flex items-center gap-2">
                    <div className="w-20 text-xs text-gray-600 dark:text-gray-400 capitalize">{s}</div>
                    <select
                      value={stageMap[s] || ''}
                      onChange={e => setStage(s, e.target.value)}
                      className="flex-1 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5"
                    >
                      <option value="">— use default —</option>
                      {stages.map(st => (
                        <option key={st.id} value={st.id}>{st.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                Empty entries fall back to the built-in defaults (appointmentscheduled / qualifiedtobuy / presentationscheduled / closedwon / closedlost).
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700">Cancel</button>
              <button
                onClick={onSave}
                disabled={saving}
                className="text-sm px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1"
              >
                <Check size={14} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Salesforce stage + field mapping

const SF_OBJECTS = [
  { key: 'opportunity', label: 'Opportunity' },
  { key: 'account',     label: 'Account' },
  { key: 'contact',     label: 'Contact' },
];

function SalesforceConfigModal({ integration, onClose, onSaved }) {
  useEscapeClose(onClose);
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState([]);
  const [stageMap, setStageMap] = useState(integration?.config?.stage_map || {});
  const [fieldMap, setFieldMap] = useState(integration?.config?.field_map || null);
  const [defaults, setDefaults] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [stagesRes, fieldsRes] = await Promise.all([
          api.integrationsAction(integration.uid, 'list_stages').catch(() => null),
          api.integrationsAction(integration.uid, 'list_field_map').catch(() => null),
        ]);
        if (!alive) return;
        setStages(stagesRes?.result?.stages || []);
        const fm = fieldsRes?.result?.field_map || null;
        const def = fieldsRes?.result?.defaults || null;
        if (fm && !fieldMap) setFieldMap(fm);
        setDefaults(def);
      } catch (e) {
        if (alive) setError(e.message || 'Failed to load Salesforce metadata');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integration.uid]);

  const setStage = (studio, sfName) => setStageMap(m => ({ ...m, [studio]: sfName }));
  const effectiveFieldMap = fieldMap || defaults || { opportunity: {}, account: {}, contact: {} };
  const updateField = (obj, studioKey, sfField) => {
    setFieldMap(m => {
      const base = m || defaults || { opportunity: {}, account: {}, contact: {} };
      return { ...base, [obj]: { ...(base[obj] || {}), [studioKey]: sfField } };
    });
  };

  const onSave = async () => {
    setSaving(true);
    setError('');
    try {
      const patch = { stage_map: stageMap };
      if (fieldMap) patch.field_map = fieldMap;
      await api.integrationsPatchConfig(integration.uid, patch);
      onSaved?.();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Salesforce field mapping</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><X size={18} /></button>
        </div>
        {loading ? (
          <div className="text-sm text-gray-500 py-6 text-center">Loading metadata…</div>
        ) : (
          <div className="space-y-5">
            {error && <div className="text-sm text-red-600 flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}
            <div>
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Map StudioOS deal status → Opportunity StageName</div>
              <div className="space-y-2">
                {STUDIO_STAGES.map(s => (
                  <div key={s} className="flex items-center gap-2">
                    <div className="w-20 text-xs text-gray-600 dark:text-gray-400 capitalize">{s}</div>
                    <select
                      value={stageMap[s] || ''}
                      onChange={e => setStage(s, e.target.value)}
                      className="flex-1 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5"
                    >
                      <option value="">— use default —</option>
                      {stages.map(st => (
                        <option key={st.value} value={st.value}>{st.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                Defaults: Prospecting / Qualification / Proposal / Closed Won / Closed Lost.
              </p>
            </div>

            <div>
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Field mapping (StudioOS → Salesforce)</div>
              <div className="space-y-3">
                {SF_OBJECTS.map(obj => (
                  <div key={obj.key} className="border border-gray-200 dark:border-gray-800 rounded-lg p-3">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">{obj.label}</div>
                    <div className="space-y-1.5">
                      {Object.keys(effectiveFieldMap[obj.key] || {}).map(studioKey => (
                        <div key={studioKey} className="flex items-center gap-2 text-xs">
                          <div className="w-28 text-gray-600 dark:text-gray-400 truncate">{studioKey}</div>
                          <span className="text-gray-400">→</span>
                          <input
                            value={effectiveFieldMap[obj.key]?.[studioKey] || ''}
                            onChange={e => updateField(obj.key, studioKey, e.target.value)}
                            className="flex-1 text-xs font-mono rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1"
                            placeholder="SF field API name"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                Custom fields ending in <code>__c</code> that don't exist on your org are skipped automatically; standard fields must match exact API names.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700">Cancel</button>
              <button
                onClick={onSave}
                disabled={saving}
                className="text-sm px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1"
              >
                <Check size={14} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

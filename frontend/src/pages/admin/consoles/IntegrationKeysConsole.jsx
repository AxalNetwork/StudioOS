import React, { useEffect, useState } from 'react';
import { reportError } from '../../../lib/log';
import { api } from '../../../lib/api';
import { X, Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { useToast } from '../../../components/useToast';
import { useEscapeClose } from '../../../components/useEscapeClose';
import { useAuth } from '../../../hooks/useAuthSync';
import { Unrecorded } from '../../../ui';
// D223 — the elevation the secret-writing consoles gate on; its own line so
// the `branchOfUser` import D128's test pins stays exactly as it was.
import { isSuperAdminUser } from '../../../lib/shellRole';
import SecretWriteGate from '../../../components/SecretWriteGate';
// D227 — Integration keys' actions and wording follow where a key lives.
import { keyActionsFor, keyStateBadge, connectedUsersLine, removeConfirmText, SAVE_EFFECT } from '../../../lib/integrationKeys';
import { ConsoleUnreadable } from './shared';

/**
 * D648 (#1448) — the Integration keys console.
 */

// ──────────────────────────────────────────────────────────────────
// Task #7 — Integration Keys panel (admin-managed OAuth client_id /
// client_secret per provider). Sits alongside the existing tabs so a
// non-engineer admin can stand up Slack / HubSpot / Salesforce /
// DocuSign without redeploying the worker.
// ──────────────────────────────────────────────────────────────────

const PROVIDER_LABELS = {
  slack: 'Slack',
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  docusign: 'DocuSign',
  linkedin: 'LinkedIn',
  calendly: 'Calendly',
  stripe: 'Stripe',
  carta: 'Carta',
  crunchbase: 'Crunchbase',
  affinity: 'Affinity',
  telegram: 'Telegram',
  gcip: 'Google Identity (SMS)',
};

const PROVIDER_HINTS = {
  slack: 'Get Client ID + Client Secret from api.slack.com → your app → Basic Information.',
  hubspot: 'Get Client ID + Client Secret from your HubSpot Developer App → Auth tab.',
  salesforce: 'Get Consumer Key + Consumer Secret from Setup → App Manager → your Connected App.',
  docusign: 'Get Integration Key + Secret Key from DocuSign Admin → Apps and Keys.',
  linkedin: 'Get Client ID + Client Secret from linkedin.com/developers → your app → Auth tab.',
  calendly: 'Get Client ID + Client Secret from calendly.com → Integrations → OAuth applications.',
  stripe: 'Connect Client ID is the ca_… from Stripe Dashboard → Connect → Settings. Secret Key is the sk_live_… (or sk_test_…) from API keys.',
  carta: 'Get Client ID + Client Secret from your Carta Developer Portal app.',
  crunchbase: 'API key — paste a label (e.g. "default") into Client ID and the user_key into Secret. Provision the key at data.crunchbase.com.',
  affinity: 'API key — put your team subdomain (e.g. "acme") into Client ID and the Affinity API key into Secret. Generate at affinity.co → Settings → API.',
  telegram: 'Bot token — put the bot username (e.g. "axalvc_bot") into Client ID and the BotFather token into Secret. Get the token from @BotFather on Telegram.',
  gcip: 'SMS backup 2FA — put the GCP project id into Client ID and the Identity Platform / Firebase Web API key into Secret. Enable Phone authentication on the project first. Google Cloud Console → APIs & Services → Credentials.',
};

const PROVIDER_ENV_NAMES = {
  slack: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
  hubspot: ['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET'],
  salesforce: ['SF_CLIENT_ID', 'SF_CLIENT_SECRET'],
  docusign: ['DOCUSIGN_CLIENT_ID', 'DOCUSIGN_CLIENT_SECRET'],
  linkedin: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  calendly: ['CALENDLY_CLIENT_ID', 'CALENDLY_CLIENT_SECRET'],
  stripe: ['STRIPE_CONNECT_CLIENT_ID', 'STRIPE_SECRET_KEY'],
  carta: ['CARTA_CLIENT_ID', 'CARTA_CLIENT_SECRET'],
  crunchbase: ['CRUNCHBASE_USER_KEY_ID', 'CRUNCHBASE_API_KEY'],
  affinity: ['AFFINITY_TEAM_DOMAIN', 'AFFINITY_API_KEY'],
  telegram: ['TELEGRAM_BOT_USERNAME', 'TELEGRAM_BOT_TOKEN'],
  gcip: ['GCIP_PROJECT_ID', 'GCIP_API_KEY'],
};

export function IntegrationKeysPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [testing, setTesting] = useState(null); // Task #3 — provider_key currently being tested
  const { toast, showToast } = useToast(3500);
  // D223 — save, rotate and remove each write Worker secrets on production.
  const holdsSecretWrites = isSuperAdminUser(useAuth().user);

  // Task #3 — Dry-run probe of provider OAuth credentials.
  const onTest = async (provider) => {
    setTesting(provider);
    try {
      const r = await api.adminTestIntegrationKeys(provider);
      const label = PROVIDER_LABELS[provider] || provider;
      if (r.ok) {
        showToast({ kind: 'ok', msg: `${label}: ${r.detail || 'Credentials accepted.'}` });
      } else if (!r.reachable) {
        showToast({ kind: 'err', msg: `${label}: provider unreachable (network/timeout).` });
      } else {
        showToast({ kind: 'err', msg: `${label}: ${r.detail || 'Credentials rejected.'}` });
      }
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Test failed' });
    } finally { setTesting(null); }
  };

  // D227 — the worker says when the key table did not answer, and why.
  const [unreadableReason, setUnreadableReason] = useState(null);
  // D648 — a failed read is said, never drawn as an empty list.
  const [failed, setFailed] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await api.adminListIntegrationKeys();
      setRows(r.providers || []);
      setUnreadableReason(r.db_readable === false ? (r.unreadable_reason || 'The key table could not be read.') : null);
      setFailed(false);
    } catch (e) {
      reportError('IntegrationKeysPanel:refresh', e);
      showToast({ kind: 'err', msg: e.message || 'Failed to load' });
      setFailed(true);
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  // D227 — Remove works wherever the key lives: the worker deletes both Worker
  // secrets through the Cloudflare API and any database row. It used to refuse
  // an env-held key here and point at `wrangler secret delete`, which is where
  // every key saved from this console ends up.
  const onDelete = async (provider) => {
    const row = rows.find(r => r.provider_key === provider);
    if (!confirm(removeConfirmText(PROVIDER_LABELS[provider] || provider, row?.active_integrations ?? null))) return;
    try {
      const r = await api.adminDeleteIntegrationKeys(provider);
      showToast({ kind: 'ok', msg: r.disconnected_users
        ? `Removed — ${r.disconnected_users} user integration${r.disconnected_users === 1 ? '' : 's'} disconnected.`
        : 'Keys removed.' });
      refresh();
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Failed to remove' });
    }
  };

  return (
    <div data-density-target>
      {toast && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm ${toast.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {toast.msg}
        </div>
      )}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-5 flex gap-3">
        <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900 dark:text-amber-100">
          <div className="font-semibold mb-1">OAuth client credentials are sensitive.</div>
          <div className="text-amber-800 dark:text-amber-200">
            A save writes the pair as Worker secrets on the production Worker. A key still kept in the database, from before saves moved to Worker secrets, is used only while no Worker secret is set. Removing keys disconnects every active user integration for that provider — they'll need to reconnect once new keys are saved.
          </div>
        </div>
      </div>

      {!holdsSecretWrites && (
        <div className="mb-5">
          <SecretWriteGate holds={false} what="Saving, rotating or removing a provider's keys" testid="integration-keys-holder-only" />
        </div>
      )}

      {unreadableReason && (
        <p className="mb-5 text-xs text-amber-800 dark:text-amber-300" data-testid="integration-keys-unreadable">
          {unreadableReason} A provider without a Worker secret reads Unknown, and nothing is offered for it until the table answers.
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm py-8 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading providers…
        </div>
      ) : failed ? (
        <ConsoleUnreadable what="The integration keys" onRetry={() => refresh()} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((row) => {
            const label = PROVIDER_LABELS[row.provider_key] || row.provider_key;
            const envNames = PROVIDER_ENV_NAMES[row.provider_key] || [];
            // D227 — the worker's state, not `source`: `unreadable` is not
            // `unconfigured`, and a key saved here lives in `env`.
            const state = row.state;
            const sourceBadge = keyStateBadge(state);
            const actions = keyActionsFor(state);
            return (
              <div key={row.provider_key} data-card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{label}</h3>
                      <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold ${sourceBadge.cls}`}>{sourceBadge.text}</span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {connectedUsersLine(row.active_integrations)}
                    </div>
                  </div>
                </div>
                {row.has_keys && row.client_id_preview && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-3 font-mono break-all">
                    Client ID: {row.client_id_preview}
                  </div>
                )}
                {state === 'db' && row.updated_at && (
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
                    Last rotated {new Date(row.updated_at).toLocaleString()}
                  </div>
                )}
                {state === 'env' && (
                  <div className="text-[11px] text-blue-700 dark:text-blue-300 mb-3">
                    Held as Worker secret{envNames.length === 2 ? 's' : ''}{' '}
                    {envNames.map((n, i) => <React.Fragment key={n}>{i > 0 && ' + '}<code>{n}</code></React.Fragment>)}.
                    Rotate and Remove write them through the Cloudflare API.
                  </div>
                )}
                {state === 'unset' && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-3">{PROVIDER_HINTS[row.provider_key]}</div>
                )}
                {state === 'unreadable' && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-3" data-testid="integration-key-unknown">
                    <Unrecorded reason={unreadableReason || 'The key table could not be read.'}>Unknown</Unrecorded>
                    {' '}— no Worker secret is set, and the database could not be read to say whether a key is kept there.
                  </div>
                )}
                <div className="flex gap-2 flex-wrap">
                  {holdsSecretWrites && actions.configure && (
                    <button
                      onClick={() => setEditing({ provider: row.provider_key, mode: 'configure' })}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700">
                      Configure
                    </button>
                  )}
                  {holdsSecretWrites && actions.rotate && (
                    <button
                      onClick={() => setEditing({ provider: row.provider_key, mode: 'rotate' })}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700">
                      Rotate secret
                    </button>
                  )}
                  {/* Task #3 — Test button: dry-runs a provider auth call. */}
                  <button
                    onClick={() => onTest(row.provider_key)}
                    disabled={!row.has_keys || testing === row.provider_key}
                    title={row.has_keys ? 'Probe the provider with the configured credentials' : 'Configure keys first'}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/70 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5">
                    {testing === row.provider_key ? <Loader2 size={12} className="animate-spin" /> : null}
                    Test
                  </button>
                  {holdsSecretWrites && actions.remove && (
                    <button
                      onClick={() => onDelete(row.provider_key)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-gray-700 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 inline-flex items-center gap-1.5">
                      <Trash2 size={12} /> Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <IntegrationKeysEditModal
          provider={editing.provider}
          mode={editing.mode}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); showToast({ kind: 'ok', msg: editing.mode === 'rotate' ? 'Secret rotated.' : 'Keys saved.' }); }}
          onError={(msg) => showToast({ kind: 'err', msg })}
        />
      )}
    </div>
  );
}

function IntegrationKeysEditModal({ provider, mode = 'configure', onClose, onSaved, onError }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  useEscapeClose(onClose);
  const label = PROVIDER_LABELS[provider] || provider;
  // Task #3 — rotate-mode only collects a new client_secret and calls
  // POST /:provider/rotate (client_id stays the same). configure-mode
  // is the original PUT flow used to first set up a provider.
  const isRotate = mode === 'rotate';

  const submit = async (e) => {
    e?.preventDefault?.();
    if (isRotate) {
      if (!clientSecret.trim()) {
        onError('A new Client Secret is required.');
        return;
      }
    } else if (!clientId.trim() || !clientSecret.trim()) {
      onError('Both Client ID and Client Secret are required.');
      return;
    }
    setSaving(true);
    try {
      if (isRotate) {
        await api.adminRotateIntegrationKeys(provider, clientSecret.trim());
      } else {
        await api.adminSetIntegrationKeys(provider, clientId.trim(), clientSecret.trim());
      }
      onSaved();
    } catch (e) {
      onError(e.message || (isRotate ? 'Failed to rotate' : 'Failed to save'));
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{isRotate ? `Rotate ${label} secret` : `${label} OAuth keys`}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
          {isRotate
            ? 'Paste the new client secret issued by the provider. The Client ID stays the same — only the secret is rotated in place.'
            : PROVIDER_HINTS[provider]}
        </p>
        {!isRotate && (
          <>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Client ID</label>
            <input
              autoFocus
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-2 mb-3 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono"
              placeholder="e.g. 1234567890.0987654321" />
          </>
        )}
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{isRotate ? 'New Client Secret' : 'Client Secret'}</label>
        <input
          autoFocus={isRotate}
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          autoComplete="new-password"
          spellCheck={false}
          className="w-full px-3 py-2 mb-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono"
          placeholder="••••••••••••••••" />
        {/* D227 — what a save does now, not what the database store did. */}
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-4" data-testid="integration-keys-save-effect">
          {isRotate ? SAVE_EFFECT.rotate : SAVE_EFFECT.configure}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">
            Cancel
          </button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60 inline-flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {isRotate ? 'Rotate secret' : 'Save keys'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default IntegrationKeysPanel;

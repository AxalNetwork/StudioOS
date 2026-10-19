import React, { useEffect, useState } from 'react';
import { reportError } from '../../../lib/log';
import { api } from '../../../lib/api';
import { X, Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { useToast } from '../../../components/useToast';
import { useEscapeClose } from '../../../components/useEscapeClose';
import { useAuth } from '../../../hooks/useAuthSync';
import { BrandIcon, Unrecorded } from '../../../ui';
// D223 — the elevation the secret-writing consoles gate on; its own line so
// the `branchOfUser` import D128's test pins stays exactly as it was.
import { isSuperAdminUser } from '../../../lib/shellRole';
import SecretWriteGate from '../../../components/SecretWriteGate';
// D227 — Integration keys' actions and wording follow where a key lives.
import { keyActionsFor, keyStateBadge, connectedUsersLine, removeConfirmText, SAVE_EFFECT } from '../../../lib/integrationKeys';
// D751 (#1882) — what to register for each OAuth client, and where.
import {
  envNamesFor, membersSeeLine, wranglerPutLine, safeGuideHref, ENV_ONLY_NOTE, CALLBACK_COPY,
} from '../../../lib/integrationKeys';
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
  github: 'GitHub',
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
  github: 'From github.com → AxalNetwork → Settings → Developer settings → GitHub Apps → Axal StudioOS: copy the Client ID (it starts with Iv, and is not the numeric App ID), then press Generate a new client secret. The App needs exactly four repository permissions, all Read-only: Contents, Issues, Metadata and Pull requests. Any other permission makes every connect fail.',
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
  github: ['GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET'],
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
  // D751 — the OAuth clients set only at deploy; an older Worker sends none.
  const [envOnly, setEnvOnly] = useState([]);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await api.adminListIntegrationKeys();
      setRows(r.providers || []);
      setEnvOnly(Array.isArray(r.other_oauth) ? r.other_oauth : []);
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
            const envNames = envNamesFor(row, PROVIDER_ENV_NAMES);
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
                      <BrandIcon provider={row.provider_key} name={label} size={24} />
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
                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                    {PROVIDER_HINTS[row.provider_key]}
                    {envNames.length === 2 && (
                      <span data-testid={`integration-key-env-names-${row.provider_key}`}>
                        {PROVIDER_HINTS[row.provider_key] ? ' ' : ''}Or set them as the Worker secrets <code>{envNames[0]}</code> and <code>{envNames[1]}</code>.
                      </span>
                    )}
                  </div>
                )}
                {state === 'unreadable' && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-3" data-testid="integration-key-unknown">
                    <Unrecorded reason={unreadableReason || 'The key table could not be read.'}>Unknown</Unrecorded>
                    {' '}— no Worker secret is set, and the database could not be read to say whether a key is kept there.
                  </div>
                )}
                <SetupLines name={label} callbackUrl={row.callback_url} membersLine={membersSeeLine({ connector: row.connector, unset: state === 'unset' })}
                  guideHref={row.guide_href} testKey={row.provider_key} />
                <div className="flex gap-2 flex-wrap">
                  {holdsSecretWrites && actions.configure && (
                    <button
                      onClick={() => setEditing({ provider: row.provider_key, mode: 'configure', callbackUrl: row.callback_url })}
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

      {!loading && !failed && envOnly.length > 0 && (
        <section className="mt-8" data-testid="integration-keys-env-only">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Set at deploy only</h3>
          <p className="mt-1 mb-4 text-xs text-gray-600 dark:text-gray-400">{ENV_ONLY_NOTE}</p>
          <div className="grid gap-4 md:grid-cols-2">
            {envOnly.map((o) => <EnvOnlyOauthCard key={o.key} row={o} />)}
          </div>
        </section>
      )}

      {editing && (
        <IntegrationKeysEditModal
          provider={editing.provider}
          mode={editing.mode}
          callbackUrl={editing.callbackUrl}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); showToast({ kind: 'ok', msg: editing.mode === 'rotate' ? 'Secret rotated.' : 'Keys saved.' }); }}
          onError={(msg) => showToast({ kind: 'err', msg })}
        />
      )}
    </div>
  );
}

function IntegrationKeysEditModal({ provider, mode = 'configure', callbackUrl = null, onClose, onSaved, onError }) {
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
        {!isRotate && callbackUrl && (
          <div className="mb-4">
            <CallbackUrlField url={callbackUrl} name={label} testid={`integration-key-dialog-callback-${provider}`} copyTestid={`integration-key-dialog-callback-copy-${provider}`} />
          </div>
        )}
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

/**
 * D751 — the callback URL to register with the provider, as the Worker sends
 * it (the provider's own function builds it), with Copy.
 */
export function CallbackUrlField({ url, name, testid, copyTestid }) {
  const [copy, setCopy] = useState('idle');
  const onCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setCopy('done');
      setTimeout(() => setCopy('idle'), 1600);
    } catch (e) {
      reportError('IntegrationKeys:copyCallback', e);
      setCopy('failed');
    }
  };
  return (
    <div className="text-xs" data-testid={testid}>
      <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">Callback URL to register with {name}</div>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-gray-50 dark:bg-gray-900 px-2 py-1 text-gray-800 dark:text-gray-200">{url}</code>
        <button type="button" onClick={onCopy} data-testid={copyTestid}
          className="shrink-0 px-2 py-1 text-[11px] font-medium rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/70">
          {copy === 'done' ? CALLBACK_COPY.done : CALLBACK_COPY.idle}
        </button>
      </div>
      {copy === 'failed' && <p role="alert" className="mt-1 text-[11px] text-red-700 dark:text-red-300">{CALLBACK_COPY.failed}</p>}
    </div>
  );
}

/** D751 — the callback with Copy, what members see while the key is missing, and the setup guide. */
function SetupLines({ name, callbackUrl, membersLine, guideHref, testKey }) {
  const guide = safeGuideHref(guideHref);
  if (!callbackUrl && !membersLine && !guide) return null;
  return (
    <div className="mb-3 flex flex-col gap-2">
      {callbackUrl && <CallbackUrlField url={callbackUrl} name={name} testid={`integration-key-callback-${testKey}`} copyTestid={`integration-key-callback-copy-${testKey}`} />}
      {membersLine && <p className="text-xs text-amber-800 dark:text-amber-300" data-testid={`integration-key-members-${testKey}`}>{membersLine}</p>}
      {guide && (
        <a href={guide} target="_blank" rel="noopener noreferrer" data-testid={`integration-key-guide-${testKey}`}
          className="self-start text-xs font-medium text-violet-700 dark:text-violet-300 underline">Setup guide</a>
      )}
    </div>
  );
}

/**
 * D751 — one OAuth client set only at deploy (Zoom, Google Calendar,
 * Microsoft 365): whether it is set up, the commands that set it, its
 * fallback names, its callback, what members see and its guide. Read-only:
 * no Configure, Rotate, Remove or Test, and never a value.
 */
export function EnvOnlyOauthCard({ row }) {
  const name = row?.connector?.display_name || row?.key;
  const badge = keyStateBadge(row?.configured ? 'env' : 'unset');
  const names = Array.isArray(row?.env_vars) ? row.env_vars.filter((n) => typeof n === 'string' && n) : [];
  const fallback = Array.isArray(row?.fallback_env_vars) ? row.fallback_env_vars.filter((n) => typeof n === 'string' && n) : [];
  return (
    <div data-card data-testid={`integration-key-env-only-${row?.key}`} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <BrandIcon provider={row?.key} name={name} size={24} />
        <h4 className="text-base font-bold text-gray-900 dark:text-gray-100">{name}</h4>
        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold ${badge.cls}`}>{badge.text}</span>
      </div>
      <ul className="mb-3 flex flex-col gap-1">
        {names.map((n) => (
          <li key={n} className="text-xs">
            <code className="block break-all rounded bg-gray-50 dark:bg-gray-900 px-2 py-1 text-gray-800 dark:text-gray-200">{wranglerPutLine(n)}</code>
          </li>
        ))}
      </ul>
      {fallback.length > 0 && (
        <p className="mb-3 text-xs text-gray-600 dark:text-gray-400" data-testid={`integration-key-fallback-${row?.key}`}>
          If these are unset, {fallback.map((n, i) => <React.Fragment key={n}>{i > 0 && ' and '}<code>{n}</code></React.Fragment>)} are read instead.
        </p>
      )}
      <SetupLines name={name} callbackUrl={row?.callback_url} membersLine={membersSeeLine({ connector: row?.connector, unset: row?.configured === false })}
        guideHref={row?.guide_href} testKey={row?.key} />
    </div>
  );
}

export default IntegrationKeysPanel;

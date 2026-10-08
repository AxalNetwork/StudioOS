import React, { useEffect, useState } from 'react';
import { reportError } from '../../../lib/log';
import { api } from '../../../lib/api';
import { Check, XCircle, CheckCircle2, RefreshCw, Loader2, GitBranch as Github, Copy } from 'lucide-react';
import { useToast } from '../../../components/useToast';
import { useAuth } from '../../../hooks/useAuthSync';
// D223 — the elevation the secret-writing consoles gate on; its own line so
// the `branchOfUser` import D128's test pins stays exactly as it was.
import { isSuperAdminUser } from '../../../lib/shellRole';
import SecretWriteGate from '../../../components/SecretWriteGate';
import { ConsoleUnreadable } from './shared';

/**
 * D648 (#1448) — the GitHub Sync console.
 */

/**
 * D270 — the repository GitHub Sync files into, as the running Worker has it,
 * with no control. `GITHUB_REPO_OWNER` and `GITHUB_REPO_NAME` are wrangler.toml
 * [vars]: every deploy writes them back, so an input here could only ever show
 * an edit the next deploy undoes. A value the Worker does not have reads
 * "Not set", never a default the sync would not use.
 */
export function GithubRepoReadOnly({ cfg }) {
  const val = (v) => (v ? <code className="text-[11px]">{v}</code> : <span className="text-gray-500 dark:text-gray-400">Not set</span>);
  return (
    <div className="my-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2" data-testid="github-sync-repo-readonly">
      <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
        Repository · set at deploy time
      </div>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-gray-600 dark:text-gray-400">
        <dt>Owner</dt><dd data-testid="github-sync-repo-owner">{val(cfg?.repo_owner)}</dd>
        <dt>Name</dt><dd data-testid="github-sync-repo-name">{val(cfg?.repo_name)}</dd>
      </dl>
      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
        {cfg?.repo_note || 'GITHUB_REPO_OWNER and GITHUB_REPO_NAME are [vars] in wrangler.toml; change them there and deploy.'}
      </p>
    </div>
  );
}

export function githubSyncBadge(cfg, result) {
  if (result?.can_write === false) return { text: 'Issue creation failed', cls: 'bg-red-100 text-red-700' };
  if (result?.can_write === true) return { text: 'Issue creation verified', cls: 'bg-emerald-100 text-emerald-700' };
  if (cfg?.configured) return { text: 'Write access unverified', cls: 'bg-amber-100 text-amber-700' };
  return cfg?.has_token
    ? { text: 'Partially configured', cls: 'bg-amber-100 text-amber-700' }
    : { text: 'Not configured', cls: 'bg-gray-100 text-gray-700' };
}

export function GithubSyncPanel() {
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [token, setToken] = useState('');
  const [revealedSecret, setRevealedSecret] = useState(null);
  const { toast, showToast } = useToast(3500);
  // D648 — a failed read is said, never drawn as an empty list.
  const [failed, setFailed] = useState(false);
  // D223 — saving writes GITHUB_ACCESS_TOKEN (the branch-deploy dispatcher's
  // token too) and its siblings onto the production Worker.
  const holdsSecretWrites = isSuperAdminUser(useAuth().user);

  const refresh = async () => {
    setLoading(true);
    try {
      const c = await api.adminGetGithubConfig();
      setCfg(c);
      setToken('');
      setFailed(false);
    } catch (e) {
      reportError('AdminPage:githubConfigLoad', e);
      showToast({ kind: 'err', msg: e.message || 'Failed to load' });
      setFailed(true);
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  // D270 — Save writes the token and nothing else. The repository is a
  // deploy-time setting (wrangler.toml [vars]) and is shown read-only below;
  // sending it here used to push it as a secret the next deploy reverted.
  const onSave = async () => {
    setSaving(true);
    try {
      const r = await api.adminSaveGithubConfig({ token: token.trim() });
      if (r.webhook_secret) setRevealedSecret(r.webhook_secret);
      showToast({ kind: 'ok', msg: 'GitHub settings saved.' });
      setTestResult(null);
      await refresh();
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Failed to save' });
    } finally { setSaving(false); }
  };

  // `write` runs the only probe that settles whether the token may CREATE an
  // issue. The read-only test cannot: a fine-grained PAT's Metadata: Read is
  // automatic and unremovable, so reaching the repo proves nothing about
  // Issues, and this panel used to call that "Connected".
  const onTest = async (write = false) => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.adminTestGithub(write);
      setTestResult(r);
      showToast({ kind: r.ok ? 'ok' : 'err', msg: r.detail || (r.ok ? 'Connected.' : 'Connection failed.') });
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Test failed' });
    } finally { setTesting(false); }
  };

  const onRotateSecret = async () => {
    if (!confirm('Generate a new webhook secret? You will need to update it in the GitHub webhook settings, or issue-close events will stop syncing.')) return;
    try {
      const r = await api.adminSaveGithubConfig({ generate_webhook_secret: true });
      if (r.webhook_secret) setRevealedSecret(r.webhook_secret);
      showToast({ kind: 'ok', msg: 'New webhook secret generated.' });
      await refresh();
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Failed to rotate' });
    }
  };

  const copy = (text, label) => {
    try {
      navigator.clipboard.writeText(text);
      showToast({ kind: 'ok', msg: `${label} copied.` });
    } catch { showToast({ kind: 'err', msg: 'Copy failed — select and copy manually.' }); }
  };

  const inputClass = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500';

  if (loading) return (
    <div className="flex items-center gap-2 text-gray-500 text-sm py-8 justify-center">
      <Loader2 size={16} className="animate-spin" /> Loading GitHub settings…
    </div>
  );

  // D648 — no settings were read, so none are drawn as though they were.
  if (failed && !cfg) return <ConsoleUnreadable what="The GitHub Sync settings" onRetry={() => refresh()} />;

  const statusBadge = githubSyncBadge(cfg, testResult);

  return (
    <div data-density-target className="max-w-3xl">
      {toast && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm ${toast.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {toast.msg}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 mb-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Github size={18} className="text-gray-800 dark:text-gray-100" />
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Support ticket → GitHub sync</h3>
          </div>
          <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold ${statusBadge.cls}`}>{statusBadge.text}</span>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Filing a support ticket opens a GitHub issue when the token has Issues: Read and write on the target repo. The webhook syncs issue updates back to the ticket.
        </p>

        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          {/* D223 — whether a token is set, and nothing else about it. */}
          GitHub token {cfg?.has_token
            ? <span className="text-emerald-600">· configured</span>
            : <span className="text-gray-500 dark:text-gray-400">· not set</span>}
        </label>
        <SecretWriteGate holds={holdsSecretWrites} what="Changing the token" testid="github-sync-holder-only">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            placeholder={cfg?.has_token ? 'Leave blank to keep the current token' : 'Fine-grained PAT with Issues read/write'}
            className={`${inputClass} mb-1`}
          />
          <p className="text-[11px] text-gray-500 mb-3">Needs <strong>Issues: Read and write</strong> on the target repo. Stored encrypted; never shown again after saving.</p>
        </SecretWriteGate>
        <GithubRepoReadOnly cfg={cfg} />
        {testResult?.can_write === false && testResult?.http_status === 403 && (
          <p className="mb-3 text-sm text-red-700 dark:text-red-300" role="alert">
            In GitHub Settings → Developer settings → Personal access tokens, edit the token used here.
            Select {cfg?.repo_owner} as resource owner, include {cfg?.repo_name}, and set Repository permissions → Issues → Read and write.
            Approve the change in the organization if required, then run Test issue creation again.
            If replacing the token, a Super Admin must save the replacement here first.
            Once the test passes, <a href="/help/tickets" className="underline">retry saved tickets</a> to create their missing issues.
          </p>
        )}

        <div className="flex gap-2 flex-wrap">
          {holdsSecretWrites && (
            <button onClick={onSave} disabled={saving || !token.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1.5">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
            </button>
          )}
          <button onClick={() => onTest(false)} disabled={testing || !cfg?.has_token}
            title={cfg?.has_token ? 'Reach the repo and read its issues — does NOT prove the token can create one' : 'Configure a token first'}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 inline-flex items-center gap-1.5">
            {testing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Test read access
          </button>
          <button onClick={() => onTest(true)} disabled={testing || !cfg?.has_token}
            data-testid="github-write-test"
            title={cfg?.has_token ? 'Create a real issue and close it — the only check that proves the mirror can work' : 'Configure a token first'}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 inline-flex items-center gap-1.5">
            {testing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Test issue creation
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
          Read access is not enough to mirror a ticket. A fine-grained token always carries
          Metadata&nbsp;: Read, so reaching this repo proves nothing about creating issues —
          only <strong>Test issue creation</strong> does, and it opens one real issue and closes it.
        </p>

        {testResult && (
          <div className={`mt-3 text-xs px-3 py-2 rounded-lg border ${testResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            {testResult.ok ? <CheckCircle2 size={13} className="inline mr-1 -mt-0.5" /> : <XCircle size={13} className="inline mr-1 -mt-0.5" />}
            {testResult.detail}
            {testResult.can_write === 'unproven' && (
              <span className="block mt-1 opacity-80">Issue creation: not tested.</span>
            )}
          </div>
        )}
      </div>

      {/* Webhook — manual registration */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-1">Webhook (status sync back)</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Add this webhook in GitHub → the repo → Settings → Webhooks → Add webhook. Set content type to <code className="text-[11px]">application/json</code> and select <strong>“Let me select individual events” → Issues</strong>.
        </p>

        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Payload URL</label>
        <div className="flex gap-2 mb-3">
          <input readOnly value={cfg?.webhook_url || ''} className={`${inputClass} font-mono text-xs`} />
          <button onClick={() => copy(cfg?.webhook_url || '', 'Payload URL')}
            className="shrink-0 px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 inline-flex items-center gap-1.5">
            <Copy size={12} /> Copy
          </button>
        </div>

        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Secret {cfg?.has_webhook_secret && <span className="text-emerald-600">· configured</span>}
        </label>
        {revealedSecret ? (
          <div className="flex gap-2 mb-2">
            <input readOnly value={revealedSecret} className={`${inputClass} font-mono text-xs`} />
            <button onClick={() => copy(revealedSecret, 'Secret')}
              className="shrink-0 px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 inline-flex items-center gap-1.5">
              <Copy size={12} /> Copy
            </button>
          </div>
        ) : (
          <SecretWriteGate holds={holdsSecretWrites} what={cfg?.has_webhook_secret ? 'Rotating the webhook secret' : 'Generating a webhook secret'} testid="github-webhook-holder-only">
            <div className="flex gap-2 mb-2 flex-wrap">
              <button onClick={onRotateSecret}
                className="px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 inline-flex items-center gap-1.5">
                <RefreshCw size={12} /> {cfg?.has_webhook_secret ? 'Rotate secret' : 'Generate secret'}
              </button>
            </div>
          </SecretWriteGate>
        )}
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          The secret is shown only once — when generated or rotated. Copy it into GitHub immediately; if you lose it, rotate to get a new one (and update GitHub to match).
        </p>
      </div>
    </div>
  );
}

export default GithubSyncPanel;

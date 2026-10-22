import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { connectorsApi } from '../../lib/api/connectors';
import { mercuryPersonalApi } from '../../lib/api/mercuryPersonal';
import { safeWriteJSON } from '../../lib/storage';
import { PENDING_LINKEDIN_IMPORT_KEY } from '../../lib/linkedinCsv';
import { successBanner } from './githubSync';
import {
  INTEGRATION_KEYS_HREF, adminKeysHref, authKind, connectFailure, isPersonalMercury, keepBuildProject,
} from './connectorsModel';

/**
 * D753 (#1908, F2) — connecting a connector, one way from every door. The
 * state and the six actions moved here unchanged from `ConnectorPanel`
 * (`ConnectorSheet.jsx`), so the side sheet, Build's "Connect a tool" (which
 * draws the same panel, D686) and the connector's own page
 * (`ConnectorPage.jsx`) start a sign-in, post a key, sync and disconnect
 * through the same code.
 *
 * The caller owns `view` (the sheet's parent opens it on a sign-in's return;
 * the page keeps its own), and hands `view` and `setView` in.
 */

/** Google, Microsoft or LinkedIn's own sign-in; it returns to `returnTo` (Build's lightbox, or the Connectors page). */
export async function startFirstParty(key, returnTo = 'integrations', client = api, projectId = null) {
  const return_to = returnTo === 'build' ? 'build' : 'integrations';
  // From Build, the venture rides in the signed state, so the return names it on any host (#1597).
  const id = Number(projectId);
  const venture = return_to === 'build' && Number.isSafeInteger(id) && id > 0 ? { project_id: id } : {};
  if (key === 'google') {
    const r = await client.googleCalConnect({ return_to, ...venture });
    return r?.redirect_url || r?.auth_url;
  }
  if (key === 'microsoft') {
    const r = await client.microsoftCalConnect({ return_to, ...venture });
    return r?.redirect_url || r?.auth_url || r?.authorize_url;
  }
  const r = await client.linkedinOAuthStart({ return_to, ...venture });
  return r?.authorize_url;
}

/** Disconnect a connector through its own route: the first-party three, or the registry's. */
export async function disconnect(p) {
  if (p.key === 'google') return api.googleCalDisconnect();
  if (p.key === 'microsoft') return api.microsoftCalDisconnect();
  if (p.key === 'linkedin') return api.linkedinDisconnect();
  return connectorsApi.disconnect(p.connection.uid);
}

/**
 * `opts`: `{ view, setView, onChanged, onClose, returnTo, projectId, companyId, blocked }`.
 * A `blocked` Build project (D686 §5.4) starts nothing, whatever calls it.
 */
export function useConnectFlow(p, { setView, onChanged, onClose, returnTo = null, projectId = null, companyId = null, blocked = false } = {}) {
  // Build acts for its project's company (D686 §5.4); elsewhere, the active one.
  const opts = companyId ? { companyId } : undefined;
  const navigate = useNavigate();
  const conn = p.connection;
  const kind = authKind(p);
  const name = p.display_name;
  const personalMercury = isPersonalMercury(p);
  const [adminHref, setAdminHref] = useState(INTEGRATION_KEYS_HREF);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [configText, setConfigText] = useState(conn?.config && !conn.first_party ? JSON.stringify(conn.config, null, 2) : '');
  const [advanced, setAdvanced] = useState(false);
  const [sfSandbox, setSfSandbox] = useState(false);
  const [dsDemo, setDsDemo] = useState(true);
  const [tool, setTool] = useState(null);

  const go = (v) => { setMessage(''); setView(v); };

  const startOauth = async () => {
    if (blocked) return;
    setBusy(true); setMessage('');
    setView('signin');
    try {
      let url;
      // From Build, the sign-in comes back to /build/connect: the venture is kept for it (D686 §5.4).
      if (returnTo === 'build') keepBuildProject(projectId);
      if (kind === 'first_party') {
        url = await startFirstParty(p.key, returnTo || 'integrations', api, projectId);
      } else if (personalMercury) {
        // D840 (#2346): Mercury's own sign-in route; it returns to /account/connectors/mercury.
        url = (await mercuryPersonalApi.oauthStart())?.authorize_url;
      } else {
        const params = returnTo === 'build' ? { return_to: 'build', ...(Number(projectId) > 0 ? { project_id: String(Number(projectId)) } : {}) } : {};
        if (p.key === 'salesforce') params.sandbox = sfSandbox ? '1' : '';
        // Always demo=0|1: a missing query makes the Worker default to demo.
        if (p.key === 'docusign') params.demo = dsDemo ? '1' : '0';
        const r = await connectorsApi.oauthStart(p.key, params, opts);
        url = r?.authorize_url;
      }
      if (!url) throw Object.assign(new Error(`${name} did not return a sign-in address.`), { status: 0 });
      window.location.assign(url);
    } catch (e) {
      setBusy(false);
      setMessage(e?.message || '');
      setAdminHref(adminKeysHref(e?.data));
      setView(connectFailure(e, { ...p, auth_type: 'oauth2', supports_pat: false }));
    }
  };

  const submitKey = async (e) => {
    e?.preventDefault?.();
    if (blocked) return;
    setMessage('');
    let config;
    // D715: Mercury draws no settings field, so a stored config never rides along unseen.
    if (configText.trim() && p.key !== 'mercury') {
      try { config = JSON.parse(configText); } catch { setMessage('Settings must be valid JSON.'); return; }
    }
    setBusy(true);
    try {
      await connectorsApi.connect({ provider_key: p.key, display_name: conn?.display_name || name, api_key: apiKey || undefined, webhook_secret: p.key === 'mercury' ? undefined : webhookSecret || undefined, config }, opts);
      setApiKey(''); setWebhookSecret('');
      setView('connected');
      onChanged?.();
    } catch (err) {
      setMessage(err?.message || '');
      // The key form's refusal is about the key, so it reads `badkey`, never `refused` (D751 #1881).
      setView(connectFailure(err, { ...p, auth_type: 'api_key' }));
    } finally { setBusy(false); }
  };

  const syncNow = async () => {
    setSyncing(true); setSyncNote('');
    // The Worker's own words for what the sync did, when it says (#1597).
    try { const r = await connectorsApi.sync(conn.uid, opts); setSyncNote(successBanner(p.key, r) || 'Synced.'); onChanged?.(); }
    catch (e) { setSyncNote(e?.message || 'The sync failed.'); }
    finally { setSyncing(false); }
  };

  const doDisconnect = async () => {
    setBusy(true); setMessage('');
    try { await disconnect(p); onChanged?.(); onClose?.(); }
    catch (e) { setMessage(e?.message || 'The connector could not be disconnected.'); }
    finally { setBusy(false); setConfirming(false); }
  };

  const onCsvImported = (rows) => {
    safeWriteJSON(PENDING_LINKEDIN_IMPORT_KEY, { rows, at: Date.now() });
    setTool(null);
    navigate('/refer');
  };

  return {
    busy, message, setMessage, adminHref, go,
    startOauth, submitKey, syncNow, doDisconnect, onCsvImported,
    confirming, setConfirming, syncing, syncNote, tool, setTool,
    sfSandbox, setSfSandbox, dsDemo, setDsDemo,
    // The key form's fields.
    apiKey, setApiKey, webhookSecret, setWebhookSecret, configText, setConfigText,
    advanced, setAdvanced,
  };
}

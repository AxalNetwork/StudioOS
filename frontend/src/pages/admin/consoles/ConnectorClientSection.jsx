import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { connectorClientsApi } from '../../../lib/api/connectorClients.js';

/**
 * D1361 — HQ › Integration keys › Lovable connector. The OAuth client a Lovable
 * workspace's custom connector signs Axal VC members in with. Super Admin only:
 * Create shows the client ID and secret once, with every value Lovable's
 * "Create custom connector" form asks for; Create again replaces the client.
 */
export const LOVABLE_CLIENT_NOTE = 'One OAuth client for every Lovable workspace that adds the Axal VC custom connector. Each member still signs in to Axal VC and chooses which companies Lovable may read; the client alone reads nothing.';
export const LOVABLE_SECRET_ONCE = 'The secret is shown once. Paste it into Lovable when you connect, then close this. Creating a new client stops the old one.';

function Row({ label, value, testid }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <span className="w-40 shrink-0 text-gray-600 dark:text-gray-400">{label}</span>
      <code className="break-all rounded bg-white dark:bg-gray-900 px-1.5 py-0.5 text-gray-900 dark:text-gray-100" data-testid={testid}>{value}</code>
      <button type="button" onClick={() => navigator.clipboard?.writeText(String(value))} className="text-[11px] font-medium underline text-violet-700 dark:text-violet-300">Copy</button>
    </div>
  );
}

export default function ConnectorClientSection({ showToast }) {
  const [state, setState] = useState(undefined); // undefined loading, null unreadable
  const [made, setMade] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => connectorClientsApi.getLovable().then(setState, () => setState(null));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (state?.client_id && !confirm('Create a new Lovable client? The current one stops working, and each Lovable workspace must enter the new ID and secret.')) return;
    setBusy(true);
    try {
      const r = await connectorClientsApi.createLovable();
      setMade(r);
      load();
    } catch (e) {
      showToast?.({ kind: 'err', msg: e.message || 'Could not create the client.' });
    } finally { setBusy(false); }
  };

  const s = made || state;
  return (
    <section className="mt-8" data-testid="integration-keys-lovable-connector">
      <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Lovable connector</h3>
      <p className="mt-1 mb-4 text-xs text-gray-600 dark:text-gray-400">{LOVABLE_CLIENT_NOTE}</p>
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 text-xs">
        {state === undefined && <p className="text-gray-500">Loading…</p>}
        {state === null && <p className="text-gray-700 dark:text-gray-300">Unreadable: the client could not be read. Reload to try again.</p>}
        {s && (
          <>
            <Row label="Authorization URL" value={s.authorization_url} />
            <Row label="Token URL" value={s.token_url} />
            <Row label="Scopes" value={s.scopes} />
            <Row label="Use PKCE" value="On" />
            <Row label="Redirect URL" value={s.redirect_uri} />
            <Row label="API base URL" value={s.api_base_url} />
            <Row label="Test request" value="GET /me" />
            <Row label="Client ID" value={s.client_id || 'Not created yet'} testid="lovable-client-id" />
          </>
        )}
        {made?.client_secret && (
          <div role="status" className="mt-3 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20 p-3" data-testid="lovable-client-secret-once">
            <Row label="Client secret" value={made.client_secret} testid="lovable-client-secret" />
            <p className="mt-1 text-violet-800 dark:text-violet-200">{LOVABLE_SECRET_ONCE}</p>
            <button type="button" onClick={() => setMade(null)} className="mt-2 text-[11px] font-medium underline text-violet-800 dark:text-violet-200">I have copied it</button>
          </div>
        )}
        {state !== undefined && (
          <button type="button" onClick={create} disabled={busy} data-testid="lovable-client-create"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-[12px] font-semibold text-white dark:text-gray-900 disabled:opacity-60">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {state?.client_id ? 'Create a new client' : 'Create the client'}
          </button>
        )}
      </div>
    </section>
  );
}

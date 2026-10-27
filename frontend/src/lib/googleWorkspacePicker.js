/** D1091: browser-owned, drive.file-only Picker token. No token is posted to Axal or persisted. */
export const PICKER_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const PICKER_SRC = 'https://apis.google.com/js/api.js';
let loading;
/** A refusal carries its code on `.code`, as the API client's do (D258). */
const refused = (code) => Object.assign(new Error(code), { code });
export function loadWorkspacePicker() {
  if (globalThis.google?.picker) return Promise.resolve();
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = PICKER_SRC; script.async = true;
    script.onload = () => globalThis.gapi.load('picker', { callback: resolve, onerror: () => { loading = null; reject(refused('picker_unavailable')); } });
    script.onerror = () => { loading = null; script.remove(); reject(refused('picker_unavailable')); };
    document.head.appendChild(script);
  });
  return loading;
}
/** Libraries must be loaded before the press. GIS opens synchronously inside that press. */
export function chooseWorkspaceFiles(config, browser = globalThis) {
  return new Promise((resolve, reject) => {
    const google = browser.google;
    if (!config.configured || !google?.picker || !google?.accounts?.oauth2) { reject(refused('picker_not_ready')); return; }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: config.client_id, scope: PICKER_SCOPE, include_granted_scopes: false,
      error_callback: () => reject(refused('picker_cancelled')),
      callback: (reply) => {
        // A wider token is refused even if Google changed the request's behavior.
        const scopes = String(reply.scope || '').split(/\s+/).filter(Boolean);
        if (reply.error || !reply.access_token || scopes.length !== 1 || scopes[0] !== PICKER_SCOPE) { reject(refused('picker_scope_refused')); return; }
        const view = new google.picker.DocsView().setIncludeFolders(false).setSelectFolderEnabled(false);
        const picker = new google.picker.PickerBuilder().addView(view)
          .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
          .setDeveloperKey(config.api_key).setAppId(config.app_id).setOAuthToken(reply.access_token)
          .setOrigin(browser.location.origin).setCallback((data) => {
            if (data.action === google.picker.Action.PICKED) { picker.dispose?.(); resolve((data.docs || []).map((d) => d.id)); }
            else if (data.action === google.picker.Action.CANCEL) { picker.dispose?.(); resolve([]); }
          }).build();
        picker.setVisible(true);
      },
    });
    client.requestAccessToken({ prompt: 'consent' });
  });
}

/** D5830/D5841: safe sign-in return notices; a URL marker is not proof of a connected account. */
export function connectorPilotReturn(params, provider) {
  if (params.get('provider') !== provider) return null;
  const outcome = params.get('oauth');
  if (outcome === 'error') return 'Sign-in was cancelled, denied or could not be completed. Read the recorded connection status, then reconnect when ready. Nothing was imported or shared.';
  if (outcome === 'rolling_out') return 'This connector is not available yet. No import or sharing was started.';
  if (outcome === 'ok') return 'Sign-in returned. Read the recorded connection and choose or check its source before explicitly importing or syncing. Nothing was imported or shared on return.';
  return null;
}

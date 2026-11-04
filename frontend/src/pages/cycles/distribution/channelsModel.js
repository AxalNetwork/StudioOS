// D4486 (#4486) — Channels columns, honest readings, independent channel/connection states and existing doors.
export const CHANNEL_COLUMNS = ['Channel', 'Status', 'Owner', 'What it’s for', 'Last activity', 'Results'];
export const CHANNEL_KINDS = [
  ['organic', 'Organic'], ['ads', 'Ads'], ['newsletter', 'Newsletter'], ['outreach', 'Outreach'], ['signups', 'Sign-ups'], ['partner', 'Partner'],
];
export const CHANNEL_PILLS = {
  active: { label: 'Active', tone: 'lavender' }, testing: { label: 'Testing', tone: 'amber' }, paused: { label: 'Paused', tone: 'muted' },
};
export const CONNECTION_PILLS = {
  connected: { label: 'Connected', tone: 'positive' }, expired: { label: 'Reconnect', tone: 'amber' },
  error: { label: 'Error', tone: 'negative' }, not_connected: { label: 'Not connected', tone: 'muted' },
  not_offered: { label: 'Not offered yet', tone: 'muted' }, needs_approval: { label: 'Needs approval', tone: 'amber' },
  unreadable: { label: 'Unreadable', tone: 'negative' },
};
export const CHANNEL_DOORS = [
  { label: 'Launch calendar', href: '/grow/launch' }, { label: 'Landing-page builder', href: '/build/brand' }, { label: 'Co-marketing', href: '/comarketing' },
];
export function recorded(value, reason) {
  return value == null ? (String(reason || '').startsWith('Unreadable') ? 'Unreadable' : 'Not recorded') : String(value);
}
export function connectionAction(connection) {
  const allowed = typeof connection?.href === 'string' && (connection.href === '/email' || connection.href === '/account/connectors' || /^\/account\/connectors\/(whatsapp|telegram|mercury)$/.test(connection.href));
  return { disabled: !allowed || connection.status === 'not_offered' || connection.status === 'needs_approval',
    label: connection.status === 'connected' ? 'Disconnect' : ['error', 'unreadable'].includes(connection.status) ? 'Try again' : 'Connect',
    href: allowed ? connection.href : null };
}
export function channelOptions(members) {
  return { owner_user_id: { opts: [{ value: '', label: 'Not assigned' }, ...(members || []).map((m) => ({ value: String(m.user_id), label: m.name || 'Unnamed member' }))] } };
}

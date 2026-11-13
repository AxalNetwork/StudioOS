/** D1491 (#3725) — SY1 accounts, SY5 cursor log and SY6 persisted HQ settings over the mounted core. */
import React, { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import Card from '../../../ui/Card.jsx';
import Lightbox from '../../../ui/Lightbox.jsx';
import Sheet from '../../../ui/Sheet.jsx';
import { CHANNELS, CAPABILITY_LABEL, LOG_ACTION, LOG_OUTCOME, SETTINGS_TYPES, channelOf, channelStatus, safeExternal } from './syndicationModel';
import { useSyndicationRead } from './useSyndicationRead';
import SyndicationState, { BUTTON, INPUT, Refusal, refusalText } from './SyndicationState';

const channelsValid = (v) => Array.isArray(v?.channels) && CHANNELS.every((c) => v.channels.some((r) => r.channel === c.key && typeof r.adapter_ready === 'boolean'));
const settingsValid = (v) => ['approved_events', 'admins'].includes(v?.settings?.hosts) && typeof v.settings.host_accounts === 'boolean' && v.settings.default_channels_by_type && typeof v.settings.default_channels_by_type === 'object' && Object.values(v.settings.default_channels_by_type).every((v) => Array.isArray(v));
const logValid = (v) => Array.isArray(v?.rows) && (v.next === null || Number.isSafeInteger(v.next)) && v.rows.every((r) => Number.isSafeInteger(r.id) && typeof r.channel === 'string');

function ChannelCard({ channel, value, api, reload }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [key, setKey] = useState('');
  const [disconnected, setDisconnected] = useState(false);
  const account = disconnected ? { ...value.account, status: 'disconnected' } : value.account;
  const status = channelStatus(account, { adapterReady: value.adapter_ready });
  const connected = account && account.status !== 'disconnected';
  const run = async (write) => {
    setBusy(true); setError(null);
    try { await write(); setDialog(null); setKey(''); reload(); }
    catch (e) { setError(refusalText(e)); } finally { setBusy(false); }
  };
  const connect = async () => {
    const reply = await api.connect(channel.key, value.auth === 'api_key' ? { api_key: key } : {});
    if (reply?.authorize_url) {
      const url = safeExternal(reply.authorize_url);
      if (!url) throw new Error('The connection address is invalid. Nothing was opened.');
      window.location.assign(url);
    } else if (!reply?.account) throw new Error('The connection response is unreadable. Refresh channels before trying again.');
  };
  return <Card className="flex min-w-0 flex-col gap-3 p-4" data-testid="syndication-channel" data-channel={channel.key}>
    <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-bold text-axal-ink dark:text-gray-100">{channel.name}</h2><span className="rounded-full bg-axal-ground px-2 py-1 text-xs text-axal-ink dark:bg-gray-800 dark:text-gray-100">{status.label}</span></div>
    <p className="text-sm text-axal-ink dark:text-gray-100">{account?.display_name || 'Not connected'}</p>
    <p className="text-sm text-axal-muted dark:text-gray-400">{CAPABILITY_LABEL[value.capability] || 'Posting capability not available yet'} · HQ account</p>
    <p className="text-sm text-axal-muted dark:text-gray-400">{status.line || channel.needs}</p>
    {account?.connected_by_name && <p className="text-xs text-axal-muted dark:text-gray-400">Connected by {account.connected_by_name}{account.connected_at ? ` · ${account.connected_at}` : ''}</p>}
    <label className="flex min-h-11 items-center gap-2 text-sm text-axal-ink dark:text-gray-100"><input type="checkbox" checked={!!account?.default_on} disabled={busy || !value.adapter_ready || account?.status !== 'active'} data-testid={`syndication-default-${channel.key}`} onChange={(e) => { const on = e.target.checked; run(() => api.updateChannel(account.uid, { default_on: on })); }} />Default on for new events</label>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={BUTTON} disabled={busy || !value.adapter_ready || !['oauth', 'api_key'].includes(value.auth)} onClick={() => { setError(null); setDialog(connected ? 'reconnect' : 'connect'); }} data-testid={`syndication-connect-${channel.key}`}>{connected ? 'Reconnect…' : 'Connect…'}</button>
      {connected && <button type="button" className={BUTTON} disabled={busy} onClick={() => { setError(null); setDialog('disconnect'); }} data-testid={`syndication-disconnect-${channel.key}`}>Disconnect…</button>}
    </div>
    <Refusal text={error} />
    {disconnected && <p role="status" className="text-sm text-axal-muted dark:text-gray-400">This account is now disconnected. Connect again to resume posting.</p>}
    {dialog && <Lightbox label={`${dialog} ${channel.name}`} title={dialog === 'disconnect' ? `Disconnect ${channel.name}?` : `Connect ${channel.name}`} onClose={() => { if (!busy) { setDialog(null); setKey(''); } }} footer={<button type="button" className={BUTTON} disabled={busy || (dialog !== 'disconnect' && value.auth === 'api_key' && !key.trim())} data-testid={`syndication-account-confirm-${channel.key}`} onClick={() => run(async () => {
      if (connected) {
        await api.disconnect(account.uid);
        setDisconnected(true);
        if (dialog === 'reconnect') setDialog('connect');
      }
      if (dialog !== 'disconnect') await connect();
    })}>{busy ? 'Saving…' : dialog === 'disconnect' ? 'Disconnect' : dialog === 'reconnect' ? 'Disconnect and reconnect' : 'Continue to connect'}</button>}>
      <div className="space-y-3 p-5 text-sm text-axal-ink dark:text-gray-100">
        {connected && <p>Already posted listings stay up. Pending posts stop. Reconnecting replaces the current account connection.</p>}
        {disconnected && <p>This account is now disconnected. Connect again to resume posting.</p>}
        {dialog !== 'disconnect' && <><p>Connect Axal’s HQ account. Tickets and registrations stay on Axal.</p>{value.auth === 'api_key' ? <label className="flex flex-col gap-1">API key<input type="password" autoComplete="off" className={INPUT} value={key} onChange={(e) => setKey(e.target.value)} /></label> : <p>You will continue to the channel’s authorisation page.</p>}</>}
        <Refusal text={error} />
      </div>
    </Lightbox>}
  </Card>;
}

export function Channels({ api }) {
  const load = useCallback(() => api.channels(), [api]);
  const read = useSyndicationRead(load, channelsValid);
  return <SyndicationState read={read}><div className="space-y-3">
    <p className="text-sm text-axal-ink dark:text-gray-100">Only connected, available channels can post. New selections post on admin approval; adding a channel after approval posts immediately when saved.</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{read.data && CHANNELS.map((c) => <ChannelCard key={c.key} channel={c} value={read.data.channels.find((v) => v.channel === c.key)} api={api} reload={read.reload} />)}</div>
    <Card className="space-y-2 p-4 text-sm text-axal-ink dark:text-gray-100"><h2 className="font-semibold">Posting rules</h2><p>Only public events an admin approves are listed. Private and unlisted events are never posted.</p><p>LinkedIn and Facebook post links. Every listing sends people back to Axal. Axal is the only ticket ledger.</p><p>Attendee import is not enabled. External registration counts are Not recorded.</p></Card>
  </div></SyndicationState>;
}

export function Activity({ api }) {
  const [filters, setFilters] = useState({ event: '', channel: '', outcome: '' });
  const [applied, setApplied] = useState(filters);
  const [cursors, setCursors] = useState([null]);
  const [detail, setDetail] = useState(null);
  const before = cursors[cursors.length - 1];
  const load = useCallback(() => api.log({ ...applied, before, limit: 25 }), [api, applied, before]);
  const read = useSyndicationRead(load, logValid);
  return <div className="space-y-3" data-testid="syndication-log">
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setCursors([null]); setApplied({ ...filters }); }}>
      <label className="flex flex-col gap-1 text-sm text-axal-ink dark:text-gray-100">Event ID<input type="number" min="1" step="1" className={INPUT} value={filters.event} onChange={(e) => setFilters({ ...filters, event: e.target.value })} data-testid="syndication-log-event" /></label>
      <label className="flex flex-col gap-1 text-sm text-axal-ink dark:text-gray-100">Channel<select className={INPUT} value={filters.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value })} data-testid="syndication-log-channel"><option value="">All</option>{CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-sm text-axal-ink dark:text-gray-100">Outcome<select className={INPUT} value={filters.outcome} onChange={(e) => setFilters({ ...filters, outcome: e.target.value })}><option value="">All</option>{Object.entries(LOG_OUTCOME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <button type="submit" className={BUTTON} data-testid="syndication-log-filter">Filter</button>
      <button type="button" className={BUTTON} onClick={read.reload}>Refresh</button>
    </form>
    <SyndicationState read={read}>
      <Card className="p-4">
        <div className="hidden grid-cols-6 gap-2 border-b border-axal-hairline pb-2 text-xs font-semibold uppercase text-axal-muted dark:border-gray-700 dark:text-gray-400 sm:grid">{['Time', 'Event', 'Channel', 'Action', 'Outcome', 'Who'].map((v) => <span key={v}>{v}</span>)}</div>
        {read.data?.rows.length === 0 && <p className="text-sm text-axal-muted dark:text-gray-400" data-testid="syndication-log-empty">No activity matches these filters.</p>}
        {read.data?.rows.map((r) => <article key={r.id} className="grid gap-2 border-b border-axal-hairline py-3 text-sm text-axal-ink last:border-0 dark:border-gray-700 dark:text-gray-100 sm:grid-cols-6">
          <time>{r.at || 'Time not recorded'}</time><span>{r.event ? <Link to={`/admin/events/${r.event.id}`}>{r.event.title || `Event ${r.event.id}`}</Link> : 'No event'}</span><span>{channelOf(r.channel)?.name || r.channel}</span><span>{LOG_ACTION[r.action] || r.action}</span><span>{LOG_OUTCOME[r.outcome] || r.outcome}</span><span>{r.actor_name || 'System'} <button type="button" className="underline" onClick={() => setDetail(r)} data-testid={`syndication-log-detail-${r.id}`}>Details</button></span>
        </article>)}
        <div className="mt-3 flex gap-2"><button type="button" className={BUTTON} disabled={cursors.length === 1} onClick={() => setCursors(cursors.slice(0, -1))}>Newer</button><button type="button" className={BUTTON} disabled={!read.data?.next} onClick={() => setCursors([...cursors, read.data.next])} data-testid="syndication-log-older">Older</button></div>
      </Card>
    </SyndicationState>
    {detail && <Sheet label="Syndication activity" title="Activity details" onClose={() => setDetail(null)}><div className="space-y-2 p-5 text-sm text-axal-ink dark:text-gray-100"><p>{LOG_ACTION[detail.action] || detail.action} · {LOG_OUTCOME[detail.outcome] || detail.outcome}</p><p className="whitespace-pre-wrap break-words">{detail.detail || 'Detail not recorded'}</p><p>HTTP status: {detail.http_status ?? 'Not recorded'}</p></div></Sheet>}
  </div>;
}

function SettingsForm({ initial, api }) {
  const [settings, setSettings] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const toggle = (type, channel, on) => { setSaved(false); setSettings({ ...settings, default_channels_by_type: { ...settings.default_channels_by_type, [type]: [...new Set([...(settings.default_channels_by_type[type] || []).filter((v) => v !== channel), ...(on ? [channel] : [])])] } }); };
  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    try {
      const defaults = Object.fromEntries(Object.entries(settings.default_channels_by_type).map(([k, v]) => [k, v.filter((c) => CHANNELS.some((known) => known.key === c))]));
      const reply = await api.saveSettings({ ...settings, default_channels_by_type: defaults, host_accounts: false });
      if (!settingsValid(reply)) throw new Error('Saved, but the settings response is unreadable. Refresh before editing again.');
      setSettings(reply.settings); setSaved(true);
    } catch (e) { setError(refusalText(e)); } finally { setBusy(false); }
  };
  return <div className="space-y-3" data-testid="syndication-settings">
    <Card className="space-y-3 p-4"><h2 className="font-semibold text-axal-ink dark:text-gray-100">Who may syndicate</h2><fieldset disabled={busy} className="space-y-2 text-sm text-axal-ink dark:text-gray-100">{[['approved_events', 'Any event an admin approves'], ['admins', 'Events by admins only']].map(([v, label]) => <label key={v} className="flex min-h-11 items-center gap-2"><input type="radio" name="hosts" value={v} checked={settings.hosts === v} onChange={() => { setSaved(false); setSettings({ ...settings, hosts: v }); }} />{label}</label>)}</fieldset></Card>
    <Card className="overflow-x-auto p-4"><h2 className="font-semibold text-axal-ink dark:text-gray-100">Default channels per event type</h2><table className="mt-3 min-w-[560px] text-sm text-axal-ink dark:text-gray-100"><thead><tr><th className="text-left">Type</th>{CHANNELS.map((c) => <th key={c.key}>{c.name}</th>)}</tr></thead><tbody>{SETTINGS_TYPES.map((t) => <tr key={t.id}><td>{t.label}</td>{CHANNELS.map((c) => <td key={c.key} className="p-3 text-center"><input type="checkbox" disabled={busy} checked={(settings.default_channels_by_type[t.id] || []).includes(c.key)} aria-label={`${t.label} on ${c.name}`} data-testid={`syndication-setting-${t.id}-${c.key}`} onChange={(e) => toggle(t.id, c.key, e.target.checked)} /></td>)}</tr>)}</tbody></table></Card>
    <p className="text-sm text-axal-muted dark:text-gray-400">HQ accounts only. Hosts cannot connect their own accounts. Attendee import is not enabled.</p>
    <button type="button" className={BUTTON} disabled={busy} onClick={save} data-testid="syndication-settings-save">{busy ? 'Saving…' : 'Save settings'}</button><Refusal text={error} />{saved && <p role="status" className="text-sm text-axal-ink dark:text-gray-100">Settings saved.</p>}
  </div>;
}
export function Settings({ api }) {
  const load = useCallback(() => api.settings(), [api]);
  const read = useSyndicationRead(load, settingsValid);
  return <SyndicationState read={read}>{read.data && <SettingsForm initial={read.data.settings} api={api} />}</SyndicationState>;
}

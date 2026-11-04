/** D1491 (#3725) — SY2/SY3/SY4: explicit choices, pure preview, listing state and honest registration reads. */
import React, { useCallback, useState } from 'react';
import { eventSyndicationApi } from '../../lib/api/eventSyndication';
import Lightbox from '../../ui/Lightbox.jsx';
import Sheet from '../../ui/Sheet.jsx';
import { useSyndicationRead } from '../hq/eventSyndication/useSyndicationRead';
import SyndicationState, { BUTTON, INPUT, Refusal, refusalText } from '../hq/eventSyndication/SyndicationState';
import { CHANNELS, ROW_STATUS, channelOf, charCount, choicesOf, copyOf, copyInvalid, eventReadValid, registrationsText, safeExternal, syncLine } from '../hq/eventSyndication/syndicationModel';

export function useEventChannels(eventId, api = eventSyndicationApi, refresh = null) {
  const load = useCallback(() => api.forEvent(eventId), [api, eventId, refresh]);
  return useSyndicationRead(load, eventReadValid);
}

/** Controlled choices are shared with the approval dialog; toggling never writes. */
export function ChannelChoices({ rows, onChange, disabled = false }) {
  return <div className="space-y-2" data-testid="syndication-choices">
    {!rows.length && <p className="text-sm text-axal-muted dark:text-gray-400">No channel accounts are connected. HQ must connect an account before a channel can be selected.</p>}
    {rows.map((r) => <label key={r.account_uid} className="flex min-h-11 items-center gap-2 text-sm text-axal-ink dark:text-gray-100">
      <input type="checkbox" checked={r.on} disabled={disabled || !r.adapter_ready || r.status === 'posted'} data-testid={`syndication-choice-${r.account_uid}`}
        onChange={(e) => onChange(rows.map((v) => v.account_uid === r.account_uid ? { ...v, on: e.target.checked } : v))} />
      {channelOf(r.channel)?.name || r.channel} · {r.display_name}
      {!r.adapter_ready && <span className="text-axal-muted dark:text-gray-400">Not available yet</span>}
    </label>)}
  </div>;
}

function PanelBody({ eventId, read, api, editable }) {
  const [rows, setRows] = useState(read.data.rows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [preview, setPreview] = useState(null);
  const [withdraw, setWithdraw] = useState(null);
  const invalid = rows.some(copyInvalid);
  const save = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const reply = await api.choose(eventId, choicesOf(rows));
      if (!eventReadValid(reply)) throw new Error('Saved, but the channel response is unreadable. Refresh before making more changes.');
      setRows(reply.rows);
      setNotice(reply.approved ? 'Channels saved. Selected additions are queued to post.' : 'Channels saved. They post when an admin approves this event.');
    } catch (e) { setError(refusalText(e)); } finally { setBusy(false); }
  };
  const act = async (kind, r) => {
    setBusy(true); setError(null); setNotice(null);
    try { await api[kind](eventId, r.uid); setWithdraw(null); read.reload(); }
    catch (e) { setError(refusalText(e)); } finally { setBusy(false); }
  };
  const showPreview = async (r) => {
    setBusy(true); setError(null);
    try {
      const v = await api.preview(eventId, r.account_uid, copyOf(r.overrides));
      if (typeof v?.title !== 'string' || typeof v?.text !== 'string' || !Array.isArray(v?.warnings)) throw new Error('The preview is unreadable.');
      setPreview(v);
    } catch (e) { setError(refusalText(e)); } finally { setBusy(false); }
  };
  const change = (r, key, value) => setRows(rows.map((v) => v.account_uid === r.account_uid ? { ...v, overrides: { ...v.overrides, [key]: value } } : v));
  return <div className="space-y-3">
    {read.data.reason && <p className="text-sm text-axal-muted dark:text-gray-400">{read.data.reason}</p>}
    {editable && <>
      <ChannelChoices rows={rows.filter((r) => CHANNELS.some((c) => c.key === r.channel))} disabled={busy} onChange={(updated) => setRows(rows.map((r) => updated.find((v) => v.account_uid === r.account_uid) || r))} />
      {rows.filter((r) => r.on && r.adapter_ready && r.status !== 'posted' && CHANNELS.some((c) => c.key === r.channel)).map((r) => <fieldset key={r.account_uid} disabled={busy} className="space-y-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-700">
        <legend className="text-sm font-semibold text-axal-ink dark:text-gray-100">{channelOf(r.channel)?.name} copy</legend>
        {['title', 'description', 'ticket_url'].map((key) => {
          const limit = key === 'title' ? r.title_limit : key === 'description' ? r.text_limit : 2000;
          const Field = key === 'description' ? 'textarea' : 'input';
          const count = charCount(r.overrides[key], limit);
          return <label key={key} className="flex flex-col gap-1 text-sm text-axal-ink dark:text-gray-100">{key === 'ticket_url' ? 'Ticket link (https)' : key === 'title' ? 'Title' : 'Description'}
            <Field className={`${INPUT} min-w-0 w-full`} value={r.overrides[key] || ''} onChange={(e) => change(r, key, e.target.value)} aria-invalid={count.over || undefined} data-testid={`syndication-copy-${r.account_uid}-${key}`} />
            <span className="text-xs text-axal-muted dark:text-gray-400">{count.text} · Blank uses the event’s copy.</span>
          </label>;
        })}
        <button type="button" className={BUTTON} disabled={copyInvalid(r)} onClick={() => showPreview(r)} data-testid={`syndication-preview-${r.account_uid}`}>Preview · sends nothing</button>
      </fieldset>)}
      {read.data.approved && <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">This event is already approved. Saving a newly selected channel queues a post immediately.</p>}
      {invalid && <p role="alert" className="text-sm text-red-700 dark:text-red-300">Check the channel limits and use an https ticket link.</p>}
      {choicesOf(rows).length > 0 && <button type="button" className={BUTTON} disabled={busy || invalid} onClick={save} data-testid="syndication-save">{busy ? 'Saving…' : read.data.approved ? 'Save channels and post additions' : 'Save channels'}</button>}
    </>}
    {!editable && !rows.some((r) => r.uid) && <p className="text-sm text-axal-muted dark:text-gray-400">No channel listings recorded.</p>}
    {rows.filter((r) => r.uid).map((r) => <article key={r.uid} className="space-y-1 border-t border-axal-hairline pt-3 text-sm text-axal-ink dark:border-gray-700 dark:text-gray-100">
      <p className="font-semibold">{channelOf(r.channel)?.name || r.channel} · {ROW_STATUS[r.status]?.label || 'Status not recorded'}</p>
      {r.posted_at && <p>Posted {r.posted_at}</p>}
      {safeExternal(r.external_url) && <a href={safeExternal(r.external_url)} target="_blank" rel="noopener noreferrer" className="underline">View listing ↗</a>}
      {syncLine(r, r.channel) && <p>{syncLine(r, r.channel)}</p>}
      {(r.skip_reason || r.last_error) && <p>{r.skip_reason || r.last_error}</p>}
      <p>Registrations: {registrationsText(r.registrations)} · {r.registrations_reason || 'Channel registrations are not imported.'}</p>
      {(r.status === 'failed' || (r.status === 'posted' && r.sync_state === 'failed')) && <button type="button" disabled={busy || !r.adapter_ready} className={BUTTON} onClick={() => act('retry', r)} data-testid={`syndication-retry-${r.uid}`}>Retry</button>}
      {r.status === 'posted' && <button type="button" disabled={busy || !r.adapter_ready} className={BUTTON} onClick={() => setWithdraw(r)} data-testid={`syndication-withdraw-${r.uid}`}>Withdraw…</button>}
    </article>)}
    <Refusal text={error} />
    {notice && <p role="status" className="text-sm text-axal-ink dark:text-gray-100">{notice}</p>}
    {preview && <Sheet label="Channel preview" title="Channel preview · nothing sent" onClose={() => setPreview(null)}><div className="space-y-3 p-5 text-sm text-axal-ink dark:text-gray-100"><h3>{preview.title}</h3><p className="whitespace-pre-wrap break-words">{preview.text}</p>{safeExternal(preview.link) && <a href={safeExternal(preview.link)} target="_blank" rel="noopener noreferrer">{preview.link}</a>}{preview.warnings.map((v, i) => <p key={i}>{v}</p>)}</div></Sheet>}
    {withdraw && <Lightbox label="Withdraw listing" title="Withdraw this listing?" onClose={() => { if (!busy) setWithdraw(null); }} footer={<button type="button" className={BUTTON} disabled={busy} onClick={() => act('withdraw', withdraw)} data-testid="syndication-withdraw-confirm">Confirm withdraw</button>}><p className="p-5 text-sm text-axal-ink dark:text-gray-100">Channels that support removal will remove the listing. A link post may need to be removed on the channel itself.</p><Refusal text={error} /></Lightbox>}
  </div>;
}

export default function EventSyndicationPanel({ eventId, editable = false, api = eventSyndicationApi, refresh = null }) {
  const read = useEventChannels(eventId, api, refresh);
  return <section className="my-3 space-y-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900" data-testid="event-syndication-panel">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-axal-ink dark:text-gray-100">Channels</h3>{!editable && <button type="button" className={BUTTON} onClick={read.reload}>Refresh status</button>}</div>
    <SyndicationState read={read}>{read.data && <PanelBody key={eventId} eventId={eventId} read={read} api={api} editable={editable} />}</SyndicationState>
  </section>;
}

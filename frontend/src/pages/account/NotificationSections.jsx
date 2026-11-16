// D4618 part 2 (#4618): Notifications (board AC-5), moved unchanged out of
// `../SettingsPage.jsx` and loaded with its section (`lazySection`). The
// type × channel matrix reads and writes its own route (D568); Digest &
// categories saves through `notificationSaver` and draws each switch with
// `categorySwitches` (`../../lib/settingsSavers.js`, D4615), so nothing here
// keeps a second store or a second delivery rule. The page lays the pane out:
// the matrix, Newsletters, the push devices, then digest and quiet hours.
import Card from './AccountCard.jsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { categorySwitches, notificationSaver } from '../../lib/settingsSavers';
import { api } from '../../lib/api';
import { Skeleton, Unreadable } from '../../ui';
import { NOTIFICATION_EVENTS, PARTNER_NOTIFICATION_EVENTS } from '../../lib/notificationTypes';
import { Outcome, Switch, useAccountRead } from './AccountCenter';
import { channelOn } from './accountCenterModel';
import { Field, inputCls } from './SettingsFields';

// D336 — `NOTIFICATION_EVENTS` and `PARTNER_NOTIFICATION_EVENTS` live in
// `../lib/notificationTypes` so the bell and `/inbox` label a type the same
// way this matrix does. D333's locked email channels are on those objects.

// Channel keys are the canonical names used by services/notify.{py,ts}.
// `inapp` is kept as an alias-only column for legacy `notification_prefs`
// rows, but the new subsystem reads/writes `in_app`.
//
// D568 — in the canvas's order. Slack is drawn only once it is connected, and
// the reserved SMS column is gone: `NotifyChannel` in notify.ts is in_app,
// email and slack, so an SMS switch could never have been honoured. Push has
// its own column in the matrix, which says it follows in-app.
const NOTIFICATION_CHANNELS = [
  { key: 'in_app', label: 'In-app' },
  { key: 'email', label: 'Email' },
  { key: 'slack', label: 'Slack' },
];


// Wave 2 — notification presets.
//
// The Account canvas says presets "replace" the 17-row matrix. They do not
// replace it here, and that is a deliberate departure: the matrix is the only
// way to say "email me capital calls but not the weekly digest", and a preset
// set cannot express that without becoming a matrix again. Presets are added
// as the fast path ON TOP, and the grid stays for anyone who wants it. Losing
// per-event control to match a canvas would be a downgrade sold as a redesign.
//
// A preset writes the SAME `notification_prefs` JSON the grid writes — there is
// no second storage shape and no migration. `urgent` is defined by which events
// carry money, signature or compliance consequences; everything else is
// informational and can wait for the digest.
const URGENT_EVENT_KEYS = new Set([
  'capital_call_issued', 'capital_call_paid', 'agreement_ready_to_sign',
  'contract_signed', 'kyc_status_change', 'deal_assigned',
  'partner_capital_call_due', 'partner_kyc_block',
]);


const NOTIFICATION_PRESETS = [
  {
    id: 'everything',
    label: 'Everything',
    hint: 'Email and in-app for every event.',
    apply: (key) => ({ email: true, in_app: true, inapp: true }),
  },
  {
    id: 'important',
    label: 'Important only',
    hint: 'Money, signatures and compliance by email; the rest in-app.',
    apply: (key) => (URGENT_EVENT_KEYS.has(key)
      ? { email: true, in_app: true, inapp: true }
      : { email: false, in_app: true, inapp: true }),
  },
  {
    id: 'in_app_only',
    label: 'In-app only',
    hint: 'Nothing lands in your inbox.',
    apply: (key) => ({ email: false, in_app: true, inapp: true }),
  },
  {
    id: 'off',
    label: 'Mute all',
    hint: 'No email, no in-app. Security alerts are always sent regardless.',
    apply: (key) => ({ email: false, in_app: false, inapp: false }),
  },
];


// D568 — THE CANVAS'S TYPE × CHANNEL MATRIX, extended in place rather than
// drawn a second time. Three things changed and the rest did not.
//
// 1. It reads and writes its own route, GET/PUT /notifications/prefs, rather
//    than the copy of `notification_prefs` the page loaded with the root
//    payload and the root PATCH. Same column, read fresh, and a failed read
//    is "Unreadable" instead of a matrix of switches drawn from nothing.
// 2. An unset switch is drawn ON. `resolveChannels` in services/notify.ts
//    delivers a channel unless the stored value is exactly `false`, so the old
//    `!!prefs[type][channel]` showed a new account every switch OFF while
//    every notification was being sent. `channelOn` is that rule.
// 3. The columns are the canvas's: In-app, Email and Push, with Slack beside
//    them once Slack is connected. Push is not a stored channel — notify.ts
//    pushes to registered devices whenever it writes the in-app row — so its
//    column states that per row and has no switch to set. The reserved "SMS ·
//    Coming soon" column is gone: notify.ts has no SMS channel.
//
// Presets, the D333 locks and the partner block are unchanged.
export function NotificationsSection({ data }) {
  const read = useAccountRead(() => api.getNotificationPrefs());
  // What the route served, until this page writes; then what it wrote. Derived
  // in render, so the first frame after the read is already the stored state.
  const served = read.status === 'ready' && read.data?.prefs && typeof read.data.prefs === 'object' ? read.data.prefs : {};
  const [written, setWritten] = useState(null);
  const prefs = written || served;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const setPrefs = (next) => { prefsRef.current = next; setWritten(next); };
  // Task #1 (Slack, 2026-05-10) — Slack column is gated on whether the
  // signed-in user has an active Slack integration. We poll the
  // integrations list once on mount; on failure we treat Slack as
  // disconnected (fail-closed — never invite the user to toggle a
  // channel that won't deliver).
  const [slackConnected, setSlackConnected] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    api.integrationsList().then(res => {
      if (cancelled) return;
      const items = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
      setSlackConnected(items.some(i => i.provider_key === 'slack' && i.status === 'active'));
    }).catch(() => { if (!cancelled) setSlackConnected(false); });
    return () => { cancelled = true; };
  }, []);
  const channels = React.useMemo(
    () => NOTIFICATION_CHANNELS.filter((c) => c.key !== 'slack' || slackConnected),
    [slackConnected],
  );

  const lockedEvent = (eventKey) => {
    const ev = NOTIFICATION_EVENTS.find((e) => e.key === eventKey)
      || PARTNER_NOTIFICATION_EVENTS.find((e) => e.key === eventKey);
    return ev?.lockedChannels || [];
  };

  // One writer for the grid and the presets alike: the whole prefs object, as
  // PUT /notifications/prefs replaces it. Drawn at once, put back if refused.
  const savePrefs = async (next) => {
    const before = prefsRef.current;
    setPrefs(next);
    setSaving(true);
    setOutcome(null);
    try {
      await api.putNotificationPrefs(next);
      setOutcome({ tone: 'ok', text: 'Saved.' });
    } catch (e) {
      setPrefs(before);
      setOutcome({ tone: 'error', text: e?.message || 'Your notification settings could not be saved. Nothing changed.' });
    } finally {
      setSaving(false);
    }
  };

  const setEvent = (eventKey, channel, value) => {
    // Defense in depth: a locked channel ignores the write even if some
    // other path (preset apply, a stale click) tries to flip it off.
    if (lockedEvent(eventKey).includes(channel)) return;
    const prefsNow = prefsRef.current;
    const cur = { ...(prefsNow[eventKey] || {}) };
    cur[channel] = value;
    // Keep `inapp`/`in_app` mirrored so the new bell subsystem and any
    // legacy reader stay consistent during the transition.
    if (channel === 'in_app') cur.inapp = value;
    if (channel === 'inapp') cur.in_app = value;
    const next = { ...prefsNow, [eventKey]: cur };
    savePrefs(next);
  };

  // Two literal templates, so Tailwind emits both: In-app, Email, Push, and
  // Slack when it is connected. Below 32rem of card the canvas's phone rule
  // applies: the type on its own line, its channels two to a row beneath it.
  const rowGrid = channels.length > 2
    ? '@lg:grid-cols-[minmax(0,1fr)_repeat(4,72px)]'
    : '@lg:grid-cols-[minmax(0,1fr)_repeat(3,72px)]';

  const renderTable = (events) => (
    <div className="@container" role="table" aria-label="Notification types and channels">
      <div role="row" className={`hidden border-b border-axal-hairline pb-2 font-mono text-[10.5px] font-semibold tracking-[0.06em] text-axal-muted dark:border-gray-800 dark:text-gray-400 @lg:grid @lg:items-end @lg:gap-2.5 ${rowGrid}`}>
        <span role="columnheader">TYPE</span>
        {channels.map((c) => <span key={c.key} role="columnheader" className="text-center">{c.label.toUpperCase()}</span>)}
        <span role="columnheader" className="text-center" title="Push follows in-app">PUSH<span className="block font-sans text-[9.5px] font-normal tracking-normal normal-case">follows in-app</span></span>
      </div>
      {events.map(ev => (
        <div key={ev.key} role="row" data-testid={`notif-row-${ev.key}`} className={`grid grid-cols-2 items-center gap-x-3 gap-y-2 border-b border-axal-hairline py-2.5 last:border-b-0 dark:border-gray-800 @lg:gap-2.5 ${rowGrid}`}>
          <span role="rowheader" className="col-span-2 text-[13px] font-semibold text-axal-ink dark:text-gray-100 @lg:col-span-1">{ev.label}</span>
          {channels.map(c => {
            const locked = (ev.lockedChannels || []).includes(c.key);
            const checked = locked || channelOn(prefs, ev.key, c.key);
            const disabled = !!c.disabled || locked;
            const title = locked ? 'Always sent — this notification cannot be turned off' : (c.disabled ? c.hint : undefined);
            return (
              <span role="cell" key={c.key} className="flex items-center gap-2 @lg:justify-center">
                <Switch checked={checked} disabled={disabled || saving} onChange={(v) => setEvent(ev.key, c.key, v)}
                  title={title} label={`${ev.label}: ${c.label}`} data-testid={`switch-${ev.key}-${c.key}`} />
                <span className="text-[12px] text-axal-muted dark:text-gray-400 @lg:sr-only">{c.label}{locked ? ' · always sent' : ''}</span>
              </span>
            );
          })}
          <span role="cell" className="flex items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400 @lg:justify-center"
            title="Push follows in-app: it reaches your registered devices whenever the in-app notification is sent.">
            <span className="@lg:sr-only">Push:</span>
            {channelOn(prefs, ev.key, 'in_app') ? 'On' : 'Off'}
          </span>
        </div>
      ))}
    </div>
  );

  // Applying a preset rewrites every event this user can see in one patch —
  // including the partner block when it is shown, so the visible grid and the
  // stored prefs never disagree.
  const applyPreset = (preset) => {
    const keys = [
      ...NOTIFICATION_EVENTS.map((e) => e.key),
      ...(data.role === 'partner' ? PARTNER_NOTIFICATION_EVENTS.map((e) => e.key) : []),
    ];
    const prefsNow = prefsRef.current;
    const next = { ...prefsNow };
    for (const k of keys) {
      const applied = { ...(prefsNow[k] || {}), ...preset.apply(k) };
      for (const lockedChannel of lockedEvent(k)) applied[lockedChannel] = true;
      next[k] = applied;
    }
    savePrefs(next);
  };

  if (read.status === 'loading') {
    return <Card title="Notifications" description="Each type against each channel."><Skeleton.Text lines={5} /></Card>;
  }
  if (read.status === 'unreadable') {
    return (
      <Card title="Notifications" description="Each type against each channel.">
        <Unreadable what="Your notification settings" claim={read.message || 'This is not a claim that any switch is on or off.'} onRetry={read.reload} />
      </Card>
    );
  }

  return (
    <>
      <Card
        title="Notification presets"
        description="A starting point. Every switch below stays editable — a preset just sets them all at once."
      >
        <div className="flex flex-wrap gap-2">
          {NOTIFICATION_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              disabled={saving}
              title={p.hint}
              className="text-left px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-violet-400 transition-colors disabled:opacity-50"
            >
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{p.label}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400">{p.hint}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Notifications" description="Each type against each channel. Devices registered for push are listed below.">
        {renderTable(NOTIFICATION_EVENTS)}
        {!slackConnected && (
          <p className="mt-2 text-[11.5px] text-axal-muted dark:text-gray-400">
            Slack joins this table once it is connected in <a href="/account/connectors/slack" className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Connectors</a>.
          </p>
        )}
        <div className="mt-2"><Outcome outcome={outcome} /></div>
      </Card>
      {data.role === 'partner' && (
        <Card title="Partner notification triggers"
          description="Deal-flow and mandate alerts specific to your partner / LP role.">
          {renderTable(PARTNER_NOTIFICATION_EVENTS)}
        </Card>
      )}
    </>
  );
}


const NOTIF_CATEGORY_KEYS = [
  { key: 'mentions', label: 'Mentions & comments' },
  { key: 'deals', label: 'Deal flow & pipeline' },
  { key: 'calendar', label: 'Calendar & meetings' },
  { key: 'scoring', label: 'Scoring & matches' },
  { key: 'billing', label: 'Billing & invoices' },
  // Task #5 — Personal assistant proactive nudges (Dashboard greeting
  // card + suggested next-actions). Stored in the same JSON columns so
  // the existing /api/settings/notifications endpoint is the source of
  // truth — the assistant reads notif_categories_inapp.proactive_nudges.
  { key: 'proactive_nudges', label: 'Assistant proactive nudges' },
];


// Task #14 — IANA tz list for the Quiet hours timezone picker. Browser
// runtimes ship `Intl.supportedValuesOf('timeZone')`; fall back to a
// sensible default set so older Safari / restricted environments still
// render a usable select.
const TZ_FALLBACK = [
  'UTC', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Athens', 'Europe/Istanbul',
  'Africa/Cairo', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata',
  'Asia/Bangkok', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai',
  'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland',
  'America/Anchorage', 'America/Los_Angeles', 'America/Denver',
  'America/Chicago', 'America/New_York', 'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
];

function listTimezones() {
  try {
    const list = Intl.supportedValuesOf?.('timeZone');
    if (Array.isArray(list) && list.length) return list;
  } catch { /* noop */ }
  return TZ_FALLBACK;
}


export function DigestQuietHoursCard({ flash }) {
  const [row, setRow] = useState(null);
  const [err, setErr] = useState(null);
  // Task #14 — per-field inline error messages from the worker.
  const [fieldErrors, setFieldErrors] = useState({});
  const tzList = useMemo(() => listTimezones(), []);
  // D4615 — saves go one at a time with the revision read (see PrivacyCoreCard).
  const saver = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.getNotificationSettings()
      .then(r => {
        if (cancelled) return;
        // Default tz from the user's profile if quiet_hours_tz hasn't been
        // explicitly set yet — a much friendlier first-run experience.
        let next = { ...r };
        if (!next.quiet_hours_tz) {
          try {
            const cached = JSON.parse(localStorage.getItem('user') || '{}');
            if (cached?.timezone) next.quiet_hours_tz = cached.timezone;
          } catch { /* noop */ }
        }
        saver.current = notificationSaver(next, setRow, flash, setFieldErrors);
        setRow(saver.current.view);
      })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load notification settings'); });
    return () => { cancelled = true; };
  }, []);

  const save = (delta) => {
    setFieldErrors({});
    saver.current?.save(delta);
  };
  const busy = false;

  if (err) return <Card title="Digest & quiet hours"><div className="text-sm text-red-600">{err}</div></Card>;
  if (!row) return <Card title="Digest & quiet hours"><div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div></Card>;

  // D4615 — drawn as delivery reads it: the server's effective switches (unset is on, a mandatory category is
  // always on and locked), under this tab's own unsent choices. A save sends only the one category it changes.
  const effective = categorySwitches(row);
  const setCategory = (channel, key, value) => {
    if (channel === 'email') save({ notif_categories_email: { [key]: value } });
    else save({ notif_categories_inapp: { [key]: value } });
  };

  return (
    <>
      <Card title="Digest & categories"
        description="Roll-up email cadence, plus per-category overrides. Quiet hours below silence push notifications during your stated window.">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Digest frequency"
            hint="Send a daily digest at 9 AM (your time) — non-critical updates collected into a single email instead of arriving one-by-one.">
            <select value={row.digest_frequency || 'weekly'}
              onChange={e => save({ digest_frequency: e.target.value }, 'digest_frequency')} disabled={busy} className={inputCls}>
              <option value="off">Off</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            {fieldErrors.digest_frequency && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.digest_frequency}</p>
            )}
          </Field>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="text-left px-2 py-2 font-medium">Category</th>
                <th className="text-center px-2 py-2 font-medium">Email</th>
                <th className="text-center px-2 py-2 font-medium">In-app</th>
              </tr>
            </thead>
            <tbody>
              {NOTIF_CATEGORY_KEYS.map(c => (
                <tr key={c.key} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="px-2 py-2 text-gray-800 dark:text-gray-200">{c.label}</td>
                  <td className="text-center px-2 py-2">
                    <input type="checkbox" checked={effective.email[c.key]} disabled={busy || effective.locked.has(c.key)}
                      title={effective.locked.has(c.key) ? 'Always sent' : undefined} aria-label={`${c.label} by email`}
                      onChange={e => setCategory('email', c.key, e.target.checked)}
                      className="w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500" />
                  </td>
                  <td className="text-center px-2 py-2">
                    <input type="checkbox" checked={effective.inapp[c.key]} disabled={busy || effective.locked.has(c.key)}
                      title={effective.locked.has(c.key) ? 'Always sent' : undefined} aria-label={`${c.label} in-app`}
                      onChange={e => setCategory('inapp', c.key, e.target.checked)}
                      className="w-4 h-4 text-violet-600 border-gray-300 dark:border-gray-600 rounded focus:ring-violet-500" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Quiet hours"
        description="Push and non-critical email are paused during this window. Critical alerts (security, billing, contract signing) always come through. Leave both blank to disable.">
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Start (HH:MM)">
            <input type="time" value={row.quiet_hours_start || ''}
              onChange={e => setRow({ ...row, quiet_hours_start: e.target.value })}
              onBlur={() => save({ quiet_hours_start: row.quiet_hours_start || null }, 'quiet_hours_start')}
              className={inputCls} />
            {fieldErrors.quiet_hours_start && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.quiet_hours_start}</p>
            )}
          </Field>
          <Field label="End (HH:MM)">
            <input type="time" value={row.quiet_hours_end || ''}
              onChange={e => setRow({ ...row, quiet_hours_end: e.target.value })}
              onBlur={() => save({ quiet_hours_end: row.quiet_hours_end || null }, 'quiet_hours_end')}
              className={inputCls} />
            {fieldErrors.quiet_hours_end && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.quiet_hours_end}</p>
            )}
          </Field>
          <Field label="Timezone">
            <select value={row.quiet_hours_tz || ''}
              onChange={e => save({ quiet_hours_tz: e.target.value || null }, 'quiet_hours_tz')}
              disabled={busy} className={inputCls}>
              <option value="">UTC (default)</option>
              {tzList.map(tz => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
            {fieldErrors.quiet_hours_tz && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.quiet_hours_tz}</p>
            )}
          </Field>
        </div>
      </Card>
    </>
  );
}

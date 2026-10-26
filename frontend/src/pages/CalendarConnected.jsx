import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { calendarConnectionsApi } from '../lib/api/calendarConnections';
import { connectorsApi } from '../lib/api/connectors';
import { Lightbox } from '../ui';
import BrandIcon from '../ui/BrandIcon.jsx';
import {
  CONNECTED_PATH, GOOGLE_PATH, OPTIONS, STATES, connectionRow, connectorState, disconnectCopy, disconnectRefusal,
  gmailStillGranted, googleAbilities, maskedLink, pillText, stamp, subscribeState,
} from './calendarConnectedModel';

/**
 * D1212 (#3178, part 7 of #2420) — the connected calendars at
 * /calendar/connected (CAL9; a page on a phone, CAL21d), Google's own panel at
 * /calendar/connected/google (CAL10), the disconnect dialog (CAL10d), and
 * Subscribe (CAL11). The page (`CalendarPage.jsx`) owns the two status reads
 * and passes them in, so its push and Meet controls and these rows read one
 * answer. Every change opens a dialog here that says what it changes; never a
 * browser pop-up. No email is drawn but the member's own Google account.
 */

const BRAND = { google: 'google_calendar', microsoft: 'microsoft_365', calendly: 'calendly', zoom: 'zoom' };
const TONE = { n: '', g: 'cal-nr-ok', a: 'cal-nr-warn', r: 'cal-nr-bad' };

function Pill({ state, status, testId }) {
  return <span className={`cal-nr ${TONE[STATES.find((s) => s.key === state)?.tone] ?? ''}`} data-testid={testId}>{pillText(state, status)}</span>;
}

async function startConnect(provider, setSaid) {
  try {
    const r = provider === 'google' ? await api.googleCalConnect() : await api.microsoftCalConnect();
    window.location.assign(r.redirect_url || r.auth_url);
  } catch (e) {
    // The Worker's code decides the sentence; its missing settings are an admin's, not shown here.
    setSaid(e?.data?.code === 'oauth_config_missing'
      ? `${provider === 'google' ? 'Google' : 'Outlook'} is not set up on Axal yet, so it cannot be connected.`
      : 'The connection could not be started. Try again.');
  }
}

async function runCopy(provider, setSaid, reload) {
  setSaid('Copying…');
  try {
    const r = provider === 'google' ? await api.googleCalSync() : await api.microsoftCalSync();
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    const parts = [[n(r?.pushed), 'new'], [n(r?.updated), 'updated'], [n(r?.failed), 'failed']].filter(([v]) => v != null);
    setSaid(parts.length ? `Copied: ${parts.map(([v, w]) => `${v} ${w}`).join(', ')}.` : 'Copied.');
  } catch {
    setSaid('The copy did not finish. Its state below says why.');
  }
  await reload();
}

/** CAL9 / CAL21d: the four calendars, the six states and what each option does. */
export function ConnectedPanel({ google, microsoft, gState, mState, reloadGoogle, reloadMicrosoft, onClose }) {
  const [connections, setConnections] = useState(undefined);
  const [said, setSaid] = useState({});
  const [disconnecting, setDisconnecting] = useState(null);
  const readConnections = useCallback(async () => {
    try { const r = await connectorsApi.list(); setConnections(Array.isArray(r?.items) ? r.items : null); }
    catch { setConnections(null); }
  }, []);
  useEffect(() => { readConnections(); }, [readConnections]);
  const say = (k) => (text) => setSaid((s) => ({ ...s, [k]: text }));
  const rows = [
    connectionRow('google', gState, google),
    connectionRow('microsoft', mState, microsoft),
    connectionRow('calendly', connectorState(connections, 'calendly')),
    connectionRow('zoom', connectorState(connections, 'zoom')),
  ];
  const reloadOf = { google: reloadGoogle, microsoft: reloadMicrosoft, calendly: readConnections, zoom: readConnections };
  const act = (row, a) => {
    if (a.key === 'connect') return startConnect(row.key, say(row.key));
    if (a.key === 'sync') return runCopy(row.key, say(row.key), reloadOf[row.key]);
    if (a.key === 'retry') return reloadOf[row.key]?.();
    if (a.key === 'disconnect') return setDisconnecting(row.key);
    return null;
  };
  return (
    <Lightbox label="Connected calendars" eyebrow="Calendar" title="Connected calendars" width={600}
      sub="Copy what is booked here into your own calendar, or bring bookings in." onClose={onClose} testId="cal-connected">
      <div className="cal-conn" data-testid="cal-connected-body">
        <ul className="cal-conn-list">
          {rows.map((row) => (
            <li key={row.key} className="cal-conn-row" data-testid={`cal-conn-${row.key}`} data-state={row.state}>
              <span className="cal-logo" aria-hidden="true"><BrandIcon provider={BRAND[row.key]} name={row.name} size={24} /></span>
              <div className="cal-conn-text">
                <strong>{row.name}</strong>
                <p data-testid={`cal-conn-${row.key}-sub`}>{row.sub}</p>
                {said[row.key] ? <p role="status" className="cal-conn-said" data-testid={`cal-conn-${row.key}-said`}>{said[row.key]}</p> : null}
              </div>
              <div className="cal-conn-side">
                <Pill state={row.state} status={row.key === 'google' ? google : row.key === 'microsoft' ? microsoft : null} testId={`cal-conn-${row.key}-pill`} />
                <div className="cal-conn-actions">
                  {row.actions.map((a) => (a.to
                    ? <Link key={a.key} to={a.to} className="cal-btn cal-btn-o cal-btn-sm" data-testid={`cal-conn-${row.key}-${a.key}`}>{a.label}</Link>
                    : <button key={a.key} type="button" className={`cal-btn ${a.primary ? 'cal-btn-p' : 'cal-btn-o'} cal-btn-sm`} onClick={() => act(row, a)} data-testid={`cal-conn-${row.key}-${a.key}`}>{a.label}</button>))}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <section className="cal-sect" data-testid="cal-conn-states">
          <div className="cal-eb">States a calendar can be in</div>
          <div className="cal-states">{STATES.map((s) => <Pill key={s.key} state={s.key} />)}</div>
        </section>
        <section className="cal-sect" data-testid="cal-conn-options">
          <div className="cal-eb">What each option does</div>
          <dl className="cal-does">
            {OPTIONS.map(([k, v]) => <div key={k}><dt className="cal-eb">{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </section>
      </div>
      {disconnecting ? (
        <DisconnectDialog provider={disconnecting} onClose={() => setDisconnecting(null)}
          onDone={async (text) => { setDisconnecting(null); say(disconnecting)(text); await reloadOf[disconnecting](); }} />
      ) : null}
    </Lightbox>
  );
}

/** CAL10: what Axal VC can do with Google, the old Gmail grant, and Disconnect. */
export function GooglePanel({ google, gState, reloadGoogle, onClose }) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [gmail, setGmail] = useState(false);
  const [said, setSaid] = useState('');
  const last = stamp(google?.last_synced_at);
  const connected = gState === 'connected' || gState === 'failed';
  return (
    <Lightbox label="Google connection" eyebrow="Connected calendars" title="Google connection" width={600}
      sub={connected ? (last ? `Last copy ${last}.` : 'No copy has run yet.') : connectionRow('google', gState, google).sub}
      onClose={onClose} testId="cal-google">
      <div className="cal-conn" data-testid="cal-google-body">
        <div className="cal-conn-head">
          <Pill state={gState} status={google} testId="cal-google-pill" />
          {connected && google?.google_email ? <span className="cal-mono" data-testid="cal-google-account">{google.google_email}</span> : null}
        </div>
        {said ? <p role="status" className="cal-conn-said" data-testid="cal-google-said">{said}</p> : null}
        {connected ? (
          <>
            <section className="cal-sect" data-testid="cal-google-abilities">
              <h3>What Axal VC can do with this Google connection</h3>
              {googleAbilities(google).map((a) => (
                <div key={a.key} className="cal-cap-row" data-testid={`cal-google-${a.key}`}>
                  <div><p>{a.text}</p>{a.sub ? <p className="cal-conn-sub">{a.sub}</p> : null}</div>
                  {a.to ? <Link to={a.to} className="cal-btn cal-btn-q cal-btn-sm">{a.link}</Link>
                    : a.pill ? <span className="cal-nr">{a.pill}</span>
                      : <span className={`cal-mono cal-cap-val${a.ok ? ' is-ok' : ''}`}>{a.value}</span>}
                </div>
              ))}
            </section>
            {gmailStillGranted(google) ? (
              <section className="cal-sect">
                <div className="cal-noterow" data-testid="cal-google-gmail">
                  <span aria-hidden="true">!</span>
                  <div>
                    <p>An older connection also allowed reading Gmail. Axal VC never used it.</p>
                    <p className="cal-conn-sub">Removing it reconnects Google without Gmail.</p>
                  </div>
                  <button type="button" className="cal-btn cal-btn-o cal-btn-sm" onClick={() => setGmail(true)} data-testid="calendar-remove-gmail-access">Remove Gmail access</button>
                </div>
              </section>
            ) : null}
            <section className="cal-sect">
              <div><button type="button" className="cal-btn cal-btn-d" onClick={() => setDisconnecting(true)} data-testid="cal-google-disconnect">Disconnect Google</button></div>
              <p className="cal-conn-sub">Disconnecting asks first, in a dialog.</p>
            </section>
          </>
        ) : gState === 'off' ? (
          <div><button type="button" className="cal-btn cal-btn-p" onClick={() => startConnect('google', setSaid)} data-testid="cal-google-connect">Connect Google</button></div>
        ) : gState === 'unreadable' ? (
          <div><button type="button" className="cal-btn cal-btn-o" onClick={reloadGoogle} data-testid="cal-google-retry">Try again</button></div>
        ) : null}
        <p className="cal-conn-sub"><Link to={CONNECTED_PATH} className="cal-link">‹ All connected calendars</Link></p>
      </div>
      {disconnecting ? (
        <DisconnectDialog provider="google" onClose={() => setDisconnecting(false)}
          onDone={async (text) => { setDisconnecting(false); setSaid(text); await reloadGoogle(); }} />
      ) : null}
      {gmail ? <GmailDialog onClose={() => setGmail(false)} /> : null}
    </Lightbox>
  );
}

/** CAL10d: the copies are kept by default; "Remove the copies first" removes them before access ends. */
export function DisconnectDialog({ provider, onClose, onDone, connectionsApi = calendarConnectionsApi }) {
  const copy = disconnectCopy(provider);
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const go = async () => {
    setBusy(true); setRefusal(null);
    try {
      const r = provider === 'google'
        ? await connectionsApi.disconnectGoogle({ removeCopies: remove })
        : await connectionsApi.disconnectMicrosoft({ removeCopies: remove });
      onDone(`${provider === 'google' ? 'Google' : 'Outlook'} is disconnected. ${r?.copies === 'removed' ? 'Its copies were removed first.' : 'Its copies stay in your calendar.'}`);
    } catch (e) {
      setRefusal(disconnectRefusal(e));
    }
    setBusy(false);
  };
  const local = async () => {
    setBusy(true);
    try {
      await api.googleCalForceDisconnect();
      onDone('Disconnected here. Google did not confirm it, so check Axal VC is gone from your Google Account’s access list.');
    } catch {
      setRefusal({ text: 'It could not be disconnected here either. Try again.', local: true });
    }
    setBusy(false);
  };
  const footer = (
    <div className="cal-dlg-btns">
      <button type="button" className="cal-btn cal-btn-o" onClick={onClose} disabled={busy}>Back</button>
      {refusal?.local ? <button type="button" className="cal-btn cal-btn-o" onClick={local} disabled={busy} data-testid="calendar-force-disconnect">Disconnect locally</button> : null}
      <button type="button" className="cal-btn cal-btn-d" onClick={go} disabled={busy} data-testid="cal-disconnect-go">{busy ? 'Disconnecting…' : 'Disconnect'}</button>
    </div>
  );
  return (
    <Lightbox label={copy.title} title={copy.title} sub={copy.note} onClose={onClose} width={520} phone="sheet" footer={footer} testId="cal-disconnect">
      <div className="cal-conn">
        <ul className="cal-bullets">{copy.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
        <fieldset className="cal-sect">
          <legend className="cal-eb">The copies in your calendar</legend>
          {[['keep', false], ['remove', true]].map(([k, v]) => (
            <label key={k} className="cal-radio" data-testid={`cal-disconnect-${k}`}>
              <input type="radio" name="copies" checked={remove === v} onChange={() => setRemove(v)} />
              <span><strong>{copy[k].label}</strong><span className="cal-conn-sub">{copy[k].sub}</span></span>
            </label>
          ))}
        </fieldset>
        {refusal ? <p role="alert" className="cal-alert-line" data-testid="cal-disconnect-refused">{refusal.text}</p> : null}
      </div>
    </Lightbox>
  );
}

/** Removing the old Gmail grant reconnects Google without it: said first, then Google's consent. */
function GmailDialog({ onClose }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.googleCalRemoveGmailAccess();
      window.location.assign(r.redirect_url || r.auth_url);
    } catch {
      setSaid('Gmail access could not be removed. Try again.');
      setBusy(false);
    }
  };
  const footer = (
    <div className="cal-dlg-btns">
      <button type="button" className="cal-btn cal-btn-o" onClick={onClose} disabled={busy}>Back</button>
      <button type="button" className="cal-btn cal-btn-p" onClick={go} disabled={busy} data-testid="cal-gmail-go">{busy ? 'Removing Gmail access…' : 'Remove Gmail access'}</button>
    </div>
  );
  return (
    <Lightbox label="Remove Gmail access?" title="Remove Gmail access?" sub="Google withdraws the old grant, Calendar disconnects for a moment, and Google asks you to connect again without Gmail."
      onClose={onClose} width={480} phone="sheet" footer={footer} testId="cal-gmail">
      {said ? <p role="alert" className="cal-alert-line">{said}</p> : null}
    </Lightbox>
  );
}

/** CAL11: the private, read-only link to the whole calendar. The link is shown hidden, once, and copied. */
export function SubscribeDialog({ onClose, connectionsApi = calendarConnectionsApi, clipboard = null }) {
  const [read, setRead] = useState(undefined);
  const [made, setMade] = useState(null);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const load = useCallback(async () => {
    setRead(undefined);
    try { setRead(await connectionsApi.subscription()); } catch { setRead(null); }
  }, [connectionsApi]);
  useEffect(() => { load(); }, [load]);
  const state = subscribeState(read, made);
  const make = async () => {
    setBusy(true); setSaid('');
    try {
      const r = await connectionsApi.makeSubscription();
      setMade(r); setShown(false);
      setSaid(r?.replaced ? 'A new link is made. The old one has stopped working.' : 'Your link is made. Copy it now: it is shown only this once.');
    } catch { setSaid('The link could not be made. Try again.'); }
    setBusy(false);
  };
  const off = async () => {
    setBusy(true); setSaid('');
    try { await connectionsApi.turnOffSubscription(); setMade(null); setSaid('The link is off. Calendars that followed it stop updating.'); await load(); }
    catch { setSaid('The link could not be turned off. Try again.'); }
    setBusy(false);
  };
  const copyLink = async () => {
    try { await (clipboard || globalThis.navigator?.clipboard).writeText(made.url); setSaid('Copied.'); }
    catch { setShown(true); setSaid('It could not be copied for you. Select the link below and copy it.'); }
  };
  const footer = (
    <div className="cal-dlg-btns">
      {state === 'on' || state === 'made' ? <button type="button" className="cal-btn cal-btn-o" onClick={off} disabled={busy} data-testid="cal-sub-off">Turn off</button> : null}
      {state === 'on' || state === 'made'
        ? <button type="button" className="cal-btn cal-btn-o" onClick={make} disabled={busy} data-testid="cal-sub-rotate">Make a new link</button>
        : state === 'off' ? <button type="button" className="cal-btn cal-btn-p" onClick={make} disabled={busy} data-testid="cal-sub-make">Make a link</button> : null}
    </div>
  );
  return (
    <Lightbox label="Subscribe to your StudioOS calendar" title="Subscribe to your StudioOS calendar" sub="A private link any calendar app can follow. It is read only."
      onClose={onClose} width={580} phone="sheet" footer={footer} testId="cal-subscribe">
      <div className="cal-conn">
        <section className="cal-sect">
          {state === 'reading' ? <p className="cal-conn-sub">Reading…</p> : null}
          {state === 'unreadable' ? (
            <p className="cal-alert-line" data-testid="cal-sub-unreadable">Whether your link is on could not be read. This is not a claim that it is off. <button type="button" className="cal-link" onClick={load}>Try again</button></p>
          ) : null}
          {state === 'off' ? <p data-testid="cal-sub-none">No link is on. Make one to follow this calendar from Google, Outlook or Apple Calendar.</p> : null}
          {state === 'on' ? (
            <p data-testid="cal-sub-on">A link is on, made {stamp(read.created_at) || 'on a day not recorded'}{read.last_used_at ? `, last followed ${stamp(read.last_used_at)}` : ', not followed yet'}. It is shown only when it is made: make a new link to copy one, and the old one stops.</p>
          ) : null}
          {state === 'made' ? (
            <div className="cal-link-row" data-testid="cal-sub-link">
              <span className="cal-mono">{maskedLink(made.url)}</span>
              <button type="button" className="cal-btn cal-btn-o cal-btn-sm" onClick={copyLink} data-testid="cal-sub-copy">Copy</button>
            </div>
          ) : null}
          {state === 'made' && shown ? <input className="cal-link-input" readOnly value={made.url} aria-label="Your private calendar link" data-testid="cal-sub-raw" /> : null}
          {said ? <p role="status" className="cal-conn-said" data-testid="cal-sub-said">{said}</p> : null}
          <div className="cal-noterow"><span aria-hidden="true">!</span><p>Anyone with this link can read your calendar. Do not share it.</p></div>
          <p className="cal-conn-sub">It shows only what you are part of, never a studio-wide view.</p>
        </section>
        <section className="cal-sect">
          <div className="cal-cap-row">
            <p>Or download a one-off file (.ics) of the next 6 months.</p>
            <a className="cal-btn cal-btn-o cal-btn-sm" href={api.calendarIcsUrl()} data-testid="cal-sub-download">Download .ics</a>
          </div>
          <p className="cal-conn-sub">Make a new link: the old one stops working at once.</p>
        </section>
      </div>
    </Lightbox>
  );
}

/** CAL1's rail card: one line per calendar and Manage, which opens the panel. */
export function ConnectedSummary({ gState, mState, google, microsoft }) {
  const line = (key, state, status) => {
    const last = stamp(status?.last_synced_at);
    if (state === 'connected') return last ? `Copying · last copy ${last}` : 'Copying · no copy yet';
    if (state === 'failed') return 'The last copy failed';
    if (state === 'off') return `Nothing is written to ${key === 'google' ? 'Google' : 'Outlook'}`;
    if (state === 'unconfigured') return 'Not set up on Axal yet';
    if (state === 'unreadable') return 'Could not be read';
    return 'Checking…';
  };
  return (
    <div className="cal-card cal-conn-sum" data-testid="cal-connected-summary">
      <div className="cal-eb">Connected calendars</div>
      {[['google', 'Google Calendar', gState, google], ['microsoft', 'Outlook', mState, microsoft]].map(([k, name, state, status]) => (
        <div key={k} className="cal-conn-sum-row" data-testid={`calendar-provider-${state}`}>
          <span><strong>{name}</strong><span className="cal-conn-sub">{line(k, state, status)}</span></span>
          <Pill state={state} status={status} />
        </div>
      ))}
      <div className="cal-conn-sum-row">
        <span><strong>Calendly and Zoom</strong><span className="cal-conn-sub">Their state is on the connected calendars page.</span></span>
      </div>
      <Link to={CONNECTED_PATH} className="cal-btn cal-btn-q cal-btn-sm" data-testid="cal-connected-manage">Manage</Link>
    </div>
  );
}

export { CONNECTED_PATH, GOOGLE_PATH };

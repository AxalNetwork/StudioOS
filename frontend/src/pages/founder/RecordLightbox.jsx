import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Lightbox from '../../ui/Lightbox.jsx';
import { api as defaultApi } from '../../lib/api.js';
import { interviewSessionsApi } from '../../lib/api/interviewSessions.js';
import { useActiveCompany } from '../../contexts/ActiveCompanyContext';
import { AssistantEntry } from './AssistantEntry';
import { ConnectPanel, SchedulePanel } from './InterviewChannels';
import { INBOX_HREF } from '../account/channelsModel';
import {
  CONSENTS, DURATIONS, MODES, NOT_STORED, PROVIDERS, SETUP_FIELDS, chipStatus, consentNote, defaultProvider, estimate,
  hasMeetingLink, meetingLinkProblem, modeOf, sessionBody, startState, talkingPoints,
} from './recordSetup.js';

/**
 * Validate › Record a session (D685 §5.5, #1587), as a lightbox over the page
 * the founder is on, at `/validate/record`. It replaces the right-hand sheet
 * D660 built. Design: `design/canvases/integrated/Cycle Overview.dc.html`,
 * `lbOpen`; the rules and the copy are in `recordSetup.js`.
 *
 * AGAINST TODAY'S ROUTES, until D685 §5.1's `POST /sessions` lands (S03-A):
 *   · A picked interview opens its session with `POST /interviews/:id/sessions`.
 *   · A new person is logged first (`POST /progress/discovery/:project`), then
 *     the session opens. If the session cannot open, the interview just made is
 *     deleted again, so a refused Start leaves nothing behind.
 *   · It then opens `/validate/session/:id`, where the session page's own
 *     Start waits. `onStarted` is the caller's. When `/validate/record/live`
 *     exists (S02-B) Start goes there and the second Start goes.
 *   · A field the Worker does not yet store (`SETUP_FIELDS`) is drawn disabled,
 *     with that reason. A choice the Worker would drop is never taken.
 *
 * ONE SEND PER START: `busy` holds the button, and a refusal prints in the
 * Worker's own words. Closing makes no server call.
 */

const CHIP = 'rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet disabled:cursor-not-allowed disabled:opacity-50';
const chip = (on) => `${CHIP} ${on ? 'border-axal-violet bg-axal-lavender text-axal-violet-deep dark:border-violet-400 dark:bg-violet-900/40 dark:text-violet-200' : 'border-axal-hairline bg-white text-axal-ink hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'}`;
const TILE = 'rounded-[9px] border px-2 py-2 text-center text-[12px] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet';
const tile = (on) => `${TILE} ${on ? 'border-axal-violet bg-axal-lavender text-axal-violet-deep dark:border-violet-400 dark:bg-violet-900/40 dark:text-violet-200' : 'border-axal-hairline bg-white text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:text-gray-100'}`;
const LABEL = 'text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink placeholder:text-axal-faint focus:outline-none focus:ring-2 focus:ring-axal-violet/40 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** A radio group of buttons: one tab stop, arrow keys move and choose. */
export function Radios({ label, options, value, onChange, className = 'flex flex-wrap gap-1.5', style = chip, testId }) {
  const enabled = options.filter((o) => !o.disabled);
  const stop = enabled.find((o) => o.value === value) || enabled[0];
  const onKey = (e) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir || enabled.length === 0) return;
    e.preventDefault();
    const at = enabled.findIndex((o) => o.value === value);
    const next = enabled[(at + dir + enabled.length) % enabled.length];
    onChange(next.value);
    const buttons = Array.from(e.currentTarget.parentNode?.querySelectorAll?.('[role="radio"]:not([disabled])') || []);
    buttons[enabled.indexOf(next)]?.focus?.();
  };
  return (
    <div role="radiogroup" aria-label={label} className={className} data-testid={testId}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} aria-disabled={o.disabled || undefined}
          disabled={o.disabled} data-value={o.value} data-testid={testId ? `${testId}-${o.value}` : undefined}
          tabIndex={stop && stop.value === o.value ? 0 : -1} onKeyDown={onKey}
          onClick={() => !o.disabled && onChange(o.value)} className={style(o.value === value)} title={o.title}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children, testId }) {
  return (
    <section className="flex flex-col gap-1.5 px-5 py-3" data-testid={testId}>
      <h3 className={`m-0 ${LABEL}`}>{title}</h3>
      {children}
    </section>
  );
}

export default function RecordLightbox({
  projectId, interview = null, onClose, onStarted, initialModels, initialBoard, channels = null, fields = SETUP_FIELDS,
  initialMode = 'in_person', initialConsent = '', api = defaultApi, sessions = interviewSessionsApi, returnFocusTo,
}) {
  const nameRef = useRef(null);
  const sending = useRef(false); // a second press in the same render must not send again
  const [name, setName] = useState(interview?.interviewee_name || '');
  const [company, setCompany] = useState(interview?.interviewee_company || '');
  const [mode, setMode] = useState(initialMode);
  const [provider, setProvider] = useState(() => defaultProvider(initialMode, channels));
  const [link, setLink] = useState('');
  const [consent, setConsent] = useState(initialConsent);
  const [conversation, setConversation] = useState('');
  const [models, setModels] = useState(initialModels);
  const [live, setLive] = useState(initialModels?.defaults?.live ?? null);
  const [final, setFinal] = useState(initialModels?.defaults?.final ?? null);
  const [minutes, setMinutes] = useState(30);
  const [board, setBoard] = useState(initialBoard);
  const [selected, setSelected] = useState(null); // null: the defaults (the first two), until the founder toggles one
  const [assistant, setAssistant] = useState(false);
  // D684's two other ways in, kept from the sheet this replaces: assign a
  // Telegram or WhatsApp chat to this interview, or schedule a Zoom or Meet
  // call for later. Both need the interview, so a new person goes to the inbox.
  const [chatImport, setChatImport] = useState(false);
  const [scheduleLater, setScheduleLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { company: active } = useActiveCompany() || {};

  useEffect(() => {
    if (initialModels !== undefined) return undefined;
    let alive = true;
    sessions.models().then((r) => {
      if (!alive) return;
      setModels(r); setLive(r?.defaults?.live ?? null); setFinal(r?.defaults?.final ?? null);
    }).catch(() => { if (alive) setModels(null); });
    return () => { alive = false; };
  }, [sessions, initialModels]);

  useEffect(() => {
    if (initialBoard !== undefined || !projectId) return undefined;
    let alive = true;
    api.getValidationBoard(projectId).then((r) => { if (alive) setBoard(r); }).catch(() => { if (alive) setBoard(null); });
    return () => { alive = false; };
  }, [api, projectId, initialBoard]);

  const m = modeOf(mode);
  const chips = PROVIDERS[mode] || [];
  const chosen = chips.find((c) => c.value === provider) || null;
  const status = chosen ? chipStatus(mode, chosen, channels) : null;
  const points = useMemo(() => talkingPoints(board?.hypotheses), [board]);
  const isOn = (p) => (selected ? selected.has(p.id) : p.on);
  const picked = points.filter(isOn);
  const eta = estimate(models, live, final, minutes);
  const state = startState({ mode, consent, name, interview, conversation, hasThread: false });
  const linkProblem = hasMeetingLink(mode, provider) ? meetingLinkProblem(provider, link) : null;
  const ready = state.ok && !linkProblem && !busy;
  const label = m.start;

  const pickMode = (next) => { setMode(next); setProvider(defaultProvider(next, channels)); setLink(''); setError(null); };

  const togglePoint = (p) => setSelected((prev) => {
    const next = new Set(prev ?? points.filter((x) => x.on).map((x) => x.id));
    if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
    return next;
  });

  const submit = async () => {
    if (!ready || sending.current) return;
    sending.current = true;
    setBusy(true); setError(null);
    let made = null;
    try {
      let target = interview;
      if (!target) {
        made = await api.createInterview(projectId, { interviewee_name: name.trim(), interviewee_company: company.trim() || null });
        target = made;
      }
      const body = sessionBody({ mode, consent, live, final, conversation, provider, link, points: picked.map((p) => p.id) }, fields);
      const r = await sessions.create(target.id, body);
      onStarted?.(r.session, target);
    } catch (e) {
      // A refused Start leaves nothing behind: the interview made for it goes too.
      if (made?.id != null) { try { await api.deleteInterview(made.id); } catch { /* the Worker's refusal is the message */ } }
      setError(e?.message || 'The session could not be created.');
      setBusy(false);
      sending.current = false;
    }
  };

  const consentNoteId = 'record-consent-note';
  const modeOptions = MODES.map((x) => ({ value: x.key, label: x.label }));

  return (
    <Lightbox label="Record a session" eyebrow="Validate · Customer research" title="Record a session" sub="It lands in Interviews when you stop."
      onClose={onClose} initialFocus={nameRef} returnFocusTo={returnFocusTo} testId="record-lightbox"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[11.5px] text-axal-faint">Runs on Cloudflare Workers AI</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-[9px] px-3 py-2 text-[12.5px] font-bold text-axal-muted hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800" data-testid="record-cancel">Cancel</button>
            <button type="button" onClick={submit} aria-disabled={!ready || undefined} aria-describedby={ready ? undefined : (m.audio && !CONSENTS.some(([k]) => k === consent) ? consentNoteId : 'record-start-reason')}
              data-testid="record-start" className={ready ? 'rounded-[9px] bg-axal-violet px-3.5 py-2 text-[13px] font-bold text-white hover:bg-axal-violet-deep' : 'cursor-not-allowed rounded-[9px] bg-violet-300 px-3.5 py-2 text-[13px] font-bold text-white dark:bg-violet-900/60 dark:text-violet-300'}>{busy ? 'Starting…' : label}</button>
          </div>
        </div>
      )}>
      <div className="divide-y divide-axal-hairline dark:divide-gray-800">
        <Section title="Who" testId="record-who">
          {interview ? (
            <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="record-who-picked">{[interview.interviewee_name, interview.interviewee_company].filter(Boolean).join(' · ') || 'Name not recorded'}</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">Name
                <input ref={nameRef} className={FIELD} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" data-testid="record-name" />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">Company
                <input className={FIELD} value={company} onChange={(e) => setCompany(e.target.value)} maxLength={120} autoComplete="off" data-testid="record-company" />
              </label>
            </div>
          )}
        </Section>

        <Section title="How" testId="record-how">
          <Radios label="How" options={modeOptions} value={mode} onChange={pickMode} testId="record-mode"
            className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" style={tile} />
          <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="record-mode-note">{m.note}</p>
          {chips.length > 0 && (
            <Radios label="Provider" testId="record-provider" value={provider} onChange={setProvider}
              options={chips.map((c) => { const st = chipStatus(mode, c, channels); return { value: c.value, label: `${c.label} · ${st.word}`, disabled: st.disabled, title: st.disabled ? 'Not available yet' : undefined }; })} />
          )}
          {status?.connectHref && (
            <Link to={status.connectHref} className="w-fit text-[12px] font-semibold text-axal-violet underline dark:text-violet-300" data-testid="record-connect-link">Connect {chosen.label} in Connectors</Link>
          )}
          {hasMeetingLink(mode, provider) && (
            <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">Meeting link
              <input className={FIELD} value={link} onChange={(e) => setLink(e.target.value)} disabled={!fields.meeting_url} placeholder="https://…" inputMode="url" autoComplete="off" data-testid="record-link" aria-invalid={linkProblem ? true : undefined} />
              {!fields.meeting_url ? <span className="font-normal text-axal-faint" data-testid="record-link-note">{NOT_STORED}</span>
                : linkProblem ? <span role="alert" className="font-normal text-red-700 dark:text-red-400">{linkProblem}</span> : null}
            </label>
          )}
          {mode === 'text' && provider === 'paste' && (
            <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">The conversation
              <textarea className={FIELD} rows={6} value={conversation} onChange={(e) => setConversation(e.target.value)} data-testid="record-conversation" />
              <span className="font-normal text-axal-faint">One line each, as “Name: what they said”.</span>
            </label>
          )}
          {mode === 'text' && provider !== 'paste' && (
            <p className="m-0 text-[12px] text-axal-faint" data-testid="record-import-note">
              {chosen && chipStatus(mode, chosen, channels).disabled ? 'Importing from this app is not available yet. Paste the conversation instead.' : 'Pick a chat to import once its app is connected.'}
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
            <button type="button" aria-expanded={assistant} aria-controls="record-assistant" onClick={() => setAssistant((v) => !v)} className="text-[12px] font-semibold text-axal-violet underline dark:text-violet-300" data-testid="record-assistant-link">Send it from your AI assistant</button>
            {interview ? (
              <>
                <button type="button" aria-expanded={chatImport} aria-controls="record-chat-import" onClick={() => setChatImport((v) => !v)} className="text-[12px] font-semibold text-axal-violet underline dark:text-violet-300" data-testid="record-chat-link">Import a Telegram or WhatsApp chat</button>
                <button type="button" aria-expanded={scheduleLater} aria-controls="record-schedule" onClick={() => setScheduleLater((v) => !v)} className="text-[12px] font-semibold text-axal-violet underline dark:text-violet-300" data-testid="record-schedule-link">Schedule the call for later</button>
              </>
            ) : (
              <Link to={INBOX_HREF} className="text-[12px] font-semibold text-axal-violet underline dark:text-violet-300" data-testid="record-inbox-link">Import a chat from your inbox</Link>
            )}
          </div>
          {assistant && <div id="record-assistant" className="-mx-1"><AssistantEntry companyName={active?.company_name || ''} /></div>}
          {interview && chatImport && (
            <div id="record-chat-import" className="-mx-1">
              <ConnectPanel interview={interview} onAssigned={(r) => r?.session_id && onStarted?.({ id: r.session_id }, interview)} />
            </div>
          )}
          {interview && scheduleLater && <div id="record-schedule" className="-mx-1"><SchedulePanel interview={interview} /></div>}
        </Section>

        <Section title="Talking points" testId="record-points">
          {board === undefined ? <p className="m-0 text-[12px] text-axal-faint">Reading your hypotheses…</p>
            : board === null ? <p className="m-0 text-[12px] text-axal-faint" data-testid="record-points-unreadable">Unreadable: your hypotheses could not be read.</p>
              : points.length === 0 ? <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="record-points-none">No hypothesis yet. <Link to="/validate/experiments" className="font-semibold text-axal-violet underline dark:text-violet-300">Add one in Experiments</Link>.</p>
                : (
                  <div className="flex flex-wrap gap-1.5" data-testid="record-point-chips">
                    {points.map((p) => {
                      const on = isOn(p);
                      return <button key={p.id} type="button" aria-pressed={on} disabled={!fields.points} onClick={() => togglePoint(p)} className={chip(on)} data-testid={`record-point-${p.id}`}>{p.text}</button>;
                    })}
                  </div>
                )}
          <p className="m-0 text-[11.5px] text-axal-faint" data-testid="record-points-note">{fields.points ? 'The hypotheses you pick appear in the Talking points drawer while you record.' : NOT_STORED}</p>
        </Section>

        {m.audio && (
          <Section title="Transcript" testId="record-transcript">
            {models === undefined ? <p className="m-0 text-[12px] text-axal-faint">Reading models…</p>
              : models === null ? <p className="m-0 text-[12px] text-axal-faint" data-testid="record-models-unreadable">Unreadable: the model list could not be read.</p>
                : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]"><span className="text-axal-muted dark:text-gray-300">Live captions</span>
                      <Radios label="Live captions" testId="record-live" value={live === null ? '' : live} onChange={(v) => setLive(v || null)}
                        options={[{ value: '', label: 'Off' }, ...(models.live || []).map((x) => ({ value: x.model, label: `${x.label} · ${Number.isFinite(x.price_usd_per_minute) ? `$${x.price_usd_per_minute.toFixed(4)}/min` : 'Not priced'}`, disabled: !x.choosable }))]} />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]"><span className="text-axal-muted dark:text-gray-300">Final transcript</span>
                      <Radios label="Final transcript" testId="record-final" value={final} onChange={setFinal}
                        options={(models.final || []).map((x) => ({ value: x.model, label: `${x.label} · ${Number.isFinite(x.price_usd_per_minute) ? `$${x.price_usd_per_minute.toFixed(4)}/min` : 'Not priced'}`, disabled: !x.choosable }))} />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[13px]"><label htmlFor="record-language" className="text-axal-muted dark:text-gray-300">Language</label>
                      <select id="record-language" disabled={!fields.language} className={`${FIELD} !w-auto`} data-testid="record-language" defaultValue=""><option value="">Detect</option></select>
                    </div>
                    {!fields.language && <p className="m-0 text-[11.5px] text-axal-faint" data-testid="record-language-note">{NOT_STORED}</p>}
                    <div className="flex items-center justify-between gap-2 rounded-[9px] bg-axal-lavender px-3 py-2 text-[12.5px] text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-200" data-testid="record-estimate">
                      <span>{eta.text}</span>
                      <label className="flex items-center gap-1.5 text-[11.5px]"><span className="sr-only">Estimated length</span>
                        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="rounded-md border border-axal-lavender-edge bg-white px-1.5 py-0.5 text-[11.5px] dark:border-violet-800 dark:bg-gray-900" data-testid="record-minutes">
                          {DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
                        </select>
                      </label>
                    </div>
                  </>
                )}
          </Section>
        )}

        <Section title="Consent" testId="record-consent">
          <Radios label="Consent" testId="record-consents" value={consent} onChange={setConsent} className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" style={tile}
            options={CONSENTS.map(([value, text]) => ({ value, label: text }))} />
          <p id={consentNoteId} className={`m-0 text-[11.5px] ${m.audio && !consent ? 'font-semibold text-amber-800 dark:text-amber-300' : 'text-axal-faint'}`} data-testid="record-consent-note">{consentNote(mode, consent)}</p>
        </Section>
      </div>
      <div className="px-5 pb-3">
        {!ready && !(m.audio && !consent) && state.reason && <p id="record-start-reason" className="m-0 text-[11.5px] text-axal-faint" data-testid="record-start-reason">{state.reason}</p>}
        {error && <p role="alert" className="m-0 mt-1 text-[12.5px] font-semibold text-red-700 dark:text-red-400" data-testid="record-error">{error}</p>}
      </div>
    </Lightbox>
  );
}

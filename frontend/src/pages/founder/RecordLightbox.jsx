import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Lightbox from '../../ui/Lightbox.jsx';
import { api as defaultApi } from '../../lib/api.js';
import { interviewSessionsApi } from '../../lib/api/interviewSessions.js';
import { channelsApi } from '../../lib/api/channels.js';
import { cycleValidateApi } from '../../lib/api/cycleValidate.js';
import { useActiveCompany } from '../../contexts/ActiveCompanyContext';
import { AssistantEntry } from './AssistantEntry';
import { SchedulePanel } from './InterviewChannels';
import { assignedSentence, threadRow } from './channelThreads.js';
import {
  CONSENTS, DURATIONS, MODES, NOT_STORED, PROVIDERS, SETUP_FIELDS, STAGE_WORD, assignTarget, callLabel, chipStatus, consentNote,
  defaultProvider, estimate, hasMeetingLink, languageOptions, meetingLinkProblem, modeOf, newStartKey, pipelineRows, sessionBody, setupBody,
  startRefusal, startState, talkingPoints, threadsFor,
} from './recordSetup.js';

/**
 * Validate › Record a session (D685 §5.5, #1587), as a lightbox over the page
 * the founder is on, at `/validate/record`. It replaces the right-hand sheet
 * D660 built. Design: `design/canvases/integrated/Cycle Overview.dc.html`,
 * `lbOpen`; the rules and the copy are in `recordSetup.js`.
 *
 * ONE SETUP CALL (D685 §5.1). Start makes one `POST /sessions`: the Worker
 * creates the interview from Who (or takes the one picked from the recruiting
 * pipeline) and opens its session, under this lightbox's `client_key`, so a
 * repeated Start answers the same pair and a refused one leaves nothing. An
 * interview the lightbox was opened on may already be held, which that call
 * refuses: it opens on `POST /interviews/:id/sessions`, with the same fields.
 *   · Audio hands the draft to the app's recorder (`recorder`), and the caller
 *     opens `/validate/record/live`. Without a recorder, the session's page.
 *   · Text chat pastes the conversation into the same call, or imports a
 *     waiting WhatsApp or Telegram chat (`POST /channels/threads/:uid/assign`).
 *   · 409 `session_active`: the founder is already recording. The Worker's
 *     sentence is printed, with a link back to that recording.
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
  projectId, interview = null, onClose, onStarted, initialModels, initialBoard, channels: initialChannels, fields = SETUP_FIELDS,
  initialMode = 'in_person', initialConsent = '', api = defaultApi, sessions = interviewSessionsApi, channelsSource = channelsApi, returnFocusTo,
  cycle = cycleValidateApi,
  // D685 §5.6 (#1588): the app's recorder, which takes the draft. Without one, Start opens the session page as before.
  recorder = null,
}) {
  // The chips' statuses (#1586): `GET /api/channels` once, unless the caller
  // passed the read. A failed read is null, and the chips then say "Not
  // available yet" rather than guessing (`chipStatus`).
  const [channels, setChannels] = useState(initialChannels === undefined ? null : initialChannels);
  useEffect(() => {
    if (initialChannels !== undefined || !fields.channels) return undefined;
    let alive = true;
    channelsSource.overview()
      .then((r) => { if (alive) setChannels(r || null); })
      .catch(() => { if (alive) setChannels(null); });
    return () => { alive = false; };
  }, [channelsSource, initialChannels, fields.channels]);
  const nameRef = useRef(null);
  const sending = useRef(false); // a second press in the same render must not send again
  const startKey = useRef(null);
  if (startKey.current === null) startKey.current = newStartKey();
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
  const [language, setLanguage] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [board, setBoard] = useState(initialBoard);
  const [selected, setSelected] = useState(null); // null: the defaults (the first two), until the founder toggles one
  const [assistant, setAssistant] = useState(false);
  // Who, picked from the recruiting pipeline (§5.1.7): booked first. Closed until asked for.
  const [picked, setPicked] = useState(null);
  const [pipeline, setPipeline] = useState({ open: false, status: 'idle', rows: [] });
  // A WhatsApp or Telegram chat waiting in the inbox, imported inline under the Text chips.
  const [threads, setThreads] = useState({ status: 'idle', items: [] });
  const [thread, setThread] = useState(null);
  // D684's call for later. A new person is added to the pipeline first, since a call needs an interview.
  const [scheduleLater, setScheduleLater] = useState(false);
  const [planning, setPlanning] = useState({ busy: false, error: null });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [assigned, setAssigned] = useState(null);
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

  const who = interview || picked; // the interview Start lands on; none makes one from Who
  const m = modeOf(mode);
  const chips = PROVIDERS[mode] || [];
  const chosen = chips.find((c) => c.value === provider) || null;
  const status = chosen ? chipStatus(mode, chosen, channels) : null;
  const points = useMemo(() => talkingPoints(board?.hypotheses), [board]);
  const isOn = (p) => (selected ? selected.has(p.id) : p.on);
  const chosenPoints = points.filter(isOn);
  const eta = estimate(models, live, final, minutes);
  // Importing: a Text chip for an app whose chats can be read (not paste, not disabled).
  const importing = mode === 'text' && provider !== 'paste' && !!status && !status.disabled;
  // While importing, the chat is the content: the paste box is not asked for.
  const state = startState({ mode, consent, name, interview: who, conversation, hasThread: importing });
  const blockedReason = importing && !thread && state.ok ? 'Choose a chat to import.' : null;
  const linkProblem = hasMeetingLink(mode, provider) ? meetingLinkProblem(provider, link) : null;
  const ready = state.ok && !blockedReason && !linkProblem && !busy;
  const label = m.start;
  const languages = languageOptions(models, live);

  // The chats waiting for this app, read when its chip is chosen.
  useEffect(() => {
    if (!importing) return undefined;
    let alive = true;
    setThreads({ status: 'loading', items: [] }); setThread(null);
    Promise.resolve().then(() => channelsSource.threads('pending'))
      .then((r) => { if (alive) setThreads({ status: 'ready', items: threadsFor(r, provider) }); })
      .catch(() => { if (alive) setThreads({ status: 'unreadable', items: [] }); });
    return () => { alive = false; };
  }, [importing, provider, channelsSource]);

  const openPipeline = () => {
    const open = !pipeline.open;
    setPipeline((p) => ({ ...p, open }));
    if (!open || pipeline.status === 'ready' || pipeline.status === 'loading' || !projectId) return;
    setPipeline({ open: true, status: 'loading', rows: [] });
    cycle.module(projectId, 'customer-research', { filter: 'stage:pipeline', sort: 'booked' })
      .then((r) => setPipeline({ open: true, status: 'ready', rows: pipelineRows(r) }))
      .catch(() => setPipeline({ open: true, status: 'unreadable', rows: [] }));
  };
  const pick = (row) => { setPicked(row); setPipeline((p) => ({ ...p, open: false })); setRefusal(null); };

  const pickMode = (next) => { setMode(next); setProvider(defaultProvider(next, channels)); setLink(''); setRefusal(null); setThread(null); };
  // Flux transcribes English only: choosing it takes a language it cannot take back to Detect.
  const pickLive = (v) => { const next = v || null; setLive(next); if (!languageOptions(models, next).some((l) => l.code === language)) setLanguage(''); };

  const togglePoint = (p) => setSelected((prev) => {
    const next = new Set(prev ?? points.filter((x) => x.on).map((x) => x.id));
    if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
    return next;
  });

  /**
   * "Schedule the call for later". A call needs an interview: a new person is
   * added to the pipeline, booked, and becomes Who's pick, so Start does not
   * make a second one.
   */
  const scheduleCall = async () => {
    if (scheduleLater) { setScheduleLater(false); return; }
    if (who) { setScheduleLater(true); return; }
    const named = name.trim();
    if (!named) { setPlanning({ busy: false, error: 'Add who you are talking to first.' }); return; }
    setPlanning({ busy: true, error: null });
    let made = null;
    try {
      made = await api.createInterview(projectId, { interviewee_name: named, interviewee_company: company.trim() || null });
      await cycle.setInterviewStage(projectId, made.id, 'booked');
      setPicked({ id: made.id, interviewee_name: made.interviewee_name ?? named, interviewee_company: made.interviewee_company ?? (company.trim() || null), stage: 'booked' });
      setPlanning({ busy: false, error: null });
      setScheduleLater(true);
    } catch (e) {
      // Not left half-made: an interview with no stage would count as held.
      if (made?.id != null) { try { await api.deleteInterview(made.id); } catch { /* the refusal is the message */ } }
      setPlanning({ busy: false, error: e?.message || 'The call could not be planned.' });
    }
  };

  const submit = async () => {
    if (!ready || sending.current) return;
    sending.current = true;
    setBusy(true); setRefusal(null); setAssigned(null);
    // In person and Audio call: the microphone and the AudioContext are asked
    // for inside this click, before anything is awaited, so iOS Safari does not
    // start the context suspended (D685 §5.6.5). A video call asks in its own
    // second click, "Share the call's tab" (§5.8.1).
    const handsOver = !!recorder && m.audio;
    if (handsOver && mode !== 'video') recorder.prepare();
    const person = (r) => ({
      id: r?.id ?? who?.id,
      interviewee_name: r?.interviewee_name ?? who?.interviewee_name ?? name.trim(),
      interviewee_company: r?.interviewee_company ?? who?.interviewee_company ?? (company.trim() || null),
    });
    try {
      if (importing) {
        const r = await channelsSource.assign(thread, assignTarget({ name, company, consent }, { projectId, interview: who }));
        const into = person({ id: r?.interview_id });
        if (r?.session_id != null) { onStarted?.({ id: r.session_id }, into); return; }
        setAssigned(assignedSentence(r, into.interviewee_name));
        setBusy(false); sending.current = false;
        return;
      }
      const setup = { mode, consent, live, final, language, conversation, provider, link, points: chosenPoints.map((p) => p.id), name, company };
      // An interview it was opened on (a row's "Record a session") may already
      // be held, which the setup call refuses: it opens on that interview's own
      // route, with the same fields. A pick from the pipeline, or a new person,
      // is the one setup call.
      const r = interview
        ? await sessions.create(interview.id, { ...sessionBody(setup, fields), client_key: startKey.current })
        : await sessions.open(setupBody(setup, { projectId, interview: picked, clientKey: startKey.current }, fields));
      const into = person(r.interview);
      if (handsOver) {
        recorder.begin({ session: r.session, interview: into, callLabel: r.call_label ?? callLabel(mode, provider), points: Array.isArray(r.points) ? r.points : [], video: mode === 'video' });
        onStarted?.(r.session, into, 'live');
        return;
      }
      onStarted?.(r.session, into);
    } catch (e) {
      recorder?.release();
      setRefusal(startRefusal(e));
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
          {who ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="record-who-picked">
                {[who.interviewee_name, who.interviewee_company].filter(Boolean).join(' · ') || 'Name not recorded'}
                {who.stage && STAGE_WORD[who.stage] ? <span className="ml-1.5 text-[11.5px] text-axal-faint">{`· ${STAGE_WORD[who.stage]}`}</span> : null}
              </p>
              {!interview && <button type="button" onClick={() => { setPicked(null); setScheduleLater(false); }} className="text-[12px] font-semibold text-axal-violet underline dark:text-violet-300" data-testid="record-who-clear">Someone else</button>}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">Name
                  <input ref={nameRef} className={FIELD} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" data-testid="record-name" />
                </label>
                <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">Company
                  <input className={FIELD} value={company} onChange={(e) => setCompany(e.target.value)} maxLength={120} autoComplete="off" data-testid="record-company" />
                </label>
              </div>
              <button type="button" aria-expanded={pipeline.open} aria-controls="record-pipeline" onClick={openPipeline}
                className="w-fit text-[12px] font-semibold text-axal-violet underline dark:text-violet-300" data-testid="record-pipeline-link">or pick from Recruiting pipeline ▾</button>
              {pipeline.open && (
                <div id="record-pipeline" data-testid="record-pipeline">
                  {pipeline.status === 'loading' && <p className="m-0 text-[12px] text-axal-faint">Reading your recruiting pipeline…</p>}
                  {pipeline.status === 'unreadable' && <p className="m-0 text-[12px] text-axal-faint" data-testid="record-pipeline-unreadable">Unreadable: your recruiting pipeline could not be read. This is not a claim that it is empty.</p>}
                  {pipeline.status === 'ready' && pipeline.rows.length === 0 && <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="record-pipeline-none">Nobody is in your recruiting pipeline. Name the person above.</p>}
                  {pipeline.status === 'ready' && pipeline.rows.length > 0 && (
                    <ul className="m-0 list-none divide-y divide-axal-hairline overflow-hidden rounded-[9px] border border-axal-hairline p-0 dark:divide-gray-800 dark:border-gray-700">
                      {pipeline.rows.map((r) => (
                        <li key={r.id}>
                          <button type="button" onClick={() => pick(r)} data-testid={`record-pipeline-${r.id}`}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800">
                            <span className="min-w-0 truncate">{[r.interviewee_name || 'Name not recorded', r.interviewee_company].filter(Boolean).join(' · ')}</span>
                            <span className="shrink-0 text-[11.5px] text-axal-faint">{STAGE_WORD[r.stage]}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
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
          {mode === 'text' && provider !== 'paste' && !importing && (
            <p className="m-0 text-[12px] text-axal-faint" data-testid="record-import-note">Importing from this app is not available yet. Paste the conversation instead.</p>
          )}
          {importing && (
            <div className="flex flex-col gap-1.5" data-testid="record-threads">
              {threads.status === 'loading' && <p className="m-0 text-[12px] text-axal-faint">Reading the chats waiting in your inbox…</p>}
              {threads.status === 'unreadable' && <p className="m-0 text-[12px] text-axal-faint" data-testid="record-threads-unreadable">Unreadable: your waiting chats could not be read. This is not a claim that none is waiting.</p>}
              {threads.status === 'ready' && threads.items.length === 0 && (
                <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="record-threads-none">{status.word === 'Connected'
                  ? `No ${chosen.label} chat is waiting. When a customer writes to your connected ${chosen.label}, the chat appears here.`
                  : `Connect ${chosen.label} first: its chats arrive once it is connected.`}</p>
              )}
              {threads.status === 'ready' && threads.items.length > 0 && (
                <Radios label="The chat to import" testId="record-thread" value={thread} onChange={setThread} className="flex flex-col gap-1.5"
                  style={(on) => `${chip(on)} !rounded-[9px] text-left`}
                  options={threads.items.map((t) => { const row = threadRow(t); return { value: t.uid, label: `${row.name} · ${row.count} · ${row.when}` }; })} />
              )}
              <p className="m-0 text-[11.5px] text-axal-faint">{`Its messages become this interview’s Text session, and new messages in the chat follow.`}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
            <button type="button" aria-expanded={assistant} aria-controls="record-assistant" onClick={() => setAssistant((v) => !v)} className="text-[12px] font-semibold text-axal-violet underline dark:text-violet-300" data-testid="record-assistant-link">Send it from your AI assistant</button>
            <button type="button" aria-expanded={scheduleLater} aria-controls="record-schedule" onClick={scheduleCall} disabled={planning.busy} className="text-[12px] font-semibold text-axal-violet underline dark:text-violet-300" data-testid="record-schedule-link">{planning.busy ? 'Adding them to your pipeline…' : 'Schedule the call for later'}</button>
          </div>
          {planning.error && <p role="alert" className="m-0 text-[12px] font-semibold text-red-700 dark:text-red-400" data-testid="record-schedule-error">{planning.error}</p>}
          {assistant && <div id="record-assistant" className="-mx-1"><AssistantEntry companyName={active?.company_name || ''} /></div>}
          {who && scheduleLater && <div id="record-schedule" className="-mx-1"><SchedulePanel interview={who} /></div>}
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
                      <Radios label="Live captions" testId="record-live" value={live === null ? '' : live} onChange={pickLive}
                        options={[{ value: '', label: 'Off' }, ...(models.live || []).map((x) => ({ value: x.model, label: `${x.label} · ${Number.isFinite(x.price_usd_per_minute) ? `$${x.price_usd_per_minute.toFixed(4)}/min` : 'Not priced'}`, disabled: !x.choosable }))]} />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]"><span className="text-axal-muted dark:text-gray-300">Final transcript</span>
                      <Radios label="Final transcript" testId="record-final" value={final} onChange={setFinal}
                        options={(models.final || []).map((x) => ({ value: x.model, label: `${x.label} · ${Number.isFinite(x.price_usd_per_minute) ? `$${x.price_usd_per_minute.toFixed(4)}/min` : 'Not priced'}`, disabled: !x.choosable }))} />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[13px]"><label htmlFor="record-language" className="text-axal-muted dark:text-gray-300">Language</label>
                      <select id="record-language" disabled={!fields.language} className={`${FIELD} !w-auto`} data-testid="record-language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                        {languages.map((l) => <option key={l.code || 'detect'} value={l.code}>{l.name}</option>)}
                      </select>
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
        {!ready && !(m.audio && !consent) && (state.reason || blockedReason) && <p id="record-start-reason" className="m-0 text-[11.5px] text-axal-faint" data-testid="record-start-reason">{state.reason || blockedReason}</p>}
        {refusal && (
          <p role="alert" className="m-0 mt-1 text-[12.5px] font-semibold text-red-700 dark:text-red-400" data-testid="record-error">
            {refusal.text}
            {refusal.liveHref && <>{' '}<Link to={refusal.liveHref} replace className="underline" data-testid="record-error-live">Return to that recording</Link></>}
          </p>
        )}
        {assigned && <p role="status" className="m-0 mt-1 text-[12.5px] text-emerald-700 dark:text-emerald-300" data-testid="record-assigned">{assigned}</p>}
      </div>
    </Lightbox>
  );
}

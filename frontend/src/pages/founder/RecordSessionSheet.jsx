import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { interviewSessionsApi } from '../../lib/api/interviewSessions.js';
import { useActiveCompany } from '../../contexts/ActiveCompanyContext';
import { AssistantEntry } from './AssistantEntry';

/**
 * Validate › Record a session (D660, #1473), to `design/incoming/Cycle
 * Action.dc.html`, `action=record`: How, With, Talking points, Consent, and the
 * models in the foot.
 *
 * CONSENT IS THE WORKER'S GATE (D657). On an audio channel Start is disabled
 * until consent is `given`, and the foot says why; the Worker refuses `start`
 * with 409 `consent_not_recorded` whatever this sheet shows, and the session
 * page prints that refusal in the Worker's words. Text chat and manual entry
 * record no audio and need no consent.
 *
 * THE MODELS ARE READ, NEVER WRITTEN HERE. Both lists come from
 * `GET /sessions/models`, with the Worker's prices; a model it marks
 * unchoosable (no published price) is shown and cannot be picked.
 */

export const CHANNELS = [
  ['in_person', 'In person'],
  ['video', 'Video call'],
  ['phone', 'Phone call'],
  ['text', 'Text chat'],
  ['manual', 'Manual entry'],
];
export const AUDIO = new Set(['in_person', 'video', 'phone']);
/** D668: not a channel StudioOS records on. The founder's assistant submits the interview (D665). */
export const ASSISTANT = 'assistant';
export const CONSENT_METHODS = [
  ['verbal', 'Said yes, out loud'],
  ['written', 'In writing'],
  ['in_app', 'In the app'],
  ['pre_agreed', 'Agreed beforehand'],
];

/** May this sheet start? Audio needs consent given, and a method for it. */
export function canStart(channel, consent) {
  if (!channel) return false;
  if (!AUDIO.has(channel)) return true;
  return consent?.status === 'given' && CONSENT_METHODS.some(([m]) => m === consent.method);
}

/** "Name: words" lines → messages. A line with no name is the founder's. */
export function parseConversation(raw) {
  return String(raw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const m = /^([^:]{1,80}):\s*(.+)$/.exec(line);
    return m ? { author: m[1].trim(), text: m[2].trim() } : { author: 'Me', text: line };
  });
}

/** Dollars a minute, as the rail prints it. A missing price is not $0. */
export function perMinute(usd) {
  if (!Number.isFinite(usd)) return 'Not priced';
  return `$${usd.toFixed(4)}/min`;
}

const CHIP = 'rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
const chip = (on) => `${CHIP} ${on ? 'border-violet-700 bg-violet-700 text-white dark:border-violet-400 dark:bg-violet-500' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'}`;

function Group({ title, children }) {
  return (
    <section className="border-b border-axal-hairline px-5 py-4 dark:border-gray-800">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-axal-faint">{title}</h3>
      {children}
    </section>
  );
}

/** One model list. `choosable: false` is listed, disabled, and says why. */
export function ModelList({ kind, models, value, onChange, allowOff }) {
  if (models === null) return <p className="text-[12px] text-axal-faint" data-testid={`models-${kind}-unreadable`}>Unreadable: the model list could not be read.</p>;
  if (!models) return <p className="text-[12px] text-axal-faint">Reading models…</p>;
  return (
    <ul className="space-y-1" data-testid={`models-${kind}`}>
      {models.map((m) => (
        <li key={m.model}>
          <label className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-[12px] ${m.choosable ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900' : 'opacity-60'}`}>
            <input type="radio" name={`model-${kind}`} value={m.model} checked={value === m.model} disabled={!m.choosable} onChange={() => onChange(m.model)} />
            <span className="min-w-0 flex-1">
              <span className="font-semibold text-gray-900 dark:text-gray-100">{m.label}</span>
              {(m.tags || []).map((t) => <span key={t} className="ml-1.5 rounded bg-gray-100 px-1 text-[10px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300">{t}</span>)}
              {m.good_at ? <span className="block text-axal-faint">{m.good_at}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-axal-muted">{m.choosable ? perMinute(m.price_usd_per_minute) : 'Not offered'}</span>
          </label>
        </li>
      ))}
      {allowOff && (
        <li>
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] hover:bg-gray-50 dark:hover:bg-gray-900">
            <input type="radio" name={`model-${kind}`} value="" checked={value === null} onChange={() => onChange(null)} />
            <span className="font-semibold text-gray-900 dark:text-gray-100">Off</span>
            <span className="text-axal-faint">The transcript appears when you stop.</span>
          </label>
        </li>
      )}
    </ul>
  );
}

export default function RecordSessionSheet({ interview, onClose, onCreated, initialModels, initialChannel = 'in_person', initialConsent, api = interviewSessionsApi }) {
  const [channel, setChannel] = useState(initialChannel);
  const [consent, setConsent] = useState(initialConsent || { status: 'not_recorded', method: '' });
  const [editingConsent, setEditingConsent] = useState(false);
  const [models, setModels] = useState(initialModels);
  const [live, setLive] = useState(initialModels?.defaults?.live ?? null);
  const [final, setFinal] = useState(initialModels?.defaults?.final ?? null);
  const [conversation, setConversation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (initialModels !== undefined) return undefined;
    let alive = true;
    api.models().then((r) => {
      if (!alive) return;
      setModels(r); setLive(r?.defaults?.live ?? null); setFinal(r?.defaults?.final ?? null);
    }).catch(() => { if (alive) setModels(null); });
    return () => { alive = false; };
  }, [api, initialModels]);

  const { company } = useActiveCompany() || {};
  const viaAssistant = channel === ASSISTANT;
  const audio = AUDIO.has(channel);
  const ready = canStart(channel, consent) && (audio || parseConversation(conversation).length > 0);
  const finalLabel = models?.final?.find((m) => m.model === final)?.label;
  const name = (interview?.interviewee_name || '').trim();
  const points = Array.isArray(interview?.hypotheses) ? interview.hypotheses.map((h) => h?.claim || h?.text || h).filter((h) => typeof h === 'string' && h) : [];

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      const body = audio
        ? { channel, consent: consent.status === 'given' ? consent : { status: consent.status }, live_model: live, final_model: final }
        : { channel, messages: parseConversation(conversation) };
      const r = await api.create(interview.id, body);
      onCreated?.(r.session);
    } catch (e) {
      setError(e?.message || 'The session could not be created.');
    } finally { setBusy(false); }
  };

  return (
    <aside role="dialog" aria-label="Record a session" data-testid="record-session-sheet" className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col border-l border-axal-hairline bg-white shadow-xl dark:border-gray-800 dark:bg-gray-950">
      <header className="flex items-center justify-between border-b border-axal-hairline px-5 py-4 dark:border-gray-800">
        <h2 className="text-[16px] font-bold text-gray-900 dark:text-gray-100">Record a session</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={16} /></button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <Group title="How">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How">
            {CHANNELS.map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={channel === k} data-testid={`channel-${k}`} className={chip(channel === k)} onClick={() => setChannel(k)}>{label}</button>
            ))}
            <button type="button" role="radio" aria-checked={viaAssistant} data-testid="channel-assistant" className={chip(viaAssistant)} onClick={() => setChannel(ASSISTANT)}>From an AI assistant</button>
          </div>
        </Group>
        <Group title="With">
          <p className="text-[13px] text-gray-900 dark:text-gray-100">{name || <span className="text-axal-faint">Name not recorded</span>}</p>
          {(interview?.interviewee_role || interview?.interviewee_company) ? <p className="text-[12px] text-axal-faint">{[interview.interviewee_role, interview.interviewee_company].filter(Boolean).join(' · ')}</p> : null}
        </Group>
        <Group title="Talking points">
          {points.length
            ? <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-gray-700 dark:text-gray-300">{points.map((p) => <li key={p}>{p}</li>)}</ul>
            : <p className="text-[12px] text-axal-faint">Not recorded</p>}
        </Group>
        {viaAssistant ? (
          <AssistantEntry companyName={company?.company_name || ''} />
        ) : audio ? (
          <Group title="Consent">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">Recording consent</div>
                <div className="text-[12px] text-axal-faint" data-testid="consent-state">
                  {consent.status === 'given' ? `Given · ${CONSENT_METHODS.find(([m]) => m === consent.method)?.[1] || 'how not recorded'}`
                    : consent.status === 'declined' ? 'Declined · take notes instead, or switch to manual entry'
                      : 'Not recorded · ask before you start'}
                </div>
              </div>
              {consent.status !== 'given' && !editingConsent && (
                <button type="button" data-testid="button-record-consent" className="rounded-md bg-violet-700 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-violet-800" onClick={() => setEditingConsent(true)}>Record consent</button>
              )}
            </div>
            {editingConsent && (
              <div className="mt-3 space-y-2" data-testid="consent-editor">
                <div className="flex flex-wrap gap-1.5">
                  {CONSENT_METHODS.map(([m, label]) => (
                    <button key={m} type="button" data-testid={`consent-${m}`} className={chip(consent.status === 'given' && consent.method === m)} onClick={() => { setConsent({ status: 'given', method: m }); setEditingConsent(false); }}>{label}</button>
                  ))}
                </div>
                <button type="button" data-testid="consent-declined" className="text-[12px] font-semibold text-red-700 underline dark:text-red-400" onClick={() => { setConsent({ status: 'declined', method: '' }); setEditingConsent(false); }}>They declined</button>
              </div>
            )}
          </Group>
        ) : (
          <Group title={channel === 'text' ? 'The conversation' : 'Your notes'}>
            <label className="block text-[12px] text-axal-faint" htmlFor="session-conversation">One line each, as “Name: what they said”.</label>
            <textarea id="session-conversation" data-testid="input-conversation" rows={8} value={conversation} onChange={(e) => setConversation(e.target.value)} className="mt-1 w-full rounded-md border border-gray-200 bg-white p-2 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
          </Group>
        )}
        {audio && (
          <>
            <Group title="Live transcript"><ModelList kind="live" models={models === null ? null : models?.live} value={live} onChange={setLive} allowOff /></Group>
            <Group title="Final transcript"><ModelList kind="final" models={models === null ? null : models?.final} value={final} onChange={setFinal} /></Group>
          </>
        )}
      </div>
      <footer className="border-t border-axal-hairline px-5 py-3 dark:border-gray-800">
        {error && <p role="alert" data-testid="sheet-error" className="mb-2 text-[12px] font-semibold text-red-700 dark:text-red-400">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-axal-faint" data-testid="sheet-foot-note">
            {viaAssistant ? 'Your assistant sends the interview; it appears here for your review.'
              : audio && !canStart(channel, consent) ? 'Start unlocks once consent is recorded.'
              : audio ? `Transcribe with ${finalLabel || 'Not recorded'}` : 'No audio is recorded on this channel.'}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-[12px] font-bold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800">Cancel</button>
            {!viaAssistant && <button type="button" data-testid="button-start-recording" disabled={!ready || busy} onClick={submit} className="rounded-md bg-violet-700 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">
              {audio ? 'Start recording' : 'Save session'}
            </button>}
          </div>
        </div>
      </footer>
    </aside>
  );
}

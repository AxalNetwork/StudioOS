// D4493 (#4493): DS7/MK7b sequence builder: steps with consent pills, blocked steps with fixed reasons, the founder's own voice note, due steps as drafts, and the sequence Ask.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Mic, Mail, Play } from 'lucide-react';
import AskIntent from '../../../ui/AskIntent.jsx';
import Lightbox from '../../../ui/Lightbox';
import { useRailOption } from '../../../ui/railCrumbs';
import { growSequencesApi } from '../../../lib/api/growSequences.js';
import { growDistributionAsk } from '../../../lib/api/growDistributionAsk.js';
import { growProspectsApi } from '../../../lib/api/growProspects.js';
import { mailApi } from '../../../lib/api/mail.js';
import { Card, LoadingSkeleton, Pill, ProposalBlock, StatusNote } from './DistributionParts.jsx';
import { DistributionReadError, useDistributionState } from './DistributionStates.jsx';
import { SOURCE_CHOICES, notifyDistribution, OUT_OF_TOKENS } from './distributionAskModel.js';
import ConsentByStep from './ConsentByStep.jsx';
import {
  AI_VOICE, AI_VOICE_LABEL, BLOCKED_STEPS, NEVER_SENDS, NO_SMS, OFFERED, OWN_RECORDING, SEND_LIMIT, channelLabel, dueButton, dueCount,
  prospectsLine, proposedSequence, rowState, sequenceHoldLine, sequenceSubtitle, stepPill, waitLabel,
} from './sequenceModel.js';
import './sequences.css';

const BTN = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-lg border border-axal-lavender-edge px-3 text-sm font-semibold text-axal-violet disabled:opacity-50 dark:border-violet-900 dark:text-violet-300';
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-axal-violet px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-violet-600 dark:text-white';
const FIELD = 'w-full min-h-[44px] rounded-lg border border-axal-line bg-transparent px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
/** The header's Waiting count refreshes; a page without events still works. */
const notify = (project) => { try { notifyDistribution(project); } catch { /* no event target */ } };
const seconds = (n) => Number.isInteger(n) ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : 'Length not recorded';

/** One successful due read, shared by the builder, the Needs-you row and Overview's week. Unreadable is never zero. */
export function useDueSteps(projectId, { api = growSequencesApi, version = 0 } = {}) {
  const [reading, setReading] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    if (!projectId) return undefined;
    let live = true; setReading({ projectId, state: 'loading', rows: null });
    api.due(projectId).then((d) => { if (live) setReading(Array.isArray(d?.rows) ? { projectId, state: 'ready', rows: d.rows } : { projectId, state: 'unreadable', rows: null }); })
      .catch(() => { if (live) setReading({ projectId, state: 'unreadable', rows: null }); });
    return () => { live = false; };
  }, [projectId, api, attempt, version]);
  return { ...(reading?.projectId === projectId ? reading : { state: 'loading', rows: null }), retry };
}

/** Overview's Needs-you SEQUENCE row: only a real count of due steps. */
export function SequenceNeedsYou({ projectId, search = '', api }) {
  return <SequenceNeedsYouRow reading={useDueSteps(projectId, api ? { api } : {})} search={search} />;
}
export function SequenceNeedsYouRow({ reading, search = '' }) {
  const to = `/grow/distribution/prospects${search}`;
  if (reading?.state === 'unreadable') return <StatusNote tone="warn">Unreadable: due sequence steps could not be counted. <Link className="inline-flex min-h-[44px] items-center underline dark:text-violet-300" to={to}>Open Prospects</Link></StatusNote>;
  const n = dueCount(reading);
  if (!n) return null;
  return <Card className="sq-needs" data-testid="sequence-needs-you"><span><b className="ds-eyebrow">Sequence</b> · {n} {n === 1 ? 'step is' : 'steps are'} due. {NEVER_SENDS}</span><Link className="inline-flex min-h-[44px] items-center dark:text-violet-300" to={to}>Review and send</Link></Card>;
}

/** The founder's own recording, never a synthetic voice. */
function VoiceNote({ projectId, sequenceUid, step, disabled, api, onSaved }) {
  const [state, setState] = useState('idle'), [take, setTake] = useState(null), [url, setUrl] = useState(null), [error, setError] = useState(null);
  const recorder = useRef(null), started = useRef(0), chunks = useRef([]), stream = useRef(null), timer = useRef(null);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => { clearTimeout(timer.current); stream.current?.getTracks?.().forEach((t) => t.stop()); }, []);
  const record = async () => {
    setError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('This browser cannot record. Use a current browser to record your voice note.'); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream.current); recorder.current = r; chunks.current = [];
      r.ondataavailable = (e) => { if (e.data?.size) chunks.current.push(e.data); };
      r.onstop = () => {
        stream.current?.getTracks?.().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: (r.mimeType || 'audio/webm').split(';')[0] });
        const secs = Math.max(1, Math.min(300, Math.round((Date.now() - started.current) / 1000)));
        setTake({ blob, seconds: secs }); setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); }); setState('taken');
      };
      started.current = Date.now(); r.start(); setState('recording');
      timer.current = setTimeout(() => { if (r.state === 'recording') r.stop(); }, 120_000);
    } catch { setError('The microphone could not be opened. Allow it for this site, then Record again.'); setState('idle'); }
  };
  const stop = () => { clearTimeout(timer.current); if (recorder.current?.state === 'recording') recorder.current.stop(); };
  const save = async () => {
    if (!take) return; setState('saving'); setError(null);
    try { await api.uploadRecording(sequenceUid, step.position, { project: projectId, file: new File([take.blob], 'voice-note', { type: take.blob.type }), seconds: take.seconds }); setTake(null); setState('idle'); onSaved?.(); }
    catch { setError('The voice note could not be saved. Try again.'); setState('taken'); }
  };
  const preview = async () => {
    setError(null);
    try { const blob = await api.recording(projectId, sequenceUid, step.position); setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); }); }
    catch { setError('The voice note could not be played. Try again.'); }
  };
  return <div className="sq-voice dark:text-gray-200">
    <p className="sq-sub dark:text-gray-400"><Mic size={14} aria-hidden="true" /> {OWN_RECORDING} · {step.recording ? seconds(step.recording.seconds) : 'not recorded yet'}{step.recording ? <> · <button type="button" className={BTN} onClick={preview}><Play size={14} aria-hidden="true" />Preview</button></> : null}</p>
    {url && <audio controls src={url} className="w-full" aria-label="Voice note preview" />}
    <div className="flex flex-wrap gap-2">
      {state === 'recording' ? <button type="button" className={PRIMARY} onClick={stop}>Stop recording</button>
        : <button type="button" className={BTN} disabled={disabled || state === 'saving'} onClick={record}><Mic size={14} aria-hidden="true" />{step.recording ? 'Record again' : 'Record'}</button>}
      {take && <button type="button" className={PRIMARY} disabled={disabled || state === 'saving'} onClick={save}>{state === 'saving' ? 'Saving…' : `Use this recording · ${seconds(take.seconds)}`}</button>}
    </div>
    <p className="sq-sub dark:text-gray-400"><span className="sq-greyed dark:text-gray-500">{AI_VOICE_LABEL}</span> <Pill tone="muted">{AI_VOICE}</Pill> Only your own recording is sent, attached to the email.</p>
    {error && <StatusNote tone="warn">{error}</StatusNote>}
  </div>;
}

function StepCard({ step, index, projectId, sequenceUid, disabled, api, onChanged }) {
  const blocked = step.blocked_reason;
  const [subject, setSubject] = useState(step.subject ?? ''), [body, setBody] = useState(step.body ?? ''), [wait, setWait] = useState(String(step.wait_days ?? 0));
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  useEffect(() => { setSubject(step.subject ?? ''); setBody(step.body ?? ''); setWait(String(step.wait_days ?? 0)); }, [step.subject, step.body, step.wait_days]);
  const pill = stepPill(step);
  const changed = subject !== (step.subject ?? '') || body !== (step.body ?? '') || wait !== String(step.wait_days ?? 0);
  const run = async (fn) => { setBusy(true); setError(null); try { await fn(); onChanged?.(); } catch (e) { setError(e?.status === 400 ? 'That change was not saved. Check the fields and try again.' : 'That change was not saved. Try again.'); } finally { setBusy(false); } };
  return <li className="sq-step" data-testid={`sequence-step-${step.position}`}>
    <span className="sq-bubble" aria-hidden="true">{step.position}</span>
    <div className="sq-step-body">
      <div className="sq-step-head"><b className="dark:text-gray-100">{step.channel === 'voice' ? <Mic size={14} aria-hidden="true" /> : <Mail size={14} aria-hidden="true" />} {channelLabel(step.channel)}</b><Pill tone={pill.tone}>{pill.label}</Pill></div>
      <p className="sq-wait dark:text-gray-400">{waitLabel(step, index)}</p>
      {blocked ? <StatusNote tone="warn">Blocked: {blocked} This step is skipped for everyone.</StatusNote> : <>
        <label className="sq-label dark:text-gray-300">Subject<input className={FIELD} aria-label={`Step ${step.position} subject`} value={subject} maxLength={200} disabled={disabled || busy} onChange={(e) => setSubject(e.target.value)} /></label>
        <label className="sq-label dark:text-gray-300">{step.channel === 'voice' ? 'Note with the recording' : 'Message'}<textarea className={`${FIELD} min-h-24`} aria-label={`Step ${step.position} message`} placeholder={index === 0 ? 'Write the email, or ask Eadwyn.' : 'Write the follow-up, or ask Eadwyn.'} value={body} maxLength={4000} disabled={disabled || busy} onChange={(e) => setBody(e.target.value)} /></label>
        <label className="sq-label dark:text-gray-300">{index === 0 ? 'Days after enrolling' : 'Days with no reply before this step'}<input className={`${FIELD} max-w-[8rem]`} type="number" min={0} max={60} inputMode="numeric" value={wait} disabled={disabled || busy} onChange={(e) => setWait(e.target.value)} /></label>
        {step.channel === 'voice' && <VoiceNote projectId={projectId} sequenceUid={sequenceUid} step={step} disabled={disabled} api={api} onSaved={onChanged} />}
      </>}
      <div className="flex flex-wrap gap-2">
        {!blocked && <button type="button" className={PRIMARY} disabled={disabled || busy || !changed} onClick={() => run(() => api.updateStep(sequenceUid, step.position, { project: projectId, subject, body, wait_days: Number(wait) }))}>{busy ? 'Saving…' : 'Save step'}</button>}
        <button type="button" className={BTN} disabled={disabled || busy} onClick={() => run(() => api.removeStep(sequenceUid, step.position, projectId))}>Remove step</button>
      </div>
      {error && <StatusNote tone="warn">{error}</StatusNote>}
    </div>
  </li>;
}

/** The composer for one due step: the draft the Worker made; only the confirmed press sends, through /api/mail/send. */
function StepComposer({ draft, mail, onSent, onClose }) {
  const [accounts, setAccounts] = useState(null), [accountUid, setAccountUid] = useState('');
  const [subject, setSubject] = useState(draft.subject || ''), [body, setBody] = useState(draft.body || '');
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const sending = useRef(false);
  useEffect(() => { let live = true; mail.accounts().then((d) => { if (!live) return; const list = Array.isArray(d?.accounts) ? d.accounts.filter((a) => a.status === 'active') : []; setAccounts(list); setAccountUid(list[0]?.uid ?? ''); }).catch(() => { if (live) setAccounts('unreadable'); }); return () => { live = false; }; }, [mail]);
  const keepsLine = body.includes(draft.required_line);
  const canSend = !!accountUid && subject.trim() && body.trim() && keepsLine;
  const send = async () => {
    if (!canSend || sending.current) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      const c = await mail.confirmSend(accountUid);
      if (!c?.nonce) throw new Error('unconfirmed');
      const r = await mail.send({ account_uid: accountUid, to: draft.to, subject: subject.trim(), body, draft_uid: draft.uid, nonce: c.nonce });
      if (typeof r?.sent?.uid !== 'string') throw new Error('unverified');
      setConfirm(false); onSent?.();
    } catch (e) { setConfirm(false); setError(e?.code === 'sequence_not_due' || e?.code === 'optout_required' || e?.code === 'attachment_unsupported' || e?.code === 'recording_missing' ? e.message : 'The email could not be sent. Check your mailbox before trying again.'); }
    finally { sending.current = false; setBusy(false); }
  };
  return <section className="sq-composer dark:bg-gray-900" aria-label="Step composer">
    <p className="ds-eyebrow">{SEND_LIMIT}</p>
    <p className="sq-sub dark:text-gray-300">To {draft.name || 'this prospect'} · {draft.to}{draft.attachment ? ` · voice note attached (${seconds(draft.attachment.seconds)})` : ''}</p>
    {accounts === 'unreadable' ? <StatusNote tone="warn">Unreadable: your mailboxes could not be read. Try again.</StatusNote>
      : accounts && !accounts.length ? <p className="sq-sub dark:text-gray-300"><Link className="underline" to="/email">Connect a mailbox</Link> to send this step.</p>
      : <label className="sq-label dark:text-gray-300">Mailbox<select className={FIELD} value={accountUid} disabled={busy || !accounts} onChange={(e) => setAccountUid(e.target.value)}>{(Array.isArray(accounts) ? accounts : []).map((a) => <option key={a.uid} value={a.uid}>{a.display_name || a.address}</option>)}</select></label>}
    <label className="sq-label dark:text-gray-300">Subject<input className={FIELD} value={subject} maxLength={200} disabled={busy} onChange={(e) => setSubject(e.target.value)} /></label>
    <label className="sq-label dark:text-gray-300">Message<textarea className={`${FIELD} min-h-32`} value={body} maxLength={20000} disabled={busy} onChange={(e) => setBody(e.target.value)} /></label>
    {!keepsLine && <StatusNote tone="warn">Keep the opt-out link in this message: every message carries it.</StatusNote>}
    {error && <StatusNote tone="negative">{error}</StatusNote>}
    <div className="flex flex-wrap gap-2"><button type="button" className={PRIMARY} disabled={!canSend || busy} onClick={() => setConfirm(true)}>Send</button><button type="button" className={BTN} disabled={busy} onClick={onClose}>Close</button></div>
    {confirm && <Lightbox title={`Send this step to ${draft.name || 'this prospect'}?`} label="Confirm step" onClose={() => { if (!busy) setConfirm(false); }} width={480}>
      <p className="dark:text-gray-200">One email to {draft.to}, from your own mailbox. Nothing else is sent.</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={BTN} disabled={busy} onClick={() => setConfirm(false)}>Cancel</button><button type="button" className={PRIMARY} disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send email'}</button></div>
    </Lightbox>}
  </section>;
}

function DueReview({ projectId, rows, api, mail, disabled, onChanged }) {
  const [draft, setDraft] = useState(null), [busy, setBusy] = useState(null), [error, setError] = useState(null);
  const open = async (r) => { setBusy(r.enrolment_uid); setError(null); try { const d = await api.draft(r.enrolment_uid, projectId); setDraft(d.draft); } catch (e) { setError(e?.status === 409 ? (e.message || 'This step is not due now.') : 'The draft could not be made. Try again.'); onChanged?.(); } finally { setBusy(null); } };
  return <div className="sq-due" data-testid="sequence-due">
    <ul className="sq-rows">{rows.map((r) => { const s = rowState(r.state); return <li key={r.enrolment_uid} className="sq-row dark:border-gray-700">
      <span className="dark:text-gray-100">{r.contact_name || 'Name · Not recorded'} · {r.position ? `Step ${r.position} · ${channelLabel(r.channel)}` : r.sequence_name}</span>
      <Pill tone={s.tone}>{s.label}</Pill>
      {r.reason && <span className={`sq-sub ${r.state === 'blocked' || r.state === 'held' ? 'sq-amber dark:text-amber-300' : 'dark:text-gray-400'}`}>{r.reason}</span>}
      {r.skipped?.map((k) => <span key={k.position} className="sq-sub sq-amber dark:text-amber-300">Step {k.position} skipped: {k.reason}</span>)}
      {r.state === 'due' && <button type="button" className={PRIMARY} disabled={disabled || busy === r.enrolment_uid} onClick={() => open(r)}>{busy === r.enrolment_uid ? 'Drafting…' : 'Review and send'}</button>}
    </li>; })}</ul>
    {error && <StatusNote tone="warn">{error}</StatusNote>}
    {draft && <StepComposer key={draft.uid} draft={draft} mail={mail} onClose={() => setDraft(null)} onSent={() => { setDraft(null); onChanged?.(); }} />}
  </div>;
}

function Enrol({ projectId, sequenceUid, disabled, api, prospects, onChanged }) {
  const [list, setList] = useState(null), [picked, setPicked] = useState([]), [zone, setZone] = useState(''), [busy, setBusy] = useState(false), [note, setNote] = useState(null);
  useEffect(() => { let live = true; prospects.list({ project: projectId, per_status: 100 }).then((d) => { if (live) setList(Array.isArray(d?.columns) ? d.columns.flatMap((c) => c.cards || []) : 'unreadable'); }).catch(() => { if (live) setList('unreadable'); }); return () => { live = false; }; }, [projectId, prospects]);
  const save = async () => { setBusy(true); setNote(null); try { const r = await api.enrol(sequenceUid, { project: projectId, contacts: picked.map((uid) => ({ uid, ...(zone.trim() ? { time_zone: zone.trim() } : {}) })) }); setNote(`${Number.isSafeInteger(r?.enrolled) ? r.enrolled : 'Not recorded'} saved.`); setPicked([]); onChanged?.(); } catch (e) { setNote(e?.field === 'time_zone' ? 'Choose a real time zone, such as Europe/Paris.' : 'The prospects were not enrolled. Try again.'); } finally { setBusy(false); } };
  if (list === null) return <LoadingSkeleton label="prospects" />;
  if (list === 'unreadable') return <StatusNote tone="warn">Unreadable: prospects could not be read.</StatusNote>;
  return <details className="sq-enrol dark:text-gray-200"><summary className="min-h-[44px] cursor-pointer py-2 font-semibold">Enrol prospects</summary>
    {!list.length ? <p className="sq-sub dark:text-gray-400">No prospect is recorded yet. Add them in Prospects.</p> : <fieldset disabled={disabled || busy} className="space-y-1">
      <legend className="sr-only">Prospects to enrol</legend>
      {list.map((p) => <label key={p.uid} className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={picked.includes(p.uid)} onChange={(e) => setPicked((v) => e.target.checked ? [...v, p.uid] : v.filter((u) => u !== p.uid))} />{p.name || 'Name · Not recorded'}{p.company ? ` · ${p.company}` : ''}</label>)}
      <label className="sq-label dark:text-gray-300">Their time zone (for quiet hours)<input className={FIELD} placeholder="Europe/Paris" value={zone} maxLength={64} onChange={(e) => setZone(e.target.value)} /></label>
      <p className="sq-sub dark:text-gray-400">Without their time zone a step is held, never sent in their night.</p>
      <button type="button" className={PRIMARY} disabled={!picked.length || busy} onClick={save}>{busy ? 'Enrolling…' : `Enrol ${picked.length}`}</button>
    </fieldset>}
    {note && <p role="status" className="sq-sub dark:text-gray-300">{note}</p>}
  </details>;
}

/** 'Ask Eadwyn for a sequence': the D4488 drafting task with kind `sequence`; Accept saves a draft sequence. */
function SequenceAsk({ projectId, askApi, onAccepted, onClose }) {
  const [sources, setSources] = useState(['validate', 'research', 'distribution']);
  const [estimate, setEstimate] = useState(null), [rows, setRows] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const request = { project: projectId, campaign_uid: null, target: 'form', kinds: ['sequence'], sources };
  const key = JSON.stringify(request);
  useEffect(() => { let live = true; setEstimate(null); setError(null); askApi.quote(JSON.parse(key)).then((r) => { if (live) setEstimate(r.estimate); }).catch((e) => { if (live) setError(e?.status === 402 ? OUT_OF_TOKENS : 'The hold could not be read. Try again.'); }); return () => { live = false; }; }, [key, askApi]);
  // The moved 'Draft a sequence' rail row (D4493): its models pick this run's model.
  useRailOption(busy ? 'draft:grow/customers' : null, 'Ask Eadwyn for a sequence');
  const draft = async () => { setBusy(true); setError(null); try { const r = await askApi.run({ ...JSON.parse(key), quote: estimate }); setRows(r.proposals || []); notify(projectId); } catch (e) { setError(e?.status === 402 ? OUT_OF_TOKENS : e?.status === 409 ? 'The hold changed. Read the new hold before asking again.' : 'Eadwyn could not draft a sequence. You can still write the steps yourself.'); } finally { setBusy(false); } };
  const decide = async (p, decision, edited) => { setBusy(true); setError(null); try { await askApi.decide(p.uid, { project: projectId, decision, ...(edited ? { edited } : {}) }); notify(projectId); setRows((v) => v.filter((r) => r.uid !== p.uid)); setEditing(null); if (decision !== 'discard') onAccepted?.(); } catch { setError('That proposal could not be decided. Reload to check its state.'); } finally { setBusy(false); } };
  return <AskIntent exclusive label="Ask Eadwyn for a sequence" title="A sequence for your prospects" eyebrow="DISTRIBUTION · SEQUENCE" testId="sequence-ask" onClose={onClose}
    footer={<><p className="text-sm dark:text-gray-200" data-testid="sequence-hold">{sequenceHoldLine(estimate)}</p><button type="button" className={PRIMARY} disabled={busy || !estimate || !sources.length} onClick={draft}>{busy ? 'Drafting…' : 'Draft the sequence'}</button><p className="text-xs text-axal-muted dark:text-gray-400">Accept saves a draft sequence of email steps. Nothing is sent, scheduled or activated.</p></>}>
    <fieldset disabled={busy} className="space-y-1"><legend className="mb-2 text-xs font-semibold uppercase tracking-wide dark:text-gray-300">Sources</legend>{SOURCE_CHOICES.map((s) => <label key={s.key} className="flex min-h-[44px] items-center gap-2 text-sm dark:text-gray-200"><input type="checkbox" className="h-5 w-5" checked={sources.includes(s.key)} onChange={(e) => setSources((v) => e.target.checked ? [...v, s.key] : v.filter((k) => k !== s.key))} />{s.label}</label>)}</fieldset>
    {rows.map((p) => { const v = proposedSequence(p); if (!v) return null; const shown = editing?.uid === p.uid ? editing.values : v; return <ProposalBlock key={p.uid} busy={busy} title="Accept sequence · proposal" proposal={{ ...p, status: 'proposed' }}
      onAccept={() => decide(p, editing?.uid === p.uid ? 'edit' : 'accept', editing?.uid === p.uid ? { values: editing.values } : undefined)} onEdit={() => setEditing({ uid: p.uid, values: JSON.parse(JSON.stringify(v)) })} onDiscard={() => decide(p, 'discard')}>
      <span className="block font-semibold">{shown.name}</span>
      {shown.steps.map((st, i) => editing?.uid === p.uid ? <label key={i} className="sq-label dark:text-gray-300">Email {i + 1}<textarea className={`${FIELD} min-h-20`} value={st.body} maxLength={2000} onChange={(e) => setEditing((ed) => ({ ...ed, values: { ...ed.values, steps: ed.values.steps.map((x, j) => j === i ? { ...x, body: e.target.value } : x) } }))} /></label>
        : <span key={i} className="block whitespace-pre-wrap">Email {i + 1}{i ? ` · if no reply in ${st.wait_days} days` : ''} · {st.subject}: {st.body}</span>)}
    </ProposalBlock>; })}
    {error && <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{error}</div>}
  </AskIntent>;
}

export default function SequenceBuilder({ projectId, canWrite = false, api = growSequencesApi, askApi = growDistributionAsk, prospects = growProspectsApi, mail = mailApi }) {
  const shared = useDistributionState();
  const writeOff = shared ? shared.manual.disabled : canWrite !== true;
  const askOff = writeOff || (shared ? shared.ask.disabled : false);
  const [list, setList] = useState(null), [selected, setSelected] = useState(null), [detail, setDetail] = useState(null), [version, setVersion] = useState(0);
  const [asking, setAsking] = useState(false), [reviewing, setReviewing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(null), [name, setName] = useState('');
  const reload = useCallback(() => setVersion((n) => n + 1), []);
  const due = useDueSteps(projectId, { api, version });
  useEffect(() => { let live = true; setList(null); api.list(projectId).then((d) => { if (!live) return; const rows = Array.isArray(d?.sequences) ? d.sequences : null; setList(rows ?? 'unreadable'); if (rows) setSelected((s) => rows.some((r) => r.uid === s) ? s : rows[0]?.uid ?? null); }).catch(() => { if (live) setList('unreadable'); }); return () => { live = false; }; }, [projectId, api, version]);
  useEffect(() => { if (!selected) { setDetail(null); return undefined; } let live = true; api.get(projectId, selected).then((d) => { if (live) setDetail(d?.sequence ? d : 'unreadable'); }).catch(() => { if (live) setDetail('unreadable'); }); return () => { live = false; }; }, [projectId, selected, api, version]);
  const act = async (fn) => { setBusy(true); setError(null); try { await fn(); reload(); } catch (e) { setError(e?.status === 409 && e?.message ? e.message : 'That change was not saved. Try again.'); } finally { setBusy(false); } };
  if (list === null) return <LoadingSkeleton label="sequences" />;
  if (list === 'unreadable') return <DistributionReadError onRetry={reload} />;
  const s = detail && detail !== 'unreadable' ? detail : null;
  const rows = Array.isArray(due.rows) ? due.rows.filter((r) => !s || r.sequence_uid === s.sequence.uid) : null;
  const n = dueCount({ rows });
  return <Card className="sq-card dark:text-gray-200" data-testid="sequence-builder">
    <div className="sq-head">
      <div><h2 className="sq-title dark:text-gray-100">Sequence · {s ? s.sequence.name : 'none yet'}</h2>
        {s && <><p className="sq-sub dark:text-gray-400">{sequenceSubtitle(s)}</p><p className="sq-sub dark:text-gray-400">{prospectsLine(s)}</p></>}</div>
      <button type="button" className={BTN} disabled={askOff} title={askOff ? shared?.ask.title ?? shared?.manual.reason : undefined} onClick={() => setAsking(true)}><Eye size={15} aria-hidden="true" />Ask Eadwyn for a sequence</button>
    </div>
    {list.length > 1 && <label className="sq-label dark:text-gray-300">Sequence<select className={FIELD} value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>{list.map((q) => <option key={q.uid} value={q.uid}>{q.name}</option>)}</select></label>}
    {!list.length && <p className="sq-sub dark:text-gray-400">No sequence yet. Name one and add its steps, or ask Eadwyn for one.</p>}
    <div className="flex flex-wrap items-end gap-2"><label className="sq-label grow dark:text-gray-300">New sequence name<input className={FIELD} value={name} maxLength={120} disabled={writeOff || busy} onChange={(e) => setName(e.target.value)} /></label>
      <button type="button" className={BTN} disabled={writeOff || busy || !name.trim()} onClick={() => act(async () => { const r = await api.create({ project: projectId, name: name.trim() }); setName(''); setSelected(r?.sequence?.uid ?? null); })}>New sequence</button></div>
    {detail === 'unreadable' && <DistributionReadError onRetry={reload} />}
    {selected && !detail && <LoadingSkeleton label="the sequence" />}
    {s && <>
      <div className="flex flex-wrap items-center gap-2"><Pill tone={s.sequence.state === 'active' ? 'positive' : s.sequence.state === 'paused' ? 'amber' : 'draft'}>{s.sequence.state === 'active' ? 'Active' : s.sequence.state === 'paused' ? 'Paused' : 'Draft'}</Pill>
        {s.sequence.state !== 'active' ? <button type="button" className={BTN} disabled={writeOff || busy} onClick={() => act(() => api.update(s.sequence.uid, { project: projectId, state: 'active' }))}>Activate</button>
          : <button type="button" className={BTN} disabled={writeOff || busy} onClick={() => act(() => api.update(s.sequence.uid, { project: projectId, state: 'paused' }))}>Pause</button>}
        {due.state === 'unreadable' ? <StatusNote tone="warn">Unreadable: due steps could not be read. <button type="button" className="underline" onClick={due.retry}>Try again</button></StatusNote>
          : n ? <button type="button" className={PRIMARY} onClick={() => setReviewing((v) => !v)}>{dueButton(n)}</button> : null}
      </div>
      <p className="sq-sub dark:text-gray-400">{SEND_LIMIT}. {NEVER_SENDS}</p>
      <ol className="sq-steps">{s.steps.map((st, i) => <StepCard key={`${st.position}:${st.updated_at}`} step={st} index={i} projectId={projectId} sequenceUid={s.sequence.uid} disabled={writeOff} api={api} onChanged={reload} />)}</ol>
      <div className="sq-add" aria-label="Add a step">
        {OFFERED.map((o) => <button key={o.channel} type="button" className={BTN} disabled={writeOff || busy || s.steps.length >= 10} onClick={() => act(() => api.addStep(s.sequence.uid, { project: projectId, channel: o.channel, wait_days: s.steps.length ? 3 : 0 }))}>Add {o.label.toLowerCase()} step</button>)}
        <ul className="sq-blocked">{BLOCKED_STEPS.map((b) => <li key={b.channel} className="dark:text-gray-400"><button type="button" className={BTN} disabled aria-describedby={`sq-blocked-${b.channel}`}>{b.label}</button> <Pill tone="negative">Blocked</Pill> <span id={`sq-blocked-${b.channel}`}>{b.reason}</span></li>)}</ul>
        <p className="sq-sub dark:text-gray-400">{NO_SMS}</p>
      </div>
      {error && <StatusNote tone="warn">{error}</StatusNote>}
      {reviewing && rows && <DueReview projectId={projectId} rows={rows} api={api} mail={mail} disabled={writeOff} onChanged={reload} />}
      {!reviewing && rows?.length ? <DueReview projectId={projectId} rows={rows.filter((r) => r.state !== 'due')} api={api} mail={mail} disabled={writeOff} onChanged={reload} /> : null}
      <Enrol projectId={projectId} sequenceUid={s.sequence.uid} disabled={writeOff} api={api} prospects={prospects} onChanged={reload} />
      <ConsentByStep steps={s.steps} enrolments={s.enrolments} />
    </>}
    {asking && <SequenceAsk projectId={projectId} askApi={askApi} onAccepted={reload} onClose={() => setAsking(false)} />}
  </Card>;
}

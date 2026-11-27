// D4297 (#4297, D4289 P8) — the Influencer application (IN9) and where an
// applicant stands (IN9r). Three steps: where you publish, your audience, and
// the terms, each rule ticked against the version the Worker names. It writes
// `POST /api/influencer/apply`; a member HQ asked for more answers by applying
// again, from the answers they sent. Used by /influencers and the Refer & Earn card.
import React, { useState } from 'react';
import Lightbox from '../../ui/Lightbox';
import { actionGhost, actionPrimary } from '../../ui';
import { influencerProgramApi } from '../../lib/api/influencerProgram';
import {
  CHANNEL_KINDS, CHANNELS_MAX, REGIONS, RULES, STEPS, TOPICS, WHY_MAX, applyBody, emptyChannel, emptyForm, formFrom, stepError,
} from './influencerPublicModel';

const INPUT = 'h-10 w-full rounded-lg border border-[#e4e0ec] bg-white px-3 text-[14px] text-[#18181b] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL = 'text-[12px] font-semibold uppercase tracking-wide text-[#6b6577] dark:text-gray-400';
const SUB = 'text-[13px] text-[#6b6577] dark:text-gray-400';

function Chip({ on, onClick, children, testId }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} data-testid={testId}
      className={`min-h-[36px] rounded-full border px-3 text-[13px] font-medium ${on ? 'border-violet-600 bg-violet-50 text-violet-800 dark:bg-violet-900/30 dark:text-violet-200' : 'border-[#e4e0ec] text-[#18181b] dark:border-gray-700 dark:text-gray-200'}`}>
      {children}
    </button>
  );
}

const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export default function ApplySheet({ consentVersion, answers = null, onClose, onSent }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(() => (answers ? formFrom(answers) : emptyForm()));
  const [refusal, setRefusal] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setRefusal(null); };
  const setChannel = (i, patch) => set({ channels: form.channels.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  function next() {
    const err = stepError(step, form);
    if (err) { setRefusal(err); return; }
    setStep((s) => s + 1);
  }
  async function submit() {
    const err = stepError(0, form) || stepError(1, form) || stepError(2, form);
    if (err) { setRefusal(err); return; }
    setBusy(true); setRefusal(null);
    try {
      const out = await influencerProgramApi.apply(applyBody(form, consentVersion));
      onSent(out?.application || null);
    } catch (e) {
      setRefusal(e?.message || 'Your application could not be sent. Try again.');
    } finally { setBusy(false); }
  }

  return (
    <Lightbox label="Apply to be an Axal Influencer" title="Apply to be an Axal Influencer" sub={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`} onClose={onClose} width={560} testId="influencer-apply">
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <ol className="m-0 flex list-none gap-2 p-0" aria-label="Steps">
          {STEPS.map((s, i) => <li key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-violet-600' : 'bg-[#e4e0ec] dark:bg-gray-700'}`} aria-current={i === step ? 'step' : undefined} title={s} />)}
        </ol>

        {step === 0 ? (
          <section className="flex flex-col gap-3" data-testid="influencer-apply-step-0">
            <p className={`m-0 ${SUB}`}>Add each channel with its link and audience size.</p>
            {form.channels.map((c, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[140px_minmax(0,1fr)_120px]">
                <select aria-label="Channel" className={INPUT} value={c.kind} onChange={(e) => setChannel(i, { kind: e.target.value })} data-testid={`influencer-apply-kind-${i}`}>
                  {CHANNEL_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <input aria-label="Link" className={INPUT} placeholder="https://" value={c.url} onChange={(e) => setChannel(i, { url: e.target.value })} data-testid={`influencer-apply-url-${i}`} />
                <input aria-label="Audience size" inputMode="numeric" className={INPUT} placeholder="Audience" value={c.audience} onChange={(e) => setChannel(i, { audience: e.target.value })} data-testid={`influencer-apply-audience-${i}`} />
              </div>
            ))}
            {form.channels.length < CHANNELS_MAX ? (
              <button type="button" className="self-start text-[13px] font-semibold text-violet-700 dark:text-violet-300" onClick={() => set({ channels: [...form.channels, emptyChannel()] })} data-testid="influencer-apply-add-channel">+ Add a channel</button>
            ) : null}
          </section>
        ) : null}

        {step === 1 ? (
          <section className="flex flex-col gap-3" data-testid="influencer-apply-step-1">
            <span className={LABEL}>Where your audience is</span>
            <div className="flex flex-wrap gap-2">{REGIONS.map((r) => <Chip key={r} on={form.regions.includes(r)} onClick={() => set({ regions: toggle(form.regions, r) })} testId={`influencer-apply-region-${r}`}>{r}</Chip>)}</div>
            <span className={LABEL}>Topics</span>
            <div className="flex flex-wrap gap-2">{TOPICS.map((t) => <Chip key={t} on={form.topics.includes(t)} onClick={() => set({ topics: toggle(form.topics, t) })} testId={`influencer-apply-topic-${t}`}>{t}</Chip>)}</div>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Why Axal</span>
              <textarea rows={4} maxLength={WHY_MAX} className={`${INPUT} h-auto py-2`} value={form.why} onChange={(e) => set({ why: e.target.value })} data-testid="influencer-apply-why" />
            </label>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="flex flex-col gap-3" data-testid="influencer-apply-step-2">
            <p className={`m-0 ${SUB}`}>Tick each rule to agree to it.</p>
            {RULES.map(([k, text]) => (
              <label key={k} className="flex items-start gap-2 text-[14px] text-[#18181b] dark:text-gray-100">
                <input type="checkbox" className="mt-1" checked={form.consent[k] === true} onChange={(e) => set({ consent: { ...form.consent, [k]: e.target.checked } })} data-testid={`influencer-apply-rule-${k}`} />
                {text}
              </label>
            ))}
            <a href="/terms" className="text-[12.5px] font-semibold text-violet-700 dark:text-violet-300">Read the full Influencer terms ›</a>
            <p className={`m-0 ${SUB}`} data-testid="influencer-apply-version">{consentVersion ? `Terms version ${consentVersion}.` : 'The terms version could not be read.'}</p>
          </section>
        ) : null}

        {refusal ? <p role="alert" className="m-0 text-[13px] font-semibold text-red-700 dark:text-red-300" data-testid="influencer-apply-refusal">{refusal}</p> : null}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={actionGhost} onClick={step === 0 ? onClose : () => { setStep((s) => s - 1); setRefusal(null); }} data-testid="influencer-apply-back">{step === 0 ? 'Cancel' : 'Back'}</button>
          {step < STEPS.length - 1
            ? <button type="button" className={actionPrimary} onClick={next} data-testid="influencer-apply-next">Next</button>
            : <button type="button" className={actionPrimary} onClick={submit} disabled={busy || !consentVersion} data-testid="influencer-apply-submit">{busy ? 'Sending…' : 'Submit'}</button>}
        </div>
      </div>
    </Lightbox>
  );
}

/** Where an applicant stands (in9r): in review, HQ asked for more, or declined until a date. Nothing for none or admitted. */
export function ApplicationStatus({ state, onAddDetails }) {
  if (!state || !['review', 'more', 'declined'].includes(state.kind)) return null;
  const pill = { review: 'In review', more: 'More needed', declined: 'Declined' }[state.kind];
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-[#e4e0ec] bg-white p-4 dark:border-gray-700 dark:bg-gray-900" data-testid={`influencer-status-${state.kind}`}>
      <span className="self-start rounded-full bg-violet-50 px-2.5 py-0.5 text-[12px] font-semibold text-violet-800 dark:bg-violet-900/30 dark:text-violet-200">{pill}</span>
      {state.kind === 'review' ? (
        <>
          <strong className="text-[15px] text-[#18181b] dark:text-gray-100">Application sent</strong>
          <p className={`m-0 ${SUB}`}>{`Sent ${state.sent}. We’ll reply within 5 business days, by email and in your inbox.`}</p>
        </>
      ) : null}
      {state.kind === 'more' ? (
        <>
          <strong className="text-[15px] text-[#18181b] dark:text-gray-100">HQ asked for more</strong>
          <p className={`m-0 ${SUB}`} data-testid="influencer-status-question">{state.question}</p>
          <button type="button" className={`${actionPrimary} self-start`} onClick={onAddDetails} data-testid="influencer-status-add">Add the details</button>
        </>
      ) : null}
      {state.kind === 'declined' ? (
        <>
          <strong className="text-[15px] text-[#18181b] dark:text-gray-100">Not this time</strong>
          <p className={`m-0 ${SUB}`} data-testid="influencer-status-reason">{`HQ’s reason: ${state.reason} You can apply again after ${state.after}.`}</p>
          <button type="button" className={`${actionGhost} self-start`} disabled data-testid="influencer-status-again">{`Apply again · from ${state.after}`}</button>
        </>
      ) : null}
    </section>
  );
}

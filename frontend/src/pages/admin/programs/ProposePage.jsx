// D964 (#2797, Programs part 11) — Propose a program (PG14, dc:459-467,
// dc:485), the routed page at `/admin/programs/propose` (`guard(['admin'])` in
// App.jsx, never `hqOnly`), on part 2's proposal routes (D955).
//
// Five steps: Basics → How it runs → Terms → Tools → Review. "Draft saved
// [time]" is drawn only from part 2's stored `updated_at`; nothing is held in
// the browser as if it were saved. `?proposal=<uid>` opens a stored proposal:
// a Draft or Sent back one in the form, any other read only, with HQ's note.
// Send to HQ opens a confirmation; part 2's refusal, `proposals_closed` while
// OD-PROP is open, is one sentence under the button.
import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Lightbox from '../../../ui/Lightbox';
import { contractsApi } from '../../../lib/api/contracts';
import { programProposalsApi } from '../../../lib/api/programProposals';
import AdminBoardFrame from '../AdminBoardFrame';
import { BlockFailed, CARD, EYE, H2, INPUT, LINK, Refusal, SUB, Skeleton } from './parts';
import { ProposalPill } from './ProposalTables';
import { BasicsFields, ChipGroup, EYEBROW, Field, HowItRunsFields } from './ProposalFields';
import {
  NO_NOTE, NOT_SET, PROPOSE_CRUMB, PROPOSE_LINE, PROPOSE_TITLE, REVIEW_FOOT, REVIEW_LINE, REWARDS, REWARDS_LINE, STEPS,
  TERMS_FOOT, TOOLS, TOOLS_LINE, dayLabel, emptyForm, fieldsFrom, formFrom, isEditable, missingFor, missingSentence,
  proposalHref, proposalRefusal, reviewRows, savedLabel, toggleReward,
} from './proposalsModel';

const BTN = 'inline-flex min-h-[36px] items-center rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[13px] font-bold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const PRIMARY = 'inline-flex min-h-[36px] items-center rounded-[9px] bg-axal-violet px-3.5 text-[13px] font-bold text-white disabled:opacity-50 dark:bg-violet-600';

/** The playbook HQ will read: each section's line, or "Not set". */
function ReviewSections({ form, testId }) {
  return (
    <dl className="m-0 flex flex-col gap-2.5" data-testid={testId}>
      {reviewRows(form).map((r) => (
        <div key={r.key} className="flex flex-col gap-0.5" data-testid={`${testId}-${r.key}`}>
          <dt className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.title}</dt>
          <dd className={`m-0 ${r.body ? 'text-[13px] text-axal-ink dark:text-gray-100' : SUB}`}>{r.body || NOT_SET}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Terms' contract templates, from the contracts library; a failed read marks this field alone. */
function TemplatePicker({ value, onChange }) {
  const [read, setRead] = useState({ state: 'loading', items: [] });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead({ state: 'loading', items: [] });
    contractsApi.templates().then(
      (d) => { if (live) setRead({ state: 'ready', items: d?.items || [] }); },
      () => { if (live) setRead({ state: 'unreadable', items: [] }); },
    );
    return () => { live = false; };
  }, [tick]);
  return (
    <div className="flex flex-col gap-1.5" data-testid="propose-templates">
      <span className={EYEBROW}>Contract templates</span>
      {read.state === 'loading' ? <Skeleton lines={1} testId="propose-templates-loading" /> : null}
      {read.state === 'unreadable' ? <BlockFailed what="The contract templates" onRetry={() => setTick((t) => t + 1)} testId="propose-templates-failed" /> : null}
      {read.state === 'ready' && !read.items.length ? <span className={SUB}>The contracts library has no template yet.</span> : null}
      {read.state === 'ready' && read.items.length ? (
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {read.items.map((t) => (
            <label key={t.slug} className="flex items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
              <input type="checkbox" checked={value.includes(t.slug)} data-testid={`propose-template-${t.slug}`}
                onChange={() => onChange(value.includes(t.slug) ? value.filter((s) => s !== t.slug) : [...value, t.slug])} />
              <span>{t.title || t.slug}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToolSwitches({ tools, set }) {
  return (
    <div className="flex flex-col gap-2" data-testid="propose-tools">
      {TOOLS.map(([k, label]) => (
        <div key={k} className="flex items-center justify-between gap-3 border-b border-axal-hairline pb-2 dark:border-gray-700">
          <span id={`propose-tool-${k}-label`} className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{`Needs ${label.charAt(0).toLowerCase()}${label.slice(1)}`}</span>
          <button type="button" role="switch" aria-checked={Boolean(tools[k])} aria-labelledby={`propose-tool-${k}-label`}
            onClick={() => set({ tools: { ...tools, [k]: !tools[k] } })}
            className={`relative h-6 w-11 shrink-0 rounded-full border ${tools[k] ? 'border-axal-violet bg-axal-violet dark:border-violet-500 dark:bg-violet-600' : 'border-axal-hairline bg-axal-ground dark:border-gray-700 dark:bg-gray-800'}`}
            data-testid={`propose-tool-${k}`}>
            <span aria-hidden="true" className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow dark:bg-gray-100 ${tools[k] ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** A proposal HQ has, or has decided: read only, with HQ's note. */
function ReadOnly({ proposal }) {
  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} data-testid="propose-readonly">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={H2}>{proposal.name || 'Untitled draft'}</h2>
        <ProposalPill status={proposal.status} testId="propose-readonly-status" />
      </div>
      <span className={SUB}>{proposal.sent_at ? `Sent to HQ ${dayLabel(proposal.sent_at)}.` : 'Not sent.'} It can no longer be changed here.</span>
      <div className="flex flex-col gap-0.5" data-testid="propose-readonly-note">
        <span className={EYEBROW}>HQ’s note</span>
        <span className={proposal.hq_note ? 'text-[13px] text-axal-ink dark:text-gray-100' : SUB}>{proposal.hq_note || NO_NOTE}</span>
      </div>
      <p className={`m-0 ${SUB}`}>{REVIEW_LINE}</p>
      <ReviewSections form={formFrom(proposal)} testId="propose-readonly-review" />
    </section>
  );
}

function ProposeBody() {
  const loc = useLocation();
  const navigate = useNavigate();
  const uid = new URLSearchParams(loc.search).get('proposal');
  const [read, setRead] = useState(uid ? { state: 'loading' } : { state: 'new' });
  const [proposal, setProposal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveRefusal, setSaveRefusal] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [sendRefusal, setSendRefusal] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!uid) { setRead({ state: 'new' }); return undefined; }
    if (proposal?.uid === uid) return undefined;
    let live = true;
    setRead({ state: 'loading' });
    programProposalsApi.one(uid).then(
      (d) => { if (!live) return; setProposal(d.proposal); setForm(formFrom(d.proposal)); setRead({ state: 'ready' }); },
      (e) => { if (live) setRead({ state: 'unreadable', refusal: Number(e?.status) === 404 ? proposalRefusal(e) : null }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, tick]);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setSaveRefusal(null); setSendRefusal(null); };

  /** Saves the form to part 2: a new draft first, then the same draft. Answers the stored proposal. */
  async function save() {
    setSaving(true); setSaveRefusal(null);
    try {
      const res = proposal?.uid
        ? await programProposalsApi.save(proposal.uid, fieldsFrom(form))
        : await programProposalsApi.start(fieldsFrom(form));
      const stored = res?.proposal;
      setProposal(stored);
      if (!proposal?.uid && stored?.uid) navigate(proposalHref(stored.uid), { replace: true });
      return stored;
    } catch (e) {
      setSaveRefusal(proposalRefusal(e));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    setSendRefusal(null);
    const stored = await save();
    if (!stored) { setConfirming(false); return; }
    try {
      const res = await programProposalsApi.send(stored.uid);
      setProposal(res?.proposal || stored);
      setConfirming(false);
    } catch (e) {
      setConfirming(false);
      setSendRefusal(proposalRefusal(e));
    }
  }

  const header = (
    <header className="flex flex-wrap items-start justify-between gap-3" data-testid="propose-header">
      <div className="flex min-w-0 flex-col gap-[7px]">
        <nav aria-label="Breadcrumb" className="text-[12.5px] font-semibold text-axal-muted dark:text-gray-400" data-testid="propose-crumb">
          <Link to="/admin/programs" className={LINK}>{PROPOSE_CRUMB}</Link>
          <span aria-hidden="true">{' › '}</span>
          <span>{PROPOSE_TITLE}</span>
        </nav>
        <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] text-axal-ink dark:text-gray-100">{PROPOSE_TITLE}</h1>
        <p className="m-0 text-[13.5px] leading-normal text-axal-muted dark:text-gray-400">{PROPOSE_LINE}</p>
      </div>
      {!proposal || isEditable(proposal.status)
        ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="propose-saved">{savedLabel(proposal)}</span>
        : null}
    </header>
  );

  if (read.state === 'loading') {
    return <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 pb-24 pt-6 sm:px-6">{header}<Skeleton lines={5} testId="propose-loading" /></div>;
  }
  if (read.state === 'unreadable') {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 pb-24 pt-6 sm:px-6">
        {header}
        {read.refusal
          ? <p className={`m-0 ${SUB}`} data-testid="propose-gone">{read.refusal}</p>
          : <BlockFailed what="This proposal" onRetry={() => setTick((t) => t + 1)} testId="propose-failed" />}
      </div>
    );
  }
  if (proposal && !isEditable(proposal.status)) {
    return <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 pb-24 pt-6 sm:px-6">{header}<ReadOnly proposal={proposal} /></div>;
  }

  const missing = missingFor(form);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 pb-24 pt-6 sm:px-6" data-testid="propose-page">
      {header}
      {proposal?.status === 'sent_back' ? (
        <div className={`${CARD} flex flex-col gap-1 px-[18px] py-3`} data-testid="propose-sent-back">
          <span className={EYEBROW}>Sent back by HQ</span>
          <span className="text-[13px] text-axal-ink dark:text-gray-100">{proposal.hq_note || NO_NOTE}</span>
        </div>
      ) : null}
      <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Steps" data-testid="propose-steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)}
              className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold ${i === step ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300' : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}
              data-testid={`propose-step-${i}`}>
              <span className="font-mono text-[11px]">{i + 1}</span>{s}
            </button>
          </li>
        ))}
      </ol>

      <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} data-testid={`propose-step-body-${step}`}>
        <span className={EYE}>{`Step ${step + 1} of ${STEPS.length}`}</span>
        <h2 className={H2}>{STEPS[step]}</h2>
        {step === 0 ? <BasicsFields form={form} set={set} prefix="propose" /> : null}
        {step === 1 ? <HowItRunsFields form={form} set={set} prefix="propose" /> : null}
        {step === 2 ? (
          <div className="flex flex-col gap-3">
            <ChipGroup label="Rewards" options={REWARDS} value={form.rewards} multi toggle={toggleReward} onChange={(rewards) => set({ rewards })} testId="propose-rewards" />
            <span className={SUB} data-testid="propose-rewards-line">{REWARDS_LINE}</span>
            <TemplatePicker value={form.template_keys} onChange={(template_keys) => set({ template_keys })} />
            <Field label="What HQ receives">
              <textarea rows={3} maxLength={1000} value={form.hq_receives} onChange={(e) => set({ hq_receives: e.target.value })} className={`${INPUT} py-2`} data-testid="propose-hq-receives" />
            </Field>
            <p className={`m-0 ${SUB}`} data-testid="propose-terms-foot">{TERMS_FOOT}</p>
          </div>
        ) : null}
        {step === 3 ? (
          <div className="flex flex-col gap-2">
            <span className={SUB} data-testid="propose-tools-line">{TOOLS_LINE}</span>
            <ToolSwitches tools={form.tools} set={set} />
          </div>
        ) : null}
        {step === 4 ? (
          <div className="flex flex-col gap-3">
            <p className={`m-0 ${SUB}`}>{REVIEW_LINE}</p>
            <ReviewSections form={form} testId="propose-review" />
            <div className="flex flex-col gap-1.5">
              <div>
                <button type="button" className={PRIMARY} disabled={missing.length > 0 || saving} onClick={() => setConfirming(true)} data-testid="propose-send">Send to HQ</button>
              </div>
              {missing.length ? <span className={SUB} data-testid="propose-missing">{missingSentence(missing)}</span> : null}
              <Refusal text={sendRefusal} testId="propose-send-refusal" />
            </div>
            <p className={`m-0 ${SUB}`}>{REVIEW_FOOT}</p>
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={BTN} disabled={step === 0} onClick={() => setStep(step - 1)} data-testid="propose-back">Back</button>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN} disabled={saving} onClick={save} data-testid="propose-save">{saving ? 'Saving…' : 'Save draft'}</button>
          {step < STEPS.length - 1
            ? <button type="button" className={PRIMARY} onClick={() => setStep(step + 1)} data-testid="propose-next">{`Next: ${STEPS[step + 1]}`}</button>
            : null}
        </div>
      </div>
      <Refusal text={saveRefusal} testId="propose-save-refusal" />

      {confirming ? (
        <Lightbox label="Send to HQ?" title={`Send ${form.name.trim() || 'this proposal'} to HQ?`}
          sub="HQ reviews it and answers under Your proposals. You cannot change it while HQ has it." onClose={() => setConfirming(false)} width={480} testId="propose-send-dialog">
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={BTN} onClick={() => setConfirming(false)} data-testid="propose-send-back">Back</button>
            <button type="button" className={PRIMARY} disabled={saving} onClick={send} data-testid="propose-send-confirm">Send to HQ</button>
          </div>
        </Lightbox>
      ) : null}
    </div>
  );
}

export default function ProposePage() {
  return (
    <AdminBoardFrame workspace="Programs" note="Nothing on this page reaches HQ until you choose Send to HQ." data-testid="admin-board-propose">
      <ProposeBody />
    </AdminBoardFrame>
  );
}

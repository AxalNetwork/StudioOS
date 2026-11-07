import React, { useEffect, useState } from 'react';
import { Card } from '../../../ui';
import { adminHqSkillsApi } from '../../../lib/api/adminHqSkills';
import { REASON_MAX, REASON_MIN, bulkLine, skillRefusal } from './refusals.js';
import {
  CASES_MAX, OUTPUT_KINDS, actionsFor, blankCase, caseToForm, casesPayload, diffChoices, diffRows, evalLine, isAskedReviewer, reasonFits,
} from './skillLifecycleModel.js';

/**
 * #4739 (D4160, H2 of #4137) — the From Axal skills' lifecycle, drawn.
 *
 *   SA3  `BulkBar`      Publish…, Re-run evals and Retire… for the skills ticked in the library
 *                       (`adminHqSkillsApi.bulk`), each skill done or refused on its own.
 *   SA4  `SkillLifecycle` on `/hq/ai-agents/skills/:uid/edit`: the review (ask, approve, request
 *                       changes), the golden cases, the evaluation, the diff and Retire…
 *
 * Every write takes a reason of 10 to 500 characters. A refusal shows the sentence
 * `refusals.js` keeps for its code, never the error's own text. The rules (which action a
 * status offers, a case as a form) are in `skillLifecycleModel.js`.
 */

const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const H3 = 'text-[13px] font-extrabold text-axal-ink dark:text-gray-100';
const BTN = 'rounded-lg border border-axal-hairline px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200';
const PRIMARY = 'rounded-lg bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50';
const DANGER = 'rounded-lg border border-red-300 px-3 py-1.5 text-[12.5px] font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-300';
const FIELD = 'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL = 'block text-[12.5px] font-semibold text-axal-ink dark:text-gray-200';
const ALERT = 'text-[12.5px] text-red-700 dark:text-red-300';

function ReasonField({ value, onChange, id, label = 'Reason · required' }) {
  return (
    <label className={LABEL}>
      {label}
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} maxLength={REASON_MAX} className={FIELD} data-testid={`skill-reason-${id}`} />
      <span className={MUTED}>{REASON_MIN} to {REASON_MAX} characters. It is recorded with the change.</span>
    </label>
  );
}

/** Runs one write; keeps the busy flag and the mapped refusal. */
function useWrite() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn) => {
    setBusy(true); setError('');
    try { return { ok: true, value: await fn() }; } catch (e) { setError(skillRefusal(e)); return { ok: false }; } finally { setBusy(false); }
  };
  return { busy, error, run, clear: () => setError('') };
}

// ─── SA3 · the library's bulk actions ───────────────────────────────────────

const BULK = {
  publish: { label: 'Publish…', go: 'Publish', note: 'A draft is published only with a second Super Admin’s approval and golden cases at or above the bar. Each skill is done or refused on its own.' },
  evals: { label: 'Re-run evals', go: 'Run the evals', note: 'Runs every live golden case on each model agents may run on. It is charged to HQ.' },
  retire: { label: 'Retire…', go: 'Retire', note: 'Retired skills leave the library for new agents. Agents that use them move to the replacement.' },
};

export function BulkBar({ rows, selected, onDone }) {
  const [open, setOpen] = useState(null);
  const [reason, setReason] = useState('');
  const [replacement, setReplacement] = useState('');
  const [lines, setLines] = useState(null);
  const write = useWrite();
  const uids = [...selected];
  const nameOf = (uid) => rows.find((r) => r.uid === uid)?.name ?? uid;
  const choices = rows.filter((r) => r.status.label === 'Published' && !selected.has(r.uid));
  const armed = uids.length > 0 && reasonFits(reason) && (open !== 'retire' || replacement);
  const close = () => { setOpen(null); setReason(''); setReplacement(''); write.clear(); };
  const submit = async () => {
    const r = await write.run(() => adminHqSkillsApi.bulk(open, uids, { reason: reason.trim(), replacementUid: open === 'retire' ? replacement : undefined }));
    if (!r.ok) return;
    setLines((r.value?.results ?? []).map((x) => ({ ok: x.ok, text: bulkLine(open, x, nameOf) })));
    close();
    onDone?.();
  };
  return (
    <div className="space-y-2" data-testid="ai-agents-bulk">
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(BULK).map(([key, b]) => (
          <button key={key} type="button" className={BTN} disabled={uids.length === 0} title={uids.length === 0 ? 'Tick the skills first.' : undefined}
            onClick={() => { setOpen(open === key ? null : key); setLines(null); write.clear(); }} data-testid={`ai-agents-bulk-${key}`}>{b.label}</button>
        ))}
        <span className={MUTED}>{uids.length === 0 ? 'Tick skills to act on them.' : `${uids.length} selected`}</span>
      </div>
      {open ? (
        <div className="space-y-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-700" role="group" aria-label={BULK[open].label} data-testid="ai-agents-bulk-form">
          <p className={MUTED}>{BULK[open].note}</p>
          {open === 'retire' ? (
            <label className={LABEL}>Replacement · required
              <select value={replacement} onChange={(e) => setReplacement(e.target.value)} className={FIELD} data-testid="skill-replacement">
                <option value="">Choose a published Axal skill</option>
                {choices.map((r) => <option key={r.uid} value={r.uid}>{r.name}</option>)}
              </select>
            </label>
          ) : null}
          <ReasonField id="bulk" value={reason} onChange={setReason} />
          <div className="flex gap-2">
            <button type="button" className={open === 'retire' ? DANGER : PRIMARY} disabled={!armed || write.busy} onClick={submit} data-testid="ai-agents-bulk-go">{write.busy ? 'Working…' : `${BULK[open].go} ${uids.length} skill${uids.length === 1 ? '' : 's'}`}</button>
            <button type="button" className={BTN} onClick={close}>Cancel</button>
          </div>
          {write.error ? <p role="alert" className={ALERT} data-testid="skill-error">{write.error}</p> : null}
        </div>
      ) : null}
      {lines ? (
        <ul className="space-y-0.5 text-[12.5px]" role="status" data-testid="ai-agents-bulk-results">
          {lines.map((l, i) => <li key={i} className={l.ok ? 'text-emerald-700 dark:text-emerald-300' : ALERT}>{l.text}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

// ─── SA4 · one skill ────────────────────────────────────────────────────────

function ReviewPanel({ data, viewerUid, reload }) {
  const [reviewer, setReviewer] = useState('');
  const [comment, setComment] = useState('');
  const write = useWrite();
  const { skill, review, reviewers } = data;
  const can = actionsFor(skill);
  const open = review?.open;
  const asked = isAskedReviewer(review, viewerUid);
  const done = async (fn) => { const r = await write.run(fn); if (r.ok) { setComment(''); setReviewer(''); reload(); } };
  return (
    <Card className="space-y-2 px-4 py-4" data-testid="skill-review">
      <h3 className={H3}>Review</h3>
      {open ? <p className={MUTED}>Review asked of {open.reviewer?.name ?? 'a Super Admin'}{open.current === false ? ', on an older draft. Ask again.' : '.'}</p>
        : review?.approved ? <p className={MUTED}>The current draft is approved. It can be published.</p>
        : <p className={MUTED}>No review is open on this draft.</p>}
      {open?.comment ? <p className={MUTED}>Comment: {open.comment}</p> : null}
      {can.review && !(open && open.current !== false) ? (
        <div className="space-y-2">
          <label className={LABEL}>Ask this Super Admin to review
            {reviewers == null ? <span className={`${ALERT} block`}>The Super Admins who can review could not be read.</span> : (
              <select value={reviewer} onChange={(e) => setReviewer(e.target.value)} className={FIELD} data-testid="skill-reviewer">
                <option value="">{reviewers.length ? 'Choose a Super Admin' : 'No other Super Admin can review this draft'}</option>
                {reviewers.map((r) => <option key={r.uid} value={r.uid}>{r.name ?? 'Not recorded'}</option>)}
              </select>
            )}
          </label>
          <button type="button" className={PRIMARY} disabled={!reviewer || write.busy} onClick={() => done(() => adminHqSkillsApi.requestReview(skill.uid, reviewer))} data-testid="skill-ask-review">Ask for review</button>
        </div>
      ) : null}
      {can.decide && open && open.current !== false ? (
        asked ? (
          <div className="space-y-2">
            <label className={LABEL}>Comment
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className={FIELD} data-testid="skill-comment" />
              <span className={MUTED}>Approving needs none. Asking for changes needs at least {REASON_MIN} characters.</span>
            </label>
            <div className="flex gap-2">
              <button type="button" className={PRIMARY} disabled={write.busy} onClick={() => done(() => adminHqSkillsApi.approve(skill.uid, comment.trim() || undefined))} data-testid="skill-approve">Approve</button>
              <button type="button" className={BTN} disabled={write.busy} onClick={() => done(() => adminHqSkillsApi.requestChanges(skill.uid, comment.trim()))} data-testid="skill-request-changes">Request changes</button>
            </div>
          </div>
        ) : <p className={MUTED}>Only {open.reviewer?.name ?? 'the Super Admin asked'} decides this review.</p>
      ) : null}
      {write.error ? <p role="alert" className={ALERT} data-testid="skill-error">{write.error}</p> : null}
    </Card>
  );
}

function CasesEditor({ data, reload }) {
  const [forms, setForms] = useState(() => data.cases.map(caseToForm));
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState(null);
  const write = useWrite();
  useEffect(() => { setForms(data.cases.map(caseToForm)); }, [data.cases]);
  const set = (i, k, v) => { setForms((fs) => fs.map((f, j) => (j === i ? { ...f, [k]: v } : f))); setProblem(null); };
  const save = async () => {
    const p = casesPayload(forms, reason);
    if (!p.ok) { setProblem(p); return; }
    const r = await write.run(() => adminHqSkillsApi.setCases(data.skill.uid, p.cases, p.reason));
    if (r.ok) { setReason(''); reload(); }
  };
  return (
    <Card className="space-y-3 px-4 py-4" data-testid="skill-cases">
      <h3 className={H3}>Golden cases</h3>
      <p className={MUTED}>A case is never edited in place: its results belong to its text, so a changed case is saved as a new one. Use made-up records, never an email address. Up to {CASES_MAX}.</p>
      {forms.length === 0 ? <p className={MUTED}>No golden cases yet.</p> : null}
      {forms.map((f, i) => (
        <fieldset key={f.uid ?? `new-${i}`} className="space-y-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-700" data-testid="skill-case">
          <legend className={`${LABEL} px-1`}>Case {i + 1}</legend>
          <label className={LABEL}>Name<input value={f.name} onChange={(e) => set(i, 'name', e.target.value)} className={FIELD} aria-invalid={problem?.index === i && problem.field === 'name' || undefined} /></label>
          <label className={LABEL}>Input records (JSON)<textarea value={f.records} onChange={(e) => set(i, 'records', e.target.value)} rows={4} className={`${FIELD} font-mono`} aria-invalid={problem?.index === i && problem.field === 'records' || undefined} /></label>
          <label className={LABEL}>Expected output
            <select value={f.output} onChange={(e) => set(i, 'output', e.target.value)} className={FIELD}>{OUTPUT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
          </label>
          {[['must_include', 'Must include (one phrase per line)'], ['must_say_not_recorded', 'Must say “Not recorded” about (one per line)'], ['must_not_include', 'Must not include (one phrase per line)']].map(([k, label]) => (
            <label key={k} className={LABEL}>{label}<textarea value={f[k]} onChange={(e) => set(i, k, e.target.value)} rows={2} className={FIELD} /></label>
          ))}
          {problem?.index === i ? <p role="alert" className={ALERT} data-testid="skill-case-problem">{problem.problem}</p> : null}
          <button type="button" className={BTN} onClick={() => { setForms((fs) => fs.filter((_, j) => j !== i)); setProblem(null); }}>Remove case</button>
        </fieldset>
      ))}
      <div className="flex gap-2">
        <button type="button" className={BTN} disabled={forms.length >= CASES_MAX} onClick={() => setForms((fs) => [...fs, blankCase()])} data-testid="skill-add-case">Add a case</button>
      </div>
      <ReasonField id="cases" value={reason} onChange={(v) => { setReason(v); setProblem(null); }} />
      {problem && problem.index == null ? <p role="alert" className={ALERT} data-testid="skill-case-problem">{problem.problem}</p> : null}
      <button type="button" className={PRIMARY} disabled={write.busy} onClick={save} data-testid="skill-save-cases">{write.busy ? 'Saving…' : 'Save golden cases'}</button>
      {write.error ? <p role="alert" className={ALERT} data-testid="skill-error">{write.error}</p> : null}
    </Card>
  );
}

function EvalsPanel({ data, reload }) {
  const write = useWrite();
  const run = async () => { const r = await write.run(() => adminHqSkillsApi.runEvals(data.skill.uid)); if (r.ok) reload(); };
  return (
    <Card className="space-y-2 px-4 py-4" data-testid="skill-evals">
      <h3 className={H3}>Evaluation</h3>
      <p className={MUTED}>{evalLine(data.evals)}. Publishing needs {data.evals?.pass_bar ? `${data.evals.pass_bar.pass} of ${data.evals.pass_bar.of}` : '9 of 10'} runs to pass. Running the evals is charged to HQ.</p>
      <button type="button" className={BTN} disabled={write.busy || data.cases.length === 0} title={data.cases.length === 0 ? 'Add a golden case first.' : undefined} onClick={run} data-testid="skill-run-evals">{write.busy ? 'Running…' : 'Re-run evals'}</button>
      {write.error ? <p role="alert" className={ALERT} data-testid="skill-error">{write.error}</p> : null}
    </Card>
  );
}

function DiffPanel({ data }) {
  const choices = diffChoices(data.versions);
  const [from, setFrom] = useState(data.versions[0] ? `v${data.versions[0].version}` : 'draft');
  const [to, setTo] = useState('draft');
  const [result, setResult] = useState(null);
  const write = useWrite();
  const show = async () => { const r = await write.run(() => adminHqSkillsApi.diff(data.skill.uid, { from, to })); if (r.ok) setResult(diffRows(r.value)); };
  return (
    <Card className="space-y-2 px-4 py-4" data-testid="skill-diff">
      <h3 className={H3}>Changes</h3>
      <div className="flex flex-wrap items-end gap-2">
        <label className={LABEL}>From<select value={from} onChange={(e) => setFrom(e.target.value)} className={FIELD} data-testid="skill-diff-from">{choices.map((c) => <option key={c} value={c}>{c === 'draft' ? 'Draft' : c}</option>)}</select></label>
        <label className={LABEL}>To<select value={to} onChange={(e) => setTo(e.target.value)} className={FIELD} data-testid="skill-diff-to">{choices.map((c) => <option key={c} value={c}>{c === 'draft' ? 'Draft' : c}</option>)}</select></label>
        <button type="button" className={BTN} disabled={write.busy || from === to} onClick={show} data-testid="skill-diff-go">Compare</button>
      </div>
      {write.error ? <p role="alert" className={ALERT} data-testid="skill-error">{write.error}</p> : null}
      {result ? (result.changed ? (
        <div className="space-y-1 text-[12.5px]" data-testid="skill-diff-rows">
          {result.fields.map((f) => <p key={f.label}><strong className="capitalize">{f.label}</strong>: {f.from} → {f.to}</p>)}
          <ol className="list-decimal space-y-0.5 pl-5">
            {result.steps.map((s, i) => <li key={i} className={s.kind === 'added' ? 'text-emerald-700 dark:text-emerald-300' : s.kind === 'removed' ? 'text-red-700 line-through dark:text-red-300' : MUTED}>{s.kind === 'added' ? '+ ' : s.kind === 'removed' ? '− ' : ''}{s.text}</li>)}
          </ol>
        </div>
      ) : <p className={MUTED}>Nothing differs between these two.</p>) : null}
    </Card>
  );
}

function RetirePanel({ data, reload }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState(null);
  const [replacement, setReplacement] = useState('');
  const [reason, setReason] = useState('');
  const write = useWrite();
  useEffect(() => {
    if (!open || options) return;
    adminHqSkillsApi.list().then((r) => setOptions((r?.skills ?? []).filter((s) => s.status === 'published' && s.uid !== data.skill.uid))).catch(() => setOptions(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => { const r = await write.run(() => adminHqSkillsApi.retire(data.skill.uid, replacement, reason.trim())); if (r.ok) { setOpen(false); reload(); } };
  if (data.retired) return null;
  return (
    <Card className="space-y-2 px-4 py-4" data-testid="skill-retire">
      <h3 className={H3}>Retire</h3>
      {!open ? <button type="button" className={DANGER} onClick={() => setOpen(true)} data-testid="skill-retire-open">Retire…</button> : (
        <div className="space-y-2">
          <p className={MUTED}>{data.skill.agents == null ? 'The agents that use this skill' : `${data.skill.agents} agent${data.skill.agents === 1 ? '' : 's'} use this skill and`} move to the replacement.</p>
          <label className={LABEL}>Replacement · required
            {options === false ? <span className={`${ALERT} block`}>The published skills could not be read.</span> : (
              <select value={replacement} onChange={(e) => setReplacement(e.target.value)} className={FIELD} data-testid="skill-replacement">
                <option value="">{options ? 'Choose a published Axal skill' : 'Reading…'}</option>
                {(options || []).map((s) => <option key={s.uid} value={s.uid}>{s.name}</option>)}
              </select>
            )}
          </label>
          <ReasonField id="retire" value={reason} onChange={setReason} />
          <div className="flex gap-2">
            <button type="button" className={DANGER} disabled={!replacement || !reasonFits(reason) || write.busy} onClick={go} data-testid="skill-retire-go">{write.busy ? 'Retiring…' : 'Retire this skill'}</button>
            <button type="button" className={BTN} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {write.error ? <p role="alert" className={ALERT} data-testid="skill-error">{write.error}</p> : null}
    </Card>
  );
}

/** SA4's actions, under the recorded details. `reload` re-reads the skill after a write. */
export default function SkillLifecycle({ data, viewerUid, reload }) {
  const can = actionsFor(data.skill);
  return (
    <div className="space-y-3" data-testid="skill-lifecycle">
      <ReviewPanel data={data} viewerUid={viewerUid} reload={reload} />
      {can.cases ? <CasesEditor data={data} reload={reload} /> : null}
      {can.evals ? <EvalsPanel data={data} reload={reload} /> : null}
      <DiffPanel data={data} />
      {can.retire ? <RetirePanel data={data} reload={reload} /> : null}
    </div>
  );
}

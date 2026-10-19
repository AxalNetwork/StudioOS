/**
 * D693 (#1704) — Record a decision, Verdict's Add (`__verdict`, CO:335), in
 * D695's field format (`forms.js`): the canvas's T, CH and CK kinds, its copy
 * byte for byte with the brackets dropped from its placeholders.
 *
 * - **Decision** is Proceed, Pivot or Stop, Proceed first.
 * - **For** and **Evidence it rests on** are the Worker's choices
 *   (`GET /api/cycles/validate/modules/verdict/form-options`, #1703), read by
 *   `loadOptions` through `cyclesWrite.formOptions`. For starts on The venture,
 *   or on `?for=h-<id>` (`fromQuery`), which an Experiments record links to.
 * - **No evidence is checked** at first, a departure from the canvas's sample
 *   rows (D693.md): the founder states what the decision rests on. The note
 *   counts the checks as they change. **Amended by D757 (#1928):** the
 *   interview evidence the Worker names in `evidence.suggested_evidence`
 *   starts checked (`withSuggestedEvidence`); every other row starts clear.
 * - **If Pivot** is drawn only while Pivot is chosen.
 *
 * It submits through `verdictApi.record`, handed in as `w.verdict` (the page's
 * Add writes, `formWrites` in `CycleRoute.jsx`), and has no Edit: a decision
 * is never edited (D693 decision 4). It is registered in `forms.js` as
 * `FORMS.validate.verdict` (#1704's closing PR). It imports nothing, so the
 * Worker's tests can read `forms.js`.
 */

/** Checked pieces of evidence a decision needs before a verdict is given (the Worker's `DECISION_EVIDENCE_BAR`). */
export const DECISION_EVIDENCE_BAR = 5;

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const FOR_VALUE = /^(venture|h-[1-9][0-9]{0,9})$/;

/** "<n> of 5 needed before a verdict is given. Below that it is withheld.", n the checks now. */
export const evidenceNote = (values) => {
  const n = Array.isArray(values?.evidence) ? values.evidence.length : 0;
  return `${n} of ${DECISION_EVIDENCE_BAR} needed before a verdict is given. Below that it is withheld.`;
};

/**
 * D757 §2.6 (#1928): the interview evidence that arrived since the last
 * decision (`evidence.suggested_evidence`, #1925) starts checked. The founder
 * may untick any of it; nothing is decided for them.
 */
export function withSuggestedEvidence(read) {
  const evidence = read?.evidence;
  const suggested = Array.isArray(evidence?.suggested_evidence) ? new Set(evidence.suggested_evidence.map(String)) : null;
  if (!suggested || !suggested.size || !Array.isArray(evidence?.options)) return read;
  return { ...read, evidence: { ...evidence, options: evidence.options.map((o) => (suggested.has(String(o?.value)) ? { ...o, checked: true } : o)) } };
}

export const verdictForm = {
  key: 'decision',
  button: 'Record a decision',
  cta: 'Record',
  title: 'Record a decision',
  sub: 'For the venture or one hypothesis. Earlier decisions stay.',
  foot: 'Partners do not see decisions.',
  fields: [
    { name: 'decision', kind: 'CH', k: 'Decision', required: true, initial: 'proceed',
      options: [{ value: 'proceed', label: 'Proceed' }, { value: 'pivot', label: 'Pivot' }, { value: 'stop', label: 'Stop' }] },
    // The venture until the Worker's choices arrive; they replace this list.
    { name: 'for', kind: 'CH', k: 'For', required: true, initial: 'venture', options: [{ value: 'venture', label: 'The venture' }] },
    { name: 'reasoning', kind: 'T', k: 'Reasoning', input: 'text', ph: 'Why, in your words', h: '56px', max: 4000 },
    { name: 'evidence', kind: 'CK', k: 'Evidence it rests on', options: [], note: evidenceNote },
    { name: 'pivot_claim', kind: 'T', k: 'If Pivot: the new hypothesis', input: 'text', ph: 'Claim it starts', max: 500,
      when: { name: 'decision', value: 'pivot' } },
  ],
  /** `?for=h-<id>` presets For; anything else leaves The venture. */
  fromQuery: (searchParams) => {
    const value = searchParams?.get?.('for');
    return value && FOR_VALUE.test(value) ? { for: value } : {};
  },
  loadOptions: (w, projectId) => w.formOptions('validate', projectId, 'verdict').then(withSuggestedEvidence),
  toBody: (v) => ({
    decision: v.decision || 'proceed',
    for: FOR_VALUE.test(String(v.for ?? '')) ? v.for : 'venture',
    reasoning: str(v.reasoning),
    evidence: Array.isArray(v.evidence) ? v.evidence.map(String) : [],
    ...(v.decision === 'pivot' && str(v.pivot_claim) ? { pivot_claim: str(v.pivot_claim) } : {}),
  }),
  submit: (w, projectId, v) => w.verdict.record(projectId, verdictForm.toBody(v)),
};

export default verdictForm;

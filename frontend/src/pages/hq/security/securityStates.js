/**
 * D4800 (#4800, canvas board SE02, D4803) — the shared state vocabulary for
 * every Security v2 workspace.
 *
 * Thirteen states, each with a WORD, a SHAPE and a DESCRIPTION, so a status
 * is never colour alone: the word is drawn, the shape differs in greyscale,
 * and the description is read out to assistive technology. "Not recorded" is
 * retired here — it was hiding five different facts (Unavailable, Not
 * instrumented, Unsupported, Measured zero and No data yet), and an operator
 * could not tell a store that failed from a store that held nothing.
 *
 * The words and descriptions are the canvas's own (SE02), verbatim. The tone
 * is a hint for colour only; nothing may depend on it alone.
 *
 * This is data plus two pure helpers so a Worker-free test can pin it, and so
 * #4801 to #4803 reuse one copy. `StatusBadge.jsx` draws it.
 */
export const SECURITY_STATES = Object.freeze({
  verified: { word: 'Verified', shape: 'check', tone: 'positive', description: 'Checked against evidence and confirmed.' },
  healthy: { word: 'Healthy', shape: 'check', tone: 'positive', description: 'Read recently; nothing needs attention.' },
  action_required: { word: 'Action required', shape: 'triangle', tone: 'attention', description: 'An operator needs to act.' },
  failed: { word: 'Failed', shape: 'cross', tone: 'negative', description: 'The last attempt or check failed.' },
  pending: { word: 'Pending', shape: 'clock', tone: 'progress', description: 'Started or scheduled; not finished yet.' },
  stale: { word: 'Stale', shape: 'dashed-ring', tone: 'attention-soft', description: 'Last good evidence is older than its threshold.' },
  unknown: { word: 'Unknown', shape: 'question', tone: 'neutral', description: 'Evidence exists but cannot say which way.' },
  unavailable: { word: 'Unavailable', shape: 'struck-square', tone: 'neutral', description: 'The source could not be read this time.' },
  not_instrumented: { word: 'Not instrumented', shape: 'dotted-ring', tone: 'neutral', description: 'Nothing records this yet.' },
  unsupported: { word: 'Unsupported', shape: 'struck-ring', tone: 'neutral', description: 'The product does not do this.' },
  not_applicable: { word: 'Not applicable', shape: 'dash', tone: 'neutral', description: 'Does not apply to this scope.' },
  measured_zero: { word: 'Measured zero', shape: 'zero', tone: 'neutral', description: 'Read successfully; the count is 0.' },
  no_data_yet: { word: 'No data yet', shape: 'ring', tone: 'neutral', description: 'Instrumented, but nothing has happened yet.' },
});

export const SECURITY_STATE_KEYS = Object.freeze(Object.keys(SECURITY_STATES));

/**
 * One state by key. An unknown key throws rather than falling back: a badge
 * that quietly read "Healthy" for a typo is the failure this vocabulary
 * exists to prevent.
 */
export function securityState(key) {
  const s = SECURITY_STATES[key];
  if (!s) throw new Error(`Unknown security state: ${String(key)}`);
  return { key, ...s };
}

/**
 * Severity order for lists that lead with what is worst (Action required,
 * the tab marks). Lower sorts first. States that are not findings sort last.
 */
const SEVERITY = { failed: 0, action_required: 1, unavailable: 2, stale: 3, unknown: 4, pending: 5 };
export const severityOf = (key) => (key in SEVERITY ? SEVERITY[key] : 9);

/**
 * A count as the page should show it, or the state that stands in for it.
 *
 * AN UNREADABLE VALUE IS NEVER 0. `null`, `undefined`, a non-number, or a
 * caller that says the read failed all come back `unavailable` with no text,
 * and the caller draws the badge and a Retry. A real zero comes back as the
 * figure `0` with `measured_zero`, so a zero that was read and a zero that was
 * guessed can never look the same.
 */
export function readFigure(value, { readable = true } = {}) {
  if (!readable || value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    return { state: 'unavailable', text: null };
  }
  const n = Number(value);
  return { state: n === 0 ? 'measured_zero' : null, text: n.toLocaleString() };
}

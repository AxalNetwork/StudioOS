// D716 (#1866) — the LP's Subscription Booklet on screen, as pure rules: the
// parts the form walks, the rail's rows, the phone's steps, the tick queue and
// when Submit may send. No React and no DOM, so a test reads it directly.
//
// Every field id, title, text and group comes from the Worker's last view
// (`GET /api/fund-booklets/mine`). Nothing here builds an id, hashes text or
// reads a part's body. Nothing is stored in the browser.

/** The Worker's stub sentence (`PART_STUB`, services/legalPaper.ts), word for word. */
export const PART_STUB = 'Stub — counsel to draft.';

/** The parts the form walks. Part 1, the cover, is not one of them. */
export const FORM_PARTS = [2, 3, 4, 5, 6, 7, 8, 9];

/** The canvas's short names, for the rail and the review rows (L7). */
export const BOOKLET_RAIL_LABELS = {
  2: 'Instructions',
  3: 'Subscription Agreement',
  4: 'Investor Questionnaire',
  5: 'AML/KYC',
  6: 'Tax status',
  7: 'Electronic delivery',
  8: 'Signature pages',
  9: 'GP acceptance',
};

export const BOOKLET_COPY = {
  section: 'Subscription Booklet',
  railHeading: 'Subscription Booklet',
  railRow: (n, label) => `Part ${n} · ${label}`,
  done: 'Done · ',
  stub: ' · Stub',
  partOf: (n) => `Part ${n} of 9`,
  introDesktop: 'Tick what applies. Your answers fill the paper page exactly as it will be signed.',
  introPhone: 'Tick what applies. The paper page shows exactly these boxes.',
  readTitle: 'Sign the Subscription Booklet',
  back: 'Back',
  toBoxes: 'Continue to the boxes',
  continue: 'Continue',
  review: 'Review',
  next: (n, label) => `Next: Part ${n} · ${label}`,
  noBoxes: 'This part has no boxes to tick.',
  stubNote: 'This part has no boxes until counsel writes it.',
  partTicked: (k, m) => `${k} of ${m} ticked`,
  partNoBoxes: 'No boxes',
  partStub: 'Stub',
  boxesTicked: (k, m) => `${k} of ${m} boxes ticked`,
  noBoxesYet: 'No boxes to tick yet.',
  freezeLine: 'Submitting freezes your answers. They can no longer change.',
  submit: 'Submit the booklet',
  submitting: 'Submitting…',
  submittedPill: 'Submitted',
  frozenLine: 'Your answers can no longer change.',
  openLine: 'Your application is approved. Open your Subscription Booklet to read each part and tick what applies.',
  openButton: 'Open the booklet',
  continueBooklet: 'Continue the booklet',
  readBooklet: 'Read the booklet',
  loading: 'Reading your booklet…',
  unreadable: 'The booklet could not be read.',
  paperFailed: 'The paper page did not load.',
  drawing: 'Drawing…',
  retry: 'Retry',
  banner: 'Your Subscription Booklet is below: read each part, tick what applies, then submit it.',
};

const missingSet = (view) => new Set([
  ...(view?.missing_parts || []),
  ...(view?.parts || []).filter((p) => p.missing).map((p) => p.part),
]);

/** Consecutive runs of fields with the same `group`, in the Worker's order. */
export function groupsOf(fields) {
  const out = [];
  for (const f of fields || []) {
    const heading = f.group ?? null;
    const last = out[out.length - 1];
    if (last && last.heading === heading) last.fields.push(f);
    else out.push({ heading, fields: [f] });
  }
  return out;
}

/** Parts 2 to 9 as the form draws them. A title is the Worker's. */
export function formParts(view) {
  const missing = missingSet(view);
  return FORM_PARTS.map((n) => {
    const p = (view?.parts || []).find((x) => x.part === n);
    const fields = p?.fields || [];
    return { n, title: p?.title || BOOKLET_RAIL_LABELS[n], label: BOOKLET_RAIL_LABELS[n], missing: missing.has(n), fields, groups: groupsOf(fields) };
  });
}

/** The phone's walk: Read for each part, Check when it has fields, then Review. */
export function phoneSteps(view) {
  const steps = [];
  for (const p of formParts(view)) {
    steps.push({ kind: 'read', part: p.n });
    if (p.fields.length) steps.push({ kind: 'check', part: p.n });
  }
  steps.push({ kind: 'review', part: null });
  return steps;
}

/** One rail row. Every row reads Done once the booklet is submitted. */
export function railRow(part, { current = false, done = false, submitted = false } = {}) {
  const isDone = submitted || (done && !current);
  return {
    text: `${isDone ? BOOKLET_COPY.done : ''}${BOOKLET_COPY.railRow(part.n, part.label)}`,
    stub: !!part.missing,
    tone: current ? 'current' : isDone ? 'done' : 'muted',
  };
}

/** The Worker's refusal, worded from `missing_parts`. Null when nothing is missing. */
export function missingLine(missing) {
  const parts = [...new Set(missing || [])].sort((a, b) => a - b).map((n) => `Part ${n}`);
  if (!parts.length) return null;
  const names = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `The booklet cannot be submitted yet: ${names} ${parts.length === 1 ? 'has' : 'have'} no text from counsel.`;
}

/** Ticked and total, overall and per part. */
export function tickCounts(view) {
  const byPart = {};
  let ticked = 0, total = 0;
  for (const p of formParts(view)) {
    const k = p.fields.filter((f) => f.checked).length;
    byPart[p.n] = { ticked: k, total: p.fields.length };
    ticked += k; total += p.fields.length;
  }
  return { ticked, total, byPart };
}

const fieldIds = (view) => new Set((view?.parts || []).flatMap((p) => (p.fields || []).map((f) => f.id)));

/** The queue with one tap. An id the view does not carry leaves it as it was. */
export function queueTick(queue, view, fieldId, checked) {
  if (!fieldIds(view).has(fieldId)) return queue;
  return [...(queue || []), { field_id: fieldId, checked: !!checked }];
}

/** The PUT body's list: the last tap per id. */
export function answersOf(queue) {
  const last = new Map();
  for (const t of queue || []) last.set(t.field_id, t.checked);
  return [...last].map(([field_id, checked]) => ({ field_id, checked }));
}

/** The view with the queued taps applied, so a tap shows at once. */
export function withQueued(view, queue) {
  if (!view) return view;
  const taps = new Map(answersOf(queue).map((a) => [a.field_id, a.checked]));
  if (!taps.size) return view;
  return {
    ...view,
    parts: (view.parts || []).map((p) => ({
      ...p,
      fields: (p.fields || []).map((f) => (taps.has(f.id) ? { ...f, checked: taps.get(f.id) } : f)),
    })),
  };
}

const busy = (x) => (Array.isArray(x) ? x.length > 0 : !!x);

/** Submit sends only for an open booklet with nothing missing, queued, in flight or just refused. */
export function canSubmit({ view, queued, inFlight, refused } = {}) {
  return !!view && view.status === 'open' && !(view.missing_parts || []).length
    && !busy(queued) && !busy(inFlight) && !refused;
}

/** The digest Submit posts: the last view's, and only when Submit may send. */
export function submitDigest(view, state = {}) {
  return canSubmit({ ...state, view }) ? view.digest : null;
}

/** "Submitted 2026-10-18 14:05 UTC · digest 1a2b3c4d5e6f". */
export function submittedLine(view) {
  const at = String(view?.submitted_at || '').replace('T', ' ').slice(0, 16);
  return `Submitted ${at} UTC · digest ${String(view?.digest || '').slice(0, 12)}`;
}

/**
 * The ICP definition — Customer Discovery's five-step wizard (D353).
 *
 * The store is `projects.icp_definition_meta` (migration 308), written through
 * `PUT /api/projects/:id` and canonicalised by `normalizeIcpDefinitionMeta` in
 * routes/projects.ts. That normaliser is the authority: it drops unknown keys,
 * refuses a choice that is not one of these options, refuses to CONFIRM with a
 * required answer missing, and sets `version` / `confirmed_at` / `updated_at`
 * itself from the stored row. This module mirrors its field list so the page
 * can draw the wizard; `spinout_lab_icp_definition.test.mjs` holds the two
 * lists equal, key for key and option for option.
 *
 * Pure: no React, so the test imports it directly.
 */

export const ICP_STEPS = [
  {
    n: 1, name: 'Who they are', title: 'Who are you building for?',
    blurb: 'Narrow beats broad here. A specific person at a specific kind of company gives you copy you can actually write.',
    fields: [
      { key: 'type', label: 'Customer type', help: 'Who signs off on the purchase.', kind: 'choice', options: ['B2B', 'B2C', 'Both'] },
      { key: 'industry', label: 'Industry or vertical', help: 'A specific vertical, not "technology".', kind: 'text' },
      { key: 'size', label: 'Company size', help: 'The band where your pain is sharpest.', kind: 'choice', options: ['1–20 employees', '20–50 employees', '50–500 employees', '500+ employees'] },
      { key: 'persona', label: 'Role or persona', help: 'The job title of the person who feels this daily.', kind: 'text' },
      { key: 'geo', label: 'Geography', help: 'Where you can realistically sell in the first year.', kind: 'text' },
    ],
  },
  {
    n: 2, name: 'What they struggle with', title: 'What breaks for them today?',
    blurb: 'Pull these straight from your interviews. If you cannot quote someone saying it, it is a guess.',
    fields: [
      { key: 'pain1', label: 'Primary pain point', help: 'The one that would make them switch. One sentence.', kind: 'area' },
      { key: 'pain2', label: 'Secondary pain', help: 'Optional. Real but not decisive on its own.', kind: 'text', optional: true },
      { key: 'pain3', label: 'Third pain', help: 'Optional. Leave blank if you are not sure.', kind: 'text', optional: true },
      { key: 'alternative', label: 'How they solve it today', help: 'Usually a workaround, not a competitor.', kind: 'text' },
      { key: 'whyFail', label: 'Why that fails them', help: 'This becomes your problem section. Be specific.', kind: 'area' },
    ],
  },
  {
    n: 3, name: 'What they want', title: 'What does success look like to them?',
    blurb: 'Their words for the outcome, not your feature list.',
    fields: [
      { key: 'outcome', label: 'Desired outcome', help: 'The after state, described the way they would describe it.', kind: 'area' },
      { key: 'trigger', label: 'Motivating trigger', help: 'What changes that makes them start looking.', kind: 'text' },
      { key: 'metric', label: 'Metric they care about', help: 'How they would know it worked.', kind: 'text' },
    ],
  },
  {
    n: 4, name: 'How they buy', title: 'How do they actually buy?',
    blurb: 'This sets how hard your call to action pushes, and which objection you answer first.',
    fields: [
      { key: 'urgency', label: 'Urgency', help: 'Be honest — most early markets are not urgent yet.', kind: 'choice', options: ['Active — looking now', 'Aware — not yet looking', 'Latent — does not know it is a problem'] },
      { key: 'budget', label: 'Budget sensitivity', help: 'A tier, not an exact number.', kind: 'choice', options: ['Low — free or near-free', 'Mid — $200/mo per team ceiling', 'High — budget exists, needs a case'] },
      { key: 'objection', label: 'Most common objection', help: 'The sentence you hear on every call.', kind: 'area' },
    ],
  },
  {
    n: 5, name: 'Positioning', title: 'How do you say it?',
    blurb: 'These three answers become your hero copy. Write them badly first, then sharpen.',
    fields: [
      { key: 'valueProp', label: 'One-sentence value proposition', help: 'What it does, for whom, without adjectives.', kind: 'area' },
      { key: 'differentiator', label: 'Key differentiator', help: 'What is true of you that is not true of the alternative.', kind: 'area' },
      { key: 'tone', label: 'Tone', help: 'Drives the voice of generated copy.', kind: 'choice', options: ['Confident', 'Technical', 'Friendly', 'Premium'] },
    ],
  },
];

const ALL_FIELDS = ICP_STEPS.flatMap((s) => s.fields);
const filled = (fields, key) => typeof fields?.[key] === 'string' && fields[key].trim().length > 0;

/**
 * Read the stored column. Returns `{ state: 'empty' }` for no definition,
 * `{ state: 'unreadable' }` for a value that is not a readable blob (never a
 * silent "not started"), or the parsed definition with its state.
 */
export function readIcpDefinition(raw) {
  if (raw === null || raw === undefined || raw === '') return { state: 'empty', fields: {} };
  let o = raw;
  if (typeof raw === 'string') {
    try { o = JSON.parse(raw); } catch { return { state: 'unreadable', fields: {} }; }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { state: 'unreadable', fields: {} };
  const fields = o.fields && typeof o.fields === 'object' && !Array.isArray(o.fields) ? o.fields : {};
  const step = Number.isInteger(Number(o.step)) && Number(o.step) >= 1 && Number(o.step) <= 5 ? Number(o.step) : 1;
  return {
    state: o.status === 'confirmed' ? 'confirmed' : 'draft',
    step,
    fields,
    version: Number.isInteger(Number(o.version)) ? Number(o.version) : 0,
    confirmedAt: typeof o.confirmed_at === 'string' ? o.confirmed_at : null,
    updatedAt: typeof o.updated_at === 'string' ? o.updated_at : null,
  };
}

/** Required answers per step, and overall — the canvas's progress figures. */
export function icpProgress(fields) {
  const steps = ICP_STEPS.map((s) => {
    const req = s.fields.filter((f) => !f.optional);
    return { n: s.n, name: s.name, done: req.filter((f) => filled(fields, f.key)).length, total: req.length };
  });
  const done = steps.reduce((a, s) => a + s.done, 0);
  const total = steps.reduce((a, s) => a + s.total, 0);
  return { steps, done, total, pct: total ? Math.round((done / total) * 100) : 0, complete: done === total };
}

/** The payload the page PUTs — the Worker sets version and timestamps. */
export function icpPayload({ status, step, fields }) {
  const clean = {};
  for (const f of ALL_FIELDS) {
    if (filled(fields, f.key)) clean[f.key] = fields[f.key].trim();
  }
  return JSON.stringify({ status: status === 'confirmed' ? 'confirmed' : 'draft', step, fields: clean });
}

/** The confirmed summary rows the canvas draws, only for answers on file. */
export function icpSummary(fields) {
  const rows = [
    ['Primary pain', fields?.pain1],
    ['Solves it today with', fields?.alternative],
    ['Why that fails', fields?.whyFail],
    ['Desired outcome', fields?.outcome],
    ['Buying trigger', [fields?.trigger, fields?.urgency].filter(Boolean).join(' · ')],
    ['Key objection', fields?.objection],
  ];
  return rows.filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => ({ k, v }));
}

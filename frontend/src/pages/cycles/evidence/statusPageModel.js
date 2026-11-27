/**
 * D6897 part 4 (#6897, canvas D6054 RA-31): the words of the Raise status page, as plain functions so every sentence
 * is testable. The sheet (`ShareStatus.jsx`), the reader's page (`pages/share/RaiseStatusPage.jsx`) and the A4 copy
 * (`lib/raiseSharePdf.js`) all draw from here.
 *
 * Everything on the page is the Worker's frozen copy (`services/raiseStatusPage.ts`): the stage, five materials in
 * state words, investor counts by stage, readiness by area, the next three steps and each connected tool's read state.
 * Nothing is recomputed here. Investor names and commitment amounts are never on it.
 */
import { day } from './evidenceView';
import { LINK_LIMITS } from './shareOutsideModel';
import { pdfFilename } from './sharePdfModel';

const NR = 'Not recorded';
const intIn = (v, [lo, hi]) => Number.isInteger(v) && v >= lo && v <= hi;

/** RA-31 A: what the sheet says is on the page, and what is left out. */
export const STATUS_ON_PAGE = Object.freeze([
  { key: 'stage', word: 'Stage', line: 'From the Overview' },
  { key: 'materials', word: 'Materials', line: '5 rows, state words only' },
  { key: 'investors', word: 'Investors', line: 'Counts by stage only' },
  { key: 'readiness', word: 'Readiness by area', line: '7 areas, as on the snapshot' },
  { key: 'next', word: 'Next steps', line: '3, as on the Overview' },
  { key: 'tools', word: 'Connected tools', line: 'With their read state' },
]);
export const STATUS_LEFT_OUT = Object.freeze({ word: 'Investor names and commitment amounts', line: 'Left out; counts by stage only' });
export const STATUS_IS_DATED = 'This shows the raise as of the day you make it; it does not update. Make a new one after a change.';
export const STATUS_UNREADABLE = 'Part of the raise could not be read, so no status page was made. Nothing left Axal. Try again.';
export const NO_NAMES = 'No investor names or commitment amounts.';

/** The sheet's checks, the same ones the Worker makes. */
export function statusErrors(form) {
  const e = {};
  const label = String(form?.label ?? '').trim();
  if (!label) e.label = 'Name who this is for.';
  else if (label.length > LINK_LIMITS.label) e.label = `At most ${LINK_LIMITS.label} characters.`;
  if (form?.output !== 'pdf') {
    if (!intIn(form?.expires_in_days, LINK_LIMITS.expires_in_days)) e.expires_in_days = 'Between 1 and 90 days.';
    if (!intIn(form?.view_limit, LINK_LIMITS.view_limit)) e.view_limit = 'Between 1 and 100 views.';
  }
  return e;
}
export function statusRequest(form) {
  const label = String(form.label).trim();
  return form?.output === 'pdf' ? { label } : { label, expires_in_days: form.expires_in_days, view_limit: form.view_limit };
}

/** "Prepare, Build the story and Prepare diligence done", or null at the first stage. */
export function stageDone(stage) {
  const done = (Array.isArray(stage?.stages) ? stage.stages : []).filter((s) => s.state === 'done').map((s) => s.label);
  if (!done.length) return null;
  const list = done.length === 1 ? done[0] : `${done.slice(0, -1).join(', ')} and ${done[done.length - 1]}`;
  return `${list} done`;
}

/** The four counts, in the canvas's order; a count the page lacks reads Not recorded, never 0. */
export function investorRows(investors) {
  const n = (v) => (Number.isInteger(v) ? String(v) : NR);
  return [
    ['In pipeline', n(investors?.in_pipeline)],
    ['Active conversations', n(investors?.active_conversations)],
    ['In diligence', n(investors?.in_diligence)],
    ['Committed', n(investors?.committed)],
  ];
}

/** A tool's read state: "Connected · read 14 Nov 2026", "Not connected" or "Unavailable". */
export function toolLine(tool) {
  const words = tool?.words || NR;
  const read = tool?.state === 'connected' ? day(tool?.as_of) : null;
  return read ? `${words} · read ${read}` : words;
}

/** RA-31 C: the A4 copy, in the PDF renderer's model shape. */
export function statusPdfModel(page) {
  const made = day(page?.made_at) || NR;
  const areas = Array.isArray(page?.readiness?.areas) ? page.readiness.areas : null;
  const steps = Array.isArray(page?.next_steps) ? page.next_steps : [];
  const tools = Array.isArray(page?.tools) ? page.tools : [];
  const materials = Array.isArray(page?.materials) ? page.materials : [];
  return {
    filename: pdfFilename('raise-status', page?.venture, page?.made_at),
    made,
    eyebrow: `${page?.venture || NR} · Raise status`,
    title: 'Raise status',
    dated: `Shared on ${made}. This shows the raise as of that day; it does not update.`,
    line: null,
    sections: [
      { heading: 'Stage', empty: [page?.stage?.label || NR, stageDone(page?.stage)].filter(Boolean).join(' · ') },
      materials.length
        ? { heading: 'Materials', columns: ['Material', 'State'], widths: [0.4, 0.6], rows: materials.map((m) => [m.label || NR, m.words || NR]) }
        : { heading: 'Materials', empty: `${NR}.` },
      { heading: 'Investors · counts by stage', columns: ['Stage', 'Investors'], widths: [0.4, 0.6], rows: investorRows(page?.investors) },
      areas
        ? { heading: 'Readiness by area', columns: ['Area', 'Score', 'Evidence', 'What is missing', 'Scored'], widths: [0.2, 0.18, 0.13, 0.35, 0.14],
          rows: areas.map((a) => [a.label || NR, a.words || NR, a.evidence || '—', a.missing || '—', day(a.scored_on) || '—']) }
        : { heading: 'Readiness by area', empty: `${NR}.` },
      steps.length
        ? { heading: 'Next steps', columns: ['Step', 'What is missing'], widths: [0.3, 0.7], rows: steps.map((s, i) => [`${i + 1}. ${s.label || NR}`, s.text || '—']) }
        : { heading: 'Next steps', empty: 'No next step is listed.' },
      tools.length
        ? { heading: 'Connected tools', columns: ['Tool', 'Read state'], widths: [0.4, 0.6], rows: tools.map((t) => [t.label || NR, toolLine(t)]) }
        : { heading: 'Connected tools', empty: `${NR}.` },
    ],
    foot: `${NO_NAMES} Scores are out of 10; an area without a score says so and is never 0. Team is assessed by a person.`,
  };
}

/**
 * D8730 (#8730) — the words and states of an HQ-held Founder or Exploring
 * preview, built to `design/incoming/Studio Home Previews Page.dc.html`.
 *
 * A preview is a ROLE, not a person. A question is product copy, so it may be
 * drawn as a labelled Example; an answer is personal, so none is drawn and
 * none is invented. Figures a member would own read "Not applicable in
 * preview", never 0. Pure, so a Node test reads every state.
 */
import { titleCase } from '../lib/absence';

export const PREVIEW_COPY = Object.freeze({
  heldHq: 'Your HQ conversation with Eadwyn is not shown here. It holds your answers as an operator and stays in HQ.',
  withheld: 'Withheld in preview',
  noAnswers: 'No answers drawn',
  composerOff: 'Answers are not saved in a preview',
  composerLabel: 'Answer (off in preview)',
  composerWhy: 'Send is off because a preview has no one to save an answer for. Back to HQ is in the bar above.',
  examplesUnavailable: 'The question examples could not be read. This is not a claim that the bank is empty.',
  examplesEmpty: 'This role’s question bank has no questions to show.',
  loadingExamples: 'Loading examples',
  notApplicable: 'Not applicable in preview',
  refused: 'Answers are not saved in a preview. Back to HQ to keep working as yourself.',
});

/** The line above the page, per previewed role (SPV01 / SPV10). */
export const PREVIEW_NOTES = Object.freeze({
  founder: {
    label: 'Founder preview',
    text: 'You are previewing the Founder role, not a person. Interview questions are labelled examples from the founder question bank. Your own conversation with Eadwyn stays in HQ, and nothing typed here is saved.',
    viewAs: 'View As a founder from Team',
  },
  exploring: {
    label: 'Exploring preview',
    text: 'You are previewing the Exploring role, not a person. Pick the visitor state to show; every question and step below is a labelled example. Nothing typed here is saved.',
    viewAs: 'View As a visitor from Team',
  },
});

/** Founder preview: what the thread is, and what Next up says (SPV01). */
export const FOUNDER_PREVIEW = Object.freeze({
  heading: 'Eadwyn · founder interview',
  examplesLabel: 'Example · how a founder’s interview starts',
  bubblePrefix: 'Example · founder question bank',
  answersLine: 'A founder’s answers appear here. A preview draws none, and invents none.',
  nextUpLabel: 'Next up · example',
  nextUpLine: 'Links open the founder pages in this preview. Tasks and My tickets are a founder’s own and are not drawn.',
  tilesLine: 'These six figures are a founder’s own. HQ holds no founder record, so none is drawn here, not even 0.',
  profileLine: 'Profile completeness, dimensions and the archetype card are a founder’s own answers. Profiling does apply to the Founder role: a founder sees four modules (Skills, Work values, Archetype, Axal Fit).',
  sub: 'A founder’s venture, what Eadwyn asks next and where each answer is used.',
});

/** The six Studio figures, in the strip's order (SPV01). */
export const FOUNDER_FIGURES = Object.freeze(['Venture progress', 'Profile complete', 'Questions answered', 'Artifacts active', 'Tasks done', 'Readiness']);

/**
 * The Exploring example-state select (SPV10): the state a visitor is in, and
 * the track whose discovery questions the examples come from.
 */
export const EXPLORING_EXAMPLE_STATES = Object.freeze([
  { key: 'none', label: 'No role chosen', role: null },
  { key: 'founder', label: 'Founder track', role: 'founder' },
  { key: 'investor', label: 'Investor track', role: 'investor' },
  { key: 'advisor', label: 'Advisor track', role: 'advisor' },
  { key: 'partner', label: 'Partner track', role: 'partner' },
  { key: 'done', label: 'Discovery finished', role: 'investor' },
]);
export const EXPLORING_DEFAULT_EXAMPLE = 'founder';

export function exampleStateOf(key) {
  return EXPLORING_EXAMPLE_STATES.find((s) => s.key === key) || EXPLORING_EXAMPLE_STATES.find((s) => s.key === EXPLORING_DEFAULT_EXAMPLE);
}

/**
 * The example read as one state: loading, unavailable (with Retry), empty
 * (the bank answered with nothing), or ready. `read` is
 * `{ status: 'loading' | 'error' | 'ok', value }`. Only the prompts and
 * options travel: the envelope never carries an answer, and this never reads one.
 */
export function examplesOf(read) {
  if (!read || read.status === 'loading') return { state: 'loading', examples: [], nextUp: [] };
  if (read.status !== 'ok' || !read.value || !Array.isArray(read.value.examples)) return { state: 'unavailable', examples: [], nextUp: [] };
  const clean = (list) => (Array.isArray(list) ? list : [])
    .filter((q) => q && typeof q.prompt === 'string' && q.prompt.trim())
    .slice(0, 2)
    .map((q) => ({
      id: String(q.id || q.prompt),
      section: q.section || null,
      prompt: q.prompt,
      options: Array.isArray(q.options) ? q.options.filter((o) => typeof o === 'string') : [],
      to: typeof q.page_target === 'string' && q.page_target.startsWith('/') ? q.page_target : null,
    }));
  const examples = clean(read.value.examples);
  if (!examples.length) return { state: 'empty', examples: [], nextUp: [] };
  const total = Number.isInteger(read.value.total) && read.value.total > 0 ? read.value.total : null;
  return { state: 'ready', examples, nextUp: clean(read.value.next_up), total };
}

/** Where "View As … from Team" leads: the directory holding View As, out of preview. */
export function viewAsPath(superAdmin) {
  return superAdmin === true ? '/admin/hq-team' : '/admin/accounts/all';
}

/** A section label in sentence case, as the canvas draws it ("BUILD" → "Build"). */
export function sectionLabel(section) {
  const s = String(section || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * The page a Next up example opens, by name ("/build" → "Build"). The
 * advisor router's `pageLabel` says the same for these paths, but it reads
 * the Worker's bank manifest, which a preview (and a Node test) has no need of.
 */
export function pageName(path) {
  const seg = String(path || '').split('/').filter(Boolean).pop() || '';
  return titleCase(seg.replace(/-/g, ' '));
}

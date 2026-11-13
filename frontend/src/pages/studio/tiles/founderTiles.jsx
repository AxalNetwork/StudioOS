/**
 * D1419 (#3698) — the founder's module bodies, one spec per Studio key, over
 * the reads `FounderStudioHome` already makes (D564). Lifted from the zones
 * `FounderStudioBody` drew; "Do these next" and "Activity across the
 * platform" are gone (#3698 part 0), and so is the activity read.
 *
 * - `company_progress`, `eadwyn_questions` and `lab_tools` read the Lab
 *   state and Eadwyn's progress and queue.
 * - A cycle module (`<cycle>_<slug>`) is that module's card on its cycle's
 *   overview (`cyclesApi.overview`, one read per cycle with a placed tile),
 *   drawn by the cycle pages' own `CardBody`.
 * - Holding progress and What this adds up to have no store (D564
 *   `NO_STORE`): they are drawn Not recorded with the reason, never a 0, and
 *   the Worker's catalogue does not offer them yet (D1418 §3), so they are
 *   not placed (`founderNoStoreTiles`).
 */
import { CardBody } from '../../cycles/CycleOverview';
import { EMPTY, LOADING, NOT_RECORDED, NO_STORE, READY, UNREADABLE, modulesOf, progressOf, questionsOf } from '../../founder/founderStudioModel';
import { CYCLE_KEYS, TILE, cycleTileState } from '../studioLayoutModel';

/** The founder model's states, as the tile frame names them. */
const FRAME = { [LOADING]: TILE.LOADING, [UNREADABLE]: TILE.UNREADABLE, [NOT_RECORDED]: TILE.NOT_RECORDED, [EMPTY]: TILE.EMPTY, [READY]: TILE.READY };

export const LAB_TOOLS_OUTSIDE = 'The Lab’s tools open week by week inside a cohort, and you are not in one.';

function ListBlock({ label, items, empty, testId }) {
  return (
    <div data-testid={testId}>
      <p className="text-[10.5px] font-extrabold uppercase tracking-wide text-axal-faint">{label}</p>
      {items.length ? <ul className="mt-1 grid gap-1 text-[12.5px]">{items.map((d) => <li key={d}>{d}</li>)}</ul>
        : <p className="mt-1 text-[12px] text-axal-muted">{empty}</p>}
    </div>
  );
}

function companyProgress(progress, onRetry) {
  if (progress.state !== READY) return { state: FRAME[progress.state], reason: progress.reason, onRetry };
  return {
    state: TILE.READY,
    note: progress.stageNote,
    body: (
      <div data-testid="zone-founder-progress">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Stages">
          {progress.ladder.map((l) => (
            <li key={l.name} className="text-[11.5px]" aria-current={l.state === 'In progress' ? 'step' : undefined}>
              <span className={`block h-1.5 rounded-full ${l.state === 'Complete' ? 'bg-emerald-500' : l.state === 'In progress' ? 'bg-violet-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
              <span className="mt-1 block font-semibold">{l.name}</span>
              <span className="text-axal-muted">{l.state}</span>
            </li>
          ))}
        </ol>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ListBlock label="Shipped" items={progress.shipped} empty="Nothing shipped yet." testId="founder-progress-shipped" />
          <ListBlock label="Still open" items={progress.stillOpen} empty={progress.cohort ? 'Nothing open this week.' : 'Open items are the Lab’s weekly deliverables, inside a cohort.'} testId="founder-progress-open" />
        </div>
        <p className="mt-3 text-[12.5px] text-axal-muted" data-testid="founder-progress-gate"><strong className="text-axal-ink dark:text-white">Gate</strong> · {progress.gate}</p>
      </div>
    ),
  };
}

function eadwynQuestions(questions, onRetry) {
  if (questions.state !== READY) return { state: FRAME[questions.state], reason: questions.reason, onRetry };
  if (!questions.items.length) return { state: TILE.EMPTY, empty: 'No question is waiting on you.' };
  return {
    state: TILE.READY,
    note: questions.answered !== null && questions.open !== null ? `${questions.answered} answered · ${questions.open} open` : null,
    body: (
      <ul className="grid gap-2" data-testid="zone-founder-questions">
        {questions.items.map((q) => (
          <li key={q.id || q.q} className="flex items-start justify-between gap-3 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-700">
            <span className="text-[13px]">{q.q}{q.high && <span className="ml-2 rounded-full bg-amber-50 px-2 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">High impact</span>}</span>
            <a href="#studio-chat" className="shrink-0 text-[12px] font-semibold text-violet-700 dark:text-violet-300">Answer now</a>
          </li>
        ))}
      </ul>
    ),
  };
}

function labTools(modules, lab, onRetry) {
  if (modules.state !== READY) return { state: FRAME[modules.state], reason: modules.reason, onRetry };
  // `cohort_only` (D1421): outside a cohort no tool opens, so the tile says so rather than listing every tool Locked.
  if (!(lab && lab.active === true)) return { state: TILE.NOT_RECORDED, reason: LAB_TOOLS_OUTSIDE, openLabel: 'Open the Lab' };
  const active = modules.items.filter((m) => m.state === 'Active').length;
  return {
    state: TILE.READY,
    note: `${active} of ${modules.items.length} active`,
    openLabel: 'Open the Lab',
    body: (
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="zone-founder-modules">
        {modules.items.map((m) => (
          <li key={m.key} className={`flex items-center justify-between gap-2 rounded-lg border border-axal-hairline px-3 py-2 text-[12px] dark:border-gray-700 ${m.state === 'Locked' ? 'opacity-60' : ''}`}>
            <span className="font-semibold">{m.name}</span>
            <span className="text-[10.5px] font-bold text-axal-muted">{m.state}{m.note ? ` · ${m.note}` : ''}</span>
          </li>
        ))}
      </ul>
    ),
  };
}

function cycleTile(read, slug, onRetry, search) {
  const s = cycleTileState(read, slug);
  if (s.state !== TILE.READY) return { state: s.state, reason: s.reason, onRetry };
  return { state: TILE.READY, note: s.card.range || null, body: <CardBody card={s.card} compact search={search} onRetry={onRetry} /> };
}

/**
 * One spec per founder Studio key. `cycles` maps a cycle to its overview read
 * (undefined while it loads, `{ failed }` when it failed).
 */
export function founderTiles({ reads, cycles = {}, onRetry, onRetryCycle = () => {}, search = '' }) {
  const out = {
    company_progress: companyProgress(progressOf(reads.lab), onRetry),
    eadwyn_questions: eadwynQuestions(questionsOf(reads), onRetry),
    lab_tools: labTools(modulesOf(reads), reads.lab, onRetry),
  };
  for (const [key, { cycle, slug }] of Object.entries(CYCLE_KEYS)) {
    out[key] = cycleTile(cycles[cycle], slug, () => onRetryCycle(cycle), search);
  }
  return out;
}

/** The two no-store blocks, drawn after the placed modules and never placed (see the header). */
export function founderNoStoreTiles() {
  return [
    { key: 'holding_progress', title: 'Holding progress', size: '1/3', spec: { state: TILE.NOT_RECORDED, reason: NO_STORE.blockers } },
    { key: 'implications', title: 'What this adds up to', size: '1/3', spec: { state: TILE.NOT_RECORDED, reason: NO_STORE.implications } },
  ];
}

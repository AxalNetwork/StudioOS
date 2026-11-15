import { PASSED, STAGES, STAGE_LABEL, boardColumns } from './capRelModel.js';

/**
 * D6077 (#6077): Pipeline's search, filters and sort (CRL2 and CRL3, the
 * canvas's `pipeBar`), applied to the loaded prospects read so the Board and
 * the List narrow alike. Pure.
 *
 * Fit, Source and Last contact are the Worker's (`GET
 * /api/contacts/raise-prospects` derives them as the Cycle table did,
 * `services/raiseCycle.ts` `prospectSignals`). When that read says they were
 * not read (`signals` other than 'ok'), the Fit and Source filters are not
 * applied and Last contact sorts nothing, rather than reading every investor
 * as unmatched. Source is offered only while round calls are on, as the
 * Cycle table offered it.
 */

export const PIPELINE_STAGE_VALUES = Object.freeze([...STAGES, PASSED]);
export const PIPELINE_FIT_VALUES = Object.freeze(['fits', 'outside', 'unclear', 'not_recorded']);
export const PIPELINE_PATH_VALUES = Object.freeze(['has', 'none']);
export const PIPELINE_SOURCE_VALUES = Object.freeze(['call', 'other']);
export const PIPELINE_NEXT_VALUES = Object.freeze(['overdue', 'week', 'set', 'none']);
export const PIPELINE_SORT_VALUES = Object.freeze(['due', 'last_contact', 'recent', 'name']);

/** Each control's options, in the order the bar draws them; '' is "any". */
export const PIPELINE_OPTIONS = Object.freeze({
  stage: PIPELINE_STAGE_VALUES.map((v) => [v, STAGE_LABEL[v]]),
  fit: [['fits', 'Fits'], ['outside', 'Outside its focus'], ['unclear', 'Unclear'], ['not_recorded', 'Fit not recorded']],
  path: [['has', 'Has a warm path'], ['none', 'No warm path']],
  source: [['call', 'Responded to a round call'], ['other', 'Not through a call']],
  next: [['overdue', 'Overdue'], ['week', 'Due in the next 7 days'], ['set', 'Has a next step'], ['none', 'No next step set']],
  sort: [['due', 'Next step due'], ['last_contact', 'Last contact'], ['recent', 'Recently updated'], ['name', 'Name']],
});

/** The keys that narrow the pipeline (sort and the Passed column do not). */
export const NARROWING = Object.freeze(['q', 'stage', 'fit', 'path', 'source', 'next']);

const str = (v) => String(v ?? '').trim();
const day = (v) => str(v).slice(0, 10);

/** The date seven days after `today` (YYYY-MM-DD). */
export function weekAfter(today) {
  const d = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return today;
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

/** Which narrowing filters apply, given what the read carried. */
export function activeFilters(f, { signals = 'ok', roundCalls = false } = {}) {
  return NARROWING.filter((k) => {
    if (!f?.[k]) return false;
    if (k === 'fit') return signals === 'ok';
    if (k === 'source') return signals === 'ok' && roundCalls;
    return true;
  });
}

/** Does one prospect pass every filter that applies? */
export function matchesPipeline(p, f, { today, ...read } = {}) {
  for (const k of activeFilters(f, read)) {
    const v = f[k];
    if (k === 'q') {
      const q = v.toLowerCase();
      if (![p.name, p.firm, p.warm_path].some((x) => str(x).toLowerCase().includes(q))) return false;
    } else if (k === 'stage') {
      if (p.stage !== v) return false;
    } else if (k === 'fit') {
      if ((p.fit || 'not_recorded') !== v) return false;
    } else if (k === 'path') {
      if ((str(p.warm_path) !== '') !== (v === 'has')) return false;
    } else if (k === 'source') {
      if ((p.via_call === true) !== (v === 'call')) return false;
    } else if (k === 'next') {
      const due = day(p.next_step_due);
      const ok = v === 'overdue' ? due !== '' && due < today
        : v === 'week' ? due !== '' && due >= today && due <= weekAfter(today)
          : v === 'set' ? str(p.next_step) !== ''
            : str(p.next_step) === '';
      if (!ok) return false;
    }
  }
  return true;
}

const byName = (a, b) => str(a.name || a.firm).localeCompare(str(b.name || b.firm));

/** The prospects in the sort's order; one with no value for the sort goes last. */
export function sortPipeline(items, sort = 'due') {
  const list = [...(items || [])];
  if (sort === 'name') return list.sort(byName);
  if (sort === 'recent') return list.sort((a, b) => str(b.updated_at).localeCompare(str(a.updated_at)) || byName(a, b));
  if (sort === 'last_contact') {
    return list.sort((a, b) => str(b.last_contact).localeCompare(str(a.last_contact))
      || str(b.updated_at).localeCompare(str(a.updated_at)) || byName(a, b));
  }
  return list.sort((a, b) => (day(a.next_step_due) || '9999').localeCompare(day(b.next_step_due) || '9999') || byName(a, b));
}

/** The visible prospects: filtered, then sorted. */
export function pipelineView(items, f, read = {}) {
  return sortPipeline((items || []).filter((p) => matchesPipeline(p, f, read)), f?.sort);
}

/** The board's columns over the visible prospects, each in the sort's order. */
export function sortedColumns(visible, sort) {
  const c = boardColumns(visible);
  return { ...c, columns: c.columns.map((col) => ({ ...col, items: sortPipeline(col.items, sort) })), passed: sortPipeline(c.passed, sort) };
}

/** The patch that clears every narrowing filter, keeping the sort and the Passed column. */
export const CLEAR_PATCH = Object.freeze(Object.fromEntries(NARROWING.map((k) => [k, ''])));

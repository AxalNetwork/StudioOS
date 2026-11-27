/**
 * D4873 (#4873, part 2) — the Programs operating console's rules, as pure functions (the canvas
 * `design/incoming/Programs v2 Page.dc.html`, boards PG01, PG06 and PG07). No React here, so `node --test`
 * loads it.
 *
 * THE TOP ANSWERS FOUR QUESTIONS, in order (PG08): what is operational (Programs), where people take part
 * (People participating), what HQ must act on (Actions requiring HQ) and what moved (Credits). Each headline is
 * one of the read's own blocks, never a sum this page invents:
 *   · Actions requiring HQ is the Worker's waiting tile, broken down by the queues beside it, so 13 reads
 *     "12 Perk listings · 1 Strategic referral access" and the queues add up to it. A queue that was not read
 *     makes the headline "12+", marked Incomplete, with the queue named: never a complete-looking 12.
 *   · People participating that leaves a program out is marked Incomplete and states its coverage
 *     ("9 of 10 programs counted"), never drawn as a plain number.
 *   · A measured zero says it is one; a figure the platform does not record says Not recorded.
 *
 * NEEDS ATTENTION lists the queues first (overdue before waiting), then what is incomplete or unreadable,
 * then build blockers (partly built, paused). EADWYN'S NEXT STEPS are its first three items, as links to
 * where the work is. Nothing here acts. No internal identifier reaches a sentence.
 */
import {
  GROUPS, NOT_READ_YET, NOT_RECORDED, OVERDUE_HOURS, ageText, programByKey,
} from './programsModel';
import { deltaText, pick } from './catalogueModel';

const nf = (n) => Number(n).toLocaleString('en-US');
const nameOf = (key) => programByKey(key)?.name || key;

/** D4873: member access is `programsModel.js`'s, so the dimensions and this page read one rule. */
export { ACCESS_WORDS, memberAccessOf } from './programsModel';

/* ------------------------------------------------------------------ *
 * The four headline cards (PG01, PG06)
 * ------------------------------------------------------------------ */

function notReady(key, label, s) {
  if (s.state === 'loading') return { key, label, state: 'loading' };
  if (s.state === 'pending') return { key, label, state: 'placeholder', word: NOT_READ_YET, reason: s.reason };
  if (s.state === 'unrecorded') return { key, label, state: 'placeholder', word: NOT_RECORDED, reason: s.reason };
  return { key, label, state: 'unreadable', reason: s.reason };
}

/** The rows of Waiting by program (`waitingChart(read).rows`), or none while it reads. */
const queueRows = (waiting) => (Array.isArray(waiting?.rows) ? waiting.rows : []);

/**
 * `read` is the catalogue read; `cards` is `catalogueCards(...).cards`; `waiting` is `waitingChart(read)`;
 * `weeks` is the period. Each card: `{ key, label, state, value, parts, incomplete, overdue, note }`. The keys are
 * the tiles' (`running`, `people`, `waiting`, `credits`), so the page's test ids stay the tiles' ids.
 */
export function headlineCards({ read, cards = [], waiting, weeks, superAdmin = false }) {
  const out = [];

  // Programs: what is operational, what studios cannot be offered, what is proposed.
  const running = pick(read, ['tiles', 'running']);
  if (running.state === 'ready') {
    const by = running.data.by_status || {};
    const fields = cards.map((c) => c.row?.grant).filter(Boolean);
    const allRead = superAdmin && cards.length > 0 && fields.length === cards.length && fields.every((f) => f.available !== false);
    const unavailable = allRead ? fields.filter((f) => f.state === 'hq_only').length : null;
    out.push({
      key: 'running', label: 'Programs', state: 'ready', value: `${nf(Number(running.data.running) || 0)} operational`,
      parts: [unavailable === null ? null : `${nf(unavailable)} unavailable to studios`, `${nf(Number(by.proposed) || 0)} proposed`].filter(Boolean),
    });
  } else out.push(notReady('running', 'Programs', running));

  // People participating: a figure that leaves a program out is Incomplete and says how much it covers.
  const people = pick(read, ['tiles', 'people']);
  if (people.state === 'ready') {
    const d = people.data;
    const covers = Array.isArray(d.covers) ? d.covers : [];
    const left = Array.isArray(d.left_out) ? d.left_out : [];
    const count = Number(d.count) || 0;
    const total = covers.length + left.length;
    out.push({
      key: 'people', label: 'People participating', state: 'ready', value: nf(count), delta: deltaText(d.count, d.previous),
      parts: [`${count === 1 ? 'active participant' : 'active participants'}`,
        left.length ? `${nf(covers.length)} of ${nf(total)} programs counted` : null].filter(Boolean),
      incomplete: left.length > 0,
      note: left.length ? `Excludes ${left.map((x) => nameOf(x.program)).join(', ')}` : null,
    });
  } else out.push(notReady('people', 'People participating', people));

  // Actions requiring HQ: the waiting tile, broken down by the queues beside it.
  const tile = pick(read, ['tiles', 'waiting']);
  const rows = queueRows(waiting);
  const ready = rows.filter((r) => r.state === 'ready');
  const unread = rows.filter((r) => r.state !== 'ready' && r.state !== 'loading');
  const breakdown = ready.filter((r) => r.count > 0).map((r) => `${nf(r.count)} ${r.label}`);
  if (tile.state === 'ready') {
    const count = Number(tile.data.count) || 0;
    out.push({
      key: 'waiting', label: 'Actions requiring HQ', state: 'ready', value: nf(count),
      parts: count === 0 ? ['Nothing is waiting'] : breakdown,
      overdue: count > 0 && Number(tile.data.oldest_hours) >= OVERDUE_HOURS,
    });
  } else if (tile.state === 'unreadable' && ready.length && unread.length) {
    // PG06: a queue that was not read makes the headline "12+", never a complete-looking 12.
    const sum = ready.reduce((t, r) => t + r.count, 0);
    out.push({
      key: 'waiting', label: 'Actions requiring HQ', state: 'ready', value: `${nf(sum)}+`, incomplete: true,
      parts: [...breakdown, ...unread.map((r) => `${r.label} not read`)],
    });
  } else out.push(notReady('waiting', 'Actions requiring HQ', tile));

  // Credits: granted and spent in the period. A zero is a measured zero, and says so.
  const credits = pick(read, ['tiles', 'credits']);
  const creditsLabel = `Credits · ${nf(weeks)} weeks`;
  if (credits.state === 'ready') {
    const g = Number(credits.data.granted) || 0;
    const s = Number(credits.data.spent) || 0;
    out.push({
      key: 'credits', label: creditsLabel, state: 'ready', value: `${nf(g)} granted`, parts: [`${nf(s)} spent`],
      note: g === 0 && s === 0 ? 'Measured zero: nothing granted or spent' : null,
    });
  } else out.push(notReady('credits', creditsLabel, credits));

  return out;
}

/* ------------------------------------------------------------------ *
 * Needs attention (PG01) and Eadwyn's next steps (PG05)
 * ------------------------------------------------------------------ */

/**
 * The items, queues first. Each: `{ key, tone: 'act' | 'info', title, sub, word, to, action }`.
 * `word` is the state in words (Overdue, Waiting, Incomplete, Unavailable, Partly built, Paused), so no item
 * says its state by colour or glyph alone.
 */
export function attentionItems({ read, cards = [], waiting }) {
  const items = [];
  const rows = queueRows(waiting);
  const queues = rows.filter((r) => r.state === 'ready' && r.count > 0).map((r) => ({
    key: `queue-${r.key}`, tone: 'act', label: r.label, title: `${r.label} waiting`, sub: r.sub || `${nf(r.count)} waiting`,
    word: Number(r.oldestHours) >= OVERDUE_HOURS ? 'Overdue' : 'Waiting', to: r.to, action: 'Review', count: r.count, oldestHours: r.oldestHours ?? null,
  }));
  // Overdue first, then the oldest.
  queues.sort((a, b) => (a.word === b.word ? (Number(b.oldestHours) || 0) - (Number(a.oldestHours) || 0) : a.word === 'Overdue' ? -1 : 1));
  items.push(...queues);

  for (const r of rows.filter((x) => x.state === 'unreadable')) {
    items.push({ key: `unread-${r.key}`, tone: 'act', title: `${r.label} could not be read`, sub: 'That is not the same as none.', word: 'Unavailable', to: r.to, action: 'Open' });
  }

  const people = pick(read, ['tiles', 'people']);
  if (people.state === 'ready' && Array.isArray(people.data.left_out)) {
    for (const x of people.data.left_out) {
      items.push({
        key: `coverage-${x.program}`, tone: 'act', title: `People participating excludes ${nameOf(x.program)}`,
        sub: String(x.reason || ''), word: 'Incomplete', to: null, action: null,
      });
    }
  }

  for (const c of cards) {
    if (c.status === 'Partly built') {
      items.push({ key: `build-${c.key}`, tone: 'info', title: `${c.name} is partly built`, sub: 'Open it to see what is built and what is not.', word: 'Partly built', to: `/admin/programs/${c.key}`, action: 'Open' });
    } else if (c.status === 'Paused') {
      items.push({ key: `paused-${c.key}`, tone: 'info', title: `${c.name} is paused`, sub: 'Members cannot join while it is paused.', word: 'Paused', to: `/admin/programs/${c.key}`, action: 'Open' });
    }
  }
  return items;
}

/** Needs attention's state as a whole: reading, failed, or the items. */
export function attentionState({ read, cards, waiting }) {
  const running = pick(read, ['tiles', 'running']);
  if (running.state === 'loading') return { state: 'loading' };
  if (running.state === 'unreadable' && !queueRows(waiting).some((r) => r.state === 'ready')) return { state: 'unreadable' };
  const items = attentionItems({ read, cards, waiting });
  return items.length ? { state: 'ready', items } : { state: 'empty' };
}

export const STEPS_TITLE = 'For Programs';
export const STEPS_EMPTY = 'Nothing needs HQ on Programs right now. Next steps are drawn from this page’s queues, coverage and build states each time it reads.';
export const STEPS_UNAVAILABLE = 'Next steps aren’t available right now. The page itself is unaffected. Try again later.';
export const STEPS_FOOT = 'These are suggestions. Nothing changes until you act.';

/** One step's sentence: what is the case, and what to do first. */
function stepText(i) {
  if (i.key.startsWith('queue-')) {
    const age = ageText(i.oldestHours);
    return `${i.label}: ${nf(i.count)} ${i.word === 'Overdue' ? 'overdue' : 'waiting'}.${age ? ` Review the oldest first; it has waited ${age}.` : ''}`;
  }
  if (i.key.startsWith('coverage-')) return `People participating is incomplete. ${i.sub}`;
  return `${i.title}. ${i.sub}`;
}

/** The rail's next steps, from Needs attention: its first three, or one calm line, or "not available". */
export function nextSteps(att, onRetry) {
  if (!att || att.state === 'loading') return { title: STEPS_TITLE, state: 'loading' };
  if (att.state === 'unreadable') return { title: STEPS_TITLE, state: 'unavailable', text: STEPS_UNAVAILABLE, onRetry };
  if (att.state === 'empty') return { title: STEPS_TITLE, state: 'empty', text: STEPS_EMPTY };
  return {
    title: STEPS_TITLE, state: 'ready', foot: STEPS_FOOT,
    items: att.items.slice(0, 3).map((i) => ({
      key: i.key, tone: i.tone, text: stepText(i), to: i.to,
      action: i.key.startsWith('queue-') ? `Open ${i.label.toLowerCase()}` : i.action,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * The catalogue: rows grouped by category (PG01), cards (PG07a), compact rows (PG07b)
 * ------------------------------------------------------------------ */

export const LAYOUTS = Object.freeze([{ value: 'rows', label: 'Rows' }, { value: 'cards', label: 'Cards' }]);
export const ROW_HEADS = Object.freeze(['Program', 'Build · state', 'Member access', 'Studio offering', 'Existing grants', 'Activity']);

/** The cards in category order, each category once, with the programs the filter leaves. A custom group sorts last. */
export function groupedCards(cards, group = null) {
  const shown = cards.filter((c) => !group || c.group === group);
  const order = [...GROUPS, ...[...new Set(shown.map((c) => c.group))].filter((g) => !GROUPS.includes(g))];
  return order.map((g) => ({ group: g, cards: shown.filter((c) => c.group === g) })).filter((x) => x.cards.length);
}

/** The phone's one line under a program's name: member access · studio offering. */
export const phoneLine = (dims) => {
  const v = Object.fromEntries(dims.map((d) => [d.key, d.value]));
  return `${v.access} · ${v.offering}`;
};

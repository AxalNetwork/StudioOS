/**
 * D1082 (#2947) — Build in Lovable's words and small rules, with no React,
 * so `node --test` loads them alone. The dialog is `BuildInLovable.jsx`.
 */

// The owner's re-exported dialog (`design/incoming/Lovable Page.dc.html`, D1311 §3), in its words.
export const OPENS_LINE = 'Lovable opens in a new tab with this prompt. You build there, with your own Lovable account.';
/** The canvas reads "Drafted by Eadwyn"; the prompt is a fixed template over the record, so it says that (D1082 §3). */
export const DRAFTED_LINE = { validate: 'Drafted from this experiment. Edit it before you open Lovable.', build: 'Drafted from Prototype / MVP. Edit it before you open Lovable.' };

// ─────────────────────────────────────────────── D8773 (#8773): what the check covered, in its own terms

/**
 * The five things the Worker's check looks for (`services/lovable/prompt.ts`
 * `privacyFindings`: `lintForSend(text, 'public')` and this venture's
 * interviewee names), each in the words of what the code matches. The result
 * never certifies that a prompt holds no names: it says these five found
 * nothing, and what they do not cover.
 */
export const CHECKS = Object.freeze([
  { key: 'email', name: 'Email addresses', what: 'any text shaped like an email address' },
  { key: 'phone', name: 'Phone numbers', what: '8 to 15 digits, with or without spaces, dots or dashes' },
  { key: 'numbers', name: 'Tax, bank and card numbers', what: 'a US tax number shape, an IBAN, or 13 to 19 digits shaped like a card' },
  { key: 'legal_names', name: 'Recorded full legal names', what: 'the full legal name on file for any Axal VC account, first and last name written out in full' },
  { key: 'interviewees', name: 'This venture’s interviewees', what: 'the names recorded on this venture’s interviews, as whole words' },
]);
/** The advisory beside the five (D8773): it asks, it never refuses. */
export const MEMBER_CHECK = { key: 'members', name: 'This venture’s members', what: 'account and display names of this venture’s members, as whole words. A match asks you to choose; it does not stop the prompt.' };
export const CHECK_OK = 'No matches for the five checks below.';
export const NOT_COVERED = 'Not covered: names of anyone else, part of a name or a nickname, and company details. Read the text yourself before it leaves.';
export const CHECK_HINT = 'The check names the kind of detail and its line, never the words.';
/** The polite announcement once the check settles on the text on screen. */
export const ANNOUNCE_OK = 'Checked: no matches for the five checks. The check does not look for other names.';

/** Build › Plan › Send to… runs `lintForSend` alone (`services/buildHandoffs.ts`): four checks, not five (owner Q3, option A). */
export const SEND_CHECKS = Object.freeze(CHECKS.slice(0, 4));
export const SEND_CHECK_OK = 'No matches for the four checks below.';
export const SEND_NOT_COVERED = 'Not covered: interviewees’ names, names of anyone else, part of a name or a nickname, and company details. Read the text yourself before it leaves.';

/** Q4, option A: the entry says what it does; opening Lovable is a later press. */
export const ENTRY_LABEL = 'Prepare a Lovable prompt';
export const STEPS = Object.freeze([
  { name: 'Prepare', sub: 'In Axal VC · nothing leaves' },
  { name: 'Review and open', sub: 'Leaves for lovable.dev' },
]);
export const PREPARE_SUB = 'Preparing sends nothing. Next you review exactly what leaves Axal VC before Lovable opens.';
/** What each template reads (`prompt.ts` `landingTestPrompt`, `prototypePrompt`); the check reads interviewee names only to find them. */
export const DRAFTED_FROM = {
  validate: 'Drafted only from this venture’s name and description and this experiment’s claim, title, method and target, plus its sign-up form address when it has one. The draft never reads interviews, quotes, contacts, emails or phone numbers.',
  build: 'Drafted only from this venture’s name, description, MVP target date and must-haves. The draft never reads interviews, quotes, contacts, emails or phone numbers.',
};
export const VENTURE_NOTE = 'The checks cannot tell whether a venture’s name is a person’s name, unless it is a member’s name. Lovable will see it.';
export const ALIAS_NOTE = 'Only this prompt changes. Your venture keeps its name, the alias is not saved, and the draft stays one click away.';
export const ALIAS_EDITED = 'Restore the draft to apply an alias, or change the name in the prompt yourself.';

/**
 * Review what will be sent (BLP06), each row true of the code: the Worker
 * never calls Lovable (`launch.ts`), the text rides in `lovable.dev/#prompt=`,
 * the launch writes `build_handoffs` (who, when, the text and its hash), and
 * Copy calls nothing.
 */
export const REVIEW = {
  destination: 'lovable.dev, in a new tab, with your own Lovable account.',
  travels: 'Inside the link, after the “#”. Your browser hands it to Lovable’s page; Axal VC never sends it to Lovable. Lovable waits for you to press send there.',
  nothingElse: 'The link carries this text and nothing else.',
  records: 'When you press Open: that it was opened, by whom and when, and a copy of this exact text, kept with this venture’s handoffs.',
  copyInstead: 'Copy prompt puts the same text on your clipboard. Nothing is recorded when you copy.',
};
export const OPENED_LINE = 'Opened Lovable in a new tab. Nothing is built until you press send there.';
export const SUPPORT_NOTE = 'You are in a support session. You can read this prompt and its check. Opening it in Lovable is the founder’s: Axal VC refuses to open it from a support session.';

/** "Line 1", "Lines 1 and 3", "Lines 1, 2 and 7"; null when there is none. */
export function linesLabel(lines) {
  const xs = [...new Set((Array.isArray(lines) ? lines : []).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  if (!xs.length) return null;
  return xs.length === 1 ? `Line ${xs[0]}` : `Lines ${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** "14:31 UTC" from the Worker's `checked_at`, or null. */
export function checkTime(at) {
  const m = /T(\d{2}:\d{2})/.exec(String(at ?? ''));
  return m ? `${m[1]} UTC` : null;
}

/**
 * The line diff between the draft and the text (a longest-common-subsequence
 * over whole lines): each op is `same`, `del` (a draft line, numbered in the
 * draft) or `add` (a text line, numbered in the text).
 */
export function lineDiff(before, after) {
  const a = String(before ?? '').split('\n');
  const b = String(after ?? '').split('\n');
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0; let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { ops.push({ op: 'same', text: a[i], n: j + 1 }); i += 1; j += 1; }
    else if (j < b.length && (i >= a.length || L[i][j + 1] >= L[i + 1][j])) { ops.push({ op: 'add', text: b[j], n: j + 1 }); j += 1; }
    else { ops.push({ op: 'del', text: a[i], n: i + 1 }); i += 1; }
  }
  return ops;
}

/** "Edited · n lines": an edited line counts once (one removed, one added), an added or removed line once. */
export function changedLines(before, after) {
  if (String(before ?? '') === String(after ?? '')) return 0;
  const ops = lineDiff(before, after);
  const adds = ops.filter((o) => o.op === 'add').length;
  const dels = ops.filter((o) => o.op === 'del').length;
  return Math.max(adds, dels);
}

/** Whether `label` stands in `text` as whole words, any case: Review's "Names your venture as". */
export function namesVenture(text, label) {
  const l = String(label ?? '').trim();
  if (!l) return false;
  const esc = l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'iu').test(String(text ?? ''));
}

/** "1,234 characters · 14 lines": Review's count of exactly what goes. */
export function exactCount(text) {
  const t = String(text ?? '');
  const lines = t.split('\n').length;
  return `${t.length.toLocaleString('en-US')} characters · ${lines} ${lines === 1 ? 'line' : 'lines'}`;
}

export const BRING_BACK = {
  title: 'Bring it back',
  line: { validate: 'After you build, link the Lovable project here. Its pages then show on this experiment as From Lovable.', build: 'After you build, link the Lovable project here. Its pages then show on Prototype / MVP as From Lovable.' },
  label: 'Paste the Lovable project link (optional)',
  note: 'Axal VC does not see what you build until you link it.',
};
/** Kept for the Worker's draft field; the re-export folds it into the privacy line. */
export const LEFT_OUT = 'Interview names, quotes and contacts are never included.';

/** The dialog's eyebrow and title: "Build in Lovable · H2", "Build the landing page test in Lovable". */
export function dialogHead(cycle, tests) {
  const code = typeof tests?.code === 'string' && tests.code.trim() ? tests.code.trim() : null;
  return {
    eyebrow: code ? `Build in Lovable · ${code}` : 'Build in Lovable',
    title: cycle === 'build' ? 'Build the prototype in Lovable' : 'Build the landing page test in Lovable',
  };
}

/** "What this tests": the claim with its code, the experiment, and "Target …", each only when the Worker sent it. */
export function testsRows(tests) {
  if (!tests || typeof tests !== 'object') return [];
  const t = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const claim = t(tests.claim) && (t(tests.code) ? `${t(tests.code)} · ${t(tests.claim)}` : t(tests.claim));
  const target = t(tests.target) && (/^target\b/i.test(t(tests.target)) ? t(tests.target) : `Target ${t(tests.target)}`);
  return [claim && { key: 'claim', text: claim, strong: true }, t(tests.title) && { key: 'title', text: t(tests.title) }, target && { key: 'target', text: target }].filter(Boolean);
}
export const MAX = 4000;

/** "2026-10-22" from the Worker's timestamp, or null. */
export function openedDay(at) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(at ?? ''));
  return m ? m[1] : null;
}

/** The count under the prompt, "1,234 / 4,000". */
export const countText = (n) => `${Number(n || 0).toLocaleString('en-US')} / ${MAX.toLocaleString('en-US')}`;

/** Whether an entry draws anything: the button for a writer, or LV4's line once opened. */
export const showsEntry = (lovable) => !!(lovable && lovable.record && (lovable.can_launch || openedDay(lovable.opened_at)));

/**
 * LV7: Prototype / MVP's entry, from the Build module read's `parts.lovable.launch`
 * (D1083's app link is the same key's body);
 * null for any other module, or when it would draw nothing.
 */
export function prototypeLovable(cycle, slug, module) {
  const part = cycle === 'build' && slug === 'prototype-mvp' ? module?.parts?.lovable?.launch : null;
  if (!part) return null;
  const lovable = { cycle: 'build', project_id: part.project_id, record: part.record, can_launch: !!part.can_launch, opened_at: part.opened_at ?? null };
  return showsEntry(lovable) ? lovable : null;
}

/**
 * D1082 (#2947) — Build in Lovable's words and small rules, with no React,
 * so `node --test` loads them alone. The dialog is `BuildInLovable.jsx`.
 */

// The owner's re-exported dialog (`design/incoming/Lovable Page.dc.html`, D1311 §3), in its words.
export const OPENS_LINE = 'Lovable opens in a new tab with this prompt. You build there, with your own Lovable account.';
/** The canvas reads "Drafted by Eadwyn"; the prompt is a fixed template over the record, so it says that (D1082 §3). */
export const DRAFTED_LINE = { validate: 'Drafted from this experiment. Edit it before you open Lovable.', build: 'Drafted from Prototype / MVP. Edit it before you open Lovable.' };
export const PRIVACY_OK = 'Privacy check passed.';
export const PRIVACY_OK_SUB = 'No names, emails or interview quotes are in the prompt.';
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
